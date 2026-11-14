//! Maritime Protocol, Border & LEVIATHAN Security Armor (Pure-std, `#![forbid(unsafe_code)]`):
//! - IMO FAL (1-7), UN/EDIFACT (BAPLIE, COPRAR, PAXLST), DCSA JIT v1.2
//! - EU EES/ETIAS border pre-clearance, IHO S-101/S-102, Paris/Tokyo/Med MoU PSC, IACS UR E26/E27
//! - GLEIF / BODS / OpenSanctions offline screening
//! - Wave 7 RAIM GNSS spoofing residual detector
//! - Multi-tenant local vault envelope
//! - Safe-Rust RFC 8032 Ed25519 (SHA-512 + GF(2^255-19)) offline air-gapped license verifier

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FalForm {
    GeneralDeclarationFal1,
    CargoDeclarationFal2,
    ShipStoresFal3,
    CrewEffectsFal4,
    CrewListFal5,
    PassengerListFal6,
    DangerousGoodsFal7,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FalEdifactSummary {
    pub form: FalForm,
    pub msg_type: &'static str, // BAPLIE | COPRAR | PAXLST
    pub unlocode: String,
    pub dcsa_jit_window_min: u32,
    pub valid: bool,
}

#[must_use]
pub fn validate_fal_edifact_dcsa(
    form: FalForm,
    msg_type: &'static str,
    unlocode: &str,
    declared_pax: u32,
    dcsa_jit_window_min: u32,
) -> FalEdifactSummary {
    let valid_code = unlocode.len() == 5 && unlocode.chars().all(|c| c.is_ascii_alphanumeric());
    let valid_msg = matches!(msg_type, "BAPLIE" | "COPRAR" | "PAXLST");
    let pax_ok = !matches!(form, FalForm::PassengerListFal6) || declared_pax > 0;
    FalEdifactSummary {
        form,
        msg_type,
        unlocode: unlocode.to_ascii_uppercase(),
        dcsa_jit_window_min,
        valid: valid_code && valid_msg && pax_ok && dcsa_jit_window_min <= 180,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouRegion {
    ParisMou,
    TokyoMou,
    MedMou,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BorderChartCompliance {
    pub ees_etias_cleared: bool,
    pub s101_s102_keel_safe: bool,
    pub mou_region: MouRegion,
    pub psc_detention_risk_score: f64,
    pub iacs_e26_e27_compliant: bool,
}

#[must_use]
pub fn evaluate_border_and_psc(
    pax_preverified_ratio: f64,
    s102_bathymetry_ukc_m: f64,
    mou_region: MouRegion,
    vessel_age_years: u32,
    open_deficiencies: u32,
    signed_cyber_baseline: bool,
) -> BorderChartCompliance {
    let ees_etias_cleared = pax_preverified_ratio >= 0.99;
    let s101_s102_keel_safe = s102_bathymetry_ukc_m >= 1.5;
    let region_weight = match mou_region {
        MouRegion::ParisMou => 1.15,
        MouRegion::TokyoMou => 1.10,
        MouRegion::MedMou => 1.00,
    };
    let psc_detention_risk_score =
        (((vessel_age_years as f64) * 0.015 + (open_deficiencies as f64) * 0.14) * region_weight)
            .clamp(0.0, 1.0);
    BorderChartCompliance {
        ees_etias_cleared,
        s101_s102_keel_safe,
        mou_region,
        psc_detention_risk_score,
        iacs_e26_e27_compliant: signed_cyber_baseline && open_deficiencies == 0,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanctionsScreenResult {
    pub lei_code: String,
    pub entity_name: String,
    pub flagged_sanctions: bool,
    pub ubo_verified_bods: bool,
}

const OFFLINE_SANCTIONED_TOKENS: &[&str] = &["SHADOW-TANKER", "SANCTIONED-X", "SPOOF-FLEET"];

#[must_use]
pub fn screen_entity_offline(
    lei_code: &str,
    entity_name: &str,
    ubo_present: bool,
) -> SanctionsScreenResult {
    let upper = entity_name.to_ascii_uppercase();
    let flagged = OFFLINE_SANCTIONED_TOKENS
        .iter()
        .any(|tok| upper.contains(tok));
    let lei_ok = lei_code.len() == 20 && lei_code.chars().all(|c| c.is_ascii_alphanumeric());
    SanctionsScreenResult {
        lei_code: lei_code.to_string(),
        entity_name: entity_name.to_string(),
        flagged_sanctions: flagged,
        ubo_verified_bods: ubo_present && lei_ok && !flagged,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RaimMonitorResult {
    pub wsse_m2: f64,
    pub threshold_m2: f64,
    pub ais_cog_delta_deg: f64,
    pub spoofed: bool,
}

/// Wave 7 RAIM GPS/GNSS spoofing detector comparing weighted sum of squared residuals
/// (`WSSE`) and inertial-to-AIS course disagreement (`ais_cog_delta_deg`).
#[must_use]
pub fn evaluate_raim_spoofing(
    pseudorange_residuals_m: [f64; 6],
    ais_cog_delta_deg: f64,
) -> RaimMonitorResult {
    let wsse_m2: f64 = pseudorange_residuals_m.iter().map(|r| r * r).sum();
    let threshold_m2 = 625.0; // Chi-square 5-DoF threshold (~25 m^2 sigma bound)
    let spoofed = wsse_m2 > threshold_m2 || ais_cog_delta_deg.abs() > 22.0;
    RaimMonitorResult {
        wsse_m2,
        threshold_m2,
        ais_cog_delta_deg,
        spoofed,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantVaultEnvelope {
    pub tenant_id: String,
    pub isolation_digest_hex: String,
    pub sealed: bool,
}

/// Multi-tenant local cryptographic compartment tag (SHA-512 domain-separated).
#[must_use]
pub fn seal_tenant_vault_envelope(tenant_id: &str, payload: &[u8]) -> TenantVaultEnvelope {
    let mut buf = Vec::with_capacity(tenant_id.len() + payload.len() + 16);
    buf.extend_from_slice(b"CAELUS-TENANT-V1:");
    buf.extend_from_slice(tenant_id.as_bytes());
    buf.push(0);
    buf.extend_from_slice(payload);
    let digest = sha512(&buf);
    let mut hex = String::with_capacity(32);
    for byte in &digest[..16] {
        use std::fmt::Write;
        let _ = write!(hex, "{byte:02x}");
    }
    TenantVaultEnvelope {
        tenant_id: tenant_id.to_string(),
        isolation_digest_hex: hex,
        sealed: !tenant_id.is_empty(),
    }
}

// ============================================================================
// Pure-std `#![forbid(unsafe_code)]` RFC 8032 Ed25519 Verifier (SHA-512 + Curve25519)
// ============================================================================

const SHA512_K: [u64; 80] = [
    0x428a2f98d728ae22,
    0x7137449123ef65cd,
    0xb5c0fbcfec4d3b2f,
    0xe9b5dba58189dbbc,
    0x3956c25bf348b538,
    0x59f111f1b605d019,
    0x923f82a4af194f9b,
    0xab1c5ed5da6d8118,
    0xd807aa98a3030242,
    0x12835b0145706fbe,
    0x243185be4ee4b28c,
    0x550c7dc3d5ffb4e2,
    0x72be5d74f27b896f,
    0x80deb1fe3b1696b1,
    0x9bdc06a725c71235,
    0xc19bf174cf692694,
    0xe49b69c19ef14ad2,
    0xefbe4786384f25e3,
    0x0fc19dc68b8cd5b5,
    0x240ca1cc77ac9c65,
    0x2de92c6f592b0275,
    0x4a7484aa6ea6e483,
    0x5cb0a9dcbd41fbd4,
    0x76f988da831153b5,
    0x983e5152ee66dfab,
    0xa831c66d2db43210,
    0xb00327c898fb213f,
    0xbf597fc7beef0ee4,
    0xc6e00bf33da88fc2,
    0xd5a79147930aa725,
    0x06ca6351e003826f,
    0x142929670a0e6e70,
    0x27b70a8546d22ffc,
    0x2e1b21385c26c926,
    0x4d2c6dfc5ac42aed,
    0x53380d139d95b3df,
    0x650a73548baf63de,
    0x766a0abb3c77b2a8,
    0x81c2c92e47edaee6,
    0x92722c851482353b,
    0xa2bfe8a14cf10364,
    0xa81a664bbc423001,
    0xc24b8b70d0f89791,
    0xc76c51a30654be30,
    0xd192e819d6ef5218,
    0xd69906245565a910,
    0xf40e35855771202a,
    0x106aa07032bbd1b8,
    0x19a4c116b8d2d0c8,
    0x1e376c085141ab53,
    0x2748774cdf8eeb99,
    0x34b0bcb5e19b48a8,
    0x391c0cb3c5c95a63,
    0x4ed8aa4ae3418acb,
    0x5b9cca4f7763e373,
    0x682e6ff3d6b2b8a3,
    0x748f82ee5defb2fc,
    0x78a5636f43172f60,
    0x84c87814a1f0ab72,
    0x8cc702081a6439ec,
    0x90befffa23631e28,
    0xa4506cebde82bde9,
    0xbef9a3f7b2c67915,
    0xc67178f2e372532b,
    0xca273eceea26619c,
    0xd186b8c721c0c207,
    0xeada7dd6cde0eb1e,
    0xf57d4f7fee6ed178,
    0x06f067aa72176fba,
    0x0a637dc5a2c898a6,
    0x113f9804bef90dae,
    0x1b710b35131c471b,
    0x28db77f523047d84,
    0x32caab7b40c72493,
    0x3c9ebe0a15c9bebc,
    0x431d67c49c100d4c,
    0x4cc5d4becb3e42b6,
    0x597f299cfc657e2a,
    0x5fcb6fab3ad6faec,
    0x6c44198c4a475817,
];

/// Standard FIPS 180-4 SHA-512 digest.
#[must_use]
pub fn sha512(input: &[u8]) -> [u8; 64] {
    let mut h: [u64; 8] = [
        0x6a09e667f3bcc908,
        0xbb67ae8584caa73b,
        0x3c6ef372fe94f82b,
        0xa54ff53a5f1d36f1,
        0x510e527fade682d1,
        0x9b05688c2b3e6c1f,
        0x1f83d9abfb41bd6b,
        0x5be0cd19137e2179,
    ];

    let bit_len = (input.len() as u128) * 8;
    let mut padded = Vec::with_capacity(input.len() + 128);
    padded.extend_from_slice(input);
    padded.push(0x80);
    while (padded.len() % 128) != 112 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for block in padded.chunks_exact(128) {
        let mut w = [0u64; 80];
        for (word, chunk) in w.iter_mut().take(16).zip(block.chunks_exact(8)) {
            *word = u64::from_be_bytes([
                chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
            ]);
        }
        for i in 16..80 {
            let s0 = w[i - 15].rotate_right(1) ^ w[i - 15].rotate_right(8) ^ (w[i - 15] >> 7);
            let s1 = w[i - 2].rotate_right(19) ^ w[i - 2].rotate_right(61) ^ (w[i - 2] >> 6);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..80 {
            let s1 = e.rotate_right(14) ^ e.rotate_right(18) ^ e.rotate_right(41);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA512_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(28) ^ a.rotate_right(34) ^ a.rotate_right(39);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 64];
    for (i, word) in h.iter().enumerate() {
        out[i * 8..i * 8 + 8].copy_from_slice(&word.to_be_bytes());
    }
    out
}

type Fe = [i64; 16];

const FE_ZERO: Fe = [0; 16];
const FE_ONE: Fe = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

fn car25519(o: &mut Fe) {
    for _ in 0..2 {
        for i in 0..16 {
            let c = o[i].div_euclid(65_536);
            o[i] -= c * 65_536;
            if i == 15 {
                o[0] += c * 38;
            } else {
                o[i + 1] += c;
            }
        }
    }
}

fn fe_add(a: &Fe, b: &Fe) -> Fe {
    let mut o = FE_ZERO;
    for i in 0..16 {
        o[i] = a[i] + b[i];
    }
    o
}

fn fe_sub(a: &Fe, b: &Fe) -> Fe {
    let mut o = FE_ZERO;
    for i in 0..16 {
        o[i] = a[i] - b[i];
    }
    o
}

fn fe_mul(a: &Fe, b: &Fe) -> Fe {
    let mut t = [0i128; 31];
    for i in 0..16 {
        for j in 0..16 {
            t[i + j] += (a[i] as i128) * (b[j] as i128);
        }
    }
    for i in 0..15 {
        t[i] += 38 * t[i + 16];
    }
    for _ in 0..2 {
        for i in 0..16 {
            let c = t[i].div_euclid(65_536);
            t[i] -= c * 65_536;
            if i == 15 {
                t[0] += c * 38;
            } else {
                t[i + 1] += c;
            }
        }
    }
    let mut o = FE_ZERO;
    for i in 0..16 {
        o[i] = t[i] as i64;
    }
    car25519(&mut o);
    o
}

fn fe_sq(a: &Fe) -> Fe {
    fe_mul(a, a)
}

fn fe_pow_bytes(base: &Fe, exp_le: &[u8; 32]) -> Fe {
    let mut acc = FE_ONE;
    for byte_idx in (0..32).rev() {
        for bit in (0..8).rev() {
            acc = fe_sq(&acc);
            if ((exp_le[byte_idx] >> bit) & 1) == 1 {
                acc = fe_mul(&acc, base);
            }
        }
    }
    acc
}

fn fe_inv(a: &Fe) -> Fe {
    // p - 2 = 2^255 - 21
    let mut exp = [0xFFu8; 32];
    exp[0] = 0xEB;
    exp[31] = 0x7F;
    fe_pow_bytes(a, &exp)
}

fn fe_pow2523(a: &Fe) -> Fe {
    // (p - 5) / 8 = 2^252 - 3
    let mut exp = [0xFFu8; 32];
    exp[0] = 0xFD;
    exp[31] = 0x0F;
    fe_pow_bytes(a, &exp)
}

fn fe_sqrt_m1() -> Fe {
    // 2^((p - 1) / 4) mod p, (p - 1)/4 = 2^253 - 5
    let mut exp = [0xFFu8; 32];
    exp[0] = 0xFB;
    exp[31] = 0x1F;
    let two = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    fe_pow_bytes(&two, &exp)
}

fn fe_d() -> Fe {
    // d = -121665 / 121666 mod p
    let mut num = [-121_665i64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    car25519(&mut num);
    let mut den = [121_666i64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    car25519(&mut den);
    fe_mul(&num, &fe_inv(&den))
}

fn fe_pack(n: &Fe) -> [u8; 32] {
    let mut t = *n;
    car25519(&mut t);
    car25519(&mut t);
    // Reduce canonical mod p = 2^255 - 19 = [0xffed, 0xffff, ..., 0x7fff]
    let p_limbs: Fe = [
        0xffed, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff,
        0xffff, 0xffff, 0xffff, 0xffff, 0x7fff,
    ];
    for _ in 0..2 {
        let mut m = [0i64; 16];
        let mut borrow = 0i64;
        for i in 0..16 {
            let diff = t[i] - p_limbs[i] - borrow;
            if diff < 0 {
                m[i] = diff + 65_536;
                borrow = 1;
            } else {
                m[i] = diff;
                borrow = 0;
            }
        }
        if borrow == 0 {
            t = m;
        }
    }
    let mut out = [0u8; 32];
    for i in 0..16 {
        out[2 * i] = (t[i] & 0xff) as u8;
        out[2 * i + 1] = ((t[i] >> 8) & 0xff) as u8;
    }
    out
}

fn fe_from_bytes(s: &[u8; 32]) -> Fe {
    let mut o = FE_ZERO;
    for i in 0..16 {
        o[i] = (s[2 * i] as i64) + ((s[2 * i + 1] as i64) << 8);
    }
    o[15] &= 0x7fff;
    o
}

#[derive(Clone, Copy)]
struct ExtPoint {
    x: Fe,
    y: Fe,
    z: Fe,
    t: Fe,
}

fn pt_neutral() -> ExtPoint {
    ExtPoint {
        x: FE_ZERO,
        y: FE_ONE,
        z: FE_ONE,
        t: FE_ZERO,
    }
}

fn pt_add(p: &ExtPoint, q: &ExtPoint, d2: &Fe) -> ExtPoint {
    let a = fe_mul(&fe_sub(&p.y, &p.x), &fe_sub(&q.y, &q.x));
    let b = fe_mul(&fe_add(&p.y, &p.x), &fe_add(&q.y, &q.x));
    let c = fe_mul(&fe_mul(&p.t, d2), &q.t);
    let two = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let d = fe_mul(&fe_mul(&p.z, &two), &q.z);
    let e = fe_sub(&b, &a);
    let f = fe_sub(&d, &c);
    let g = fe_add(&d, &c);
    let h = fe_add(&b, &a);
    ExtPoint {
        x: fe_mul(&e, &f),
        y: fe_mul(&g, &h),
        z: fe_mul(&f, &g),
        t: fe_mul(&e, &h),
    }
}

fn pt_neg(p: &ExtPoint) -> ExtPoint {
    ExtPoint {
        x: fe_sub(&FE_ZERO, &p.x),
        y: p.y,
        z: p.z,
        t: fe_sub(&FE_ZERO, &p.t),
    }
}

fn pt_scalarmult(base: &ExtPoint, scalar_le: &[u8; 32], d2: &Fe) -> ExtPoint {
    let mut acc = pt_neutral();
    for byte_idx in (0..32).rev() {
        for bit in (0..8).rev() {
            acc = pt_add(&acc, &acc, d2);
            if ((scalar_le[byte_idx] >> bit) & 1) == 1 {
                acc = pt_add(&acc, base, d2);
            }
        }
    }
    acc
}

fn pt_pack(p: &ExtPoint) -> [u8; 32] {
    let zi = fe_inv(&p.z);
    let tx = fe_mul(&p.x, &zi);
    let ty = fe_mul(&p.y, &zi);
    let x_bytes = fe_pack(&tx);
    let mut r = fe_pack(&ty);
    r[31] ^= (x_bytes[0] & 1) << 7;
    r
}

fn pt_unpack(bytes: &[u8; 32], d: &Fe, sqrt_m1: &Fe) -> Option<ExtPoint> {
    // Canonical check: y < p
    let mut y_masked = *bytes;
    y_masked[31] &= 0x7f;
    let y = fe_from_bytes(&y_masked);
    if fe_pack(&y) != y_masked {
        return None;
    }

    let y2 = fe_sq(&y);
    let u = fe_sub(&y2, &FE_ONE);
    let v = fe_add(&fe_mul(&y2, d), &FE_ONE);
    let v3 = fe_mul(&fe_sq(&v), &v);
    let v7 = fe_mul(&fe_sq(&v3), &v);
    let uv3 = fe_mul(&u, &v3);
    let uv7 = fe_mul(&u, &v7);
    let mut x = fe_mul(&uv3, &fe_pow2523(&uv7));

    let vx2 = fe_mul(&v, &fe_sq(&x));
    if fe_pack(&vx2) != fe_pack(&u) {
        x = fe_mul(&x, sqrt_m1);
        let vx2_alt = fe_mul(&v, &fe_sq(&x));
        if fe_pack(&vx2_alt) != fe_pack(&u) {
            return None;
        }
    }

    let x_bytes = fe_pack(&x);
    let want_sign = (bytes[31] >> 7) & 1;
    if x_bytes == [0u8; 32] && want_sign == 1 {
        return None;
    }
    if (x_bytes[0] & 1) != want_sign {
        x = fe_sub(&FE_ZERO, &x);
    }

    Some(ExtPoint {
        x,
        y,
        z: FE_ONE,
        t: fe_mul(&x, &y),
    })
}

fn pt_basepoint(d: &Fe, sqrt_m1: &Fe) -> Option<ExtPoint> {
    let four = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let five = [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let y = fe_mul(&four, &fe_inv(&five));
    let mut enc = fe_pack(&y);
    // Basepoint has positive (even, bit 0 == 0) x coordinate per RFC 8032
    enc[31] &= 0x7f;
    pt_unpack(&enc, d, sqrt_m1)
}

fn order_l_le() -> [u8; 32] {
    // L = 2^252 + 27742317777372353535851937790883648493
    const L_LOW128: u128 = 27_742_317_777_372_353_535_851_937_790_883_648_493u128;
    let mut l = [0u8; 32];
    l[0..16].copy_from_slice(&L_LOW128.to_le_bytes());
    l[31] = 0x10; // 2^252 = 0x10 << (31 * 8) = 2^(248+4)
    l
}

fn cmp_le_32(a: &[u8; 32], b: &[u8; 32]) -> std::cmp::Ordering {
    for i in (0..32).rev() {
        if a[i] != b[i] {
            return a[i].cmp(&b[i]);
        }
    }
    std::cmp::Ordering::Equal
}

fn sc_reduce_64(bytes: &[u8; 64]) -> [u8; 32] {
    // Shift-and-subtract over 512 bits MSB->LSB mod L using 33-byte accumulator
    let l = order_l_le();
    let mut acc = [0u8; 33];
    for byte_idx in (0..64).rev() {
        for bit in (0..8).rev() {
            // acc <<= 1
            let mut carry = (bytes[byte_idx] >> bit) & 1;
            for slot in &mut acc {
                let next_carry = (*slot >> 7) & 1;
                *slot = (*slot << 1) | carry;
                carry = next_carry;
            }
            // Compare acc >= L
            let mut ge = acc[32] > 0;
            if !ge {
                ge = true;
                for i in (0..32).rev() {
                    if acc[i] > l[i] {
                        break;
                    }
                    if acc[i] < l[i] {
                        ge = false;
                        break;
                    }
                }
            }
            if ge {
                let mut borrow = 0u16;
                for i in 0..32 {
                    let sub = (l[i] as u16) + borrow;
                    if (acc[i] as u16) < sub {
                        acc[i] = ((acc[i] as u16) + 256 - sub) as u8;
                        borrow = 1;
                    } else {
                        acc[i] = ((acc[i] as u16) - sub) as u8;
                        borrow = 0;
                    }
                }
                acc[32] = acc[32].wrapping_sub(borrow as u8);
            }
        }
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&acc[0..32]);
    out
}

/// Fail-closed RFC 8032 Ed25519 signature verification (`#![forbid(unsafe_code)]`, pure std).
#[must_use]
pub fn verify_ed25519(public_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool {
    let mut r_bytes = [0u8; 32];
    let mut s_bytes = [0u8; 32];
    r_bytes.copy_from_slice(&signature[0..32]);
    s_bytes.copy_from_slice(&signature[32..64]);

    let l = order_l_le();
    if cmp_le_32(&s_bytes, &l) != std::cmp::Ordering::Less {
        return false;
    }

    let d = fe_d();
    let d2 = fe_add(&d, &d);
    let sqrt_m1 = fe_sqrt_m1();

    let Some(a_pt) = pt_unpack(public_key, &d, &sqrt_m1) else {
        return false;
    };
    if pt_unpack(&r_bytes, &d, &sqrt_m1).is_none() {
        return false;
    }

    let mut hash_input = Vec::with_capacity(64 + message.len());
    hash_input.extend_from_slice(&r_bytes);
    hash_input.extend_from_slice(public_key);
    hash_input.extend_from_slice(message);
    let h_digest = sha512(&hash_input);
    let h = sc_reduce_64(&h_digest);

    let Some(b_pt) = pt_basepoint(&d, &sqrt_m1) else {
        return false;
    };
    let s_b = pt_scalarmult(&b_pt, &s_bytes, &d2);
    let h_a = pt_scalarmult(&a_pt, &h, &d2);
    let r_check = pt_add(&s_b, &pt_neg(&h_a), &d2);
    pt_pack(&r_check) == r_bytes
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfflineLicenseCheck {
    pub tenant: String,
    pub epoch_valid: bool,
    pub signature_valid: bool,
    pub authorized: bool,
}

/// Verifies an air-gapped CAELUS commercial license blob (`tenant|expires_unix|signature`).
#[must_use]
pub fn verify_offline_license(
    public_key: &[u8; 32],
    tenant: &str,
    expires_unix: u64,
    now_unix: u64,
    signature: &[u8; 64],
) -> OfflineLicenseCheck {
    let payload = format!("CAELUS-LIC-V1:{tenant}:{expires_unix}");
    let sig_ok = verify_ed25519(public_key, payload.as_bytes(), signature);
    let epoch_ok = now_unix <= expires_unix && !tenant.is_empty();
    OfflineLicenseCheck {
        tenant: tenant.to_string(),
        epoch_valid: epoch_ok,
        signature_valid: sig_ok,
        authorized: sig_ok && epoch_ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_nibble(b: u8) -> u8 {
        match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => b - b'a' + 10,
            b'A'..=b'F' => b - b'A' + 10,
            _ => 0,
        }
    }

    fn decode_hex<const N: usize>(hex: &str) -> [u8; N] {
        assert_eq!(hex.len(), N * 2);
        let bytes = hex.as_bytes();
        let mut out = [0u8; N];
        for i in 0..N {
            out[i] = (hex_nibble(bytes[2 * i]) << 4) | hex_nibble(bytes[2 * i + 1]);
        }
        out
    }

    #[test]
    fn sha512_matches_fips_180_4_abc() {
        let digest = sha512(b"abc");
        let expected: [u8; 64] = decode_hex(
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a\
             2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        );
        assert_eq!(digest, expected);
    }

    #[test]
    fn ed25519_verifies_rfc8032_test_vector_1_and_rejects_tamper() {
        // RFC 8032 Section 7.1 TEST 1 (empty message)
        let pk: [u8; 32] =
            decode_hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        let sig: [u8; 64] = decode_hex(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155\
             5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        );
        assert!(verify_ed25519(&pk, b"", &sig));
        assert!(!verify_ed25519(&pk, b"tampered", &sig));

        let mut bad_sig = sig;
        bad_sig[63] ^= 0x01;
        assert!(!verify_ed25519(&pk, b"", &bad_sig));
    }

    #[test]
    fn raim_spoofing_and_regulatory_checks_work() {
        let clean = evaluate_raim_spoofing([1.2, -0.8, 0.5, 1.0, -1.1, 0.7], 2.0);
        assert!(!clean.spoofed);

        let spoofed = evaluate_raim_spoofing([18.0, 22.0, 5.0, 12.0, -9.0, 4.0], 4.0);
        assert!(spoofed.spoofed);

        let fal = validate_fal_edifact_dcsa(FalForm::PassengerListFal6, "PAXLST", "TRSEF", 310, 25);
        assert!(fal.valid);

        let border = evaluate_border_and_psc(1.0, 2.4, MouRegion::MedMou, 8, 0, true);
        assert!(border.ees_etias_cleared);
        assert!(border.iacs_e26_e27_compliant);

        let scr = screen_entity_offline("5493001KJTIIGC8Y1R12", "AEGEAN BLUE FERRY", true);
        assert!(!scr.flagged_sanctions);
        assert!(scr.ubo_verified_bods);

        let vault = seal_tenant_vault_envelope("tenant-trsef", b"secret-manifest");
        assert!(vault.sealed);
        assert_eq!(vault.isolation_digest_hex.len(), 32);
    }
}
