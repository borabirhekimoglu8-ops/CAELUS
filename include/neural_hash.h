/**
 * Stable Blake3 commitments for neural inputs and outputs.
 *
 * Serialization is field-by-field little-endian and excludes native pointers,
 * padding, and reserved bytes.  The Rust mirror is
 * `caelus_core/src/neural_hash.rs`.
 */
#pragma once

#include <cstdint>
#include <cstring>
#include <vector>

#include "neural_contract.h"

extern "C" uint8_t caelus_blake3_hash(
    const uint8_t* data, size_t data_len, uint8_t* out_hash32);

namespace caelus::neural::hash_detail {

inline void append_u32(std::vector<uint8_t>& out, uint32_t value) {
    for (size_t i = 0; i < 4; ++i)
        out.push_back(static_cast<uint8_t>(value >> (i * 8u)));
}

inline void append_u64(std::vector<uint8_t>& out, uint64_t value) {
    for (size_t i = 0; i < 8; ++i)
        out.push_back(static_cast<uint8_t>(value >> (i * 8u)));
}

inline void append_i64(std::vector<uint8_t>& out, int64_t value) {
    append_u64(out, static_cast<uint64_t>(value));
}

inline void append_fixed_string(std::vector<uint8_t>& out,
                                const char* value, size_t capacity) {
    size_t length = 0;
    while (length < capacity && value[length] != '\0') ++length;
    append_u32(out, static_cast<uint32_t>(length));
    out.insert(out.end(), value, value + length);
}

inline void append_bytes(std::vector<uint8_t>& out,
                         const uint8_t* data, size_t length) {
    out.insert(out.end(), data, data + length);
}

inline std::vector<uint8_t> serialize_input(const CaelusNeuralInputV1& input) {
    static constexpr uint8_t kDomain[] = "CAELUS_NEURAL_INPUT_V1";
    std::vector<uint8_t> bytes;
    if (!input_ranges_valid(input)) return bytes;
    bytes.reserve(256u + input.node_count * 320u +
                  input.edge_count * 32u + input.lever_count * 96u);
    append_bytes(bytes, kDomain, sizeof(kDomain));
    append_u32(bytes, input.neural_abi_version);
    append_u32(bytes, input.feature_schema_version);
    append_u32(bytes, input.history_length);
    append_u64(bytes, input.tick);
    append_fixed_string(bytes, input.scenario_id, sizeof(input.scenario_id));
    append_bytes(bytes, input.scenario_hash, sizeof(input.scenario_hash));
    append_fixed_string(bytes, input.engine_version, sizeof(input.engine_version));
    append_u32(bytes, input.node_count);
    append_u32(bytes, input.edge_count);
    append_u32(bytes, input.lever_count);
    append_u32(bytes, input.missing_value_count);
    for (uint32_t i = 0; i < input.node_count; ++i) {
        const auto& node = input.nodes[i];
        append_u32(bytes, node.missing_mask);
        append_u32(bytes, node.node_index);
        append_u32(bytes, node.node_kind);
        append_fixed_string(bytes, node.node_id, sizeof(node.node_id));
        append_i64(bytes, node.capacity_fp);
        append_i64(bytes, node.authoritative_state_fp);
        append_i64(bytes, node.reported_state_fp);
        append_i64(bytes, node.trust_fp);
        append_i64(bytes, node.incoming_flow_fp);
        append_i64(bytes, node.outgoing_flow_fp);
        append_i64(bytes, node.queue_utilization_fp);
        append_i64(bytes, node.deadline_distance_fp);
        append_i64(bytes, node.hysteresis_distance_fp);
        append_i64(bytes, node.outage_latched_fp);
        append_i64(bytes, node.intel_risk_fp);
        for (int64_t value : node.state_history_fp) append_i64(bytes, value);
        for (int64_t value : node.reported_history_fp) append_i64(bytes, value);
    }
    for (uint32_t i = 0; i < input.edge_count; ++i) {
        const auto& edge = input.edges[i];
        append_u32(bytes, edge.source_index);
        append_u32(bytes, edge.destination_index);
        append_u32(bytes, edge.active);
        append_u32(bytes, static_cast<uint32_t>(edge.delay_ticks));
        append_i64(bytes, edge.multiplier_fp);
    }
    for (uint32_t i = 0; i < input.lever_count; ++i) {
        const auto& lever = input.levers[i];
        append_u32(bytes, lever.lever_index);
        append_fixed_string(bytes, lever.lever_id, sizeof(lever.lever_id));
        append_i64(bytes, lever.success_probability_fp);
        append_u32(bytes, static_cast<uint32_t>(lever.cost_ticks));
        append_u32(bytes, static_cast<uint32_t>(lever.remaining_lockout));
        append_u32(bytes, lever.available);
    }
    return bytes;
}

inline std::vector<uint8_t> serialize_output(
    const CaelusNeuralOutputBufferV1& output) {
    static constexpr uint8_t kDomain[] = "CAELUS_NEURAL_OUTPUT_V1";
    std::vector<uint8_t> bytes;
    if (output.node_count > CAELUS_NEURAL_MAX_NODES_V1 ||
        output.proposal_count > CAELUS_NEURAL_MAX_NODES_V1 ||
        output.lever_score_count > CAELUS_NEURAL_MAX_LEVERS_V1) {
        return bytes;
    }
    bytes.reserve(192u + output.node_count * 64u +
                  output.proposal_count * 40u +
                  output.lever_score_count * 16u);
    append_bytes(bytes, kDomain, sizeof(kDomain));
    append_u32(bytes, output.output_schema_version);
    append_u32(bytes, output.runtime_status);
    append_u32(bytes, output.saturation_count);
    append_u64(bytes, output.tick);
    append_u32(bytes, output.feature_schema_version);
    append_bytes(bytes, output.model_hash, sizeof(output.model_hash));
    append_bytes(bytes, output.scenario_hash, sizeof(output.scenario_hash));
    append_bytes(bytes, output.input_hash, sizeof(output.input_hash));
    append_u32(bytes, output.node_count);
    append_u32(bytes, output.proposal_count);
    append_u32(bytes, output.lever_score_count);
    for (uint32_t i = 0; i < output.node_count; ++i) {
        const auto& node = output.nodes[i];
        append_u32(bytes, node.node_index);
        append_i64(bytes, node.estimated_true_state_fp);
        append_i64(bytes, node.telemetry_anomaly_score_fp);
        append_i64(bytes, node.confidence_fp);
        append_i64(bytes, node.out_of_distribution_score_fp);
        append_i64(bytes, node.outage_probability_short_fp);
        append_i64(bytes, node.outage_probability_medium_fp);
        append_i64(bytes, node.outage_probability_long_fp);
    }
    for (uint32_t i = 0; i < output.proposal_count; ++i) {
        const auto& proposal = output.proposals[i];
        append_u32(bytes, proposal.kind);
        append_u32(bytes, proposal.node_index);
        append_i64(bytes, proposal.proposed_delta_fp);
        append_i64(bytes, proposal.authorized_min_fp);
        append_i64(bytes, proposal.authorized_max_fp);
    }
    for (uint32_t i = 0; i < output.lever_score_count; ++i) {
        append_u32(bytes, output.lever_scores[i].lever_index);
        append_i64(bytes, output.lever_scores[i].score_fp);
    }
    return bytes;
}

inline std::vector<uint8_t> serialize_policy(
    const CaelusNeuralPolicyV1& policy) {
    static constexpr uint8_t kDomain[] = "CAELUS_NEURAL_POLICY_V1";
    std::vector<uint8_t> bytes;
    bytes.reserve(80u);
    append_bytes(bytes, kDomain, sizeof(kDomain));
    append_u32(bytes, policy.policy_version);
    append_u32(bytes, policy.mode);
    append_u32(bytes, policy.require_trusted_model);
    append_u32(bytes, policy.allow_bounded_trust_adjustment);
    append_u32(bytes, policy.max_missing_values);
    append_u64(bytes, policy.max_inference_steps);
    append_i64(bytes, policy.minimum_confidence_fp);
    append_i64(bytes, policy.maximum_ood_fp);
    append_i64(bytes, policy.maximum_abs_trust_delta_fp);
    return bytes;
}

inline bool hash_bytes(const std::vector<uint8_t>& bytes,
                       uint8_t out_hash[CAELUS_NEURAL_HASH_BYTES_V1]) noexcept {
    return !bytes.empty() &&
           caelus_blake3_hash(bytes.data(), bytes.size(), out_hash) == 1u;
}

inline bool input_hash(const CaelusNeuralInputV1& input,
                       uint8_t out_hash[CAELUS_NEURAL_HASH_BYTES_V1]) noexcept {
    try {
        return hash_bytes(serialize_input(input), out_hash);
    } catch (...) {
        return false;
    }
}

inline bool output_hash(const CaelusNeuralOutputBufferV1& output,
                        uint8_t out_hash[CAELUS_NEURAL_HASH_BYTES_V1]) noexcept {
    try {
        return hash_bytes(serialize_output(output), out_hash);
    } catch (...) {
        return false;
    }
}

inline bool policy_hash(const CaelusNeuralPolicyV1& policy,
                        uint8_t out_hash[CAELUS_NEURAL_HASH_BYTES_V1]) noexcept {
    try {
        return hash_bytes(serialize_policy(policy), out_hash);
    } catch (...) {
        return false;
    }
}

inline bool hash_equal(const uint8_t* lhs, const uint8_t* rhs,
                       size_t length = CAELUS_NEURAL_HASH_BYTES_V1) noexcept {
    uint8_t difference = 0;
    for (size_t i = 0; i < length; ++i)
        difference |= static_cast<uint8_t>(lhs[i] ^ rhs[i]);
    return difference == 0;
}

} // namespace caelus::neural::hash_detail
