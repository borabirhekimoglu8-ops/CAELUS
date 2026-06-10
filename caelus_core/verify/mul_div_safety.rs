// CAELUS OS — P-2a EVRENSEL GÜVENLİK İSPATI (ispat dalgası 2, Verus/Z3)
//
// Doğrulama: tools\verus\verus-x86-win\verus.exe --crate-type=lib caelus_core\verify\mul_div_safety.rs
//
// TEOREM (P-2a, tam u64 genişliği, ÖN KOŞULSUZ — her girdi):
//     fp_mul_div_u64_sat(a, b, divisor, cap) ≤ cap
//
// Bu, F2-2 daraltılmış-alan taramasının "güvenlik her durumda tutar" gözleminin
// makine-denetimli, evrensel hâlidir: tarama B=6/B=8'de tüketiciydi; bu ispat
// 2^256 büyüklüğündeki tam girdi uzayını Z3 ile kapatır.
//
// İspat yapısı: aritmetik ANLAM iddiası yoktur (o P-2b'dir; kesin ön koşulları
// tests/narrowed_model.rs'te belgelidir). Yalnız sınır güvenliği kanıtlanır:
//   • Döngü başı invariantı: result_q < cap.
//     (sat_add sonucu cap'i aşabilir — sarmal koruyucu kaçırabilir — ama her
//     bit adımının sonundaki `result_q >= cap → return cap` kapısı invariantı
//     bir sonraki tura taşır.)
//   • Çıkış: result_q < cap doğrudan, erken dönüşler cap döndürür.
//
// TRANSKRİPSİYON DİSİPLİNİ: gövde src/fp.rs ile satır satır aynıdır
// (sarmal aritmetik dahil); davranış kilidi tests/narrowed_model.rs B=64
// özdeşlik testindedir.

use vstd::prelude::*;

verus! {

/// fp_sat_add_u64 transkripsiyonu. Güvenlik ispatı için sözleşme gerektirmez
/// (sonucu çağıran taraftaki cap kapısı sınırlar); yalnız panik-özgürlük
/// (sarmal aritmetik) Z3 yükümlülüğüdür.
fn fp_sat_add_u64(a: u64, b: u64, cap: u64) -> u64 {
    if a > cap.wrapping_sub(b) {
        cap
    } else {
        a.wrapping_add(b)
    }
}

/// fp_sat_double_u64 transkripsiyonu.
fn fp_sat_double_u64(v: u64, cap: u64) -> u64 {
    if v > cap.wrapping_sub(v) {
        cap
    } else {
        v.wrapping_add(v)
    }
}

/// P-2a TEOREMİ — her (a, b, divisor, cap) için sonuç ≤ cap.
pub fn fp_mul_div_u64_sat(a: u64, b0: u64, divisor: u64, cap: u64) -> (r: u64)
    ensures
        r <= cap,
{
    if divisor == 0 || a == 0 || b0 == 0 || cap == 0 {
        return 0;
    }

    let mut b: u64 = b0;
    let mut result_q: u64 = 0;
    let mut result_r: u64 = 0;
    let mut add_q: u64 = a / divisor;
    let mut add_r: u64 = a % divisor;

    while b != 0
        invariant
            cap >= 1,
            divisor >= 1,
            result_q < cap,
        decreases b,
    {
        if (b & 1) != 0 {
            result_q = fp_sat_add_u64(result_q, add_q, cap);
            result_r = result_r.wrapping_add(add_r);
            if result_r >= divisor {
                result_r = result_r - divisor;
                result_q = fp_sat_add_u64(result_q, 1, cap);
            }
            if result_q >= cap {
                return cap;
            }
        }
        proof {
            // decreases yükümlülüğü: b != 0 iken sağa kaydırma kesin azaltır.
            // Lineer aritmetik kaydırmayı görmez; bit-vector çözücüye devret.
            assert((b >> 1u64) < b) by (bit_vector)
                requires
                    b != 0u64,
            ;
        }
        b = b >> 1;
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

} // verus!
