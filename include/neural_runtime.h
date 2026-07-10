/**
 * CAELUS OS — Deterministic fixed-point neural assurance runtime V1.
 *
 * Supported architecture:
 *   temporal feature projection (16 -> 32)
 *   two integer graph message-passing layers (32 -> 32)
 *   node heads: hidden-state estimate, anomaly, confidence, OOD, trust proposal
 *   pooled heads: short/medium/long outage risk
 *   lever-ranking head
 *
 * Operators are deliberately minimal.  All weights are INT8, biases INT32 and
 * accumulation INT64.  Division truncates toward zero.  Activations are
 * explicit bounded integer functions.  There are no floats, threads, fused
 * vendor kernels, NaN/Infinity states, or executable model code.
 */
#pragma once

#include <array>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

#include "causal_engine.h"
#include "neural_contract.h"
#include "neural_hash.h"
#include "neural_model.h"

namespace caelus::neural {

namespace runtime_detail {

static constexpr size_t kWInput = 0;
static constexpr size_t kWMessage0Self = 512;
static constexpr size_t kWMessage0Neighbor = 1'536;
static constexpr size_t kWMessage1Self = 2'560;
static constexpr size_t kWMessage1Neighbor = 3'584;
static constexpr size_t kWNodeHeads = 4'608;
static constexpr size_t kWOutageHeads = 4'768;
static constexpr size_t kWLeverHead = 4'864;

static constexpr size_t kBInput = 0;
static constexpr size_t kBMessage0 = 32;
static constexpr size_t kBMessage1 = 64;
static constexpr size_t kBNodeHeads = 96;
static constexpr size_t kBOutageHeads = 101;
static constexpr size_t kBLeverHead = 104;

static_assert(kWLeverHead + 35 == kExpectedWeightCountV1,
              "V1 weight layout must consume the exact manifest count");
static_assert(kBLeverHead + 1 == kExpectedBiasCountV1,
              "V1 bias layout must consume the exact manifest count");

inline int32_t read_i32_le(const uint8_t* p) noexcept {
    const uint32_t bits = model_detail::read_u32_le(p);
    if (bits <= static_cast<uint32_t>((std::numeric_limits<int32_t>::max)())) {
        return static_cast<int32_t>(bits);
    }
    return -1 - static_cast<int32_t>(
        (std::numeric_limits<uint32_t>::max)() - bits);
}

inline int16_t read_i8_value(uint8_t bits) noexcept {
    return bits <= 0x7fu
        ? static_cast<int16_t>(bits)
        : static_cast<int16_t>(-1 - static_cast<int16_t>(0xffu - bits));
}

inline int64_t sat_add_i64(int64_t a, int64_t b, uint32_t& saturations) noexcept {
    constexpr int64_t kMax = (std::numeric_limits<int64_t>::max)();
    constexpr int64_t kMin = (std::numeric_limits<int64_t>::min)();
    if (b > 0 && a > kMax - b) {
        ++saturations;
        return kMax;
    }
    if (b < 0 && a < kMin - b) {
        ++saturations;
        return kMin;
    }
    return a + b;
}

inline int64_t clamp_activation(int64_t value, int64_t lo, int64_t hi,
                                uint32_t& saturations) noexcept {
    if (value < lo) {
        ++saturations;
        return lo;
    }
    if (value > hi) {
        ++saturations;
        return hi;
    }
    return value;
}

inline int64_t hard_sigmoid_fp(int64_t value, uint32_t& saturations) noexcept {
    const int64_t shifted = sat_add_i64(value, CAELUS_NEURAL_FP_SCALE, saturations);
    return clamp_activation(shifted / 2, 0, CAELUS_NEURAL_FP_SCALE, saturations);
}

inline int64_t fp_ratio(int64_t value, int64_t capacity) noexcept {
    if (capacity <= 0) return 0;
    return causal::fp_clamp(causal::fp_div(value, capacity),
                            -CAELUS_NEURAL_FP_SCALE, CAELUS_NEURAL_FP_SCALE);
}

inline int64_t saturating_sub_i64(int64_t lhs, int64_t rhs) noexcept {
    constexpr int64_t kMax = (std::numeric_limits<int64_t>::max)();
    constexpr int64_t kMin = (std::numeric_limits<int64_t>::min)();
    if (rhs > 0 && lhs < kMin + rhs) return kMin;
    if (rhs < 0 && lhs > kMax + rhs) return kMax;
    return lhs - rhs;
}

inline uint32_t bit_count_u32(uint32_t value) noexcept {
    uint32_t count = 0;
    while (value != 0u) {
        count += value & 1u;
        value >>= 1u;
    }
    return count;
}

using FeatureVector = std::array<int64_t, CAELUS_NEURAL_FEATURES_V1>;
using HiddenVector = std::array<int64_t, CAELUS_NEURAL_HIDDEN_V1>;
using HiddenMatrix = std::vector<HiddenVector>;

inline FeatureVector encode_features(const CaelusNeuralNodeInputV1& node) noexcept {
    FeatureVector feature{};
    feature[0] = fp_ratio(node.authoritative_state_fp, node.capacity_fp);
    feature[1] =
        (node.missing_mask & CAELUS_NEURAL_MISSING_REPORTED_STATE) != 0u
            ? 0 : fp_ratio(node.reported_state_fp, node.capacity_fp);
    feature[2] = node.trust_fp;
    if ((node.missing_mask & CAELUS_NEURAL_MISSING_STATE_HISTORY) == 0u) {
        feature[3] = fp_ratio(
            node.state_history_fp[CAELUS_NEURAL_HISTORY_TICKS_V1 - 1u],
            node.capacity_fp);
        const int64_t newest =
            node.state_history_fp[CAELUS_NEURAL_HISTORY_TICKS_V1 - 1u];
        const int64_t oldest = node.state_history_fp[0];
        const int64_t delta = saturating_sub_i64(newest, oldest);
        feature[5] = fp_ratio(delta, node.capacity_fp);
    }
    if ((node.missing_mask & CAELUS_NEURAL_MISSING_REPORTED_HISTORY) == 0u) {
        feature[4] = fp_ratio(
            node.reported_history_fp[CAELUS_NEURAL_HISTORY_TICKS_V1 - 1u],
            node.capacity_fp);
        const int64_t newest =
            node.reported_history_fp[CAELUS_NEURAL_HISTORY_TICKS_V1 - 1u];
        const int64_t oldest = node.reported_history_fp[0];
        const int64_t delta = saturating_sub_i64(newest, oldest);
        feature[6] = fp_ratio(delta, node.capacity_fp);
    }
    if ((node.missing_mask & CAELUS_NEURAL_MISSING_FLOW) == 0u) {
        feature[7] = causal::fp_clamp(
            node.incoming_flow_fp, -CAELUS_NEURAL_FP_SCALE, CAELUS_NEURAL_FP_SCALE);
        feature[8] = causal::fp_clamp(
            node.outgoing_flow_fp, -CAELUS_NEURAL_FP_SCALE, CAELUS_NEURAL_FP_SCALE);
    }
    feature[9] = node.queue_utilization_fp;
    feature[10] =
        (node.missing_mask & CAELUS_NEURAL_MISSING_DEADLINE) == 0u
            ? node.deadline_distance_fp : 0;
    feature[11] =
        (node.missing_mask & CAELUS_NEURAL_MISSING_HYSTERESIS) == 0u
            ? node.hysteresis_distance_fp : 0;
    feature[12] = node.outage_latched_fp;
    feature[13] =
        (node.missing_mask & CAELUS_NEURAL_MISSING_INTEL) == 0u
            ? node.intel_risk_fp : 0;
    feature[14] = static_cast<int64_t>(
        bit_count_u32(node.missing_mask & kKnownMissingMaskV1)) *
        CAELUS_NEURAL_FP_SCALE / 7;
    feature[15] = static_cast<int64_t>(node.node_kind) *
                  CAELUS_NEURAL_FP_SCALE / 5;
    return feature;
}

struct StepBudget {
    uint64_t used = 0;
    uint64_t limit = 0;

    bool consume(uint64_t count) noexcept {
        if (used > limit || count > limit - used) return false;
        used += count;
        return true;
    }
};

struct ModelView {
    std::vector<int16_t> weights;
    std::array<int32_t, kExpectedBiasCountV1> biases{};
    uint32_t denominator = 0;

    bool load(const NeuralModelPackage& package) noexcept {
        const auto& package_weights = package.weights();
        const auto& manifest = package.manifest();
        std::string validation_error;
        if (!package.trusted() ||
            package_weights.size() !=
                kWeightsHeaderBytesV1 + kExpectedWeightCountV1 +
                kExpectedBiasCountV1 * 4u ||
            manifest.weight_scale_denominator == 0u ||
            !model_detail::validate_weights_header(
                package_weights, manifest, validation_error)) {
            return false;
        }
        weights.resize(kExpectedWeightCountV1);
        for (size_t i = 0; i < weights.size(); ++i) {
            weights[i] = read_i8_value(
                package_weights[kWeightsHeaderBytesV1 + i]);
        }
        const uint8_t* bias_bytes =
            package_weights.data() + kWeightsHeaderBytesV1 + kExpectedWeightCountV1;
        for (size_t i = 0; i < biases.size(); ++i) {
            biases[i] = read_i32_le(bias_bytes + i * 4u);
        }
        denominator = manifest.weight_scale_denominator;
        return true;
    }
};

template <size_t N>
inline bool linear(const std::array<int64_t, N>& input,
                   const int16_t* weights,
                   int32_t bias,
                   uint32_t denominator,
                   StepBudget& budget,
                   uint32_t& saturations,
                   int64_t& output) noexcept {
    if (!budget.consume(N)) return false;
    int64_t accumulator = static_cast<int64_t>(bias);
    for (size_t i = 0; i < N; ++i) {
        const int64_t term = input[i] * static_cast<int64_t>(weights[i]);
        accumulator = sat_add_i64(accumulator, term, saturations);
    }
    output = accumulator / static_cast<int64_t>(denominator);
    return true;
}

inline bool linear_pair(const HiddenVector& self,
                        const HiddenVector& neighbor,
                        const int16_t* self_weights,
                        const int16_t* neighbor_weights,
                        int32_t bias,
                        uint32_t denominator,
                        StepBudget& budget,
                        uint32_t& saturations,
                        int64_t& output) noexcept {
    if (!budget.consume(CAELUS_NEURAL_HIDDEN_V1 * 2u)) return false;
    int64_t accumulator = static_cast<int64_t>(bias);
    for (size_t i = 0; i < CAELUS_NEURAL_HIDDEN_V1; ++i) {
        accumulator = sat_add_i64(
            accumulator, self[i] * static_cast<int64_t>(self_weights[i]),
            saturations);
        accumulator = sat_add_i64(
            accumulator, neighbor[i] * static_cast<int64_t>(neighbor_weights[i]),
            saturations);
    }
    output = accumulator / static_cast<int64_t>(denominator);
    return true;
}

inline bool aggregate_messages(const CaelusNeuralInputV1& input,
                               const HiddenMatrix& hidden,
                               HiddenMatrix& message,
                               StepBudget& budget,
                               uint32_t& saturations) noexcept {
    message.assign(input.node_count, HiddenVector{});
    std::array<uint32_t, CAELUS_NEURAL_MAX_NODES_V1> incoming_count{};
    for (uint32_t e = 0; e < input.edge_count; ++e) {
        const auto& edge = input.edges[e];
        if (edge.active == 0u) continue;
        if (!budget.consume(CAELUS_NEURAL_HIDDEN_V1 * 3u)) return false;
        const int64_t delay_denominator =
            (static_cast<int64_t>(edge.delay_ticks) + 1) * CAELUS_NEURAL_FP_SCALE;
        const int64_t delay_factor =
            causal::fp_div(CAELUS_NEURAL_FP_SCALE, delay_denominator);
        for (size_t h = 0; h < CAELUS_NEURAL_HIDDEN_V1; ++h) {
            int64_t value = causal::fp_mul(
                hidden[edge.source_index][h], edge.multiplier_fp);
            value = causal::fp_mul(value, delay_factor);
            message[edge.destination_index][h] = sat_add_i64(
                message[edge.destination_index][h], value, saturations);
        }
        ++incoming_count[edge.destination_index];
    }
    for (uint32_t n = 0; n < input.node_count; ++n) {
        if (incoming_count[n] == 0u) continue;
        if (!budget.consume(CAELUS_NEURAL_HIDDEN_V1)) return false;
        for (size_t h = 0; h < CAELUS_NEURAL_HIDDEN_V1; ++h) {
            message[n][h] /= static_cast<int64_t>(incoming_count[n]);
        }
    }
    return true;
}

} // namespace runtime_detail

class DeterministicNeuralRuntimeV1 {
public:
    static CaelusNeuralOutputBufferV1 infer(
        const NeuralModelPackage& package,
        const NeuralInputSnapshotV1& snapshot,
        const CaelusNeuralPolicyV1& policy) noexcept {
        using namespace runtime_detail;
        const CaelusNeuralInputV1 input = snapshot.view();
        CaelusNeuralOutputBufferV1 output{};
        output.struct_size = sizeof(output);
        output.output_schema_version = CAELUS_NEURAL_OUTPUT_V1;
        output.tick = input.tick;
        output.feature_schema_version = input.feature_schema_version;
        std::memcpy(output.model_hash, package.package_hash().data(),
                    sizeof(output.model_hash));
        std::memcpy(output.scenario_hash, input.scenario_hash,
                    sizeof(output.scenario_hash));
        auto fail_without_partial_output =
            [&](uint32_t status) noexcept {
                CaelusNeuralOutputBufferV1 failed{};
                failed.struct_size = sizeof(failed);
                failed.output_schema_version = CAELUS_NEURAL_OUTPUT_V1;
                failed.runtime_status = status;
                failed.saturation_count = output.saturation_count;
                failed.tick = output.tick;
                failed.feature_schema_version = output.feature_schema_version;
                std::memcpy(failed.model_hash, output.model_hash,
                            sizeof(failed.model_hash));
                std::memcpy(failed.scenario_hash, output.scenario_hash,
                            sizeof(failed.scenario_hash));
                std::memcpy(failed.input_hash, output.input_hash,
                            sizeof(failed.input_hash));
                return failed;
            };

        if (!package.trusted()) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_MODEL_UNTRUSTED);
        }
        if (!input_ranges_valid(input) || !policy_ranges_valid(policy)) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_MALFORMED_INPUT);
        }
        if (!hash_detail::input_hash(input, output.input_hash)) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_RUNTIME_FAILURE);
        }
        if (policy.mode != CAELUS_NEURAL_MODE_ASSURANCE) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_RUNTIME_FAILURE);
        }
        if (input.missing_value_count > policy.max_missing_values) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_MALFORMED_INPUT);
        }
        ModelView model;
        if (!model.load(package)) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_DIMENSION_MISMATCH);
        }

        StepBudget budget{0, policy.max_inference_steps};
        HiddenMatrix hidden(input.node_count);
        HiddenMatrix next(input.node_count);
        HiddenMatrix message(input.node_count);

        for (uint32_t n = 0; n < input.node_count; ++n) {
            if (!budget.consume(CAELUS_NEURAL_FEATURES_V1)) {
                return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
            }
            const FeatureVector feature = encode_features(input.nodes[n]);
            for (size_t h = 0; h < CAELUS_NEURAL_HIDDEN_V1; ++h) {
                int64_t value = 0;
                if (!linear(feature,
                            model.weights.data() + kWInput +
                                h * CAELUS_NEURAL_FEATURES_V1,
                            model.biases[kBInput + h], model.denominator,
                            budget, output.saturation_count, value)) {
                    return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
                }
                hidden[n][h] = clamp_activation(
                    value, 0, CAELUS_NEURAL_FP_SCALE, output.saturation_count);
            }
        }

        for (size_t layer = 0; layer < 2; ++layer) {
            if (!aggregate_messages(
                    input, hidden, message, budget, output.saturation_count)) {
                return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
            }
            const size_t self_base =
                layer == 0 ? kWMessage0Self : kWMessage1Self;
            const size_t neighbor_base =
                layer == 0 ? kWMessage0Neighbor : kWMessage1Neighbor;
            const size_t bias_base =
                layer == 0 ? kBMessage0 : kBMessage1;
            for (uint32_t n = 0; n < input.node_count; ++n) {
                for (size_t h = 0; h < CAELUS_NEURAL_HIDDEN_V1; ++h) {
                    int64_t value = 0;
                    if (!linear_pair(
                            hidden[n], message[n],
                            model.weights.data() + self_base +
                                h * CAELUS_NEURAL_HIDDEN_V1,
                            model.weights.data() + neighbor_base +
                                h * CAELUS_NEURAL_HIDDEN_V1,
                            model.biases[bias_base + h], model.denominator,
                            budget, output.saturation_count, value)) {
                        return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
                    }
                    next[n][h] = clamp_activation(
                        value, 0, CAELUS_NEURAL_FP_SCALE, output.saturation_count);
                }
            }
            hidden = next;
            next.assign(input.node_count, HiddenVector{});
        }

        HiddenVector pooled{};
        if (!budget.consume(
                static_cast<uint64_t>(input.node_count) *
                    CAELUS_NEURAL_HIDDEN_V1 +
                CAELUS_NEURAL_HIDDEN_V1)) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
        }
        for (uint32_t n = 0; n < input.node_count; ++n) {
            for (size_t h = 0; h < CAELUS_NEURAL_HIDDEN_V1; ++h) {
                pooled[h] = sat_add_i64(
                    pooled[h], hidden[n][h], output.saturation_count);
            }
        }
        for (auto& value : pooled) value /= static_cast<int64_t>(input.node_count);

        std::array<int64_t, 3> outage{};
        for (size_t head = 0; head < outage.size(); ++head) {
            int64_t value = 0;
            if (!linear(pooled,
                        model.weights.data() + kWOutageHeads +
                            head * CAELUS_NEURAL_HIDDEN_V1,
                        model.biases[kBOutageHeads + head], model.denominator,
                        budget, output.saturation_count, value)) {
                return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
            }
            outage[head] = hard_sigmoid_fp(value, output.saturation_count);
        }

        output.node_count = input.node_count;
        for (uint32_t n = 0; n < input.node_count; ++n) {
            std::array<int64_t, 5> heads{};
            for (size_t head = 0; head < heads.size(); ++head) {
                if (!linear(hidden[n],
                            model.weights.data() + kWNodeHeads +
                                head * CAELUS_NEURAL_HIDDEN_V1,
                            model.biases[kBNodeHeads + head], model.denominator,
                            budget, output.saturation_count, heads[head])) {
                    return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
                }
            }
            auto& node = output.nodes[n];
            node.node_index = n;
            const int64_t estimated_ratio =
                hard_sigmoid_fp(heads[0], output.saturation_count);
            node.estimated_true_state_fp = causal::fp_mul(
                estimated_ratio, input.nodes[n].capacity_fp);
            node.telemetry_anomaly_score_fp =
                hard_sigmoid_fp(heads[1], output.saturation_count);
            node.confidence_fp =
                hard_sigmoid_fp(heads[2], output.saturation_count);
            node.out_of_distribution_score_fp =
                hard_sigmoid_fp(heads[3], output.saturation_count);
            node.outage_probability_short_fp = outage[0];
            node.outage_probability_medium_fp = outage[1];
            node.outage_probability_long_fp = outage[2];

            if (policy.allow_bounded_trust_adjustment != 0u) {
                const int64_t policy_limit = policy.maximum_abs_trust_delta_fp;
                const int64_t lower =
                    input.nodes[n].trust_fp < policy_limit
                        ? -input.nodes[n].trust_fp : -policy_limit;
                const int64_t upper =
                    CAELUS_NEURAL_FP_SCALE - input.nodes[n].trust_fp < policy_limit
                        ? CAELUS_NEURAL_FP_SCALE - input.nodes[n].trust_fp
                        : policy_limit;
                auto& proposal = output.proposals[output.proposal_count++];
                proposal.kind = CAELUS_NEURAL_PROPOSAL_TRUST_DELTA;
                proposal.node_index = n;
                proposal.authorized_min_fp = lower;
                proposal.authorized_max_fp = upper;
                proposal.proposed_delta_fp = clamp_activation(
                    heads[4], lower, upper, output.saturation_count);
            }
        }

        output.lever_score_count = input.lever_count;
        for (uint32_t l = 0; l < input.lever_count; ++l) {
            std::array<int64_t, CAELUS_NEURAL_HIDDEN_V1 + 3> lever_feature{};
            for (size_t h = 0; h < CAELUS_NEURAL_HIDDEN_V1; ++h)
                lever_feature[h] = pooled[h];
            lever_feature[CAELUS_NEURAL_HIDDEN_V1] =
                input.levers[l].success_probability_fp;
            lever_feature[CAELUS_NEURAL_HIDDEN_V1 + 1] =
                input.levers[l].available != 0u ? CAELUS_NEURAL_FP_SCALE : 0;
            const int64_t cost_denominator =
                (static_cast<int64_t>(input.levers[l].cost_ticks) + 1) *
                CAELUS_NEURAL_FP_SCALE;
            lever_feature[CAELUS_NEURAL_HIDDEN_V1 + 2] =
                causal::fp_div(CAELUS_NEURAL_FP_SCALE, cost_denominator);
            int64_t score = 0;
            if (!linear(lever_feature, model.weights.data() + kWLeverHead,
                        model.biases[kBLeverHead], model.denominator,
                        budget, output.saturation_count, score)) {
                return fail_without_partial_output(CAELUS_NEURAL_STATUS_TIMEOUT);
            }
            output.lever_scores[l].lever_index = l;
            output.lever_scores[l].score_fp =
                hard_sigmoid_fp(score, output.saturation_count);
        }

        output.runtime_status = CAELUS_NEURAL_STATUS_OK;
        if (!output_ranges_valid(input, output, policy)) {
            return fail_without_partial_output(CAELUS_NEURAL_STATUS_RUNTIME_FAILURE);
        }
        return output;
    }
};

} // namespace caelus::neural
