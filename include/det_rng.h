/**
 * CAELUS OS — Deterministic RNG  (include/det_rng.h)
 *
 * Algorithm: xoshiro256** by Blackman & Vigna (https://prng.di.unimi.it/)
 *   – Fast, excellent statistical quality (BigCrush, PractRand >8 TiB)
 *   – NOT cryptographic — never use for keys, IVs, or nonces.
 *     All crypto paths continue to use the OS CSPRNG (std::random_device /
 *     BCryptGenRandom / getrandom).
 *
 * Purpose: reproducible output in deterministic CI runs when
 *   CAELUS_DET_SEED env var is set.  Production builds leave this unset
 *   and fall back to the OS CSPRNG as before.
 *
 * Seeder: SplitMix64 (Vigna 2015) — maps any 64-bit seed to a
 *   high-quality 256-bit initial state.  Seed 0 is valid.
 */

#pragma once

#include <cstdint>
#include <cstddef>

namespace caelus {

class DetRng {
public:
    /// Construct a reproducible RNG from a 64-bit seed.
    /// The same seed always produces the same sequence on any platform.
    explicit DetRng(uint64_t seed) noexcept {
        // SplitMix64 — expand one seed word into four independent state words.
        for (int i = 0; i < 4; ++i) {
            seed  += 0x9e3779b97f4a7c15ULL;
            uint64_t z = seed;
            z = (z ^ (z >> 30u)) * 0xbf58476d1ce4e5b9ULL;
            z = (z ^ (z >> 27u)) * 0x94d049bb133111ebULL;
            s_[i] = z ^ (z >> 31u);
        }
    }

    /// Advance state and return next 64-bit pseudo-random value.
    uint64_t next() noexcept {
        // xoshiro256** core
        const uint64_t r = rotl(s_[1] * 5u, 7u) * 9u;
        const uint64_t t = s_[1] << 17u;
        s_[2] ^= s_[0];
        s_[3] ^= s_[1];
        s_[1] ^= s_[2];
        s_[0] ^= s_[3];
        s_[2] ^= t;
        s_[3]  = rotl(s_[3], 45u);
        return r;
    }

    /// Fill `n` bytes with pseudo-random data (little-endian word split).
    void fill(uint8_t* out, size_t n) noexcept {
        for (size_t i = 0; i < n;) {
            uint64_t v = next();
            for (int b = 0; b < 8 && i < n; ++b, ++i)
                out[i] = static_cast<uint8_t>((v >> (static_cast<unsigned>(b) * 8u)) & 0xFFu);
        }
    }

private:
    uint64_t s_[4];

    static uint64_t rotl(uint64_t x, unsigned k) noexcept {
        return (x << k) | (x >> (64u - k));
    }
};

} // namespace caelus
