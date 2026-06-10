// Sabit nokta aritmetiği — include/causal_engine.h:48-173'ün sadık portu.
//
// Tüm değerler i64 × 1e6 (FP_SCALE). Çarpma/bölme ara-taşmasız, doyumlu
// (saturating) uzun aritmetikle yapılır; IEEE 754'e hiçbir hesap yolu girmez
// (yalnız fp_to_d/d_to_fp sınırda dönüşüm yapar — C++ ile aynı cast kuralları).
//
// C++ tarafında işaretsiz aritmetik mod-2^64 sarmalıdır; Rust portu aynı
// semantiği wrapping_* ile AÇIKÇA yazar (debug build'de panik farkı olmasın).

pub const FP_SCALE: i64 = 1_000_000;
pub const FP_ONE: i64 = FP_SCALE;

/// Motor sürtünme tavanı — FRICTION_MULTIPLIER_MAX ile hizalı (3.0x).
pub const FRICTION_MIN_FP: i64 = FP_ONE;
pub const FRICTION_MAX_FP: i64 = 3 * FP_SCALE;
/// Throughput=0 sentinel (akış tıkanması, rejim aşımı).
pub const FRICTION_OUTAGE_FP: i64 = 1000 * FP_SCALE;

const FP_I64_MAX: i64 = i64::MAX;
const FP_I64_MIN: i64 = i64::MIN;
const FP_I64_MIN_MAG: u64 = 1u64 << 63;

#[inline]
const fn fp_abs_u64(v: i64) -> u64 {
    // C++: v < 0 ? (uint64_t)(-(v+1)) + 1 : (uint64_t)v
    // i64::MIN için bile taşmasız: -(MIN+1) = MAX, +1 → 2^63.
    if v < 0 {
        ((-(v + 1)) as u64) + 1
    } else {
        v as u64
    }
}

#[inline]
const fn fp_sat_add_u64(a: u64, b: u64, cap: u64) -> u64 {
    // C++ `a > cap - b` ve `a + b` ifadeleri mod-2^64 sarmalı; birebir koru
    // (wrapping_add: b > cap iken guard'ın kaçırdığı uç girdilerde C++ sessizce
    // sarar — Rust debug paniği sadakati bozardı; bkz. sözleşme notu aşağıda).
    if a > cap.wrapping_sub(b) {
        cap
    } else {
        a.wrapping_add(b)
    }
}

#[inline]
const fn fp_sat_double_u64(v: u64, cap: u64) -> u64 {
    if v > cap.wrapping_sub(v) {
        cap
    } else {
        v.wrapping_add(v)
    }
}

/// min(cap, floor((a*b)/divisor)) — a*b ARA ÇARPIMI HİÇ OLUŞTURULMADAN.
/// C++ shift-add uzun çarpma + kalan takibi (causal_engine.h:76-107) birebir.
///
/// SÖZLEŞME (F2-2 daraltılmış-alan taramasının KEŞFİ — C++'ta da aynen geçerli):
///   • Her girdi için GARANTİ (P-2a): sonuç ≤ cap (doyum güvenliği).
///   • TAM DOĞRULUK (P-2b): divisor ≤ 2^63 ∧ a/divisor ≤ cap
///       ⇒ sonuç == min(cap, ⌊a·b/divisor⌋).
///     Gerekçe (1): divisor ≤ 2^63 ⇒ kalan toplamları (result_r+add_r ve
///     add_r+add_r) < 2·divisor ≤ 2^64 → kalan yolu HİÇ sarmaz. Motor için
///     otomatiktir: divisor ya FP_SCALE'dir ya da bir i64 mutlak değeri (≤2^63).
///     Gerekçe (2): başlangıç add_q = a/divisor cap'i aşmazsa sat_double/sat_add
///     koruyucularındaki cap-b/cap-v çıkarmaları hiç sarmaz, add_q ≤ cap
///     invariantı korunur ve cap'e kenetlenme matematiksel min ile çakışır.
///   • Ön koşul İHLAL edilirse (a/divisor > cap — yalnız a=2^63 ∧ divisor=1 ∧
///     cap=2^63-1 ile mümkün; motor yolunda fp_div(i64::MIN, ±1e-6'nın işaret-
///     pozitif ucu dışında İMKÂNSIZ) add_q mod-2^64 sarabilir ve sonuç min'den
///     KÜÇÜK (ama yine ≤ cap) çıkabilir. Köşe tests/narrowed_model.rs'te
///     kilitlenmiştir; fp_mul her zaman divisor=FP_SCALE kullandığından muaftır.
#[inline]
const fn fp_mul_div_u64_sat(a: u64, mut b: u64, divisor: u64, cap: u64) -> u64 {
    if divisor == 0 || a == 0 || b == 0 || cap == 0 {
        return 0;
    }

    let mut result_q: u64 = 0;
    let mut result_r: u64 = 0;
    let mut add_q: u64 = a / divisor;
    let mut add_r: u64 = a % divisor;

    while b != 0 {
        if (b & 1) != 0 {
            result_q = fp_sat_add_u64(result_q, add_q, cap);
            result_r = result_r.wrapping_add(add_r); // add_r < divisor → < 2*divisor kalır
            if result_r >= divisor {
                result_r -= divisor;
                result_q = fp_sat_add_u64(result_q, 1, cap);
            }
            if result_q >= cap {
                return cap;
            }
        }
        b >>= 1;
        if b == 0 {
            break;
        }

        let carry = add_r >= divisor.wrapping_sub(add_r);
        add_r = add_r.wrapping_add(add_r);
        if carry {
            add_r = add_r.wrapping_sub(divisor);
        }
        add_q = fp_sat_double_u64(add_q, cap);
        if carry {
            add_q = fp_sat_add_u64(add_q, 1, cap);
        }
    }

    if result_q > cap {
        cap
    } else {
        result_q
    }
}

#[inline]
const fn fp_from_signed_mag(mag: u64, negative: bool) -> i64 {
    if !negative {
        if mag > FP_I64_MAX as u64 {
            return FP_I64_MAX;
        }
        return mag as i64;
    }
    if mag >= FP_I64_MIN_MAG {
        return FP_I64_MIN;
    }
    -(mag as i64)
}

/// Ham uzun-çarpma çekirdeğine test erişimi (F2 daraltılmış-model doğrulaması
/// transkripsiyon kaymasını bununla yakalar). Üretim API'si değildir.
#[doc(hidden)]
pub const fn fp_mul_div_u64_sat_raw(a: u64, b: u64, divisor: u64, cap: u64) -> u64 {
    fp_mul_div_u64_sat(a, b, divisor, cap)
}

#[inline]
pub const fn fp_add_saturating(a: i64, b: i64) -> i64 {
    if b > 0 && a > FP_I64_MAX - b {
        return FP_I64_MAX;
    }
    if b < 0 && a < FP_I64_MIN - b {
        return FP_I64_MIN;
    }
    a + b
}

#[inline]
pub const fn fp_mul(a: i64, b: i64) -> i64 {
    let negative = (a < 0) != (b < 0);
    let cap = if negative {
        FP_I64_MIN_MAG
    } else {
        FP_I64_MAX as u64
    };
    let mag = fp_mul_div_u64_sat(fp_abs_u64(a), fp_abs_u64(b), FP_SCALE as u64, cap);
    fp_from_signed_mag(mag, negative)
}

#[inline]
pub const fn fp_div(a: i64, b: i64) -> i64 {
    if b == 0 {
        return 0;
    }
    let negative = (a < 0) != (b < 0);
    let cap = if negative {
        FP_I64_MIN_MAG
    } else {
        FP_I64_MAX as u64
    };
    let mag = fp_mul_div_u64_sat(fp_abs_u64(a), FP_SCALE as u64, fp_abs_u64(b), cap);
    fp_from_signed_mag(mag, negative)
}

#[inline]
pub const fn fp_clamp(v: i64, lo: i64, hi: i64) -> i64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

#[inline]
pub fn fp_to_d(v: i64) -> f64 {
    (v as f64) / (FP_SCALE as f64)
}

#[inline]
pub fn d_to_fp(v: f64) -> i64 {
    if v.is_nan() {
        return 0;
    }
    if v >= (FP_I64_MAX as f64) / (FP_SCALE as f64) {
        return FP_I64_MAX;
    }
    if v <= (FP_I64_MIN as f64) / (FP_SCALE as f64) {
        return FP_I64_MIN;
    }
    (v * (FP_SCALE as f64)) as i64
}

// ─── Birim testleri (tests/test_causal_engine.cpp doctest vakalarını aynalar) ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_point_arithmetic_handles_normal_values() {
        // 1.5 × 2.0 = 3.0
        assert_eq!(fp_mul(1_500_000, 2_000_000), 3_000_000);
        // 3.0 / 2.0 = 1.5
        assert_eq!(fp_div(3_000_000, 2_000_000), 1_500_000);
        // 0.35 × 0.93 = 0.3255
        assert_eq!(fp_mul(350_000, 930_000), 325_500);
        // bölme: 0.65 / 1.0 = 0.65
        assert_eq!(fp_div(650_000, FP_ONE), 650_000);
        // toplama
        assert_eq!(fp_add_saturating(1_000_000, 2_000_000), 3_000_000);
        assert_eq!(fp_add_saturating(-1_000_000, 500_000), -500_000);
    }

    #[test]
    fn fixed_point_arithmetic_saturates_near_int64_limits() {
        assert_eq!(fp_add_saturating(i64::MAX, 1), i64::MAX);
        assert_eq!(fp_add_saturating(i64::MIN, -1), i64::MIN);
        assert_eq!(fp_add_saturating(i64::MAX - 5, 10), i64::MAX);
        // Büyük çarpım doyar, taşmaz
        assert_eq!(fp_mul(i64::MAX, 2_000_000), i64::MAX);
        assert_eq!(fp_mul(i64::MAX, -2_000_000), i64::MIN);
        assert_eq!(fp_mul(i64::MIN, 2_000_000), i64::MIN);
        // div 0 → 0 (total function)
        assert_eq!(fp_div(123_456, 0), 0);
        // Negatif büyüklük tavanı 2^63
        assert_eq!(fp_div(i64::MIN, 1), i64::MIN);
    }

    #[test]
    fn double_conversion_clamps_non_finite_and_huge_inputs() {
        assert_eq!(d_to_fp(f64::NAN), 0);
        assert_eq!(d_to_fp(f64::INFINITY), i64::MAX);
        assert_eq!(d_to_fp(f64::NEG_INFINITY), i64::MIN);
        assert_eq!(d_to_fp(1e30), i64::MAX);
        assert_eq!(d_to_fp(-1e30), i64::MIN);
        assert_eq!(d_to_fp(0.82), 820_000);
        assert_eq!(d_to_fp(0.0), 0);
        // sıfıra doğru kırpma (C++ static_cast)
        assert_eq!(d_to_fp(0.2999999), 299_999);
    }

    #[test]
    fn mul_div_against_wide_reference() {
        // 128-bit referansla karşılaştır: rastgele olmayan, sınır-yoğun ızgara
        let samples: [i64; 9] = [
            0,
            1,
            -1,
            999_999,
            1_000_001,
            123_456_789,
            -987_654_321,
            i64::MAX / 2,
            i64::MIN / 2,
        ];
        for &a in &samples {
            for &b in &samples {
                let wide = (a as i128) * (b as i128) / (FP_SCALE as i128);
                let expect = if wide > i64::MAX as i128 {
                    i64::MAX
                } else if wide < i64::MIN as i128 {
                    i64::MIN
                } else {
                    wide as i64
                };
                assert_eq!(fp_mul(a, b), expect, "fp_mul({a},{b})");
            }
        }
    }
}
