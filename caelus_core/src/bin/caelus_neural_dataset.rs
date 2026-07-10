//! Reproducible synthetic graph-history dataset generator for CAELUS Neural V1.
//!
//! The labels are produced by the deterministic symbolic `CausalEngine`; this
//! binary is training tooling and is never linked into the production host.

use std::env;
use std::fs::OpenOptions;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use caelus_core::neural_contract::{
    NodeInput, MISSING_DEADLINE, MISSING_FLOW, MISSING_HYSTERESIS, MISSING_INTEL,
    MISSING_REPORTED_HISTORY, MISSING_REPORTED_STATE, MISSING_STATE_HISTORY,
};
use caelus_core::neural_runtime::encode_features;
use caelus_core::{
    fp_add_saturating, fp_clamp, fp_div, fp_mul, CausalEngine, DetRng, Edge, FeedbackLoop,
    Hysteresis, Lever, LeverOutcome, Node, NodeKind, FP_ONE,
};

const GENERATOR_VERSION: u32 = 1;
const HISTORY_TICKS: usize = 8;
const FUTURE_HORIZONS: [u32; 3] = [4, 16, 64];
const MAX_SAMPLES: u32 = 4_096;
const CASES: [&str; 22] = [
    "normal",
    "queue_buildup",
    "buffer_saturation",
    "perishable_decay",
    "deadline_pressure",
    "hysteresis_entry",
    "hysteresis_exit",
    "latched_outage",
    "recovery_success",
    "recovery_failure",
    "false_telemetry",
    "delayed_telemetry",
    "missing_telemetry",
    "corrupted_telemetry",
    "trust_degradation",
    "adversarial_reporting",
    "feedback_loop",
    "edge_delay",
    "capacity_degradation",
    "traffic_spike",
    "multiple_failures",
    "saturating_boundary",
];

#[derive(Debug)]
struct Args {
    output: PathBuf,
    manifest: PathBuf,
    samples: u32,
    seed: u64,
    engine_commit: String,
}

fn usage() -> &'static str {
    "Usage: caelus_neural_dataset --output <dataset.jsonl> --manifest <manifest.json> \
     --engine-commit <ascii> [--samples <1..4096>] [--seed <u64|0xhex>]"
}

fn parse_u64(text: &str) -> Result<u64, String> {
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).map_err(|_| format!("invalid hexadecimal u64: {text}"))
    } else {
        text.parse::<u64>()
            .map_err(|_| format!("invalid decimal u64: {text}"))
    }
}

fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut output = None;
    let mut manifest = None;
    let mut samples = 220u32;
    let mut seed = 0xCAE1_05DE_ADBE_EF00u64;
    let mut engine_commit = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--output" => output = args.next().map(PathBuf::from),
            "--manifest" => manifest = args.next().map(PathBuf::from),
            "--samples" => {
                let value = args.next().ok_or("--samples requires a value")?;
                samples = value
                    .parse::<u32>()
                    .map_err(|_| format!("invalid sample count: {value}"))?;
            }
            "--seed" => {
                let value = args.next().ok_or("--seed requires a value")?;
                seed = parse_u64(&value)?;
            }
            "--engine-commit" => {
                engine_commit = Some(args.next().ok_or("--engine-commit requires a value")?);
            }
            "--help" | "-h" => return Err(usage().into()),
            other => return Err(format!("unknown argument: {other}\n{}", usage())),
        }
    }
    if samples == 0 || samples > MAX_SAMPLES {
        return Err(format!("--samples must be in 1..={MAX_SAMPLES}"));
    }
    let engine_commit =
        engine_commit.ok_or_else(|| format!("--engine-commit is required\n{}", usage()))?;
    if engine_commit.len() != 40
        || !engine_commit
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err("--engine-commit must be a 40-character lowercase Git object ID".into());
    }
    let output = output.ok_or_else(|| format!("--output is required\n{}", usage()))?;
    let manifest = manifest.ok_or_else(|| format!("--manifest is required\n{}", usage()))?;
    if output == manifest {
        return Err("dataset and manifest paths must differ".into());
    }
    Ok(Args {
        output,
        manifest,
        samples,
        seed,
        engine_commit,
    })
}

fn sample_range(rng: &mut DetRng, minimum: i64, maximum: i64) -> i64 {
    let width = (maximum - minimum + 1) as u64;
    minimum + (rng.next() % width) as i64
}

fn make_node(id: &str, kind: NodeKind, state_fp: i64, weight_fp: i64, deadline_tick: i32) -> Node {
    Node {
        id: id.into(),
        kind,
        capacity_fp: FP_ONE,
        state_fp,
        weight_fp,
        reported_state_fp: state_fp,
        trust_fp: FP_ONE,
        deadline_tick,
        ..Node::default()
    }
}

fn build_engine(case_name: &str, rollout_seed: u64) -> (CausalEngine, i64) {
    let mut rng = DetRng::new(rollout_seed);
    let mut engine = CausalEngine::new();
    engine.set_prng_seed(rollout_seed);

    let source_state = sample_range(&mut rng, 180_000, 850_000);
    let mut buffer_state = sample_range(&mut rng, 100_000, 700_000);
    let mut queue_state = sample_range(&mut rng, 80_000, 650_000);
    let mut perishable_state = sample_range(&mut rng, 300_000, 900_000);
    let mut gate_state = sample_range(&mut rng, 100_000, 750_000);
    let mut adversary_state = sample_range(&mut rng, 50_000, 800_000);
    let mut deadline = 48i32;

    match case_name {
        "queue_buildup" => queue_state = 900_000,
        "buffer_saturation" => buffer_state = 990_000,
        "perishable_decay" => perishable_state = 280_000,
        "deadline_pressure" | "latched_outage" | "recovery_success" | "recovery_failure" => {
            deadline = 6
        }
        "false_telemetry" | "corrupted_telemetry" | "adversarial_reporting" => gate_state = 900_000,
        "traffic_spike" => {
            queue_state = 980_000;
            buffer_state = 950_000;
        }
        "multiple_failures" => {
            deadline = 7;
            queue_state = 980_000;
            buffer_state = 990_000;
            adversary_state = 950_000;
        }
        "saturating_boundary" => {
            queue_state = 999_999;
            buffer_state = 999_999;
            gate_state = 999_999;
            adversary_state = 999_999;
        }
        _ => {}
    }

    let mut source = make_node("SOURCE", NodeKind::Service, source_state, 120_000, -1);
    let mut buffer = make_node("BUFFER", NodeKind::Buffer, buffer_state, 240_000, -1);
    let queue = make_node("QUEUE", NodeKind::Queue, queue_state, 260_000, -1);
    let perishable = make_node(
        "PERISHABLE",
        NodeKind::Perishable,
        perishable_state,
        180_000,
        deadline,
    );
    let mut gate = make_node("SENSOR_GATE", NodeKind::Gate, gate_state, 140_000, -1);
    let adversary = make_node(
        "ADVERSARY",
        NodeKind::Adversary,
        adversary_state,
        100_000,
        -1,
    );

    if case_name == "capacity_degradation" {
        buffer.capacity_fp = 600_000;
        buffer.state_fp = buffer.state_fp.min(buffer.capacity_fp);
        buffer.reported_state_fp = buffer.state_fp;
    }
    if case_name == "trust_degradation" {
        gate.trust_fp = 180_000;
    }
    if case_name == "adversarial_reporting" {
        source.trust_fp = 250_000;
    }

    for node in [source, buffer, queue, perishable, gate, adversary] {
        engine.add_node(node);
    }

    let delay = if case_name == "edge_delay" { 7 } else { 1 };
    let boundary_multiplier = if case_name == "saturating_boundary" {
        4_000_000
    } else {
        sample_range(&mut rng, 500_000, 1_600_000)
    };
    for edge in [
        Edge {
            from: "SOURCE".into(),
            to: "BUFFER".into(),
            multiplier_fp: boundary_multiplier,
            lag_ticks: 0,
            active: true,
        },
        Edge {
            from: "BUFFER".into(),
            to: "QUEUE".into(),
            multiplier_fp: sample_range(&mut rng, 700_000, 1_400_000),
            lag_ticks: delay,
            active: true,
        },
        Edge {
            from: "QUEUE".into(),
            to: "PERISHABLE".into(),
            multiplier_fp: sample_range(&mut rng, 400_000, 1_100_000),
            lag_ticks: 2,
            active: true,
        },
        Edge {
            from: "ADVERSARY".into(),
            to: "SENSOR_GATE".into(),
            multiplier_fp: sample_range(&mut rng, 300_000, 1_000_000),
            lag_ticks: 0,
            active: true,
        },
        Edge {
            from: "QUEUE".into(),
            to: String::new(),
            multiplier_fp: 300_000,
            lag_ticks: 0,
            active: true,
        },
    ] {
        engine.add_edge(edge);
    }

    if case_name == "feedback_loop" || case_name == "multiple_failures" {
        engine.add_loop(FeedbackLoop {
            id: "SYNTH_LOOP".into(),
            path: vec!["QUEUE".into(), "SENSOR_GATE".into(), "ADVERSARY".into()],
            gain_fp: 1_350_000,
        });
    }

    let (threshold_tick, reversible) = match case_name {
        "hysteresis_entry" | "multiple_failures" => (7, false),
        "hysteresis_exit" => (7, true),
        _ => (80, true),
    };
    engine.add_hysteresis(Hysteresis {
        id: "SYNTH_HYST".into(),
        threshold_tick,
        reversible,
        permanent_loss_fp: 220_000,
        flipped: false,
    });

    let success_probability = if case_name == "recovery_failure" {
        0
    } else if case_name == "recovery_success" {
        FP_ONE
    } else {
        750_000
    };
    engine.add_lever(Lever {
        id: "RECOVER".into(),
        target: "PERISHABLE".into(),
        success_p_fp: success_probability,
        cost_ticks: 4,
        lockout_ticks: 8,
        on_success: LeverOutcome {
            target_node_id: "PERISHABLE".into(),
            state_delta_fp: -250_000,
            trust_delta_fp: 0,
            friction_delta_fp: -100_000,
            clear_irrecoverable: true,
        },
        on_failure: LeverOutcome {
            target_node_id: "PERISHABLE".into(),
            state_delta_fp: 50_000,
            trust_delta_fp: -20_000,
            friction_delta_fp: 20_000,
            clear_irrecoverable: false,
        },
        ..Lever::default()
    });
    engine.add_lever(Lever {
        id: "DIVERT".into(),
        target: "QUEUE".into(),
        success_p_fp: 650_000,
        cost_ticks: 8,
        lockout_ticks: 4,
        on_success: LeverOutcome {
            target_node_id: "QUEUE".into(),
            state_delta_fp: -350_000,
            trust_delta_fp: 0,
            friction_delta_fp: -50_000,
            clear_irrecoverable: false,
        },
        on_failure: LeverOutcome {
            target_node_id: "QUEUE".into(),
            state_delta_fp: 80_000,
            ..LeverOutcome::default()
        },
        ..Lever::default()
    });

    let intel_risk_fp = match case_name {
        "normal" => 100_000,
        "multiple_failures" | "saturating_boundary" => 950_000,
        _ => sample_range(&mut rng, 180_000, 850_000),
    };
    (engine, intel_risk_fp)
}

fn apply_tick_variation(engine: &mut CausalEngine, case_name: &str, step: usize) {
    if case_name == "perishable_decay" {
        if let Some(node) = engine.get_node_mut("PERISHABLE") {
            node.state_fp = fp_clamp(node.state_fp - 25_000, 0, node.capacity_fp);
        }
    }
    if case_name == "queue_buildup" || case_name == "traffic_spike" {
        if let Some(node) = engine.get_node_mut("QUEUE") {
            node.state_fp = fp_clamp(
                fp_add_saturating(node.state_fp, 35_000),
                0,
                node.capacity_fp,
            );
        }
    }
    if case_name == "capacity_degradation" && step == 4 {
        if let Some(node) = engine.get_node_mut("BUFFER") {
            node.capacity_fp = 500_000;
            node.state_fp = node.state_fp.min(node.capacity_fp);
        }
    }
}

fn apply_telemetry_variation(
    engine: &mut CausalEngine,
    case_name: &str,
    delayed_report: &mut Option<i64>,
) {
    match case_name {
        "false_telemetry" => {
            if let Some(node) = engine.get_node_mut("SENSOR_GATE") {
                node.reported_state_fp = node.state_fp / 5;
            }
        }
        "delayed_telemetry" => {
            if let Some(node) = engine.get_node_mut("QUEUE") {
                let previous = delayed_report.unwrap_or(node.reported_state_fp);
                *delayed_report = Some(node.state_fp);
                node.reported_state_fp = previous;
            }
        }
        "corrupted_telemetry" => {
            if let Some(node) = engine.get_node_mut("SENSOR_GATE") {
                node.reported_state_fp = if node.state_fp > 500_000 { 0 } else { FP_ONE };
            }
        }
        "adversarial_reporting" => {
            if let Some(node) = engine.get_node_mut("SOURCE") {
                node.reported_state_fp = node.capacity_fp;
            }
        }
        "trust_degradation" => {
            if let Some(node) = engine.get_node_mut("SENSOR_GATE") {
                node.reported_state_fp = node.state_fp / 2;
                node.trust_fp = fp_clamp(node.trust_fp - 30_000, 0, FP_ONE);
            }
        }
        "multiple_failures" => {
            if let Some(node) = engine.get_node_mut("SENSOR_GATE") {
                node.reported_state_fp = 0;
                node.trust_fp = 100_000;
            }
        }
        _ => {}
    }
}

fn missing_mask(case_name: &str, node_id: &str) -> u32 {
    let mut mask = 0u32;
    if case_name == "missing_telemetry" && (node_id == "QUEUE" || node_id == "SENSOR_GATE") {
        mask |= MISSING_REPORTED_STATE | MISSING_REPORTED_HISTORY;
    }
    if case_name == "multiple_failures" && node_id == "SENSOR_GATE" {
        mask |= MISSING_REPORTED_STATE | MISSING_FLOW | MISSING_INTEL;
    }
    if case_name == "capacity_degradation" && node_id == "BUFFER" {
        // V1 carries one current capacity, so history captured before a
        // capacity change cannot be normalized unambiguously.
        mask |= MISSING_STATE_HISTORY | MISSING_REPORTED_HISTORY;
    }
    mask
}

fn apply_case_step(
    engine: &mut CausalEngine,
    case_name: &str,
    step: usize,
    delayed_report: &mut Option<i64>,
) -> caelus_core::EngineSnapshot {
    apply_tick_variation(engine, case_name, step);
    let snapshot = engine.tick();
    apply_telemetry_variation(engine, case_name, delayed_report);
    snapshot
}

fn future_outage(
    engine: &CausalEngine,
    case_name: &str,
    start_step: usize,
    ticks: u32,
    delayed_report: Option<i64>,
) -> bool {
    let mut future = engine.clone();
    let mut delayed_report = delayed_report;
    for offset in 0..ticks {
        apply_case_step(
            &mut future,
            case_name,
            start_step + offset as usize,
            &mut delayed_report,
        );
    }
    future.is_outage_active()
}

fn time_to_outage(
    engine: &CausalEngine,
    case_name: &str,
    start_step: usize,
    limit: u32,
    delayed_report: Option<i64>,
) -> i32 {
    if engine.is_outage_active() {
        return 0;
    }
    let mut future = engine.clone();
    let mut delayed_report = delayed_report;
    for tick in 1..=limit {
        apply_case_step(
            &mut future,
            case_name,
            start_step + tick as usize - 1,
            &mut delayed_report,
        );
        if future.is_outage_active() {
            return tick as i32;
        }
    }
    -1
}

fn lever_effectiveness(
    engine: &CausalEngine,
    lever_id: &str,
    seed: u64,
    case_name: &str,
    start_step: usize,
    delayed_report: Option<i64>,
) -> i64 {
    let mut baseline = engine.clone();
    let mut candidate = engine.clone();
    let succeeded = candidate.apply_lever(lever_id, seed);
    if !succeeded {
        return 0;
    }
    let mut baseline_delayed_report = delayed_report;
    let mut candidate_delayed_report = delayed_report;
    let mut baseline_snapshot = apply_case_step(
        &mut baseline,
        case_name,
        start_step,
        &mut baseline_delayed_report,
    );
    let mut candidate_snapshot = apply_case_step(
        &mut candidate,
        case_name,
        start_step,
        &mut candidate_delayed_report,
    );
    for offset in 1..16 {
        baseline_snapshot = apply_case_step(
            &mut baseline,
            case_name,
            start_step + offset,
            &mut baseline_delayed_report,
        );
        candidate_snapshot = apply_case_step(
            &mut candidate,
            case_name,
            start_step + offset,
            &mut candidate_delayed_report,
        );
    }
    if baseline_snapshot.outage_active && !candidate_snapshot.outage_active {
        return FP_ONE;
    }
    let friction_gain = fp_clamp(
        baseline_snapshot.clamped_friction_fp - candidate_snapshot.clamped_friction_fp,
        0,
        FP_ONE,
    );
    let throughput_gain = fp_clamp(
        candidate_snapshot.throughput_ratio_fp - baseline_snapshot.throughput_ratio_fp,
        0,
        FP_ONE,
    );
    fp_clamp(300_000 + friction_gain / 2 + throughput_gain / 2, 0, FP_ONE)
}

fn fixed_history(values: &[i64]) -> [i64; HISTORY_TICKS] {
    let mut history = [0i64; HISTORY_TICKS];
    history.copy_from_slice(&values[values.len() - HISTORY_TICKS..]);
    history
}

fn build_node_input(
    engine: &CausalEngine,
    node_index: usize,
    state_history: &[Vec<i64>],
    reported_history: &[Vec<i64>],
    intel_risk_fp: i64,
    case_name: &str,
) -> NodeInput {
    let node = &engine.nodes()[node_index];
    let mut incoming_flow_fp = 0i64;
    let mut outgoing_flow_fp = 0i64;
    for edge in engine.edges() {
        if !edge.active || edge.to.is_empty() {
            continue;
        }
        let Some(source_index) = engine.nodes().iter().position(|item| item.id == edge.from) else {
            continue;
        };
        let Some(destination_index) = engine.nodes().iter().position(|item| item.id == edge.to)
        else {
            continue;
        };
        let source = &engine.nodes()[source_index];
        if missing_mask(case_name, &source.id) & MISSING_REPORTED_STATE != 0 {
            continue;
        }
        // Deployment uses the same telemetry-derived flow convention. Hidden
        // symbolic state is retained only as the supervised label and gate
        // evidence; it is never copied into observer features.
        let source_ratio = fp_div(source.reported_state_fp, source.capacity_fp);
        let contribution = fp_mul(fp_mul(source_ratio, edge.multiplier_fp), 50_000);
        if destination_index == node_index {
            incoming_flow_fp = fp_add_saturating(incoming_flow_fp, contribution);
        }
        if source_index == node_index {
            outgoing_flow_fp = fp_add_saturating(outgoing_flow_fp, contribution);
        }
    }

    let mut mask = missing_mask(case_name, &node.id);
    let deadline_distance_fp = if node.deadline_tick >= 0 {
        fp_clamp(
            fp_div(
                (i64::from(node.deadline_tick) - engine.current_tick() as i64) * FP_ONE,
                64 * FP_ONE,
            ),
            -FP_ONE,
            FP_ONE,
        )
    } else {
        mask |= MISSING_DEADLINE;
        0
    };
    let hysteresis_distance_fp = if let Some(hysteresis) = engine.hysteresis_list().first() {
        fp_clamp(
            fp_div(
                (i64::from(hysteresis.threshold_tick) - engine.current_tick() as i64) * FP_ONE,
                64 * FP_ONE,
            ),
            -FP_ONE,
            FP_ONE,
        )
    } else {
        mask |= MISSING_HYSTERESIS;
        0
    };
    if intel_risk_fp < 0 {
        mask |= MISSING_INTEL;
    }
    if mask & MISSING_FLOW != 0 {
        incoming_flow_fp = 0;
        outgoing_flow_fp = 0;
    }

    NodeInput {
        missing_mask: mask,
        node_index: node_index as u32,
        node_kind: node.kind as u32,
        node_id: node.id.clone(),
        capacity_fp: node.capacity_fp,
        authoritative_state_fp: node.state_fp,
        reported_state_fp: node.reported_state_fp,
        trust_fp: node.trust_fp,
        incoming_flow_fp: fp_clamp(incoming_flow_fp, -4 * FP_ONE, 4 * FP_ONE),
        outgoing_flow_fp: fp_clamp(outgoing_flow_fp, -4 * FP_ONE, 4 * FP_ONE),
        queue_utilization_fp: if mask & MISSING_REPORTED_STATE != 0 {
            0
        } else {
            fp_clamp(fp_div(node.reported_state_fp, node.capacity_fp), 0, FP_ONE)
        },
        deadline_distance_fp,
        hysteresis_distance_fp,
        outage_latched_fp: if engine.is_outage_active() { FP_ONE } else { 0 },
        intel_risk_fp: fp_clamp(intel_risk_fp, 0, FP_ONE),
        state_history_fp: fixed_history(&state_history[node_index]),
        reported_history_fp: fixed_history(&reported_history[node_index]),
    }
}

fn push_i64_array(out: &mut String, values: &[i64]) {
    out.push('[');
    for (index, value) in values.iter().enumerate() {
        if index != 0 {
            out.push(',');
        }
        out.push_str(&value.to_string());
    }
    out.push(']');
}

fn split_for_rollout(rollout_id: u32) -> &'static str {
    match rollout_id % 10 {
        0 => "test",
        1 => "validation",
        _ => "train",
    }
}

fn case_for_rollout(rollout_id: u32) -> &'static str {
    // Split lanes advance independently through every case. This avoids the
    // modulo-10 split being correlated with the modulo-22 case catalogue.
    let split_lane = rollout_id % 10;
    let split_cycle = rollout_id / 10;
    CASES[((split_cycle + split_lane * 7) as usize) % CASES.len()]
}

fn sample_json(rollout_id: u32, base_seed: u64) -> String {
    let case_name = case_for_rollout(rollout_id);
    let rollout_seed =
        base_seed.wrapping_add(u64::from(rollout_id).wrapping_mul(0x9e37_79b9_7f4a_7c15));
    let (mut engine, intel_risk_fp) = build_engine(case_name, rollout_seed);
    let node_count = engine.nodes().len();
    let mut state_history = vec![Vec::with_capacity(HISTORY_TICKS); node_count];
    let mut reported_history = vec![Vec::with_capacity(HISTORY_TICKS); node_count];
    let mut delayed_report = None;

    for step in 0..HISTORY_TICKS {
        apply_case_step(&mut engine, case_name, step, &mut delayed_report);
        if (case_name == "recovery_success" || case_name == "recovery_failure") && step == 6 {
            let _ = engine.apply_lever("RECOVER", rollout_seed.wrapping_add(step as u64));
        }
        for (index, node) in engine.nodes().iter().enumerate() {
            state_history[index].push(node.state_fp);
            reported_history[index].push(node.reported_state_fp);
        }
    }

    let node_inputs: Vec<NodeInput> = (0..node_count)
        .map(|index| {
            build_node_input(
                &engine,
                index,
                &state_history,
                &reported_history,
                intel_risk_fp,
                case_name,
            )
        })
        .collect();
    let future_labels = FUTURE_HORIZONS.map(|ticks| {
        if future_outage(&engine, case_name, HISTORY_TICKS, ticks, delayed_report) {
            FP_ONE
        } else {
            0
        }
    });
    let outage_ticks = time_to_outage(
        &engine,
        case_name,
        HISTORY_TICKS,
        FUTURE_HORIZONS[2],
        delayed_report,
    );

    let mut scenario_hasher = blake3::Hasher::new();
    scenario_hasher.update(b"CAELUS_SYNTHETIC_SCENARIO_V1\0");
    scenario_hasher.update(case_name.as_bytes());
    scenario_hasher.update(&rollout_seed.to_le_bytes());
    let scenario_hash = scenario_hasher.finalize().to_hex().to_string();

    let mut out = String::with_capacity(8_192);
    out.push_str("{\"schema_version\":1,\"rollout_id\":");
    out.push_str(&rollout_id.to_string());
    out.push_str(",\"split\":\"");
    out.push_str(split_for_rollout(rollout_id));
    out.push_str("\",\"case\":\"");
    out.push_str(case_name);
    out.push_str("\",\"seed\":");
    out.push_str(&rollout_seed.to_string());
    out.push_str(",\"tick\":");
    out.push_str(&engine.current_tick().to_string());
    out.push_str(",\"scenario_id\":\"SYNTH_V1_");
    out.push_str(&format!("{rollout_id:04}"));
    out.push_str("\",\"scenario_hash\":\"");
    out.push_str(&scenario_hash);
    out.push_str("\",\"nodes\":[");

    for (node_index, input) in node_inputs.iter().enumerate() {
        if node_index != 0 {
            out.push(',');
        }
        let node = &engine.nodes()[node_index];
        let features = encode_features(input);
        let absolute_error = (node.state_fp - node.reported_state_fp).abs();
        let anomaly_fp = fp_clamp(fp_div(absolute_error, node.capacity_fp), 0, FP_ONE);
        let missing_count = input.missing_mask.count_ones() as i64;
        // These three heads are deterministic policy-training targets, not
        // measurements emitted by the symbolic engine. Their names and the
        // dataset manifest make that distinction explicit.
        let confidence_policy_target_fp = fp_clamp(
            950_000
                - missing_count * 120_000
                - if case_name == "saturating_boundary" {
                    250_000
                } else {
                    0
                },
            100_000,
            FP_ONE,
        );
        let ood_policy_target_fp = if case_name == "saturating_boundary" {
            900_000
        } else if case_name == "multiple_failures" || case_name == "adversarial_reporting" {
            600_000
        } else {
            100_000 + missing_count * 100_000
        };
        let trust_delta_policy_target_fp = if anomaly_fp > 100_000 {
            -fp_clamp(anomaly_fp / 4, 0, 50_000)
        } else {
            fp_clamp((100_000 - anomaly_fp) / 5, 0, 20_000)
        };
        let mut driver_indices: Vec<usize> = (0..features.len()).collect();
        driver_indices.sort_by(|left, right| {
            features[*right]
                .abs()
                .cmp(&features[*left].abs())
                .then_with(|| left.cmp(right))
        });

        out.push_str("{\"node_index\":");
        out.push_str(&node_index.to_string());
        out.push_str(",\"node_id\":\"");
        out.push_str(&node.id);
        out.push_str("\",\"node_kind\":");
        out.push_str(&(node.kind as u32).to_string());
        out.push_str(",\"capacity_fp\":");
        out.push_str(&node.capacity_fp.to_string());
        out.push_str(",\"authoritative_state_fp\":");
        out.push_str(&node.state_fp.to_string());
        out.push_str(",\"reported_state_fp\":");
        out.push_str(&node.reported_state_fp.to_string());
        out.push_str(",\"trust_fp\":");
        out.push_str(&node.trust_fp.to_string());
        out.push_str(",\"missing_mask\":");
        out.push_str(&input.missing_mask.to_string());
        out.push_str(",\"incoming_flow_fp\":");
        out.push_str(&input.incoming_flow_fp.to_string());
        out.push_str(",\"outgoing_flow_fp\":");
        out.push_str(&input.outgoing_flow_fp.to_string());
        out.push_str(",\"queue_utilization_fp\":");
        out.push_str(&input.queue_utilization_fp.to_string());
        out.push_str(",\"deadline_distance_fp\":");
        out.push_str(&input.deadline_distance_fp.to_string());
        out.push_str(",\"hysteresis_distance_fp\":");
        out.push_str(&input.hysteresis_distance_fp.to_string());
        out.push_str(",\"outage_latched_fp\":");
        out.push_str(&input.outage_latched_fp.to_string());
        out.push_str(",\"intel_risk_fp\":");
        out.push_str(&input.intel_risk_fp.to_string());
        out.push_str(",\"state_history_fp\":");
        push_i64_array(&mut out, &input.state_history_fp);
        out.push_str(",\"reported_history_fp\":");
        push_i64_array(&mut out, &input.reported_history_fp);
        out.push_str(",\"features_fp\":");
        push_i64_array(&mut out, &features);
        out.push_str(",\"labels\":{\"true_state_fp\":");
        out.push_str(&node.state_fp.to_string());
        out.push_str(",\"true_state_ratio_fp\":");
        out.push_str(&fp_clamp(fp_div(node.state_fp, node.capacity_fp), 0, FP_ONE).to_string());
        out.push_str(",\"telemetry_anomaly_fp\":");
        out.push_str(&anomaly_fp.to_string());
        out.push_str(",\"confidence_policy_target_fp\":");
        out.push_str(&confidence_policy_target_fp.to_string());
        out.push_str(",\"ood_policy_target_fp\":");
        out.push_str(&ood_policy_target_fp.to_string());
        out.push_str(",\"trust_delta_policy_target_fp\":");
        out.push_str(&trust_delta_policy_target_fp.to_string());
        out.push_str("},\"salient_feature_indices_by_magnitude\":[");
        for (position, index) in driver_indices.iter().take(3).enumerate() {
            if position != 0 {
                out.push(',');
            }
            out.push_str(&index.to_string());
        }
        out.push_str("]}");
    }

    out.push_str("],\"edges\":[");
    let mut emitted_edge = 0usize;
    for edge in engine.edges() {
        if edge.to.is_empty() {
            continue;
        }
        let Some(source_index) = engine.nodes().iter().position(|node| node.id == edge.from) else {
            continue;
        };
        let Some(destination_index) = engine.nodes().iter().position(|node| node.id == edge.to)
        else {
            continue;
        };
        if emitted_edge != 0 {
            out.push(',');
        }
        emitted_edge += 1;
        out.push_str("{\"source_index\":");
        out.push_str(&source_index.to_string());
        out.push_str(",\"destination_index\":");
        out.push_str(&destination_index.to_string());
        out.push_str(",\"delay_ticks\":");
        out.push_str(&edge.lag_ticks.to_string());
        out.push_str(",\"multiplier_fp\":");
        out.push_str(&edge.multiplier_fp.to_string());
        out.push_str(",\"active\":");
        out.push_str(if edge.active { "1}" } else { "0}" });
    }
    out.push_str("],\"levers\":[");
    for (lever_index, lever) in engine.levers_list().iter().enumerate() {
        if lever_index != 0 {
            out.push(',');
        }
        let effectiveness = lever_effectiveness(
            &engine,
            &lever.id,
            rollout_seed.wrapping_add(lever_index as u64),
            case_name,
            HISTORY_TICKS,
            delayed_report,
        );
        out.push_str("{\"lever_index\":");
        out.push_str(&lever_index.to_string());
        out.push_str(",\"lever_id\":\"");
        out.push_str(&lever.id);
        out.push_str("\",\"success_probability_fp\":");
        out.push_str(&lever.success_p_fp.to_string());
        out.push_str(",\"cost_ticks\":");
        out.push_str(&lever.cost_ticks.to_string());
        out.push_str(",\"remaining_lockout\":");
        out.push_str(&lever.remaining_lockout.to_string());
        out.push_str(",\"available\":");
        out.push_str(if lever.available { "1" } else { "0" });
        out.push_str(",\"effectiveness_fp\":");
        out.push_str(&effectiveness.to_string());
        out.push('}');
    }
    out.push_str("],\"outage_horizons_fp\":");
    push_i64_array(&mut out, &future_labels);
    out.push_str(",\"time_to_outage_ticks\":");
    out.push_str(&outage_ticks.to_string());
    out.push('}');
    out
}

fn run(args: Args) -> Result<(), String> {
    let dataset_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args.output)
        .map_err(|error| {
            format!(
                "cannot create dataset {} (refusing overwrite): {error}",
                args.output.display()
            )
        })?;
    let mut writer = BufWriter::new(dataset_file);
    let mut dataset_hasher = blake3::Hasher::new();
    let mut dataset_size = 0u64;
    for rollout_id in 0..args.samples {
        let line = sample_json(rollout_id, args.seed);
        dataset_hasher.update(line.as_bytes());
        dataset_hasher.update(b"\n");
        writer
            .write_all(line.as_bytes())
            .and_then(|_| writer.write_all(b"\n"))
            .map_err(|error| format!("cannot write dataset: {error}"))?;
        dataset_size += line.len() as u64 + 1;
    }
    writer
        .flush()
        .map_err(|error| format!("cannot flush dataset: {error}"))?;
    let dataset_hash = dataset_hasher.finalize().to_hex().to_string();

    let manifest_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args.manifest)
        .map_err(|error| {
            format!(
                "cannot create manifest {} (refusing overwrite): {error}",
                args.manifest.display()
            )
        })?;
    let mut manifest_writer = BufWriter::new(manifest_file);
    let case_json = CASES
        .iter()
        .map(|name| format!("\"{name}\""))
        .collect::<Vec<_>>()
        .join(",");
    let build_profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let manifest = format!(
        "{{\"schema_version\":1,\"generator\":\"caelus_neural_dataset\",\
         \"generator_version\":{GENERATOR_VERSION},\"engine\":\"caelus_core::CausalEngine\",\
         \"engine_commit\":\"{}\",\"build_profile\":\"{}\",\
         \"rng\":\"xoshiro256**-splitmix64\",\
         \"seed\":{},\"sample_count\":{},\"feature_schema_version\":1,\
         \"history_ticks\":{},\"split_policy\":\"rollout_id_mod_10:test=0,validation=1,train=2..9\",\
         \"observer_feature_policy\":\"telemetry_only_authority_withheld_v1\",\
         \"label_sources\":{{\"true_state\":\"symbolic_engine\",\
         \"telemetry_anomaly\":\"symbolic_state_vs_reported_telemetry\",\
         \"future_outage\":\"dynamic_symbolic_counterfactual\",\
         \"lever_effectiveness\":\"synthetic_dynamic_counterfactual_score\",\
         \"confidence_ood_trust\":\"deterministic_synthetic_policy_targets\",\
         \"salience\":\"feature_magnitude_not_causal_attribution\"}},\
         \"parameter_ranges\":{{\"state_fp\":[0,1000000],\"edge_multiplier_fp\":[0,4000000],\
         \"delay_ticks\":[0,7],\"future_horizons\":[4,16,64]}},\
         \"cases\":[{}],\"dataset_blake3\":\"{}\",\"dataset_bytes\":{}}}\n",
        args.engine_commit,
        build_profile,
        args.seed,
        args.samples,
        HISTORY_TICKS,
        case_json,
        dataset_hash,
        dataset_size
    );
    manifest_writer
        .write_all(manifest.as_bytes())
        .and_then(|_| manifest_writer.flush())
        .map_err(|error| format!("cannot write dataset manifest: {error}"))?;
    eprintln!(
        "generated {} samples: dataset={} blake3={} manifest={}",
        args.samples,
        args.output.display(),
        dataset_hash,
        args.manifest.display()
    );
    Ok(())
}

fn main() {
    match parse_args(env::args().skip(1)).and_then(run) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_and_rollout_produce_identical_example() {
        assert_eq!(sample_json(3, 7), sample_json(3, 7));
        assert_ne!(sample_json(3, 7), sample_json(3, 8));
    }

    #[test]
    fn each_split_lane_cycles_through_every_case() {
        for lane in 0..10 {
            let mut seen = [false; CASES.len()];
            for cycle in 0..CASES.len() as u32 {
                let name = case_for_rollout(cycle * 10 + lane);
                let index = CASES
                    .iter()
                    .position(|candidate| *candidate == name)
                    .unwrap();
                seen[index] = true;
            }
            assert!(seen.iter().all(|value| *value));
        }
    }

    #[test]
    fn generated_example_contains_symbolic_labels_and_graph_history() {
        let example = sample_json(0, 9);
        assert!(example.contains("\"features_fp\":["));
        assert!(example.contains("\"true_state_fp\":"));
        assert!(example.contains("\"outage_horizons_fp\":"));
        assert!(example.contains("\"effectiveness_fp\":"));
        assert!(example.contains("\"time_to_outage_ticks\":"));
        assert!(example.contains("\"confidence_policy_target_fp\":"));
        assert!(example.contains("\"salient_feature_indices_by_magnitude\":"));
    }

    #[test]
    fn observer_features_do_not_expose_authoritative_state_or_history() {
        let (mut engine, intel_risk_fp) = build_engine("false_telemetry", 17);
        let mut state_history = vec![Vec::new(); engine.nodes().len()];
        let mut reported_history = vec![Vec::new(); engine.nodes().len()];
        let mut delayed_report = None;
        for step in 0..HISTORY_TICKS {
            apply_case_step(&mut engine, "false_telemetry", step, &mut delayed_report);
            for (index, node) in engine.nodes().iter().enumerate() {
                state_history[index].push(node.state_fp);
                reported_history[index].push(node.reported_state_fp);
            }
        }
        let input = build_node_input(
            &engine,
            4,
            &state_history,
            &reported_history,
            intel_risk_fp,
            "false_telemetry",
        );
        let expected = encode_features(&input);
        let mut changed_authority = input.clone();
        changed_authority.authoritative_state_fp = 0;
        changed_authority.state_history_fp = [0; HISTORY_TICKS];
        assert_eq!(expected, encode_features(&changed_authority));
    }
}
