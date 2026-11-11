/**
 * CAELUS OS — Central Neural Gate V1.
 *
 * The gate converts model/runtime/policy evidence into an explicit decision.
 * It never mutates CausalEngine.  Applying an ACCEPTED_BOUNDED proposal remains
 * a separate symbolic-authority operation.
 */
#pragma once

#include <array>
#include <cstdio>
#include <cstring>

#include "neural_contract.h"
#include "neural_hash.h"
#include "neural_model.h"

namespace caelus::neural {

inline CaelusNeuralGateResultV1 neural_gate_result(
    uint32_t decision, uint32_t runtime_status, const char* reason,
    const NeuralModelPackage& model,
    const CaelusNeuralOutputBufferV1& output,
    const CaelusNeuralPolicyV1& policy,
    const uint8_t* verified_input_hash = nullptr) noexcept {
    CaelusNeuralGateResultV1 result{};
    result.decision = decision;
    result.runtime_status = runtime_status;
    std::memcpy(result.model_hash, model.package_hash().data(),
                sizeof(result.model_hash));
    if (verified_input_hash != nullptr) {
        std::memcpy(result.input_hash, verified_input_hash,
                    sizeof(result.input_hash));
    }
    const bool output_committed =
        hash_detail::output_hash(output, result.output_hash);
    const bool policy_committed =
        hash_detail::policy_hash(policy, result.policy_hash);
    if (!output_committed || !policy_committed) {
        result.decision = CAELUS_NEURAL_GATE_REJECTED_RUNTIME;
        result.runtime_status = CAELUS_NEURAL_STATUS_RUNTIME_FAILURE;
        std::snprintf(result.reason, sizeof(result.reason), "%s",
                      "gate evidence commitment failed");
    } else {
        std::snprintf(result.reason, sizeof(result.reason), "%s",
                      reason ? reason : "");
    }
    return result;
}

class NeuralGateV1 final {
public:
    static CaelusNeuralGateResultV1 evaluate(
        const NeuralModelPackage& model,
        const NeuralInputSnapshotV1& snapshot,
        const CaelusNeuralOutputBufferV1& output,
        const CaelusNeuralPolicyV1& policy) noexcept {
        const CaelusNeuralInputV1 input = snapshot.view();
        std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1> verified_input_hash{};
        bool input_hash_available = false;
        const auto result = [&](uint32_t decision, uint32_t runtime_status,
                                const char* reason) noexcept {
            return neural_gate_result(
                decision, runtime_status, reason, model, output, policy,
                input_hash_available ? verified_input_hash.data() : nullptr);
        };
        if (!policy_ranges_valid(policy)) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_SCHEMA,
                CAELUS_NEURAL_STATUS_SCHEMA_MISMATCH,
                "policy schema/range invalid");
        }
        if (policy.mode == CAELUS_NEURAL_MODE_SYMBOLIC_ONLY) {
            return result(
                CAELUS_NEURAL_GATE_SYMBOLIC_FALLBACK,
                CAELUS_NEURAL_STATUS_MODEL_UNAVAILABLE,
                "symbolic-only policy");
        }
        // V1 never accepts evidence from an untrusted package.  The policy
        // field is retained for format compatibility, not as a trust bypass.
        if (!model.trusted()) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_MODEL_TRUST,
                CAELUS_NEURAL_STATUS_MODEL_UNTRUSTED,
                "neural model is not trusted");
        }
        if (!input_ranges_valid(input) ||
            input.missing_value_count > policy.max_missing_values) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_SCHEMA,
                CAELUS_NEURAL_STATUS_MALFORMED_INPUT,
                "feature schema/range or missing-data policy rejected");
        }
        if (!hash_detail::input_hash(input, verified_input_hash.data())) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_RUNTIME,
                CAELUS_NEURAL_STATUS_RUNTIME_FAILURE,
                "neural input commitment failed");
        }
        input_hash_available = true;
        if (!hash_detail::hash_equal(output.model_hash,
                                     model.package_hash().data()) ||
            !hash_detail::hash_equal(output.input_hash,
                                     verified_input_hash.data()) ||
            output.tick != input.tick ||
            output.feature_schema_version != input.feature_schema_version ||
            std::memcmp(output.scenario_hash, input.scenario_hash,
                        CAELUS_NEURAL_HASH_BYTES_V1) != 0) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_INVARIANT,
                output.runtime_status,
                "neural output identity does not match model/input");
        }
        if (output.runtime_status == CAELUS_NEURAL_STATUS_TIMEOUT) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_TIMEOUT,
                output.runtime_status,
                "deterministic inference operation budget exhausted");
        }
        if (output.runtime_status != CAELUS_NEURAL_STATUS_OK) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_RUNTIME,
                output.runtime_status,
                "neural runtime did not produce a complete output");
        }
        if (!output_ranges_valid(input, output, policy)) {
            return result(
                CAELUS_NEURAL_GATE_REJECTED_RANGE,
                CAELUS_NEURAL_STATUS_MALFORMED_INPUT,
                "neural output range/invariant validation failed");
        }
        for (uint32_t i = 0; i < output.node_count; ++i) {
            if (output.nodes[i].confidence_fp < policy.minimum_confidence_fp) {
                return result(
                    CAELUS_NEURAL_GATE_REJECTED_LOW_CONFIDENCE,
                    output.runtime_status,
                    "confidence below trusted policy threshold");
            }
        }
        for (uint32_t i = 0; i < output.node_count; ++i) {
            if (output.nodes[i].out_of_distribution_score_fp >
                policy.maximum_ood_fp) {
                return result(
                    CAELUS_NEURAL_GATE_REJECTED_OOD,
                    output.runtime_status,
                    "out-of-distribution score above trusted policy threshold");
            }
        }
        CaelusNeuralGateResultV1 accepted = result(
            output.proposal_count == 0u
                ? CAELUS_NEURAL_GATE_ACCEPTED_ADVISORY
                : CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED,
            output.runtime_status,
            output.proposal_count == 0u
                ? "validated advisory output"
                : "validated bounded trust proposals");
        if (accepted.decision == CAELUS_NEURAL_GATE_ACCEPTED_ADVISORY ||
            accepted.decision == CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED) {
            accepted.accepted_proposal_count = output.proposal_count;
        }
        return accepted;
    }
};

} // namespace caelus::neural
