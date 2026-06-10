// CAELUS OS — Scenario signature verification FFI
//
// Verifies ScenarioPack signatures for the C++ loader. The C++ side builds a
// deterministic canonical payload from the critical JSON fields and passes the
// bytes here. No I/O, no allocation beyond ed25519-dalek internals.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::slice;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};

#[no_mangle]
pub extern "C" fn caelus_verify_scenario_signature(
    msg_ptr: *const u8,
    msg_len: usize,
    pubkey_ptr: *const u8,
    sig_ptr: *const u8,
) -> u8 {
    catch_unwind(AssertUnwindSafe(|| {
        if msg_ptr.is_null() || pubkey_ptr.is_null() || sig_ptr.is_null() {
            return 0u8;
        }
        if msg_len == 0 || msg_len > 16 * 1024 * 1024 {
            return 0u8;
        }

        // SAFETY: Pointers and lengths are supplied by the C++ caller. This FFI
        // surface validates null pointers above and bounds msg_len before
        // constructing read-only slices.
        let msg = unsafe { slice::from_raw_parts(msg_ptr, msg_len) };
        let pubkey = unsafe { slice::from_raw_parts(pubkey_ptr, 32) };
        let sig = unsafe { slice::from_raw_parts(sig_ptr, 64) };

        let pubkey_arr: &[u8; 32] = match pubkey.try_into() {
            Ok(v) => v,
            Err(_) => return 0u8,
        };
        let sig_arr: &[u8; 64] = match sig.try_into() {
            Ok(v) => v,
            Err(_) => return 0u8,
        };

        let verifying_key = match VerifyingKey::from_bytes(pubkey_arr) {
            Ok(v) => v,
            Err(_) => return 0u8,
        };
        let signature = Signature::from_bytes(sig_arr);

        if verifying_key.verify(msg, &signature).is_ok() {
            1u8
        } else {
            0u8
        }
    }))
    .unwrap_or(0u8)
}
