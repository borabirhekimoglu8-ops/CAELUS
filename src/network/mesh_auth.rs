// CAELUS OS — Shadow-Mesh Cryptographic Authentication Layer
// Universal autonomous handshake: Actor_Alpha ↔ Actor_Beta
//
// Protocol design (two-phase, forward-secret, transcript-bound)
// ─────────────────────────────────────────────────────────────
//  Phase 1 — build_challenge()        [INITIATOR]
//    Ephemeral X25519 keypair + CSPRNG nonce.
//    Signs DOMAIN || init_vk || init_dh || init_nonce || init_slot_hash.
//
//  Phase 2 — handle_incoming_challenge()  [RESPONDER]
//    Verifies the initiator signature.
//    Ephemeral X25519 keypair + nonce.
//    Signs DOMAIN || init_vk || init_dh || init_nonce ||
//          resp_vk || resp_dh || resp_nonce || resp_slot_hash   (binds the
//    response to *this* challenge → no cross-session replay/relay of a response).
//
//  Phase 3 — complete_handshake()     [INITIATOR]
//    Verifies the responder signature (rebuilding the same transcript).
//    Computes X25519 DH; REJECTS non-contributory (small-order) exchanges.
//    Blake3 KDF binds: both verifying keys, both slot hashes, both nonces.
//    REQUIRES the responder's ZK slot claim to verify — otherwise the handshake
//    FAILS (authorization is enforced, not merely reported).
//
//  ZERO INTERNET: no DNS, no HTTP, no external sockets anywhere in this file.

use std::ffi::c_void;
use std::fs;
use std::io;
use std::path::Path;
use std::sync::Mutex;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use rand::RngCore;
use x25519_dalek::{EphemeralSecret, PublicKey as X25519Public};

use crate::network::discovery::{compute_slot_hash, verify_slot_hash};

// ─── Domain-separation contexts (prevent cross-protocol signature reuse) ────────
const CTX_CHALLENGE: &[u8] = b"CAELUS_MESH_CHALLENGE_V1";
const CTX_RESPONSE: &[u8] = b"CAELUS_MESH_RESPONSE_V1";
const CTX_SESSION_KEY: &[u8] = b"CAELUS_MESH_SESSION_KEY_V1";
const CTX_SESSION_ID: &[u8] = b"CAELUS_MESH_SESSION_ID_V1";

// ─── Public wire types (repr(C) for C++ FFI) ──────────────────────────────────

/// 32-byte device fingerprint = Blake3(ed25519_verifying_key_bytes).
pub type DeviceFingerprint = [u8; 32];

/// Operational OTP Slot Claim. Only `slot_claim_hash` is transmitted.
#[derive(Debug, Clone)]
pub struct OtpSlotClaim {
    pub slot_id: u64,
    pub slot_claim_hash: [u8; 32],
}

impl OtpSlotClaim {
    pub fn new(fingerprint: &DeviceFingerprint, slot_id: u64) -> Self {
        let slot_claim_hash = compute_slot_hash(fingerprint, slot_id);
        Self {
            slot_id,
            slot_claim_hash,
        }
    }
}

/// Phase 1 → Phase 2: Initiator challenge (no secrets on the wire).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ChallengeMessage {
    pub verifying_key: [u8; 32],
    pub dh_public: [u8; 32],
    pub nonce: [u8; 32],
    pub slot_claim_hash: [u8; 32],
    pub signature: [u8; 64],
}

/// Phase 2 → Phase 3: Responder response.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ResponseMessage {
    pub verifying_key: [u8; 32],
    pub dh_public: [u8; 32],
    pub nonce_response: [u8; 32],
    pub slot_claim_hash: [u8; 32],
    pub signature: [u8; 64],
    pub accepted: bool,
}

/// Fully established session context returned after Phase 3.
#[repr(C)]
pub struct MeshSession {
    pub session_id: u64,
    pub shared_key: [u8; 32],
    pub peer_fingerprint: [u8; 32],
    pub slot_verified: bool,
}

/// Ephemeral initiator state (held between Phase 1 and Phase 3). Non-Copy/Clone:
/// the ephemeral DH secret must never be duplicated.
pub struct EphemeralState {
    dh_secret: EphemeralSecret,
    pub nonce: [u8; 32],
    pub challenge: ChallengeMessage,
}

// ─── Device Identity ────────────────────────────────────────────────────────────

/// Long-term device identity.
///
/// `load_or_generate` persists the secret seed so a device keeps a STABLE
/// fingerprint across reboots (required by the pre-distributed slot manifest).
/// Windows persists the seed as a DPAPI-protected blob. Non-Windows builds do
/// not write plaintext identity files; use `CAELUS_IDENTITY_KEY_HEX` until a TPM
/// backend is wired in.
#[derive(Clone)]
pub struct DeviceIdentity {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub fingerprint: DeviceFingerprint,
}

const KEY_FILE_MAGIC: &[u8] = b"CAELUSKEY1\0";
const KEY_FILE_SCHEME_WIN_DPAPI: &[u8] = b"WIN-DPAPI\0";
/// Container scheme tag for a seed wrapped by a registered KEYMGMT plugin.
const KEY_FILE_SCHEME_KEYMGMT_PLUGIN: &[u8] = b"KEYMGMT-PLUGIN\0";

// ─── KEYMGMT plugin seam (T-23 KEYMGMT-WIRE) ──────────────────────────────────
//
// The real key-management backend (HSM / TPM / sealed enclave / DPAPI provider)
// lives on the C++ plugin side behind the `CaelusKeyBlob` + `protect_key` /
// `unprotect_key` ABI (include/plugin/caelus_plugin_abi.h). Rust cannot reach the
// C++ registry directly, so this module exposes a thin C-ABI *delegate*: the C++
// side REGISTERS two function pointers (plus an opaque state pointer) and seed
// protection is DELEGATED to them. When nothing is registered (no plugin) the
// built-in DPAPI (Windows) / env (POSIX) path below runs bit-for-bit unchanged.
//
// Failure policy (air-gapped / tamper-evident):
//   * Plugin ABSENT                      → built-in fallback (normal w/o plugin).
//   * Plugin PRESENT but protect FAILS   → HARD ERROR. Never silently downgrade
//                                          to a weaker / forbidden scheme.
//   * Plugin PRESENT but unprotect FAILS → HARD ERROR. Never silently mint a new
//                                          identity — that would change the device
//                                          fingerprint and break the
//                                          pre-distributed slot manifest.

/// Success code for the KEYMGMT callback ABI. Any other value means failure.
pub const CAELUS_KEYMGMT_OK: u8 = 1;

/// `CaelusKeyBlob::format` tags, mirroring include/plugin/caelus_plugin_abi.h.
pub const CAELUS_KEY_BLOB_RAW_SEED: u32 = 0x0000_0001;
pub const CAELUS_KEY_BLOB_PROTECTED_OS: u32 = 0x0000_0002;
pub const CAELUS_KEY_BLOB_PROTECTED_TPM: u32 = 0x0000_0003;
pub const CAELUS_KEY_BLOB_PROTECTED_PLUGIN: u32 = 0x0000_0004;

/// Upper bound for a wrapped 32-byte seed. The provider MUST fail rather than
/// write more than this many bytes into an output blob.
const KEYMGMT_MAX_BLOB: usize = 4096;

/// Bounded, caller-owned key buffer — the `repr(C)` mirror of the C++
/// `CaelusKeyBlob` (data / len / capacity / format / flags). For input blobs
/// `data` points to `len` readable bytes; for output blobs the caller sets
/// `capacity` and the provider writes `len` (≤ capacity) bytes.
#[repr(C)]
pub struct CaelusKeyBlob {
    pub data: *mut u8,
    pub len: usize,
    pub capacity: usize,
    pub format: u32,
    pub flags: u32,
}

/// KEYMGMT protect callback (C ABI) — identical in shape to the C++ vtable's
/// `protect_key(void* state, const CaelusKeyBlob* in, CaelusKeyBlob* out)`.
/// Returns `CAELUS_KEYMGMT_OK` on success, anything else on failure.
pub type CaelusKeyProtectFn = unsafe extern "C" fn(
    state: *mut c_void,
    plaintext: *const CaelusKeyBlob,
    protected_out: *mut CaelusKeyBlob,
) -> u8;

/// KEYMGMT unprotect callback (C ABI) — mirrors the C++ vtable's `unprotect_key`.
pub type CaelusKeyUnprotectFn = unsafe extern "C" fn(
    state: *mut c_void,
    protected_in: *const CaelusKeyBlob,
    plaintext_out: *mut CaelusKeyBlob,
) -> u8;

/// A registered KEYMGMT delegate: the two provider callbacks plus the opaque
/// state pointer threaded back into each call.
#[derive(Clone, Copy)]
struct KeymgmtDelegate {
    protect: CaelusKeyProtectFn,
    unprotect: CaelusKeyUnprotectFn,
    state: *mut c_void,
}

// SAFETY: the delegate stores only C function pointers (already Send + Sync) and
// an opaque `state` pointer that Rust never dereferences. The registrant (the
// C++ plugin/registry) guarantees `state` outlives the registration and that the
// callbacks are safe to invoke from the thread performing identity persistence.
unsafe impl Send for KeymgmtDelegate {}
unsafe impl Sync for KeymgmtDelegate {}

impl KeymgmtDelegate {
    /// Wrap a 32-byte seed via the plugin. The returned container payload is
    /// `format:u32 (LE) || provider_blob`, so the exact `CaelusKeyBlob::format`
    /// round-trips back into `unprotect`.
    fn protect(&self, seed: &[u8; 32]) -> io::Result<Vec<u8>> {
        let mut out_buf = vec![0u8; KEYMGMT_MAX_BLOB];
        let input = CaelusKeyBlob {
            data: seed.as_ptr() as *mut u8,
            len: seed.len(),
            capacity: seed.len(),
            format: CAELUS_KEY_BLOB_RAW_SEED,
            flags: 0,
        };
        let mut output = CaelusKeyBlob {
            data: out_buf.as_mut_ptr(),
            len: 0,
            capacity: out_buf.len(),
            format: 0,
            flags: 0,
        };
        // SAFETY: both blobs describe valid, non-overlapping buffers; the ABI
        // forbids the provider from writing past `output.capacity` or retaining
        // the pointers after the call returns.
        let rc = unsafe { (self.protect)(self.state, &input, &mut output) };
        if rc != CAELUS_KEYMGMT_OK {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "KEYMGMT plugin protect_key failed",
            ));
        }
        if output.len == 0 || output.len > out_buf.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "KEYMGMT plugin reported an out-of-range protected length",
            ));
        }
        let mut payload = Vec::with_capacity(4 + output.len);
        payload.extend_from_slice(&output.format.to_le_bytes());
        payload.extend_from_slice(&out_buf[..output.len]);
        Ok(payload)
    }

    /// Recover a 32-byte seed from a container payload produced by `protect`.
    fn unprotect(&self, payload: &[u8]) -> io::Result<[u8; 32]> {
        if payload.len() < 4 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "KEYMGMT container missing format header",
            ));
        }
        let format = u32::from_le_bytes(
            payload[..4]
                .try_into()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad format header"))?,
        );
        let protected = &payload[4..];
        let mut seed_buf = [0u8; 32];
        let input = CaelusKeyBlob {
            data: protected.as_ptr() as *mut u8,
            len: protected.len(),
            capacity: protected.len(),
            format,
            flags: 0,
        };
        let mut output = CaelusKeyBlob {
            data: seed_buf.as_mut_ptr(),
            len: 0,
            capacity: seed_buf.len(),
            format: CAELUS_KEY_BLOB_RAW_SEED,
            flags: 0,
        };
        // SAFETY: see `protect`. The recovered seed must be exactly 32 bytes.
        let rc = unsafe { (self.unprotect)(self.state, &input, &mut output) };
        if rc != CAELUS_KEYMGMT_OK {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "KEYMGMT plugin unprotect_key failed",
            ));
        }
        if output.len != seed_buf.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "KEYMGMT plugin returned a non-32-byte seed",
            ));
        }
        Ok(seed_buf)
    }
}

/// Process-wide KEYMGMT delegate. `None` ⇒ no plugin ⇒ built-in fallback.
static KEYMGMT_DELEGATE: Mutex<Option<KeymgmtDelegate>> = Mutex::new(None);

/// Snapshot the registered delegate (copied out so the lock is never held across
/// the FFI call into the plugin).
fn keymgmt_delegate() -> Option<KeymgmtDelegate> {
    match KEYMGMT_DELEGATE.lock() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    }
}

/// Register (or clear) the KEYMGMT delegate. Intended to be called by the C++
/// plugin/registry layer once a KEYMGMT provider is active.
///
/// * both callbacks non-NULL → install the delegate; identity persistence and
///   loading are delegated to the plugin on every platform.
/// * both callbacks NULL     → clear the delegate, reverting to the built-in
///   DPAPI (Windows) / env (POSIX) fallback.
/// * exactly one NULL        → rejected (returns 0); registration is all-or-nothing.
///
/// `state` is opaque to Rust (e.g. the PluginRegistry instance) and is passed
/// back verbatim as the first argument of each callback. Returns
/// `CAELUS_KEYMGMT_OK` (1) on success, 0 otherwise.
#[no_mangle]
pub extern "C" fn caelus_keymgmt_register(
    protect_fn: Option<CaelusKeyProtectFn>,
    unprotect_fn: Option<CaelusKeyUnprotectFn>,
    state: *mut c_void,
) -> u8 {
    ffi_guard_u8(|| {
        let mut guard = match KEYMGMT_DELEGATE.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        match (protect_fn, unprotect_fn) {
            (Some(protect), Some(unprotect)) => {
                *guard = Some(KeymgmtDelegate {
                    protect,
                    unprotect,
                    state,
                });
                CAELUS_KEYMGMT_OK
            }
            (None, None) => {
                *guard = None;
                CAELUS_KEYMGMT_OK
            }
            _ => 0,
        }
    })
}

impl DeviceIdentity {
    /// Generate a fresh identity (CSPRNG).
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let fingerprint = fingerprint_of(&verifying_key);
        Self {
            signing_key,
            verifying_key,
            fingerprint,
        }
    }

    /// Load a persisted identity from `path`, or generate + persist a new one.
    ///
    /// When a KEYMGMT plugin delegate is registered it owns seed protection on
    /// every platform; otherwise the built-in DPAPI (Windows) / env (POSIX) path
    /// below runs unchanged.
    pub fn load_or_generate(path: &Path) -> io::Result<Self> {
        if let Some(delegate) = keymgmt_delegate() {
            return Self::load_or_generate_with_delegate(path, &delegate);
        }

        #[cfg(windows)]
        {
            if let Ok(bytes) = fs::read(path) {
                if let Some(blob) = read_key_blob(&bytes, KEY_FILE_SCHEME_WIN_DPAPI) {
                    let seed = dpapi_unprotect_seed(blob)?;
                    return Ok(Self::from_seed(&seed));
                }
                if bytes.len() == 32 {
                    let mut seed = [0u8; 32];
                    seed.copy_from_slice(&bytes);
                    let identity = Self::from_seed(&seed);
                    identity.persist(path)?;
                    return Ok(identity);
                }
            }
            let identity = Self::generate();
            identity.persist(path)?;
            return Ok(identity);
        }

        #[cfg(not(windows))]
        {
            if let Ok(hex) = std::env::var("CAELUS_IDENTITY_KEY_HEX") {
                let seed = seed_from_hex(&hex)?;
                return Ok(Self::from_seed(&seed));
            }
            if std::env::var("CAELUS_TPM_KEY_HANDLE").is_ok() {
                eprintln!(
                    "[KEYMGMT] CAELUS_TPM_KEY_HANDLE mevcut, ancak TPM backend bu build'de stub."
                );
            }
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "plaintext identity persist disabled; set CAELUS_IDENTITY_KEY_HEX",
            ));
        }
    }

    /// KEYMGMT-delegated load path (used only when a delegate is registered).
    ///
    /// Loading dispatches on the on-disk scheme tag, so an identity created by an
    /// earlier build still loads: a plugin container is unwrapped by the delegate
    /// and (on Windows) a pre-existing DPAPI blob or a legacy 32-byte plaintext
    /// seed are still honored. A *present* delegate that fails to unprotect a
    /// plugin container is a HARD ERROR — we never regenerate, which would
    /// silently change the device fingerprint.
    fn load_or_generate_with_delegate(path: &Path, delegate: &KeymgmtDelegate) -> io::Result<Self> {
        if let Ok(bytes) = fs::read(path) {
            if let Some(blob) = read_key_blob(&bytes, KEY_FILE_SCHEME_KEYMGMT_PLUGIN) {
                let seed = delegate.unprotect(blob)?;
                return Ok(Self::from_seed(&seed));
            }
            #[cfg(windows)]
            {
                if let Some(blob) = read_key_blob(&bytes, KEY_FILE_SCHEME_WIN_DPAPI) {
                    let seed = dpapi_unprotect_seed(blob)?;
                    return Ok(Self::from_seed(&seed));
                }
                if bytes.len() == 32 {
                    let mut seed = [0u8; 32];
                    seed.copy_from_slice(&bytes);
                    let identity = Self::from_seed(&seed);
                    identity.persist(path)?;
                    return Ok(identity);
                }
            }
        }
        let identity = Self::generate();
        identity.persist(path)?;
        Ok(identity)
    }

    fn from_seed(seed: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(seed);
        let verifying_key = signing_key.verifying_key();
        let fingerprint = fingerprint_of(&verifying_key);
        Self {
            signing_key,
            verifying_key,
            fingerprint,
        }
    }

    fn persist(&self, path: &Path) -> io::Result<()> {
        // KEYMGMT plugin seam: a registered delegate wraps the seed on every
        // platform. A protect failure is FATAL — we never quietly downgrade to a
        // weaker built-in scheme behind the operator's back.
        if let Some(delegate) = keymgmt_delegate() {
            let seed = self.signing_key.to_bytes();
            let protected = delegate.protect(&seed)?;
            fs::write(
                path,
                build_key_blob(KEY_FILE_SCHEME_KEYMGMT_PLUGIN, &protected),
            )?;
            return Ok(());
        }

        #[cfg(windows)]
        {
            let seed = self.signing_key.to_bytes();
            let protected = dpapi_protect_seed(&seed)?;
            fs::write(path, build_key_blob(KEY_FILE_SCHEME_WIN_DPAPI, &protected))?;
            Ok(())
        }

        #[cfg(not(windows))]
        {
            let _ = path;
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "plaintext identity persist disabled on this platform",
            ))
        }
    }

    pub fn sign(&self, msg: &[u8]) -> Signature {
        self.signing_key.sign(msg)
    }

    pub fn verify(&self, msg: &[u8], sig: &Signature) -> bool {
        self.verifying_key.verify(msg, sig).is_ok()
    }
}

fn build_key_blob(scheme: &[u8], protected_blob: &[u8]) -> Vec<u8> {
    let blob_len = u32::try_from(protected_blob.len()).unwrap_or(u32::MAX);
    let mut out =
        Vec::with_capacity(KEY_FILE_MAGIC.len() + scheme.len() + 4 + protected_blob.len());
    out.extend_from_slice(KEY_FILE_MAGIC);
    out.extend_from_slice(scheme);
    out.extend_from_slice(&blob_len.to_le_bytes());
    out.extend_from_slice(protected_blob);
    out
}

fn read_key_blob<'a>(bytes: &'a [u8], scheme: &[u8]) -> Option<&'a [u8]> {
    let header_len = KEY_FILE_MAGIC.len() + scheme.len() + 4;
    if bytes.len() < header_len {
        return None;
    }
    if !bytes.starts_with(KEY_FILE_MAGIC) {
        return None;
    }
    let scheme_start = KEY_FILE_MAGIC.len();
    if &bytes[scheme_start..scheme_start + scheme.len()] != scheme {
        return None;
    }
    let len_start = scheme_start + scheme.len();
    let blob_len = u32::from_le_bytes(bytes[len_start..len_start + 4].try_into().ok()?) as usize;
    let blob_start = len_start + 4;
    let blob_end = blob_start.checked_add(blob_len)?;
    if blob_end != bytes.len() {
        return None;
    }
    Some(&bytes[blob_start..blob_end])
}

#[cfg(not(windows))]
fn seed_from_hex(hex: &str) -> io::Result<[u8; 32]> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "CAELUS_IDENTITY_KEY_HEX must be 64 hex chars",
        ));
    }
    let mut seed = [0u8; 32];
    for (idx, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let hi = hex_nibble(pair[0]).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "invalid hex in identity seed")
        })?;
        let lo = hex_nibble(pair[1]).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "invalid hex in identity seed")
        })?;
        seed[idx] = (hi << 4) | lo;
    }
    Ok(seed)
}

#[cfg(not(windows))]
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + b - b'a'),
        b'A'..=b'F' => Some(10 + b - b'A'),
        _ => None,
    }
}

#[cfg(windows)]
fn dpapi_protect_seed(seed: &[u8; 32]) -> io::Result<Vec<u8>> {
    windows_dpapi::protect(seed)
}

#[cfg(windows)]
fn dpapi_unprotect_seed(blob: &[u8]) -> io::Result<[u8; 32]> {
    windows_dpapi::unprotect_seed(blob)
}

#[cfg(windows)]
mod windows_dpapi {
    use std::ffi::c_void;
    use std::io;
    use std::ptr;
    use std::slice;

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct DataBlob {
        cbData: u32,
        pbData: *mut u8,
    }

    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            pDataIn: *mut DataBlob,
            szDataDescr: *const u16,
            pOptionalEntropy: *mut DataBlob,
            pvReserved: *mut c_void,
            pPromptStruct: *mut c_void,
            dwFlags: u32,
            pDataOut: *mut DataBlob,
        ) -> i32;

        fn CryptUnprotectData(
            pDataIn: *mut DataBlob,
            ppszDataDescr: *mut *mut u16,
            pOptionalEntropy: *mut DataBlob,
            pvReserved: *mut c_void,
            pPromptStruct: *mut c_void,
            dwFlags: u32,
            pDataOut: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(hMem: *mut c_void) -> *mut c_void;
    }

    pub fn protect(seed: &[u8; 32]) -> io::Result<Vec<u8>> {
        let mut input = DataBlob {
            cbData: seed.len() as u32,
            pbData: seed.as_ptr() as *mut u8,
        };
        let mut output = DataBlob {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &mut input,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        copy_and_free_blob(output)
    }

    pub fn unprotect_seed(blob: &[u8]) -> io::Result<[u8; 32]> {
        let cb_data = u32::try_from(blob.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "DPAPI blob too large"))?;
        let mut input = DataBlob {
            cbData: cb_data,
            pbData: blob.as_ptr() as *mut u8,
        };
        let mut output = DataBlob {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &mut input,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }

        let bytes = copy_and_free_blob(output)?;
        if bytes.len() != 32 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "DPAPI identity seed length is not 32 bytes",
            ));
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        Ok(seed)
    }

    fn copy_and_free_blob(blob: DataBlob) -> io::Result<Vec<u8>> {
        if blob.pbData.is_null() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "DPAPI returned null blob",
            ));
        }
        let bytes = unsafe { slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec() };
        unsafe {
            LocalFree(blob.pbData as *mut c_void);
        }
        Ok(bytes)
    }
}

/// Compute device fingerprint = Blake3(verifying_key_bytes).
pub fn fingerprint_of(vk: &VerifyingKey) -> DeviceFingerprint {
    let mut hasher = blake3::Hasher::new();
    hasher.update(vk.as_bytes());
    *hasher.finalize().as_bytes()
}

// ─── Transcript builders (single source of truth for signed bytes) ──────────────

fn challenge_transcript(
    init_vk: &[u8; 32],
    init_dh: &[u8; 32],
    init_nonce: &[u8; 32],
    init_slot_hash: &[u8; 32],
) -> Vec<u8> {
    let mut v = Vec::with_capacity(CTX_CHALLENGE.len() + 128);
    v.extend_from_slice(CTX_CHALLENGE);
    v.extend_from_slice(init_vk);
    v.extend_from_slice(init_dh);
    v.extend_from_slice(init_nonce);
    v.extend_from_slice(init_slot_hash);
    v
}

#[allow(clippy::too_many_arguments)]
fn response_transcript(
    init_vk: &[u8; 32],
    init_dh: &[u8; 32],
    init_nonce: &[u8; 32],
    resp_vk: &[u8; 32],
    resp_dh: &[u8; 32],
    resp_nonce: &[u8; 32],
    resp_slot_hash: &[u8; 32],
) -> Vec<u8> {
    let mut v = Vec::with_capacity(CTX_RESPONSE.len() + 224);
    v.extend_from_slice(CTX_RESPONSE);
    v.extend_from_slice(init_vk);
    v.extend_from_slice(init_dh);
    v.extend_from_slice(init_nonce);
    v.extend_from_slice(resp_vk);
    v.extend_from_slice(resp_dh);
    v.extend_from_slice(resp_nonce);
    v.extend_from_slice(resp_slot_hash);
    v
}

// ─── Phase 1: Initiator builds challenge ──────────────────────────────────────

pub fn build_challenge(identity: &DeviceIdentity, slot: &OtpSlotClaim) -> EphemeralState {
    let dh_secret = EphemeralSecret::random_from_rng(OsRng);
    let dh_public = X25519Public::from(&dh_secret);

    let mut nonce = [0u8; 32];
    OsRng.fill_bytes(&mut nonce);

    let vk = *identity.verifying_key.as_bytes();
    let dh = *dh_public.as_bytes();
    let transcript = challenge_transcript(&vk, &dh, &nonce, &slot.slot_claim_hash);
    let sig = identity.sign(&transcript);

    let challenge = ChallengeMessage {
        verifying_key: vk,
        dh_public: dh,
        nonce,
        slot_claim_hash: slot.slot_claim_hash,
        signature: sig.to_bytes(),
    };

    EphemeralState {
        dh_secret,
        nonce,
        challenge,
    }
}

// ─── Phase 2: Responder handles challenge ─────────────────────────────────────

pub fn handle_incoming_challenge(
    challenge: &ChallengeMessage,
    identity: &DeviceIdentity,
    own_slot: &OtpSlotClaim,
) -> Result<ResponseMessage, &'static str> {
    let init_vk = VerifyingKey::from_bytes(&challenge.verifying_key)
        .map_err(|_| "Invalid initiator verifying key")?;
    let init_sig = Signature::from_bytes(&challenge.signature);

    let transcript = challenge_transcript(
        &challenge.verifying_key,
        &challenge.dh_public,
        &challenge.nonce,
        &challenge.slot_claim_hash,
    );
    init_vk
        .verify(&transcript, &init_sig)
        .map_err(|_| "Initiator signature verification failed")?;

    let dh_secret = EphemeralSecret::random_from_rng(OsRng);
    let dh_public = X25519Public::from(&dh_secret);

    let mut resp_nonce = [0u8; 32];
    OsRng.fill_bytes(&mut resp_nonce);

    let resp_vk = *identity.verifying_key.as_bytes();
    let resp_dh = *dh_public.as_bytes();
    let resp_transcript = response_transcript(
        &challenge.verifying_key,
        &challenge.dh_public,
        &challenge.nonce,
        &resp_vk,
        &resp_dh,
        &resp_nonce,
        &own_slot.slot_claim_hash,
    );
    let sig = identity.sign(&resp_transcript);

    Ok(ResponseMessage {
        verifying_key: resp_vk,
        dh_public: resp_dh,
        nonce_response: resp_nonce,
        slot_claim_hash: own_slot.slot_claim_hash,
        signature: sig.to_bytes(),
        accepted: true,
    })
}

// ─── Phase 3: Initiator completes handshake ───────────────────────────────────

pub fn complete_handshake(
    state: EphemeralState,
    response: ResponseMessage,
    responder_vk: &VerifyingKey,
    responder_slot_id: u64,
) -> Result<MeshSession, &'static str> {
    if !response.accepted {
        return Err("Responder rejected the handshake");
    }

    let resp_vk = VerifyingKey::from_bytes(&response.verifying_key)
        .map_err(|_| "Invalid responder verifying key")?;

    // The responding key must match the identity we expected (from the manifest).
    if resp_vk.as_bytes() != responder_vk.as_bytes() {
        return Err("Responder key mismatch — possible MITM");
    }

    // Verify the responder signature over the FULL transcript (binds to our challenge).
    let resp_sig = Signature::from_bytes(&response.signature);
    let resp_transcript = response_transcript(
        &state.challenge.verifying_key,
        &state.challenge.dh_public,
        &state.challenge.nonce,
        &response.verifying_key,
        &response.dh_public,
        &response.nonce_response,
        &response.slot_claim_hash,
    );
    resp_vk
        .verify(&resp_transcript, &resp_sig)
        .map_err(|_| "Responder signature verification failed")?;

    // X25519 DH — reject non-contributory (small-order) public keys, which would
    // otherwise force an all-zero shared secret (active downgrade attack).
    let resp_dh_pub = X25519Public::from(response.dh_public);
    let shared_secret = state.dh_secret.diffie_hellman(&resp_dh_pub);
    if !shared_secret.was_contributory() {
        return Err("Non-contributory DH — small-order key rejected");
    }

    // Enforce the responder's ZK slot claim. A failed claim is FATAL (was silently
    // accepted before). This is the actual authorization decision.
    let resp_fingerprint = fingerprint_of(&resp_vk);
    if !verify_slot_hash(
        &resp_fingerprint,
        &response.slot_claim_hash,
        responder_slot_id,
    ) {
        return Err("Responder slot claim verification failed — unauthorized");
    }

    let shared_key = derive_session_key(
        shared_secret.as_bytes(),
        &state.challenge.verifying_key,
        &response.verifying_key,
        &state.challenge.slot_claim_hash,
        &response.slot_claim_hash,
        &state.nonce,
        &response.nonce_response,
    );

    let session_id = derive_session_id(&shared_key, &state.nonce, &response.nonce_response);

    Ok(MeshSession {
        session_id,
        shared_key,
        peer_fingerprint: resp_fingerprint,
        slot_verified: true,
    })
}

// ─── Full in-process simulation (tests + C FFI loopback bridge) ─────────────────

pub fn simulate_full_handshake(
    initiator: &DeviceIdentity,
    initiator_slot_id: u64,
    responder: &DeviceIdentity,
    responder_slot_id: u64,
) -> Result<MeshSession, &'static str> {
    let init_slot = OtpSlotClaim::new(&initiator.fingerprint, initiator_slot_id);
    let resp_slot = OtpSlotClaim::new(&responder.fingerprint, responder_slot_id);

    let ephemeral_state = build_challenge(initiator, &init_slot);
    let response = handle_incoming_challenge(&ephemeral_state.challenge, responder, &resp_slot)?;
    complete_handshake(
        ephemeral_state,
        response,
        &responder.verifying_key,
        responder_slot_id,
    )
}

// ─── Key Derivation ─────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn derive_session_key(
    dh_bytes: &[u8; 32],
    init_vk: &[u8; 32],
    resp_vk: &[u8; 32],
    init_slot_hash: &[u8; 32],
    resp_slot_hash: &[u8; 32],
    init_nonce: &[u8; 32],
    resp_nonce: &[u8; 32],
) -> [u8; 32] {
    // Keyed Blake3 over the DH secret, binding both identities, both slot claims
    // and both nonces (full channel binding). No silent zero-key fallback.
    let mut hasher = blake3::Hasher::new_keyed(dh_bytes);
    hasher.update(CTX_SESSION_KEY);
    hasher.update(init_vk);
    hasher.update(resp_vk);
    hasher.update(init_slot_hash);
    hasher.update(resp_slot_hash);
    hasher.update(init_nonce);
    hasher.update(resp_nonce);
    *hasher.finalize().as_bytes()
}

fn derive_session_id(session_key: &[u8; 32], init_nonce: &[u8; 32], resp_nonce: &[u8; 32]) -> u64 {
    let mut hasher = blake3::Hasher::new_keyed(session_key);
    hasher.update(CTX_SESSION_ID);
    hasher.update(init_nonce);
    hasher.update(resp_nonce);
    let digest = hasher.finalize();
    u64::from_le_bytes(digest.as_bytes()[..8].try_into().unwrap_or([0u8; 8]))
}

// ─── C FFI Surface ─────────────────────────────────────────────────────────────

/// Opaque handle to a Rust-heap device identity.
pub struct CaelusIdentityHandle(DeviceIdentity);

impl CaelusIdentityHandle {
    pub(crate) fn identity(&self) -> &DeviceIdentity {
        &self.0
    }
}

fn ffi_guard_ptr<T, F: FnOnce() -> *mut T>(f: F) -> *mut T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(std::ptr::null_mut())
}

fn ffi_guard_u8<F: FnOnce() -> u8>(f: F) -> u8 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(0)
}

/// Allocate a new ephemeral device identity. Must be freed with caelus_identity_free.
#[no_mangle]
pub extern "C" fn caelus_identity_new() -> *mut CaelusIdentityHandle {
    ffi_guard_ptr(|| Box::into_raw(Box::new(CaelusIdentityHandle(DeviceIdentity::generate()))))
}

/// Load a persistent identity from a UTF-8 path (or create + persist one).
/// `path` / `path_len` is a byte buffer (NOT assumed NUL-terminated). Returns
/// NULL on error (e.g. unwritable path). Must be freed with caelus_identity_free.
#[no_mangle]
pub extern "C" fn caelus_identity_load_or_create(
    path: *const u8,
    path_len: usize,
) -> *mut CaelusIdentityHandle {
    ffi_guard_ptr(|| {
        if path.is_null() || path_len == 0 {
            return std::ptr::null_mut();
        }
        // SAFETY: caller guarantees `path` is readable for `path_len` bytes.
        let bytes = unsafe { std::slice::from_raw_parts(path, path_len) };
        let path_str = match std::str::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        };
        match DeviceIdentity::load_or_generate(Path::new(path_str)) {
            Ok(id) => Box::into_raw(Box::new(CaelusIdentityHandle(id))),
            Err(_) => std::ptr::null_mut(),
        }
    })
}

/// Free an identity handle. Passing NULL is a safe no-op.
#[no_mangle]
pub extern "C" fn caelus_identity_free(handle: *mut CaelusIdentityHandle) {
    if handle.is_null() {
        return;
    }
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // SAFETY: handle produced by caelus_identity_new[_load_or_create], freed once.
        unsafe { drop(Box::from_raw(handle)) };
    }));
}

/// Copy the 32-byte fingerprint into `out_fp` (caller allocates ≥32 bytes).
#[no_mangle]
pub extern "C" fn caelus_identity_fingerprint(
    handle: *const CaelusIdentityHandle,
    out_fp: *mut u8,
) -> u8 {
    ffi_guard_u8(|| {
        if handle.is_null() || out_fp.is_null() {
            return 0;
        }
        // SAFETY: handle valid per contract; out_fp points to ≥32 bytes.
        unsafe {
            std::ptr::copy_nonoverlapping((*handle).0.fingerprint.as_ptr(), out_fp, 32);
        }
        1
    })
}

/// Copy the 32-byte ed25519 verifying key into `out_vk` (caller allocates ≥32 bytes).
#[no_mangle]
pub extern "C" fn caelus_identity_pubkey(
    handle: *const CaelusIdentityHandle,
    out_vk: *mut u8,
) -> u8 {
    ffi_guard_u8(|| {
        if handle.is_null() || out_vk.is_null() {
            return 0;
        }
        // SAFETY: same as above.
        unsafe {
            std::ptr::copy_nonoverlapping(
                (*handle).0.verifying_key.as_bytes().as_ptr(),
                out_vk,
                32,
            );
        }
        1
    })
}

/// C-visible session result.
#[repr(C)]
pub struct CaelusSessionResult {
    pub success: bool,
    pub session_id: u64,
    pub shared_key: [u8; 32],
    pub peer_fingerprint: [u8; 32],
    pub slot_verified: bool,
    pub error_msg: [u8; 128],
}

impl CaelusSessionResult {
    fn error(msg: &str) -> Self {
        let mut r = Self {
            success: false,
            session_id: 0,
            shared_key: [0u8; 32],
            peer_fingerprint: [0u8; 32],
            slot_verified: false,
            error_msg: [0u8; 128],
        };
        let b = msg.as_bytes();
        let len = b.len().min(127);
        r.error_msg[..len].copy_from_slice(&b[..len]);
        r
    }

    fn from_session(s: MeshSession) -> Self {
        Self {
            success: true,
            session_id: s.session_id,
            shared_key: s.shared_key,
            peer_fingerprint: s.peer_fingerprint,
            slot_verified: s.slot_verified,
            error_msg: [0u8; 128],
        }
    }
}

/// Perform a full in-process CAELUS mesh handshake (loopback simulation / test).
///
/// # Safety
/// Both handles must be non-null and valid for the duration of the call.
#[no_mangle]
pub extern "C" fn caelus_mesh_handshake(
    initiator: *const CaelusIdentityHandle,
    initiator_slot_id: u64,
    responder: *const CaelusIdentityHandle,
    responder_slot_id: u64,
) -> CaelusSessionResult {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if initiator.is_null() {
            return CaelusSessionResult::error("NULL initiator handle");
        }
        if responder.is_null() {
            return CaelusSessionResult::error("NULL responder handle");
        }
        // SAFETY: pointers validated above; caller guarantees lifetimes.
        let init_id = unsafe { &(*initiator).0 };
        let resp_id = unsafe { &(*responder).0 };

        match simulate_full_handshake(init_id, initiator_slot_id, resp_id, responder_slot_id) {
            Ok(session) => CaelusSessionResult::from_session(session),
            Err(e) => CaelusSessionResult::error(e),
        }
    }))
    .unwrap_or_else(|_| CaelusSessionResult::error("internal panic during handshake"))
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_full_handshake_universal_simulation() {
        let actor_alpha = DeviceIdentity::generate();
        let actor_beta = DeviceIdentity::generate();

        let session = simulate_full_handshake(
            &actor_alpha,
            0x2026_0607_0001,
            &actor_beta,
            0x2026_0607_0000,
        )
        .expect("universal handshake must succeed");

        assert_ne!(session.session_id, 0);
        assert_ne!(session.shared_key, [0u8; 32]);
        assert!(session.slot_verified, "slot must be verified on success");
    }

    #[test]
    fn handshake_fails_on_wrong_slot() {
        let actor_alpha = DeviceIdentity::generate();
        let actor_beta = DeviceIdentity::generate();

        let init_slot = OtpSlotClaim::new(&actor_alpha.fingerprint, 42);
        // Responder advertises slot 99...
        let resp_slot = OtpSlotClaim::new(&actor_beta.fingerprint, 99);
        let state = build_challenge(&actor_alpha, &init_slot);
        let response =
            handle_incoming_challenge(&state.challenge, &actor_beta, &resp_slot).unwrap();
        // ...but the initiator expects slot 100 → MUST fail (authorization enforced).
        let res = complete_handshake(state, response, &actor_beta.verifying_key, 100);
        assert!(res.is_err(), "mismatched slot must fail the handshake");
    }

    #[test]
    fn handshake_fails_on_key_mismatch() {
        let actor_alpha = DeviceIdentity::generate();
        let actor_beta = DeviceIdentity::generate();
        let attacker = DeviceIdentity::generate();

        let init_slot = OtpSlotClaim::new(&actor_alpha.fingerprint, 1);
        let resp_slot = OtpSlotClaim::new(&actor_beta.fingerprint, 2);
        let state = build_challenge(&actor_alpha, &init_slot);
        let response =
            handle_incoming_challenge(&state.challenge, &actor_beta, &resp_slot).unwrap();
        // Expect the attacker's key instead of the real responder → MITM rejected.
        let res = complete_handshake(state, response, &attacker.verifying_key, 2);
        assert!(res.is_err(), "key mismatch must be rejected");
    }

    #[test]
    fn forged_initiator_signature_is_rejected() {
        let actor_alpha = DeviceIdentity::generate();
        let actor_beta = DeviceIdentity::generate();
        let init_slot = OtpSlotClaim::new(&actor_alpha.fingerprint, 1);
        let resp_slot = OtpSlotClaim::new(&actor_beta.fingerprint, 2);

        let mut state = build_challenge(&actor_alpha, &init_slot);
        state.challenge.signature[0] ^= 0xFF; // tamper
        let res = handle_incoming_challenge(&state.challenge, &actor_beta, &resp_slot);
        assert!(res.is_err(), "forged challenge signature must be rejected");
    }

    #[test]
    fn test_fingerprint_identity() {
        let dev = DeviceIdentity::generate();
        assert_eq!(fingerprint_of(&dev.verifying_key), dev.fingerprint);
    }

    #[test]
    fn persistent_identity_is_stable() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("caelus_test_id_{}.key", std::process::id()));
        let _ = std::fs::remove_file(&path);
        #[cfg(not(windows))]
        std::env::set_var(
            "CAELUS_IDENTITY_KEY_HEX",
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        );
        let a = DeviceIdentity::load_or_generate(&path).unwrap();
        let b = DeviceIdentity::load_or_generate(&path).unwrap();
        assert_eq!(
            a.fingerprint, b.fingerprint,
            "identity must persist across loads"
        );
        #[cfg(windows)]
        {
            let stored = std::fs::read(&path).unwrap();
            assert!(
                stored.starts_with(KEY_FILE_MAGIC),
                "identity file must use the CAELUS key container"
            );
            assert_ne!(stored.len(), 32, "plaintext seed must not be persisted");
        }
        let _ = std::fs::remove_file(&path);
        #[cfg(not(windows))]
        std::env::remove_var("CAELUS_IDENTITY_KEY_HEX");
    }

    #[test]
    fn test_ffi_full_handshake() {
        let init_h = caelus_identity_new();
        let resp_h = caelus_identity_new();
        assert!(!init_h.is_null() && !resp_h.is_null());

        let result = caelus_mesh_handshake(init_h, 0x2026_0607_0001, resp_h, 0x2026_0607_0000);
        assert!(result.success, "FFI handshake must succeed");
        assert!(result.slot_verified);
        assert_ne!(result.session_id, 0);

        caelus_identity_free(init_h);
        caelus_identity_free(resp_h);
    }

    // ── T-23 KEYMGMT delegate seam ───────────────────────────────────────────
    // A faithful fake provider: protect prepends a 0xC5 tag to the seed,
    // unprotect strips it. Exercised through the delegate wrappers directly so
    // no global state is mutated (no races with the other identity tests).

    extern "C" fn test_keymgmt_protect(
        _state: *mut std::ffi::c_void,
        plaintext: *const CaelusKeyBlob,
        protected_out: *mut CaelusKeyBlob,
    ) -> u8 {
        if plaintext.is_null() || protected_out.is_null() {
            return 0;
        }
        // SAFETY: the wrappers always pass valid, non-overlapping blobs.
        unsafe {
            let input = &*plaintext;
            let out = &mut *protected_out;
            let need = input.len + 1;
            if input.data.is_null() || out.data.is_null() || out.capacity < need {
                return 0;
            }
            *out.data = 0xC5;
            std::ptr::copy_nonoverlapping(input.data, out.data.add(1), input.len);
            out.len = need;
            out.format = CAELUS_KEY_BLOB_PROTECTED_PLUGIN;
        }
        CAELUS_KEYMGMT_OK
    }

    extern "C" fn test_keymgmt_unprotect(
        _state: *mut std::ffi::c_void,
        protected_in: *const CaelusKeyBlob,
        plaintext_out: *mut CaelusKeyBlob,
    ) -> u8 {
        if protected_in.is_null() || plaintext_out.is_null() {
            return 0;
        }
        // SAFETY: see test_keymgmt_protect.
        unsafe {
            let input = &*protected_in;
            let out = &mut *plaintext_out;
            if input.data.is_null() || out.data.is_null() || input.len < 1 || *input.data != 0xC5 {
                return 0;
            }
            let payload = input.len - 1;
            if out.capacity < payload {
                return 0;
            }
            std::ptr::copy_nonoverlapping(input.data.add(1), out.data, payload);
            out.len = payload;
        }
        CAELUS_KEYMGMT_OK
    }

    extern "C" fn test_keymgmt_fail(
        _state: *mut std::ffi::c_void,
        _in: *const CaelusKeyBlob,
        _out: *mut CaelusKeyBlob,
    ) -> u8 {
        0
    }

    #[test]
    fn keymgmt_delegate_round_trip() {
        let delegate = KeymgmtDelegate {
            protect: test_keymgmt_protect as CaelusKeyProtectFn,
            unprotect: test_keymgmt_unprotect as CaelusKeyUnprotectFn,
            state: std::ptr::null_mut(),
        };

        let mut seed = [0u8; 32];
        for (i, b) in seed.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7).wrapping_add(1);
        }

        let payload = delegate.protect(&seed).expect("delegate protect must succeed");
        // payload = [format u32 LE] + [0xC5 tag] + [32-byte seed] = 37 bytes.
        assert_eq!(payload.len(), 4 + 1 + 32);
        let format = u32::from_le_bytes(payload[..4].try_into().unwrap());
        assert_eq!(format, CAELUS_KEY_BLOB_PROTECTED_PLUGIN);

        let recovered = delegate
            .unprotect(&payload)
            .expect("delegate unprotect must succeed");
        assert_eq!(recovered, seed, "seed must survive the KEYMGMT round-trip");

        // A failing provider must surface as an error, never a silent fallback.
        let broken = KeymgmtDelegate {
            protect: test_keymgmt_protect as CaelusKeyProtectFn,
            unprotect: test_keymgmt_fail as CaelusKeyUnprotectFn,
            state: std::ptr::null_mut(),
        };
        assert!(
            broken.unprotect(&payload).is_err(),
            "a failing KEYMGMT provider must produce an error"
        );
    }
}
