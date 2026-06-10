// CAELUS OS — Rust Static Library Root
// Exposes Shadow-Mesh P2P network layer to C++ core_engine via C FFI.
//
// Crate type: staticlib  →  compiled to caelus_network.lib / libcaelus_network.a
// The C++ linker includes this archive; all #[no_mangle] extern "C" symbols
// in the submodules become directly callable from core_engine.cpp.

// FFI boundary: the #[no_mangle] extern "C" functions necessarily take raw
// pointers supplied by the C/C++ caller, whose validity is the caller's
// documented contract (see the SAFETY comments at each deref). Marking a C ABI
// surface `unsafe` would not change the ABI, so we allow this clippy lint here.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

pub mod audit_log;
pub mod network;
pub mod scenario_verify;

// ─── Primary Shadow-Mesh Authentication FFI surface ───────────────────────────
pub use network::mesh_auth::{
    caelus_identity_fingerprint, caelus_identity_free, caelus_identity_load_or_create,
    caelus_identity_new, caelus_identity_pubkey, caelus_mesh_handshake, CaelusIdentityHandle,
    CaelusSessionResult,
};

// ─── Discovery + Intel Feed FFI surface ───────────────────────────────────────
// CaelusDiscoveryCtx is the top-level air-gapped session context:
//   - holds the P2P peer table (MeshDiscovery) + real UDP multicast loops
//   - holds the incoming field intel queue (IntelFeedQueue)
// C++ allocates one context via caelus_discovery_new() (bound to the device
// identity), optionally starts the loops via caelus_discovery_start(), and
// polls caelus_fetch_intel_feed() after each handshake cycle.
pub use network::discovery::{
    caelus_discovery_free, caelus_discovery_new, caelus_discovery_start, caelus_discovery_stop,
    caelus_fetch_intel_feed, caelus_fetch_nearby_peers, caelus_inject_intel_packet,
    CaelusDiscoveryCtx, IntelFeedPacket,
};

// ─── Virtual clock FFI surface ────────────────────────────────────────────────
// Freeze / restore the Rust discovery clock for deterministic CI testing.
// See discovery.rs for full documentation.
pub use network::discovery::{caelus_clock_set_virtual, caelus_clock_use_real};

// ─── Audit log FFI surface (R6) ───────────────────────────────────────────────
// Blake3-chained, ed25519-sealed append-only forensic audit log.
// See audit_log.rs for full documentation.
pub use audit_log::{
    caelus_audit_append, caelus_audit_chain_head, caelus_audit_entry_count, caelus_audit_free,
    caelus_audit_new, caelus_audit_seal, CaelusAuditLog,
};

// ─── Scenario signature verification FFI surface ─────────────────────────────
// C++ builds a deterministic canonical payload from ScenarioPack critical
// fields, then calls this ed25519 verifier before accepting a scenario.
pub use scenario_verify::caelus_verify_scenario_signature;

/// Sign a canonical scenario payload with a 32-byte Ed25519 seed.
///
/// Returns 1 on success and writes a 64-byte signature plus 32-byte public key
/// into caller-provided buffers. Returns 0 on null pointers, invalid lengths,
/// oversized payloads, or panic.
#[no_mangle]
pub extern "C" fn caelus_sign_scenario_payload(
    payload_ptr: *const u8,
    payload_len: usize,
    seed_ptr: *const u8,
    seed_len: usize,
    out_signature64: *mut u8,
    out_pubkey32: *mut u8,
) -> u8 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if payload_ptr.is_null()
            || seed_ptr.is_null()
            || out_signature64.is_null()
            || out_pubkey32.is_null()
        {
            return 0u8;
        }
        if payload_len == 0 || payload_len > 16 * 1024 * 1024 || seed_len != 32 {
            return 0u8;
        }

        // SAFETY: pointers are validated above and payload length is bounded.
        let payload = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) };
        let seed = unsafe { std::slice::from_raw_parts(seed_ptr, seed_len) };
        let seed_arr: &[u8; 32] = match seed.try_into() {
            Ok(v) => v,
            Err(_) => return 0u8,
        };

        let signing_key = ed25519_dalek::SigningKey::from_bytes(seed_arr);
        let verifying_key = signing_key.verifying_key();
        let signature = ed25519_dalek::Signer::sign(&signing_key, payload);
        let signature_bytes = signature.to_bytes();

        // SAFETY: caller contract requires writable buffers of at least 64/32 bytes.
        unsafe {
            std::ptr::copy_nonoverlapping(signature_bytes.as_ptr(), out_signature64, 64);
            std::ptr::copy_nonoverlapping(verifying_key.as_bytes().as_ptr(), out_pubkey32, 32);
        }
        1u8
    }))
    .unwrap_or(0u8)
}
