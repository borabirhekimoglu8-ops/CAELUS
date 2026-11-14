//! Page-granular `rkyv + memmap2` zero-copy store (`< 40 MiB` RAM, `< 1 ms` `LEAP` lookups).
//!
//! Files in `mmap_dir`:
//! - `vessels_blocks.rkyv`: 16-byte-aligned `rkyv` archived `VesselFullRecord` blocks
//! - `vessels_index.rkyv`: fixed-stride sorted IMO (`u32`), MMSI (`u32`), and token (`[u8; 32]`) tables
//! - `entities_blocks.rkyv`: 16-byte-aligned `rkyv` blocks for Ports, Companies, Countries, Regulations
//! - `entities_index.rkyv`: fixed-stride sorted lookup tables for all non-vessel entities
//!
//! Opening `MmapAtlasStore` validates ONLY file headers (one OS page per file), never faulting
//! unqueried vessel blocks into physical RAM.

use crate::fleet_schema::{
    ArchivedCompanyProfile, ArchivedCountryMaritimeProfile, ArchivedPortFullRecord,
    ArchivedRegulationRuleRecord, ArchivedVesselFullRecord, CompanyProfile, CountryMaritimeProfile,
    PortFullRecord, RegulationRuleRecord, VesselFullRecord,
};
use memmap2::{Mmap, MmapOptions};
use rkyv::rancor::Error as RkyvError;
use rkyv::{Archive, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

const VBLK_MAGIC: &[u8; 16] = b"CAELUS_VBLK_01\0\0";
const VIDX_MAGIC: &[u8; 16] = b"CAELUS_VIDX_01\0\0";
const EBLK_MAGIC: &[u8; 16] = b"CAELUS_EBLK_01\0\0";
const EIDX_MAGIC: &[u8; 16] = b"CAELUS_EIDX_01\0\0";

const BLK_HEADER_BYTES: usize = 64;
const VIDX_HEADER_BYTES: usize = 64;
const EIDX_HEADER_BYTES: usize = 128;
const BLOCK_ALIGN: usize = 16;
const SLOT24_BYTES: usize = 24;
const SLOT48_BYTES: usize = 48;
const MAX_VBLK_SHARD_BYTES: u64 = 32 * 1024 * 1024;
const VBLK_OFFSET_MASK: u64 = 0x00FF_FFFF_FFFF_FFFF;

#[inline]
pub fn fnv1a_32(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &b in bytes {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

#[inline]
pub fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// Normalizes text into clean uppercase ASCII with collapsed single spaces (`A-Z0-9 `).
#[must_use]
pub fn normalize_search_key(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_space = true;
    for ch in raw.chars() {
        let up = ch.to_ascii_uppercase();
        if up.is_ascii_alphanumeric() {
            out.push(up);
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

#[must_use]
pub fn pack_key8(raw: &str) -> [u8; 8] {
    let mut out = [0u8; 8];
    let norm = normalize_search_key(raw);
    let bytes = norm.as_bytes();
    let n = bytes.len().min(8);
    out[..n].copy_from_slice(&bytes[..n]);
    out
}

#[must_use]
pub fn pack_key32(raw: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    let norm = normalize_search_key(raw);
    let bytes = norm.as_bytes();
    let n = bytes.len().min(32);
    out[..n].copy_from_slice(&bytes[..n]);
    out
}

#[derive(Clone, Copy)]
struct U32Slot {
    key: u32,
    flags: u32,
    offset: u64,
    len: u32,
    fnv32: u32,
}

#[derive(Clone, Copy)]
struct Key8Slot {
    key: [u8; 8],
    offset: u64,
    len: u32,
    fnv32: u32,
}

#[derive(Clone, Copy)]
struct Key32Slot {
    key: [u8; 32],
    offset: u64,
    len: u32,
    fnv32: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AtlasManifestStats {
    pub vessel_count: u64,
    pub iacs_count: u64,
    pub port_count: u64,
    pub smdg_count: u64,
    pub company_count: u64,
    pub country_count: u64,
    pub regulation_count: u64,
    pub built_unix_s: u64,
    pub total_mapped_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockPtr {
    pub offset: u64,
    pub len: u32,
    pub fnv32: u32,
}

/// Streaming writer that constructs `vessels_blocks.rkyv`, `vessels_index.rkyv`,
/// `entities_blocks.rkyv`, and `entities_index.rkyv` without holding 100k records in RAM.
pub struct AtlasStoreWriter {
    dir: PathBuf,
    built_unix_s: u64,
    vblk_writer: BufWriter<File>,
    vblk_shard_idx: usize,
    vblk_cursor: u64,
    eblk_writer: BufWriter<File>,
    eblk_cursor: u64,
    vessel_count: u64,
    iacs_count: u64,
    port_count: u64,
    smdg_count: u64,
    company_count: u64,
    country_count: u64,
    regulation_count: u64,
    imo_slots: Vec<U32Slot>,
    mmsi_slots: Vec<U32Slot>,
    vessel_tokens: Vec<Key32Slot>,
    port_codes: Vec<Key8Slot>,
    port_tokens: Vec<Key32Slot>,
    company_tokens: Vec<Key32Slot>,
    country_codes: Vec<Key8Slot>,
    country_tokens: Vec<Key32Slot>,
    regulation_tokens: Vec<Key32Slot>,
}

impl AtlasStoreWriter {
    fn open_vblk_shard(
        dir: &Path,
        shard_idx: usize,
        built_unix_s: u64,
    ) -> Result<BufWriter<File>, String> {
        let vblk_tmp = dir.join(format!("vessels_blocks_{shard_idx:02}.rkyv.tmp"));
        let mut vblk_writer = BufWriter::with_capacity(
            256 * 1024,
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&vblk_tmp)
                .map_err(|e| format!("open vblk tmp failed: {e}"))?,
        );
        let mut vhdr = [0u8; BLK_HEADER_BYTES];
        vhdr[0..16].copy_from_slice(VBLK_MAGIC);
        vhdr[24..32].copy_from_slice(&built_unix_s.to_le_bytes());
        vblk_writer
            .write_all(&vhdr)
            .map_err(|e| format!("write vblk hdr failed: {e}"))?;
        Ok(vblk_writer)
    }

    pub fn create(dir: &Path, built_unix_s: u64) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| format!("create atlas dir failed: {e}"))?;

        let vblk_writer = Self::open_vblk_shard(dir, 0, built_unix_s)?;

        let eblk_tmp = dir.join("entities_blocks.rkyv.tmp");
        let mut eblk_writer = BufWriter::with_capacity(
            128 * 1024,
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&eblk_tmp)
                .map_err(|e| format!("open eblk tmp failed: {e}"))?,
        );
        let mut ehdr = [0u8; BLK_HEADER_BYTES];
        ehdr[0..16].copy_from_slice(EBLK_MAGIC);
        ehdr[24..32].copy_from_slice(&built_unix_s.to_le_bytes());
        eblk_writer
            .write_all(&ehdr)
            .map_err(|e| format!("write eblk hdr failed: {e}"))?;

        Ok(Self {
            dir: dir.to_path_buf(),
            built_unix_s,
            vblk_writer,
            vblk_shard_idx: 0,
            vblk_cursor: BLK_HEADER_BYTES as u64,
            eblk_writer,
            eblk_cursor: BLK_HEADER_BYTES as u64,
            vessel_count: 0,
            iacs_count: 0,
            port_count: 0,
            smdg_count: 0,
            company_count: 0,
            country_count: 0,
            regulation_count: 0,
            imo_slots: Vec::with_capacity(110_000),
            mmsi_slots: Vec::with_capacity(90_000),
            vessel_tokens: Vec::with_capacity(320_000),
            port_codes: Vec::with_capacity(120_000),
            port_tokens: Vec::with_capacity(240_000),
            company_tokens: Vec::with_capacity(32_000),
            country_codes: Vec::with_capacity(300),
            country_tokens: Vec::with_capacity(600),
            regulation_tokens: Vec::with_capacity(256),
        })
    }

    fn write_aligned_record<T>(
        writer: &mut BufWriter<File>,
        cursor: &mut u64,
        val: &T,
    ) -> Result<(u64, u32, u32), String>
    where
        T: Archive
            + for<'a> Serialize<
                rkyv::api::high::HighSerializer<
                    rkyv::util::AlignedVec,
                    rkyv::ser::allocator::ArenaHandle<'a>,
                    RkyvError,
                >,
            >,
    {
        let bytes = rkyv::to_bytes::<RkyvError>(val).map_err(|e| format!("rkyv serialize: {e}"))?;
        let offset = *cursor;
        debug_assert_eq!(offset % (BLOCK_ALIGN as u64), 0);
        let len = bytes.len() as u32;
        let hash = fnv1a_32(&bytes);
        writer
            .write_all(&bytes)
            .map_err(|e| format!("write record block failed: {e}"))?;
        let rem = bytes.len() % BLOCK_ALIGN;
        let pad = if rem == 0 { 0 } else { BLOCK_ALIGN - rem };
        if pad > 0 {
            const ZEROS: [u8; BLOCK_ALIGN] = [0u8; BLOCK_ALIGN];
            writer
                .write_all(&ZEROS[..pad])
                .map_err(|e| format!("write align pad failed: {e}"))?;
        }
        *cursor += (bytes.len() + pad) as u64;
        Ok((offset, len, hash))
    }

    fn push_tokens(
        dst: &mut Vec<Key32Slot>,
        seen: &mut HashSet<[u8; 32]>,
        raw: &str,
        offset: u64,
        len: u32,
        fnv32: u32,
        split_words: bool,
    ) {
        let full = pack_key32(raw);
        if full[0] != 0 && seen.insert(full) {
            dst.push(Key32Slot {
                key: full,
                offset,
                len,
                fnv32,
            });
        }
        if split_words {
            let norm = normalize_search_key(raw);
            for word in norm.split(' ') {
                if word.len() >= 3 {
                    let wp = pack_key32(word);
                    if wp[0] != 0 && seen.insert(wp) {
                        dst.push(Key32Slot {
                            key: wp,
                            offset,
                            len,
                            fnv32,
                        });
                    }
                }
            }
        }
    }

    pub fn push_vessel(&mut self, v: &VesselFullRecord) -> Result<(), String> {
        if self.vblk_cursor >= MAX_VBLK_SHARD_BYTES {
            self.vblk_writer
                .flush()
                .map_err(|e| format!("flush vblk shard: {e}"))?;
            self.vblk_shard_idx = self.vblk_shard_idx.saturating_add(1);
            self.vblk_writer =
                Self::open_vblk_shard(&self.dir, self.vblk_shard_idx, self.built_unix_s)?;
            self.vblk_cursor = BLK_HEADER_BYTES as u64;
        }
        let (local_offset, len, fnv32) =
            Self::write_aligned_record(&mut self.vblk_writer, &mut self.vblk_cursor, v)?;
        let offset = ((self.vblk_shard_idx as u64) << 56) | local_offset;
        self.vessel_count += 1;
        if v.class_chain.society.is_iacs_member() {
            self.iacs_count += 1;
        }
        let mut flags = 0u32;
        if v.class_chain.society.is_iacs_member() {
            flags |= 1;
        }
        if v.opensanctions_match {
            flags |= 2;
        }
        if v.imo > 0 {
            self.imo_slots.push(U32Slot {
                key: v.imo,
                flags,
                offset,
                len,
                fnv32,
            });
        }
        if v.mmsi > 0 {
            self.mmsi_slots.push(U32Slot {
                key: v.mmsi,
                flags,
                offset,
                len,
                fnv32,
            });
        }

        let mut seen = HashSet::with_capacity(8);
        Self::push_tokens(
            &mut self.vessel_tokens,
            &mut seen,
            &v.current_name,
            offset,
            len,
            fnv32,
            true,
        );
        if !v.callsign.is_empty() {
            Self::push_tokens(
                &mut self.vessel_tokens,
                &mut seen,
                &v.callsign,
                offset,
                len,
                fnv32,
                false,
            );
        }
        if let Some(eni) = &v.eni {
            Self::push_tokens(
                &mut self.vessel_tokens,
                &mut seen,
                eni,
                offset,
                len,
                fnv32,
                false,
            );
        }
        for former in &v.former_names {
            Self::push_tokens(
                &mut self.vessel_tokens,
                &mut seen,
                former,
                offset,
                len,
                fnv32,
                true,
            );
        }
        if v.imo > 0 {
            let imo_tag = format!("IMO{}", v.imo);
            Self::push_tokens(
                &mut self.vessel_tokens,
                &mut seen,
                &imo_tag,
                offset,
                len,
                fnv32,
                false,
            );
        }
        Ok(())
    }

    pub fn push_port(&mut self, p: &PortFullRecord) -> Result<(), String> {
        let (offset, len, fnv32) =
            Self::write_aligned_record(&mut self.eblk_writer, &mut self.eblk_cursor, p)?;
        self.port_count += 1;
        self.smdg_count += p.terminals.len() as u64;
        self.port_codes.push(Key8Slot {
            key: pack_key8(&p.unlocode),
            offset,
            len,
            fnv32,
        });
        let mut seen = HashSet::with_capacity(6);
        Self::push_tokens(
            &mut self.port_tokens,
            &mut seen,
            &p.name,
            offset,
            len,
            fnv32,
            true,
        );
        Self::push_tokens(
            &mut self.port_tokens,
            &mut seen,
            &p.unlocode,
            offset,
            len,
            fnv32,
            false,
        );
        for term in &p.terminals {
            Self::push_tokens(
                &mut self.port_tokens,
                &mut seen,
                &term.terminal_code,
                offset,
                len,
                fnv32,
                false,
            );
            Self::push_tokens(
                &mut self.port_tokens,
                &mut seen,
                &term.facility_name,
                offset,
                len,
                fnv32,
                true,
            );
        }
        Ok(())
    }

    pub fn push_company(&mut self, c: &CompanyProfile) -> Result<(), String> {
        let (offset, len, fnv32) =
            Self::write_aligned_record(&mut self.eblk_writer, &mut self.eblk_cursor, c)?;
        self.company_count += 1;
        let mut seen = HashSet::with_capacity(6);
        Self::push_tokens(
            &mut self.company_tokens,
            &mut seen,
            &c.name,
            offset,
            len,
            fnv32,
            true,
        );
        Self::push_tokens(
            &mut self.company_tokens,
            &mut seen,
            &c.company_id,
            offset,
            len,
            fnv32,
            false,
        );
        if !c.gleif_lei.is_empty() {
            Self::push_tokens(
                &mut self.company_tokens,
                &mut seen,
                &c.gleif_lei,
                offset,
                len,
                fnv32,
                false,
            );
        }
        if let Some(imo_co) = c.imo_company_no {
            let tag = format!("IMOCO{imo_co}");
            Self::push_tokens(
                &mut self.company_tokens,
                &mut seen,
                &tag,
                offset,
                len,
                fnv32,
                false,
            );
        }
        Ok(())
    }

    pub fn push_country(&mut self, c: &CountryMaritimeProfile) -> Result<(), String> {
        let (offset, len, fnv32) =
            Self::write_aligned_record(&mut self.eblk_writer, &mut self.eblk_cursor, c)?;
        self.country_count += 1;
        let code_str = std::str::from_utf8(&c.iso2).unwrap_or("XX");
        self.country_codes.push(Key8Slot {
            key: pack_key8(code_str),
            offset,
            len,
            fnv32,
        });
        let mut seen = HashSet::with_capacity(4);
        Self::push_tokens(
            &mut self.country_tokens,
            &mut seen,
            &c.name,
            offset,
            len,
            fnv32,
            true,
        );
        Self::push_tokens(
            &mut self.country_tokens,
            &mut seen,
            code_str,
            offset,
            len,
            fnv32,
            false,
        );
        Ok(())
    }

    pub fn push_regulation(&mut self, r: &RegulationRuleRecord) -> Result<(), String> {
        let (offset, len, fnv32) =
            Self::write_aligned_record(&mut self.eblk_writer, &mut self.eblk_cursor, r)?;
        self.regulation_count += 1;
        let mut seen = HashSet::with_capacity(6);
        Self::push_tokens(
            &mut self.regulation_tokens,
            &mut seen,
            &r.rule_id,
            offset,
            len,
            fnv32,
            false,
        );
        Self::push_tokens(
            &mut self.regulation_tokens,
            &mut seen,
            &r.title,
            offset,
            len,
            fnv32,
            true,
        );
        if !r.celex_or_ref.is_empty() {
            Self::push_tokens(
                &mut self.regulation_tokens,
                &mut seen,
                &r.celex_or_ref,
                offset,
                len,
                fnv32,
                false,
            );
        }
        Ok(())
    }

    fn write_u32_slots(w: &mut BufWriter<File>, slots: &mut [U32Slot]) -> Result<(), String> {
        slots.sort_unstable_by(|a, b| a.key.cmp(&b.key).then_with(|| a.offset.cmp(&b.offset)));
        for s in slots.iter() {
            w.write_all(&s.key.to_le_bytes())
                .map_err(|e| format!("write u32 key: {e}"))?;
            w.write_all(&s.flags.to_le_bytes())
                .map_err(|e| format!("write u32 flags: {e}"))?;
            w.write_all(&s.offset.to_le_bytes())
                .map_err(|e| format!("write u32 offset: {e}"))?;
            w.write_all(&s.len.to_le_bytes())
                .map_err(|e| format!("write u32 len: {e}"))?;
            w.write_all(&s.fnv32.to_le_bytes())
                .map_err(|e| format!("write u32 fnv32: {e}"))?;
        }
        Ok(())
    }

    fn write_key8_slots(w: &mut BufWriter<File>, slots: &mut [Key8Slot]) -> Result<(), String> {
        slots.sort_unstable_by(|a, b| a.key.cmp(&b.key).then_with(|| a.offset.cmp(&b.offset)));
        for s in slots.iter() {
            w.write_all(&s.key)
                .map_err(|e| format!("write key8: {e}"))?;
            w.write_all(&s.offset.to_le_bytes())
                .map_err(|e| format!("write key8 offset: {e}"))?;
            w.write_all(&s.len.to_le_bytes())
                .map_err(|e| format!("write key8 len: {e}"))?;
            w.write_all(&s.fnv32.to_le_bytes())
                .map_err(|e| format!("write key8 fnv32: {e}"))?;
        }
        Ok(())
    }

    fn write_key32_slots(w: &mut BufWriter<File>, slots: &mut [Key32Slot]) -> Result<(), String> {
        slots.sort_unstable_by(|a, b| a.key.cmp(&b.key).then_with(|| a.offset.cmp(&b.offset)));
        for s in slots.iter() {
            w.write_all(&s.key)
                .map_err(|e| format!("write key32: {e}"))?;
            w.write_all(&s.offset.to_le_bytes())
                .map_err(|e| format!("write key32 offset: {e}"))?;
            w.write_all(&s.len.to_le_bytes())
                .map_err(|e| format!("write key32 len: {e}"))?;
            w.write_all(&s.fnv32.to_le_bytes())
                .map_err(|e| format!("write key32 fnv32: {e}"))?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<AtlasManifestStats, String> {
        self.vblk_writer
            .flush()
            .map_err(|e| format!("flush vblk: {e}"))?;
        self.eblk_writer
            .flush()
            .map_err(|e| format!("flush eblk: {e}"))?;
        drop(self.vblk_writer);
        drop(self.eblk_writer);

        let vidx_tmp = self.dir.join("vessels_index.rkyv.tmp");
        {
            let mut w = BufWriter::with_capacity(
                256 * 1024,
                OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&vidx_tmp)
                    .map_err(|e| format!("open vidx tmp: {e}"))?,
            );
            let mut hdr = [0u8; VIDX_HEADER_BYTES];
            hdr[0..16].copy_from_slice(VIDX_MAGIC);
            hdr[16..24].copy_from_slice(&self.vessel_count.to_le_bytes());
            hdr[24..32].copy_from_slice(&self.iacs_count.to_le_bytes());
            hdr[32..40].copy_from_slice(&(self.imo_slots.len() as u64).to_le_bytes());
            hdr[40..48].copy_from_slice(&(self.mmsi_slots.len() as u64).to_le_bytes());
            hdr[48..56].copy_from_slice(&(self.vessel_tokens.len() as u64).to_le_bytes());
            hdr[56..64].copy_from_slice(&self.built_unix_s.to_le_bytes());
            w.write_all(&hdr)
                .map_err(|e| format!("write vidx hdr: {e}"))?;
            Self::write_u32_slots(&mut w, &mut self.imo_slots)?;
            Self::write_u32_slots(&mut w, &mut self.mmsi_slots)?;
            Self::write_key32_slots(&mut w, &mut self.vessel_tokens)?;
            w.flush().map_err(|e| format!("flush vidx: {e}"))?;
        }

        let eidx_tmp = self.dir.join("entities_index.rkyv.tmp");
        {
            let mut w = BufWriter::with_capacity(
                256 * 1024,
                OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&eidx_tmp)
                    .map_err(|e| format!("open eidx tmp: {e}"))?,
            );
            let mut hdr = [0u8; EIDX_HEADER_BYTES];
            hdr[0..16].copy_from_slice(EIDX_MAGIC);
            hdr[16..24].copy_from_slice(&self.port_count.to_le_bytes());
            hdr[24..32].copy_from_slice(&self.smdg_count.to_le_bytes());
            hdr[32..40].copy_from_slice(&self.company_count.to_le_bytes());
            hdr[40..48].copy_from_slice(&self.country_count.to_le_bytes());
            hdr[48..56].copy_from_slice(&self.regulation_count.to_le_bytes());
            hdr[56..64].copy_from_slice(&(self.port_codes.len() as u64).to_le_bytes());
            hdr[64..72].copy_from_slice(&(self.port_tokens.len() as u64).to_le_bytes());
            hdr[72..80].copy_from_slice(&(self.company_tokens.len() as u64).to_le_bytes());
            hdr[80..88].copy_from_slice(&(self.country_codes.len() as u64).to_le_bytes());
            hdr[88..96].copy_from_slice(&(self.country_tokens.len() as u64).to_le_bytes());
            hdr[96..104].copy_from_slice(&(self.regulation_tokens.len() as u64).to_le_bytes());
            hdr[104..112].copy_from_slice(&self.built_unix_s.to_le_bytes());
            w.write_all(&hdr)
                .map_err(|e| format!("write eidx hdr: {e}"))?;
            Self::write_key8_slots(&mut w, &mut self.port_codes)?;
            Self::write_key32_slots(&mut w, &mut self.port_tokens)?;
            Self::write_key32_slots(&mut w, &mut self.company_tokens)?;
            Self::write_key8_slots(&mut w, &mut self.country_codes)?;
            Self::write_key32_slots(&mut w, &mut self.country_tokens)?;
            Self::write_key32_slots(&mut w, &mut self.regulation_tokens)?;
            w.flush().map_err(|e| format!("flush eidx: {e}"))?;
        }

        let legacy_vblk = self.dir.join("vessels_blocks.rkyv");
        if legacy_vblk.exists() {
            let _ = fs::remove_file(&legacy_vblk);
        }
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for ent in entries.flatten() {
                let name = ent.file_name();
                let s = name.to_string_lossy();
                if s.starts_with("vessels_blocks_") && s.ends_with(".rkyv") {
                    let _ = fs::remove_file(ent.path());
                }
            }
        }

        let mut pairs: Vec<(String, String)> = (0..=self.vblk_shard_idx)
            .map(|idx| {
                (
                    format!("vessels_blocks_{idx:02}.rkyv.tmp"),
                    format!("vessels_blocks_{idx:02}.rkyv"),
                )
            })
            .collect();
        pairs.extend([
            (
                "vessels_index.rkyv.tmp".to_string(),
                "vessels_index.rkyv".to_string(),
            ),
            (
                "entities_blocks.rkyv.tmp".to_string(),
                "entities_blocks.rkyv".to_string(),
            ),
            (
                "entities_index.rkyv.tmp".to_string(),
                "entities_index.rkyv".to_string(),
            ),
        ]);
        let mut total_mapped_bytes = 0u64;
        for (src_name, dst_name) in pairs {
            let src = self.dir.join(&src_name);
            let dst = self.dir.join(&dst_name);
            if dst.exists() {
                let _ = fs::remove_file(&dst);
            }
            fs::rename(&src, &dst).map_err(|e| format!("rename {src_name} -> {dst_name}: {e}"))?;
            if let Ok(meta) = fs::metadata(&dst) {
                total_mapped_bytes += meta.len();
            }
        }

        Ok(AtlasManifestStats {
            vessel_count: self.vessel_count,
            iacs_count: self.iacs_count,
            port_count: self.port_count,
            smdg_count: self.smdg_count,
            company_count: self.company_count,
            country_count: self.country_count,
            regulation_count: self.regulation_count,
            built_unix_s: self.built_unix_s,
            total_mapped_bytes,
        })
    }
}

/// Zero-copy memory-mapped Atlas store (`< 256 KiB` resident on open).
pub struct MmapAtlasStore {
    vblk_shards: Vec<Mmap>,
    vidx: Mmap,
    eblk: Mmap,
    eidx: Mmap,
    stats: AtlasManifestStats,
    imo_range: (usize, usize),
    mmsi_range: (usize, usize),
    vtok_range: (usize, usize),
    pcode_range: (usize, usize),
    ptok_range: (usize, usize),
    ctok_range: (usize, usize),
    kcode_range: (usize, usize),
    ktok_range: (usize, usize),
    rtok_range: (usize, usize),
}

#[allow(unsafe_code)]
fn map_readonly(path: &Path) -> Result<Mmap, String> {
    let file = File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    unsafe { MmapOptions::new().map(&file) }.map_err(|e| format!("mmap {}: {e}", path.display()))
}

#[inline]
fn read_u64_le(buf: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
}

#[inline]
fn read_u32_le(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
}

impl MmapAtlasStore {
    /// Maps all index and sharded block arenas read-only without reading non-header pages.
    pub fn open(dir: &Path) -> Result<Self, String> {
        let mut vblk_shards = Vec::new();
        for idx in 0..256usize {
            let shard_path = dir.join(format!("vessels_blocks_{idx:02}.rkyv"));
            if !shard_path.exists() {
                if idx == 0 {
                    return Err(format!("missing {}", shard_path.display()));
                }
                break;
            }
            let shard = map_readonly(&shard_path)?;
            if shard.len() < BLK_HEADER_BYTES || &shard[0..16] != VBLK_MAGIC {
                return Err(format!("vessels_blocks_{idx:02}.rkyv header invalid"));
            }
            vblk_shards.push(shard);
        }
        let vidx = map_readonly(&dir.join("vessels_index.rkyv"))?;
        let eblk = map_readonly(&dir.join("entities_blocks.rkyv"))?;
        let eidx = map_readonly(&dir.join("entities_index.rkyv"))?;

        if vidx.len() < VIDX_HEADER_BYTES || &vidx[0..16] != VIDX_MAGIC {
            return Err("vessels_index.rkyv header invalid".to_string());
        }
        if eblk.len() < BLK_HEADER_BYTES || &eblk[0..16] != EBLK_MAGIC {
            return Err("entities_blocks.rkyv header invalid".to_string());
        }
        if eidx.len() < EIDX_HEADER_BYTES || &eidx[0..16] != EIDX_MAGIC {
            return Err("entities_index.rkyv header invalid".to_string());
        }

        let vessel_count = read_u64_le(&vidx, 16);
        let iacs_count = read_u64_le(&vidx, 24);
        let imo_n = read_u64_le(&vidx, 32) as usize;
        let mmsi_n = read_u64_le(&vidx, 40) as usize;
        let vtok_n = read_u64_le(&vidx, 48) as usize;
        let built_unix_s = read_u64_le(&vidx, 56);

        let imo_start = VIDX_HEADER_BYTES;
        let mmsi_start = imo_start + imo_n * SLOT24_BYTES;
        let vtok_start = mmsi_start + mmsi_n * SLOT24_BYTES;
        let vidx_expected = vtok_start + vtok_n * SLOT48_BYTES;
        if vidx.len() < vidx_expected {
            return Err("vessels_index.rkyv truncated".to_string());
        }

        let port_count = read_u64_le(&eidx, 16);
        let smdg_count = read_u64_le(&eidx, 24);
        let company_count = read_u64_le(&eidx, 32);
        let country_count = read_u64_le(&eidx, 40);
        let regulation_count = read_u64_le(&eidx, 48);

        let pcode_n = read_u64_le(&eidx, 56) as usize;
        let ptok_n = read_u64_le(&eidx, 64) as usize;
        let ctok_n = read_u64_le(&eidx, 72) as usize;
        let kcode_n = read_u64_le(&eidx, 80) as usize;
        let ktok_n = read_u64_le(&eidx, 88) as usize;
        let rtok_n = read_u64_le(&eidx, 96) as usize;

        let pcode_start = EIDX_HEADER_BYTES;
        let ptok_start = pcode_start + pcode_n * SLOT24_BYTES;
        let ctok_start = ptok_start + ptok_n * SLOT48_BYTES;
        let kcode_start = ctok_start + ctok_n * SLOT48_BYTES;
        let ktok_start = kcode_start + kcode_n * SLOT24_BYTES;
        let rtok_start = ktok_start + ktok_n * SLOT48_BYTES;
        let eidx_expected = rtok_start + rtok_n * SLOT48_BYTES;
        if eidx.len() < eidx_expected {
            return Err("entities_index.rkyv truncated".to_string());
        }

        let vblk_bytes: usize = vblk_shards.iter().map(|s| s.len()).sum();
        let total_mapped_bytes = (vblk_bytes + vidx.len() + eblk.len() + eidx.len()) as u64;
        let stats = AtlasManifestStats {
            vessel_count,
            iacs_count,
            port_count,
            smdg_count,
            company_count,
            country_count,
            regulation_count,
            built_unix_s,
            total_mapped_bytes,
        };

        Ok(Self {
            vblk_shards,
            vidx,
            eblk,
            eidx,
            stats,
            imo_range: (imo_start, imo_n),
            mmsi_range: (mmsi_start, mmsi_n),
            vtok_range: (vtok_start, vtok_n),
            pcode_range: (pcode_start, pcode_n),
            ptok_range: (ptok_start, ptok_n),
            ctok_range: (ctok_start, ctok_n),
            kcode_range: (kcode_start, kcode_n),
            ktok_range: (ktok_start, ktok_n),
            rtok_range: (rtok_start, rtok_n),
        })
    }

    #[must_use]
    pub const fn stats(&self) -> AtlasManifestStats {
        self.stats
    }

    fn bsearch_u32(idx: &[u8], range: (usize, usize), key: u32) -> Option<BlockPtr> {
        let (start, count) = range;
        if count == 0 {
            return None;
        }
        let mut lo = 0usize;
        let mut hi = count;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let off = start + mid * SLOT24_BYTES;
            let slot_key = read_u32_le(idx, off);
            if slot_key < key {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo < count {
            let off = start + lo * SLOT24_BYTES;
            if read_u32_le(idx, off) == key {
                return Some(BlockPtr {
                    offset: read_u64_le(idx, off + 8),
                    len: read_u32_le(idx, off + 16),
                    fnv32: read_u32_le(idx, off + 20),
                });
            }
        }
        None
    }

    fn bsearch_key8(idx: &[u8], range: (usize, usize), key: &[u8; 8]) -> Option<BlockPtr> {
        let (start, count) = range;
        if count == 0 {
            return None;
        }
        let mut lo = 0usize;
        let mut hi = count;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let off = start + mid * SLOT24_BYTES;
            if idx[off..off + 8] < key[..] {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo < count {
            let off = start + lo * SLOT24_BYTES;
            if idx[off..off + 8] == key[..] {
                return Some(BlockPtr {
                    offset: read_u64_le(idx, off + 8),
                    len: read_u32_le(idx, off + 16),
                    fnv32: read_u32_le(idx, off + 20),
                });
            }
        }
        None
    }

    fn bsearch_key32_prefix(
        idx: &[u8],
        range: (usize, usize),
        norm_query: &str,
        limit: usize,
    ) -> Vec<BlockPtr> {
        let mut out = Vec::new();
        let (start, count) = range;
        if count == 0 || norm_query.is_empty() || limit == 0 {
            return out;
        }
        let q_bytes = norm_query.as_bytes();
        let prefix_len = q_bytes.len().min(32);
        let mut q_padded = [0u8; 32];
        q_padded[..prefix_len].copy_from_slice(&q_bytes[..prefix_len]);

        let mut lo = 0usize;
        let mut hi = count;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let off = start + mid * SLOT48_BYTES;
            if idx[off..off + 32] < q_padded[..] {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        let mut cur = lo;
        while cur < count && out.len() < limit {
            let off = start + cur * SLOT48_BYTES;
            if idx[off..off + prefix_len] != q_padded[..prefix_len] {
                break;
            }
            let ptr = BlockPtr {
                offset: read_u64_le(idx, off + 32),
                len: read_u32_le(idx, off + 40),
                fnv32: read_u32_le(idx, off + 44),
            };
            if !out.iter().any(|p: &BlockPtr| p.offset == ptr.offset) {
                out.push(ptr);
            }
            cur += 1;
        }
        out
    }

    fn access_block<'a, T>(arena: &'a Mmap, ptr: BlockPtr) -> Result<&'a T::Archived, String>
    where
        T: Archive,
        T::Archived:
            for<'b> rkyv::bytecheck::CheckBytes<rkyv::api::high::HighValidator<'b, RkyvError>>,
    {
        let start = ptr.offset as usize;
        let end = start.saturating_add(ptr.len as usize);
        if end > arena.len() || start < BLK_HEADER_BYTES {
            return Err("atlas block pointer out of bounds".to_string());
        }
        let slice = &arena[start..end];
        if fnv1a_32(slice) != ptr.fnv32 {
            return Err("atlas block fnv32 checksum mismatch".to_string());
        }
        rkyv::access::<T::Archived, RkyvError>(slice).map_err(|e| format!("rkyv access error: {e}"))
    }

    pub fn get_vessel_at(&self, ptr: BlockPtr) -> Result<&ArchivedVesselFullRecord, String> {
        let shard_idx = (ptr.offset >> 56) as usize;
        let shard = self
            .vblk_shards
            .get(shard_idx)
            .ok_or_else(|| "atlas vessel shard out of bounds".to_string())?;
        let local_ptr = BlockPtr {
            offset: ptr.offset & VBLK_OFFSET_MASK,
            len: ptr.len,
            fnv32: ptr.fnv32,
        };
        Self::access_block::<VesselFullRecord>(shard, local_ptr)
    }

    pub fn get_vessel_by_imo(&self, imo: u32) -> Result<Option<&ArchivedVesselFullRecord>, String> {
        match Self::bsearch_u32(&self.vidx, self.imo_range, imo) {
            Some(ptr) => self.get_vessel_at(ptr).map(Some),
            None => Ok(None),
        }
    }

    pub fn get_vessel_by_mmsi(
        &self,
        mmsi: u32,
    ) -> Result<Option<&ArchivedVesselFullRecord>, String> {
        match Self::bsearch_u32(&self.vidx, self.mmsi_range, mmsi) {
            Some(ptr) => self.get_vessel_at(ptr).map(Some),
            None => Ok(None),
        }
    }

    pub fn search_vessels_by_token(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<&ArchivedVesselFullRecord>, String> {
        let norm = normalize_search_key(query);
        let ptrs = Self::bsearch_key32_prefix(&self.vidx, self.vtok_range, &norm, limit);
        let mut out = Vec::with_capacity(ptrs.len());
        for ptr in ptrs {
            out.push(self.get_vessel_at(ptr)?);
        }
        Ok(out)
    }

    pub fn get_port_by_unlocode(
        &self,
        unlocode: &str,
    ) -> Result<Option<&ArchivedPortFullRecord>, String> {
        let key = pack_key8(unlocode);
        match Self::bsearch_key8(&self.eidx, self.pcode_range, &key) {
            Some(ptr) => Self::access_block::<PortFullRecord>(&self.eblk, ptr).map(Some),
            None => Ok(None),
        }
    }

    pub fn search_ports_by_token(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<&ArchivedPortFullRecord>, String> {
        let norm = normalize_search_key(query);
        let ptrs = Self::bsearch_key32_prefix(&self.eidx, self.ptok_range, &norm, limit);
        let mut out = Vec::with_capacity(ptrs.len());
        for ptr in ptrs {
            out.push(Self::access_block::<PortFullRecord>(&self.eblk, ptr)?);
        }
        Ok(out)
    }

    pub fn search_companies_by_token(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<&ArchivedCompanyProfile>, String> {
        let norm = normalize_search_key(query);
        let ptrs = Self::bsearch_key32_prefix(&self.eidx, self.ctok_range, &norm, limit);
        let mut out = Vec::with_capacity(ptrs.len());
        for ptr in ptrs {
            out.push(Self::access_block::<CompanyProfile>(&self.eblk, ptr)?);
        }
        Ok(out)
    }

    pub fn get_country_by_iso2(
        &self,
        iso2: &str,
    ) -> Result<Option<&ArchivedCountryMaritimeProfile>, String> {
        let key = pack_key8(iso2);
        match Self::bsearch_key8(&self.eidx, self.kcode_range, &key) {
            Some(ptr) => Self::access_block::<CountryMaritimeProfile>(&self.eblk, ptr).map(Some),
            None => Ok(None),
        }
    }

    pub fn search_countries_by_token(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<&ArchivedCountryMaritimeProfile>, String> {
        let norm = normalize_search_key(query);
        let ptrs = Self::bsearch_key32_prefix(&self.eidx, self.ktok_range, &norm, limit);
        let mut out = Vec::with_capacity(ptrs.len());
        for ptr in ptrs {
            out.push(Self::access_block::<CountryMaritimeProfile>(
                &self.eblk, ptr,
            )?);
        }
        Ok(out)
    }

    pub fn search_regulations_by_token(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<&ArchivedRegulationRuleRecord>, String> {
        let norm = normalize_search_key(query);
        let ptrs = Self::bsearch_key32_prefix(&self.eidx, self.rtok_range, &norm, limit);
        let mut out = Vec::with_capacity(ptrs.len());
        for ptr in ptrs {
            out.push(Self::access_block::<RegulationRuleRecord>(&self.eblk, ptr)?);
        }
        Ok(out)
    }

    /// Streams sequential vessel IMO keys without holding heap copies of full records.
    pub fn sample_vessel_imos(&self, max_count: usize) -> Vec<u32> {
        let (start, count) = self.imo_range;
        let step = (count / max_count.max(1)).max(1);
        let mut out = Vec::with_capacity(max_count.min(count));
        let mut idx = 0usize;
        while idx < count && out.len() < max_count {
            let off = start + idx * SLOT24_BYTES;
            out.push(read_u32_le(&self.vidx, off));
            idx += step;
        }
        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::fleet_schema::*;

    pub(crate) fn test_vessel(imo: u32, mmsi: u32, name: &str) -> VesselFullRecord {
        VesselFullRecord {
            imo,
            mmsi,
            callsign: format!("TC{imo}"),
            eni: None,
            current_name: name.to_string(),
            former_names: vec!["AEGEAN PIONEER".to_string()],
            current_flag_iso2: *b"TR",
            flag_history_5y: vec![FlagHistoryEntry {
                flag_iso2: *b"TR",
                effective_from_unix_s: 1_650_000_000,
                effective_to_unix_s: 0,
                source_id: "equasis".to_string(),
            }],
            flag_hopping_score_bp: 0,
            vessel_type: VesselType::RoPax,
            gt: 4_850,
            nt: 2_100,
            dwt_tons: 1_450,
            lightship_tons: 2_900,
            loa_mm: 94_000,
            lbp_mm: 86_000,
            beam_mm: 16_800,
            air_draft_mm: 24_200,
            summer_draft_mm: 4_200,
            scantling_draft_mm: 4_500,
            teu: 0,
            lane_meters: 480,
            pax_capacity: 620,
            reefer_plugs: 16,
            main_engine_kw: 4_800,
            main_engine_rpm: 750,
            nox_tier: NoxTier::TierIII,
            sfoc_dg_kwh: 1_840,
            aux_gen_kw: 450,
            bow_thruster_kw: 600,
            stern_thruster_kw: 350,
            fuel_type: PropulsionFuel::Mgo,
            ops_ready: true,
            scrubber_fitted: false,
            ice_class: IceClass::None,
            build_year: 2019,
            shipyard: "Sefine Shipyard".to_string(),
            service_speed_centikn: 1_550,
            block_coeff_bp: 6_100,
            daily_opex_cents: 650_000,
            corporate: CorporateChain {
                registered_owner: "Aegean Ferry Co".to_string(),
                commercial_operator: "Aegean Lines".to_string(),
                ism_manager_doc_holder: "Aegean Marine Technical".to_string(),
                ubo_name: "Aegean Maritime Holdings".to_string(),
                ubo_bods_id: "BODS-AEG-01".to_string(),
                gleif_lei: "5493001KJTIIGC8Y1R12".to_string(),
                local_port_agents: vec![PortAgentEntry {
                    port_unlocode: "TRSEF".to_string(),
                    agent_name: "Sigacik Agency".to_string(),
                    gleif_lei: "5493001KJTIIGC8Y1R12".to_string(),
                }],
            },
            class_chain: ClassChain {
                society: ClassSociety::Tl,
                status: ClassStatus::InClass,
                annual_survey_ymd: 20260514,
                intermediate_survey_ymd: 20270514,
                special_survey_ymd: 20290514,
                conditions_of_class: 0,
                survey_overdue: false,
                notations: vec![
                    "+1A5".to_string(),
                    "RO-RO PASSENGER".to_string(),
                    "UMS".to_string(),
                ],
            },
            pi_chain: PiInsuranceChain {
                club: PiClub::TurkPi,
                feb20_renewal_year: 2026,
                feb20_blue_card_active: true,
                bunker_1000gt_cert: true,
                clc92_2000gt_cert: false,
                nairobi_wrc_300gt_cert: true,
                athens_pax_cert: true,
                hm_insurer: "Nordic Marine Hull".to_string(),
                fdd_active: true,
                jwc_war_risk_active: true,
            },
            live_ais: LiveAisState {
                lat_microdeg: 38_196_000,
                lon_microdeg: 26_836_000,
                sog_tenth_kn: 151,
                cog_tenth_deg: 1620,
                heading_deg: 162,
                draft_mm: 4_100,
                destination: "GRSMI".to_string(),
                eta_unix_s: 1_794_700_000,
                updated_unix_s: 1_794_600_000,
            },
            sar_dark_signal: false,
            ais_dark_gap_min: 0,
            sts_history: Vec::new(),
            psc_records: vec![PscInspectionEntry {
                authority: MouAuthority::MedMou,
                port_unlocode: "GRSMI".to_string(),
                inspection_ymd: 20260402,
                deficiencies: 0,
                detained: false,
                banned: false,
            }],
            cii_rating: CiiRating::A,
            opensanctions_match: false,
            opensanctions_id: None,
            opensanctions_datasets: Vec::new(),
            shadow_fleet_score_bp: 0,
            epistemic_tag: EpistemicStatus::Observation,
            registry_sources: vec!["wikidata".to_string(), "digitraffic".to_string()],
        }
    }

    #[test]
    fn alignment_bounds_and_zero_copy_roundtrip_work() {
        assert!(std::mem::align_of::<ArchivedVesselFullRecord>() <= BLOCK_ALIGN);
        assert!(std::mem::align_of::<ArchivedPortFullRecord>() <= BLOCK_ALIGN);
        assert!(std::mem::align_of::<ArchivedCompanyProfile>() <= BLOCK_ALIGN);
        assert!(std::mem::align_of::<ArchivedCountryMaritimeProfile>() <= BLOCK_ALIGN);
        assert!(std::mem::align_of::<ArchivedRegulationRuleRecord>() <= BLOCK_ALIGN);

        let dir = std::env::temp_dir().join("caelus_atlas_mmap_unit_test");
        let _ = fs::remove_dir_all(&dir);

        let mut writer = AtlasStoreWriter::create(&dir, 1_794_600_000).expect("writer");
        let v1 = test_vessel(9381240, 271044102, "M/V AEGEAN STAR");
        let v2 = test_vessel(9552070, 255916067, "FAROMAR");
        writer.push_vessel(&v1).expect("v1");
        writer.push_vessel(&v2).expect("v2");
        let stats = writer.finish().expect("finish");
        assert_eq!(stats.vessel_count, 2);
        assert_eq!(stats.iacs_count, 2);

        let store = MmapAtlasStore::open(&dir).expect("open");
        let found = store.get_vessel_by_imo(9552070).expect("imo").expect("hit");
        assert_eq!(found.current_name.as_str(), "FAROMAR");
        assert_eq!(found.mmsi.to_native(), 255916067);

        let tok_hits = store.search_vessels_by_token("aegean", 4).expect("tok");
        assert_eq!(tok_hits.len(), 2); // Both share former_name "AEGEAN PIONEER"

        let star_hits = store.search_vessels_by_token("star", 4).expect("star");
        assert_eq!(star_hits.len(), 1);
        assert_eq!(star_hits[0].imo.to_native(), 9381240);

        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }
}
