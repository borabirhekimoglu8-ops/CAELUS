// Proptest özellik test süiti — caelus_core sabit noktalı aritmetik (fp.rs) ve
// nedensel motor (engine.rs) sınır koşulları doğrulaması.

use caelus_core::fp::{
    d_to_fp, fp_add_saturating, fp_clamp, fp_div, fp_mul, fp_mul_div_u64_sat_raw, FP_ONE,
    FP_SCALE, FRICTION_MAX_FP, FRICTION_MIN_FP,
};
use caelus_core::*;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn prop_fp_add_saturating_matches_i128_clamped(a in any::<i64>(), b in any::<i64>()) {
        let wide = (a as i128) + (b as i128);
        let expected = wide.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
        prop_assert_eq!(fp_add_saturating(a, b), expected);
    }

    #[test]
    fn prop_fp_clamp_enforces_ordered_bounds(
        v in any::<i64>(),
        x in any::<i64>(),
        y in any::<i64>()
    ) {
        let (lo, hi) = if x <= y { (x, y) } else { (y, x) };
        let c = fp_clamp(v, lo, hi);
        prop_assert!(c >= lo && c <= hi);
        // İdempotans: iki kez kelepçelemek sonucu değiştirmez
        prop_assert_eq!(fp_clamp(c, lo, hi), c);
    }

    #[test]
    fn prop_fp_mul_matches_i128_reference(a in any::<i64>(), b in any::<i64>()) {
        let neg = (a < 0) != (b < 0);
        let ua = (a as i128).unsigned_abs();
        let ub = (b as i128).unsigned_abs();
        let raw_q = (ua * ub) / (FP_SCALE as u128);
        let expected = if !neg {
            raw_q.min(i64::MAX as u128) as i64
        } else if raw_q >= (1u128 << 63) {
            i64::MIN
        } else {
            -(raw_q as i64)
        };
        prop_assert_eq!(fp_mul(a, b), expected);
    }

    #[test]
    fn prop_fp_div_safety_and_zero_totality(
        a in -1_000_000_000_000i64..=1_000_000_000_000i64,
        b in -1_000_000_000_000i64..=1_000_000_000_000i64
    ) {
        if b == 0 {
            prop_assert_eq!(fp_div(a, 0), 0);
        } else {
            let got = fp_div(a, b);
            let neg = (a < 0) != (b < 0);
            let ua = (a as i128).unsigned_abs();
            let ub = (b as i128).unsigned_abs();
            let raw_q = (ua * (FP_SCALE as u128)) / ub;
            let expected = if !neg {
                raw_q.min(i64::MAX as u128) as i64
            } else if raw_q >= (1u128 << 63) {
                i64::MIN
            } else {
                -(raw_q as i64)
            };
            prop_assert_eq!(got, expected);
        }
    }

    #[test]
    fn prop_fp_mul_div_u64_never_exceeds_cap(
        a in any::<u64>(),
        b in any::<u64>(),
        divisor in any::<u64>(),
        cap in any::<u64>()
    ) {
        let got = fp_mul_div_u64_sat_raw(a, b, divisor, cap);
        prop_assert!(got <= cap);
    }

    #[test]
    fn prop_d_to_fp_handles_arbitrary_f64_without_panic(val in any::<f64>()) {
        let fp = d_to_fp(val);
        if !val.is_finite() {
            prop_assert_eq!(fp, 0);
        } else {
            prop_assert!(fp >= i64::MIN && fp <= i64::MAX);
        }
    }

    #[test]
    fn prop_engine_state_bounds_and_outage_latch_under_random_inputs(
        seed in any::<u64>(),
        init_state in 0i64..=FP_ONE,
        init_trust in 100_000i64..=FP_ONE,
        intel_coeff in 0.0f64..=1.0f64,
        crisis_lvl in 0i32..=3i32,
        ticks in 1usize..=16usize
    ) {
        let mut eng = CausalEngine::new();
        eng.set_prng_seed(seed);

        let mut n0 = Node::default();
        n0.id = "N_PRIMARY".to_string();
        n0.kind = NodeKind::Perishable;
        n0.capacity_fp = FP_ONE;
        n0.state_fp = init_state;
        n0.reported_state_fp = init_state;
        n0.trust_fp = init_trust;
        n0.weight_fp = 350_000;
        n0.deadline_tick = 6;
        n0.deadline_min_state_fp = 750_000;
        eng.add_node(n0);

        let mut e_agg = Edge::default();
        e_agg.from = "N_PRIMARY".to_string();
        e_agg.to = String::new();
        e_agg.multiplier_fp = 300_000;
        e_agg.active = true;
        eng.add_edge(e_agg);

        eng.inject_intel(intel_coeff, crisis_lvl, "PROPTEST_SIGNAL");

        let mut outage_seen = false;
        for _ in 0..ticks {
            let snap = eng.tick();
            prop_assert!(snap.clamped_friction_fp >= FRICTION_MIN_FP);
            prop_assert!(snap.clamped_friction_fp <= FRICTION_MAX_FP);
            prop_assert!(snap.throughput_ratio_fp >= 0 && snap.throughput_ratio_fp <= FP_ONE);
            for nd in eng.nodes() {
                prop_assert!(nd.state_fp >= 0 && nd.state_fp <= nd.capacity_fp);
                prop_assert!(nd.trust_fp >= 0 && nd.trust_fp <= FP_ONE);
            }
            if outage_seen {
                // Recovery lever uygulanmadıkça outage latch kalkamaz
                prop_assert!(snap.outage_active);
                prop_assert_eq!(snap.throughput_ratio_fp, 0);
            }
            if snap.outage_active {
                outage_seen = true;
            }
        }
    }
}
