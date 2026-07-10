//! Central policy gate for deterministic neural outputs.
//!
//! The gate is pure validation.  It cannot mutate symbolic engine state.

use crate::neural_contract::{
    input_ranges_valid, output_ranges_valid_with_policy, policy_ranges_valid, GateDecision,
    NeuralInput, NeuralMode, NeuralOutput, NeuralPolicy, RuntimeStatus, MAX_LEVERS_V1,
    MAX_NODES_V1,
};
use crate::neural_runtime::DeterministicModelV1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GateResult {
    pub decision: GateDecision,
    pub runtime_status: RuntimeStatus,
    pub accepted_proposal_count: u32,
    pub reason: &'static str,
    pub model_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub policy_hash: [u8; 32],
}

fn result(
    decision: GateDecision,
    runtime_status: RuntimeStatus,
    reason: &'static str,
    model: &DeterministicModelV1,
    policy: &NeuralPolicy,
    output: &NeuralOutput,
    verified_input_hash: Option<[u8; 32]>,
) -> GateResult {
    let output_hashable = output.nodes.len() <= MAX_NODES_V1
        && output.proposals.len() <= MAX_NODES_V1
        && output.lever_scores.len() <= MAX_LEVERS_V1;
    let output_hash = if output_hashable {
        crate::neural_hash::output_hash(output)
    } else {
        [0; 32]
    };
    let (decision, runtime_status, reason) = if output_hashable {
        (decision, runtime_status, reason)
    } else {
        (
            GateDecision::RejectedRuntime,
            RuntimeStatus::RuntimeFailure,
            "gate evidence commitment failed",
        )
    };
    GateResult {
        decision,
        runtime_status,
        accepted_proposal_count: 0,
        reason,
        model_hash: *model.model_hash(),
        input_hash: verified_input_hash.unwrap_or([0; 32]),
        output_hash,
        policy_hash: crate::neural_hash::policy_hash(policy),
    }
}

pub fn evaluate(
    model: &DeterministicModelV1,
    input: &NeuralInput,
    output: &NeuralOutput,
    policy: &NeuralPolicy,
) -> GateResult {
    if !policy_ranges_valid(policy) {
        return result(
            GateDecision::RejectedSchema,
            RuntimeStatus::SchemaMismatch,
            "policy schema/range invalid",
            model,
            policy,
            output,
            None,
        );
    }
    if policy.mode == NeuralMode::SymbolicOnly {
        return result(
            GateDecision::SymbolicFallback,
            RuntimeStatus::ModelUnavailable,
            "symbolic-only policy",
            model,
            policy,
            output,
            None,
        );
    }
    // V1 never accepts evidence from an untrusted package. The policy field is
    // retained for persisted-format compatibility, not as a trust bypass.
    if !model.trusted() {
        return result(
            GateDecision::RejectedModelTrust,
            RuntimeStatus::ModelUntrusted,
            "neural model is not trusted",
            model,
            policy,
            output,
            None,
        );
    }
    if !input_ranges_valid(input) || input.missing_value_count > policy.max_missing_values {
        return result(
            GateDecision::RejectedSchema,
            RuntimeStatus::MalformedInput,
            "feature schema/range or missing-data policy rejected",
            model,
            policy,
            output,
            None,
        );
    }
    let verified_input_hash = crate::neural_hash::input_hash(input);
    if output.model_hash != *model.model_hash()
        || output.input_hash != verified_input_hash
        || output.tick != input.tick
        || output.feature_schema_version != input.feature_schema_version
        || output.scenario_hash != input.scenario_hash
    {
        return result(
            GateDecision::RejectedInvariant,
            output.runtime_status,
            "neural output identity does not match model/input",
            model,
            policy,
            output,
            Some(verified_input_hash),
        );
    }
    if output.runtime_status == RuntimeStatus::Timeout {
        return result(
            GateDecision::RejectedTimeout,
            RuntimeStatus::Timeout,
            "deterministic inference operation budget exhausted",
            model,
            policy,
            output,
            Some(verified_input_hash),
        );
    }
    if output.runtime_status != RuntimeStatus::Ok {
        return result(
            GateDecision::RejectedRuntime,
            output.runtime_status,
            "neural runtime did not produce a complete output",
            model,
            policy,
            output,
            Some(verified_input_hash),
        );
    }
    if !output_ranges_valid_with_policy(input, output, policy) {
        return result(
            GateDecision::RejectedRange,
            RuntimeStatus::MalformedInput,
            "neural output range/invariant validation failed",
            model,
            policy,
            output,
            Some(verified_input_hash),
        );
    }
    if output
        .nodes
        .iter()
        .any(|node| node.confidence_fp < policy.minimum_confidence_fp)
    {
        return result(
            GateDecision::RejectedLowConfidence,
            RuntimeStatus::Ok,
            "confidence below trusted policy threshold",
            model,
            policy,
            output,
            Some(verified_input_hash),
        );
    }
    if output
        .nodes
        .iter()
        .any(|node| node.out_of_distribution_score_fp > policy.maximum_ood_fp)
    {
        return result(
            GateDecision::RejectedOod,
            RuntimeStatus::Ok,
            "out-of-distribution score above trusted policy threshold",
            model,
            policy,
            output,
            Some(verified_input_hash),
        );
    }
    let output_hash = crate::neural_hash::output_hash(output);
    GateResult {
        decision: if output.proposals.is_empty() {
            GateDecision::AcceptedAdvisory
        } else {
            GateDecision::AcceptedBounded
        },
        runtime_status: RuntimeStatus::Ok,
        accepted_proposal_count: output.proposals.len() as u32,
        reason: if output.proposals.is_empty() {
            "validated advisory output"
        } else {
            "validated bounded trust proposals"
        },
        model_hash: *model.model_hash(),
        input_hash: verified_input_hash,
        output_hash,
        policy_hash: crate::neural_hash::policy_hash(policy),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::neural_contract::{LeverScore, NeuralOutput, NodeOutput, NEURAL_OUTPUT_V1};
    use crate::neural_runtime::tests_support::{
        fixture_blob, fixture_input, verified_fixture_model,
    };

    #[test]
    fn low_confidence_and_ood_are_explicit_rejections() {
        let model = verified_fixture_model();
        let input = fixture_input();
        let policy = NeuralPolicy::assurance_default();
        let mut output = NeuralOutput {
            output_schema_version: NEURAL_OUTPUT_V1,
            runtime_status: RuntimeStatus::Ok,
            saturation_count: 0,
            tick: input.tick,
            feature_schema_version: input.feature_schema_version,
            model_hash: *model.model_hash(),
            scenario_hash: input.scenario_hash,
            input_hash: crate::neural_hash::input_hash(&input),
            nodes: input
                .nodes
                .iter()
                .enumerate()
                .map(|(index, node)| NodeOutput {
                    node_index: index as u32,
                    estimated_true_state_fp: node.authoritative_state_fp,
                    confidence_fp: 900_000,
                    out_of_distribution_score_fp: 100_000,
                    ..NodeOutput::default()
                })
                .collect(),
            proposals: alloc::vec::Vec::new(),
            lever_scores: alloc::vec![LeverScore {
                lever_index: 0,
                score_fp: 500_000,
            }],
        };
        let accepted = evaluate(&model, &input, &output, &policy);
        assert_eq!(accepted.decision, GateDecision::AcceptedAdvisory);
        assert_eq!(accepted.model_hash, *model.model_hash());
        assert_eq!(accepted.input_hash, crate::neural_hash::input_hash(&input));
        assert_eq!(
            accepted.output_hash,
            crate::neural_hash::output_hash(&output)
        );
        assert_eq!(
            accepted.policy_hash,
            crate::neural_hash::policy_hash(&policy)
        );
        let untrusted = DeterministicModelV1::from_weights_blob(&fixture_blob(), 64).unwrap();
        let mut no_trust_policy = policy;
        no_trust_policy.require_trusted_model = false;
        assert_eq!(
            evaluate(&untrusted, &input, &output, &no_trust_policy).decision,
            GateDecision::RejectedModelTrust
        );
        output.nodes[0].confidence_fp = policy.minimum_confidence_fp - 1;
        assert_eq!(
            evaluate(&model, &input, &output, &policy).decision,
            GateDecision::RejectedLowConfidence
        );
        output.nodes[0].confidence_fp = policy.minimum_confidence_fp;
        output.nodes[0].out_of_distribution_score_fp = policy.maximum_ood_fp + 1;
        assert_eq!(
            evaluate(&model, &input, &output, &policy).decision,
            GateDecision::RejectedOod
        );
    }
}
