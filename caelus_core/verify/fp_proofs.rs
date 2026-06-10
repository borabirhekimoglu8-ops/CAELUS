// CAELUS OS — İlk makine-denetimli ispatlar (F2-4, Verus/Z3)
//
// Doğrulama: tools\verus\verus-x86-win\verus.exe --crate-type=lib caelus_core\verify\fp_proofs.rs
//
// KAPSAM (ispat kataloğu docs/FIZIBILITE_ISPAT_VE_GOMULU.md §4.1):
//   P-1  fp_add_saturating — TAM fonksiyonel sözleşme: sonuç, matematiksel
//        (sınırsız) toplamın [i64::MIN, i64::MAX] aralığına kenetlenmişidir.
//        Z3 ayrıca her aritmetik işlemin taşmazlığını otomatik yükümlülük
//        olarak denetler (guard'lar olmadan ispat GEÇMEZ).
//   P-4  fp_clamp — TAM fonksiyonel sözleşme + idempotans + sınır üyeliği.
//   P-9  (yardımcı) saturating zincirleme monotonluğu — apply_lever'daki
//        clamp(sat_add(...)) deseninin aralık korunumu (I-1'in çekirdek adımı).
//
// TRANSKRİPSİYON DİSİPLİNİ: Buradaki gövdeler caelus_core/src/fp.rs ile satır
// satır AYNIDIR (Verus, harici crate gövdesini doğrulayamadığı için kopya
// zorunlu). Kayma koruması: src/fp.rs birim testleri + tests/narrowed_model.rs
// B=64 özdeşlik testi davranışı kilitler; bu dosya değişirse fp.rs ile diff'i
// gözden geçirin.
//
// SONRAKİ HEDEF (P-2): fp_mul_div_u64_sat'ın tam sözleşmesi artık KESİN
// biçimde biliniyor (F2-2 keşfi): divisor ≤ 2^63 ∧ a/divisor ≤ cap ⇒
// sonuç == min(cap, ⌊a·b/divisor⌋); her durumda sonuç ≤ cap. Döngü invariantı:
//   result_q·divisor + result_r + (kalan b)·(add_q·divisor + add_r)
//     == a·(işlenmiş b kısmı)  [doyuma kadar]
// nonlinear_arith lemmalarıyla ayrı bir dalga olarak planlanmıştır.

use vstd::prelude::*;

verus! {

// ─────────────────────────────────────────────────────────────────────────────
// P-1 — fp_add_saturating  (src/fp.rs ↔ include/causal_engine.h:121-125)
// ─────────────────────────────────────────────────────────────────────────────

/// Matematiksel doyumlu toplamın spesifikasyonu (sınırsız int üzerinde).
pub open spec fn sat_add_spec(a: int, b: int) -> int {
    if a + b > i64::MAX as int {
        i64::MAX as int
    } else if a + b < i64::MIN as int {
        i64::MIN as int
    } else {
        a + b
    }
}

/// P-1 TEOREMİ: gövde, spesifikasyonu HER (a,b) çifti için gerçekler ve
/// hiçbir ara işlem i64 taşması yapmaz (Z3 otomatik yükümlülüğü).
pub fn fp_add_saturating(a: i64, b: i64) -> (r: i64)
    ensures
        r as int == sat_add_spec(a as int, b as int),
{
    if b > 0 && a > i64::MAX - b {
        i64::MAX
    } else if b < 0 && a < i64::MIN - b {
        i64::MIN
    } else {
        a + b
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// P-4 — fp_clamp  (src/fp.rs ↔ include/causal_engine.h:152-154)
// ─────────────────────────────────────────────────────────────────────────────

pub open spec fn clamp_spec(v: int, lo: int, hi: int) -> int {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// P-4 TEOREMİ: tam fonksiyonel sözleşme + (lo ≤ hi ön koşuluyla) sınır üyeliği.
pub fn fp_clamp(v: i64, lo: i64, hi: i64) -> (r: i64)
    ensures
        r as int == clamp_spec(v as int, lo as int, hi as int),
        lo <= hi ==> lo <= r && r <= hi,
{
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// P-4 yardımcı teoremi: clamp idempotenttir — kenetlenmiş değeri yeniden
/// kenetlemek değiştirmez. (update_trust/apply_lever zincirlerinin temeli.)
pub proof fn clamp_idempotent(v: int, lo: int, hi: int)
    requires
        lo <= hi,
    ensures
        clamp_spec(clamp_spec(v, lo, hi), lo, hi) == clamp_spec(v, lo, hi),
{
}

// ─────────────────────────────────────────────────────────────────────────────
// P-9 (yardımcı) — apply_lever / update_trust desenlerinin aralık korunumu:
// clamp(sat_add(state, delta), 0, cap) HER ZAMAN [0, cap] içindedir.
// İnvariant süpürmesinin (I-1) makine-denetimli çekirdek adımı.
// ─────────────────────────────────────────────────────────────────────────────

pub fn clamped_saturating_step(state: i64, delta: i64, cap: i64) -> (r: i64)
    requires
        cap >= 0,
    ensures
        0 <= r && r <= cap,
        r as int == clamp_spec(sat_add_spec(state as int, delta as int), 0, cap as int),
{
    let s = fp_add_saturating(state, delta);
    fp_clamp(s, 0, cap)
}

} // verus!
