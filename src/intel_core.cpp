/**
 * CAELUS OS — Intel-Core Operational Risk & Friction Module
 * Real, self-tested AES-256 (FIPS-197) + deterministic operational-risk model.
 */

#include "intel_core.h"
#include "../include/det_rng.h"
#include <iostream>
#include <iomanip>
#include <fstream>
#include <sstream>
#include <cstring>
#include <cstdlib>
#include <random>
#include <algorithm>

namespace caelus {
namespace intel {

// ─── AES S-boxes and round constants ─────────────────────────────────────────
static const uint8_t sbox[256] = {
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
};

static const uint8_t rsbox[256] = {
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
    0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
    0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
    0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
    0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
    0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
    0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
    0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
    0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
    0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
    0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
    0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
    0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
    0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
    0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d
};

static const uint8_t Rcon[11] = {
    0x8d, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36
};

// ─── GF(2^8) helpers ─────────────────────────────────────────────────────────
static inline uint8_t xtime(uint8_t x) {
    return static_cast<uint8_t>((x << 1) ^ (((x >> 7) & 1) * 0x1b));
}

static uint8_t gmul(uint8_t x, uint8_t y) {
    uint8_t r = 0;
    for (int i = 0; i < 8; ++i) {
        if (y & 1) r ^= x;
        uint8_t hi = x & 0x80;
        x = static_cast<uint8_t>(x << 1);
        if (hi) x ^= 0x1b;
        y >>= 1;
    }
    return r;
}

// ─── AES-256 context (full FIPS-197 cipher / inverse cipher) ────────────────────
struct ProfileManager::AesContext {
    static constexpr int Nb = 4;
    static constexpr int Nr = 14; // AES-256
    static constexpr int Nk = 8;
    uint8_t RoundKey[240];

    // State byte at (row r, col c) lives at index c*4 + r (column-major, FIPS-197).
    void KeyExpansion(const uint8_t* Key) {
        unsigned i, j, k;
        uint8_t tempa[4];
        for (i = 0; i < (unsigned)Nk; ++i) {
            RoundKey[(i * 4) + 0] = Key[(i * 4) + 0];
            RoundKey[(i * 4) + 1] = Key[(i * 4) + 1];
            RoundKey[(i * 4) + 2] = Key[(i * 4) + 2];
            RoundKey[(i * 4) + 3] = Key[(i * 4) + 3];
        }
        for (i = Nk; i < (unsigned)(Nb * (Nr + 1)); ++i) {
            k = (i - 1) * 4;
            tempa[0] = RoundKey[k + 0];
            tempa[1] = RoundKey[k + 1];
            tempa[2] = RoundKey[k + 2];
            tempa[3] = RoundKey[k + 3];
            if (i % Nk == 0) {
                const uint8_t u8tmp = tempa[0];
                tempa[0] = sbox[tempa[1]] ^ Rcon[i / Nk];
                tempa[1] = sbox[tempa[2]];
                tempa[2] = sbox[tempa[3]];
                tempa[3] = sbox[u8tmp];
            }
            if (i % Nk == 4) {
                tempa[0] = sbox[tempa[0]];
                tempa[1] = sbox[tempa[1]];
                tempa[2] = sbox[tempa[2]];
                tempa[3] = sbox[tempa[3]];
            }
            j = i * 4; k = (i - Nk) * 4;
            RoundKey[j + 0] = RoundKey[k + 0] ^ tempa[0];
            RoundKey[j + 1] = RoundKey[k + 1] ^ tempa[1];
            RoundKey[j + 2] = RoundKey[k + 2] ^ tempa[2];
            RoundKey[j + 3] = RoundKey[k + 3] ^ tempa[3];
        }
    }

    void AddRoundKey(int round, uint8_t* s) const {
        for (int i = 0; i < 16; ++i) s[i] ^= RoundKey[round * 16 + i];
    }
    static void SubBytes(uint8_t* s) { for (int i = 0; i < 16; ++i) s[i] = sbox[s[i]]; }
    static void InvSubBytes(uint8_t* s) { for (int i = 0; i < 16; ++i) s[i] = rsbox[s[i]]; }

    static void ShiftRows(uint8_t* s) {
        uint8_t t;
        t = s[1];  s[1]  = s[5];  s[5]  = s[9];  s[9]  = s[13]; s[13] = t;        // row 1 <<1
        t = s[2];  s[2]  = s[10]; s[10] = t;     t = s[6]; s[6] = s[14]; s[14] = t; // row 2 <<2
        t = s[15]; s[15] = s[11]; s[11] = s[7];  s[7]  = s[3];  s[3]  = t;        // row 3 <<3
    }
    static void InvShiftRows(uint8_t* s) {
        uint8_t t;
        t = s[13]; s[13] = s[9];  s[9]  = s[5];  s[5]  = s[1];  s[1]  = t;        // row 1 >>1
        t = s[2];  s[2]  = s[10]; s[10] = t;     t = s[6]; s[6] = s[14]; s[14] = t; // row 2 >>2
        t = s[3];  s[3]  = s[7];  s[7]  = s[11]; s[11] = s[15]; s[15] = t;        // row 3 >>3
    }

    static void MixColumns(uint8_t* s) {
        for (int c = 0; c < 4; ++c) {
            uint8_t* col = s + c * 4;
            uint8_t t = col[0];
            uint8_t all = col[0] ^ col[1] ^ col[2] ^ col[3];
            col[0] ^= static_cast<uint8_t>(xtime(col[0] ^ col[1]) ^ all);
            col[1] ^= static_cast<uint8_t>(xtime(col[1] ^ col[2]) ^ all);
            col[2] ^= static_cast<uint8_t>(xtime(col[2] ^ col[3]) ^ all);
            col[3] ^= static_cast<uint8_t>(xtime(col[3] ^ t)     ^ all);
        }
    }
    static void InvMixColumns(uint8_t* s) {
        for (int c = 0; c < 4; ++c) {
            uint8_t* col = s + c * 4;
            uint8_t a = col[0], b = col[1], cc = col[2], d = col[3];
            col[0] = gmul(a, 0x0e) ^ gmul(b, 0x0b) ^ gmul(cc, 0x0d) ^ gmul(d, 0x09);
            col[1] = gmul(a, 0x09) ^ gmul(b, 0x0e) ^ gmul(cc, 0x0b) ^ gmul(d, 0x0d);
            col[2] = gmul(a, 0x0d) ^ gmul(b, 0x09) ^ gmul(cc, 0x0e) ^ gmul(d, 0x0b);
            col[3] = gmul(a, 0x0b) ^ gmul(b, 0x0d) ^ gmul(cc, 0x09) ^ gmul(d, 0x0e);
        }
    }

    void EncryptBlock(uint8_t* s) const {
        AddRoundKey(0, s);
        for (int round = 1; round < Nr; ++round) {
            SubBytes(s); ShiftRows(s); MixColumns(s); AddRoundKey(round, s);
        }
        SubBytes(s); ShiftRows(s); AddRoundKey(Nr, s);
    }
    void DecryptBlock(uint8_t* s) const {
        AddRoundKey(Nr, s);
        for (int round = Nr - 1; round > 0; --round) {
            InvShiftRows(s); InvSubBytes(s); AddRoundKey(round, s); InvMixColumns(s);
        }
        InvShiftRows(s); InvSubBytes(s); AddRoundKey(0, s);
    }
};

// ─── Local helpers ────────────────────────────────────────────────────────────
namespace {

void csprng_fill(uint8_t* out, size_t n) {
    // When CAELUS_DET_SEED is set, use the seeded xoshiro256** PRNG so that
    // AES-CBC IVs and ephemeral keys are reproducible across CI runs.
    // In production this env var is NEVER set; the OS CSPRNG is used instead.
    const char* det_env = std::getenv("CAELUS_DET_SEED");
    if (det_env && det_env[0]) {
        uint64_t seed = std::strtoull(det_env, nullptr, 0);
        caelus::DetRng rng(seed);
        rng.fill(out, n);
        return;
    }
    // Production path: OS CSPRNG.
    // BCryptGenRandom / getrandom is preferred in HSM-hardened deployments.
    std::random_device rd;
    size_t i = 0;
    while (i < n) {
        unsigned int r = rd();
        for (int b = 0; b < 4 && i < n; ++b, ++i)
            out[i] = static_cast<uint8_t>((r >> (b * 8)) & 0xFF);
    }
}

bool parse_hex_key(const char* hex, uint8_t out[32]) {
    if (!hex) return false;
    size_t len = std::strlen(hex);
    if (len != 64) return false;
    auto nib = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (int i = 0; i < 32; ++i) {
        int hi = nib(hex[i * 2]);
        int lo = nib(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

double clamp01(double v) {
    if (v < 0.0) return 0.0;
    if (v > 1.0) return 1.0;
    return v;
}

} // namespace

// FIPS-197 AES-256 ECB known-answer test (this is a published test vector, NOT a
// production secret) — proves the cipher implementation is correct in both
// directions before any real key is used. Member function so it can construct
// the private AesContext.
bool ProfileManager::RunAes256Kat() {
    const uint8_t key[32] = {
        0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f,
        0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x1a,0x1b,0x1c,0x1d,0x1e,0x1f
    };
    const uint8_t pt[16] = {
        0x00,0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff
    };
    const uint8_t ct[16] = {
        0x8e,0xa2,0xb7,0xca,0x51,0x67,0x45,0xbf,0xea,0xfc,0x49,0x90,0x4b,0x49,0x60,0x89
    };
    AesContext ctx;
    ctx.KeyExpansion(key);
    uint8_t blk[16];
    std::memcpy(blk, pt, 16);
    ctx.EncryptBlock(blk);
    if (std::memcmp(blk, ct, 16) != 0) return false;
    ctx.DecryptBlock(blk);
    return std::memcmp(blk, pt, 16) == 0;
}

// ─── ProfileManager lifecycle ───────────────────────────────────────────────────
ProfileManager::ProfileManager() : aes_ctx_(std::make_unique<AesContext>()) {
    InitializeSecureEnclave();
}

ProfileManager::~ProfileManager() {
    if (aes_ctx_) std::memset(aes_ctx_->RoundKey, 0, sizeof(aes_ctx_->RoundKey));
}

void ProfileManager::InitializeSecureEnclave() {
    std::cout << "\n[INTEL-CORE] -- Security Enclave -------------------------\n";

    // 1) Validate the AES-256 implementation with a known-answer test.
    crypto_ok_ = RunAes256Kat();
    std::cout << "[INTEL-CORE] AES-256 self-test (FIPS-197 KAT): "
              << (crypto_ok_ ? "PASS" : "FAIL") << "\n";

    // 2) Acquire the enclave key. NO hard-coded production key.
    uint8_t key[32] = {0};
    const char* env = std::getenv("CAELUS_ENCLAVE_KEY");
    if (parse_hex_key(env, key)) {
        enclave_mode_ = "env-provided (CAELUS_ENCLAVE_KEY)";
    } else {
        csprng_fill(key, 32);
        enclave_mode_ = "ephemeral (UNCONFIGURED — set CAELUS_ENCLAVE_KEY for at-rest decryption)";
    }
    std::cout << "[INTEL-CORE] Enclave key: " << enclave_mode_ << "\n";

    aes_ctx_->KeyExpansion(key);
    std::memset(key, 0, sizeof(key)); // wipe the raw key from the stack

    // 3) Exercise CBC end-to-end (round-trip) so the path is proven, not dead code.
    if (crypto_ok_) {
        std::vector<uint8_t> sample = {'C','A','E','L','U','S','-','C','B','C','-','S','E','L','F'};
        auto enc = EncryptCBC(sample);
        auto dec = DecryptCBC(enc);
        bool cbc_ok = (dec == sample);
        std::cout << "[INTEL-CORE] AES-256-CBC round-trip: " << (cbc_ok ? "PASS" : "FAIL") << "\n";
        crypto_ok_ = crypto_ok_ && cbc_ok;
    }
}

bool ProfileManager::CryptoSelfTestPassed() const { return crypto_ok_; }
const std::string& ProfileManager::EnclaveMode() const { return enclave_mode_; }

// ─── Real AES-256-CBC (PKCS#7) ───────────────────────────────────────────────────
std::vector<uint8_t> ProfileManager::EncryptCBC(const std::vector<uint8_t>& plaintext) const {
    uint8_t iv[16];
    csprng_fill(iv, 16);

    std::vector<uint8_t> out(iv, iv + 16);
    std::vector<uint8_t> buf = plaintext;

    // PKCS#7 padding to a 16-byte boundary.
    uint8_t pad = static_cast<uint8_t>(16 - (buf.size() % 16));
    buf.insert(buf.end(), pad, pad);

    uint8_t prev[16];
    std::memcpy(prev, iv, 16);
    for (size_t off = 0; off < buf.size(); off += 16) {
        uint8_t block[16];
        for (int i = 0; i < 16; ++i) block[i] = buf[off + i] ^ prev[i];
        aes_ctx_->EncryptBlock(block);
        out.insert(out.end(), block, block + 16);
        std::memcpy(prev, block, 16);
    }
    return out;
}

std::vector<uint8_t> ProfileManager::DecryptCBC(const std::vector<uint8_t>& ciphertext) const {
    // Need IV (16) + at least one ciphertext block, total a multiple of 16.
    if (ciphertext.size() < 32 || (ciphertext.size() % 16) != 0) return {};

    uint8_t prev[16];
    std::memcpy(prev, ciphertext.data(), 16);

    std::vector<uint8_t> out;
    out.reserve(ciphertext.size() - 16);
    for (size_t off = 16; off < ciphertext.size(); off += 16) {
        uint8_t block[16];
        std::memcpy(block, ciphertext.data() + off, 16);
        uint8_t cipher_block[16];
        std::memcpy(cipher_block, block, 16);
        aes_ctx_->DecryptBlock(block);
        for (int i = 0; i < 16; ++i) out.push_back(block[i] ^ prev[i]);
        std::memcpy(prev, cipher_block, 16);
    }

    // Validate + strip PKCS#7 padding.
    if (out.empty()) return {};
    uint8_t pad = out.back();
    if (pad == 0 || pad > 16 || pad > out.size()) return {};
    for (size_t i = 0; i < pad; ++i) {
        if (out[out.size() - 1 - i] != pad) return {};
    }
    out.resize(out.size() - pad);
    return out;
}

// ─── Operational profile loading ─────────────────────────────────────────────────
OperationalRiskProfile ProfileManager::BuiltinBaseline(const std::string& scenario_id) const {
    // Sektör-agnostik EVRENSEL NÖTR profil. Bir dış JSON senaryo paketi
    // yüklenmediği sürece motor "AWAITING SCENARIO INJECTION" durumundadır:
    // tüm risk boyutları 0.0 (sıfır akış), bölge "UNIVERSAL". Gerçek risk
    // değerleri yalnızca paketin v1_engine_bridge.operational_risk_profile
    // alanından gelir; burada hiçbir yerel/sektörel taban gömülü değildir.
    OperationalRiskProfile p;
    p.scenario_id = scenario_id;
    p.region = "UNIVERSAL";
    p.bureaucratic_complexity  = 0.0;
    p.historical_delay_rate    = 0.0;
    p.labor_action_probability = 0.0;
    p.route_congestion         = 0.0;
    p.weather_severity         = 0.0;
    return p;
}

std::unique_ptr<OperationalRiskProfile> ProfileManager::LoadProfile(const std::string& scenario_id) {
    std::cout << "\n[INTEL-CORE] -- Operational Profile Load -----------------\n";
    auto profile = std::make_unique<OperationalRiskProfile>(BuiltinBaseline(scenario_id));

    // Optional encrypted override: profiles/<scenario_id>.bin (AES-256-CBC).
    const std::string path = "profiles/" + scenario_id + ".bin";
    std::ifstream f(path, std::ios::binary);
    if (f && crypto_ok_) {
        std::vector<uint8_t> blob((std::istreambuf_iterator<char>(f)),
                                  std::istreambuf_iterator<char>());
        std::vector<uint8_t> plain = DecryptCBC(blob);
        if (!plain.empty()) {
            std::string text(plain.begin(), plain.end());
            std::istringstream ss(text);
            std::string line;
            while (std::getline(ss, line)) {
                auto eq = line.find('=');
                if (eq == std::string::npos) continue;
                std::string key = line.substr(0, eq);
                std::string val = line.substr(eq + 1);
                try {
                    if (key == "bureaucratic_complexity")  profile->bureaucratic_complexity = clamp01(std::stod(val));
                    else if (key == "historical_delay_rate")    profile->historical_delay_rate = clamp01(std::stod(val));
                    else if (key == "labor_action_probability") profile->labor_action_probability = clamp01(std::stod(val));
                    else if (key == "route_congestion")         profile->route_congestion = clamp01(std::stod(val));
                    else if (key == "weather_severity")         profile->weather_severity = clamp01(std::stod(val));
                    else if (key == "region")                   profile->region = val;
                } catch (const std::exception&) {
                    // Ignore malformed numeric fields; baseline value is retained.
                }
            }
            std::cout << "[INTEL-CORE] Decrypted operational profile from " << path << "\n";
        } else {
            std::cout << "[INTEL-CORE] " << path << " present but could not be decrypted; using baseline.\n";
        }
    } else {
        std::cout << "[INTEL-CORE] No encrypted override found; using built-in baseline for "
                  << scenario_id << ".\n";
    }

    std::cout << "[INTEL-CORE] Scenario: " << profile->scenario_id
              << " (" << profile->region << ")\n";
    return profile;
}

double ProfileManager::CalculateFrictionMultiplier(const OperationalRiskProfile& profile,
                                                   bool*   regime_exceeded,
                                                   double* raw_out) const {
    std::cout << "\n[INTEL-CORE] -- Deterministic Friction Calculation -------\n";
    std::cout << std::fixed << std::setprecision(2);
    std::cout << "[INTEL-CORE] -> Bureaucratic complexity : " << profile.bureaucratic_complexity << "\n";
    std::cout << "[INTEL-CORE] -> Historical delay rate    : " << profile.historical_delay_rate << "\n";
    std::cout << "[INTEL-CORE] -> Labour action probability: " << profile.labor_action_probability << "\n";
    std::cout << "[INTEL-CORE] -> Route congestion         : " << profile.route_congestion << "\n";
    std::cout << "[INTEL-CORE] -> Weather severity         : " << profile.weather_severity << "\n";

    // Compute raw (unclamped) multiplier first so callers can detect saturation.
    double raw = 1.0;
    raw += clamp01(profile.bureaucratic_complexity)  * 0.30;
    raw += clamp01(profile.historical_delay_rate)    * 0.25;
    raw += clamp01(profile.labor_action_probability) * 0.35;
    raw += clamp01(profile.route_congestion)         * 0.20;
    raw += clamp01(profile.weather_severity)         * 0.15;

    if (raw_out)          *raw_out = raw;

    // Regime check: raw demand exceeds model's defined domain.
    bool exceeded = raw > FRICTION_MULTIPLIER_MAX;
    if (regime_exceeded)  *regime_exceeded = exceeded;

    if (exceeded) {
        std::cerr << "[CRITICAL] REGIME_EXCEEDED: Ham surtunme talebi "
                  << std::fixed << std::setprecision(3) << raw
                  << "x — model tanim kumesi asildi (tavan: "
                  << FRICTION_MULTIPLIER_MAX << "x). Sinirlandiriliyor.\n";
    }

    // Hard clamp: the optimiser must never see an out-of-band multiplier.
    double multiplier = std::clamp(raw, FRICTION_MULTIPLIER_MIN, FRICTION_MULTIPLIER_MAX);

    std::cout << "[INTEL-CORE] => Raw: " << std::setprecision(3) << raw
              << "x  Clamped: " << multiplier << "x"
              << " [" << FRICTION_MULTIPLIER_MIN << ", " << FRICTION_MULTIPLIER_MAX << "]"
              << (exceeded ? "  *** REGIME_EXCEEDED ***" : "") << "\n";
    return multiplier;
}

} // namespace intel
} // namespace caelus
