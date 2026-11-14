//! CLI binary that synchronizes real open maritime registries (`O(Delta)` HTTP/SPARQL
//! with `ETag`/`If-Modified-Since` caching) and builds zero-copy `rkyv + memmap2` archives.

use caelus_atlas::leap_search::resolve_atlas_data_path;
use caelus_atlas::{sync_and_build_atlas, LivingAtlas};
use std::path::PathBuf;
use std::process;

fn main() {
    let mut cache_dir: Option<PathBuf> = None;
    let mut mmap_dir: Option<PathBuf> = None;
    let mut enable_network = true;
    let mut timeout_ms = 45_000u64;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cache-dir" => {
                if let Some(p) = args.next() {
                    cache_dir = Some(PathBuf::from(p));
                }
            }
            "--mmap-dir" => {
                if let Some(p) = args.next() {
                    mmap_dir = Some(PathBuf::from(p));
                }
            }
            "--offline" => {
                enable_network = false;
            }
            "--timeout-ms" => {
                if let Some(v) = args.next() {
                    timeout_ms = v.parse::<u64>().unwrap_or(45_000);
                }
            }
            "--help" | "-h" => {
                println!(
                    "Usage: caelus-atlas-sync [--cache-dir <dir>] [--mmap-dir <dir>] [--offline] [--timeout-ms <ms>]"
                );
                return;
            }
            other => {
                eprintln!("Unknown argument: {other}");
                process::exit(2);
            }
        }
    }

    let cdir = cache_dir.unwrap_or_else(|| resolve_atlas_data_path("offline_cache"));
    let mdir = mmap_dir.unwrap_or_else(|| resolve_atlas_data_path("atlas_mmap"));

    let report = match sync_and_build_atlas(&cdir, &mdir, enable_network, timeout_ms) {
        Ok(r) => r,
        Err(err) => {
            eprintln!("caelus-atlas-sync error: {err}");
            process::exit(1);
        }
    };

    println!(
        "CAELUS_ATLAS_SYNC vessels={} iacs={} ports={} smdg={} companies={} countries={} regs={} spo_triples={} xtdb_events={} egraph_classes={} consistent={} delta_304={}/{} elapsed_ms={}",
        report.manifest.vessel_count,
        report.manifest.iacs_count,
        report.manifest.port_count,
        report.manifest.smdg_count,
        report.manifest.company_count,
        report.manifest.country_count,
        report.manifest.regulation_count,
        report.spo_triple_count,
        report.xtdb_event_count,
        report.verification.egraph_classes,
        report.verification.consistent,
        report.sources_not_modified_304,
        report.sources_checked,
        report.elapsed_ms,
    );

    let atlas = match LivingAtlas::open_readonly(&mdir) {
        Ok(a) => a,
        Err(err) => {
            eprintln!("open_readonly failed after sync: {err}");
            process::exit(1);
        }
    };

    let sample_imos = atlas.store().sample_vessel_imos(4);
    let mut queries: Vec<String> = sample_imos.into_iter().map(|i| format!("IMO{i}")).collect();
    queries.extend(
        ["FAROMAR", "GRSMI", "TRSEF", "NLRTM", "TR", "FUELEU"]
            .into_iter()
            .map(ToString::to_string),
    );

    let mut max_us = 0u64;
    for q in &queries {
        match atlas.leap_search(q) {
            Ok(Some(hit)) => {
                max_us = max_us.max(hit.elapsed_us);
                println!(
                    "LEAP query={q:?} -> {:?} | {} ({} us)",
                    hit.kind, hit.primary_label, hit.elapsed_us
                );
            }
            Ok(None) => {
                println!("LEAP query={q:?} -> no match");
            }
            Err(e) => {
                eprintln!("LEAP error on {q:?}: {e}");
                process::exit(1);
            }
        }
    }
    println!("LEAP_MAX_US={max_us}");

    if report.manifest.vessel_count < 100_000 || report.manifest.iacs_count < 60_223 {
        eprintln!(
            "Global fleet target unmet: vessels={} (need >= 100000), iacs={} (need >= 60223)",
            report.manifest.vessel_count, report.manifest.iacs_count
        );
        process::exit(1);
    }
}
