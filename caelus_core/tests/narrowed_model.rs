// F2-2 — P-2 daraltılmış-alan TÜKETİCİ doğrulaması (R-1 azaltması).
//
// fp_mul_div_u64_sat'ın shift-add uzun çarpma + kalan takibi algoritması,
// bit genişliği B parametrik bir transkripsiyon olarak yeniden yazılır
// (tüm sarmal aritmetik mod 2^B maskelenir — orijinaldeki mod 2^64'ün
// daraltılmış karşılığı) ve B=6 alanında TÜKETİCİ taranır.
//
// ── TARAMANIN KEŞİFLERİ (F2 bulgusu — iki kesin ön koşul) ────────────────────
// Sınırsız iddia "sonuç == min(cap, ⌊a·b/d⌋)" YANLIŞTIR. Kesin ön koşullar:
//
//   (1) divisor ≤ 2^(W-1)      — kalan toplamları (result_r+add_r, add_r+add_r)
//       < 2·divisor olduğundan ancak bu koşulla genişliği sarmaz.
//       Karşı-örnek (B=6): a=3,b=22,d=49,cap=1 → result_r 66≡2 (mod 64) →
//       kalan taşması kaçar → 0, oysa min(1,⌊66/49⌋)=1.
//   (2) a / divisor ≤ cap      — başlangıç add_q cap'i aşmamalı; aşarsa
//       koruyucu çıkarmalar sarar, add_q mod-2^W sarabilir.
//       Karşı-örnek (B=6): a=2,b=32,d=1,cap=1 → add_q 2→…→64≡0 → 0 ≠ 1.
//
// İkisi sağlanınca sonuç TAM olarak min(cap, ⌊a·b/d⌋) — HER cap için.
// u64 motor yolu İKİSİNİ DE yapısal olarak sağlar: divisor ya FP_SCALE'dir ya
// bir i64 mutlak değeri (≤ 2^63 = 2^(64-1)); a/divisor > cap yalnız
// fp_div(i64::MIN, ±1e-6)'nın işaret-pozitif teorik ucunda mümkündür (kilitli).
//
// İddialar:
//   P-2a (güvenlik, TÜM girdiler):    sonuç ≤ cap.
//   P-2b (kesinlik, ön koşul altında): a/d ≤ cap ⇒ sonuç == min(cap, ⌊a·b/d⌋).
//   Köşe kilidi:                       keşfedilen davranış belgelenir/kilitlenir.
//   Transkripsiyon koruması:           B=64 modeli == gerçek kod (örneklem).

use caelus_core::fp::fp_mul_div_u64_sat_raw;

/// fp_sat_add_u64'ün B-bit transkripsiyonu (mod 2^B sarmal).
fn sat_add_n(a: u64, b: u64, cap: u64, mask: u64) -> u64 {
    if a > (cap.wrapping_sub(b) & mask) {
        cap
    } else {
        (a.wrapping_add(b)) & mask
    }
}

/// fp_sat_double_u64'ün B-bit transkripsiyonu.
fn sat_double_n(v: u64, cap: u64, mask: u64) -> u64 {
    if v > (cap.wrapping_sub(v) & mask) {
        cap
    } else {
        (v.wrapping_add(v)) & mask
    }
}

/// fp_mul_div_u64_sat'ın B-bit transkripsiyonu — adım adım birebir.
fn mul_div_sat_n(a: u64, mut b: u64, divisor: u64, cap: u64, mask: u64) -> u64 {
    if divisor == 0 || a == 0 || b == 0 || cap == 0 {
        return 0;
    }

    let mut result_q: u64 = 0;
    let mut result_r: u64 = 0;
    let mut add_q: u64 = a / divisor;
    let mut add_r: u64 = a % divisor;

    while b != 0 {
        if (b & 1) != 0 {
            result_q = sat_add_n(result_q, add_q, cap, mask);
            result_r = (result_r.wrapping_add(add_r)) & mask;
            if result_r >= divisor {
                result_r -= divisor;
                result_q = sat_add_n(result_q, 1, cap, mask);
            }
            if result_q >= cap {
                return cap;
            }
        }
        b >>= 1;
        if b == 0 {
            break;
        }

        let carry = add_r >= (divisor.wrapping_sub(add_r) & mask);
        add_r = (add_r.wrapping_add(add_r)) & mask;
        if carry {
            add_r = (add_r.wrapping_sub(divisor)) & mask;
        }
        add_q = sat_double_n(add_q, cap, mask);
        if carry {
            add_q = sat_add_n(add_q, 1, cap, mask);
        }
    }

    if result_q > cap {
        cap
    } else {
        result_q
    }
}

/// Geniş referans: gerçek matematik (B=6 girdileri için u64 içinde taşmasız).
fn wide_reference(a: u64, b: u64, divisor: u64, cap: u64) -> u64 {
    if divisor == 0 || a == 0 || b == 0 || cap == 0 {
        return 0;
    }
    core::cmp::min(cap, (a * b) / divisor)
}

/// P-2a — GÜVENLİK, tüm girdiler: sonuç ≤ cap. B=6'da (a,b,d) tüketici,
/// cap sınır-yoğun küme (küçük cap'ler DAHİL — güvenlik orada da tutmalı).
#[test]
fn p2a_safety_result_never_exceeds_cap_exhaustive_b6() {
    const BITS: u32 = 6;
    let mask: u64 = (1u64 << BITS) - 1;
    let caps = [0u64, 1, 2, 15, 31, 32, 62, 63];

    for a in 0..=mask {
        for b in 0..=mask {
            for divisor in 0..=mask {
                for &cap in &caps {
                    let got = mul_div_sat_n(a, b, divisor, cap, mask);
                    assert!(
                        got <= cap,
                        "P-2a İHLAL: a={a} b={b} d={divisor} cap={cap} → {got} > cap"
                    );
                }
            }
        }
    }
}

/// P-2b — KESİNLİK, keşfedilen iki ön koşul altında, TÜM cap'ler:
///   divisor ≤ 2^(B-1)  ∧  a/divisor ≤ cap  ⇒  sonuç == min(cap, ⌊a·b/d⌋)
/// (Motor yolları her ikisini de yapısal olarak sağlar; bkz. fp.rs sözleşmesi.)
#[test]
fn p2b_exactness_under_precondition_exhaustive_b6() {
    const BITS: u32 = 6;
    let mask: u64 = (1u64 << BITS) - 1;
    let half: u64 = 1u64 << (BITS - 1);
    let caps = [0u64, 1, 2, 15, 31, 32, 62, 63];

    let mut checked: u64 = 0;
    let mut skipped: u64 = 0;
    for a in 0..=mask {
        for b in 0..=mask {
            for divisor in 0..=mask {
                for &cap in &caps {
                    // Ön koşul filtreleri (divisor=0 yolu zaten 0 döner, dahil et)
                    if divisor > half || (divisor != 0 && a / divisor > cap) {
                        skipped += 1;
                        continue;
                    }
                    let got = mul_div_sat_n(a, b, divisor, cap, mask);
                    let want = wide_reference(a, b, divisor, cap);
                    assert_eq!(
                        got, want,
                        "P-2b sapma: a={a} b={b} d={divisor} cap={cap}"
                    );
                    checked += 1;
                }
            }
        }
    }
    // Ön koşul alanı boş olmamalı ve taramanın anlamlı bölümünü kapsamalı.
    assert!(checked > skipped / 2, "ön koşul alanı beklenmedik biçimde dar");
    assert!(checked > 100_000, "tarama beklenenden küçük: {checked}");
}

/// Keşfedilen köşenin kilidi: ön koşul İHLALİNDE (a/divisor > cap) u64
/// ORİJİNALİ min'den küçük sonuç verebilir (C++ ile özdeş davranış).
/// Bu test davranışı BELGELEYİP KİLİTLER — değişirse sadakat bozulmuş demektir.
#[test]
fn documented_corner_precondition_violation() {
    // a=2^63, d=1 → add_q=2^63; cap=1: sat_double koruyucusu sarmal cap-v
    // (2^63+1) yüzünden kaçırır → add_q 2^64 ≡ 0 → sonuç 0 (min=1 olurdu).
    let got = fp_mul_div_u64_sat_raw(1u64 << 63, 2, 1, 1);
    assert_eq!(got, 0, "köşe davranışı değişti — C++ sadakatini doğrula!");

    // Aynı sarma cap=2^63-1'de de tetiklenir (a/d = 2^63 > cap): sonuç 0.
    // Motorda tek teorik erişim yolu fp_div(i64::MIN, ±1e-6) işaret-pozitif ucu.
    let got2 = fp_mul_div_u64_sat_raw(1u64 << 63, 2, 1, i64::MAX as u64);
    assert_eq!(got2, 0, "köşe davranışı değişti — C++ sadakatini doğrula!");

    // P-2a güvenliği köşede bile tutar: sonuç ≤ cap.
    assert!(got <= 1 && got2 <= i64::MAX as u64);

    // Ön koşul SAĞLANINCA aynı büyüklükler TAM: divisor=FP_SCALE (fp_mul yolu).
    let exact = fp_mul_div_u64_sat_raw(1u64 << 63, 2_000_000, 1_000_000, i64::MAX as u64);
    assert_eq!(exact, i64::MAX as u64); // min(2^63-1, 2^64) doyumu
}

/// P-2b genişletilmiş tarama (B=8) — yalnız açık istekle:
///   cargo test --release --features std -- --ignored
#[test]
#[ignore = "büyük tarama; release modda --ignored ile koşun"]
fn p2b_exactness_contract_caps_exhaustive_b8() {
    const BITS: u32 = 8;
    let mask: u64 = (1u64 << BITS) - 1;
    let half: u64 = 1u64 << (BITS - 1);
    let caps = [0u64, 1, 2, 100, 127, 128, 200, 254, 255];

    for a in 0..=mask {
        for b in 0..=mask {
            for divisor in 0..=mask {
                for &cap in &caps {
                    if divisor > half || (divisor != 0 && a / divisor > cap) {
                        continue;
                    }
                    let got = mul_div_sat_n(a, b, divisor, cap, mask);
                    let want = wide_reference(a, b, divisor, cap);
                    assert_eq!(got, want, "B=8 sapma: a={a} b={b} d={divisor} cap={cap}");
                }
            }
        }
    }
}

/// Transkripsiyon kayması koruması: B=64'te daraltılmış model == gerçek kod.
/// (mask = u64::MAX iken maskeler no-op; iki yol aynı semantiğe iner.)
/// Örneklem KISITSIZDIR (küçük cap'ler dahil) — model her girdide gerçek
/// fonksiyonla aynı olmalı; "doğru sonuç" iddiası değil, ÖZDEŞLİK iddiasıdır.
#[test]
fn narrowed_model_at_b64_matches_real_implementation() {
    let mask = u64::MAX;
    let samples = [
        0u64,
        1,
        2,
        999_999,
        1_000_000,
        1_000_001,
        123_456_789,
        u64::MAX / 2,
        u64::MAX - 1,
        u64::MAX,
        1u64 << 63,
        (1u64 << 63) - 1,
    ];
    for &a in &samples {
        for &b in &samples {
            for &divisor in &[1u64, 2, 999_983, 1_000_000, u64::MAX] {
                for &cap in &[1u64, 1_000_000, i64::MAX as u64, 1u64 << 63, u64::MAX] {
                    let got = mul_div_sat_n(a, b, divisor, cap, mask);
                    let want = fp_mul_div_u64_sat_raw(a, b, divisor, cap);
                    assert_eq!(
                        got, want,
                        "B=64 transkripsiyon kayması: a={a} b={b} d={divisor} cap={cap}"
                    );
                }
            }
        }
    }
}
