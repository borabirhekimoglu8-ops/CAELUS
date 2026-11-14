#![forbid(unsafe_code)]

//! Headless zero-GPU, low-memory daemon runner for [`caelus_core`] + [`caelus_ingest`].

use caelus_core::domain::CorridorKind;
use caelus_core::worker::{CoreParams, CoreSnapshot, HeadlessCoreHandle};
use caelus_ingest::{collect_ingest_snapshot, default_ring_path, write_ring_snapshot};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
struct DaemonConfig {
    headless: bool,
    ticks: usize,
    interval_ms: u64,
    time_hour: f64,
    backup_pier_b: bool,
    storm_drill: bool,
    sync_ingest: bool,
    ring_path: PathBuf,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            headless: true,
            ticks: 4,
            interval_ms: 0,
            time_hour: 0.0,
            backup_pier_b: false,
            storm_drill: false,
            sync_ingest: false,
            ring_path: default_ring_path(),
        }
    }
}

fn parse_args<I>(args: I) -> DaemonConfig
where
    I: IntoIterator<Item = String>,
{
    let mut cfg = DaemonConfig::default();
    let mut iter = args.into_iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--headless" => cfg.headless = true,
            "--pier-b" => cfg.backup_pier_b = true,
            "--storm" => cfg.storm_drill = true,
            "--sync-ingest" => cfg.sync_ingest = true,
            "--ticks" => {
                if let Some(val) = iter.next().and_then(|s| s.parse::<usize>().ok()) {
                    cfg.ticks = val.max(1);
                }
            }
            "--interval-ms" => {
                if let Some(val) = iter.next().and_then(|s| s.parse::<u64>().ok()) {
                    cfg.interval_ms = val;
                }
            }
            "--hour" => {
                if let Some(val) = iter.next().and_then(|s| s.parse::<f64>().ok()) {
                    cfg.time_hour = val.clamp(-24.0, 72.0);
                }
            }
            "--ring-path" => {
                if let Some(path) = iter.next() {
                    cfg.ring_path = PathBuf::from(path);
                }
            }
            _ => {}
        }
    }
    cfg
}

fn run_headless_ticks(cfg: &DaemonConfig) -> CoreSnapshot {
    let initial = CoreParams {
        time_hour: cfg.time_hour,
        backup_pier_b: cfg.backup_pier_b,
        storm_drill: cfg.storm_drill,
        speed_knots: 13.0,
        corridor: CorridorKind::SeferihisarSamos,
        outlay_keur: 240,
        monthly_savings_keur: 14,
        tick_nonce: 0,
    };

    let handle = HeadlessCoreHandle::spawn(initial, None);
    let mut latest = handle
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or_else(|| HeadlessCoreHandle::initial_snapshot(initial));

    for _ in 1..cfg.ticks {
        if cfg.interval_ms > 0 {
            std::thread::sleep(Duration::from_millis(cfg.interval_ms));
        }
        handle.trigger_tick();
        if let Some(next) = handle.recv_timeout(Duration::from_secs(2)) {
            latest = next;
        }
    }

    latest
}

fn main() {
    let cfg = parse_args(std::env::args());
    let snap = run_headless_ticks(&cfg);
    let ingest_info = if cfg.sync_ingest {
        let ing = collect_ingest_snapshot(true, 1_500);
        let bytes = write_ring_snapshot(&cfg.ring_path, &ing).unwrap_or(0);
        format!(
            "pins={} dtn={} mesh={} ring_bytes={}",
            ing.pins.len(),
            ing.dtn_queued_bundles,
            ing.reticulum_mesh_peers,
            bytes
        )
    } else {
        "pins=deferred".to_string()
    };
    println!(
        "CAELUS_DAEMON_OK headless={} ticks={} gen={} status={} utc={:02}:{:02} delay_min={} cfc={:.3} vjepa={:.3} ai={:?} cbf={:?} pbit={:.3} topos={:.1} calyx={:.2} darwin={:.4} aixitl={} hal={:.4}mJ sentinel={}({}) ring={}/{} {}",
        cfg.headless,
        cfg.ticks,
        snap.generation,
        snap.timeline.status_tag,
        snap.timeline.utc_hour,
        snap.timeline.utc_minute,
        snap.hub_eval.delay_minutes,
        snap.cfc_anomaly,
        snap.vjepa_surprise,
        snap.ai_action,
        snap.cbf_safe_action,
        snap.pbit_energy,
        snap.topos_welfare_keur,
        snap.calyx_top_strength,
        snap.darwin_fitness,
        snap.aixitl_tag.code(),
        snap.hal_net_mj,
        snap.sentinel_alert,
        snap.sentinel_code,
        snap.ring_len,
        snap.ring_capacity,
        ingest_info,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use caelus_ingest::read_ring_zero_copy;

    #[test]
    fn daemon_runs_requested_ticks_without_gpu() {
        let cfg = DaemonConfig {
            headless: true,
            ticks: 5,
            interval_ms: 0,
            time_hour: 2.0,
            backup_pier_b: true,
            storm_drill: false,
            sync_ingest: false,
            ring_path: default_ring_path(),
        };
        let snap = run_headless_ticks(&cfg);
        assert_eq!(snap.generation, 5);
        assert_eq!(snap.ring_len, 5);
        assert!(snap.hub_eval.delay_minutes < 10);
    }

    #[test]
    fn cli_parser_handles_headless_and_tick_flags() {
        let cfg = parse_args(vec![
            "caelus_daemon".into(),
            "--headless".into(),
            "--ticks".into(),
            "7".into(),
            "--pier-b".into(),
            "--hour".into(),
            "6".into(),
            "--sync-ingest".into(),
        ]);
        assert!(cfg.headless);
        assert_eq!(cfg.ticks, 7);
        assert!(cfg.backup_pier_b);
        assert!(cfg.sync_ingest);
        assert!((cfg.time_hour - 6.0).abs() < 1e-9);
    }

    #[test]
    fn daemon_writes_and_reads_mmap_ingest_ring() {
        let tmp = std::env::temp_dir().join("caelus_daemon_ingest_ring.rkyv");
        let _ = std::fs::remove_file(&tmp);
        let ing = collect_ingest_snapshot(false, 100);
        write_ring_snapshot(&tmp, &ing).expect("write ring");
        let view = read_ring_zero_copy(&tmp).expect("read zero copy ring");
        let archived = view.archived().expect("valid archived view");
        assert!(archived.pins.len() >= 48);
        let _ = std::fs::remove_file(&tmp);
    }
}
