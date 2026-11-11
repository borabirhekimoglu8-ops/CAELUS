// CAELUS OS — RFC 9106 Argon2id (v=0x13) & RFC 7693 Blake2b (OB-4)
//
// Zero external crate / zero network dependency implementation of:
//   - RFC 7693 Blake2b (variable output 1..=64 bytes)
//   - RFC 9106 Argon2id (version 0x13, type y=2: hybrid data-independent + data-dependent)
// All intermediate secret/block buffers are wiped via `zeroize` on drop.

use std::io;
use zeroize::{Zeroize, Zeroizing};

const BLAKE2B_IV: [u64; 8] = [
    0x6a09e667f3bcc908,
    0xbb67ae8584caa73b,
    0x3c6ef372fe94f82b,
    0xa54ff53a5f1d36f1,
    0x510e527fade682d1,
    0x9b05688c2b3e6c1f,
    0x1f83d9abfb41bd6b,
    0x5be0cd19137e2179,
];

const BLAKE2B_SIGMA: [[usize; 16]; 10] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

const ARGON2_VERSION: u32 = 0x13;
const ARGON2ID_TYPE: u32 = 2;
const SYNC_POINTS: usize = 4;

/// Production OWASP/RFC memory-hard default parameters (19 MiB, t=2, p=1).
#[derive(Debug, Clone, Copy)]
pub struct Argon2idParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub lanes: u32,
}

impl Default for Argon2idParams {
    fn default() -> Self {
        Self {
            m_cost_kib: 19_456, // 19 MiB memory-hard profile
            t_cost: 2,
            lanes: 1,
        }
    }
}

impl Argon2idParams {
    pub fn validate(&self) -> io::Result<()> {
        if self.lanes == 0 || self.lanes > 255 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Argon2id lanes must be in 1..=255",
            ));
        }
        if self.t_cost == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Argon2id t_cost must be >= 1",
            ));
        }
        let min_mem = 8u32.saturating_mul(self.lanes);
        if self.m_cost_kib < min_mem || self.m_cost_kib > 1_048_576 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Argon2id m_cost_kib out of valid bounds",
            ));
        }
        Ok(())
    }
}

struct Blake2b {
    h: [u64; 8],
    t_lo: u64,
    t_hi: u64,
    buf: [u8; 128],
    buf_len: usize,
    out_len: usize,
}

impl Drop for Blake2b {
    fn drop(&mut self) {
        self.h.zeroize();
        self.buf.zeroize();
        self.t_lo = 0;
        self.t_hi = 0;
        self.buf_len = 0;
    }
}

impl Blake2b {
    fn new(out_len: usize) -> Self {
        debug_assert!((1..=64).contains(&out_len));
        let mut h = BLAKE2B_IV;
        h[0] ^= 0x0101_0000u64 ^ (out_len as u64);
        Self {
            h,
            t_lo: 0,
            t_hi: 0,
            buf: [0u8; 128],
            buf_len: 0,
            out_len,
        }
    }

    fn update(&mut self, mut data: &[u8]) {
        if data.is_empty() {
            return;
        }
        while !data.is_empty() {
            if self.buf_len == 128 {
                self.advance_counter(128);
                let block = self.buf;
                self.compress(&block, false);
                self.buf_len = 0;
            }
            let take = (128 - self.buf_len).min(data.len());
            self.buf[self.buf_len..self.buf_len + take].copy_from_slice(&data[..take]);
            self.buf_len += take;
            data = &data[take..];
        }
    }

    fn update_u32_le(&mut self, val: u32) {
        self.update(&val.to_le_bytes());
    }

    fn finalize_into(mut self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), self.out_len);
        self.advance_counter(self.buf_len as u64);
        for b in &mut self.buf[self.buf_len..] {
            *b = 0;
        }
        let block = self.buf;
        self.compress(&block, true);

        let mut full = Zeroizing::new([0u8; 64]);
        for (i, word) in self.h.iter().enumerate() {
            full[i * 8..(i + 1) * 8].copy_from_slice(&word.to_le_bytes());
        }
        out.copy_from_slice(&full[..self.out_len]);
    }

    #[inline]
    fn advance_counter(&mut self, inc: u64) {
        let (next_lo, carry) = self.t_lo.overflowing_add(inc);
        self.t_lo = next_lo;
        if carry {
            self.t_hi = self.t_hi.wrapping_add(1);
        }
    }

    fn compress(&mut self, block: &[u8; 128], is_last: bool) {
        let mut m = [0u64; 16];
        for (i, chunk) in block.chunks_exact(8).enumerate() {
            m[i] = u64::from_le_bytes(chunk.try_into().unwrap());
        }

        let mut v = [0u64; 16];
        v[..8].copy_from_slice(&self.h);
        v[8..16].copy_from_slice(&BLAKE2B_IV);
        v[12] ^= self.t_lo;
        v[13] ^= self.t_hi;
        if is_last {
            v[14] = !v[14];
        }

        #[inline(always)]
        fn g_mix(v: &mut [u64; 16], a: usize, b: usize, c: usize, d: usize, x: u64, y: u64) {
            v[a] = v[a].wrapping_add(v[b]).wrapping_add(x);
            v[d] = (v[d] ^ v[a]).rotate_right(32);
            v[c] = v[c].wrapping_add(v[d]);
            v[b] = (v[b] ^ v[c]).rotate_right(24);
            v[a] = v[a].wrapping_add(v[b]).wrapping_add(y);
            v[d] = (v[d] ^ v[a]).rotate_right(16);
            v[c] = v[c].wrapping_add(v[d]);
            v[b] = (v[b] ^ v[c]).rotate_right(63);
        }

        for round in 0..12 {
            let s = &BLAKE2B_SIGMA[round % 10];
            g_mix(&mut v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
            g_mix(&mut v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
            g_mix(&mut v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
            g_mix(&mut v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
            g_mix(&mut v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
            g_mix(&mut v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
            g_mix(&mut v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
            g_mix(&mut v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
        }

        for i in 0..8 {
            self.h[i] ^= v[i] ^ v[i + 8];
        }
        m.zeroize();
        v.zeroize();
    }
}

pub fn blake2b_hash(input: &[u8], out: &mut [u8]) {
    let state = {
        let mut b = Blake2b::new(out.len());
        b.update(input);
        b
    };
    state.finalize_into(out);
}

/// RFC 9106 §3.2 variable-length hash `H'(X)` writing `out.len()` bytes.
fn h_prime(chunks: &[&[u8]], out: &mut [u8]) {
    let tag_len = out.len();
    debug_assert!(tag_len >= 4);
    let tag_le = (tag_len as u32).to_le_bytes();

    if tag_len <= 64 {
        let mut b = Blake2b::new(tag_len);
        b.update(&tag_le);
        for c in chunks {
            b.update(c);
        }
        b.finalize_into(out);
        return;
    }

    let r = tag_len.div_ceil(32) - 2;
    let mut v_prev = Zeroizing::new([0u8; 64]);
    let mut v_next = Zeroizing::new([0u8; 64]);

    {
        let mut b = Blake2b::new(64);
        b.update(&tag_le);
        for c in chunks {
            b.update(c);
        }
        b.finalize_into(&mut v_prev[..]);
    }
    out[..32].copy_from_slice(&v_prev[..32]);

    for idx in 1..r {
        blake2b_hash(&v_prev[..], &mut v_next[..]);
        out[idx * 32..(idx + 1) * 32].copy_from_slice(&v_next[..32]);
        v_prev.copy_from_slice(&v_next[..]);
    }

    let rem = tag_len - 32 * r;
    blake2b_hash(&v_prev[..], &mut out[r * 32..r * 32 + rem]);
}

#[derive(Clone)]
struct Block([u64; 128]);

impl Default for Block {
    fn default() -> Self {
        Self([0u64; 128])
    }
}

impl Zeroize for Block {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Block {
    fn from_le_bytes(bytes: &[u8; 1024]) -> Self {
        let mut words = [0u64; 128];
        for (i, chunk) in bytes.chunks_exact(8).enumerate() {
            words[i] = u64::from_le_bytes(chunk.try_into().unwrap());
        }
        Self(words)
    }

    fn to_le_bytes(&self, out: &mut [u8; 1024]) {
        for (i, word) in self.0.iter().enumerate() {
            out[i * 8..(i + 1) * 8].copy_from_slice(&word.to_le_bytes());
        }
    }

    fn xor_assign(&mut self, rhs: &Block) {
        for (a, b) in self.0.iter_mut().zip(rhs.0.iter()) {
            *a ^= *b;
        }
    }
}

#[inline(always)]
fn f_blamka(x: u64, y: u64) -> u64 {
    let m = (x as u32 as u64).wrapping_mul(y as u32 as u64);
    x.wrapping_add(y).wrapping_add(m.wrapping_shl(1))
}

#[inline(always)]
fn gb(v: &mut [u64; 16], a: usize, b: usize, c: usize, d: usize) {
    v[a] = f_blamka(v[a], v[b]);
    v[d] = (v[d] ^ v[a]).rotate_right(32);
    v[c] = f_blamka(v[c], v[d]);
    v[b] = (v[b] ^ v[c]).rotate_right(24);
    v[a] = f_blamka(v[a], v[b]);
    v[d] = (v[d] ^ v[a]).rotate_right(16);
    v[c] = f_blamka(v[c], v[d]);
    v[b] = (v[b] ^ v[c]).rotate_right(63);
}

#[inline]
fn permute_p(v: &mut [u64; 16]) {
    gb(v, 0, 4, 8, 12);
    gb(v, 1, 5, 9, 13);
    gb(v, 2, 6, 10, 14);
    gb(v, 3, 7, 11, 15);
    gb(v, 0, 5, 10, 15);
    gb(v, 1, 6, 11, 12);
    gb(v, 2, 7, 8, 13);
    gb(v, 3, 4, 9, 14);
}

/// RFC 9106 §3.5 compression function `G(X, Y)`.
/// If `xor_mode` is true, XORs the output into `dst`; otherwise overwrites `dst`.
fn compress_g(x: &Block, y: &Block, dst: &mut Block, xor_mode: bool) {
    let mut r = Block::default();
    for i in 0..128 {
        r.0[i] = x.0[i] ^ y.0[i];
    }
    let mut q = r.clone();

    // Row-wise P over 8 rows of 16 u64 words
    for row in 0..8 {
        let base = row * 16;
        let mut slice: [u64; 16] = q.0[base..base + 16].try_into().unwrap();
        permute_p(&mut slice);
        q.0[base..base + 16].copy_from_slice(&slice);
    }

    // Column-wise P over 8 columns of 8 16-byte registers (2 u64 words per register)
    for col in 0..8 {
        let mut slice = [0u64; 16];
        for k in 0..8 {
            let idx = k * 16 + col * 2;
            slice[k * 2] = q.0[idx];
            slice[k * 2 + 1] = q.0[idx + 1];
        }
        permute_p(&mut slice);
        for k in 0..8 {
            let idx = k * 16 + col * 2;
            q.0[idx] = slice[k * 2];
            q.0[idx + 1] = slice[k * 2 + 1];
        }
    }

    if xor_mode {
        for i in 0..128 {
            dst.0[i] ^= q.0[i] ^ r.0[i];
        }
    } else {
        for i in 0..128 {
            dst.0[i] = q.0[i] ^ r.0[i];
        }
    }
    r.zeroize();
    q.zeroize();
}

fn next_addresses(input_block: &mut Block, zero_block: &Block, address_block: &mut Block) {
    input_block.0[6] = input_block.0[6].wrapping_add(1);
    let mut tmp = Block::default();
    compress_g(zero_block, input_block, &mut tmp, false);
    compress_g(zero_block, &tmp, address_block, false);
    tmp.zeroize();
}

/// Deterministic RFC 9106 Argon2id (v=0x13, y=2) hash derivation.
pub fn argon2id_hash_into(
    params: Argon2idParams,
    password: &[u8],
    salt: &[u8],
    secret: &[u8],
    ad: &[u8],
    out: &mut [u8],
) -> io::Result<()> {
    params.validate()?;
    if salt.len() < 8 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Argon2id salt must be at least 8 bytes",
        ));
    }
    if out.len() < 4 || out.len() > 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Argon2id output tag length must be in 4..=1024",
        ));
    }

    let p = params.lanes as usize;
    let m_prime = 4 * p * ((params.m_cost_kib as usize) / (4 * p));
    let q = m_prime / p;
    let segment_len = q / SYNC_POINTS;

    // Step 1: H_0 = H_64(p, T, m, t, v, y, |P|, P, |S|, S, |K|, K, |X|, X)
    let mut h0 = Zeroizing::new([0u8; 64]);
    {
        let mut b = Blake2b::new(64);
        b.update_u32_le(params.lanes);
        b.update_u32_le(out.len() as u32);
        b.update_u32_le(params.m_cost_kib);
        b.update_u32_le(params.t_cost);
        b.update_u32_le(ARGON2_VERSION);
        b.update_u32_le(ARGON2ID_TYPE);
        b.update_u32_le(password.len() as u32);
        b.update(password);
        b.update_u32_le(salt.len() as u32);
        b.update(salt);
        b.update_u32_le(secret.len() as u32);
        b.update(secret);
        b.update_u32_le(ad.len() as u32);
        b.update(ad);
        b.finalize_into(&mut h0[..]);
    }

    let mut memory = vec![Block::default(); m_prime];
    let mut block_bytes = Zeroizing::new([0u8; 1024]);

    // Step 2: B[i][0] and B[i][1]
    for lane in 0..p {
        let lane_le = (lane as u32).to_le_bytes();
        h_prime(
            &[&h0[..], &0u32.to_le_bytes(), &lane_le],
            &mut block_bytes[..],
        );
        memory[lane * q] = Block::from_le_bytes(&block_bytes);

        h_prime(
            &[&h0[..], &1u32.to_le_bytes(), &lane_le],
            &mut block_bytes[..],
        );
        memory[lane * q + 1] = Block::from_le_bytes(&block_bytes);
    }

    let zero_block = Block::default();
    let mut input_block = Block::default();
    let mut address_block = Block::default();
    let mut next_block = Block::default();

    // Step 3..6: Fill segments across t_cost passes and 4 slices
    for pass in 0..(params.t_cost as usize) {
        for slice in 0..SYNC_POINTS {
            let data_independent = pass == 0 && slice < 2;
            for lane in 0..p {
                if data_independent {
                    input_block.zeroize();
                    input_block.0[0] = pass as u64;
                    input_block.0[1] = lane as u64;
                    input_block.0[2] = slice as u64;
                    input_block.0[3] = m_prime as u64;
                    input_block.0[4] = params.t_cost as u64;
                    input_block.0[5] = ARGON2ID_TYPE as u64;
                    next_addresses(&mut input_block, &zero_block, &mut address_block);
                }

                let start_idx = if pass == 0 && slice == 0 { 2 } else { 0 };
                for index in start_idx..segment_len {
                    let cur_col = slice * segment_len + index;
                    let prev_col = if cur_col == 0 { q - 1 } else { cur_col - 1 };

                    let pseudo_rand = if data_independent {
                        if index > 0 && index % 128 == 0 {
                            next_addresses(&mut input_block, &zero_block, &mut address_block);
                        }
                        address_block.0[index % 128]
                    } else {
                        memory[lane * q + prev_col].0[0]
                    };

                    let j1 = pseudo_rand as u32;
                    let j2 = (pseudo_rand >> 32) as u32;
                    let ref_lane = if pass == 0 && slice == 0 {
                        lane
                    } else {
                        (j2 as usize) % p
                    };

                    let ref_area_size = if pass == 0 {
                        if slice == 0 {
                            index - 1
                        } else if ref_lane == lane {
                            slice * segment_len + index - 1
                        } else if index == 0 {
                            slice * segment_len - 1
                        } else {
                            slice * segment_len
                        }
                    } else if ref_lane == lane {
                        q - segment_len + index - 1
                    } else if index == 0 {
                        q - segment_len - 1
                    } else {
                        q - segment_len
                    };

                    let x = ((j1 as u64) * (j1 as u64)) >> 32;
                    let y = ((ref_area_size as u64) * x) >> 32;
                    let rel_pos = (ref_area_size - 1) - (y as usize);
                    let start_pos = if pass == 0 || slice == SYNC_POINTS - 1 {
                        0
                    } else {
                        (slice + 1) * segment_len
                    };
                    let ref_col = (start_pos + rel_pos) % q;

                    let prev_idx = lane * q + prev_col;
                    let ref_idx = ref_lane * q + ref_col;
                    let cur_idx = lane * q + cur_col;

                    if pass == 0 {
                        compress_g(&memory[prev_idx], &memory[ref_idx], &mut next_block, false);
                        memory[cur_idx] = next_block.clone();
                    } else {
                        next_block = memory[cur_idx].clone();
                        compress_g(&memory[prev_idx], &memory[ref_idx], &mut next_block, true);
                        memory[cur_idx] = next_block.clone();
                    }
                }
            }
        }
    }

    input_block.zeroize();
    address_block.zeroize();
    next_block.zeroize();

    // Step 7: Final block C = XOR of last column across all lanes, Tag = H'_T(C)
    let mut final_block = memory[q - 1].clone();
    for lane in 1..p {
        final_block.xor_assign(&memory[lane * q + (q - 1)]);
    }
    final_block.to_le_bytes(&mut block_bytes);
    h_prime(&[&block_bytes[..]], out);

    final_block.zeroize();
    for blk in &mut memory {
        blk.zeroize();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_to_vec(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let s = std::str::from_utf8(pair).unwrap();
                u8::from_str_radix(s, 16).unwrap()
            })
            .collect()
    }

    #[test]
    fn rfc7693_blake2b_abc_vector() {
        let mut out = [0u8; 64];
        blake2b_hash(b"abc", &mut out);
        let expected = hex_to_vec(
            "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1\
             7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
        );
        assert_eq!(&out[..], &expected[..]);
    }

    #[test]
    fn rfc9106_section_5_3_argon2id_official_test_vector() {
        // RFC 9106 Section 5.3 — Argon2id Test Vector:
        // Iterations t = 3, Memory m = 32 KiB, Parallelism p = 4, Tag length = 32 bytes
        let params = Argon2idParams {
            m_cost_kib: 32,
            t_cost: 3,
            lanes: 4,
        };
        let password = [0x01u8; 32];
        let salt = [0x02u8; 16];
        let secret = [0x03u8; 8];
        let ad = [0x04u8; 12];
        let mut tag = [0u8; 32];

        argon2id_hash_into(params, &password, &salt, &secret, &ad, &mut tag)
            .expect("RFC 9106 vector must succeed");

        let expected =
            hex_to_vec("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
        assert_eq!(
            &tag[..],
            &expected[..],
            "Argon2id output must match RFC 9106 §5.3 official KAT bit-for-bit"
        );
    }
}

