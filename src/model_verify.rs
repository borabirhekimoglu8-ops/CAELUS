//! Dedicated Ed25519 trust domain for deterministic neural model packages.
//!
//! A neural signature binds the exact Blake3 digest of the manifest bytes and
//! the exact Blake3 digest of the model byte stream.  The domain is constructed
//! inside Rust so C++ callers cannot accidentally omit or change it.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::slice;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

pub const NEURAL_MODEL_DOMAIN_V1: &[u8] = b"CAELUS_NEURAL_MODEL_V1\0";
pub const MAX_HASH_INPUT_BYTES: usize = 64 * 1024 * 1024;

pub fn neural_model_signing_payload(
    manifest_hash: &[u8; 32],
    weights_hash: &[u8; 32],
) -> [u8; NEURAL_MODEL_DOMAIN_V1.len() + 64] {
    let mut payload = [0u8; NEURAL_MODEL_DOMAIN_V1.len() + 64];
    payload[..NEURAL_MODEL_DOMAIN_V1.len()].copy_from_slice(NEURAL_MODEL_DOMAIN_V1);
    payload[NEURAL_MODEL_DOMAIN_V1.len()..NEURAL_MODEL_DOMAIN_V1.len() + 32]
        .copy_from_slice(manifest_hash);
    payload[NEURAL_MODEL_DOMAIN_V1.len() + 32..].copy_from_slice(weights_hash);
    payload
}

pub fn sign_neural_model_hashes(
    manifest_hash: &[u8; 32],
    weights_hash: &[u8; 32],
    seed: &[u8; 32],
) -> ([u8; 64], [u8; 32]) {
    let signing_key = SigningKey::from_bytes(seed);
    let payload = neural_model_signing_payload(manifest_hash, weights_hash);
    let signature = signing_key.sign(&payload).to_bytes();
    let public_key = *signing_key.verifying_key().as_bytes();
    (signature, public_key)
}

pub fn neural_model_public_key(seed: &[u8; 32]) -> [u8; 32] {
    *SigningKey::from_bytes(seed).verifying_key().as_bytes()
}

pub fn verify_neural_model_hashes(
    manifest_hash: &[u8; 32],
    weights_hash: &[u8; 32],
    public_key: &[u8; 32],
    signature: &[u8; 64],
) -> bool {
    let Ok(verifying_key) = VerifyingKey::from_bytes(public_key) else {
        return false;
    };
    let payload = neural_model_signing_payload(manifest_hash, weights_hash);
    verifying_key
        .verify(&payload, &Signature::from_bytes(signature))
        .is_ok()
}

/// Blake3 hash for C++ model/package verification.
///
/// Returns 1 and writes 32 bytes on success.  Null pointers, zero/oversized
/// input, or panic return 0.  `out_hash32` must address 32 writable bytes.
///
/// # Safety
///
/// `data_ptr` must reference `data_len` readable bytes and `out_hash32` must
/// reference at least 32 writable bytes for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn caelus_blake3_hash(
    data_ptr: *const u8,
    data_len: usize,
    out_hash32: *mut u8,
) -> u8 {
    catch_unwind(AssertUnwindSafe(|| {
        if data_ptr.is_null()
            || out_hash32.is_null()
            || data_len == 0
            || data_len > MAX_HASH_INPUT_BYTES
        {
            return 0u8;
        }
        // SAFETY: caller supplies a readable span; length is bounded above.
        let data = unsafe { slice::from_raw_parts(data_ptr, data_len) };
        let digest = blake3::hash(data);
        // SAFETY: caller contract requires 32 writable bytes.
        unsafe {
            std::ptr::copy_nonoverlapping(digest.as_bytes().as_ptr(), out_hash32, 32);
        }
        1u8
    }))
    .unwrap_or(0u8)
}

/// Verify a neural model signature under the dedicated V1 domain.
///
/// # Safety
///
/// The pointers must reference readable buffers of exactly 32, 32, 32 and 64
/// bytes respectively for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn caelus_verify_neural_model_signature(
    manifest_hash32: *const u8,
    weights_hash32: *const u8,
    public_key32: *const u8,
    signature64: *const u8,
) -> u8 {
    catch_unwind(AssertUnwindSafe(|| {
        if manifest_hash32.is_null()
            || weights_hash32.is_null()
            || public_key32.is_null()
            || signature64.is_null()
        {
            return 0u8;
        }
        // SAFETY: each pointer is checked and has a fixed-size caller contract.
        let manifest: &[u8; 32] =
            match unsafe { slice::from_raw_parts(manifest_hash32, 32) }.try_into() {
                Ok(value) => value,
                Err(_) => return 0,
            };
        let weights: &[u8; 32] =
            match unsafe { slice::from_raw_parts(weights_hash32, 32) }.try_into() {
                Ok(value) => value,
                Err(_) => return 0,
            };
        let public_key: &[u8; 32] =
            match unsafe { slice::from_raw_parts(public_key32, 32) }.try_into() {
                Ok(value) => value,
                Err(_) => return 0,
            };
        let signature: &[u8; 64] =
            match unsafe { slice::from_raw_parts(signature64, 64) }.try_into() {
                Ok(value) => value,
                Err(_) => return 0,
            };
        u8::from(verify_neural_model_hashes(
            manifest, weights, public_key, signature,
        ))
    }))
    .unwrap_or(0u8)
}

/// Sign neural model hashes under the dedicated V1 domain.
///
/// This is intended for offline tooling.  The production host does not call it.
///
/// # Safety
///
/// The first three pointers must reference 32 readable bytes each.  The output
/// pointers must reference 64 and 32 writable non-overlapping bytes.
#[no_mangle]
pub unsafe extern "C" fn caelus_sign_neural_model_hashes(
    manifest_hash32: *const u8,
    weights_hash32: *const u8,
    seed32: *const u8,
    out_signature64: *mut u8,
    out_public_key32: *mut u8,
) -> u8 {
    catch_unwind(AssertUnwindSafe(|| {
        if manifest_hash32.is_null()
            || weights_hash32.is_null()
            || seed32.is_null()
            || out_signature64.is_null()
            || out_public_key32.is_null()
        {
            return 0u8;
        }
        // SAFETY: fixed-size pointer contracts are validated for null above.
        let manifest: &[u8; 32] =
            match unsafe { slice::from_raw_parts(manifest_hash32, 32) }.try_into() {
                Ok(value) => value,
                Err(_) => return 0,
            };
        let weights: &[u8; 32] =
            match unsafe { slice::from_raw_parts(weights_hash32, 32) }.try_into() {
                Ok(value) => value,
                Err(_) => return 0,
            };
        let seed: &[u8; 32] = match unsafe { slice::from_raw_parts(seed32, 32) }.try_into() {
            Ok(value) => value,
            Err(_) => return 0,
        };
        let (signature, public_key) = sign_neural_model_hashes(manifest, weights, seed);
        // SAFETY: caller contract requires writable 64-byte and 32-byte buffers.
        unsafe {
            std::ptr::copy_nonoverlapping(signature.as_ptr(), out_signature64, 64);
            std::ptr::copy_nonoverlapping(public_key.as_ptr(), out_public_key32, 32);
        }
        1u8
    }))
    .unwrap_or(0u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neural_signatures_bind_both_hashes_and_domain() {
        let seed = [0x42u8; 32];
        let manifest = *blake3::hash(b"manifest").as_bytes();
        let weights = *blake3::hash(b"weights").as_bytes();
        let (signature, public_key) = sign_neural_model_hashes(&manifest, &weights, &seed);
        assert!(verify_neural_model_hashes(
            &manifest,
            &weights,
            &public_key,
            &signature
        ));

        let mut changed_manifest = manifest;
        changed_manifest[0] ^= 1;
        assert!(!verify_neural_model_hashes(
            &changed_manifest,
            &weights,
            &public_key,
            &signature
        ));
        let mut changed_weights = weights;
        changed_weights[31] ^= 1;
        assert!(!verify_neural_model_hashes(
            &manifest,
            &changed_weights,
            &public_key,
            &signature
        ));
    }

    #[test]
    fn ffi_rejects_nulls_and_hashes_real_bytes() {
        let mut out = [0u8; 32];
        assert_eq!(
            unsafe { caelus_blake3_hash(b"abc".as_ptr(), 3, out.as_mut_ptr()) },
            1
        );
        assert_eq!(out, *blake3::hash(b"abc").as_bytes());
        assert_eq!(
            unsafe { caelus_blake3_hash(std::ptr::null(), 3, out.as_mut_ptr()) },
            0
        );
        assert_eq!(
            unsafe {
                caelus_verify_neural_model_signature(
                    std::ptr::null(),
                    out.as_ptr(),
                    out.as_ptr(),
                    [0u8; 64].as_ptr(),
                )
            },
            0
        );
    }
}
