// ============================================================================
// CAELUS — Verus/Z3 Biçimsel İspat Modülü 4:
//   P-6: Güven Ağırlıklı Gözlemlenebilirlik (Trust-Weighted Observability) Sınır ve Konvekslik İspatı
//   P-7: Tersinmez Histerezis (Irreversible Hysteresis) Monotonluk ve Kalıcı Kapasite Tavanı İspatı
//   P-8: Epistemik Sembolik Doğrulama Kapısı (Fail-Closed Hypothesis Gate) İspatı
//
// Çalıştırma:
//   tools\verus\verus-x86-win\verus.exe --crate-type=lib caelus_core\verify\trust_and_hysteresis_proofs.rs
// ============================================================================

use vstd::prelude::*;

verus! {

pub const FP_ONE: i64 = 1_000_000;

// ----------------------------------------------------------------------------
// P-6: Güven Ağırlıklı Durum Birleştirme (Trust-Weighted State Interpolation)
//   true_state_fp, reported_state_fp, trust_fp ∈ [0, FP_ONE]
//   effective = (true_state_fp * (FP_ONE - trust_fp) + reported_state_fp * trust_fp) / FP_ONE
// ----------------------------------------------------------------------------
pub open spec fn spec_trust_blend(true_s: int, rep_s: int, trust: int) -> int {
    (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000
}

#[verifier::nonlinear]
proof fn lemma_trust_blend_bounds(true_s: int, rep_s: int, trust: int)
    requires
        0 <= true_s <= 1_000_000,
        0 <= rep_s <= 1_000_000,
        0 <= trust <= 1_000_000,
    ensures
        0 <= true_s * (1_000_000 - trust) <= 1_000_000_000_000,
        0 <= rep_s * trust <= 1_000_000_000_000,
        0 <= (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000 <= 1_000_000,
        trust == 0 ==> (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000 == true_s,
        trust == 1_000_000 ==> (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000 == rep_s,
        (true_s <= rep_s) ==> (
            true_s <= (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000
            && (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000 <= rep_s
        ),
        (rep_s <= true_s) ==> (
            rep_s <= (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000
            && (true_s * (1_000_000 - trust) + rep_s * trust) / 1_000_000 <= true_s
        ),
{
}

pub fn fp_trust_weighted_state(true_state_fp: i64, reported_state_fp: i64, trust_fp: i64) -> (out: i64)
    requires
        0 <= true_state_fp <= FP_ONE,
        0 <= reported_state_fp <= FP_ONE,
        0 <= trust_fp <= FP_ONE,
    ensures
        0 <= out <= FP_ONE,
        out as int == spec_trust_blend(true_state_fp as int, reported_state_fp as int, trust_fp as int),
        trust_fp == 0 ==> out == true_state_fp,
        trust_fp == FP_ONE ==> out == reported_state_fp,
        (true_state_fp <= reported_state_fp) ==> (true_state_fp <= out && out <= reported_state_fp),
        (reported_state_fp <= true_state_fp) ==> (reported_state_fp <= out && out <= true_state_fp),
{
    proof {
        lemma_trust_blend_bounds(true_state_fp as int, reported_state_fp as int, trust_fp as int);
    }
    let inv_trust: i64 = FP_ONE - trust_fp;
    let term_true: i64 = true_state_fp * inv_trust;
    let term_rep: i64 = reported_state_fp * trust_fp;
    let numer: i64 = term_true + term_rep;
    let out: i64 = numer / FP_ONE;
    out
}

// ----------------------------------------------------------------------------
// P-7: Tersinmez Histerezis (Irreversible Hysteresis) ve Kalıcı Kapasite Tavanı
//   Bir kez tetiklenen tersinmez histerezis (latched == true), stres düşse bile
//   asla sıfırlanmaz ve kapasite tavanını [0, FP_ONE - permanent_loss_fp] aralığında tutar.
// ----------------------------------------------------------------------------
#[derive(Copy, Clone)]
pub struct HysteresisState {
    pub latched: bool,
    pub reversible: bool,
    pub threshold_tick: u32,
    pub permanent_loss_fp: i64,
}

pub open spec fn valid_hysteresis(h: HysteresisState) -> bool {
    0 <= h.permanent_loss_fp <= FP_ONE
}

pub open spec fn effective_capacity_ceiling(h: HysteresisState) -> int {
    if h.latched {
        (FP_ONE as int) - (h.permanent_loss_fp as int)
    } else {
        FP_ONE as int
    }
}

pub fn step_hysteresis(
    h: HysteresisState,
    active_stress_ticks: u32,
    stress_cleared: bool,
) -> (next: (HysteresisState, i64))
    requires
        valid_hysteresis(h),
    ensures
        valid_hysteresis(next.0),
        0 <= next.1 <= FP_ONE,
        next.1 as int == effective_capacity_ceiling(next.0),
        // Tersinmezlik teoremi (P-7a): reversible == false ve h.latched == true ise next.0.latched == true
        (!h.reversible && h.latched) ==> next.0.latched,
        // Monoton tavan daralması (P-7b): tersinmez histereziste kapasite tavanı asla artmaz
        (!h.reversible) ==> (effective_capacity_ceiling(next.0) <= effective_capacity_ceiling(h)),
{
    let triggered_now: bool = active_stress_ticks >= h.threshold_tick;
    let next_latched: bool = if !h.reversible {
        h.latched || triggered_now
    } else {
        if stress_cleared {
            false
        } else {
            h.latched || triggered_now
        }
    };

    let next_state = HysteresisState {
        latched: next_latched,
        reversible: h.reversible,
        threshold_tick: h.threshold_tick,
        permanent_loss_fp: h.permanent_loss_fp,
    };

    let ceiling_fp: i64 = if next_latched {
        FP_ONE - h.permanent_loss_fp
    } else {
        FP_ONE
    };

    (next_state, ceiling_fp)
}

// ----------------------------------------------------------------------------
// P-8: Epistemik Sembolik Doğrulama Kapısı (Fail-Closed Hypothesis Gate)
//   Öğrenen/sezgisel katmandan gelen aday kayıtların (hipotez, fallback, gözlem)
//   çekirdek gerçek durumuna (verified fact) yazılıp yazılamayacağını denetler.
//   İspat: Hipotez (is_hypothesis == true), fallback (is_fallback == true),
//   gelecekten veri sızıntısı (learned_time > decision_cutoff) veya provenance eksikliği
//   varsa kapı KESİNLİKLE reddeder (accepted == false).
// ----------------------------------------------------------------------------
pub fn verify_epistemic_promotion_gate(
    has_provenance: bool,
    is_hypothesis: bool,
    is_fallback: bool,
    valid_time_sec: i64,
    learned_time_sec: i64,
    decision_cutoff_sec: i64,
    constraints_ok: bool,
) -> (accepted: bool)
    ensures
        is_hypothesis ==> !accepted,
        is_fallback ==> !accepted,
        !has_provenance ==> !accepted,
        !constraints_ok ==> !accepted,
        (valid_time_sec > decision_cutoff_sec) ==> !accepted,
        (learned_time_sec > decision_cutoff_sec) ==> !accepted,
        accepted <==> (
            has_provenance
            && !is_hypothesis
            && !is_fallback
            && constraints_ok
            && valid_time_sec <= decision_cutoff_sec
            && learned_time_sec <= decision_cutoff_sec
        ),
{
    if !has_provenance {
        return false;
    }
    if is_hypothesis || is_fallback {
        return false;
    }
    if !constraints_ok {
        return false;
    }
    if valid_time_sec > decision_cutoff_sec || learned_time_sec > decision_cutoff_sec {
        return false;
    }
    true
}

} // verus!
