// CAELUS OS — Shadow-Mesh P2P Discovery Module
// Air-Gapped peer discovery over link-local UDP multicast.
//
// ZERO INTERNET RULE: No DNS, no HTTP, no routable sockets. Discovery uses UDP
// multicast on 224.0.0.251 (link-local, never routed beyond the LAN segment).
//
// SECURITY MODEL (hardened):
//   * Every beacon is ed25519-signed; unsigned / forged frames are dropped.
//   * The advertised fingerprint MUST equal Blake3(verifying_key) or the frame
//     is rejected (prevents fingerprint spoofing at the discovery layer).
//   * Beacons carry a wall-clock timestamp; stale/future frames are rejected
//     (bounded replay window).
//   * A strictly-increasing per-peer counter + timestamp blocks replay.
//   * The peer table is capacity-bounded (MAX_PEERS) to stop memory-exhaustion
//     flooding from spoofed fingerprints.

use std::collections::HashMap;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use crate::network::mesh_auth::{fingerprint_of, CaelusIdentityHandle, DeviceIdentity};

// Link-local multicast address — never routed beyond the LAN segment.
const MESH_MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
const MESH_DISCOVERY_PORT: u16 = 47808;
const BEACON_INTERVAL: Duration = Duration::from_millis(500);
const PEER_TTL_SECS: u64 = 10; // Peer considered stale after 10 s of silence
const MAX_PEERS: usize = 256; // Hard cap on the peer table (flood / DoS guard)
const BEACON_FRESHNESS_SECS: u64 = 30; // Reject beacons older than this
const MAX_CLOCK_SKEW_SECS: u64 = 5; // Tolerate small forward clock skew
const RECV_BUF_LEN: usize = 2048;

const BEACON_MAGIC: u32 = 0xCAE1_05FF;
const BEACON_SIG_CONTEXT: &[u8] = b"CAELUS_MESH_BEACON_V1";
const SLOT_HASH_CONTEXT: &[u8] = b"CAELUS_MESH_SLOT_V1";

// ─── Injectable virtual clock (for deterministic CI testing) ──────────────────
//
// When VIRTUAL_CLOCK_ENABLED is true, now_secs() returns VIRTUAL_TICK_SECS
// instead of the wall clock.  This makes beacon TTLs, freshness checks and
// peer eviction fully reproducible in CI/test runs.
//
// Production code never touches these statics; both default values leave the
// real wall-clock path active.  C++ sets them via the FFI surface below.

static VIRTUAL_CLOCK_ENABLED: AtomicBool = AtomicBool::new(false);
static VIRTUAL_TICK_SECS: AtomicU64 = AtomicU64::new(0);

// ─── Time helpers ──────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    if VIRTUAL_CLOCK_ENABLED.load(Ordering::Relaxed) {
        return VIRTUAL_TICK_SECS.load(Ordering::Relaxed);
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn current_unix_minute() -> u64 {
    now_secs() / 60
}

// ─── ZK-style OTP slot commitment ───────────────────────────────────────────────

/// Build a slot commitment for an explicit minute:
/// Blake3(CONTEXT || device_fingerprint || slot_id || unix_minute).
///
/// NOTE: This is a *temporal commitment*, not a true zero-knowledge proof. The
/// verifier must already hold the peer's slot_id (from the air-gapped manifest)
/// to recompute and compare. It binds a claim to a one-minute window; it does
/// NOT hide a low-entropy slot_id from an attacker who can capture a beacon, so
/// slot_ids must be treated as shared secrets, not as public identifiers.
pub fn compute_slot_hash_at(fingerprint: &[u8; 32], slot_id: u64, unix_minute: u64) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(SLOT_HASH_CONTEXT);
    hasher.update(fingerprint);
    hasher.update(&slot_id.to_le_bytes());
    hasher.update(&unix_minute.to_le_bytes());
    *hasher.finalize().as_bytes()
}

/// Convenience: slot commitment for the current minute.
pub fn compute_slot_hash(fingerprint: &[u8; 32], slot_id: u64) -> [u8; 32] {
    compute_slot_hash_at(fingerprint, slot_id, current_unix_minute())
}

/// Verify a received slot commitment. Accepts the current minute and ±1 minute
/// to tolerate clock skew and minute-boundary races (the original code rejected
/// every claim that straddled a minute boundary). Constant-time comparison.
pub fn verify_slot_hash(
    peer_fingerprint: &[u8; 32],
    received_hash: &[u8; 32],
    expected_slot_id: u64,
) -> bool {
    use subtle::ConstantTimeEq;
    let now = current_unix_minute();
    for minute in [now, now.wrapping_sub(1), now.wrapping_add(1)] {
        let expected = compute_slot_hash_at(peer_fingerprint, expected_slot_id, minute);
        if bool::from(expected.ct_eq(received_hash)) {
            return true;
        }
    }
    false
}

// ─── Discovered peer record ─────────────────────────────────────────────────────

/// A discovered peer advertising an OTP slot claim on the mesh.
#[derive(Debug, Clone)]
pub struct DiscoveredPeer {
    /// Stable device fingerprint = Blake3(verifying_key). Verified against the
    /// signing key carried in the beacon before the peer is ever stored.
    pub device_fingerprint: [u8; 32],
    /// The operational OTP slot commitment the peer is advertising.
    pub slot_claim_hash: [u8; 32],
    /// Last-seen UNIX timestamp (seconds).
    pub last_seen: u64,
    /// Highest beacon counter seen from this peer (anti-replay ordering).
    pub last_counter: u64,
    /// Network address (only valid inside the local segment).
    pub addr: SocketAddr,
}

/// Thread-safe peer table shared between discovery and auth layers.
pub type PeerTable = Arc<Mutex<HashMap<[u8; 32], DiscoveredPeer>>>;

// ─── Signed beacon wire frame ───────────────────────────────────────────────────

/// Beacon transmitted on the mesh. Carries no plaintext identity (only the
/// public key + a slot commitment) and is ed25519-signed end to end.
/// Encoded with a fixed little-endian binary layout (no serde — avoids the
/// 32-element array limit and is more compact than JSON on the wire).
#[derive(Clone)]
pub struct BeaconFrame {
    /// CAELUS mesh protocol magic.
    magic: u32,
    /// ed25519 verifying key — needed so receivers can check the signature.
    verifying_key: [u8; 32],
    /// Device fingerprint (must equal Blake3(verifying_key)).
    fingerprint: [u8; 32],
    /// Slot commitment (see compute_slot_hash).
    slot_hash: [u8; 32],
    /// Monotonic beacon counter (replay ordering).
    counter: u64,
    /// Wall-clock timestamp (seconds) — bounds the replay window.
    timestamp: u64,
    /// ed25519 signature over signing_payload().
    signature: [u8; 64],
}

impl BeaconFrame {
    /// Bytes covered by the signature (everything except the signature itself).
    fn signing_payload(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(BEACON_SIG_CONTEXT.len() + 4 + 32 + 32 + 32 + 8 + 8);
        v.extend_from_slice(BEACON_SIG_CONTEXT);
        v.extend_from_slice(&self.magic.to_le_bytes());
        v.extend_from_slice(&self.verifying_key);
        v.extend_from_slice(&self.fingerprint);
        v.extend_from_slice(&self.slot_hash);
        v.extend_from_slice(&self.counter.to_le_bytes());
        v.extend_from_slice(&self.timestamp.to_le_bytes());
        v
    }

    /// Full validation: magic, key↔fingerprint binding, freshness, signature.
    fn is_authentic(&self) -> bool {
        if self.magic != BEACON_MAGIC {
            return false;
        }
        let vk = match VerifyingKey::from_bytes(&self.verifying_key) {
            Ok(k) => k,
            Err(_) => return false,
        };
        // The fingerprint must be derived from the advertised key — otherwise an
        // attacker could claim any fingerprint they like at the discovery layer.
        if fingerprint_of(&vk) != self.fingerprint {
            return false;
        }
        let now = now_secs();
        if self.timestamp > now.saturating_add(MAX_CLOCK_SKEW_SECS) {
            return false; // beacon from the future
        }
        if now.saturating_sub(self.timestamp) > BEACON_FRESHNESS_SECS {
            return false; // stale / replayed beacon
        }
        let sig = Signature::from_bytes(&self.signature);
        vk.verify(&self.signing_payload(), &sig).is_ok()
    }
}

/// Build a fresh, signed beacon for the given identity / slot / counter.
pub fn build_signed_beacon(identity: &DeviceIdentity, slot_id: u64, counter: u64) -> BeaconFrame {
    let slot_hash = compute_slot_hash(&identity.fingerprint, slot_id);
    let mut frame = BeaconFrame {
        magic: BEACON_MAGIC,
        verifying_key: *identity.verifying_key.as_bytes(),
        fingerprint: identity.fingerprint,
        slot_hash,
        counter,
        timestamp: now_secs(),
        signature: [0u8; 64],
    };
    let sig = identity.sign(&frame.signing_payload());
    frame.signature = sig.to_bytes();
    frame
}

/// Fixed beacon wire size: magic(4) + vk(32) + fp(32) + slot(32) + counter(8)
/// + timestamp(8) + signature(64).
const BEACON_WIRE_LEN: usize = 4 + 32 + 32 + 32 + 8 + 8 + 64;

/// Serialize a beacon to a compact, fixed little-endian byte layout.
pub fn encode_beacon(frame: &BeaconFrame) -> Vec<u8> {
    let mut v = Vec::with_capacity(BEACON_WIRE_LEN);
    v.extend_from_slice(&frame.magic.to_le_bytes());
    v.extend_from_slice(&frame.verifying_key);
    v.extend_from_slice(&frame.fingerprint);
    v.extend_from_slice(&frame.slot_hash);
    v.extend_from_slice(&frame.counter.to_le_bytes());
    v.extend_from_slice(&frame.timestamp.to_le_bytes());
    v.extend_from_slice(&frame.signature);
    v
}

/// Parse a beacon from wire bytes. Returns None for any truncated / malformed
/// frame (untrusted UDP input must never panic or over-read).
pub fn decode_beacon(data: &[u8]) -> Option<BeaconFrame> {
    if data.len() < BEACON_WIRE_LEN {
        return None;
    }
    let mut off = 0usize;
    let magic = u32::from_le_bytes(data[off..off + 4].try_into().ok()?);
    off += 4;
    let mut verifying_key = [0u8; 32];
    verifying_key.copy_from_slice(&data[off..off + 32]);
    off += 32;
    let mut fingerprint = [0u8; 32];
    fingerprint.copy_from_slice(&data[off..off + 32]);
    off += 32;
    let mut slot_hash = [0u8; 32];
    slot_hash.copy_from_slice(&data[off..off + 32]);
    off += 32;
    let counter = u64::from_le_bytes(data[off..off + 8].try_into().ok()?);
    off += 8;
    let timestamp = u64::from_le_bytes(data[off..off + 8].try_into().ok()?);
    off += 8;
    let mut signature = [0u8; 64];
    signature.copy_from_slice(&data[off..off + 64]);
    Some(BeaconFrame {
        magic,
        verifying_key,
        fingerprint,
        slot_hash,
        counter,
        timestamp,
        signature,
    })
}

// ─── Verify-and-store (shared by the recv thread and the FFI/test path) ─────────

/// Authenticate a beacon and, if valid and not a replay, insert/update the peer.
/// Returns true if the peer table was updated.
fn verify_and_store(
    peer_table: &PeerTable,
    local_fingerprint: [u8; 32],
    frame: &BeaconFrame,
    src: SocketAddr,
) -> bool {
    if !frame.is_authentic() {
        return false;
    }
    if frame.fingerprint == local_fingerprint {
        return false; // ignore our own beacons echoed back
    }

    let now = now_secs();
    let mut table = match peer_table.lock() {
        Ok(t) => t,
        Err(_) => return false,
    };

    match table.get(&frame.fingerprint) {
        Some(existing) => {
            // Anti-replay: accept only if this beacon is strictly newer than the
            // last one we stored, by counter OR by signed timestamp (the latter
            // lets a restarted peer — whose counter resets — be re-learned while
            // a replayed old frame, with an old timestamp, is still rejected).
            let newer =
                frame.counter > existing.last_counter || frame.timestamp > existing.last_seen;
            if !newer {
                return false;
            }
        }
        None => {
            if table.len() >= MAX_PEERS {
                return false; // capacity guard against fingerprint flooding
            }
        }
    }

    table.insert(
        frame.fingerprint,
        DiscoveredPeer {
            device_fingerprint: frame.fingerprint,
            slot_claim_hash: frame.slot_hash,
            last_seen: now,
            last_counter: frame.counter,
            addr: src,
        },
    );
    true
}

// ─── Mesh discovery engine ──────────────────────────────────────────────────────

/// Link-local discovery engine. Holds the shared peer table and (optionally) the
/// local identity needed to emit signed beacons and run the UDP recv/send loops.
pub struct MeshDiscovery {
    peer_table: PeerTable,
    beacon_counter: Arc<AtomicU64>,
    local_identity: Option<Arc<DeviceIdentity>>,
    local_fingerprint: [u8; 32],
    local_slot_id: u64,
    running: Arc<AtomicBool>,
    workers: Mutex<Vec<JoinHandle<()>>>,
}

impl MeshDiscovery {
    /// Construct with only a fingerprint (no networking / signing capability).
    pub fn new(local_fingerprint: [u8; 32], local_slot_id: u64) -> Self {
        Self {
            peer_table: Arc::new(Mutex::new(HashMap::new())),
            beacon_counter: Arc::new(AtomicU64::new(0)),
            local_identity: None,
            local_fingerprint,
            local_slot_id,
            running: Arc::new(AtomicBool::new(false)),
            workers: Mutex::new(Vec::new()),
        }
    }

    /// Construct with a full identity so the engine can sign and broadcast beacons.
    pub fn with_identity(identity: Arc<DeviceIdentity>, local_slot_id: u64) -> Self {
        let local_fingerprint = identity.fingerprint;
        Self {
            peer_table: Arc::new(Mutex::new(HashMap::new())),
            beacon_counter: Arc::new(AtomicU64::new(0)),
            local_identity: Some(identity),
            local_fingerprint,
            local_slot_id,
            running: Arc::new(AtomicBool::new(false)),
            workers: Mutex::new(Vec::new()),
        }
    }

    /// Return a clone of the shared peer table for the auth layer.
    pub fn peer_table(&self) -> PeerTable {
        Arc::clone(&self.peer_table)
    }

    /// Build the next beacon frame (signed if an identity is available).
    pub fn build_beacon(&self) -> Option<BeaconFrame> {
        let identity = self.local_identity.as_ref()?;
        let counter = self.beacon_counter.fetch_add(1, Ordering::SeqCst) + 1;
        Some(build_signed_beacon(identity, self.local_slot_id, counter))
    }

    /// Authenticate and ingest an inbound beacon. Returns true if stored.
    pub fn ingest_beacon(&self, frame: BeaconFrame, src: SocketAddr) -> bool {
        verify_and_store(&self.peer_table, self.local_fingerprint, &frame, src)
    }

    /// Evict peers older than PEER_TTL_SECS (deterministic GC).
    pub fn evict_stale_peers(&self) {
        let now = now_secs();
        if let Ok(mut table) = self.peer_table.lock() {
            table.retain(|_, peer| now.saturating_sub(peer.last_seen) < PEER_TTL_SECS);
        }
    }

    /// Return all currently live (non-stale) peers, sorted deterministically by
    /// device_fingerprint so iteration order is reproducible across runs
    /// regardless of HashMap's internal bucket layout.
    pub fn query_live_peers(&self) -> Vec<DiscoveredPeer> {
        self.evict_stale_peers();
        if let Ok(table) = self.peer_table.lock() {
            let mut peers: Vec<DiscoveredPeer> = table.values().cloned().collect();
            peers.sort_unstable_by_key(|p| p.device_fingerprint);
            peers
        } else {
            Vec::new()
        }
    }

    /// Start the real UDP multicast discovery loops (recv + periodic broadcast).
    /// Requires an identity (constructed via `with_identity`). Idempotent.
    pub fn start(&self) -> io::Result<()> {
        let identity = match self.local_identity.as_ref() {
            Some(id) => Arc::clone(id),
            None => {
                return Err(io::Error::other(
                    "discovery has no identity; cannot emit signed beacons",
                ))
            }
        };
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(()); // already running
        }

        let socket = match Self::bind_multicast() {
            Ok(s) => s,
            Err(e) => {
                self.running.store(false, Ordering::SeqCst);
                return Err(e);
            }
        };
        let recv_sock = socket.try_clone()?;

        // ── Receiver loop ──────────────────────────────────────────────────────
        let peer_table = Arc::clone(&self.peer_table);
        let running_rx = Arc::clone(&self.running);
        let local_fp = self.local_fingerprint;
        let rx = thread::spawn(move || {
            let mut buf = [0u8; RECV_BUF_LEN];
            while running_rx.load(Ordering::SeqCst) {
                match recv_sock.recv_from(&mut buf) {
                    Ok((n, src)) => {
                        if let Some(frame) = decode_beacon(&buf[..n]) {
                            verify_and_store(&peer_table, local_fp, &frame, src);
                        }
                    }
                    Err(ref e)
                        if e.kind() == io::ErrorKind::WouldBlock
                            || e.kind() == io::ErrorKind::TimedOut => {}
                    Err(_) => {
                        // Transient socket error; back off briefly and keep going.
                        thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        });

        // ── Sender loop ────────────────────────────────────────────────────────
        let counter = Arc::clone(&self.beacon_counter);
        let running_tx = Arc::clone(&self.running);
        let slot_id = self.local_slot_id;
        let send_addr = SocketAddr::from((MESH_MULTICAST_ADDR, MESH_DISCOVERY_PORT));
        let tx = thread::spawn(move || {
            while running_tx.load(Ordering::SeqCst) {
                let c = counter.fetch_add(1, Ordering::SeqCst) + 1;
                let frame = build_signed_beacon(&identity, slot_id, c);
                let bytes = encode_beacon(&frame);
                let _ = socket.send_to(&bytes, send_addr);
                thread::sleep(BEACON_INTERVAL);
            }
        });

        if let Ok(mut workers) = self.workers.lock() {
            workers.push(rx);
            workers.push(tx);
        }
        Ok(())
    }

    /// Stop the discovery loops and join the worker threads.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        let handles: Vec<JoinHandle<()>> = match self.workers.lock() {
            Ok(mut w) => w.drain(..).collect(),
            Err(_) => Vec::new(),
        };
        for h in handles {
            let _ = h.join();
        }
    }

    fn bind_multicast() -> io::Result<UdpSocket> {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, MESH_DISCOVERY_PORT))?;
        socket.join_multicast_v4(&MESH_MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED)?;
        socket.set_multicast_loop_v4(false).ok();
        socket.set_read_timeout(Some(Duration::from_millis(500)))?;
        Ok(socket)
    }
}

impl Drop for MeshDiscovery {
    fn drop(&mut self) {
        self.stop();
    }
}

// ─── Intel Feed: field crisis data bridge into the C++ Intel-Core ───────────────

/// An intelligence report injected from a field device into the C++ Intel-Core.
/// `repr(C)` keeps the layout stable across the Rust/C++ ABI boundary.
#[repr(C)]
#[derive(Debug, Clone)]
pub struct IntelFeedPacket {
    /// The mesh session this packet arrived on (tamper evidence).
    pub session_id: u64,
    /// Source device fingerprint (Blake3 of verifying key).
    pub source_fingerprint: [u8; 32],
    /// Field friction coefficient, validated to [0, 1_000_000] (= 0.0–1.0 * 1e6).
    pub friction_coefficient_fp: u32,
    /// Crisis severity, validated to 0..=3 (0=NOMINAL,1=ELEVATED,2=HIGH,3=CRITICAL).
    pub crisis_level: u8,
    /// Free-form ASCII memo (≤127 bytes + NUL), bounded-copied from the wire.
    pub memo: [u8; 128],
    /// UNIX timestamp (seconds) when the observation was recorded.
    pub observed_at: u64,
}

/// Upper bound for the fixed-point friction coefficient (1.0 * 1_000_000).
pub const FRICTION_FP_MAX: u32 = 1_000_000;
/// Highest valid crisis level.
pub const CRISIS_LEVEL_MAX: u8 = 3;

impl IntelFeedPacket {
    pub fn friction_coefficient(&self) -> f64 {
        self.friction_coefficient_fp as f64 / 1_000_000.0
    }

    pub fn memo_str(&self) -> &str {
        let end = self
            .memo
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(self.memo.len());
        std::str::from_utf8(&self.memo[..end]).unwrap_or("<invalid utf8>")
    }
}

use std::collections::VecDeque;

/// Bounded queue of pending field intel packets.
pub struct IntelFeedQueue {
    queue: Mutex<VecDeque<IntelFeedPacket>>,
    capacity: usize,
}

impl IntelFeedQueue {
    pub fn new() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            capacity: 1024,
        }
    }

    /// Enqueue a packet, dropping the oldest if the queue is full (bounded memory).
    pub fn push(&self, pkt: IntelFeedPacket) {
        if let Ok(mut q) = self.queue.lock() {
            if q.len() >= self.capacity {
                q.pop_front();
            }
            q.push_back(pkt);
        }
    }

    pub fn pop(&self) -> Option<IntelFeedPacket> {
        self.queue.lock().ok()?.pop_front()
    }
}

impl Default for IntelFeedQueue {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Combined discovery + intel context (owned by C++ via opaque pointer) ───────

pub struct CaelusDiscoveryCtx {
    pub discovery: MeshDiscovery,
    pub intel_queue: IntelFeedQueue,
}

impl CaelusDiscoveryCtx {
    pub fn new(identity: Arc<DeviceIdentity>, local_slot_id: u64) -> Self {
        Self {
            discovery: MeshDiscovery::with_identity(identity, local_slot_id),
            intel_queue: IntelFeedQueue::new(),
        }
    }
}

// ─── FFI guard helpers ──────────────────────────────────────────────────────────

fn ffi_guard_u8<F: FnOnce() -> u8>(f: F) -> u8 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(0)
}

fn ffi_guard_usize<F: FnOnce() -> usize>(f: F) -> usize {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(0)
}

fn ffi_guard_ptr<T, F: FnOnce() -> *mut T>(f: F) -> *mut T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(std::ptr::null_mut())
}

// ─── FFI: discovery lifecycle ───────────────────────────────────────────────────

/// Allocate a combined discovery + intel context bound to a device identity.
/// The identity is cloned into the context (so the caller may free its own handle
/// independently). Returns NULL on error. Pair with caelus_discovery_free().
#[no_mangle]
pub extern "C" fn caelus_discovery_new(
    identity: *const CaelusIdentityHandle,
    local_slot_id: u64,
) -> *mut CaelusDiscoveryCtx {
    ffi_guard_ptr(|| {
        if identity.is_null() {
            return std::ptr::null_mut();
        }
        // SAFETY: caller guarantees `identity` is a live handle from caelus_identity_new.
        let id_ref = unsafe { (*identity).identity() };
        let id_arc = Arc::new(id_ref.clone());
        Box::into_raw(Box::new(CaelusDiscoveryCtx::new(id_arc, local_slot_id)))
    })
}

/// Start the real UDP multicast discovery loops. Returns 1 on success, 0 on error
/// (e.g. the discovery port is busy or no network interface is available — the
/// rest of the system keeps working in that case).
#[no_mangle]
pub extern "C" fn caelus_discovery_start(ctx: *mut CaelusDiscoveryCtx) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() {
            return 0;
        }
        let ctx_ref = unsafe { &*ctx };
        match ctx_ref.discovery.start() {
            Ok(()) => 1,
            Err(_) => 0,
        }
    })
}

/// Stop the discovery loops. Always safe; NULL is a no-op.
#[no_mangle]
pub extern "C" fn caelus_discovery_stop(ctx: *mut CaelusDiscoveryCtx) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() {
            return 0;
        }
        let ctx_ref = unsafe { &*ctx };
        ctx_ref.discovery.stop();
        1
    })
}

/// Free a discovery context (stops the loops first). NULL is a safe no-op.
#[no_mangle]
pub extern "C" fn caelus_discovery_free(ctx: *mut CaelusDiscoveryCtx) {
    if ctx.is_null() {
        return;
    }
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // SAFETY: ctx was produced by caelus_discovery_new, freed exactly once.
        let boxed = unsafe { Box::from_raw(ctx) };
        boxed.discovery.stop();
        drop(boxed);
    }));
}

/// Fetch up to `max_peers` fingerprints (32 bytes each) from the peer table.
/// Returns the number of peers written. `out_fingerprints` must be ≥ max_peers*32.
#[no_mangle]
pub extern "C" fn caelus_fetch_nearby_peers(
    ctx: *const CaelusDiscoveryCtx,
    out_fingerprints: *mut u8,
    max_peers: usize,
) -> usize {
    ffi_guard_usize(|| {
        if ctx.is_null() || out_fingerprints.is_null() || max_peers == 0 {
            return 0;
        }
        let ctx_ref = unsafe { &*ctx };
        let peers = ctx_ref.discovery.query_live_peers();
        let count = peers.len().min(max_peers);
        for (i, peer) in peers.iter().take(count).enumerate() {
            // SAFETY: out_fingerprints has space for max_peers*32 bytes (caller contract).
            unsafe {
                std::ptr::copy_nonoverlapping(
                    peer.device_fingerprint.as_ptr(),
                    out_fingerprints.add(i * 32),
                    32,
                );
            }
        }
        count
    })
}

// ─── FFI: field intel injection (Rust → C++ Intel-Core bridge) ──────────────────

/// Inject a field crisis report into the intel queue.
///
/// `memo` / `memo_len` are a bounded buffer (NOT assumed NUL-terminated): at most
/// `min(memo_len, 127)` bytes are copied, stopping early at the first NUL. This
/// removes the previous unbounded `CStr::from_ptr` strlen over untrusted data.
/// `friction_fp` is clamped to [0, 1_000_000] and `crisis_level` to 0..=3.
/// Returns 1 on success, 0 on error.
#[no_mangle]
pub extern "C" fn caelus_inject_intel_packet(
    ctx: *mut CaelusDiscoveryCtx,
    session_id: u64,
    source_fp: *const u8, // [u8; 32]
    friction_fp: u32,
    crisis_level: u8,
    memo: *const u8,
    memo_len: usize,
) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() || source_fp.is_null() {
            return 0;
        }

        // SAFETY: caller guarantees source_fp points to ≥32 readable bytes.
        let fp_slice = unsafe { std::slice::from_raw_parts(source_fp, 32) };
        let mut source_fingerprint = [0u8; 32];
        source_fingerprint.copy_from_slice(fp_slice);

        let mut memo_buf = [0u8; 128];
        if !memo.is_null() && memo_len > 0 {
            let len = memo_len.min(127);
            // SAFETY: caller guarantees `memo` is readable for `memo_len` bytes.
            let src = unsafe { std::slice::from_raw_parts(memo, len) };
            let copy_len = src.iter().position(|&b| b == 0).unwrap_or(len);
            memo_buf[..copy_len].copy_from_slice(&src[..copy_len]);
        }

        let pkt = IntelFeedPacket {
            session_id,
            source_fingerprint,
            friction_coefficient_fp: friction_fp.min(FRICTION_FP_MAX),
            crisis_level: crisis_level.min(CRISIS_LEVEL_MAX),
            memo: memo_buf,
            observed_at: now_secs(),
        };

        let ctx_ref = unsafe { &*ctx };
        ctx_ref.intel_queue.push(pkt);
        1
    })
}

/// Drain the next IntelFeedPacket into a caller-allocated buffer.
/// Returns 1 if a packet was written, 0 if the queue is empty.
#[no_mangle]
pub extern "C" fn caelus_fetch_intel_feed(
    ctx: *mut CaelusDiscoveryCtx,
    out_pkt: *mut IntelFeedPacket,
) -> u8 {
    ffi_guard_u8(|| {
        if ctx.is_null() || out_pkt.is_null() {
            return 0;
        }
        let ctx_ref = unsafe { &*ctx };
        match ctx_ref.intel_queue.pop() {
            Some(pkt) => {
                // SAFETY: out_pkt points to a caller-allocated IntelFeedPacket.
                unsafe { std::ptr::write(out_pkt, pkt) };
                1
            }
            None => 0,
        }
    })
}

// ─── Virtual clock FFI surface (C++ accessible) ───────────────────────────────

/// Freeze the Rust clock at `tick_secs` for deterministic testing.
///
/// After this call every `now_secs()` invocation in the discovery layer returns
/// `tick_secs` until `caelus_clock_use_real()` is called.  Beacon timestamps,
/// peer TTLs and freshness windows all use this fixed value, making CI output
/// fully reproducible regardless of wall-clock time.
///
/// Call this before starting the discovery loops (before
/// `caelus_discovery_start`) if you want discovery to behave deterministically.
#[no_mangle]
pub extern "C" fn caelus_clock_set_virtual(tick_secs: u64) {
    VIRTUAL_TICK_SECS.store(tick_secs, Ordering::SeqCst);
    VIRTUAL_CLOCK_ENABLED.store(true, Ordering::SeqCst);
}

/// Restore the real wall-clock.
/// Call after a deterministic test run to return to production behaviour.
#[no_mangle]
pub extern "C" fn caelus_clock_use_real() {
    VIRTUAL_CLOCK_ENABLED.store(false, Ordering::SeqCst);
}

/// Public clock accessor — returns virtual tick when enabled, wall-clock otherwise.
/// Used by `crate::audit_log` and any module that needs clock-aware timestamps
/// without depending on the private `now_secs()` function directly.
pub fn current_secs() -> u64 {
    now_secs()
}

// ─── Unit tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::mesh_auth::DeviceIdentity;

    fn loopback() -> SocketAddr {
        "127.0.0.1:47808".parse().unwrap()
    }

    #[test]
    fn signed_beacon_roundtrips_and_verifies() {
        let id = DeviceIdentity::generate();
        let frame = build_signed_beacon(&id, 0x2026_0607_0001, 1);
        let bytes = encode_beacon(&frame);
        let decoded = decode_beacon(&bytes).expect("decode");
        assert!(decoded.is_authentic(), "genuine signed beacon must verify");
    }

    #[test]
    fn tampered_beacon_is_rejected() {
        let id = DeviceIdentity::generate();
        let mut frame = build_signed_beacon(&id, 7, 1);
        frame.slot_hash[0] ^= 0xFF; // tamper after signing
        assert!(
            !frame.is_authentic(),
            "tampered beacon must fail verification"
        );
    }

    #[test]
    fn spoofed_fingerprint_is_rejected() {
        let id = DeviceIdentity::generate();
        let mut frame = build_signed_beacon(&id, 7, 1);
        frame.fingerprint[0] ^= 0xFF; // claim a different fingerprint than the key
        assert!(
            !frame.is_authentic(),
            "fingerprint not matching key must be rejected"
        );
    }

    #[test]
    fn replayed_beacon_does_not_double_store() {
        let local = DeviceIdentity::generate();
        let disc = MeshDiscovery::with_identity(Arc::new(local), 99);
        let peer = DeviceIdentity::generate();

        let frame = build_signed_beacon(&peer, 42, 5);
        assert!(
            disc.ingest_beacon(frame.clone(), loopback()),
            "first sighting stored"
        );
        // Exact replay (same counter, same timestamp) must be rejected.
        assert!(
            !disc.ingest_beacon(frame, loopback()),
            "replay must be rejected"
        );
        assert_eq!(disc.query_live_peers().len(), 1);
    }

    #[test]
    fn peer_table_is_capacity_bounded() {
        let local = DeviceIdentity::generate();
        let disc = MeshDiscovery::with_identity(Arc::new(local), 1);
        // Flood with far more unique fingerprints than MAX_PEERS.
        for i in 0..(MAX_PEERS + 50) {
            let peer = DeviceIdentity::generate();
            let frame = build_signed_beacon(&peer, i as u64, 1);
            disc.ingest_beacon(frame, loopback());
        }
        assert!(
            disc.query_live_peers().len() <= MAX_PEERS,
            "table must be bounded"
        );
    }

    #[test]
    fn friction_and_crisis_are_clamped() {
        let id = DeviceIdentity::generate();
        let ctx = Box::into_raw(Box::new(CaelusDiscoveryCtx::new(Arc::new(id), 1)));
        let fp = [0xABu8; 32];
        let memo = b"STRIKE";
        let ok = caelus_inject_intel_packet(
            ctx,
            0xCAFE,
            fp.as_ptr(),
            u32::MAX, // absurd friction
            250,      // absurd crisis level
            memo.as_ptr(),
            memo.len(),
        );
        assert_eq!(ok, 1);
        let mut out = IntelFeedPacket {
            session_id: 0,
            source_fingerprint: [0; 32],
            friction_coefficient_fp: 0,
            crisis_level: 0,
            memo: [0; 128],
            observed_at: 0,
        };
        assert_eq!(caelus_fetch_intel_feed(ctx, &mut out as *mut _), 1);
        assert_eq!(
            out.friction_coefficient_fp, FRICTION_FP_MAX,
            "friction clamped"
        );
        assert_eq!(out.crisis_level, CRISIS_LEVEL_MAX, "crisis clamped");
        assert_eq!(out.memo_str(), "STRIKE");
        caelus_discovery_free(ctx);
    }

    #[test]
    fn memo_without_nul_is_bounded() {
        let id = DeviceIdentity::generate();
        let ctx = Box::into_raw(Box::new(CaelusDiscoveryCtx::new(Arc::new(id), 1)));
        let fp = [0u8; 32];
        // A 200-byte buffer with NO NUL terminator — must not over-read.
        let memo = vec![b'A'; 200];
        let ok =
            caelus_inject_intel_packet(ctx, 1, fp.as_ptr(), 500_000, 1, memo.as_ptr(), memo.len());
        assert_eq!(ok, 1);
        let mut out = IntelFeedPacket {
            session_id: 0,
            source_fingerprint: [0; 32],
            friction_coefficient_fp: 0,
            crisis_level: 0,
            memo: [0; 128],
            observed_at: 0,
        };
        assert_eq!(caelus_fetch_intel_feed(ctx, &mut out as *mut _), 1);
        assert_eq!(out.memo_str().len(), 127, "memo bounded to 127 bytes");
        caelus_discovery_free(ctx);
    }

    #[test]
    fn slot_hash_verifies_within_window() {
        let fp = [0x11u8; 32];
        let h = compute_slot_hash(&fp, 12345);
        assert!(verify_slot_hash(&fp, &h, 12345));
        assert!(!verify_slot_hash(&fp, &h, 9999), "wrong slot id must fail");
    }
}
