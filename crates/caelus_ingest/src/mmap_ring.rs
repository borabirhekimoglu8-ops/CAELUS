//! 64-byte aligned `rkyv` + `memmap2` zero-copy ring buffer (`data/offline_cache/ingest_ring.rkyv`).
//! Allows instant zero-parse reads across `caelus_daemon`, `caelus_ui`, and `caelus_tui`.

use memmap2::{Mmap, MmapOptions};
use rkyv::{Archive, Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::feeds::FeedKind;

pub const RING_HEADER_BYTES: usize = 64;
const MAGIC: &[u8; 16] = b"CAELUS_INGEST_R1";

#[derive(
    Archive, Serialize, Deserialize, serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq,
)]
pub struct IngestPin {
    pub id: u64,
    pub feed_kind: FeedKind,
    pub code: String,
    pub label: String,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub value_metric: f64,
    pub epistemic_tag: String,
    pub observed_unix_s: u64,
}

#[derive(
    Archive, Serialize, Deserialize, serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq,
)]
pub struct ArchivedIngestSnapshot {
    pub epoch_unix_s: u64,
    pub live_source_count: u32,
    pub cached_fallback_used: bool,
    pub dtn_queued_bundles: u32,
    pub reticulum_mesh_peers: u32,
    pub pins: Vec<IngestPin>,
}

fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// Writes `snapshot` into a 64-byte header + `rkyv`-archived payload file (`ingest_ring.rkyv`).
/// Payload starts at byte offset 64 (page-aligned + 64-byte aligned for direct zero-copy `rkyv::access`).
pub fn write_ring_snapshot(
    path: &Path,
    snapshot: &ArchivedIngestSnapshot,
) -> Result<usize, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir_all failed: {e}"))?;
    }

    let archived_bytes = rkyv::to_bytes::<rkyv::rancor::Error>(snapshot)
        .map_err(|e| format!("rkyv serialize: {e}"))?;
    let payload_len = archived_bytes.len() as u64;
    let checksum = fnv1a_64(&archived_bytes);

    let mut header = [0u8; RING_HEADER_BYTES];
    header[0..16].copy_from_slice(MAGIC);
    header[16..24].copy_from_slice(&payload_len.to_le_bytes());
    header[24..32].copy_from_slice(&checksum.to_le_bytes());

    let tmp_path = path.with_extension("rkyv.tmp");
    {
        let mut f = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| format!("open tmp ring failed: {e}"))?;
        f.write_all(&header)
            .map_err(|e| format!("write header: {e}"))?;
        f.write_all(&archived_bytes)
            .map_err(|e| format!("write payload: {e}"))?;
        f.sync_all().map_err(|e| format!("sync tmp ring: {e}"))?;
    }
    fs::rename(&tmp_path, path).map_err(|e| format!("atomic rename failed: {e}"))?;
    Ok(RING_HEADER_BYTES + archived_bytes.len())
}

pub struct MmapRingView {
    mmap: Mmap,
    payload_len: usize,
}

impl MmapRingView {
    /// Returns validated zero-copy view directly inside the memory-mapped file without copying.
    pub fn archived(&self) -> Result<&ArchivedArchivedIngestSnapshot, String> {
        let slice = &self.mmap[RING_HEADER_BYTES..RING_HEADER_BYTES + self.payload_len];
        rkyv::access::<ArchivedArchivedIngestSnapshot, rkyv::rancor::Error>(slice)
            .map_err(|e| format!("rkyv zero-copy validation failed: {e}"))
    }

    #[must_use]
    pub fn mapped_bytes(&self) -> usize {
        self.mmap.len()
    }
}

/// Memory-maps `path` read-only and verifies the 64-byte header + FNV-64 checksum + `rkyv` layout.
#[allow(unsafe_code)]
pub fn read_ring_zero_copy(path: &Path) -> Result<MmapRingView, String> {
    let file = File::open(path).map_err(|e| format!("open ring failed: {e}"))?;
    let mmap = unsafe { MmapOptions::new().map(&file) }.map_err(|e| format!("mmap failed: {e}"))?;
    if mmap.len() < RING_HEADER_BYTES {
        return Err("ring buffer truncated (< 64 bytes)".to_string());
    }
    if &mmap[0..16] != MAGIC {
        return Err("ring buffer magic mismatch".to_string());
    }
    let payload_len = u64::from_le_bytes(mmap[16..24].try_into().unwrap()) as usize;
    let expected_sum = u64::from_le_bytes(mmap[24..32].try_into().unwrap());
    if mmap.len() < RING_HEADER_BYTES.saturating_add(payload_len) {
        return Err("ring payload truncated".to_string());
    }
    let actual_sum = fnv1a_64(&mmap[RING_HEADER_BYTES..RING_HEADER_BYTES + payload_len]);
    if actual_sum != expected_sum {
        return Err("ring checksum mismatch".to_string());
    }
    let view = MmapRingView { mmap, payload_len };
    let _ = view.archived()?;
    Ok(view)
}
