//! Stable Blake3 commitments for neural inference input and output.
//!
//! Field order exactly mirrors `include/neural_hash.h`; native padding and
//! pointers are never serialized.

use alloc::vec::Vec;

use crate::neural_contract::{NeuralInput, NeuralOutput, NeuralPolicy};

fn append_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn append_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn append_i64(out: &mut Vec<u8>, value: i64) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn append_string(out: &mut Vec<u8>, value: &str) {
    append_u32(out, value.len() as u32);
    out.extend_from_slice(value.as_bytes());
}

pub fn serialize_input(input: &NeuralInput) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"CAELUS_NEURAL_INPUT_V1\0");
    append_u32(&mut bytes, input.neural_abi_version);
    append_u32(&mut bytes, input.feature_schema_version);
    append_u32(&mut bytes, input.history_length);
    append_u64(&mut bytes, input.tick);
    append_string(&mut bytes, &input.scenario_id);
    bytes.extend_from_slice(&input.scenario_hash);
    append_string(&mut bytes, &input.engine_version);
    append_u32(&mut bytes, input.nodes.len() as u32);
    append_u32(&mut bytes, input.edges.len() as u32);
    append_u32(&mut bytes, input.levers.len() as u32);
    append_u32(&mut bytes, input.missing_value_count);
    for node in &input.nodes {
        append_u32(&mut bytes, node.missing_mask);
        append_u32(&mut bytes, node.node_index);
        append_u32(&mut bytes, node.node_kind);
        append_string(&mut bytes, &node.node_id);
        append_i64(&mut bytes, node.capacity_fp);
        append_i64(&mut bytes, node.authoritative_state_fp);
        append_i64(&mut bytes, node.reported_state_fp);
        append_i64(&mut bytes, node.trust_fp);
        append_i64(&mut bytes, node.incoming_flow_fp);
        append_i64(&mut bytes, node.outgoing_flow_fp);
        append_i64(&mut bytes, node.queue_utilization_fp);
        append_i64(&mut bytes, node.deadline_distance_fp);
        append_i64(&mut bytes, node.hysteresis_distance_fp);
        append_i64(&mut bytes, node.outage_latched_fp);
        append_i64(&mut bytes, node.intel_risk_fp);
        for value in node.state_history_fp {
            append_i64(&mut bytes, value);
        }
        for value in node.reported_history_fp {
            append_i64(&mut bytes, value);
        }
    }
    for edge in &input.edges {
        append_u32(&mut bytes, edge.source_index);
        append_u32(&mut bytes, edge.destination_index);
        append_u32(&mut bytes, u32::from(edge.active));
        append_u32(&mut bytes, edge.delay_ticks as u32);
        append_i64(&mut bytes, edge.multiplier_fp);
    }
    for lever in &input.levers {
        append_u32(&mut bytes, lever.lever_index);
        append_string(&mut bytes, &lever.lever_id);
        append_i64(&mut bytes, lever.success_probability_fp);
        append_u32(&mut bytes, lever.cost_ticks as u32);
        append_u32(&mut bytes, lever.remaining_lockout as u32);
        append_u32(&mut bytes, u32::from(lever.available));
    }
    bytes
}

pub fn serialize_output(output: &NeuralOutput) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"CAELUS_NEURAL_OUTPUT_V1\0");
    append_u32(&mut bytes, output.output_schema_version);
    append_u32(&mut bytes, output.runtime_status as u32);
    append_u32(&mut bytes, output.saturation_count);
    append_u64(&mut bytes, output.tick);
    append_u32(&mut bytes, output.feature_schema_version);
    bytes.extend_from_slice(&output.model_hash);
    bytes.extend_from_slice(&output.scenario_hash);
    bytes.extend_from_slice(&output.input_hash);
    append_u32(&mut bytes, output.nodes.len() as u32);
    append_u32(&mut bytes, output.proposals.len() as u32);
    append_u32(&mut bytes, output.lever_scores.len() as u32);
    for node in &output.nodes {
        append_u32(&mut bytes, node.node_index);
        append_i64(&mut bytes, node.estimated_true_state_fp);
        append_i64(&mut bytes, node.telemetry_anomaly_score_fp);
        append_i64(&mut bytes, node.confidence_fp);
        append_i64(&mut bytes, node.out_of_distribution_score_fp);
        append_i64(&mut bytes, node.outage_probability_short_fp);
        append_i64(&mut bytes, node.outage_probability_medium_fp);
        append_i64(&mut bytes, node.outage_probability_long_fp);
    }
    for proposal in &output.proposals {
        append_u32(&mut bytes, proposal.kind as u32);
        append_u32(&mut bytes, proposal.node_index);
        append_i64(&mut bytes, proposal.proposed_delta_fp);
        append_i64(&mut bytes, proposal.authorized_min_fp);
        append_i64(&mut bytes, proposal.authorized_max_fp);
    }
    for score in &output.lever_scores {
        append_u32(&mut bytes, score.lever_index);
        append_i64(&mut bytes, score.score_fp);
    }
    bytes
}

pub fn serialize_policy(policy: &NeuralPolicy) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"CAELUS_NEURAL_POLICY_V1\0");
    append_u32(&mut bytes, policy.policy_version);
    append_u32(&mut bytes, policy.mode as u32);
    append_u32(&mut bytes, u32::from(policy.require_trusted_model));
    append_u32(&mut bytes, u32::from(policy.allow_bounded_trust_adjustment));
    append_u32(&mut bytes, policy.max_missing_values);
    append_u64(&mut bytes, policy.max_inference_steps);
    append_i64(&mut bytes, policy.minimum_confidence_fp);
    append_i64(&mut bytes, policy.maximum_ood_fp);
    append_i64(&mut bytes, policy.maximum_abs_trust_delta_fp);
    bytes
}

pub fn input_hash(input: &NeuralInput) -> [u8; 32] {
    *blake3::hash(&serialize_input(input)).as_bytes()
}

pub fn output_hash(output: &NeuralOutput) -> [u8; 32] {
    *blake3::hash(&serialize_output(output)).as_bytes()
}

pub fn policy_hash(policy: &NeuralPolicy) -> [u8; 32] {
    *blake3::hash(&serialize_policy(policy)).as_bytes()
}
