//! Standalone test-only Rust side of the deterministic neural differential.

extern crate alloc;

#[path = "../../../caelus_core/src/fp.rs"]
pub mod fp;
#[path = "../../../caelus_core/src/neural_contract.rs"]
pub mod neural_contract;
#[path = "../../../caelus_core/src/neural_hash.rs"]
pub mod neural_hash;
#[path = "../../../caelus_core/src/neural_runtime.rs"]
pub mod neural_runtime;

use neural_contract::{
    EdgeInput, LeverInput, NeuralInput, NeuralPolicy, NodeInput, RuntimeStatus, FEATURE_SCHEMA_V1,
    FP_SCALE, HISTORY_TICKS_V1, NEURAL_ABI_V1,
};
use neural_runtime::{
    infer, DeterministicModelV1, BIAS_COUNT_V1, WEIGHTS_HEADER_BYTES_V1, WEIGHT_COUNT_V1,
};

use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::Path;

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_WEIGHTS_BYTES: u64 = 16 * 1024 * 1024;
const WEIGHT_SCALE_DENOMINATOR_V1: u32 = 64;

fn read_bounded_regular(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    let path_metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot stat {}: {error}", path.display()))?;
    if path_metadata.file_type().is_symlink() || !path_metadata.is_file() {
        return Err(format!(
            "{} must be a regular non-symlink file",
            path.display()
        ));
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    let mut file: File = options
        .open(path)
        .map_err(|error| format!("cannot open {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err(format!(
            "{} must contain 1..={maximum} bytes",
            path.display()
        ));
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    if bytes.len() as u64 != metadata.len() || bytes.len() as u64 > maximum {
        return Err(format!("{} changed or exceeded its bound", path.display()));
    }
    Ok(bytes)
}

fn differential_input() -> NeuralInput {
    let mut ghost = NodeInput {
        missing_mask: 0,
        node_index: 0,
        node_kind: 1,
        node_id: "GHOST_INVENTORY".into(),
        capacity_fp: FP_SCALE,
        authoritative_state_fp: 110_000,
        reported_state_fp: 0,
        trust_fp: 730_000,
        queue_utilization_fp: 0,
        deadline_distance_fp: 800_000,
        hysteresis_distance_fp: 900_000,
        intel_risk_fp: 270_000,
        ..NodeInput::default()
    };
    ghost.state_history_fp = [
        90_000, 95_000, 100_000, 102_000, 105_000, 108_000, 109_000, 110_000,
    ];
    ghost.reported_history_fp = [0; HISTORY_TICKS_V1];

    let mut berth = ghost.clone();
    berth.node_index = 1;
    berth.node_kind = 0;
    berth.node_id = "HUB_BERTHS".into();
    berth.authoritative_state_fp = 650_000;
    berth.reported_state_fp = 650_000;
    berth.trust_fp = FP_SCALE;
    berth.queue_utilization_fp = 650_000;
    berth.state_history_fp = [
        620_000, 625_000, 630_000, 635_000, 640_000, 645_000, 648_000, 650_000,
    ];
    berth.reported_history_fp = berth.state_history_fp;

    NeuralInput {
        neural_abi_version: NEURAL_ABI_V1,
        feature_schema_version: FEATURE_SCHEMA_V1,
        history_length: HISTORY_TICKS_V1 as u32,
        tick: 8,
        scenario_id: "BS-01_SAHTE_UFUK".into(),
        scenario_hash: [0x11; 32],
        engine_version: "2.0.0".into(),
        missing_value_count: 0,
        nodes: vec![ghost, berth],
        edges: vec![EdgeInput {
            source_index: 0,
            destination_index: 1,
            active: true,
            delay_ticks: 1,
            multiplier_fp: 1_200_000,
        }],
        levers: vec![LeverInput {
            lever_index: 0,
            lever_id: "L-01".into(),
            success_probability_fp: 750_000,
            cost_ticks: 24,
            remaining_lockout: 0,
            available: true,
        }],
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn output_json(output: &neural_contract::NeuralOutput) -> String {
    let mut text = String::new();
    write!(
        text,
        "{{\"schema_version\":1,\"runtime_status\":{},\"saturation_count\":{},\
         \"tick\":{},\"feature_schema_version\":{},\"model_hash\":\"{}\",\
         \"scenario_hash\":\"{}\",\"input_hash\":\"{}\",\"nodes\":[",
        output.runtime_status as u32,
        output.saturation_count,
        output.tick,
        output.feature_schema_version,
        hex(&output.model_hash),
        hex(&output.scenario_hash),
        hex(&output.input_hash),
    )
    .expect("writing to String cannot fail");
    for (index, node) in output.nodes.iter().enumerate() {
        if index != 0 {
            text.push(',');
        }
        write!(
            text,
            "{{\"node_index\":{},\"estimated_true_state_fp\":{},\
             \"telemetry_anomaly_score_fp\":{},\"confidence_fp\":{},\
             \"out_of_distribution_score_fp\":{},\"outage_probability_short_fp\":{},\
             \"outage_probability_medium_fp\":{},\"outage_probability_long_fp\":{}}}",
            node.node_index,
            node.estimated_true_state_fp,
            node.telemetry_anomaly_score_fp,
            node.confidence_fp,
            node.out_of_distribution_score_fp,
            node.outage_probability_short_fp,
            node.outage_probability_medium_fp,
            node.outage_probability_long_fp,
        )
        .expect("writing to String cannot fail");
    }
    text.push_str("],\"proposals\":[");
    for (index, proposal) in output.proposals.iter().enumerate() {
        if index != 0 {
            text.push(',');
        }
        write!(
            text,
            "{{\"kind\":{},\"node_index\":{},\"proposed_delta_fp\":{},\
             \"authorized_min_fp\":{},\"authorized_max_fp\":{}}}",
            proposal.kind as u32,
            proposal.node_index,
            proposal.proposed_delta_fp,
            proposal.authorized_min_fp,
            proposal.authorized_max_fp,
        )
        .expect("writing to String cannot fail");
    }
    text.push_str("],\"lever_scores\":[");
    for (index, score) in output.lever_scores.iter().enumerate() {
        if index != 0 {
            text.push(',');
        }
        write!(
            text,
            "{{\"lever_index\":{},\"score_fp\":{}}}",
            score.lever_index, score.score_fp
        )
        .expect("writing to String cannot fail");
    }
    text.push_str("]}");
    text
}

fn run() -> Result<(), String> {
    let mut arguments = std::env::args_os();
    let _program = arguments.next();
    let manifest_path = arguments
        .next()
        .ok_or_else(|| "usage: caelus_neural_reference <manifest.json> <weights.bin>".to_owned())?;
    let weights_path = arguments
        .next()
        .ok_or_else(|| "usage: caelus_neural_reference <manifest.json> <weights.bin>".to_owned())?;
    if arguments.next().is_some() {
        return Err("usage: caelus_neural_reference <manifest.json> <weights.bin>".to_owned());
    }

    let manifest = read_bounded_regular(Path::new(&manifest_path), MAX_MANIFEST_BYTES)?;
    let weights = read_bounded_regular(Path::new(&weights_path), MAX_WEIGHTS_BYTES)?;
    let expected_size = WEIGHTS_HEADER_BYTES_V1 + WEIGHT_COUNT_V1 + BIAS_COUNT_V1 * 4;
    if weights.len() != expected_size {
        return Err(format!(
            "weights length mismatch: expected {expected_size}, got {}",
            weights.len()
        ));
    }
    let manifest_hash = *blake3::hash(&manifest).as_bytes();
    let model = DeterministicModelV1::from_test_verified_weights_blob(
        &weights,
        WEIGHT_SCALE_DENOMINATOR_V1,
        manifest_hash,
    )
    .map_err(|status| format!("weights parse failed: {status:?}"))?;
    let input = differential_input();
    let output = infer(&model, &input, &NeuralPolicy::assurance_default());
    if output.runtime_status != RuntimeStatus::Ok {
        return Err(format!(
            "reference inference failed: {:?}",
            output.runtime_status
        ));
    }
    println!("{}", output_json(&output));
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("caelus_neural_reference: {error}");
        std::process::exit(1);
    }
}
