/**
 * CAELUS OS — Versioned neural observation contract.
 *
 * This is intentionally independent from the native plugin ABI.  It is a
 * data-only boundary between feature extraction, deterministic inference, and
 * the Neural Gate.  The neural layer is advisory: none of these structures
 * grants permission to mutate CausalEngine state.
 *
 * Persisted model/feature formats use the *_V1 constants below.  Every
 * security-relevant scalar is fixed-width; no float/double crosses this
 * contract.  Fixed-point values use CAELUS_NEURAL_FP_SCALE (1e6).
 */
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

// Public format identifiers.  These values are persisted in manifests and
// audit events; changing semantics requires a new version, not reinterpretation.
#define CAELUS_NEURAL_ABI_V1            UINT32_C(0x00010000)
#define CAELUS_FEATURE_SCHEMA_V1        UINT32_C(1)
#define CAELUS_NEURAL_OUTPUT_V1         UINT32_C(1)
#define CAELUS_NEURAL_POLICY_V1         UINT32_C(1)
#define CAELUS_NN_MANIFEST_V1           UINT32_C(1)

#define CAELUS_NEURAL_HISTORY_TICKS_V1  UINT32_C(8)
#define CAELUS_NEURAL_FEATURES_V1       UINT32_C(16)
#define CAELUS_NEURAL_HIDDEN_V1         UINT32_C(32)
#define CAELUS_NEURAL_MAX_NODES_V1      UINT32_C(64)
#define CAELUS_NEURAL_MAX_EDGES_V1      UINT32_C(256)
#define CAELUS_NEURAL_MAX_LEVERS_V1     UINT32_C(64)
#define CAELUS_NEURAL_ID_BYTES_V1       UINT32_C(64)
#define CAELUS_NEURAL_HASH_BYTES_V1     UINT32_C(32)
#define CAELUS_NEURAL_FP_SCALE          INT64_C(1000000)

extern "C" {

enum CaelusNeuralRuntimeStatusV1 : uint32_t {
    CAELUS_NEURAL_STATUS_OK = 0,
    CAELUS_NEURAL_STATUS_MODEL_UNAVAILABLE = 1,
    CAELUS_NEURAL_STATUS_MODEL_UNTRUSTED = 2,
    CAELUS_NEURAL_STATUS_SCHEMA_MISMATCH = 3,
    CAELUS_NEURAL_STATUS_MALFORMED_INPUT = 4,
    CAELUS_NEURAL_STATUS_UNSUPPORTED_OPERATOR = 5,
    CAELUS_NEURAL_STATUS_DIMENSION_MISMATCH = 6,
    CAELUS_NEURAL_STATUS_OVERFLOW = 7,
    CAELUS_NEURAL_STATUS_TIMEOUT = 8,
    CAELUS_NEURAL_STATUS_RUNTIME_FAILURE = 9,
};

enum CaelusNeuralGateDecisionV1 : uint32_t {
    CAELUS_NEURAL_GATE_ACCEPTED_ADVISORY = 0,
    CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED = 1,
    CAELUS_NEURAL_GATE_REJECTED_LOW_CONFIDENCE = 2,
    CAELUS_NEURAL_GATE_REJECTED_OOD = 3,
    CAELUS_NEURAL_GATE_REJECTED_RANGE = 4,
    CAELUS_NEURAL_GATE_REJECTED_INVARIANT = 5,
    CAELUS_NEURAL_GATE_REJECTED_TIMEOUT = 6,
    CAELUS_NEURAL_GATE_REJECTED_MODEL_TRUST = 7,
    CAELUS_NEURAL_GATE_REJECTED_SCHEMA = 8,
    CAELUS_NEURAL_GATE_REJECTED_RUNTIME = 9,
    CAELUS_NEURAL_GATE_SYMBOLIC_FALLBACK = 10,
};

enum CaelusNeuralProposalKindV1 : uint32_t {
    // V1 permits only bounded trust adjustment.  Authoritative state,
    // outage-latch, deadlines, hysteresis and signatures are never writable.
    CAELUS_NEURAL_PROPOSAL_TRUST_DELTA = 1,
};

enum CaelusNeuralModeV1 : uint32_t {
    CAELUS_NEURAL_MODE_SYMBOLIC_ONLY = 0,
    CAELUS_NEURAL_MODE_ADVISORY = 1,
    CAELUS_NEURAL_MODE_ASSURANCE = 2,
};

// Bit positions in missing_mask.  Missing data is represented explicitly; a
// zero numeric value is never used as an implicit missing sentinel.
enum CaelusNeuralMissingMaskV1 : uint32_t {
    CAELUS_NEURAL_MISSING_REPORTED_STATE = UINT32_C(1) << 0,
    CAELUS_NEURAL_MISSING_STATE_HISTORY = UINT32_C(1) << 1,
    CAELUS_NEURAL_MISSING_REPORTED_HISTORY = UINT32_C(1) << 2,
    CAELUS_NEURAL_MISSING_FLOW = UINT32_C(1) << 3,
    CAELUS_NEURAL_MISSING_DEADLINE = UINT32_C(1) << 4,
    CAELUS_NEURAL_MISSING_HYSTERESIS = UINT32_C(1) << 5,
    CAELUS_NEURAL_MISSING_INTEL = UINT32_C(1) << 6,
};

struct CaelusNeuralNodeInputV1 {
    uint32_t struct_size;
    uint32_t missing_mask;
    uint32_t node_index;
    uint32_t node_kind;
    char node_id[CAELUS_NEURAL_ID_BYTES_V1];
    int64_t capacity_fp;
    int64_t authoritative_state_fp;
    int64_t reported_state_fp;
    int64_t trust_fp;
    int64_t incoming_flow_fp;
    int64_t outgoing_flow_fp;
    int64_t queue_utilization_fp;
    int64_t deadline_distance_fp;
    int64_t hysteresis_distance_fp;
    int64_t outage_latched_fp;
    int64_t intel_risk_fp;
    int64_t state_history_fp[CAELUS_NEURAL_HISTORY_TICKS_V1];
    int64_t reported_history_fp[CAELUS_NEURAL_HISTORY_TICKS_V1];
};

struct CaelusNeuralEdgeInputV1 {
    uint32_t struct_size;
    uint32_t source_index;
    uint32_t destination_index;
    uint32_t active;
    int32_t delay_ticks;
    uint32_t reserved;
    int64_t multiplier_fp;
};

struct CaelusNeuralLeverInputV1 {
    uint32_t struct_size;
    uint32_t lever_index;
    char lever_id[CAELUS_NEURAL_ID_BYTES_V1];
    int64_t success_probability_fp;
    int32_t cost_ticks;
    int32_t remaining_lockout;
    uint32_t available;
    uint32_t reserved;
};

struct CaelusNeuralInputV1 {
    uint32_t struct_size;
    uint32_t neural_abi_version;
    uint32_t feature_schema_version;
    uint32_t history_length;
    uint64_t tick;
    char scenario_id[CAELUS_NEURAL_ID_BYTES_V1];
    uint8_t scenario_hash[CAELUS_NEURAL_HASH_BYTES_V1];
    char engine_version[32];
    uint32_t node_count;
    uint32_t edge_count;
    uint32_t lever_count;
    uint32_t missing_value_count;
    const CaelusNeuralNodeInputV1* nodes;
    const CaelusNeuralEdgeInputV1* edges;
    const CaelusNeuralLeverInputV1* levers;
};

struct CaelusNeuralNodeOutputV1 {
    uint32_t node_index;
    uint32_t reserved;
    int64_t estimated_true_state_fp;
    int64_t telemetry_anomaly_score_fp;
    int64_t confidence_fp;
    int64_t out_of_distribution_score_fp;
    int64_t outage_probability_short_fp;
    int64_t outage_probability_medium_fp;
    int64_t outage_probability_long_fp;
};

struct CaelusNeuralParameterProposalV1 {
    uint32_t kind;
    uint32_t node_index;
    int64_t proposed_delta_fp;
    int64_t authorized_min_fp;
    int64_t authorized_max_fp;
};

struct CaelusNeuralLeverScoreV1 {
    uint32_t lever_index;
    uint32_t reserved;
    int64_t score_fp;
};

struct CaelusNeuralOutputBufferV1 {
    uint32_t struct_size;
    uint32_t output_schema_version;
    uint32_t runtime_status;
    uint32_t saturation_count;
    uint32_t node_count;
    uint32_t proposal_count;
    uint32_t lever_score_count;
    uint32_t reserved;
    CaelusNeuralNodeOutputV1 nodes[CAELUS_NEURAL_MAX_NODES_V1];
    CaelusNeuralParameterProposalV1 proposals[CAELUS_NEURAL_MAX_NODES_V1];
    CaelusNeuralLeverScoreV1 lever_scores[CAELUS_NEURAL_MAX_LEVERS_V1];
};

struct CaelusNeuralPolicyV1 {
    uint32_t struct_size;
    uint32_t policy_version;
    uint32_t mode;
    uint32_t require_trusted_model;
    uint32_t allow_bounded_trust_adjustment;
    uint32_t max_missing_values;
    uint64_t max_inference_steps;
    int64_t minimum_confidence_fp;
    int64_t maximum_ood_fp;
    int64_t maximum_abs_trust_delta_fp;
};

struct CaelusNeuralGateResultV1 {
    uint32_t decision;
    uint32_t runtime_status;
    uint32_t accepted_proposal_count;
    uint32_t reserved;
    char reason[96];
};

} // extern "C"

namespace caelus::neural {

static constexpr int64_t kFpZero = 0;
static constexpr int64_t kFpOne = CAELUS_NEURAL_FP_SCALE;
static constexpr int64_t kMaxAbsTrustDeltaV1 = 50'000;

inline bool probability_in_range(int64_t value) noexcept {
    return value >= kFpZero && value <= kFpOne;
}

inline bool node_input_ranges_valid(const CaelusNeuralNodeInputV1& node) noexcept {
    if (node.struct_size != sizeof(CaelusNeuralNodeInputV1)) return false;
    if (node.node_index >= CAELUS_NEURAL_MAX_NODES_V1) return false;
    if (node.node_kind > 5u) return false;
    if (node.capacity_fp <= 0) return false;
    if (node.authoritative_state_fp < 0 ||
        node.authoritative_state_fp > node.capacity_fp) return false;
    if ((node.missing_mask & CAELUS_NEURAL_MISSING_REPORTED_STATE) == 0u &&
        (node.reported_state_fp < 0 || node.reported_state_fp > node.capacity_fp)) return false;
    if (!probability_in_range(node.trust_fp) ||
        !probability_in_range(node.queue_utilization_fp) ||
        !probability_in_range(node.outage_latched_fp) ||
        !probability_in_range(node.intel_risk_fp)) return false;
    return true;
}

inline CaelusNeuralPolicyV1 default_assurance_policy() noexcept {
    CaelusNeuralPolicyV1 p{};
    p.struct_size = sizeof(p);
    p.policy_version = CAELUS_NEURAL_POLICY_V1;
    p.mode = CAELUS_NEURAL_MODE_ASSURANCE;
    p.require_trusted_model = 1;
    p.allow_bounded_trust_adjustment = 1;
    p.max_missing_values = 8;
    p.max_inference_steps = UINT64_C(1000000);
    p.minimum_confidence_fp = 650'000;
    p.maximum_ood_fp = 300'000;
    p.maximum_abs_trust_delta_fp = kMaxAbsTrustDeltaV1;
    return p;
}

inline bool policy_ranges_valid(const CaelusNeuralPolicyV1& policy) noexcept {
    return policy.struct_size == sizeof(CaelusNeuralPolicyV1) &&
           policy.policy_version == CAELUS_NEURAL_POLICY_V1 &&
           policy.mode <= CAELUS_NEURAL_MODE_ASSURANCE &&
           policy.max_inference_steps > 0 &&
           probability_in_range(policy.minimum_confidence_fp) &&
           probability_in_range(policy.maximum_ood_fp) &&
           policy.maximum_abs_trust_delta_fp >= 0 &&
           policy.maximum_abs_trust_delta_fp <= kMaxAbsTrustDeltaV1;
}

inline bool input_ranges_valid(const CaelusNeuralInputV1& input) noexcept {
    if (input.struct_size != sizeof(CaelusNeuralInputV1) ||
        input.neural_abi_version != CAELUS_NEURAL_ABI_V1 ||
        input.feature_schema_version != CAELUS_FEATURE_SCHEMA_V1 ||
        input.history_length != CAELUS_NEURAL_HISTORY_TICKS_V1 ||
        input.node_count == 0 ||
        input.node_count > CAELUS_NEURAL_MAX_NODES_V1 ||
        input.edge_count > CAELUS_NEURAL_MAX_EDGES_V1 ||
        input.lever_count > CAELUS_NEURAL_MAX_LEVERS_V1 ||
        (input.node_count != 0 && input.nodes == nullptr) ||
        (input.edge_count != 0 && input.edges == nullptr) ||
        (input.lever_count != 0 && input.levers == nullptr)) {
        return false;
    }
    for (uint32_t i = 0; i < input.node_count; ++i) {
        if (!node_input_ranges_valid(input.nodes[i]) ||
            input.nodes[i].node_index != i ||
            std::memchr(input.nodes[i].node_id, '\0',
                        CAELUS_NEURAL_ID_BYTES_V1) == nullptr) {
            return false;
        }
    }
    for (uint32_t i = 0; i < input.edge_count; ++i) {
        const auto& edge = input.edges[i];
        if (edge.struct_size != sizeof(CaelusNeuralEdgeInputV1) ||
            edge.source_index >= input.node_count ||
            edge.destination_index >= input.node_count ||
            edge.active > 1u ||
            edge.delay_ticks < 0 ||
            edge.multiplier_fp < 0) {
            return false;
        }
    }
    for (uint32_t i = 0; i < input.lever_count; ++i) {
        const auto& lever = input.levers[i];
        if (lever.struct_size != sizeof(CaelusNeuralLeverInputV1) ||
            lever.lever_index != i ||
            std::memchr(lever.lever_id, '\0',
                        CAELUS_NEURAL_ID_BYTES_V1) == nullptr ||
            !probability_in_range(lever.success_probability_fp) ||
            lever.cost_ticks < 0 ||
            lever.remaining_lockout < 0 ||
            lever.available > 1u) {
            return false;
        }
    }
    return true;
}

inline bool output_ranges_valid(const CaelusNeuralInputV1& input,
                                const CaelusNeuralOutputBufferV1& output,
                                const CaelusNeuralPolicyV1& policy) noexcept {
    if (!input_ranges_valid(input) || !policy_ranges_valid(policy) ||
        output.struct_size != sizeof(CaelusNeuralOutputBufferV1) ||
        output.output_schema_version != CAELUS_NEURAL_OUTPUT_V1 ||
        output.runtime_status != CAELUS_NEURAL_STATUS_OK ||
        output.node_count != input.node_count ||
        output.node_count > CAELUS_NEURAL_MAX_NODES_V1 ||
        output.proposal_count > output.node_count ||
        output.lever_score_count > input.lever_count ||
        output.lever_score_count > CAELUS_NEURAL_MAX_LEVERS_V1) {
        return false;
    }
    for (uint32_t i = 0; i < output.node_count; ++i) {
        const auto& n = output.nodes[i];
        if (n.node_index != i || n.estimated_true_state_fp < 0 ||
            n.estimated_true_state_fp > input.nodes[i].capacity_fp ||
            !probability_in_range(n.telemetry_anomaly_score_fp) ||
            !probability_in_range(n.confidence_fp) ||
            !probability_in_range(n.out_of_distribution_score_fp) ||
            !probability_in_range(n.outage_probability_short_fp) ||
            !probability_in_range(n.outage_probability_medium_fp) ||
            !probability_in_range(n.outage_probability_long_fp)) {
            return false;
        }
    }
    bool proposal_seen[CAELUS_NEURAL_MAX_NODES_V1] = {};
    for (uint32_t i = 0; i < output.proposal_count; ++i) {
        const auto& p = output.proposals[i];
        if (p.node_index >= input.node_count || proposal_seen[p.node_index]) {
            return false;
        }
        proposal_seen[p.node_index] = true;
        const int64_t policy_limit = policy.maximum_abs_trust_delta_fp;
        if (p.kind != CAELUS_NEURAL_PROPOSAL_TRUST_DELTA ||
            policy.allow_bounded_trust_adjustment == 0u ||
            p.authorized_min_fp > p.authorized_max_fp ||
            p.proposed_delta_fp < p.authorized_min_fp ||
            p.proposed_delta_fp > p.authorized_max_fp ||
            p.authorized_min_fp < -policy_limit ||
            p.authorized_max_fp > policy_limit ||
            p.proposed_delta_fp < -policy_limit ||
            p.proposed_delta_fp > policy_limit) {
            return false;
        }
        // proposed_delta_fp is now proven to be within +/-50,000, so all
        // following negation/addition is defined even for adversarial inputs
        // such as INT64_MIN.
        const int64_t current_trust = input.nodes[p.node_index].trust_fp;
        const bool post_add_overflow =
            (p.proposed_delta_fp > 0 && current_trust > kFpOne - p.proposed_delta_fp) ||
            (p.proposed_delta_fp < 0 && current_trust < -p.proposed_delta_fp);
        if (post_add_overflow ||
            current_trust + p.proposed_delta_fp < kFpZero ||
            current_trust + p.proposed_delta_fp > kFpOne) {
            return false;
        }
    }
    for (uint32_t i = 0; i < output.lever_score_count; ++i) {
        const auto& score = output.lever_scores[i];
        if (score.lever_index >= input.lever_count ||
            !probability_in_range(score.score_fp)) {
            return false;
        }
    }
    return true;
}

inline bool output_ranges_valid(const CaelusNeuralInputV1& input,
                                const CaelusNeuralOutputBufferV1& output) noexcept {
    const auto policy = default_assurance_policy();
    return output_ranges_valid(input, output, policy);
}

static_assert(sizeof(int64_t) == 8, "neural contract requires 64-bit int64_t");
static_assert(sizeof(uint32_t) == 4, "neural contract requires 32-bit uint32_t");
static_assert(sizeof(uint64_t) == 8, "neural contract requires 64-bit uint64_t");

} // namespace caelus::neural
