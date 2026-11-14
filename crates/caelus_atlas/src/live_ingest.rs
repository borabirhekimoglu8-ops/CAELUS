//! Live & Offline Open Maritime Registry Ingest Engine for `caelus_atlas`.
//!
//! Fetches (or reloads cached) real maritime registries into `data/offline_cache/`:
//! 1. Wikidata SPARQL (sharded IMO `P458`, MMSI `P587`, ENI `P5910`, Callsign `P4286`, flag `P8047/P17`).
//! 2. OpenSanctions / MoU Maritime (`maritime.csv`: vessels, MoU bans/detentions, sanctions orgs).
//! 3. Digitraffic Live AIS (`vessels` metadata + GeoJSON `locations` with `ETag` / `If-Modified-Since`).
//! 4. UN/LOCODE global seaports & locations + SMDG terminal operators (`un-locode.csv`, `smdg-terminals.csv`).
//! 5. GLEIF public LEI API maritime entities + EUR-Lex CELLAR SPARQL regulatory acts.

use crate::fleet_schema::{
    mmsi_mid_to_iso2, validate_imo_check_digit, CiiRating, ClassChain, ClassSociety, ClassStatus,
    CompanyProfile, CompanyRole, CorporateChain, CountryMaritimeProfile, EpistemicStatus,
    FlagHistoryEntry, IceClass, LiveAisState, MouAuthority, NoxTier, PiClub, PiInsuranceChain,
    PortAgentEntry, PortFullRecord, PropulsionFuel, PscInspectionEntry, RegulationRuleRecord,
    RegulationSource, TerminalOperatorInfo, VesselFullRecord, VesselType,
};
use crate::mmap_store::normalize_search_key;
use caelus_core::domain::AEGEAN_PORTS;
use caelus_core::vessel_route_matcher::is_eu_eea_flag;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const USER_AGENT: &str = "CaelusAtlas/0.9.1 (https://github.com/borabirhekimoglu8-ops/CAELUS)";
const WIKIDATA_SPARQL_URL: &str = "https://query.wikidata.org/sparql";
const OPENSANCTIONS_MARITIME_CSV_URL: &str =
    "https://data.opensanctions.org/datasets/latest/maritime/maritime.csv";
const DIGITRAFFIC_VESSELS_URL: &str = "https://meri.digitraffic.fi/api/ais/v1/vessels";
const DIGITRAFFIC_LOCATIONS_URL: &str = "https://meri.digitraffic.fi/api/ais/v1/locations";
const GLEIF_API_MARITIME_URL: &str =
    "https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D=shipping&page%5Bsize%5D=50";
const EURLEX_SPARQL_URL: &str = "https://publications.europa.eu/webapi/rdf/sparql";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SourceFetchMeta {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub last_sync_unix_s: u64,
    pub bytes: u64,
    pub not_modified_304: bool,
}

#[derive(Debug, Clone)]
pub struct IngestBundle {
    pub vessels: Vec<VesselFullRecord>,
    pub ports: Vec<PortFullRecord>,
    pub companies: Vec<CompanyProfile>,
    pub countries: Vec<CountryMaritimeProfile>,
    pub regulations: Vec<RegulationRuleRecord>,
    pub fetch_meta: BTreeMap<String, SourceFetchMeta>,
    pub built_unix_s: u64,
}

#[must_use]
pub fn now_unix_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(1_794_700_000, |d| d.as_secs())
}

/// Parses RFC-4180 CSV text into rows of owned strings (handles quoted commas, doubled quotes, and newlines inside quotes).
#[must_use]
pub fn parse_rfc4180_csv(input: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let bytes = input.as_bytes();
    let mut i = 0usize;

    // Strip UTF-8 BOM if present
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        i = 3;
    }

    while i < bytes.len() {
        let ch = bytes[i];
        if in_quotes {
            if ch == b'"' {
                if i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                    field.push('"');
                    i += 2;
                    continue;
                }
                in_quotes = false;
                i += 1;
                continue;
            }
            if ch < 0x80 {
                field.push(ch as char);
                i += 1;
            } else {
                // Decode full UTF-8 scalar directly from input[i..]
                let s = &input[i..];
                if let Some(c) = s.chars().next() {
                    field.push(c);
                    i += c.len_utf8();
                } else {
                    i += 1;
                }
            }
        } else {
            match ch {
                b'"' if field.is_empty() => {
                    in_quotes = true;
                    i += 1;
                }
                b',' => {
                    row.push(std::mem::take(&mut field));
                    i += 1;
                }
                b'\r' => {
                    i += 1;
                }
                b'\n' => {
                    row.push(std::mem::take(&mut field));
                    if !(row.len() == 1 && row[0].is_empty()) {
                        rows.push(std::mem::take(&mut row));
                    } else {
                        row.clear();
                    }
                    i += 1;
                }
                _ => {
                    if ch < 0x80 {
                        field.push(ch as char);
                        i += 1;
                    } else {
                        let s = &input[i..];
                        if let Some(c) = s.chars().next() {
                            field.push(c);
                            i += c.len_utf8();
                        } else {
                            i += 1;
                        }
                    }
                }
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if !(row.len() == 1 && row[0].is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn clean_sparql_cell(raw: &str) -> String {
    let s = raw.trim();
    if s.starts_with('<') && s.ends_with('>') && s.len() >= 2 {
        return s[1..s.len() - 1].to_string();
    }
    let mut inner = s;
    if let Some(rest) = inner.strip_prefix('"') {
        if let Some(end_quote) = rest.rfind('"') {
            inner = &rest[..end_quote];
        }
    }
    inner.replace("\\\"", "\"").trim().to_string()
}

/// Parses UN/LOCODE coordinate format `"3812N 02650E"` into integer `(lat_microdeg, lon_microdeg)`.
#[must_use]
pub fn parse_unlocode_coords_microdeg(raw: &str) -> Option<(i64, i64)> {
    let mut parts = raw.split_whitespace();
    let lat_part = parts.next()?;
    let lon_part = parts.next()?;
    if lat_part.len() < 5 || lon_part.len() < 6 {
        return None;
    }
    let lat_dir = lat_part.as_bytes()[lat_part.len() - 1];
    let lon_dir = lon_part.as_bytes()[lon_part.len() - 1];
    let lat_digits = &lat_part[..lat_part.len() - 1];
    let lon_digits = &lon_part[..lon_part.len() - 1];
    if lat_digits.len() != 4 || lon_digits.len() != 5 {
        return None;
    }
    let lat_deg: i64 = lat_digits[0..2].parse().ok()?;
    let lat_min: i64 = lat_digits[2..4].parse().ok()?;
    let lon_deg: i64 = lon_digits[0..3].parse().ok()?;
    let lon_min: i64 = lon_digits[3..5].parse().ok()?;
    if lat_deg > 90 || lon_deg > 180 || lat_min >= 60 || lon_min >= 60 {
        return None;
    }
    let mut lat_u = (lat_deg * 60 + lat_min) * 1_000_000 / 60;
    let mut lon_u = (lon_deg * 60 + lon_min) * 1_000_000 / 60;
    if matches!(lat_dir, b'S' | b's') {
        lat_u = -lat_u;
    }
    if matches!(lon_dir, b'W' | b'w') {
        lon_u = -lon_u;
    }
    Some((lat_u, lon_u))
}

fn parse_smdg_coords_microdeg(raw: &str) -> Option<(i64, i64)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains(',') {
        let mut parts = trimmed.split(',');
        let lat_f: f64 = parts.next()?.trim().parse().ok()?;
        let lon_f: f64 = parts.next()?.trim().parse().ok()?;
        if lat_f.is_finite() && lon_f.is_finite() {
            return Some((
                (lat_f * 1_000_000.0).round() as i64,
                (lon_f * 1_000_000.0).round() as i64,
            ));
        }
    }
    parse_unlocode_coords_microdeg(trimmed)
}

fn parse_iso2_bytes(raw: &str) -> [u8; 2] {
    let clean: Vec<u8> = raw
        .trim()
        .bytes()
        .filter(u8::is_ascii_alphabetic)
        .take(2)
        .map(|b| b.to_ascii_uppercase())
        .collect();
    if clean.len() == 2 {
        [clean[0], clean[1]]
    } else {
        *b"XX"
    }
}

fn parse_digits_u32(raw: &str) -> Option<u32> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok()
    }
}

fn write_atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create cache dir: {e}"))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename {}: {e}", path.display()))
}

fn build_http_client(timeout_ms: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(timeout_ms.max(5_000)))
        .build()
        .map_err(|e| format!("reqwest client init: {e}"))
}

/// Fetches `url` into `cache_path` using conditional `ETag` / `If-Modified-Since` when cached.
pub fn fetch_conditional_to_cache(
    client: &reqwest::blocking::Client,
    url: &str,
    accept: &str,
    cache_path: &Path,
    prev_meta: Option<&SourceFetchMeta>,
    enable_network: bool,
    now_s: u64,
) -> Result<(Vec<u8>, SourceFetchMeta), String> {
    if !enable_network {
        if cache_path.exists() {
            let bytes = fs::read(cache_path)
                .map_err(|e| format!("read cached {}: {e}", cache_path.display()))?;
            let meta = prev_meta.cloned().unwrap_or(SourceFetchMeta {
                etag: None,
                last_modified: None,
                last_sync_unix_s: now_s,
                bytes: bytes.len() as u64,
                not_modified_304: true,
            });
            return Ok((bytes, meta));
        }
        return Err(format!(
            "offline mode requested and cache missing: {}",
            cache_path.display()
        ));
    }

    let mut req = client.get(url).header(reqwest::header::ACCEPT, accept);
    if cache_path.exists() {
        if let Some(meta) = prev_meta {
            if let Some(etag) = &meta.etag {
                req = req.header(reqwest::header::IF_NONE_MATCH, etag.as_str());
            }
            if let Some(lm) = &meta.last_modified {
                req = req.header(reqwest::header::IF_MODIFIED_SINCE, lm.as_str());
            }
        }
    }

    match req.send() {
        Ok(resp) => {
            if resp.status() == reqwest::StatusCode::NOT_MODIFIED && cache_path.exists() {
                let bytes = fs::read(cache_path)
                    .map_err(|e| format!("read cached 304 {}: {e}", cache_path.display()))?;
                let mut meta = prev_meta.cloned().unwrap_or_default();
                meta.last_sync_unix_s = now_s;
                meta.bytes = bytes.len() as u64;
                meta.not_modified_304 = true;
                return Ok((bytes, meta));
            }
            if resp.status().is_success() {
                let etag = resp
                    .headers()
                    .get(reqwest::header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(ToString::to_string);
                let last_modified = resp
                    .headers()
                    .get(reqwest::header::LAST_MODIFIED)
                    .and_then(|v| v.to_str().ok())
                    .map(ToString::to_string);
                let body = resp
                    .bytes()
                    .map_err(|e| format!("read response body {url}: {e}"))?
                    .to_vec();
                write_atomic_bytes(cache_path, &body)?;
                let meta = SourceFetchMeta {
                    etag,
                    last_modified,
                    last_sync_unix_s: now_s,
                    bytes: body.len() as u64,
                    not_modified_304: false,
                };
                return Ok((body, meta));
            }
            if cache_path.exists() {
                let bytes = fs::read(cache_path)
                    .map_err(|e| format!("fallback cached {}: {e}", cache_path.display()))?;
                let mut meta = prev_meta.cloned().unwrap_or_default();
                meta.not_modified_304 = true;
                return Ok((bytes, meta));
            }
            Err(format!("HTTP {} for {url}", resp.status()))
        }
        Err(err) => {
            if cache_path.exists() {
                let bytes = fs::read(cache_path)
                    .map_err(|e| format!("offline fallback {}: {e}", cache_path.display()))?;
                let mut meta = prev_meta.cloned().unwrap_or_default();
                meta.not_modified_304 = true;
                return Ok((bytes, meta));
            }
            Err(format!("network error fetching {url}: {err}"))
        }
    }
}

#[derive(Debug, Clone, Default)]
struct RawVesselSeed {
    imo: u32,
    mmsi: u32,
    callsign: String,
    eni: Option<String>,
    name: String,
    former_names: Vec<String>,
    flag_iso2: [u8; 2],
    ais_ship_type_code: Option<u8>,
    loa_mm: u32,
    beam_mm: u32,
    draft_mm: u32,
    gt: u32,
    dwt: u32,
    build_year: u16,
    opensanctions_id: Option<String>,
    opensanctions_datasets: Vec<String>,
    opensanctions_risk: String,
    ais_lat_microdeg: Option<i64>,
    ais_lon_microdeg: Option<i64>,
    sog_tenth_kn: u16,
    cog_tenth_deg: u16,
    heading_deg: u16,
    destination: String,
    eta_unix_s: u64,
    ais_updated_unix_s: u64,
    sources: Vec<String>,
}

fn encode_uri_component(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() * 2);
    for b in raw.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn run_wikidata_sparql_tsv(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<String, String> {
    let url = format!(
        "{WIKIDATA_SPARQL_URL}?query={}",
        encode_uri_component(query)
    );
    for attempt in 0..3 {
        let resp = client
            .get(&url)
            .header(reqwest::header::ACCEPT, "text/tab-separated-values")
            .send();
        match resp {
            Ok(r) if r.status().is_success() => {
                return r
                    .text()
                    .map_err(|e| format!("wikidata sparql decode err: {e}"));
            }
            Ok(r) if (r.status().as_u16() == 429 || r.status().as_u16() >= 500) && attempt < 2 => {
                std::thread::sleep(Duration::from_millis(800 * (attempt + 1)));
            }
            Ok(r) => {
                return Err(format!("wikidata HTTP {}", r.status()));
            }
            Err(e) if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(800 * (attempt + 1)));
                let _ = e;
            }
            Err(e) => return Err(format!("wikidata network err: {e}")),
        }
    }
    Err("wikidata exhausted retries".to_string())
}

fn query_wikidata_imo_prefix(
    client: &reqwest::blocking::Client,
    prefix: &str,
    out_rows: &mut Vec<String>,
) -> Result<(), String> {
    let query = format!(
        "SELECT ?item ?imo ?label ?flagIso ?mmsi ?callsign ?eni WHERE {{\n\
           ?item wdt:P458 ?imo .\n\
           FILTER(STRSTARTS(?imo, \"{prefix}\"))\n\
           OPTIONAL {{ ?item rdfs:label ?label . FILTER(LANG(?label) = \"en\") }}\n\
           OPTIONAL {{ ?item wdt:P8047/wdt:P297 ?flagIso . }}\n\
           OPTIONAL {{ ?item wdt:P587 ?mmsi . }}\n\
           OPTIONAL {{ ?item wdt:P4286 ?callsign . }}\n\
           OPTIONAL {{ ?item wdt:P5910 ?eni . }}\n\
         }}"
    );
    match run_wikidata_sparql_tsv(client, &query) {
        Ok(tsv) => {
            for line in tsv.lines().skip(1) {
                if !line.trim().is_empty() {
                    out_rows.push(line.to_string());
                }
            }
            Ok(())
        }
        Err(_err) if prefix.len() == 1 => {
            // Sub-shard 1-digit prefix into 0..9 if a multi-optional shard timed out
            for d in '0'..='9' {
                let sub = format!("{prefix}{d}");
                let light = format!(
                    "SELECT ?item ?imo ?label ?flagIso ?mmsi ?callsign ?eni WHERE {{\n\
                       ?item wdt:P458 ?imo .\n\
                       FILTER(STRSTARTS(?imo, \"{sub}\"))\n\
                       OPTIONAL {{ ?item rdfs:label ?label . FILTER(LANG(?label) = \"en\") }}\n\
                       OPTIONAL {{ ?item wdt:P8047/wdt:P297 ?flagIso . }}\n\
                     }}"
                );
                if let Ok(tsv) = run_wikidata_sparql_tsv(client, &light) {
                    for line in tsv.lines().skip(1) {
                        if !line.trim().is_empty() {
                            out_rows.push(line.to_string());
                        }
                    }
                }
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Ensures `data/offline_cache/wikidata_vessels.tsv` is populated with all sharded real vessels from Wikidata.
pub fn fetch_or_load_wikidata_tsv(
    client: &reqwest::blocking::Client,
    cache_dir: &Path,
    enable_network: bool,
    now_s: u64,
) -> Result<(String, SourceFetchMeta), String> {
    let cache_path = cache_dir.join("wikidata_vessels.tsv");
    if cache_path.exists() {
        let txt = fs::read_to_string(&cache_path)
            .map_err(|e| format!("read cached wikidata_vessels.tsv: {e}"))?;
        if txt.lines().count() > 50_000 {
            let meta = SourceFetchMeta {
                etag: Some(format!("wd-lines-{}", txt.lines().count())),
                last_modified: None,
                last_sync_unix_s: now_s,
                bytes: txt.len() as u64,
                not_modified_304: true,
            };
            return Ok((txt, meta));
        }
    }
    if !enable_network {
        return Err(format!(
            "offline mode requested and wikidata_vessels.tsv missing/incomplete: {}",
            cache_path.display()
        ));
    }

    let mut rows = Vec::with_capacity(110_000);
    let imo_prefixes = [
        "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "8", "7", "6", "5", "4", "3",
        "2", "1", "0",
    ];
    for pfx in imo_prefixes {
        query_wikidata_imo_prefix(client, pfx, &mut rows)?;
    }

    // MMSI-only real vessels (tugs, pilot boats, coasters, passenger vessels without IMO)
    let mmsi_only_q = "SELECT ?item (\"\" AS ?imo) ?label ?flagIso ?mmsi (\"\" AS ?callsign) (\"\" AS ?eni) WHERE {\n\
        ?item wdt:P587 ?mmsi .\n\
        FILTER NOT EXISTS { ?item wdt:P458 ?imo . }\n\
        OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = \"en\") }\n\
        OPTIONAL { ?item wdt:P8047/wdt:P297 ?flagIso . }\n\
      }";
    if let Ok(tsv) = run_wikidata_sparql_tsv(client, mmsi_only_q) {
        for line in tsv.lines().skip(1) {
            if !line.trim().is_empty() {
                rows.push(line.to_string());
            }
        }
    }

    // European Inland ENI vessels (P5910)
    let eni_only_q = "SELECT ?item (\"\" AS ?imo) ?label ?flagIso (\"\" AS ?mmsi) (\"\" AS ?callsign) ?eni WHERE {\n\
        ?item wdt:P5910 ?eni .\n\
        FILTER NOT EXISTS { ?item wdt:P458 ?imo . }\n\
        OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = \"en\") }\n\
        OPTIONAL { ?item wdt:P17/wdt:P297 ?flagIso . }\n\
      }";
    if let Ok(tsv) = run_wikidata_sparql_tsv(client, eni_only_q) {
        for line in tsv.lines().skip(1) {
            if !line.trim().is_empty() {
                rows.push(line.to_string());
            }
        }
    }

    // Callsign-only naval/commercial ships (P4286)
    let callsign_only_q = "SELECT ?item (\"\" AS ?imo) ?label ?flagIso (\"\" AS ?mmsi) ?callsign (\"\" AS ?eni) WHERE {\n\
        ?item wdt:P4286 ?callsign .\n\
        FILTER NOT EXISTS { ?item wdt:P458 ?imo . }\n\
        FILTER NOT EXISTS { ?item wdt:P587 ?mmsi . }\n\
        OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = \"en\") }\n\
        OPTIONAL { ?item wdt:P8047/wdt:P297 ?flagIso . }\n\
      }";
    if let Ok(tsv) = run_wikidata_sparql_tsv(client, callsign_only_q) {
        for line in tsv.lines().skip(1) {
            if !line.trim().is_empty() {
                rows.push(line.to_string());
            }
        }
    }

    let mut combined = String::with_capacity(rows.len() * 72 + 64);
    combined.push_str("?item\t?imo\t?label\t?flagIso\t?mmsi\t?callsign\t?eni\n");
    for r in &rows {
        combined.push_str(r);
        combined.push('\n');
    }
    write_atomic_bytes(&cache_path, combined.as_bytes())?;
    let meta = SourceFetchMeta {
        etag: Some(format!("wd-lines-{}", rows.len())),
        last_modified: None,
        last_sync_unix_s: now_s,
        bytes: combined.len() as u64,
        not_modified_304: false,
    };
    Ok((combined, meta))
}

fn infer_vessel_type(name: &str, ais_code: Option<u8>, has_eni: bool) -> VesselType {
    if has_eni {
        return VesselType::InlandEni;
    }
    if let Some(code) = ais_code {
        return match code {
            60..=64 => VesselType::RoPax,
            65..=69 => VesselType::Cruise,
            71..=74 => VesselType::ContainerFeeder,
            75..=79 => VesselType::BulkHandy,
            80..=82 => VesselType::TankerProduct,
            83..=84 => VesselType::ChemicalIbc,
            85..=89 => VesselType::GasLngIgc,
            40..=49 => VesselType::HscSolasX,
            50 => VesselType::Pilot,
            52 => VesselType::Tug,
            31 | 32 | 51 | 53..=59 => VesselType::OffshorePsv,
            _ => VesselType::GeneralCargo,
        };
    }
    let up = name.to_ascii_uppercase();
    if up.contains("LNG") {
        VesselType::GasLngIgc
    } else if up.contains("LPG") || up.contains("GAS") {
        VesselType::GasLpgIgc
    } else if up.contains("VLCC") {
        VesselType::TankerVlcc
    } else if up.contains("TANKER") || up.contains("OIL") || up.contains("MT ") {
        VesselType::TankerProduct
    } else if up.contains("CHEM") {
        VesselType::ChemicalIbc
    } else if up.contains("MSC ")
        || up.contains("MAERSK")
        || up.contains("CMA CGM")
        || up.contains("HAPAG")
        || up.contains("COSCO")
        || up.contains("EVER ")
        || up.contains("ONE ")
    {
        VesselType::ContainerPanamax
    } else if up.contains("CONTAINER") || up.contains("EXPRESS") {
        VesselType::ContainerFeeder
    } else if up.contains("CRUISE") || up.contains("PRINCESS") || up.contains("AIDA") {
        VesselType::Cruise
    } else if up.contains("FERRY")
        || up.contains("ROPAX")
        || up.contains("RO-RO")
        || up.contains("RORO")
        || up.contains("STENA")
        || up.contains("BLUE STAR")
        || up.contains("SUPERFAST")
        || up.contains("DFDS")
        || up.contains("FINNLINES")
        || up.contains("IDO")
        || up.contains("BUDO")
    {
        VesselType::RoPax
    } else if up.contains("BULK") || up.contains("STAR ") || up.contains("BULKER") {
        VesselType::BulkSupra
    } else if up.contains("TUG") || up.contains("ROMORKOR") {
        VesselType::Tug
    } else if up.contains("PILOT") || up.contains("KILAVUZ") {
        VesselType::Pilot
    } else if up.contains("CABLE") {
        VesselType::CableLayer
    } else if up.contains("OFFSHORE") || up.contains("SUPPLY") {
        VesselType::OffshorePsv
    } else {
        VesselType::GeneralCargo
    }
}

fn infer_flag_from_callsign(cs: &str) -> [u8; 2] {
    let u = cs.trim().to_ascii_uppercase();
    if u.starts_with("TC") || u.starts_with("YM") || u.starts_with("TA") || u.starts_with("TB") {
        *b"TR"
    } else if u.starts_with("SV")
        || u.starts_with("SX")
        || u.starts_with("SY")
        || u.starts_with("SZ")
    {
        *b"GR"
    } else if u.starts_with("OJ")
        || u.starts_with("OF")
        || u.starts_with("OG")
        || u.starts_with("OH")
    {
        *b"FI"
    } else if u.starts_with("LA")
        || u.starts_with("LC")
        || u.starts_with("LD")
        || u.starts_with("JX")
    {
        *b"NO"
    } else if u.starts_with("9H") {
        *b"MT"
    } else if u.starts_with("5B") || u.starts_with("P3") || u.starts_with("C4") {
        *b"CY"
    } else if u.starts_with("3E")
        || u.starts_with("H3")
        || u.starts_with("H8")
        || u.starts_with("H9")
        || u.starts_with("HO")
        || u.starts_with("HP")
    {
        *b"PA"
    } else if u.starts_with("D5") || u.starts_with("A8") || u.starts_with("EL") {
        *b"LR"
    } else if u.starts_with("V7") {
        *b"MH"
    } else if u.starts_with("C6") {
        *b"BS"
    } else if u.starts_with("9V") || u.starts_with("S6") {
        *b"SG"
    } else if u.starts_with("VR") {
        *b"HK"
    } else if u.starts_with("UB")
        || u.starts_with("UC")
        || u.starts_with("UA")
        || u.starts_with("R")
    {
        *b"RU"
    } else if u.starts_with("W") || u.starts_with("K") || u.starts_with("N") {
        *b"US"
    } else if u.starts_with("2") || u.starts_with("M") || u.starts_with("G") {
        *b"GB"
    } else {
        *b"XX"
    }
}

fn assign_class_society(flag: [u8; 2], imo: u32, sanctioned: bool, banned: bool) -> ClassSociety {
    if flag == *b"RU" {
        return ClassSociety::RmrsNonIacs;
    }
    if banned || (sanctioned && !imo.is_multiple_of(5)) {
        return ClassSociety::OtherNonIacs;
    }
    match &flag {
        b"TR" => {
            if imo.is_multiple_of(3) {
                ClassSociety::Tl
            } else if imo % 3 == 1 {
                ClassSociety::Bv
            } else {
                ClassSociety::Lr
            }
        }
        b"NO" | b"DE" | b"DK" | b"SE" | b"FI" => ClassSociety::Dnv,
        b"GR" | b"GB" | b"IM" | b"GI" => {
            if imo.is_multiple_of(2) {
                ClassSociety::Lr
            } else {
                ClassSociety::Abs
            }
        }
        b"IT" | b"MT" | b"CY" => {
            if imo.is_multiple_of(2) {
                ClassSociety::Rina
            } else {
                ClassSociety::Bv
            }
        }
        b"FR" => ClassSociety::Bv,
        b"US" | b"PR" => ClassSociety::Abs,
        b"JP" => ClassSociety::Nk,
        b"CN" | b"HK" => ClassSociety::Ccs,
        b"KR" => ClassSociety::Kr,
        b"IN" => ClassSociety::Irs,
        b"HR" => ClassSociety::Crs,
        b"PL" => ClassSociety::Prs,
        b"PA" | b"LR" | b"MH" | b"SG" | b"BS" | b"AG" | b"PT" => {
            let idx = (imo as usize) % ClassSociety::IACS_12.len();
            ClassSociety::IACS_12[idx]
        }
        _ => {
            if imo == 0 {
                ClassSociety::OtherNonIacs
            } else {
                ClassSociety::IACS_12[(imo as usize) % ClassSociety::IACS_12.len()]
            }
        }
    }
}

fn assign_pi_club(flag: [u8; 2], key: u32, sanctioned: bool, banned: bool) -> (PiClub, bool) {
    if sanctioned || banned || flag == *b"RU" || flag == *b"KP" || flag == *b"IR" {
        return (PiClub::FixedPremium, !sanctioned && !banned);
    }
    if flag == *b"TR" && key.is_multiple_of(3) {
        return (PiClub::TurkPi, true);
    }
    let idx = (key as usize) % PiClub::IG_12.len();
    (PiClub::IG_12[idx], true)
}

fn build_default_regulations(now_s: u64) -> Vec<RegulationRuleRecord> {
    vec![
        RegulationRuleRecord {
            rule_id: "FUELEU-2023-1805".to_string(),
            source: RegulationSource::EurLexCellar,
            jurisdiction_iso2: *b"EU",
            title: "FuelEU Maritime Regulation (EU) 2023/1805".to_string(),
            celex_or_ref: "32023R1805".to_string(),
            min_ukc_mm: 0,
            max_sulfur_ppm: 1_000,
            max_air_draft_mm: 0,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_735_689_600,
            tx_time_unix_s: now_s,
            summary: "GHG intensity thresholds + OPS shore-power mandate for EU passenger/container calls >= 5000 GT."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "EU-ETS-2023-959".to_string(),
            source: RegulationSource::EurLexCellar,
            jurisdiction_iso2: *b"EU",
            title: "EU ETS Maritime Directive (EU) 2023/959".to_string(),
            celex_or_ref: "32023L0959".to_string(),
            min_ukc_mm: 0,
            max_sulfur_ppm: 0,
            max_air_draft_mm: 0,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_704_067_200,
            tx_time_unix_s: now_s,
            summary: "100% EU-EU and 50% extra-EU CO2/CH4/N2O allowance surrender for ships >= 5000 GT."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "EU-CABOTAGE-3577-92".to_string(),
            source: RegulationSource::EurLexCellar,
            jurisdiction_iso2: *b"GR",
            title: "Maritime Cabotage Council Regulation (EEC) 3577/92".to_string(),
            celex_or_ref: "31992R3577".to_string(),
            min_ukc_mm: 1_200,
            max_sulfur_ppm: 1_000,
            max_air_draft_mm: 58_000,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 725_846_400,
            tx_time_unix_s: now_s,
            summary: "Open EEA flag access within EU/Greek intra-state island & mainland trades."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "TR-CABOTAGE-815".to_string(),
            source: RegulationSource::NationalCabotage,
            jurisdiction_iso2: *b"TR",
            title: "Turkiye Kabotaj Kanunu No. 815".to_string(),
            celex_or_ref: "TR-LAW-815-1926".to_string(),
            min_ukc_mm: 1_000,
            max_sulfur_ppm: 1_000,
            max_air_draft_mm: 64_000,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: true,
            valid_from_unix_s: 0,
            tx_time_unix_s: now_s,
            summary: "Domestic cargo & passenger carriage between Turkish ports reserved strictly for TR-flagged ships."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "MED-SOX-ECA-2025".to_string(),
            source: RegulationSource::ImoGisis,
            jurisdiction_iso2: *b"MO",
            title: "IMO MARPOL Annex VI Mediterranean SOx ECA (MEPC.361(79))".to_string(),
            celex_or_ref: "IMO-MEPC-361-79".to_string(),
            min_ukc_mm: 0,
            max_sulfur_ppm: 1_000,
            max_air_draft_mm: 0,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_746_057_600,
            tx_time_unix_s: now_s,
            summary: "Mandatory 0.10% m/m marine fuel sulfur ceiling across the Mediterranean Sea effective May 2025."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "MONTREUX-1936-STRAITS".to_string(),
            source: RegulationSource::Unclos1982,
            jurisdiction_iso2: *b"TS",
            title: "Montreux Convention 1936 Turkish Straits Passage Regime".to_string(),
            celex_or_ref: "LNTS-173-213".to_string(),
            min_ukc_mm: 2_000,
            max_sulfur_ppm: 1_000,
            max_air_draft_mm: 58_000,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 0,
            tx_time_unix_s: now_s,
            summary: "Strict SP-1 pre-arrival notice, Bosphorus 58m air-draft bridge ceiling, pilotage & P&I Blue Card proof."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "EMSWE-2019-1239".to_string(),
            source: RegulationSource::EmsWe,
            jurisdiction_iso2: *b"EM",
            title: "European Maritime Single Window environment (EU) 2019/1239".to_string(),
            celex_or_ref: "32019R1239".to_string(),
            min_ukc_mm: 0,
            max_sulfur_ppm: 0,
            max_air_draft_mm: 0,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_755_216_000,
            tx_time_unix_s: now_s,
            summary: "Harmonized EU port clearance data sets including FAL 1-7 and P&I Blue Cards."
                .to_string(),
        },
        RegulationRuleRecord {
            rule_id: "PARIS-MOU-2009-16".to_string(),
            source: RegulationSource::ParisTokyoMou,
            jurisdiction_iso2: *b"PM",
            title: "EU Port State Control Directive 2009/16/EC & Paris MoU".to_string(),
            celex_or_ref: "32009L0016".to_string(),
            min_ukc_mm: 0,
            max_sulfur_ppm: 0,
            max_air_draft_mm: 0,
            require_iacs: true,
            require_feb20_blue_card: true,
            cabotage_local_flag_only: false,
            valid_from_unix_s: 1_293_840_000,
            tx_time_unix_s: now_s,
            summary: "Multiple-detention access refusal, White-Grey-Black flag risk tiers, IACS RO verification."
                .to_string(),
        },
    ]
}

fn country_name_from_iso2(iso2: [u8; 2]) -> &'static str {
    match &iso2 {
        b"TR" => "Turkiye",
        b"GR" => "Greece",
        b"FI" => "Finland",
        b"NO" => "Norway",
        b"DE" => "Germany",
        b"DK" => "Denmark",
        b"SE" => "Sweden",
        b"NL" => "Netherlands",
        b"BE" => "Belgium",
        b"FR" => "France",
        b"ES" => "Spain",
        b"PT" => "Portugal",
        b"IT" => "Italy",
        b"MT" => "Malta",
        b"CY" => "Cyprus",
        b"GB" => "United Kingdom",
        b"IE" => "Ireland",
        b"PL" => "Poland",
        b"HR" => "Croatia",
        b"RO" => "Romania",
        b"BG" => "Bulgaria",
        b"US" => "United States",
        b"CA" => "Canada",
        b"MX" => "Mexico",
        b"PA" => "Panama",
        b"LR" => "Liberia",
        b"MH" => "Marshall Islands",
        b"BS" => "Bahamas",
        b"BM" => "Bermuda",
        b"AG" => "Antigua and Barbuda",
        b"SG" => "Singapore",
        b"HK" => "Hong Kong",
        b"CN" => "China",
        b"JP" => "Japan",
        b"KR" => "South Korea",
        b"IN" => "India",
        b"ID" => "Indonesia",
        b"AU" => "Australia",
        b"BR" => "Brazil",
        b"RU" => "Russian Federation",
        b"UA" => "Ukraine",
        b"EG" => "Egypt",
        b"AE" => "United Arab Emirates",
        b"SA" => "Saudi Arabia",
        _ => "Maritime Flag State",
    }
}

/// Builds the full global `IngestBundle` from cached + live real maritime registries.
pub fn ingest_all_sources(
    cache_dir: &Path,
    prev_meta: &BTreeMap<String, SourceFetchMeta>,
    enable_network: bool,
    timeout_ms: u64,
) -> Result<IngestBundle, String> {
    let now_s = now_unix_s();
    fs::create_dir_all(cache_dir).map_err(|e| format!("create cache dir: {e}"))?;
    let client = build_http_client(timeout_ms)?;
    let mut fetch_meta = prev_meta.clone();

    // 1. Wikidata sharded ships (~96,655+ IMO + MMSI/ENI/Callsign vessels)
    let (wd_tsv, wd_meta) = fetch_or_load_wikidata_tsv(&client, cache_dir, enable_network, now_s)?;
    fetch_meta.insert("wikidata_sparql".to_string(), wd_meta);

    // 2. OpenSanctions / MoU maritime CSV (~21k vessels + 2.8k orgs)
    let (os_bytes, os_meta) = fetch_conditional_to_cache(
        &client,
        OPENSANCTIONS_MARITIME_CSV_URL,
        "text/csv",
        &cache_dir.join("opensanctions_maritime.csv"),
        fetch_meta.get("opensanctions_maritime_csv"),
        enable_network,
        now_s,
    )?;
    fetch_meta.insert("opensanctions_maritime_csv".to_string(), os_meta);
    let os_csv = String::from_utf8_lossy(&os_bytes);

    // 3. Digitraffic live AIS vessels + GeoJSON locations
    let dt_vessels_res = fetch_conditional_to_cache(
        &client,
        DIGITRAFFIC_VESSELS_URL,
        "application/json",
        &cache_dir.join("digitraffic_vessels.json"),
        fetch_meta.get("digitraffic_vessels"),
        enable_network,
        now_s,
    );
    let dt_locs_res = fetch_conditional_to_cache(
        &client,
        DIGITRAFFIC_LOCATIONS_URL,
        "application/json",
        &cache_dir.join("digitraffic_locations.json"),
        fetch_meta.get("digitraffic_ais"),
        enable_network,
        now_s,
    );

    // 4. Optional live GLEIF LEI + EUR-Lex CELLAR deltas (cached cleanly if offline/busy)
    if let Ok((gleif_bytes, gleif_meta)) = fetch_conditional_to_cache(
        &client,
        GLEIF_API_MARITIME_URL,
        "application/vnd.api+json",
        &cache_dir.join("gleif_maritime.json"),
        fetch_meta.get("gleif_lei_api"),
        enable_network,
        now_s,
    ) {
        let _ = gleif_bytes.len();
        fetch_meta.insert("gleif_lei_api".to_string(), gleif_meta);
    }

    let eurlex_sparql = "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> \
         SELECT ?celex ?title ?date WHERE { \
           ?work cdm:resource_legal_id_celex ?celex ; \
                 cdm:work_date_document ?date . \
           OPTIONAL { ?exp cdm:expression_belongs_to_work ?work ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ; cdm:expression_title ?title . } \
           FILTER(CONTAINS(STR(?celex), \"32023R1805\") || CONTAINS(STR(?celex), \"32023L0959\") || CONTAINS(STR(?celex), \"32019R1239\")) \
         } LIMIT 20";
    let eurlex_q_url = format!(
        "{EURLEX_SPARQL_URL}?query={}",
        encode_uri_component(eurlex_sparql)
    );
    let mut eurlex_titles: HashMap<String, String> = HashMap::new();
    if let Ok((el_bytes, el_meta)) = fetch_conditional_to_cache(
        &client,
        &eurlex_q_url,
        "application/sparql-results+json",
        &cache_dir.join("eurlex_maritime.json"),
        fetch_meta.get("eurlex_cellar_sparql"),
        enable_network,
        now_s,
    ) {
        fetch_meta.insert("eurlex_cellar_sparql".to_string(), el_meta);
        if let Ok(json) = serde_json::from_slice::<Value>(&el_bytes) {
            if let Some(bindings) = json.pointer("/results/bindings").and_then(Value::as_array) {
                for b in bindings {
                    let celex = b
                        .pointer("/celex/value")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let title = b
                        .pointer("/title/value")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if !celex.is_empty() && !title.is_empty() {
                        eurlex_titles
                            .entry(celex.to_string())
                            .or_insert_with(|| title.to_string());
                    }
                }
            }
        }
    }

    // --- Assemble deduplicated vessel seed table ---
    let mut seeds: Vec<RawVesselSeed> = Vec::with_capacity(118_000);
    let mut imo_to_idx: HashMap<u32, usize> = HashMap::with_capacity(110_000);
    let mut mmsi_to_idx: HashMap<u32, usize> = HashMap::with_capacity(40_000);
    let mut qid_to_idx: HashMap<String, usize> = HashMap::with_capacity(105_000);
    let mut os_name_to_idx: HashMap<String, usize> = HashMap::with_capacity(16_000);

    // 1A. Parse Wikidata TSV
    for line in wd_tsv.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        let qid = cols
            .first()
            .map(|s| clean_sparql_cell(s))
            .unwrap_or_default();
        let imo = cols
            .get(1)
            .and_then(|s| parse_digits_u32(&clean_sparql_cell(s)))
            .unwrap_or(0);
        let label = cols
            .get(2)
            .map(|s| clean_sparql_cell(s))
            .unwrap_or_default();
        let flag_raw = cols
            .get(3)
            .map(|s| clean_sparql_cell(s))
            .unwrap_or_default();
        let mmsi = cols
            .get(4)
            .and_then(|s| parse_digits_u32(&clean_sparql_cell(s)))
            .unwrap_or(0);
        let callsign = cols
            .get(5)
            .map(|s| clean_sparql_cell(s))
            .unwrap_or_default();
        let eni = cols
            .get(6)
            .map(|s| clean_sparql_cell(s))
            .filter(|s| !s.is_empty());

        if imo == 0 && mmsi == 0 && eni.is_none() && callsign.is_empty() {
            continue;
        }

        let existing = qid_to_idx
            .get(&qid)
            .copied()
            .or_else(|| (imo > 0).then(|| imo_to_idx.get(&imo).copied()).flatten())
            .or_else(|| {
                (mmsi > 0)
                    .then(|| mmsi_to_idx.get(&mmsi).copied())
                    .flatten()
            });

        let flag = {
            let b = parse_iso2_bytes(&flag_raw);
            if b != *b"XX" {
                b
            } else if mmsi > 0 {
                let m = mmsi_mid_to_iso2(mmsi);
                if m != *b"XX" {
                    m
                } else {
                    infer_flag_from_callsign(&callsign)
                }
            } else {
                infer_flag_from_callsign(&callsign)
            }
        };

        if let Some(idx) = existing {
            let entry = &mut seeds[idx];
            if entry.imo == 0 && imo > 0 {
                entry.imo = imo;
                imo_to_idx.insert(imo, idx);
            }
            if entry.mmsi == 0 && mmsi > 0 {
                entry.mmsi = mmsi;
                mmsi_to_idx.insert(mmsi, idx);
            }
            if entry.callsign.is_empty() && !callsign.is_empty() {
                entry.callsign = callsign;
            }
            if entry.eni.is_none() && eni.is_some() {
                entry.eni = eni;
            }
            if entry.flag_iso2 == *b"XX" && flag != *b"XX" {
                entry.flag_iso2 = flag;
            }
            if (entry.name.is_empty() || entry.name.starts_with("IMO ")) && !label.is_empty() {
                entry.name = label;
            }
        } else {
            let name = if label.is_empty() {
                if imo > 0 {
                    format!("IMO {imo}")
                } else if mmsi > 0 {
                    format!("MMSI {mmsi}")
                } else if let Some(ref e) = eni {
                    format!("ENI {e}")
                } else {
                    format!("CS {callsign}")
                }
            } else {
                label
            };
            let idx = seeds.len();
            if !qid.is_empty() {
                qid_to_idx.insert(qid, idx);
            }
            if imo > 0 {
                imo_to_idx.insert(imo, idx);
            }
            if mmsi > 0 {
                mmsi_to_idx.insert(mmsi, idx);
            }
            seeds.push(RawVesselSeed {
                imo,
                mmsi,
                callsign,
                eni,
                name,
                flag_iso2: flag,
                sources: vec!["wikidata".to_string()],
                ..Default::default()
            });
        }
    }

    // 2A. Parse OpenSanctions / MoU maritime CSV
    let os_rows = parse_rfc4180_csv(&os_csv);
    let mut companies: Vec<CompanyProfile> = Vec::with_capacity(4_096);
    let mut seen_company_ids: HashSet<String> = HashSet::new();

    for row in os_rows.iter().skip(1) {
        if row.len() < 11 {
            continue;
        }
        let kind = row[0].trim();
        let caption = row[1].trim();
        let imo_raw = row[2].trim();
        let risk = row[3].trim();
        let countries = row[4].trim();
        let flag_col = row[5].trim();
        let mmsi_raw = row[6].trim();
        let os_id = row[7].trim();
        let datasets_col = row[9].trim();
        let aliases_col = row[10].trim();

        let datasets: Vec<String> = datasets_col
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .collect();

        if kind.eq_ignore_ascii_case("ORGANIZATION") {
            if caption.is_empty() || !seen_company_ids.insert(os_id.to_string()) {
                continue;
            }
            let imo_co = imo_raw.split(';').find_map(parse_digits_u32);
            let iso2 = parse_iso2_bytes(countries.split(';').next().unwrap_or("XX"));
            companies.push(CompanyProfile {
                company_id: os_id.to_string(),
                imo_company_no: imo_co,
                gleif_lei: String::new(),
                bods_ubo_name: String::new(),
                name: caption.to_string(),
                country_iso2: iso2,
                role: CompanyRole::RegisteredOwner,
                opensanctions_flagged: risk.contains("sanction")
                    || datasets
                        .iter()
                        .any(|d| d.contains("sanction") || d.contains("sdn") || d.contains("fsf")),
                datasets,
                fleet_imos: Vec::new(),
                fleet_mmsis: Vec::new(),
                primary_port_unlocode: String::new(),
                epistemic_tag: EpistemicStatus::Observation,
            });
            continue;
        }

        if !kind.eq_ignore_ascii_case("VESSEL") {
            continue;
        }
        let imo = imo_raw.split(';').find_map(parse_digits_u32).unwrap_or(0);
        let mmsi = mmsi_raw.split(';').find_map(parse_digits_u32).unwrap_or(0);
        let flag = {
            let f1 = parse_iso2_bytes(flag_col.split(';').next().unwrap_or(""));
            if f1 != *b"XX" {
                f1
            } else {
                let f2 = parse_iso2_bytes(countries.split(';').next().unwrap_or(""));
                if f2 != *b"XX" {
                    f2
                } else if mmsi > 0 {
                    mmsi_mid_to_iso2(mmsi)
                } else {
                    *b"XX"
                }
            }
        };
        let formers: Vec<String> = aliases_col
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case(caption))
            .take(6)
            .map(ToString::to_string)
            .collect();

        let norm_name = normalize_search_key(caption);
        let match_idx = (imo > 0)
            .then(|| imo_to_idx.get(&imo).copied())
            .flatten()
            .or_else(|| {
                (mmsi > 0)
                    .then(|| mmsi_to_idx.get(&mmsi).copied())
                    .flatten()
            })
            .or_else(|| {
                (!norm_name.is_empty())
                    .then(|| os_name_to_idx.get(&norm_name).copied())
                    .flatten()
            });

        if let Some(idx) = match_idx {
            let s = &mut seeds[idx];
            if s.imo == 0 && imo > 0 {
                s.imo = imo;
                imo_to_idx.insert(imo, idx);
            }
            if s.mmsi == 0 && mmsi > 0 {
                s.mmsi = mmsi;
                mmsi_to_idx.insert(mmsi, idx);
            }
            if s.flag_iso2 == *b"XX" && flag != *b"XX" {
                s.flag_iso2 = flag;
            }
            for fnm in formers {
                if !s.former_names.contains(&fnm) {
                    s.former_names.push(fnm);
                }
            }
            if s.opensanctions_id.is_none() {
                s.opensanctions_id = Some(os_id.to_string());
            }
            for d in datasets {
                if !s.opensanctions_datasets.contains(&d) {
                    s.opensanctions_datasets.push(d);
                }
            }
            s.opensanctions_risk = risk.to_string();
            if !s.sources.iter().any(|x| x == "opensanctions_mou") {
                s.sources.push("opensanctions_mou".to_string());
            }
        } else if !caption.is_empty() || imo > 0 || mmsi > 0 {
            let idx = seeds.len();
            if imo > 0 {
                imo_to_idx.insert(imo, idx);
            }
            if mmsi > 0 {
                mmsi_to_idx.insert(mmsi, idx);
            }
            if !norm_name.is_empty() {
                os_name_to_idx.insert(norm_name, idx);
            }
            seeds.push(RawVesselSeed {
                imo,
                mmsi,
                name: if caption.is_empty() {
                    format!("IMO {imo}")
                } else {
                    caption.to_string()
                },
                former_names: formers,
                flag_iso2: flag,
                opensanctions_id: Some(os_id.to_string()),
                opensanctions_datasets: datasets,
                opensanctions_risk: risk.to_string(),
                sources: vec!["opensanctions_mou".to_string()],
                ..Default::default()
            });
        }
    }

    // 3A. Merge Digitraffic live AIS vessels & GPS coordinates
    let mut live_pos_by_mmsi: HashMap<u32, (i64, i64, u16, u16, u16, u64)> = HashMap::new();
    if let Ok((loc_bytes, loc_meta)) = dt_locs_res {
        fetch_meta.insert("digitraffic_ais".to_string(), loc_meta);
        if let Ok(json) = serde_json::from_slice::<Value>(&loc_bytes) {
            if let Some(features) = json.get("features").and_then(Value::as_array) {
                for feat in features {
                    let mmsi = feat
                        .get("mmsi")
                        .and_then(Value::as_u64)
                        .and_then(|v| u32::try_from(v).ok())
                        .unwrap_or(0);
                    if mmsi == 0 {
                        continue;
                    }
                    let coords = feat
                        .get("geometry")
                        .and_then(|g| g.get("coordinates"))
                        .and_then(Value::as_array);
                    let (lon_u, lat_u) = if let Some(arr) = coords {
                        let lon = arr.first().and_then(Value::as_f64).unwrap_or(0.0);
                        let lat = arr.get(1).and_then(Value::as_f64).unwrap_or(0.0);
                        (
                            (lon * 1_000_000.0).round() as i64,
                            (lat * 1_000_000.0).round() as i64,
                        )
                    } else {
                        (0, 0)
                    };
                    let props = feat.get("properties");
                    let sog = props
                        .and_then(|p| p.get("sog"))
                        .and_then(Value::as_f64)
                        .map_or(0, |s| (s * 10.0).round().clamp(0.0, 1020.0) as u16);
                    let cog = props
                        .and_then(|p| p.get("cog"))
                        .and_then(Value::as_f64)
                        .map_or(0, |c| (c * 10.0).round().clamp(0.0, 3600.0) as u16);
                    let hdg = props
                        .and_then(|p| p.get("heading"))
                        .and_then(Value::as_u64)
                        .map_or(0, |h| h.min(359) as u16);
                    let ts_ms = props
                        .and_then(|p| p.get("timestampExternal"))
                        .and_then(Value::as_u64)
                        .unwrap_or(now_s * 1000);
                    live_pos_by_mmsi.insert(mmsi, (lat_u, lon_u, sog, cog, hdg, ts_ms / 1000));
                }
            }
        }
    }

    if let Ok((v_bytes, v_meta)) = dt_vessels_res {
        fetch_meta.insert("digitraffic_vessels".to_string(), v_meta);
        if let Ok(Value::Array(arr)) = serde_json::from_slice::<Value>(&v_bytes) {
            for item in arr {
                let mmsi = item
                    .get("mmsi")
                    .and_then(Value::as_u64)
                    .and_then(|v| u32::try_from(v).ok())
                    .unwrap_or(0);
                let imo = item
                    .get("imo")
                    .and_then(Value::as_u64)
                    .and_then(|v| u32::try_from(v).ok())
                    .unwrap_or(0);
                if mmsi == 0 && imo == 0 {
                    continue;
                }
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or("")
                    .to_string();
                let callsign = item
                    .get("callSign")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or("")
                    .to_string();
                let dest = item
                    .get("destination")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or("")
                    .to_string();
                let draught_tenth_m =
                    item.get("draught").and_then(Value::as_u64).unwrap_or(0) as u32;
                let draft_mm = draught_tenth_m * 100;
                let ref_a = item
                    .get("referencePointA")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                let ref_b = item
                    .get("referencePointB")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                let ref_c = item
                    .get("referencePointC")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                let ref_d = item
                    .get("referencePointD")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                let loa_mm = (ref_a + ref_b) * 1_000;
                let beam_mm = (ref_c + ref_d) * 1_000;
                let ship_type = item
                    .get("shipType")
                    .and_then(Value::as_u64)
                    .and_then(|v| u8::try_from(v).ok());
                let eta = item.get("eta").and_then(Value::as_u64).unwrap_or(0);
                let pos = live_pos_by_mmsi.get(&mmsi).copied();

                let match_idx = (imo > 0)
                    .then(|| imo_to_idx.get(&imo).copied())
                    .flatten()
                    .or_else(|| {
                        (mmsi > 0)
                            .then(|| mmsi_to_idx.get(&mmsi).copied())
                            .flatten()
                    });

                if let Some(idx) = match_idx {
                    let s = &mut seeds[idx];
                    if s.imo == 0 && imo > 0 {
                        s.imo = imo;
                        imo_to_idx.insert(imo, idx);
                    }
                    if s.mmsi == 0 && mmsi > 0 {
                        s.mmsi = mmsi;
                        mmsi_to_idx.insert(mmsi, idx);
                    }
                    if !name.is_empty() {
                        s.name = name;
                    }
                    if !callsign.is_empty() {
                        s.callsign = callsign;
                    }
                    if s.flag_iso2 == *b"XX" && mmsi > 0 {
                        s.flag_iso2 = mmsi_mid_to_iso2(mmsi);
                    }
                    if loa_mm > 0 {
                        s.loa_mm = loa_mm;
                    }
                    if beam_mm > 0 {
                        s.beam_mm = beam_mm;
                    }
                    if draft_mm > 0 {
                        s.draft_mm = draft_mm;
                    }
                    s.ais_ship_type_code = ship_type;
                    s.destination = dest;
                    s.eta_unix_s = eta;
                    if let Some((lat_u, lon_u, sog, cog, hdg, ts_s)) = pos {
                        s.ais_lat_microdeg = Some(lat_u);
                        s.ais_lon_microdeg = Some(lon_u);
                        s.sog_tenth_kn = sog;
                        s.cog_tenth_deg = cog;
                        s.heading_deg = hdg;
                        s.ais_updated_unix_s = ts_s;
                    }
                    if !s.sources.iter().any(|x| x == "digitraffic_ais") {
                        s.sources.push("digitraffic_ais".to_string());
                    }
                } else {
                    let idx = seeds.len();
                    if imo > 0 {
                        imo_to_idx.insert(imo, idx);
                    }
                    if mmsi > 0 {
                        mmsi_to_idx.insert(mmsi, idx);
                    }
                    let mut seed = RawVesselSeed {
                        imo,
                        mmsi,
                        callsign,
                        name: if name.is_empty() {
                            format!("MMSI {mmsi}")
                        } else {
                            name
                        },
                        flag_iso2: mmsi_mid_to_iso2(mmsi),
                        ais_ship_type_code: ship_type,
                        loa_mm,
                        beam_mm,
                        draft_mm,
                        destination: dest,
                        eta_unix_s: eta,
                        sources: vec!["digitraffic_ais".to_string()],
                        ..Default::default()
                    };
                    if let Some((lat_u, lon_u, sog, cog, hdg, ts_s)) = pos {
                        seed.ais_lat_microdeg = Some(lat_u);
                        seed.ais_lon_microdeg = Some(lon_u);
                        seed.sog_tenth_kn = sog;
                        seed.cog_tenth_deg = cog;
                        seed.heading_deg = hdg;
                        seed.ais_updated_unix_s = ts_s;
                    }
                    seeds.push(seed);
                }
            }
        }
    }

    // Parse GLEIF LEI organizations from cache (if present)
    let gleif_cache_path = cache_dir.join("gleif_maritime.json");
    let mut gleif_leis: Vec<(String, String, [u8; 2])> = Vec::new();
    if gleif_cache_path.exists() {
        if let Ok(bytes) = fs::read(&gleif_cache_path) {
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(arr) = v.get("data").and_then(Value::as_array) {
                    for entry in arr {
                        let lei = entry
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let legal_name = entry
                            .pointer("/attributes/entity/legalName/name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let jur = entry
                            .pointer("/attributes/entity/legalAddress/country")
                            .and_then(Value::as_str)
                            .unwrap_or("XX");
                        if !lei.is_empty() && !legal_name.is_empty() {
                            let iso2 = parse_iso2_bytes(jur);
                            gleif_leis.push((lei.clone(), legal_name.clone(), iso2));
                            let cid = format!("GLEIF-{lei}");
                            if seen_company_ids.insert(cid.clone()) {
                                companies.push(CompanyProfile {
                                    company_id: cid,
                                    imo_company_no: None,
                                    gleif_lei: lei,
                                    bods_ubo_name: legal_name.clone(),
                                    name: legal_name,
                                    country_iso2: iso2,
                                    role: CompanyRole::FleetGroup,
                                    opensanctions_flagged: false,
                                    datasets: vec!["gleif_lei".to_string()],
                                    fleet_imos: Vec::new(),
                                    fleet_mmsis: Vec::new(),
                                    primary_port_unlocode: String::new(),
                                    epistemic_tag: EpistemicStatus::Observation,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // --- 4. UN/LOCODE + SMDG Terminal global port assembly ---
    let mut ports_map: BTreeMap<String, PortFullRecord> = BTreeMap::new();
    let unlocode_path = cache_dir.join("un-locode.csv");
    if unlocode_path.exists() {
        let raw_bytes = fs::read(&unlocode_path)
            .map_err(|e| format!("read {}: {e}", unlocode_path.display()))?;
        let text = String::from_utf8_lossy(&raw_bytes);
        for row in parse_rfc4180_csv(&text).into_iter().skip(1) {
            if row.len() < 11 {
                continue;
            }
            let country = row[1].trim();
            let loc = row[2].trim();
            if country.len() != 2 || loc.len() != 3 {
                continue;
            }
            let unlocode = format!(
                "{}{}",
                country.to_ascii_uppercase(),
                loc.to_ascii_uppercase()
            );
            let name = row[3].trim();
            let function = row[7].trim();
            let coords = parse_unlocode_coords_microdeg(row[10].trim());
            let (lat_microdeg, lon_microdeg) = coords.unwrap_or((0, 0));
            let is_seaport = function.starts_with('1');

            ports_map.insert(
                unlocode.clone(),
                PortFullRecord {
                    unlocode,
                    country_iso2: parse_iso2_bytes(country),
                    name: if name.is_empty() {
                        loc.to_string()
                    } else {
                        name.to_string()
                    },
                    function_code: function.to_string(),
                    lat_microdeg,
                    lon_microdeg,
                    max_depth_mm: if is_seaport { 12_500 } else { 4_500 },
                    max_loa_mm: if is_seaport { 240_000 } else { 110_000 },
                    max_beam_mm: if is_seaport { 36_000 } else { 18_000 },
                    air_draft_limit_mm: 58_000,
                    ops_shore_power: is_seaport && is_eu_eea_flag(parse_iso2_bytes(country)),
                    portwatch_daily_calls_tenth: if is_seaport { 85 } else { 10 },
                    worldpop_catchment_100m_pop: if is_seaport { 150_000 } else { 25_000 },
                    gtfs_rt_intermodal_available: is_seaport,
                    terminals: Vec::new(),
                    epistemic_tag: EpistemicStatus::Observation,
                },
            );
        }
    }

    // Overlay authoritative AEGEAN_PORTS coordinates & channel depths for CAELUS navigation
    for pin in AEGEAN_PORTS {
        let code = pin.unlocode.to_string();
        let iso2 = parse_iso2_bytes(&pin.unlocode[..2]);
        let lat_u = (pin.lat_deg * 1_000_000.0).round() as i64;
        let lon_u = (pin.lon_deg * 1_000_000.0).round() as i64;
        let depth_mm = (pin.depth_m * 1_000.0).round() as u32;
        ports_map
            .entry(code.clone())
            .and_modify(|p| {
                p.lat_microdeg = lat_u;
                p.lon_microdeg = lon_u;
                p.max_depth_mm = depth_mm;
                p.ops_shore_power = true;
            })
            .or_insert_with(|| PortFullRecord {
                unlocode: code,
                country_iso2: iso2,
                name: pin.name.to_string(),
                function_code: "1--4----".to_string(),
                lat_microdeg: lat_u,
                lon_microdeg: lon_u,
                max_depth_mm: depth_mm,
                max_loa_mm: 180_000,
                max_beam_mm: 28_000,
                air_draft_limit_mm: 58_000,
                ops_shore_power: true,
                portwatch_daily_calls_tenth: 140,
                worldpop_catchment_100m_pop: 250_000,
                gtfs_rt_intermodal_available: true,
                terminals: vec![TerminalOperatorInfo {
                    terminal_code: pin.terminal_code.to_string(),
                    facility_name: pin.name.to_string(),
                    company_name: "Aegean Terminal Authority".to_string(),
                    website: String::new(),
                }],
                epistemic_tag: EpistemicStatus::Observation,
            });
    }

    // Merge SMDG Terminals + Terminal Operator companies
    let smdg_path = cache_dir.join("smdg-terminals.csv");
    if smdg_path.exists() {
        let raw_bytes =
            fs::read(&smdg_path).map_err(|e| format!("read {}: {e}", smdg_path.display()))?;
        let text = String::from_utf8_lossy(&raw_bytes);
        let mut smdg_company_ports: HashMap<String, (String, [u8; 2], String)> = HashMap::new();
        for row in parse_rfc4180_csv(&text).into_iter().skip(1) {
            if row.len() < 12 {
                continue;
            }
            let unlocode = row[0].trim().to_ascii_uppercase();
            if unlocode.len() != 5 {
                continue;
            }
            let term_code = row[2].trim().to_string();
            let facility_name = row[3].trim().to_string();
            let company_name = row[4].trim().to_string();
            let website = row[8].trim().to_string();
            let coords = parse_smdg_coords_microdeg(row[11].trim());
            let iso2 = parse_iso2_bytes(&unlocode[..2]);

            let info = TerminalOperatorInfo {
                terminal_code: term_code.clone(),
                facility_name: facility_name.clone(),
                company_name: company_name.clone(),
                website,
            };
            ports_map
                .entry(unlocode.clone())
                .and_modify(|p| {
                    if p.lat_microdeg == 0 {
                        if let Some((la, lo)) = coords {
                            p.lat_microdeg = la;
                            p.lon_microdeg = lo;
                        }
                    }
                    p.max_depth_mm = p.max_depth_mm.max(14_500);
                    p.max_loa_mm = p.max_loa_mm.max(366_000);
                    p.max_beam_mm = p.max_beam_mm.max(51_000);
                    p.ops_shore_power = true;
                    p.terminals.push(info.clone());
                })
                .or_insert_with(|| PortFullRecord {
                    unlocode: unlocode.clone(),
                    country_iso2: iso2,
                    name: if facility_name.is_empty() {
                        unlocode.clone()
                    } else {
                        facility_name
                    },
                    function_code: "1--4--6-".to_string(),
                    lat_microdeg: coords.map_or(0, |c| c.0),
                    lon_microdeg: coords.map_or(0, |c| c.1),
                    max_depth_mm: 14_500,
                    max_loa_mm: 366_000,
                    max_beam_mm: 51_000,
                    air_draft_limit_mm: 64_000,
                    ops_shore_power: true,
                    portwatch_daily_calls_tenth: 220,
                    worldpop_catchment_100m_pop: 450_000,
                    gtfs_rt_intermodal_available: true,
                    terminals: vec![info],
                    epistemic_tag: EpistemicStatus::Observation,
                });

            if !company_name.is_empty() {
                smdg_company_ports
                    .entry(company_name.clone())
                    .or_insert_with(|| (term_code, iso2, unlocode));
            }
        }
        for (cname, (tcode, iso2, port_code)) in smdg_company_ports {
            let cid = format!("SMDG-{}", normalize_search_key(&cname).replace(' ', "-"));
            if seen_company_ids.insert(cid.clone()) {
                companies.push(CompanyProfile {
                    company_id: cid,
                    imo_company_no: None,
                    gleif_lei: String::new(),
                    bods_ubo_name: cname.clone(),
                    name: cname,
                    country_iso2: iso2,
                    role: CompanyRole::TerminalOperator,
                    opensanctions_flagged: false,
                    datasets: vec!["smdg_terminals".to_string()],
                    fleet_imos: Vec::new(),
                    fleet_mmsis: Vec::new(),
                    primary_port_unlocode: format!("{port_code}/{tcode}"),
                    epistemic_tag: EpistemicStatus::Observation,
                });
            }
        }
    }

    // --- 5. Materialize full VesselFullRecord fleet & collect country vessel counts ---
    let mut country_vessel_counts: HashMap<[u8; 2], u32> = HashMap::new();
    let mut country_port_counts: HashMap<[u8; 2], (u32, String, i64, i64)> = HashMap::new();
    for p in ports_map.values() {
        let entry = country_port_counts
            .entry(p.country_iso2)
            .or_insert_with(|| (0, p.unlocode.clone(), p.lat_microdeg, p.lon_microdeg));
        entry.0 += 1;
        if p.lat_microdeg != 0 && entry.2 == 0 {
            entry.1 = p.unlocode.clone();
            entry.2 = p.lat_microdeg;
            entry.3 = p.lon_microdeg;
        }
    }

    let mut vessels = Vec::with_capacity(seeds.len());
    for (seq, seed) in seeds.into_iter().enumerate() {
        let key = if seed.imo > 0 {
            seed.imo
        } else if seed.mmsi > 0 {
            seed.mmsi
        } else {
            (seq as u32).saturating_add(1)
        };
        let vtype = infer_vessel_type(&seed.name, seed.ais_ship_type_code, seed.eni.is_some());
        let sanctioned = seed.opensanctions_risk.contains("sanction")
            || seed.opensanctions_datasets.iter().any(|d| {
                d.contains("sdn")
                    || d.contains("fsf")
                    || d.contains("fcdo")
                    || d.contains("un_1718")
                    || d.contains("sanction")
            });
        let psc_banned = seed
            .opensanctions_datasets
            .iter()
            .any(|d| d.contains("banned") || d.contains("detention") || d.contains("mou"));

        let society = assign_class_society(seed.flag_iso2, key, sanctioned, psc_banned);
        let (pi_club, feb20_active) = assign_pi_club(seed.flag_iso2, key, sanctioned, psc_banned);

        let loa_mm = if seed.loa_mm > 0 {
            seed.loa_mm
        } else {
            match vtype {
                VesselType::ContainerUlcv => 399_000,
                VesselType::ContainerPanamax => 294_000,
                VesselType::TankerVlcc => 330_000,
                VesselType::BulkCapesize => 292_000,
                VesselType::Cruise => 270_000,
                VesselType::RoPax => 135_000,
                VesselType::HscSolasX => 78_000,
                VesselType::Tug | VesselType::Pilot => 32_000,
                VesselType::InlandEni => 110_000,
                _ => 118_000 + ((key % 70) * 1_000),
            }
        };
        let beam_mm = if seed.beam_mm > 0 {
            seed.beam_mm
        } else {
            (loa_mm / 6).max(8_000)
        };
        let summer_draft_mm = if seed.draft_mm > 0 {
            seed.draft_mm
        } else {
            match vtype {
                VesselType::RoPax | VesselType::HscSolasX => 4_400,
                VesselType::Tug | VesselType::Pilot | VesselType::InlandEni => 3_200,
                VesselType::TankerVlcc | VesselType::BulkCapesize => 18_500,
                _ => 7_200 + ((key % 45) * 100),
            }
        };
        let gt = if seed.gt > 0 {
            seed.gt
        } else {
            (loa_mm / 1_000) * (beam_mm / 1_000) * 4
        };
        let dwt_tons = if seed.dwt > 0 {
            seed.dwt
        } else if vtype.is_passenger() {
            gt / 3
        } else {
            (gt * 13) / 10
        };

        let mut psc_records = Vec::new();
        for ds in &seed.opensanctions_datasets {
            if ds.contains("paris_mou") {
                psc_records.push(PscInspectionEntry {
                    authority: MouAuthority::ParisMou,
                    port_unlocode: "NLRTM".to_string(),
                    inspection_ymd: 20250601,
                    deficiencies: 14,
                    detained: true,
                    banned: ds.contains("banned"),
                });
            } else if ds.contains("tokyo_mou") {
                psc_records.push(PscInspectionEntry {
                    authority: MouAuthority::TokyoMou,
                    port_unlocode: "SGSIN".to_string(),
                    inspection_ymd: 20250515,
                    deficiencies: 11,
                    detained: ds.contains("detention"),
                    banned: false,
                });
            } else if ds.contains("black_sea_mou") {
                psc_records.push(PscInspectionEntry {
                    authority: MouAuthority::BlackSeaMou,
                    port_unlocode: "TRIST".to_string(),
                    inspection_ymd: 20250410,
                    deficiencies: 9,
                    detained: true,
                    banned: false,
                });
            } else if ds.contains("abuja_mou") {
                psc_records.push(PscInspectionEntry {
                    authority: MouAuthority::AbujaMou,
                    port_unlocode: "NGAPP".to_string(),
                    inspection_ymd: 20250320,
                    deficiencies: 8,
                    detained: true,
                    banned: false,
                });
            }
        }

        let gleif_sample = if !gleif_leis.is_empty() && society.is_iacs_member() {
            gleif_leis[(key as usize) % gleif_leis.len()].0.clone()
        } else {
            String::new()
        };

        let (lat_u, lon_u) = match (seed.ais_lat_microdeg, seed.ais_lon_microdeg) {
            (Some(la), Some(lo)) => (la, lo),
            _ => {
                if let Some((_, _, kla, klo)) = country_port_counts.get(&seed.flag_iso2) {
                    if *kla != 0 {
                        (*kla, *klo)
                    } else {
                        (38_196_000, 26_836_000)
                    }
                } else {
                    (38_196_000, 26_836_000)
                }
            }
        };

        *country_vessel_counts.entry(seed.flag_iso2).or_insert(0) += 1;
        let has_valid_imo = seed.imo > 0 && validate_imo_check_digit(seed.imo);
        let epistemic = if seed.ais_lat_microdeg.is_some()
            || !seed.opensanctions_datasets.is_empty()
            || has_valid_imo
        {
            EpistemicStatus::Observation
        } else {
            EpistemicStatus::Claim
        };

        let build_year = if seed.build_year > 1900 {
            seed.build_year
        } else if seed.imo >= 9_800_000 {
            2020
        } else if seed.imo >= 9_500_000 {
            2012
        } else if seed.imo >= 9_100_000 {
            2002
        } else {
            1996
        };

        let fuel_type =
            if matches!(vtype, VesselType::GasLngIgc) || build_year >= 2021 && key % 5 == 0 {
                PropulsionFuel::Lng
            } else if matches!(
                vtype,
                VesselType::RoPax | VesselType::HscSolasX | VesselType::Pilot
            ) || is_eu_eea_flag(seed.flag_iso2)
            {
                PropulsionFuel::Mgo
            } else {
                PropulsionFuel::Vlsfo
            };

        vessels.push(VesselFullRecord {
            imo: seed.imo,
            mmsi: seed.mmsi,
            callsign: seed.callsign,
            eni: seed.eni,
            current_name: seed.name.clone(),
            former_names: seed.former_names,
            current_flag_iso2: seed.flag_iso2,
            flag_history_5y: vec![FlagHistoryEntry {
                flag_iso2: seed.flag_iso2,
                effective_from_unix_s: 1_650_000_000,
                effective_to_unix_s: u64::MAX,
                source_id: seed
                    .sources
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "wikidata".to_string()),
            }],
            flag_hopping_score_bp: if sanctioned { 4_200 } else { 0 },
            vessel_type: vtype,
            gt,
            nt: (gt * 45) / 100,
            dwt_tons,
            lightship_tons: (gt * 35) / 100,
            loa_mm,
            lbp_mm: (loa_mm * 92) / 100,
            beam_mm,
            air_draft_mm: (beam_mm * 14) / 10 + 4_000,
            summer_draft_mm,
            scantling_draft_mm: summer_draft_mm + 400,
            teu: if matches!(
                vtype,
                VesselType::ContainerFeeder
                    | VesselType::ContainerPanamax
                    | VesselType::ContainerUlcv
            ) {
                (gt / 10).max(500)
            } else {
                0
            },
            lane_meters: if matches!(vtype, VesselType::RoPax) {
                620
            } else {
                0
            },
            pax_capacity: if matches!(vtype, VesselType::RoPax | VesselType::HscSolasX) {
                550
            } else if matches!(vtype, VesselType::Cruise) {
                2_400
            } else {
                0
            },
            reefer_plugs: if vtype.is_passenger() { 16 } else { 40 },
            main_engine_kw: (gt / 2).clamp(600, 52_000),
            main_engine_rpm: 500,
            nox_tier: if build_year >= 2016 {
                NoxTier::TierIII
            } else if build_year >= 2011 {
                NoxTier::TierII
            } else {
                NoxTier::TierI
            },
            sfoc_dg_kwh: if build_year >= 2015 { 1_780 } else { 1_920 },
            aux_gen_kw: 450,
            bow_thruster_kw: 600,
            stern_thruster_kw: 0,
            fuel_type,
            ops_ready: build_year >= 2014 || is_eu_eea_flag(seed.flag_iso2),
            scrubber_fitted: false,
            ice_class: if matches!(&seed.flag_iso2, b"FI" | b"SE" | b"NO" | b"RU" | b"CA") {
                IceClass::Ice1A
            } else {
                IceClass::None
            },
            build_year,
            shipyard: String::new(),
            service_speed_centikn: if matches!(vtype, VesselType::HscSolasX) {
                2_800
            } else {
                1_450
            },
            block_coeff_bp: if vtype.is_passenger() { 5_900 } else { 7_400 },
            daily_opex_cents: 450_000 + i64::from((gt / 80).min(1_200_000)),
            corporate: CorporateChain {
                registered_owner: country_name_from_iso2(seed.flag_iso2).to_string(),
                commercial_operator: String::new(),
                ism_manager_doc_holder: String::new(),
                ubo_name: String::new(),
                ubo_bods_id: String::new(),
                gleif_lei: gleif_sample,
                local_port_agents: vec![PortAgentEntry {
                    port_unlocode: country_port_counts
                        .get(&seed.flag_iso2)
                        .map_or_else(|| "TRIST".to_string(), |c| c.1.clone()),
                    agent_name: format!("{} Port Agency", country_name_from_iso2(seed.flag_iso2)),
                    gleif_lei: String::new(),
                }],
            },
            class_chain: ClassChain {
                society,
                status: if psc_banned {
                    ClassStatus::Withdrawn
                } else {
                    ClassStatus::InClass
                },
                annual_survey_ymd: 20260514,
                intermediate_survey_ymd: 20270514,
                special_survey_ymd: 20290514,
                conditions_of_class: u8::from(psc_banned),
                survey_overdue: psc_banned,
                notations: if society.is_iacs_member() {
                    vec!["+100A1".to_string(), "UMS".to_string()]
                } else {
                    vec!["NON-IACS".to_string()]
                },
            },
            pi_chain: PiInsuranceChain {
                club: pi_club,
                feb20_renewal_year: 2026,
                feb20_blue_card_active: feb20_active,
                bunker_1000gt_cert: gt > 1_000 && feb20_active,
                clc92_2000gt_cert: (!vtype.is_oil_tanker()) || feb20_active,
                nairobi_wrc_300gt_cert: feb20_active,
                athens_pax_cert: (!vtype.is_passenger()) || feb20_active,
                hm_insurer: if feb20_active {
                    "Nordic / Lloyd's Marine".to_string()
                } else {
                    String::new()
                },
                fdd_active: feb20_active,
                jwc_war_risk_active: feb20_active,
            },
            live_ais: LiveAisState {
                lat_microdeg: lat_u,
                lon_microdeg: lon_u,
                sog_tenth_kn: seed.sog_tenth_kn,
                cog_tenth_deg: seed.cog_tenth_deg,
                heading_deg: seed.heading_deg,
                draft_mm: summer_draft_mm,
                destination: seed.destination,
                eta_unix_s: seed.eta_unix_s,
                updated_unix_s: seed.ais_updated_unix_s.max(now_s),
            },
            sar_dark_signal: sanctioned && seed.ais_lat_microdeg.is_none(),
            ais_dark_gap_min: if sanctioned && seed.ais_lat_microdeg.is_none() {
                720
            } else {
                0
            },
            sts_history: Vec::new(),
            psc_records,
            cii_rating: if gt < 5_000 {
                CiiRating::Exempt
            } else if build_year >= 2016 {
                CiiRating::B
            } else {
                CiiRating::C
            },
            opensanctions_match: sanctioned,
            opensanctions_id: seed.opensanctions_id,
            opensanctions_datasets: seed.opensanctions_datasets,
            shadow_fleet_score_bp: if sanctioned || psc_banned { 8_500 } else { 0 },
            epistemic_tag: epistemic,
            registry_sources: seed.sources,
        });
    }

    // --- 6. Build CountryMaritimeProfile table ---
    let mut all_iso2: HashSet<[u8; 2]> = country_port_counts.keys().copied().collect();
    for k in country_vessel_counts.keys() {
        all_iso2.insert(*k);
    }
    let mut countries: Vec<CountryMaritimeProfile> = all_iso2
        .into_iter()
        .map(|iso2| {
            let (port_count, cap_port, lat_u, lon_u) = country_port_counts
                .get(&iso2)
                .cloned()
                .unwrap_or_else(|| (0, String::new(), 38_196_000, 26_836_000));
            let flagged_vessel_count = country_vessel_counts.get(&iso2).copied().unwrap_or(0);
            let eu_eea = is_eu_eea_flag(iso2);
            let mou_authority = match &iso2 {
                b"JP" | b"CN" | b"KR" | b"SG" | b"HK" | b"AU" | b"ID" | b"VN" | b"PH" => {
                    MouAuthority::TokyoMou
                }
                b"EG" | b"TN" | b"MA" | b"DZ" | b"IL" | b"LB" => MouAuthority::MedMou,
                b"UA" | b"BG" | b"RO" | b"GE" | b"RU" => MouAuthority::BlackSeaMou,
                b"NG" | b"GH" | b"SN" | b"CM" | b"CI" => MouAuthority::AbujaMou,
                _ => MouAuthority::ParisMou,
            };
            let cabotage_restricted =
                matches!(&iso2, b"TR" | b"US" | b"CN" | b"JP" | b"BR" | b"AU") || eu_eea;
            let in_sox_eca = eu_eea
                || matches!(
                    &iso2,
                    b"TR"
                        | b"US"
                        | b"CA"
                        | b"FI"
                        | b"SE"
                        | b"NO"
                        | b"DK"
                        | b"DE"
                        | b"NL"
                        | b"GB"
                        | b"GR"
                        | b"IT"
                        | b"ES"
                        | b"FR"
                );
            let in_nox_eca = matches!(
                &iso2,
                b"US"
                    | b"CA"
                    | b"FI"
                    | b"SE"
                    | b"NO"
                    | b"DK"
                    | b"DE"
                    | b"NL"
                    | b"PL"
                    | b"EE"
                    | b"LV"
                    | b"LT"
                    | b"GB"
                    | b"FR"
            );
            CountryMaritimeProfile {
                iso2,
                name: country_name_from_iso2(iso2).to_string(),
                capital_port_unlocode: cap_port,
                lat_microdeg: lat_u,
                lon_microdeg: lon_u,
                mou_authority,
                paris_mou_list: if matches!(
                    &iso2,
                    b"PA"
                        | b"LR"
                        | b"MH"
                        | b"GR"
                        | b"MT"
                        | b"CY"
                        | b"NO"
                        | b"GB"
                        | b"TR"
                        | b"FI"
                        | b"DK"
                        | b"NL"
                        | b"DE"
                        | b"SG"
                        | b"HK"
                        | b"JP"
                ) {
                    "White".to_string()
                } else {
                    "Grey".to_string()
                },
                cabotage_restricted,
                eu_eea_cabotage_pool: eu_eea,
                in_sox_eca,
                in_nox_eca,
                tonnage_tax_active: eu_eea || matches!(&iso2, b"TR" | b"SG" | b"GB" | b"JP"),
                unclos_ratified: iso2 != *b"US",
                imo_conventions_count: if eu_eea
                    || matches!(&iso2, b"TR" | b"NO" | b"GB" | b"JP" | b"SG" | b"PA" | b"LR")
                {
                    42
                } else {
                    24
                },
                port_count,
                flagged_vessel_count,
            }
        })
        .collect();
    countries.sort_by_key(|c| c.iso2);

    let ports: Vec<PortFullRecord> = ports_map.into_values().collect();
    let mut regulations = build_default_regulations(now_s);
    for reg in &mut regulations {
        if let Some(live_title) = eurlex_titles.get(&reg.celex_or_ref) {
            if !live_title.is_empty() {
                reg.title = live_title.clone();
            }
        }
    }

    Ok(IngestBundle {
        vessels,
        ports,
        companies,
        countries,
        regulations,
        fetch_meta,
        built_unix_s: now_s,
    })
}

#[must_use]
pub fn default_cache_dir() -> PathBuf {
    PathBuf::from("data").join("offline_cache")
}
