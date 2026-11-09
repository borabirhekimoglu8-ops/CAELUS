//! Deterministic INT8/INT64 neural assurance runtime.
//!
//! This is the independent Rust reference for `include/neural_runtime.h`.
//! It supports only the V1 temporal message-passing operator graph and rejects
//! every other shape.  The forward path has no floating-point operations.

use alloc::vec;
use alloc::vec::Vec;

use crate::fp::{fp_clamp, fp_div, fp_mul};
use crate::neural_contract::{
    input_ranges_valid, output_ranges_valid_with_policy, EdgeInput, LeverScore, NeuralInput,
    NeuralMode, NeuralOutput, NeuralPolicy, NodeInput, NodeOutput, ParameterProposal, ProposalKind,
    RuntimeStatus, FEATURE_COUNT_V1, FP_SCALE, HIDDEN_DIM_V1, HISTORY_TICKS_V1,
    KNOWN_MISSING_MASK_V1, MAX_NODES_V1, MISSING_DEADLINE, MISSING_FLOW, MISSING_HYSTERESIS,
    MISSING_INTEL, MISSING_REPORTED_HISTORY, MISSING_REPORTED_STATE, NEURAL_OUTPUT_V1,
};

pub const WEIGHTS_HEADER_BYTES_V1: usize = 48;
pub const WEIGHT_COUNT_V1: usize = 4_899;
pub const BIAS_COUNT_V1: usize = 105;
pub const WEIGHTS_FORMAT_VERSION_V1: u32 = 1;
pub const WEIGHTS_ENDIAN_MARKER_V1: u32 = 0x0102_0304;

const W_INPUT: usize = 0;
const W_MESSAGE0_SELF: usize = 512;
const W_MESSAGE0_NEIGHBOR: usize = 1_536;
const W_MESSAGE1_SELF: usize = 2_560;
const W_MESSAGE1_NEIGHBOR: usize = 3_584;
const W_NODE_HEADS: usize = 4_608;
const W_OUTAGE_HEADS: usize = 4_768;
const W_LEVER_HEAD: usize = 4_864;

const B_INPUT: usize = 0;
const B_MESSAGE0: usize = 32;
const B_MESSAGE1: usize = 64;
const B_NODE_HEADS: usize = 96;
const B_OUTAGE_HEADS: usize = 101;
const B_LEVER_HEAD: usize = 104;

const _: () = assert!(W_LEVER_HEAD + 35 == WEIGHT_COUNT_V1);
const _: () = assert!(B_LEVER_HEAD + 1 == BIAS_COUNT_V1);

pub fn neural_package_hash(manifest_hash: &[u8; 32], weights_hash: &[u8; 32]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"CAELUS_NEURAL_PACKAGE_ID_V1\0");
    hasher.update(manifest_hash);
    hasher.update(weights_hash);
    *hasher.finalize().as_bytes()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeterministicModelV1 {
    weight_scale_denominator: u32,
    weights: Vec<i8>,
    biases: [i32; BIAS_COUNT_V1],
    model_hash: [u8; 32],
    trusted: bool,
}

impl DeterministicModelV1 {
    fn parse_weights_blob(
        blob: &[u8],
        weight_scale_denominator: u32,
        trusted: bool,
        verified_manifest_hash: Option<[u8; 32]>,
    ) -> Result<Self, RuntimeStatus> {
        if weight_scale_denominator == 0
            || blob.len() != WEIGHTS_HEADER_BYTES_V1 + WEIGHT_COUNT_V1 + BIAS_COUNT_V1 * 4
            || &blob[..8] != b"CAELNN1\0"
            || read_u32_le(&blob[8..12]) != WEIGHTS_FORMAT_VERSION_V1
            || read_u32_le(&blob[12..16]) != WEIGHTS_ENDIAN_MARKER_V1
            || read_u32_le(&blob[16..20]) as usize != FEATURE_COUNT_V1
            || read_u32_le(&blob[20..24]) as usize != HIDDEN_DIM_V1
            || read_u32_le(&blob[24..28]) != 2
            || read_u32_le(&blob[28..32]) as usize != WEIGHT_COUNT_V1
            || read_u32_le(&blob[32..36]) as usize != BIAS_COUNT_V1
            || read_u32_le(&blob[36..40]) != 0
            || read_u64_le(&blob[40..48]) != (WEIGHT_COUNT_V1 + BIAS_COUNT_V1 * 4) as u64
        {
            return Err(RuntimeStatus::DimensionMismatch);
        }
        let weights = blob[WEIGHTS_HEADER_BYTES_V1..WEIGHTS_HEADER_BYTES_V1 + WEIGHT_COUNT_V1]
            .iter()
            .map(|byte| *byte as i8)
            .collect();
        let mut biases = [0i32; BIAS_COUNT_V1];
        let bias_bytes = &blob[WEIGHTS_HEADER_BYTES_V1 + WEIGHT_COUNT_V1..];
        for (index, bias) in biases.iter_mut().enumerate() {
            let offset = index * 4;
            *bias = i32::from_le_bytes(
                bias_bytes[offset..offset + 4]
                    .try_into()
                    .map_err(|_| RuntimeStatus::DimensionMismatch)?,
            );
        }
        let weights_hash = *blake3::hash(blob).as_bytes();
        let model_hash = verified_manifest_hash
            .map(|manifest_hash| neural_package_hash(&manifest_hash, &weights_hash))
            .unwrap_or(weights_hash);
        Ok(Self {
            weight_scale_denominator,
            weights,
            biases,
            model_hash,
            trusted,
        })
    }

    /// Parse model bytes without asserting package trust.  Such a model cannot
    /// run under the default assurance policy.
    pub fn from_weights_blob(
        blob: &[u8],
        weight_scale_denominator: u32,
    ) -> Result<Self, RuntimeStatus> {
        Self::parse_weights_blob(blob, weight_scale_denominator, false, None)
    }

    /// Test-only construction after fixture manifest/hash checks. The custom
    /// cfg is emitted only by `tests/neural_reference`; normal Cargo features
    /// and production builds cannot enable this crate-private constructor.
    #[cfg(any(test, caelus_neural_differential_harness))]
    pub(crate) fn from_test_verified_weights_blob(
        blob: &[u8],
        weight_scale_denominator: u32,
        manifest_hash: [u8; 32],
    ) -> Result<Self, RuntimeStatus> {
        Self::parse_weights_blob(blob, weight_scale_denominator, true, Some(manifest_hash))
    }

    pub fn trusted(&self) -> bool {
        self.trusted
    }

    pub fn model_hash(&self) -> &[u8; 32] {
        &self.model_hash
    }
}

fn read_u32_le(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().unwrap_or([0; 4]))
}

fn read_u64_le(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().unwrap_or([0; 8]))
}

fn increment_saturation(saturations: &mut u32) {
    *saturations = saturations.saturating_add(1);
}

fn sat_add_i64(a: i64, b: i64, saturations: &mut u32) -> i64 {
    match a.checked_add(b) {
        Some(value) => value,
        None => {
            increment_saturation(saturations);
            if b >= 0 {
                i64::MAX
            } else {
                i64::MIN
            }
        }
    }
}

fn clamp_activation(value: i64, lo: i64, hi: i64, saturations: &mut u32) -> i64 {
    if value < lo {
        increment_saturation(saturations);
        lo
    } else if value > hi {
        increment_saturation(saturations);
        hi
    } else {
        value
    }
}

fn hard_sigmoid_fp(value: i64, saturations: &mut u32) -> i64 {
    let shifted = sat_add_i64(value, FP_SCALE, saturations);
    clamp_activation(shifted / 2, 0, FP_SCALE, saturations)
}

fn fp_ratio(value: i64, capacity: i64) -> i64 {
    if capacity <= 0 {
        0
    } else {
        fp_clamp(fp_div(value, capacity), -FP_SCALE, FP_SCALE)
    }
}

fn saturating_sub_i64(lhs: i64, rhs: i64) -> i64 {
    lhs.checked_sub(rhs)
        .unwrap_or_else(|| if rhs >= 0 { i64::MIN } else { i64::MAX })
}

fn bit_count_u32(mut value: u32) -> u32 {
    let mut count = 0;
    while value != 0 {
        count += value & 1;
        value >>= 1;
    }
    count
}

pub type FeatureVector = [i64; FEATURE_COUNT_V1];
type HiddenVector = [i64; HIDDEN_DIM_V1];
type HiddenMatrix = Vec<HiddenVector>;

pub fn encode_features(node: &NodeInput) -> FeatureVector {
    let mut feature = [0i64; FEATURE_COUNT_V1];
    // Authoritative state and history remain in the committed input so the
    // gate can validate proposals and audits can reconstruct the decision.
    // They are deliberately withheld from FEATURE_SCHEMA_V1: otherwise the
    // observer's true-state head could learn a trivial identity function.
    let reported_missing = node.missing_mask & MISSING_REPORTED_STATE != 0;
    let reported_ratio = if reported_missing {
        0
    } else {
        fp_ratio(node.reported_state_fp, node.capacity_fp)
    };
    feature[0] = reported_ratio;
    feature[1] = fp_mul(reported_ratio, node.trust_fp);
    feature[2] = node.trust_fp;
    if node.missing_mask & MISSING_REPORTED_HISTORY == 0 {
        let newest = node.reported_history_fp[HISTORY_TICKS_V1 - 1];
        let oldest = node.reported_history_fp[0];
        feature[3] = fp_ratio(newest, node.capacity_fp);
        feature[4] = fp_ratio(oldest, node.capacity_fp);
        let delta = saturating_sub_i64(newest, oldest);
        feature[5] = fp_ratio(delta, node.capacity_fp);
        if !reported_missing {
            feature[6] = fp_ratio(
                saturating_sub_i64(node.reported_state_fp, newest),
                node.capacity_fp,
            );
        }
    }
    if node.missing_mask & MISSING_FLOW == 0 {
        feature[7] = fp_clamp(node.incoming_flow_fp, -FP_SCALE, FP_SCALE);
        feature[8] = fp_clamp(node.outgoing_flow_fp, -FP_SCALE, FP_SCALE);
    }
    feature[9] = node.queue_utilization_fp;
    feature[10] = if node.missing_mask & MISSING_DEADLINE == 0 {
        node.deadline_distance_fp
    } else {
        0
    };
    feature[11] = if node.missing_mask & MISSING_HYSTERESIS == 0 {
        node.hysteresis_distance_fp
    } else {
        0
    };
    feature[12] = node.outage_latched_fp;
    feature[13] = if node.missing_mask & MISSING_INTEL == 0 {
        node.intel_risk_fp
    } else {
        0
    };
    feature[14] =
        i64::from(bit_count_u32(node.missing_mask & KNOWN_MISSING_MASK_V1)) * FP_SCALE / 7;
    feature[15] = i64::from(node.node_kind) * FP_SCALE / 5;
    feature
}

struct StepBudget {
    used: u64,
    limit: u64,
}

impl StepBudget {
    fn consume(&mut self, count: usize) -> bool {
        let count = count as u64;
        let Some(remaining) = self.limit.checked_sub(self.used) else {
            return false;
        };
        if count > remaining {
            return false;
        }
        self.used += count;
        true
    }
}

fn linear(
    input: &[i64],
    weights: &[i8],
    bias: i32,
    denominator: u32,
    budget: &mut StepBudget,
    saturations: &mut u32,
) -> Option<i64> {
    if input.len() != weights.len() || !budget.consume(input.len()) {
        return None;
    }
    let mut accumulator = i64::from(bias);
    for (&value, &weight) in input.iter().zip(weights) {
        accumulator = sat_add_i64(accumulator, value * i64::from(weight), saturations);
    }
    Some(accumulator / i64::from(denominator))
}

#[allow(clippy::too_many_arguments)]
fn linear_pair(
    self_hidden: &HiddenVector,
    neighbor_hidden: &HiddenVector,
    self_weights: &[i8],
    neighbor_weights: &[i8],
    bias: i32,
    denominator: u32,
    budget: &mut StepBudget,
    saturations: &mut u32,
) -> Option<i64> {
    if self_weights.len() != HIDDEN_DIM_V1
        || neighbor_weights.len() != HIDDEN_DIM_V1
        || !budget.consume(HIDDEN_DIM_V1 * 2)
    {
        return None;
    }
    let mut accumulator = i64::from(bias);
    for index in 0..HIDDEN_DIM_V1 {
        accumulator = sat_add_i64(
            accumulator,
            self_hidden[index] * i64::from(self_weights[index]),
            saturations,
        );
        accumulator = sat_add_i64(
            accumulator,
            neighbor_hidden[index] * i64::from(neighbor_weights[index]),
            saturations,
        );
    }
    Some(accumulator / i64::from(denominator))
}

fn aggregate_messages(
    input: &NeuralInput,
    hidden: &HiddenMatrix,
    message: &mut HiddenMatrix,
    budget: &mut StepBudget,
    saturations: &mut u32,
) -> bool {
    message.clear();
    message.resize(input.nodes.len(), [0; HIDDEN_DIM_V1]);
    let mut incoming_count = [0u32; MAX_NODES_V1];
    for EdgeInput {
        source_index,
        destination_index,
        active,
        delay_ticks,
        multiplier_fp,
    } in &input.edges
    {
        if !active {
            continue;
        }
        if !budget.consume(HIDDEN_DIM_V1 * 3) {
            return false;
        }
        let source = *source_index as usize;
        let destination = *destination_index as usize;
        let delay_denominator = (i64::from(*delay_ticks) + 1) * FP_SCALE;
        let delay_factor = fp_div(FP_SCALE, delay_denominator);
        for h in 0..HIDDEN_DIM_V1 {
            let value = fp_mul(fp_mul(hidden[source][h], *multiplier_fp), delay_factor);
            message[destination][h] = sat_add_i64(message[destination][h], value, saturations);
        }
        incoming_count[destination] += 1;
    }
    for node in 0..input.nodes.len() {
        if incoming_count[node] == 0 {
            continue;
        }
        if !budget.consume(HIDDEN_DIM_V1) {
            return false;
        }
        for value in &mut message[node] {
            *value /= i64::from(incoming_count[node]);
        }
    }
    true
}

fn runtime_error(status: RuntimeStatus, saturation_count: u32) -> NeuralOutput {
    NeuralOutput {
        output_schema_version: NEURAL_OUTPUT_V1,
        runtime_status: status,
        saturation_count,
        tick: 0,
        feature_schema_version: 0,
        model_hash: [0; 32],
        scenario_hash: [0; 32],
        input_hash: [0; 32],
        nodes: Vec::new(),
        proposals: Vec::new(),
        lever_scores: Vec::new(),
    }
}

fn fail_without_partial_output(
    base: &NeuralOutput,
    status: RuntimeStatus,
    saturation_count: u32,
) -> NeuralOutput {
    NeuralOutput {
        output_schema_version: NEURAL_OUTPUT_V1,
        runtime_status: status,
        saturation_count,
        tick: base.tick,
        feature_schema_version: base.feature_schema_version,
        model_hash: base.model_hash,
        scenario_hash: base.scenario_hash,
        input_hash: base.input_hash,
        nodes: Vec::new(),
        proposals: Vec::new(),
        lever_scores: Vec::new(),
    }
}

pub fn infer(
    model: &DeterministicModelV1,
    input: &NeuralInput,
    policy: &NeuralPolicy,
) -> NeuralOutput {
    let mut output = runtime_error(RuntimeStatus::Ok, 0);
    output.tick = input.tick;
    output.feature_schema_version = input.feature_schema_version;
    output.model_hash = model.model_hash;
    output.scenario_hash = input.scenario_hash;
    if !model.trusted {
        return fail_without_partial_output(&output, RuntimeStatus::ModelUntrusted, 0);
    }
    if !input_ranges_valid(input) || !crate::neural_contract::policy_ranges_valid(policy) {
        return fail_without_partial_output(&output, RuntimeStatus::MalformedInput, 0);
    }
    output.input_hash = crate::neural_hash::input_hash(input);
    if policy.mode != NeuralMode::Assurance {
        return fail_without_partial_output(&output, RuntimeStatus::RuntimeFailure, 0);
    }
    if input.missing_value_count > policy.max_missing_values {
        return fail_without_partial_output(&output, RuntimeStatus::MalformedInput, 0);
    }
    if model.weights.len() != WEIGHT_COUNT_V1 || model.weight_scale_denominator == 0 {
        return fail_without_partial_output(&output, RuntimeStatus::DimensionMismatch, 0);
    }

    let mut budget = StepBudget {
        used: 0,
        limit: policy.max_inference_steps,
    };
    let mut hidden: HiddenMatrix = vec![[0; HIDDEN_DIM_V1]; input.nodes.len()];
    let mut next: HiddenMatrix = vec![[0; HIDDEN_DIM_V1]; input.nodes.len()];
    let mut message: HiddenMatrix = vec![[0; HIDDEN_DIM_V1]; input.nodes.len()];

    for (node_index, node) in input.nodes.iter().enumerate() {
        if !budget.consume(FEATURE_COUNT_V1) {
            return fail_without_partial_output(
                &output,
                RuntimeStatus::Timeout,
                output.saturation_count,
            );
        }
        let feature = encode_features(node);
        for h in 0..HIDDEN_DIM_V1 {
            let weight_start = W_INPUT + h * FEATURE_COUNT_V1;
            let Some(value) = linear(
                &feature,
                &model.weights[weight_start..weight_start + FEATURE_COUNT_V1],
                model.biases[B_INPUT + h],
                model.weight_scale_denominator,
                &mut budget,
                &mut output.saturation_count,
            ) else {
                return fail_without_partial_output(
                    &output,
                    RuntimeStatus::Timeout,
                    output.saturation_count,
                );
            };
            hidden[node_index][h] =
                clamp_activation(value, 0, FP_SCALE, &mut output.saturation_count);
        }
    }

    for layer in 0..2 {
        if !aggregate_messages(
            input,
            &hidden,
            &mut message,
            &mut budget,
            &mut output.saturation_count,
        ) {
            return fail_without_partial_output(
                &output,
                RuntimeStatus::Timeout,
                output.saturation_count,
            );
        }
        let (self_base, neighbor_base, bias_base) = if layer == 0 {
            (W_MESSAGE0_SELF, W_MESSAGE0_NEIGHBOR, B_MESSAGE0)
        } else {
            (W_MESSAGE1_SELF, W_MESSAGE1_NEIGHBOR, B_MESSAGE1)
        };
        for node in 0..input.nodes.len() {
            for h in 0..HIDDEN_DIM_V1 {
                let self_start = self_base + h * HIDDEN_DIM_V1;
                let neighbor_start = neighbor_base + h * HIDDEN_DIM_V1;
                let Some(value) = linear_pair(
                    &hidden[node],
                    &message[node],
                    &model.weights[self_start..self_start + HIDDEN_DIM_V1],
                    &model.weights[neighbor_start..neighbor_start + HIDDEN_DIM_V1],
                    model.biases[bias_base + h],
                    model.weight_scale_denominator,
                    &mut budget,
                    &mut output.saturation_count,
                ) else {
                    return fail_without_partial_output(
                        &output,
                        RuntimeStatus::Timeout,
                        output.saturation_count,
                    );
                };
                next[node][h] = clamp_activation(value, 0, FP_SCALE, &mut output.saturation_count);
            }
        }
        hidden = next;
        next = vec![[0; HIDDEN_DIM_V1]; input.nodes.len()];
    }

    let mut pooled: HiddenVector = [0; HIDDEN_DIM_V1];
    if !budget.consume(input.nodes.len() * HIDDEN_DIM_V1 + HIDDEN_DIM_V1) {
        return fail_without_partial_output(
            &output,
            RuntimeStatus::Timeout,
            output.saturation_count,
        );
    }
    for node in hidden.iter().take(input.nodes.len()) {
        for h in 0..HIDDEN_DIM_V1 {
            pooled[h] = sat_add_i64(pooled[h], node[h], &mut output.saturation_count);
        }
    }
    for value in &mut pooled {
        *value /= input.nodes.len() as i64;
    }

    let mut outage = [0i64; 3];
    for head in 0..3 {
        let start = W_OUTAGE_HEADS + head * HIDDEN_DIM_V1;
        let Some(value) = linear(
            &pooled,
            &model.weights[start..start + HIDDEN_DIM_V1],
            model.biases[B_OUTAGE_HEADS + head],
            model.weight_scale_denominator,
            &mut budget,
            &mut output.saturation_count,
        ) else {
            return fail_without_partial_output(
                &output,
                RuntimeStatus::Timeout,
                output.saturation_count,
            );
        };
        outage[head] = hard_sigmoid_fp(value, &mut output.saturation_count);
    }

    for (node_index, node_input) in input.nodes.iter().enumerate() {
        let mut heads = [0i64; 5];
        for head in 0..5 {
            let start = W_NODE_HEADS + head * HIDDEN_DIM_V1;
            let Some(value) = linear(
                &hidden[node_index],
                &model.weights[start..start + HIDDEN_DIM_V1],
                model.biases[B_NODE_HEADS + head],
                model.weight_scale_denominator,
                &mut budget,
                &mut output.saturation_count,
            ) else {
                return fail_without_partial_output(
                    &output,
                    RuntimeStatus::Timeout,
                    output.saturation_count,
                );
            };
            heads[head] = value;
        }
        let estimated_ratio = hard_sigmoid_fp(heads[0], &mut output.saturation_count);
        output.nodes.push(NodeOutput {
            node_index: node_index as u32,
            estimated_true_state_fp: fp_mul(estimated_ratio, node_input.capacity_fp),
            telemetry_anomaly_score_fp: hard_sigmoid_fp(heads[1], &mut output.saturation_count),
            confidence_fp: hard_sigmoid_fp(heads[2], &mut output.saturation_count),
            out_of_distribution_score_fp: hard_sigmoid_fp(heads[3], &mut output.saturation_count),
            outage_probability_short_fp: outage[0],
            outage_probability_medium_fp: outage[1],
            outage_probability_long_fp: outage[2],
        });
        if policy.allow_bounded_trust_adjustment {
            let limit = policy.maximum_abs_trust_delta_fp;
            let lower = if node_input.trust_fp < limit {
                -node_input.trust_fp
            } else {
                -limit
            };
            let headroom = FP_SCALE - node_input.trust_fp;
            let upper = if headroom < limit { headroom } else { limit };
            output.proposals.push(ParameterProposal {
                kind: ProposalKind::TrustDelta,
                node_index: node_index as u32,
                proposed_delta_fp: clamp_activation(
                    heads[4],
                    lower,
                    upper,
                    &mut output.saturation_count,
                ),
                authorized_min_fp: lower,
                authorized_max_fp: upper,
            });
        }
    }

    for (lever_index, lever) in input.levers.iter().enumerate() {
        let mut feature = [0i64; HIDDEN_DIM_V1 + 3];
        feature[..HIDDEN_DIM_V1].copy_from_slice(&pooled);
        feature[HIDDEN_DIM_V1] = lever.success_probability_fp;
        feature[HIDDEN_DIM_V1 + 1] = if lever.available { FP_SCALE } else { 0 };
        let cost_denominator = (i64::from(lever.cost_ticks) + 1) * FP_SCALE;
        feature[HIDDEN_DIM_V1 + 2] = fp_div(FP_SCALE, cost_denominator);
        let Some(score) = linear(
            &feature,
            &model.weights[W_LEVER_HEAD..W_LEVER_HEAD + HIDDEN_DIM_V1 + 3],
            model.biases[B_LEVER_HEAD],
            model.weight_scale_denominator,
            &mut budget,
            &mut output.saturation_count,
        ) else {
            return fail_without_partial_output(
                &output,
                RuntimeStatus::Timeout,
                output.saturation_count,
            );
        };
        output.lever_scores.push(LeverScore {
            lever_index: lever_index as u32,
            score_fp: hard_sigmoid_fp(score, &mut output.saturation_count),
        });
    }

    if !output_ranges_valid_with_policy(input, &output, policy) {
        return fail_without_partial_output(
            &output,
            RuntimeStatus::RuntimeFailure,
            output.saturation_count,
        );
    }
    output
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;
    use crate::neural_contract::{
        EdgeInput, LeverInput, NodeInput, FEATURE_SCHEMA_V1, NEURAL_ABI_V1,
    };
    use alloc::string::String;

    pub(crate) fn fixture_blob() -> Vec<u8> {
        let mut blob = vec![0u8; WEIGHTS_HEADER_BYTES_V1 + WEIGHT_COUNT_V1 + BIAS_COUNT_V1 * 4];
        blob[..8].copy_from_slice(b"CAELNN1\0");
        for (offset, value) in [
            (8, WEIGHTS_FORMAT_VERSION_V1),
            (12, WEIGHTS_ENDIAN_MARKER_V1),
            (16, FEATURE_COUNT_V1 as u32),
            (20, HIDDEN_DIM_V1 as u32),
            (24, 2),
            (28, WEIGHT_COUNT_V1 as u32),
            (32, BIAS_COUNT_V1 as u32),
            (36, 0),
        ] {
            blob[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        let payload = (WEIGHT_COUNT_V1 + BIAS_COUNT_V1 * 4) as u64;
        blob[40..48].copy_from_slice(&payload.to_le_bytes());
        for index in 0..WEIGHT_COUNT_V1 {
            blob[WEIGHTS_HEADER_BYTES_V1 + index] = (((index * 17 + 3) % 15) as i8 - 7) as u8;
        }
        let bias_start = WEIGHTS_HEADER_BYTES_V1 + WEIGHT_COUNT_V1;
        for index in 0..BIAS_COUNT_V1 {
            let value = ((index as i32 * 7919) % 200_001) - 100_000;
            blob[bias_start + index * 4..bias_start + index * 4 + 4]
                .copy_from_slice(&value.to_le_bytes());
        }
        blob
    }

    pub(crate) fn fixture_input() -> NeuralInput {
        let mut n0 = NodeInput {
            missing_mask: 0,
            node_index: 0,
            node_kind: 1,
            node_id: String::from("GHOST_INVENTORY"),
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
        n0.state_history_fp = [
            90_000, 95_000, 100_000, 102_000, 105_000, 108_000, 109_000, 110_000,
        ];
        n0.reported_history_fp = [0; HISTORY_TICKS_V1];
        let mut n1 = n0.clone();
        n1.node_index = 1;
        n1.node_kind = 0;
        n1.node_id = String::from("HUB_BERTHS");
        n1.authoritative_state_fp = 650_000;
        n1.reported_state_fp = 650_000;
        n1.trust_fp = FP_SCALE;
        n1.queue_utilization_fp = 650_000;
        n1.state_history_fp = [
            620_000, 625_000, 630_000, 635_000, 640_000, 645_000, 648_000, 650_000,
        ];
        n1.reported_history_fp = n1.state_history_fp;
        NeuralInput {
            neural_abi_version: NEURAL_ABI_V1,
            feature_schema_version: FEATURE_SCHEMA_V1,
            history_length: HISTORY_TICKS_V1 as u32,
            tick: 8,
            scenario_id: String::from("BS-01_SAHTE_UFUK"),
            scenario_hash: [0x11; 32],
            engine_version: String::from("2.0.0"),
            missing_value_count: 0,
            nodes: vec![n0, n1],
            edges: vec![EdgeInput {
                source_index: 0,
                destination_index: 1,
                active: true,
                delay_ticks: 1,
                multiplier_fp: 1_200_000,
            }],
            levers: vec![LeverInput {
                lever_index: 0,
                lever_id: String::from("L-01"),
                success_probability_fp: 750_000,
                cost_ticks: 24,
                remaining_lockout: 0,
                available: true,
            }],
        }
    }

    pub(crate) fn verified_fixture_model() -> DeterministicModelV1 {
        DeterministicModelV1::from_test_verified_weights_blob(&fixture_blob(), 64, [0x22; 32])
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::tests_support::{fixture_blob, fixture_input, verified_fixture_model};
    use super::*;
    use crate::neural_contract::NeuralMode;

    #[test]
    fn inference_is_repeatable_and_nontrivial() {
        let model = verified_fixture_model();
        let input = fixture_input();
        let policy = NeuralPolicy::assurance_default();
        let first = infer(&model, &input, &policy);
        let second = infer(&model, &input, &policy);
        assert_eq!(first, second);
        assert_eq!(first.runtime_status, RuntimeStatus::Ok);
        assert_eq!(first.nodes.len(), 2);
        assert_ne!(
            first.nodes[0].estimated_true_state_fp,
            input.nodes[0].reported_state_fp
        );
        assert_eq!(first.lever_scores.len(), 1);
    }

    #[test]
    fn feature_schema_withholds_authoritative_state_from_observer() {
        let input = fixture_input();
        let expected = encode_features(&input.nodes[0]);
        let mut changed_authority = input.nodes[0].clone();
        changed_authority.authoritative_state_fp = 900_000;
        changed_authority.state_history_fp = [900_000; HISTORY_TICKS_V1];
        assert_eq!(expected, encode_features(&changed_authority));
        assert_eq!(expected[0], 0);
        assert_eq!(expected[1], 0);
    }

    #[test]
    fn operation_budget_causes_explicit_timeout() {
        let model = verified_fixture_model();
        let input = fixture_input();
        let mut policy = NeuralPolicy::assurance_default();
        policy.mode = NeuralMode::Assurance;
        policy.max_inference_steps = 1;
        let output = infer(&model, &input, &policy);
        assert_eq!(output.runtime_status, RuntimeStatus::Timeout);
        assert!(output.nodes.is_empty());

        policy.max_inference_steps = 9_900;
        let late = infer(&model, &input, &policy);
        assert_eq!(late.runtime_status, RuntimeStatus::Timeout);
        assert!(late.nodes.is_empty());
        assert!(late.proposals.is_empty());
        assert!(late.lever_scores.is_empty());
    }

    #[test]
    fn malformed_or_unsupported_weight_blob_is_rejected() {
        let mut blob = fixture_blob();
        blob[20] ^= 1;
        assert_eq!(
            DeterministicModelV1::from_weights_blob(&blob, 64),
            Err(RuntimeStatus::DimensionMismatch)
        );
        assert_eq!(
            DeterministicModelV1::from_weights_blob(&fixture_blob(), 0),
            Err(RuntimeStatus::DimensionMismatch)
        );
    }

    #[test]
    fn package_identity_binds_manifest_and_weights() {
        let weights_hash = *blake3::hash(&fixture_blob()).as_bytes();
        assert_ne!(
            neural_package_hash(&[0x11; 32], &weights_hash),
            neural_package_hash(&[0x22; 32], &weights_hash)
        );
    }

    #[test]
    fn unverified_model_cannot_run_assurance_inference() {
        let model = DeterministicModelV1::from_weights_blob(&fixture_blob(), 64).unwrap();
        let output = infer(&model, &fixture_input(), &NeuralPolicy::assurance_default());
        assert_eq!(output.runtime_status, RuntimeStatus::ModelUntrusted);
        assert!(output.nodes.is_empty());
    }
}
