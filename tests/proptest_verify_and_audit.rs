// Proptest özellik test süiti — senaryo imza doğrulayıcı (scenario_verify.rs) ve
// Blake3 + Ed25519 denetim günlüğü zinciri (audit_log.rs) bütünlük doğrulaması.

use caelus_network::{
    caelus_audit_append, caelus_audit_chain_head, caelus_audit_entry_count, caelus_audit_free,
    caelus_audit_new, caelus_audit_seal, caelus_identity_free, caelus_identity_new,
    caelus_sign_scenario_payload, caelus_verify_scenario_signature,
};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn prop_scenario_sign_and_verify_roundtrip_and_tamper_rejection(
        payload in prop::collection::vec(any::<u8>(), 1..2048),
        seed in prop::array::uniform32(any::<u8>()),
        flip_idx in 0usize..2048usize,
        flip_mask in 1u8..=255u8
    ) {
        let mut sig = [0u8; 64];
        let mut pubkey = [0u8; 32];

        let sign_ok = caelus_sign_scenario_payload(
            payload.as_ptr(),
            payload.len(),
            seed.as_ptr(),
            seed.len(),
            sig.as_mut_ptr(),
            pubkey.as_mut_ptr(),
        );
        prop_assert_eq!(sign_ok, 1u8);

        // Doğru imza ve doğru yük kabul edilmeli
        let verify_ok = caelus_verify_scenario_signature(
            payload.as_ptr(),
            payload.len(),
            pubkey.as_ptr(),
            sig.as_ptr(),
        );
        prop_assert_eq!(verify_ok, 1u8);

        // Tek bayt / bit bozulmuş yük reddedilmeli (fail-closed)
        let mut tampered = payload.clone();
        let target_idx = flip_idx % tampered.len();
        tampered[target_idx] ^= flip_mask;
        let verify_tampered = caelus_verify_scenario_signature(
            tampered.as_ptr(),
            tampered.len(),
            pubkey.as_ptr(),
            sig.as_ptr(),
        );
        prop_assert_eq!(verify_tampered, 0u8);
    }

    #[test]
    fn prop_audit_log_chain_monotonicity_and_post_seal_lock(
        events in prop::collection::vec("[A-Za-z0-9_\\-:\\. ]{1,48}", 1..16),
        ticks in prop::collection::vec(0u64..10_000u64, 1..16)
    ) {
        let id_handle = caelus_identity_new();
        prop_assert!(!id_handle.is_null());

        let tmp_dir = std::env::temp_dir();
        let log_path = tmp_dir.join(format!(
            "caelus_proptest_audit_{}_{}.log",
            std::process::id(),
            ticks[0]
        ));
        let path_str = log_path.to_string_lossy().into_owned();
        let path_bytes = path_str.as_bytes();

        let audit = caelus_audit_new(id_handle, ticks[0], path_bytes.as_ptr(), path_bytes.len());
        prop_assert!(!audit.is_null());

        let mut prev_head = [0u8; 32];
        let _ = caelus_audit_chain_head(audit, prev_head.as_mut_ptr());

        let n = events.len().min(ticks.len());
        for i in 0..n {
            let ev_json = format!(r#"{{"tick":{},"kind":"PROPTEST_EVENT","detail":"{}"}}"#, ticks[i], events[i]);
            let rc = caelus_audit_append(audit, ev_json.as_ptr(), ev_json.len());
            prop_assert_eq!(rc, 1u8);

            let mut cur_head = [0u8; 32];
            let head_ok = caelus_audit_chain_head(audit, cur_head.as_mut_ptr());
            prop_assert_eq!(head_ok, 1u8);
            prop_assert_ne!(cur_head, prev_head);
            prev_head = cur_head;
        }

        prop_assert_eq!(caelus_audit_entry_count(audit), n as u64);

        // Seal sonrası yeni kayıt eklenemez (SEAL kilidi)
        let seal_ok = caelus_audit_seal(audit);
        prop_assert_eq!(seal_ok, 1u8);

        let post_seal_json = r#"{"tick":99999,"kind":"PROPTEST_EVENT","detail":"MUST_BE_REJECTED"}"#;
        let after_seal_rc = caelus_audit_append(audit, post_seal_json.as_ptr(), post_seal_json.len());
        prop_assert_eq!(after_seal_rc, 0u8);

        caelus_audit_free(audit);
        caelus_identity_free(id_handle);
        let _ = std::fs::remove_file(&log_path);
    }
}
