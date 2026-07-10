//! Versioned, fixed-point neural observation contract.
//!
//! This module mirrors `include/neural_contract.h`.  It deliberately contains
//! no floating-point values and no plugin ABI types.  Neural estimates are
//! separate from authoritative causal-engine state; only the Neural Gate may
//! authorize a bounded proposal.

use alloc::string::String;
use alloc::vec::Vec;

pub const NEURAL_ABI_V1: u32 = 0x0001_0000;
pub const FEATURE_SCHEMA_V1: u32 = 1;
pub const NEURAL_OUTPUT_V1: u32 = 1;
pub const NEURAL_POLICY_V1: u32 = 1;
pub const NN_MANIFEST_V1: u32 = 1;

pub const HISTORY_TICKS_V1: usize = 8;
pub const FEATURE_COUNT_V1: usize = 16;
pub const HIDDEN_DIM_V1: usize = 32;
pub const MAX_NODES_V1: usize = 64;
pub const MAX_EDGES_V1: usize = 256;
pub const MAX_LEVERS_V1: usize = 64;
pub const FP_SCALE: i64 = 1_000_000;
pub const MAX_ABS_TRUST_DELTA_V1: i64 = 50_000;
pub const MAX_ABS_FLOW_V1: i64 = 4 * FP_SCALE;

pub const MISSING_REPORTED_STATE: u32 = 1 << 0;
pub const MISSING_STATE_HISTORY: u32 = 1 << 1;
pub const MISSING_REPORTED_HISTORY: u32 = 1 << 2;
pub const MISSING_FLOW: u32 = 1 << 3;
pub const MISSING_DEADLINE: u32 = 1 << 4;
pub const MISSING_HYSTERESIS: u32 = 1 << 5;
pub const MISSING_INTEL: u32 = 1 << 6;
pub const KNOWN_MISSING_MASK_V1: u32 = MISSING_REPORTED_STATE
    | MISSING_STATE_HISTORY
    | MISSING_REPORTED_HISTORY
    | MISSING_FLOW
    | MISSING_DEADLINE
    | MISSING_HYSTERESIS
    | MISSING_INTEL;

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeStatus {
    Ok = 0,
    ModelUnavailable = 1,
    ModelUntrusted = 2,
    SchemaMismatch = 3,
    MalformedInput = 4,
    UnsupportedOperator = 5,
    DimensionMismatch = 6,
    Overflow = 7,
    Timeout = 8,
    RuntimeFailure = 9,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateDecision {
    AcceptedAdvisory = 0,
    AcceptedBounded = 1,
    RejectedLowConfidence = 2,
    RejectedOod = 3,
    RejectedRange = 4,
    RejectedInvariant = 5,
    RejectedTimeout = 6,
    RejectedModelTrust = 7,
    RejectedSchema = 8,
    RejectedRuntime = 9,
    SymbolicFallback = 10,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalKind {
    TrustDelta = 1,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NeuralMode {
    SymbolicOnly = 0,
    Advisory = 1,
    Assurance = 2,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeInput {
    pub missing_mask: u32,
    pub node_index: u32,
    pub node_kind: u32,
    pub node_id: String,
    pub capacity_fp: i64,
    pub authoritative_state_fp: i64,
    pub reported_state_fp: i64,
    pub trust_fp: i64,
    pub incoming_flow_fp: i64,
    pub outgoing_flow_fp: i64,
    pub queue_utilization_fp: i64,
    pub deadline_distance_fp: i64,
    pub hysteresis_distance_fp: i64,
    pub outage_latched_fp: i64,
    pub intel_risk_fp: i64,
    pub state_history_fp: [i64; HISTORY_TICKS_V1],
    pub reported_history_fp: [i64; HISTORY_TICKS_V1],
}

impl Default for NodeInput {
    fn default() -> Self {
        Self {
            missing_mask: MISSING_STATE_HISTORY
                | MISSING_REPORTED_HISTORY
                | MISSING_FLOW
                | MISSING_DEADLINE
                | MISSING_HYSTERESIS
                | MISSING_INTEL,
            node_index: 0,
            node_kind: 0,
            node_id: String::new(),
            capacity_fp: FP_SCALE,
            authoritative_state_fp: 0,
            reported_state_fp: 0,
            trust_fp: FP_SCALE,
            incoming_flow_fp: 0,
            outgoing_flow_fp: 0,
            queue_utilization_fp: 0,
            deadline_distance_fp: FP_SCALE,
            hysteresis_distance_fp: FP_SCALE,
            outage_latched_fp: 0,
            intel_risk_fp: 0,
            state_history_fp: [0; HISTORY_TICKS_V1],
            reported_history_fp: [0; HISTORY_TICKS_V1],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EdgeInput {
    pub source_index: u32,
    pub destination_index: u32,
    pub active: bool,
    pub delay_ticks: i32,
    pub multiplier_fp: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeverInput {
    pub lever_index: u32,
    pub lever_id: String,
    pub success_probability_fp: i64,
    pub cost_ticks: i32,
    pub remaining_lockout: i32,
    pub available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NeuralInput {
    pub neural_abi_version: u32,
    pub feature_schema_version: u32,
    pub history_length: u32,
    pub tick: u64,
    pub scenario_id: String,
    pub scenario_hash: [u8; 32],
    pub engine_version: String,
    pub missing_value_count: u32,
    pub nodes: Vec<NodeInput>,
    pub edges: Vec<EdgeInput>,
    pub levers: Vec<LeverInput>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeOutput {
    pub node_index: u32,
    pub estimated_true_state_fp: i64,
    pub telemetry_anomaly_score_fp: i64,
    pub confidence_fp: i64,
    pub out_of_distribution_score_fp: i64,
    pub outage_probability_short_fp: i64,
    pub outage_probability_medium_fp: i64,
    pub outage_probability_long_fp: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParameterProposal {
    pub kind: ProposalKind,
    pub node_index: u32,
    pub proposed_delta_fp: i64,
    pub authorized_min_fp: i64,
    pub authorized_max_fp: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LeverScore {
    pub lever_index: u32,
    pub score_fp: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NeuralOutput {
    pub output_schema_version: u32,
    pub runtime_status: RuntimeStatus,
    pub saturation_count: u32,
    pub tick: u64,
    pub feature_schema_version: u32,
    pub model_hash: [u8; 32],
    pub scenario_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub nodes: Vec<NodeOutput>,
    pub proposals: Vec<ParameterProposal>,
    pub lever_scores: Vec<LeverScore>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NeuralPolicy {
    pub policy_version: u32,
    pub mode: NeuralMode,
    pub require_trusted_model: bool,
    pub allow_bounded_trust_adjustment: bool,
    pub max_missing_values: u32,
    pub max_inference_steps: u64,
    pub minimum_confidence_fp: i64,
    pub maximum_ood_fp: i64,
    pub maximum_abs_trust_delta_fp: i64,
}

impl NeuralPolicy {
    pub const fn assurance_default() -> Self {
        Self {
            policy_version: NEURAL_POLICY_V1,
            mode: NeuralMode::Assurance,
            require_trusted_model: true,
            allow_bounded_trust_adjustment: true,
            max_missing_values: 8,
            max_inference_steps: 1_000_000,
            minimum_confidence_fp: 650_000,
            maximum_ood_fp: 300_000,
            maximum_abs_trust_delta_fp: MAX_ABS_TRUST_DELTA_V1,
        }
    }
}

pub fn probability_in_range(value: i64) -> bool {
    (0..=FP_SCALE).contains(&value)
}

fn neural_identifier_valid(value: &str, capacity: usize) -> bool {
    !value.is_empty()
        && value.len() < capacity
        && value
            .as_bytes()
            .iter()
            .all(|byte| (0x21..=0x7e).contains(byte))
}

pub fn node_input_ranges_valid(node: &NodeInput) -> bool {
    (node.missing_mask & !KNOWN_MISSING_MASK_V1) == 0
        && node.node_index < MAX_NODES_V1 as u32
        && node.node_kind <= 5
        && node.capacity_fp > 0
        && (0..=node.capacity_fp).contains(&node.authoritative_state_fp)
        && ((node.missing_mask & MISSING_REPORTED_STATE) != 0
            || (0..=node.capacity_fp).contains(&node.reported_state_fp))
        && probability_in_range(node.trust_fp)
        && probability_in_range(node.queue_utilization_fp)
        && probability_in_range(node.outage_latched_fp)
        && probability_in_range(node.intel_risk_fp)
        && (-MAX_ABS_FLOW_V1..=MAX_ABS_FLOW_V1).contains(&node.incoming_flow_fp)
        && (-MAX_ABS_FLOW_V1..=MAX_ABS_FLOW_V1).contains(&node.outgoing_flow_fp)
        && (-FP_SCALE..=FP_SCALE).contains(&node.deadline_distance_fp)
        && (-FP_SCALE..=FP_SCALE).contains(&node.hysteresis_distance_fp)
        && ((node.missing_mask & MISSING_STATE_HISTORY) != 0
            || node
                .state_history_fp
                .iter()
                .all(|value| (0..=node.capacity_fp).contains(value)))
        && ((node.missing_mask & MISSING_REPORTED_HISTORY) != 0
            || node
                .reported_history_fp
                .iter()
                .all(|value| (0..=node.capacity_fp).contains(value)))
}

pub fn policy_ranges_valid(policy: &NeuralPolicy) -> bool {
    policy.policy_version == NEURAL_POLICY_V1
        && (policy.mode as u32) <= NeuralMode::Assurance as u32
        && policy.max_inference_steps > 0
        && probability_in_range(policy.minimum_confidence_fp)
        && probability_in_range(policy.maximum_ood_fp)
        && (0..=MAX_ABS_TRUST_DELTA_V1).contains(&policy.maximum_abs_trust_delta_fp)
}

pub fn input_ranges_valid(input: &NeuralInput) -> bool {
    if input.neural_abi_version != NEURAL_ABI_V1
        || input.feature_schema_version != FEATURE_SCHEMA_V1
        || input.history_length != HISTORY_TICKS_V1 as u32
        || input.nodes.is_empty()
        || input.nodes.len() > MAX_NODES_V1
        || input.edges.len() > MAX_EDGES_V1
        || input.levers.len() > MAX_LEVERS_V1
        || !neural_identifier_valid(&input.scenario_id, 64)
        || !neural_identifier_valid(&input.engine_version, 32)
    {
        return false;
    }
    if input.nodes.iter().enumerate().any(|(index, node)| {
        node.node_index as usize != index
            || !neural_identifier_valid(&node.node_id, 64)
            || !node_input_ranges_valid(node)
    }) {
        return false;
    }
    let actual_missing_count: u32 = input
        .nodes
        .iter()
        .map(|node| (node.missing_mask & KNOWN_MISSING_MASK_V1).count_ones())
        .sum();
    if input.missing_value_count != actual_missing_count {
        return false;
    }
    if input.edges.iter().any(|edge| {
        edge.source_index as usize >= input.nodes.len()
            || edge.destination_index as usize >= input.nodes.len()
            || edge.delay_ticks < 0
            || edge.delay_ticks > 1_000_000
            || !(0..=MAX_ABS_FLOW_V1).contains(&edge.multiplier_fp)
    }) {
        return false;
    }
    !input.levers.iter().enumerate().any(|(index, lever)| {
        lever.lever_index as usize != index
            || !neural_identifier_valid(&lever.lever_id, 64)
            || !probability_in_range(lever.success_probability_fp)
            || lever.cost_ticks < 0
            || lever.remaining_lockout < 0
    })
}

pub fn output_ranges_valid_with_policy(
    input: &NeuralInput,
    output: &NeuralOutput,
    policy: &NeuralPolicy,
) -> bool {
    if !input_ranges_valid(input)
        || !policy_ranges_valid(policy)
        || output.output_schema_version != NEURAL_OUTPUT_V1
        || output.runtime_status != RuntimeStatus::Ok
        || output.tick != input.tick
        || output.feature_schema_version != input.feature_schema_version
        || output.scenario_hash != input.scenario_hash
        || output.nodes.len() != input.nodes.len()
        || output.nodes.len() > MAX_NODES_V1
        || (!output.proposals.is_empty() && output.proposals.len() != output.nodes.len())
        || (policy.mode != NeuralMode::Assurance && !output.proposals.is_empty())
        || output.lever_scores.len() != input.levers.len()
        || output.lever_scores.len() > MAX_LEVERS_V1
    {
        return false;
    }
    if output.nodes.iter().enumerate().any(|(index, node)| {
        node.node_index as usize != index
            || !(0..=input.nodes[index].capacity_fp).contains(&node.estimated_true_state_fp)
            || !probability_in_range(node.telemetry_anomaly_score_fp)
            || !probability_in_range(node.confidence_fp)
            || !probability_in_range(node.out_of_distribution_score_fp)
            || !probability_in_range(node.outage_probability_short_fp)
            || !probability_in_range(node.outage_probability_medium_fp)
            || !probability_in_range(node.outage_probability_long_fp)
    }) {
        return false;
    }
    let mut seen = [false; MAX_NODES_V1];
    for (proposal_index, proposal) in output.proposals.iter().enumerate() {
        let node_index = proposal.node_index as usize;
        if node_index != proposal_index || seen[node_index] {
            return false;
        }
        seen[node_index] = true;
        let current_trust = input.nodes[node_index].trust_fp;
        let Some(resulting_trust) = current_trust.checked_add(proposal.proposed_delta_fp) else {
            return false;
        };
        let Some(authorized_min_trust) = current_trust.checked_add(proposal.authorized_min_fp)
        else {
            return false;
        };
        let Some(authorized_max_trust) = current_trust.checked_add(proposal.authorized_max_fp)
        else {
            return false;
        };
        let limit = policy.maximum_abs_trust_delta_fp;
        if proposal.kind != ProposalKind::TrustDelta
            || !policy.allow_bounded_trust_adjustment
            || proposal.authorized_min_fp > proposal.authorized_max_fp
            || proposal.proposed_delta_fp < proposal.authorized_min_fp
            || proposal.proposed_delta_fp > proposal.authorized_max_fp
            || proposal.authorized_min_fp < -limit
            || proposal.authorized_max_fp > limit
            || proposal.proposed_delta_fp < -limit
            || proposal.proposed_delta_fp > limit
            || !probability_in_range(authorized_min_trust)
            || !probability_in_range(authorized_max_trust)
            || !probability_in_range(resulting_trust)
        {
            return false;
        }
    }
    !output
        .lever_scores
        .iter()
        .enumerate()
        .any(|(index, score)| {
            score.lever_index as usize != index || !probability_in_range(score.score_fp)
        })
}

pub fn output_ranges_valid(input: &NeuralInput, output: &NeuralOutput) -> bool {
    output_ranges_valid_with_policy(input, output, &NeuralPolicy::assurance_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_input() -> NeuralInput {
        let node = NodeInput {
            node_id: "N".into(),
            missing_mask: 0,
            ..NodeInput::default()
        };
        NeuralInput {
            neural_abi_version: NEURAL_ABI_V1,
            feature_schema_version: FEATURE_SCHEMA_V1,
            history_length: HISTORY_TICKS_V1 as u32,
            tick: 7,
            scenario_id: "TEST".into(),
            scenario_hash: [0; 32],
            engine_version: "2.0".into(),
            missing_value_count: 0,
            nodes: alloc::vec![node],
            edges: Vec::new(),
            levers: Vec::new(),
        }
    }

    #[test]
    fn node_ranges_reject_authoritative_overwrite_shape() {
        let mut input = valid_input();
        assert!(node_input_ranges_valid(&input.nodes[0]));
        input.nodes[0].authoritative_state_fp = input.nodes[0].capacity_fp + 1;
        assert!(!node_input_ranges_valid(&input.nodes[0]));
    }

    #[test]
    fn output_ranges_do_not_implicitly_clamp() {
        let input = valid_input();
        let mut output = NeuralOutput {
            output_schema_version: NEURAL_OUTPUT_V1,
            runtime_status: RuntimeStatus::Ok,
            saturation_count: 0,
            tick: input.tick,
            feature_schema_version: input.feature_schema_version,
            model_hash: [0; 32],
            scenario_hash: input.scenario_hash,
            input_hash: crate::neural_hash::input_hash(&input),
            nodes: alloc::vec![NodeOutput {
                node_index: 0,
                estimated_true_state_fp: 500_000,
                telemetry_anomaly_score_fp: 100_000,
                confidence_fp: 900_000,
                out_of_distribution_score_fp: 50_000,
                outage_probability_short_fp: 100_000,
                outage_probability_medium_fp: 200_000,
                outage_probability_long_fp: 300_000,
            }],
            proposals: Vec::new(),
            lever_scores: Vec::new(),
        };
        assert!(output_ranges_valid(&input, &output));
        output.nodes[0].confidence_fp = FP_SCALE + 1;
        assert!(!output_ranges_valid(&input, &output));
    }

    #[test]
    fn duplicate_or_out_of_range_trust_proposals_are_rejected() {
        let mut input = valid_input();
        input.nodes[0].trust_fp = 980_000;
        let mut second = input.nodes[0].clone();
        second.node_index = 1;
        second.node_id = "N2".into();
        input.nodes.push(second);
        let proposal = ParameterProposal {
            kind: ProposalKind::TrustDelta,
            node_index: 0,
            proposed_delta_fp: -20_000,
            authorized_min_fp: -50_000,
            authorized_max_fp: 20_000,
        };
        let mut output = NeuralOutput {
            output_schema_version: NEURAL_OUTPUT_V1,
            runtime_status: RuntimeStatus::Ok,
            saturation_count: 0,
            tick: input.tick,
            feature_schema_version: input.feature_schema_version,
            model_hash: [0; 32],
            scenario_hash: input.scenario_hash,
            input_hash: crate::neural_hash::input_hash(&input),
            nodes: alloc::vec![
                NodeOutput {
                    node_index: 0,
                    confidence_fp: 900_000,
                    ..NodeOutput::default()
                },
                NodeOutput {
                    node_index: 1,
                    confidence_fp: 900_000,
                    ..NodeOutput::default()
                },
            ],
            proposals: alloc::vec![proposal, proposal],
            lever_scores: Vec::new(),
        };
        assert!(!output_ranges_valid(&input, &output));

        output.proposals[1].node_index = 1;
        output.proposals[0].proposed_delta_fp = 30_000;
        assert!(!output_ranges_valid(&input, &output));

        output.proposals[0].proposed_delta_fp = i64::MIN;
        assert!(!output_ranges_valid(&input, &output));

        output.proposals[0].proposed_delta_fp = -20_000;
        let mut advisory_policy = NeuralPolicy::assurance_default();
        advisory_policy.mode = NeuralMode::Advisory;
        assert!(!output_ranges_valid_with_policy(
            &input,
            &output,
            &advisory_policy
        ));
    }
}
