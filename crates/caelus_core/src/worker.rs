//! Independent headless decision worker running off the UI thread via
//! `std::thread::spawn` + `std::sync::mpsc`, backed by a fixed-capacity
//! zero-allocation [`RingBuffer`].

use crate::active_inference::{ActiveInferenceAgent, MaritimeAction};
use crate::aixitl_prior::{
    select_mdl_hypothesis, AixitlSelection, EpistemicTag, HypothesisCandidate,
};
use crate::calyx_trace::CalyxMemory;
use crate::cbf_guard::{enforce_nagumo_barrier, CbfConstraints};
use crate::cfc::{CfcCell, TelemetrySample};
use crate::darwin_policy::{DarwinEvolver, PolicyGenome};
use crate::domain::{
    fixed_fleet_arrays, xtdb_clock_parts, AircraftTrack, CorridorFeasibility, CorridorKind,
    CrisisBeacon, PortHubEvaluation, SatelliteTrack, VesselTrack, XtdbClockParts,
};
use crate::egraph::EGraph;
use crate::hal_sim::{estimate_hal_budget, HardwareProfile};
use crate::maritime_security::evaluate_raim_spoofing;
use crate::pbit_ising::PbitNetwork;
use crate::ring_buffer::RingBuffer;
use crate::topos_game::{solve_topos_coalition, OperatorPayoff};
use crate::vjepa_latent::VjepaWorldModel;
use std::f64::consts::PI;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// Compile-time fixed capacity for the zero-allocation telemetry ring buffer.
pub const RING_BUFFER_CAPACITY: usize = 256;

/// Parameter vector driving deterministic CAELUS OS simulation & solver updates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoreParams {
    pub time_hour: f64,
    pub backup_pier_b: bool,
    pub storm_drill: bool,
    pub speed_knots: f64,
    pub corridor: CorridorKind,
    pub outlay_keur: u32,
    pub monthly_savings_keur: u32,
    pub tick_nonce: u64,
}

impl Default for CoreParams {
    fn default() -> Self {
        Self {
            time_hour: 0.0,
            backup_pier_b: false,
            storm_drill: false,
            speed_knots: 13.0,
            corridor: CorridorKind::SeferihisarSamos,
            outlay_keur: 240,
            monthly_savings_keur: 14,
            tick_nonce: 0,
        }
    }
}

/// Fixed-size Copy telemetry log entry stored inside [`RingBuffer`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TelemetryLogEntry {
    pub seq: u64,
    pub time_hour: f64,
    pub cfc_anomaly: f64,
    pub pbit_energy: f64,
    pub darwin_fitness: f64,
    pub ai_action: MaritimeAction,
    pub delay_minutes: i32,
    pub pier_b: bool,
    pub storm_drill: bool,
}

/// Immutable Copy snapshot published over `mpsc` to UI/TUI/daemon consumers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoreSnapshot {
    pub generation: u64,
    pub params: CoreParams,
    pub cfc_anomaly: f64,
    pub ai_action: MaritimeAction,
    pub ai_efe: f64,
    pub pbit_energy: f64,
    pub darwin_fitness: f64,
    pub hal_net_mj: f64,
    pub egraph_equivalent_route: bool,
    pub feasibility: CorridorFeasibility,
    pub hub_eval: PortHubEvaluation,
    pub timeline: XtdbClockParts,
    pub vessels: [VesselTrack; 4],
    pub aircraft: [AircraftTrack; 3],
    pub satellites: [SatelliteTrack; 3],
    pub beacons: [CrisisBeacon; 3],
    pub ring_len: usize,
    pub ring_capacity: usize,
    pub latest_entry: Option<TelemetryLogEntry>,
    pub vjepa_surprise: f64,
    pub cbf_clamped: bool,
    pub cbf_safe_action: MaritimeAction,
    pub cbf_max_speed_knots: f64,
    pub cbf_reason: &'static str,
    pub topos_welfare_keur: f64,
    pub topos_gini: f64,
    pub calyx_top_strength: f64,
    pub aixitl_best_id: u32,
    pub aixitl_tag: EpistemicTag,
    pub raim_spoofed: bool,
    pub raim_wsse_m2: f64,
    pub sentinel_alert: bool,
    pub sentinel_code: &'static str,
}

enum WorkerCommand {
    UpdateParams(CoreParams),
    TriggerTick,
    Shutdown,
}

struct WorkerEvalContext {
    cfc: CfcCell,
    vjepa: VjepaWorldModel,
    calyx: CalyxMemory,
    generation: u64,
    ring: RingBuffer<TelemetryLogEntry, RING_BUFFER_CAPACITY>,
    current_params: CoreParams,
}

impl WorkerEvalContext {
    fn new(initial: CoreParams) -> Self {
        Self {
            cfc: CfcCell::deterministic(8, 4),
            vjepa: VjepaWorldModel::new(),
            calyx: CalyxMemory::new(6.0),
            generation: 0,
            ring: RingBuffer::new(),
            current_params: initial,
        }
    }

    fn evaluate_and_record(&mut self, params: CoreParams) -> CoreSnapshot {
        self.evaluate_with_hazards(params, None, [0.9, -0.6, 0.4, 0.8, -0.5, 0.3], false)
    }

    fn evaluate_with_hazards(
        &mut self,
        params: CoreParams,
        ukc_override_m: Option<f64>,
        pseudorange_residuals_m: [f64; 6],
        in_restricted_zone: bool,
    ) -> CoreSnapshot {
        self.current_params = params;
        self.generation += 1;

        let norm_t = (params.time_hour + 24.0) / 96.0;
        let storm_wave = if params.storm_drill {
            0.92
        } else {
            (norm_t * 2.0 * PI).sin().abs() * 0.72
        };
        let ais_gap = if params.backup_pier_b {
            0.05
        } else {
            0.25 * norm_t
        };

        self.cfc.reset();
        let sample = TelemetrySample {
            dt_seconds: 1.0 + norm_t * 3.0,
            features: [
                (params.speed_knots / 20.0).clamp(0.1, 1.0),
                0.22 + 0.68 * storm_wave,
                0.28 + 0.62 * storm_wave,
                ais_gap,
            ],
        };
        let cfc_anomaly = self.cfc.anomaly_score(&sample);

        let mut agent = ActiveInferenceAgent::new();
        agent.infer_state([1.0 - storm_wave, 0.45, 0.10 + 0.85 * storm_wave]);
        let (ai_action, evals) = agent.select_action();
        let ai_efe = evals[0].expected_free_energy;

        let j = vec![
            vec![0.0, -1.5, 0.4, 0.2],
            vec![-1.5, 0.0, 0.3, -0.8],
            vec![0.4, 0.3, 0.0, -1.2],
            vec![0.2, -0.8, -1.2, 0.0],
        ];
        let h = vec![0.5, 0.3, 0.4, 0.2];
        let seed_offset = (params.time_hour.round() + 24.0).max(0.0) as u64;
        let mut pbit = PbitNetwork::new(j, h, 42 + seed_offset);
        let pbit_energy = pbit.solve_annealed(150, 0.2, 3.5).energy;

        let mut evolver = DarwinEvolver::new(
            PolicyGenome {
                shelter_threshold: 0.60,
                ais_gap_weight: 0.70,
                fuel_penalty_weight: 0.55,
            },
            1337,
        );
        evolver.evolve(40);
        let darwin_fitness = evolver.best_fitness;

        let hal_net_mj =
            estimate_hal_budget(HardwareProfile::VaireAdiabaticSim, 50_000_000, true).net_energy_mj;

        let mut eg = EGraph::new();
        let pier_a = eg.add("pier_a", vec![]);
        let pier_b = eg.add("pier_b", vec![]);
        let route_a = eg.add("corridor_berth", vec![pier_a]);
        let route_b = eg.add("corridor_berth", vec![pier_b]);
        if params.backup_pier_b {
            eg.union(pier_a, pier_b);
            eg.rebuild();
        }
        let egraph_equivalent_route = eg.are_equivalent(route_a, route_b);

        // Wave 6-9.1 remaining 5 kernels + RAIM + Sentinel
        let vjepa_res = self.vjepa.step(
            sample.features,
            if params.backup_pier_b { 0.25 } else { -0.1 },
        );
        let raim = evaluate_raim_spoofing(
            pseudorange_residuals_m,
            if params.storm_drill { 6.0 } else { 1.5 },
        );
        let ukc_m = ukc_override_m.unwrap_or(if params.backup_pier_b { 3.6 } else { 2.4 });
        let wave_m = if params.storm_drill {
            3.9
        } else {
            0.6 + storm_wave * 2.1
        };
        let effective_action = if raim.spoofed {
            MaritimeAction::HoldAndVerifySensors
        } else {
            ai_action
        };
        let cbf = enforce_nagumo_barrier(
            effective_action,
            params.speed_knots,
            ukc_m,
            wave_m,
            CbfConstraints {
                min_ukc_m: 1.5,
                max_wave_m: 3.5,
                in_restricted_zone,
            },
        );
        let topos = solve_topos_coalition([
            OperatorPayoff {
                name: "Seferihisar Port",
                solo_value_keur: 110.0,
                coalition_synergy_keur: if params.backup_pier_b { 42.0 } else { 24.0 },
                risk_exposure: cfc_anomaly * 0.6,
            },
            OperatorPayoff {
                name: "Aegean Ferry",
                solo_value_keur: 145.0,
                coalition_synergy_keur: 38.0,
                risk_exposure: storm_wave * 0.7,
            },
            OperatorPayoff {
                name: "Samos Hub",
                solo_value_keur: 105.0,
                coalition_synergy_keur: 30.0,
                risk_exposure: if params.storm_drill { 0.85 } else { 0.2 },
            },
        ]);
        self.calyx.record(
            1,
            if params.storm_drill { 911 } else { 101 },
            (cfc_anomaly + vjepa_res.surprise_score).clamp(0.1, 1.0),
            params.time_hour,
        );
        let calyx_top_strength = self
            .calyx
            .strongest_association(params.time_hour)
            .map_or(0.0, |(_, _, s)| s);
        let aixitl = select_mdl_hypothesis(
            &[
                HypothesisCandidate {
                    id: 1,
                    description_bits: 16,
                    log_likelihood: -0.4 - cfc_anomaly,
                    expected_utility: if cbf.clamped { 2.5 } else { 8.5 },
                    corroborated_by_sensor: !raim.spoofed,
                    human_approved: params.backup_pier_b,
                },
                HypothesisCandidate {
                    id: 2,
                    description_bits: 36,
                    log_likelihood: -0.9,
                    expected_utility: if params.storm_drill { 9.2 } else { 4.1 },
                    corroborated_by_sensor: true,
                    human_approved: false,
                },
            ],
            0.04,
        )
        .unwrap_or(AixitlSelection {
            id: 1,
            mdl_score: 0.0,
            tag: EpistemicTag::Hypothesis,
        });

        let sentinel_alert = params.storm_drill
            || raim.spoofed
            || cbf.clamped
            || cfc_anomaly > 0.78
            || vjepa_res.surprise_score > 0.72;
        let sentinel_code = if raim.spoofed {
            "RAIM_SPOOF_ALERT"
        } else if in_restricted_zone || ukc_m < 1.5 {
            "CBF_BARRIER_CLAMP"
        } else if params.storm_drill {
            "STORM_PROTOCOL_ACTIVE"
        } else if sentinel_alert {
            "ANOMALY_WATCH"
        } else {
            "NOMINAL_WATCH"
        };

        let feasibility = CorridorFeasibility::evaluate(
            params.corridor,
            params.outlay_keur,
            params.monthly_savings_keur,
        );
        let hub_eval = PortHubEvaluation::evaluate(
            params.backup_pier_b,
            params.speed_knots,
            params.time_hour,
            params.storm_drill,
        );
        let timeline = xtdb_clock_parts(params.time_hour);
        let (vessels, aircraft, satellites, beacons) =
            fixed_fleet_arrays(params.time_hour, params.backup_pier_b);

        let entry = TelemetryLogEntry {
            seq: self.generation,
            time_hour: params.time_hour,
            cfc_anomaly,
            pbit_energy,
            darwin_fitness,
            ai_action: cbf.safe_action,
            delay_minutes: hub_eval.delay_minutes,
            pier_b: params.backup_pier_b,
            storm_drill: params.storm_drill,
        };
        let _ = self.ring.push(entry);

        CoreSnapshot {
            generation: self.generation,
            params,
            cfc_anomaly,
            ai_action,
            ai_efe,
            pbit_energy,
            darwin_fitness,
            hal_net_mj,
            egraph_equivalent_route,
            feasibility,
            hub_eval,
            timeline,
            vessels,
            aircraft,
            satellites,
            beacons,
            ring_len: self.ring.len(),
            ring_capacity: self.ring.capacity(),
            latest_entry: self.ring.latest().copied(),
            vjepa_surprise: vjepa_res.surprise_score,
            cbf_clamped: cbf.clamped,
            cbf_safe_action: cbf.safe_action,
            cbf_max_speed_knots: cbf.max_safe_speed_knots,
            cbf_reason: cbf.reason_code,
            topos_welfare_keur: topos.nash_welfare_keur,
            topos_gini: topos.fairness_gini,
            calyx_top_strength,
            aixitl_best_id: aixitl.id,
            aixitl_tag: aixitl.tag,
            raim_spoofed: raim.spoofed,
            raim_wsse_m2: raim.wsse_m2,
            sentinel_alert,
            sentinel_code,
        }
    }
}

/// Optional UI wakeup hook invoked strictly when a fresh [`CoreSnapshot`] is published.
pub type WakeupCallback = Arc<dyn Fn() + Send + Sync>;

/// Non-blocking handle to the background `caelus_core` decision worker thread.
pub struct HeadlessCoreHandle {
    cmd_tx: Sender<WorkerCommand>,
    snap_rx: Receiver<CoreSnapshot>,
    worker: Option<JoinHandle<()>>,
}

impl HeadlessCoreHandle {
    /// Spawns an independent background decision thread with zero window/GPU dependencies
    /// and immediately enqueues an initial deterministic snapshot.
    #[must_use]
    pub fn spawn(initial: CoreParams, wakeup: Option<WakeupCallback>) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let (snap_tx, snap_rx) = mpsc::channel();

        let snap_tx_fallback = snap_tx.clone();
        let wakeup_fallback = wakeup.clone();
        let worker = match thread::Builder::new()
            .name("caelus-core-worker".to_string())
            .stack_size(256 * 1024)
            .spawn(move || {
                let mut ctx = WorkerEvalContext::new(initial);
                let first = ctx.evaluate_and_record(initial);
                if snap_tx.send(first).is_err() {
                    return;
                }
                if let Some(cb) = &wakeup {
                    cb();
                }

                while let Ok(first_cmd) = cmd_rx.recv() {
                    let mut shutdown = false;
                    let mut pending_params: Option<CoreParams> = None;

                    match first_cmd {
                        WorkerCommand::Shutdown => shutdown = true,
                        WorkerCommand::UpdateParams(p) => pending_params = Some(p),
                        WorkerCommand::TriggerTick => {
                            let mut next = ctx.current_params;
                            next.tick_nonce = next.tick_nonce.wrapping_add(1);
                            pending_params = Some(next);
                        }
                    }

                    // Coalesce burst parameter updates (e.g. rapid XTDB dial drag)
                    // into the newest state without stalling queued work.
                    loop {
                        match cmd_rx.try_recv() {
                            Ok(WorkerCommand::Shutdown) => shutdown = true,
                            Ok(WorkerCommand::UpdateParams(p)) => pending_params = Some(p),
                            Ok(WorkerCommand::TriggerTick) => {
                                let mut base = pending_params.unwrap_or(ctx.current_params);
                                base.tick_nonce = base.tick_nonce.wrapping_add(1);
                                pending_params = Some(base);
                            }
                            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
                        }
                    }

                    if shutdown {
                        break;
                    }

                    if let Some(params) = pending_params {
                        let snap = ctx.evaluate_and_record(params);
                        if snap_tx.send(snap).is_err() {
                            break;
                        }
                        if let Some(cb) = &wakeup {
                            cb();
                        }
                    }
                }
            }) {
            Ok(handle) => Some(handle),
            Err(_) => {
                let mut ctx = WorkerEvalContext::new(initial);
                let _ = snap_tx_fallback.send(ctx.evaluate_and_record(initial));
                if let Some(cb) = &wakeup_fallback {
                    cb();
                }
                None
            }
        };

        Self {
            cmd_tx,
            snap_rx,
            worker,
        }
    }

    /// Computes a deterministic synchronous initial snapshot before the background
    /// thread publishes subsequent updates.
    #[must_use]
    pub fn initial_snapshot(params: CoreParams) -> CoreSnapshot {
        let mut ctx = WorkerEvalContext::new(params);
        ctx.evaluate_and_record(params)
    }

    /// Queues updated simulation parameters for off-thread evaluation.
    pub fn submit_params(&self, params: CoreParams) {
        let _ = self.cmd_tx.send(WorkerCommand::UpdateParams(params));
    }

    /// Triggers one deterministic worker tick without mutating UI controls.
    pub fn trigger_tick(&self) {
        let _ = self.cmd_tx.send(WorkerCommand::TriggerTick);
    }

    /// Non-blocking drain returning the most recent computed [`CoreSnapshot`], if any.
    #[must_use]
    pub fn try_recv(&self) -> Option<CoreSnapshot> {
        let mut latest = None;
        while let Ok(snap) = self.snap_rx.try_recv() {
            latest = Some(snap);
        }
        latest
    }

    /// Waits up to `timeout` for at least one fresh [`CoreSnapshot`] and drains any
    /// immediately following queued snapshots.
    #[must_use]
    pub fn recv_timeout(&self, timeout: Duration) -> Option<CoreSnapshot> {
        let first = self.snap_rx.recv_timeout(timeout).ok()?;
        Some(self.try_recv().unwrap_or(first))
    }
}

impl Drop for HeadlessCoreHandle {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(WorkerCommand::Shutdown);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn worker_coalesces_xtdb_burst_and_fires_wakeup_on_publish() -> Result<(), &'static str> {
        let wakeups = Arc::new(AtomicUsize::new(0));
        let wake_clone = Arc::clone(&wakeups);
        let handle = HeadlessCoreHandle::spawn(
            CoreParams::default(),
            Some(Arc::new(move || {
                wake_clone.fetch_add(1, Ordering::Release);
            })),
        );

        let initial = handle
            .recv_timeout(Duration::from_secs(2))
            .ok_or("worker snapshot timeout")?;
        assert_eq!(initial.generation, 1);
        assert_eq!(initial.ring_len, 1);
        assert_eq!(initial.ring_capacity, RING_BUFFER_CAPACITY);

        for step in 1..=20 {
            handle.submit_params(CoreParams {
                time_hour: f64::from(step),
                backup_pier_b: true,
                ..CoreParams::default()
            });
        }

        let mut latest = initial;
        for _ in 0..40 {
            if let Some(snap) = handle.recv_timeout(Duration::from_millis(250)) {
                latest = snap;
                if (latest.params.time_hour - 20.0).abs() < 1e-6 && latest.params.backup_pier_b {
                    break;
                }
            }
        }

        // Wait briefly for the post-send wakeup callback on the worker thread.
        for _ in 0..40 {
            if wakeups.load(Ordering::Acquire) >= 2 {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }

        assert!((latest.params.time_hour - 20.0).abs() < 1e-6);
        assert!(latest.params.backup_pier_b);
        assert!(latest.hub_eval.delay_minutes < 10);
        assert!(latest.egraph_equivalent_route);
        assert!(wakeups.load(Ordering::Acquire) >= 2);
        Ok(())
    }

    #[test]
    fn worker_ring_buffer_remains_bounded_past_capacity() -> Result<(), &'static str> {
        let handle = HeadlessCoreHandle::spawn(CoreParams::default(), None);
        let _ = handle
            .recv_timeout(Duration::from_secs(2))
            .ok_or("worker snapshot timeout")?;

        let total = RING_BUFFER_CAPACITY + 24;
        for idx in 0..total {
            handle.submit_params(CoreParams {
                tick_nonce: (idx + 1) as u64,
                time_hour: (idx % 72) as f64,
                ..CoreParams::default()
            });
            let _ = handle
                .recv_timeout(Duration::from_secs(2))
                .ok_or("worker snapshot timeout")?;
        }

        handle.trigger_tick();
        let last = handle
            .recv_timeout(Duration::from_secs(2))
            .ok_or("worker snapshot timeout")?;
        assert_eq!(last.ring_capacity, RING_BUFFER_CAPACITY);
        assert_eq!(last.ring_len, RING_BUFFER_CAPACITY);
        assert!(last.generation as usize > total);
        Ok(())
    }

    #[test]
    fn deterministic_replay_produces_bit_identical_snapshots() {
        let p = CoreParams {
            time_hour: 5.0,
            backup_pier_b: true,
            storm_drill: false,
            speed_knots: 14.0,
            ..CoreParams::default()
        };
        let s1 = HeadlessCoreHandle::initial_snapshot(p);
        let s2 = HeadlessCoreHandle::initial_snapshot(p);
        assert_eq!(s1, s2);
    }

    #[test]
    fn chaos_storm_raim_spoofing_and_ukc_violation_trigger_safe_guards() {
        let mut storm_ctx = WorkerEvalContext::new(CoreParams::default());
        let storm_snap = storm_ctx.evaluate_and_record(CoreParams {
            storm_drill: true,
            ..CoreParams::default()
        });
        assert!(storm_snap.sentinel_alert);
        assert_eq!(storm_snap.sentinel_code, "STORM_PROTOCOL_ACTIVE");
        assert_ne!(storm_snap.cbf_safe_action, MaritimeAction::ProceedDirect);

        let mut spoof_ctx = WorkerEvalContext::new(CoreParams::default());
        let spoof_snap = spoof_ctx.evaluate_with_hazards(
            CoreParams::default(),
            None,
            [24.0, -18.0, 14.0, 9.0, -15.0, 12.0],
            false,
        );
        assert!(spoof_snap.raim_spoofed);
        assert!(spoof_snap.sentinel_alert);
        assert_eq!(spoof_snap.sentinel_code, "RAIM_SPOOF_ALERT");
        assert_eq!(
            spoof_snap.cbf_safe_action,
            MaritimeAction::HoldAndVerifySensors
        );

        let mut ukc_ctx = WorkerEvalContext::new(CoreParams::default());
        let ukc_snap = ukc_ctx.evaluate_with_hazards(
            CoreParams {
                speed_knots: 18.0,
                ..CoreParams::default()
            },
            Some(0.75),
            [0.4, -0.3, 0.2, 0.1, -0.2, 0.3],
            false,
        );
        assert!(ukc_snap.cbf_clamped);
        assert!(ukc_snap.sentinel_alert);
        assert!(ukc_snap.cbf_max_speed_knots <= 6.0);
        assert_eq!(
            ukc_snap.cbf_safe_action,
            MaritimeAction::DivertToShelterPort
        );
    }
}
