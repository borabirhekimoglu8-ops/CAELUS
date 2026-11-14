//! `O(Delta)` Live Synchronization & Zero-Copy Atlas Archive Compiler.
//!
//! Reads `data/atlas_mmap/live_sources.toml`, honors HTTP `ETag` and `If-Modified-Since`
//! watermarks in `data/atlas_mmap/delta_watermarks.json`, runs `E-Graph + Z3` regulatory
//! verification, preserves prior state in `xtdb_bitemporal.rkyv`, and atomically writes
//! page-granular `rkyv + memmap2` vessel/entity and `Oxigraph` SPO archives.

use crate::bitemporal_xtdb::BitemporalEventLog;
use crate::fleet_schema::EpistemicStatus;
use crate::live_ingest::{ingest_all_sources, SourceFetchMeta};
use crate::mmap_store::{AtlasManifestStats, AtlasStoreWriter};
use crate::rule_verifier::{verify_regulations_egraph_z3, RuleVerificationReport};
use crate::spo_graph::SpoGraphWriter;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfiguredLiveSource {
    pub id: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveSourcesConfig {
    pub mode: String,
    pub memory_cap_mb: u32,
    pub sources: Vec<ConfiguredLiveSource>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeltaWatermarksFile {
    pub mode: String,
    pub last_build_unix_s: u64,
    pub sources: BTreeMap<String, SourceFetchMeta>,
}

#[derive(Debug, Clone)]
pub struct DeltaSyncReport {
    pub manifest: AtlasManifestStats,
    pub spo_triple_count: u64,
    pub xtdb_event_count: usize,
    pub verification: RuleVerificationReport,
    pub sources_checked: usize,
    pub sources_not_modified_304: usize,
    pub elapsed_ms: u64,
}

/// Parses `data/atlas_mmap/live_sources.toml` without extra dependencies.
pub fn parse_live_sources_toml(path: &Path) -> Result<LiveSourcesConfig, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut mode = "etag_if_modified_since".to_string();
    let mut memory_cap_mb = 40u32;
    let mut sources = Vec::new();
    let mut in_delta = false;
    let mut cur_id = String::new();
    let mut cur_url = String::new();

    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if line == "[delta_sync]" {
            in_delta = true;
            continue;
        }
        if line == "[[source]]" {
            in_delta = false;
            if !cur_id.is_empty() && !cur_url.is_empty() {
                sources.push(ConfiguredLiveSource {
                    id: std::mem::take(&mut cur_id),
                    url: std::mem::take(&mut cur_url),
                });
            }
            cur_id.clear();
            cur_url.clear();
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            let val = v.trim().trim_matches('"');
            if in_delta {
                if key == "mode" {
                    mode = val.to_string();
                } else if key == "memory_cap_mb" {
                    if let Ok(n) = val.parse::<u32>() {
                        memory_cap_mb = n;
                    }
                }
            } else if key == "id" {
                cur_id = val.to_string();
            } else if key == "url" {
                cur_url = val.to_string();
            }
        }
    }
    if !cur_id.is_empty() && !cur_url.is_empty() {
        sources.push(ConfiguredLiveSource {
            id: cur_id,
            url: cur_url,
        });
    }

    Ok(LiveSourcesConfig {
        mode,
        memory_cap_mb,
        sources,
    })
}

pub fn load_watermarks(mmap_dir: &Path) -> DeltaWatermarksFile {
    let path = mmap_dir.join("delta_watermarks.json");
    if let Ok(bytes) = fs::read(path) {
        if let Ok(wm) = serde_json::from_slice::<DeltaWatermarksFile>(&bytes) {
            return wm;
        }
    }
    DeltaWatermarksFile {
        mode: "etag_if_modified_since".to_string(),
        last_build_unix_s: 0,
        sources: BTreeMap::new(),
    }
}

pub fn save_watermarks(mmap_dir: &Path, wm: &DeltaWatermarksFile) -> Result<(), String> {
    fs::create_dir_all(mmap_dir).map_err(|e| format!("create mmap dir: {e}"))?;
    let path = mmap_dir.join("delta_watermarks.json");
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(wm).map_err(|e| format!("serialize watermarks: {e}"))?;
    fs::write(&tmp, &json).map_err(|e| format!("write watermarks tmp: {e}"))?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    fs::rename(&tmp, &path).map_err(|e| format!("rename watermarks: {e}"))
}

/// Runs `O(Delta)` source fetch + E-Graph/Z3 verification + XTDB bitemporal audit + zero-copy `rkyv` build.
pub fn sync_and_build_atlas(
    cache_dir: &Path,
    mmap_dir: &Path,
    enable_network: bool,
    timeout_ms: u64,
) -> Result<DeltaSyncReport, String> {
    let started = std::time::Instant::now();
    fs::create_dir_all(mmap_dir).map_err(|e| format!("create mmap dir: {e}"))?;

    let live_cfg_path = mmap_dir.join("live_sources.toml");
    let mode = if live_cfg_path.exists() {
        parse_live_sources_toml(&live_cfg_path)
            .map(|c| c.mode)
            .unwrap_or_else(|_| "etag_if_modified_since".to_string())
    } else {
        "etag_if_modified_since".to_string()
    };

    let prev_wm = load_watermarks(mmap_dir);
    let bundle = ingest_all_sources(cache_dir, &prev_wm.sources, enable_network, timeout_ms)?;

    let verification = verify_regulations_egraph_z3(&bundle.regulations);

    // Record bitemporal regulatory + live fleet watermarks into XTDB without overwriting history
    let xtdb_path = mmap_dir.join("xtdb_bitemporal.rkyv");
    let mut xtdb_log =
        BitemporalEventLog::load_or_new(&xtdb_path).unwrap_or_else(|_| BitemporalEventLog::new());
    for reg in &bundle.regulations {
        xtdb_log.record_transition(
            &format!("regulation:{}", reg.rule_id),
            "celex_sulfur_ukc",
            &format!(
                "ref={};ukc_mm={};sox_ppm={}",
                reg.celex_or_ref, reg.min_ukc_mm, reg.max_sulfur_ppm
            ),
            reg.valid_from_unix_s,
            bundle.built_unix_s,
            "eurlex_imo_sync",
            EpistemicStatus::Observation,
        );
    }
    // Persist anchor Aegean ferry/vessel registry transitions if missing or changed
    let iacs_count = bundle
        .vessels
        .iter()
        .filter(|v| v.class_chain.society.is_iacs_member())
        .count();
    xtdb_log.record_transition(
        "atlas:global_fleet",
        "fleet_snapshot",
        &format!(
            "vessels={};iacs={};ports={}",
            bundle.vessels.len(),
            iacs_count,
            bundle.ports.len()
        ),
        bundle.built_unix_s,
        bundle.built_unix_s,
        "caelus_atlas_delta_sync",
        EpistemicStatus::Observation,
    );
    let _ = xtdb_log.save_atomic(&xtdb_path)?;

    // Build page-granular rkyv + memmap2 stores
    let mut store_writer = AtlasStoreWriter::create(mmap_dir, bundle.built_unix_s)?;
    let mut spo_writer = SpoGraphWriter::new(bundle.built_unix_s);

    for v in &bundle.vessels {
        store_writer.push_vessel(v)?;
        spo_writer.ingest_vessel(v);
    }
    for p in &bundle.ports {
        store_writer.push_port(p)?;
        spo_writer.ingest_port(p);
    }
    for c in &bundle.companies {
        store_writer.push_company(c)?;
        spo_writer.ingest_company(c);
    }
    for k in &bundle.countries {
        store_writer.push_country(k)?;
        spo_writer.ingest_country(k);
    }
    for r in &bundle.regulations {
        store_writer.push_regulation(r)?;
        spo_writer.ingest_regulation(r);
    }

    let manifest = store_writer.finish()?;
    let spo_triple_count = spo_writer.write_to_file(&mmap_dir.join("spo_graph.rkyv"))?;

    let sources_checked = bundle.fetch_meta.len();
    let sources_not_modified_304 = bundle
        .fetch_meta
        .values()
        .filter(|m| m.not_modified_304)
        .count();

    let updated_wm = DeltaWatermarksFile {
        mode,
        last_build_unix_s: bundle.built_unix_s,
        sources: bundle.fetch_meta,
    };
    save_watermarks(mmap_dir, &updated_wm)?;

    Ok(DeltaSyncReport {
        manifest,
        spo_triple_count,
        xtdb_event_count: xtdb_log.events.len(),
        verification,
        sources_checked,
        sources_not_modified_304,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[must_use]
pub fn default_mmap_dir() -> PathBuf {
    PathBuf::from("data").join("atlas_mmap")
}
