// Deterministik RNG — include/det_rng.h'nin sadık portu.
//
// xoshiro256** (Blackman & Vigna) + SplitMix64 tohumlayıcı.
// KRİPTOGRAFİK DEĞİLDİR — anahtar/nonce için asla kullanılmaz; yalnız
// deterministik simülasyon olasılıkları (lever başarı zarı) içindir.
// Aynı seed her platformda aynı diziyi üretir (yalnız tamsayı sarmal aritmetik).

pub struct DetRng {
    s: [u64; 4],
}

impl DetRng {
    /// SplitMix64 ile 64-bit seed'i 4×64-bit duruma genişletir. Seed 0 geçerlidir.
    pub fn new(mut seed: u64) -> Self {
        let mut s = [0u64; 4];
        let mut i = 0;
        while i < 4 {
            seed = seed.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = seed;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            s[i] = z ^ (z >> 31);
            i += 1;
        }
        Self { s }
    }

    /// xoshiro256** çekirdeği — sonraki 64-bit sözde-rastgele değer.
    pub fn next(&mut self) -> u64 {
        let r = rotl(self.s[1].wrapping_mul(5), 7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = rotl(self.s[3], 45);
        r
    }

    /// n baytı sözde-rastgele doldurur (little-endian kelime bölme).
    pub fn fill(&mut self, out: &mut [u8]) {
        let mut i = 0;
        while i < out.len() {
            let v = self.next();
            let mut b = 0;
            while b < 8 && i < out.len() {
                out[i] = ((v >> (b * 8)) & 0xFF) as u8;
                b += 1;
                i += 1;
            }
        }
    }
}

#[inline]
fn rotl(x: u64, k: u32) -> u64 {
    (x << k) | (x >> (64 - k))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ÇAPRAZ-İMPLEMENTASYON VEKTÖRÜ: tests/golden/bs0{1,2,3}_expected.json
    /// lever_expectations.det_roll_fp değerleri, C++ motorunun
    /// DetRng(0xCAE105DEADBEEF00 + tick).next() % 1_000_000 çıktısından
    /// türetilmiştir. Bu test Rust portunun C++ ile AYNI zarı attığını kanıtlar.
    #[test]
    fn det_rolls_match_cpp_golden_vectors() {
        const SEED: u64 = 0xCAE1_05DE_ADBE_EF00;
        let expected: [(u64, u64); 5] = [
            (3, 650_030),
            (4, 511_421),
            (5, 153_915),
            (6, 22_320),
            (7, 918_411), // BS-02 L-05_BUMERANG (BASARISIZ vakası)
        ];
        for (tick, roll) in expected {
            let mut rng = DetRng::new(SEED.wrapping_add(tick));
            assert_eq!(rng.next() % 1_000_000, roll, "tick={tick}");
        }
    }

    #[test]
    fn same_seed_same_sequence() {
        let mut a = DetRng::new(42);
        let mut b = DetRng::new(42);
        for _ in 0..64 {
            assert_eq!(a.next(), b.next());
        }
    }

    #[test]
    fn fill_covers_exact_length() {
        let mut rng = DetRng::new(7);
        let mut buf = [0u8; 13];
        rng.fill(&mut buf);
        // 13 bayt: en az biri sıfırdan farklı olmalı (pratikte hepsi rastgele)
        assert!(buf.iter().any(|&x| x != 0));
    }
}
