//! Streaming `BufReader` UN/LOCODE & SMDG Master Terminal Lookup.
//!
//! Streams `data/offline_cache/un-locode.csv` (~116k lines) and
//! `data/offline_cache/smdg-terminals.csv` (~1.2k lines) line-by-line on LEAP
//! query, avoiding loading megabytes of CSV data onto the UI heap.

use caelus_core::domain::AEGEAN_PORTS;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnLocodeEntry {
    pub unlocode: String,
    pub name: String,
    pub function_code: String,
    pub lat_deg: Option<f64>,
    pub lon_deg: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmdgTerminalEntry {
    pub unlocode: String,
    pub terminal_code: String,
    pub facility_name: String,
    pub company_name: String,
}

#[must_use]
pub fn default_unlocode_path() -> PathBuf {
    PathBuf::from("data")
        .join("offline_cache")
        .join("un-locode.csv")
}

#[must_use]
pub fn default_smdg_path() -> PathBuf {
    PathBuf::from("data")
        .join("offline_cache")
        .join("smdg-terminals.csv")
}

/// Splits a single RFC-4180 CSV row handling quoted fields and escaped `""`.
fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    chars.next();
                    current.push('"');
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            '\r' | '\n' => {}
            _ => current.push(c),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

/// Parses UN/LOCODE coordinate token (`DDMM[N|S] DDDMM[E|W]`, e.g. `3811N 02649E`).
fn parse_unlocode_coords(raw: &str) -> (Option<f64>, Option<f64>) {
    let mut parts = raw.split_whitespace();
    let (Some(lat_tok), Some(lon_tok)) = (parts.next(), parts.next()) else {
        return (None, None);
    };
    (
        parse_dm_token(lat_tok, true),
        parse_dm_token(lon_tok, false),
    )
}

fn parse_dm_token(tok: &str, is_lat: bool) -> Option<f64> {
    let bytes = tok.as_bytes();
    let min_len = if is_lat { 5 } else { 6 };
    if bytes.len() < min_len {
        return None;
    }
    let hemi = *bytes.last()? as char;
    let deg_digits = if is_lat { 2 } else { 3 };
    let deg: f64 = tok.get(..deg_digits)?.parse().ok()?;
    let min: f64 = tok.get(deg_digits..bytes.len() - 1)?.parse().ok()?;
    let val = deg + min / 60.0;
    match hemi {
        'N' | 'E' => Some(val),
        'S' | 'W' => Some(-val),
        _ => None,
    }
}

/// Streams UN/LOCODE entries matching `query` (by code or name) without caching the whole file.
#[must_use]
pub fn search_unlocode_streaming(
    csv_path: Option<&Path>,
    query: &str,
    limit: usize,
) -> Vec<UnLocodeEntry> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut out = Vec::new();
    let path = csv_path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_unlocode_path);

    if let Ok(file) = File::open(&path) {
        let mut reader = BufReader::with_capacity(16 * 1024, file);
        let mut line = String::new();
        let mut header_seen = false;
        while out.len() < limit {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if !header_seen {
                header_seen = true;
                if line.starts_with("Change,Country,Location") {
                    continue;
                }
            }
            let cols = split_csv_line(&line);
            if cols.len() < 11 {
                continue;
            }
            let code = format!("{}{}", cols[1], cols[2]);
            let name = &cols[3];
            let ascii_name = &cols[4];
            if code.to_ascii_lowercase().contains(&q)
                || name.to_ascii_lowercase().contains(&q)
                || ascii_name.to_ascii_lowercase().contains(&q)
            {
                let (lat_deg, lon_deg) = parse_unlocode_coords(&cols[10]);
                out.push(UnLocodeEntry {
                    unlocode: code,
                    name: name.clone(),
                    function_code: cols[7].clone(),
                    lat_deg,
                    lon_deg,
                });
            }
        }
    }

    if out.is_empty() {
        for p in AEGEAN_PORTS {
            if p.unlocode.to_ascii_lowercase().contains(&q)
                || p.name.to_ascii_lowercase().contains(&q)
            {
                out.push(UnLocodeEntry {
                    unlocode: p.unlocode.to_string(),
                    name: p.name.to_string(),
                    function_code: "1-------".to_string(),
                    lat_deg: Some(p.lat_deg),
                    lon_deg: Some(p.lon_deg),
                });
                if out.len() >= limit {
                    break;
                }
            }
        }
    }

    out
}

/// Streams SMDG terminal entries matching `query` (UN/LOCODE, terminal code, or facility name).
#[must_use]
pub fn search_smdg_streaming(
    csv_path: Option<&Path>,
    query: &str,
    limit: usize,
) -> Vec<SmdgTerminalEntry> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut out = Vec::new();
    let path = csv_path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_smdg_path);

    if let Ok(file) = File::open(&path) {
        let mut reader = BufReader::with_capacity(8 * 1024, file);
        let mut line = String::new();
        let mut header_seen = false;
        while out.len() < limit {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if !header_seen {
                header_seen = true;
                if line.starts_with("UNLOCODE,") {
                    continue;
                }
            }
            let cols = split_csv_line(&line);
            if cols.len() < 5 {
                continue;
            }
            if cols[0].to_ascii_lowercase().contains(&q)
                || cols[2].to_ascii_lowercase().contains(&q)
                || cols[3].to_ascii_lowercase().contains(&q)
                || cols[4].to_ascii_lowercase().contains(&q)
            {
                out.push(SmdgTerminalEntry {
                    unlocode: cols[0].clone(),
                    terminal_code: cols[2].clone(),
                    facility_name: cols[3].clone(),
                    company_name: cols[4].clone(),
                });
            }
        }
    }

    if out.is_empty() {
        for p in AEGEAN_PORTS {
            if p.unlocode.to_ascii_lowercase().contains(&q)
                || p.terminal_code.to_ascii_lowercase().contains(&q)
                || p.name.to_ascii_lowercase().contains(&q)
            {
                out.push(SmdgTerminalEntry {
                    unlocode: p.unlocode.to_string(),
                    terminal_code: p.terminal_code.to_string(),
                    facility_name: format!("{} Terminal", p.name),
                    company_name: "Aegean Port Authority".to_string(),
                });
                if out.len() >= limit {
                    break;
                }
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_unlocode_and_smdg_find_aegean_and_offline_records() {
        let root_csv = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("data")
            .join("offline_cache")
            .join("un-locode.csv");
        let root_smdg = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("data")
            .join("offline_cache")
            .join("smdg-terminals.csv");

        let hits = search_unlocode_streaming(Some(&root_csv), "GRPIR", 5);
        assert!(!hits.is_empty(), "GRPIR Piraeus should be indexed");
        assert_eq!(hits[0].unlocode, "GRPIR");

        let smdg = search_smdg_streaming(Some(&root_smdg), "GRPIR", 5);
        assert!(!smdg.is_empty(), "GRPIR SMDG terminals should resolve");

        // Also ensure Aegean embedded fallback handles missing files cleanly
        let fallback = search_unlocode_streaming(Some(Path::new("nonexistent.csv")), "TRSEF", 3);
        assert_eq!(fallback[0].unlocode, "TRSEF");
    }
}
