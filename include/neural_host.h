/**
 * CAELUS OS — Production host integration for Neural ABI V1.
 *
 * The controller owns graph-history extraction, signed-model inference, the
 * central Neural Gate, and the single bounded write path back into the
 * symbolic authority.  Symbolic-only mode never loads or invokes a model.
 */
#pragma once

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "causal_engine.h"
#include "neural_gate.h"
#include "neural_runtime.h"

namespace caelus::neural {

struct AppliedTrustProposalV1 {
    uint32_t node_index = 0;
    std::string node_id;
    int64_t trust_before_fp = 0;
    int64_t delta_fp = 0;
    int64_t trust_after_fp = 0;
};

struct SymbolicLeverEvaluationV1 {
    uint32_t lever_index = 0;
    std::string lever_id;
    int64_t neural_score_fp = 0;
    int64_t symbolic_score_fp = 0;
    bool simulated_success = false;
    bool baseline_outage = false;
    bool candidate_outage = false;
    bool selected = false;
};

struct NeuralNodeTelemetryV1 {
    uint32_t node_index = 0;
    std::string node_id;
    int64_t authoritative_state_fp = 0;
    int64_t reported_state_fp = 0;
    int64_t trust_before_fp = 0;
    int64_t trust_after_fp = 0;
};

struct NeuralTickEvidenceV1 {
    bool attempted = false;
    bool snapshot_valid = false;
    bool duration_measured = false;
    bool authority_record_required = false;
    bool authority_committed = false;
    bool rollback_applied = false;
    bool rollback_failed = false;
    uint64_t tick = 0;
    uint64_t inference_duration_us = 0;
    uint32_t observed_history_ticks = 0;
    CaelusNeuralOutputBufferV1 output{};
    CaelusNeuralGateResultV1 gate{};
    std::vector<AppliedTrustProposalV1> applied_proposals;
    std::vector<SymbolicLeverEvaluationV1> lever_evaluations;
    std::vector<NeuralNodeTelemetryV1> nodes;
    std::string selected_lever_id;
};

inline const char* neural_mode_name(uint32_t mode) noexcept {
    switch (mode) {
        case CAELUS_NEURAL_MODE_SYMBOLIC_ONLY: return "SYMBOLIC_ONLY";
        case CAELUS_NEURAL_MODE_ADVISORY: return "ADVISORY";
        case CAELUS_NEURAL_MODE_ASSURANCE: return "ASSURANCE";
    }
    return "UNKNOWN";
}

inline const char* neural_runtime_status_name(uint32_t status) noexcept {
    switch (status) {
        case CAELUS_NEURAL_STATUS_OK: return "OK";
        case CAELUS_NEURAL_STATUS_MODEL_UNAVAILABLE: return "MODEL_UNAVAILABLE";
        case CAELUS_NEURAL_STATUS_MODEL_UNTRUSTED: return "MODEL_UNTRUSTED";
        case CAELUS_NEURAL_STATUS_SCHEMA_MISMATCH: return "SCHEMA_MISMATCH";
        case CAELUS_NEURAL_STATUS_MALFORMED_INPUT: return "MALFORMED_INPUT";
        case CAELUS_NEURAL_STATUS_UNSUPPORTED_OPERATOR: return "UNSUPPORTED_OPERATOR";
        case CAELUS_NEURAL_STATUS_DIMENSION_MISMATCH: return "DIMENSION_MISMATCH";
        case CAELUS_NEURAL_STATUS_OVERFLOW: return "OVERFLOW";
        case CAELUS_NEURAL_STATUS_TIMEOUT: return "TIMEOUT";
        case CAELUS_NEURAL_STATUS_RUNTIME_FAILURE: return "RUNTIME_FAILURE";
    }
    return "UNKNOWN";
}

inline const char* neural_gate_decision_name(uint32_t decision) noexcept {
    switch (decision) {
        case CAELUS_NEURAL_GATE_ACCEPTED_ADVISORY: return "ACCEPTED_ADVISORY";
        case CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED: return "ACCEPTED_BOUNDED";
        case CAELUS_NEURAL_GATE_REJECTED_LOW_CONFIDENCE: return "REJECTED_LOW_CONFIDENCE";
        case CAELUS_NEURAL_GATE_REJECTED_OOD: return "REJECTED_OOD";
        case CAELUS_NEURAL_GATE_REJECTED_RANGE: return "REJECTED_RANGE";
        case CAELUS_NEURAL_GATE_REJECTED_INVARIANT: return "REJECTED_INVARIANT";
        case CAELUS_NEURAL_GATE_REJECTED_TIMEOUT: return "REJECTED_TIMEOUT";
        case CAELUS_NEURAL_GATE_REJECTED_MODEL_TRUST: return "REJECTED_MODEL_TRUST";
        case CAELUS_NEURAL_GATE_REJECTED_SCHEMA: return "REJECTED_SCHEMA";
        case CAELUS_NEURAL_GATE_REJECTED_RUNTIME: return "REJECTED_RUNTIME";
        case CAELUS_NEURAL_GATE_SYMBOLIC_FALLBACK: return "SYMBOLIC_FALLBACK";
    }
    return "UNKNOWN";
}

inline bool neural_gate_accepted(uint32_t decision) noexcept {
    return decision == CAELUS_NEURAL_GATE_ACCEPTED_ADVISORY ||
           decision == CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED;
}

class NeuralControllerV1 final {
public:
    NeuralControllerV1() {
        policy_ = default_assurance_policy();
        policy_.mode = CAELUS_NEURAL_MODE_SYMBOLIC_ONLY;
    }

    void configure(uint32_t mode,
                   const std::string& model_directory,
                   const std::string& scenario_id,
                   const std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1>& scenario_hash) {
        policy_ = default_assurance_policy();
        policy_.mode = mode;
        scenario_id_ = scenario_id;
        scenario_hash_ = scenario_hash;
        history_.clear();
        history_node_ids_.clear();
        history_initialised_ = false;
        observed_history_ticks_ = 0;
        model_ = NeuralModelPackage{};
        if (mode == CAELUS_NEURAL_MODE_ASSURANCE && !model_directory.empty()) {
            model_ = load_neural_model_package(model_directory);
        }
    }

    bool enabled() const noexcept {
        return policy_.mode != CAELUS_NEURAL_MODE_SYMBOLIC_ONLY;
    }

    uint32_t mode() const noexcept { return policy_.mode; }
    const CaelusNeuralPolicyV1& policy() const noexcept { return policy_; }
    const NeuralModelPackage& model() const noexcept { return model_; }
    const std::string& scenario_id() const noexcept { return scenario_id_; }
    const std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1>& scenario_hash() const noexcept {
        return scenario_hash_;
    }

#ifdef CAELUS_CPP_UNIT_TEST
    void configure_for_test(
        NeuralModelPackage model,
        const std::string& scenario_id,
        const std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1>& scenario_hash) {
        configure(
            CAELUS_NEURAL_MODE_ASSURANCE, std::string(), scenario_id, scenario_hash);
        model_ = std::move(model);
    }

    CaelusNeuralPolicyV1& policy_for_test() noexcept { return policy_; }
#endif

    bool initialise_history(const causal::CausalEngine& engine) {
        const auto& nodes = engine.nodes();
        if (nodes.empty() || nodes.size() > CAELUS_NEURAL_MAX_NODES_V1) return false;
        history_.assign(nodes.size(), NodeHistory{});
        history_node_ids_.clear();
        history_node_ids_.reserve(nodes.size());
        for (size_t i = 0; i < nodes.size(); ++i) {
            if (!identifier_valid(nodes[i].id, CAELUS_NEURAL_ID_BYTES_V1)) return false;
            history_node_ids_.push_back(nodes[i].id);
            // Until eight real observations have been collected these slots
            // remain zero and are explicitly masked in build_snapshot().
            // Repeating the initial sample would fabricate temporal evidence.
            history_[i].authoritative.fill(0);
            history_[i].reported.fill(0);
        }
        history_initialised_ = true;
        observed_history_ticks_ = 0;
        return true;
    }

    bool observe_tick(const causal::CausalEngine& engine) {
        if (!history_matches(engine) && !initialise_history(engine)) return false;
        const auto& nodes = engine.nodes();
        for (size_t i = 0; i < nodes.size(); ++i) {
            auto& history = history_[i];
            std::move(history.authoritative.begin() + 1,
                      history.authoritative.end(), history.authoritative.begin());
            std::move(history.reported.begin() + 1,
                      history.reported.end(), history.reported.begin());
            history.authoritative.back() = nodes[i].state_fp;
            history.reported.back() = nodes[i].reported_state_fp;
        }
        if (observed_history_ticks_ < CAELUS_NEURAL_HISTORY_TICKS_V1) {
            ++observed_history_ticks_;
        }
        return true;
    }

    NeuralTickEvidenceV1 evaluate(causal::CausalEngine& engine,
                                  bool measure_wall_duration) {
        NeuralTickEvidenceV1 evidence;
        evidence.attempted = enabled();
        evidence.tick = engine.current_tick();
        evidence.observed_history_ticks = observed_history_ticks_;
        if (!enabled()) return evidence;

        const auto started = std::chrono::steady_clock::now();
        const auto finish_duration = [&]() {
            if (!measure_wall_duration) return;
            const auto elapsed = std::chrono::steady_clock::now() - started;
            const auto micros =
                std::chrono::duration_cast<std::chrono::microseconds>(elapsed).count();
            evidence.inference_duration_us =
                micros <= 0 ? 0u : static_cast<uint64_t>(micros);
            evidence.duration_measured = true;
        };

        if (!history_matches(engine) && !initialise_history(engine)) {
            evidence.output.struct_size = sizeof(evidence.output);
            evidence.output.output_schema_version = CAELUS_NEURAL_OUTPUT_V1;
            evidence.output.runtime_status = CAELUS_NEURAL_STATUS_MALFORMED_INPUT;
            evidence.output.tick = engine.current_tick();
            evidence.output.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
            evidence.gate = neural_gate_result(
                CAELUS_NEURAL_GATE_REJECTED_SCHEMA,
                CAELUS_NEURAL_STATUS_MALFORMED_INPUT,
                "graph history could not be initialised",
                model_, evidence.output, policy_);
            finish_duration();
            return evidence;
        }

        for (size_t i = 0; i < engine.nodes().size(); ++i) {
            const auto& node = engine.nodes()[i];
            evidence.nodes.push_back(NeuralNodeTelemetryV1{
                static_cast<uint32_t>(i), node.id, node.state_fp,
                node.reported_state_fp, node.trust_fp, node.trust_fp});
        }

        auto snapshot = build_snapshot(engine);
        if (!snapshot.has_value()) {
            evidence.output.struct_size = sizeof(evidence.output);
            evidence.output.output_schema_version = CAELUS_NEURAL_OUTPUT_V1;
            evidence.output.runtime_status = CAELUS_NEURAL_STATUS_MALFORMED_INPUT;
            evidence.output.tick = engine.current_tick();
            evidence.output.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
            std::memcpy(evidence.output.scenario_hash, scenario_hash_.data(),
                        sizeof(evidence.output.scenario_hash));
            evidence.gate = neural_gate_result(
                CAELUS_NEURAL_GATE_REJECTED_SCHEMA,
                CAELUS_NEURAL_STATUS_MALFORMED_INPUT,
                "graph observation failed neural ABI validation",
                model_, evidence.output, policy_);
            finish_duration();
            return evidence;
        }
        evidence.snapshot_valid = true;
        evidence.output = DeterministicNeuralRuntimeV1::infer(
            model_, *snapshot, policy_);
        evidence.gate = NeuralGateV1::evaluate(
            model_, *snapshot, evidence.output, policy_);

        if (neural_gate_accepted(evidence.gate.decision)) {
            evidence.authority_record_required = true;
        }
        finish_duration();
        return evidence;
    }

    /**
     * Commit the already-gated bounded transaction and run deterministic
     * counterfactual lever validation.  The host calls this only after the
     * inference evidence has been durably appended to the audit chain.
     */
    bool commit_authority(causal::CausalEngine& engine,
                          NeuralTickEvidenceV1& evidence) {
        if (!evidence.authority_record_required ||
            !neural_gate_accepted(evidence.gate.decision)) {
            return false;
        }
        uint8_t output_hash[CAELUS_NEURAL_HASH_BYTES_V1] = {};
        uint8_t policy_hash[CAELUS_NEURAL_HASH_BYTES_V1] = {};
        if (!hash_detail::output_hash(evidence.output, output_hash) ||
            !hash_detail::policy_hash(policy_, policy_hash) ||
            !hash_detail::hash_equal(output_hash, evidence.gate.output_hash) ||
            !hash_detail::hash_equal(policy_hash, evidence.gate.policy_hash) ||
            !hash_detail::hash_equal(
                evidence.output.model_hash, model_.package_hash().data()) ||
            !hash_detail::hash_equal(
                evidence.output.input_hash, evidence.gate.input_hash) ||
            evidence.nodes.size() != engine.nodes().size()) {
            evidence.gate = neural_gate_result(
                CAELUS_NEURAL_GATE_REJECTED_INVARIANT,
                CAELUS_NEURAL_STATUS_RUNTIME_FAILURE,
                "gated evidence commitment or symbolic pre-state changed",
                model_, evidence.output, policy_, evidence.output.input_hash);
            return false;
        }
        for (size_t i = 0; i < evidence.nodes.size(); ++i) {
            if (evidence.nodes[i].node_index != i ||
                evidence.nodes[i].node_id != engine.nodes()[i].id ||
                evidence.nodes[i].trust_before_fp != engine.nodes()[i].trust_fp) {
                evidence.gate = neural_gate_result(
                    CAELUS_NEURAL_GATE_REJECTED_INVARIANT,
                    CAELUS_NEURAL_STATUS_RUNTIME_FAILURE,
                    "symbolic authority pre-state no longer matches gated evidence",
                    model_, evidence.output, policy_, evidence.output.input_hash);
                return false;
            }
        }
        if (evidence.gate.decision == CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED) {
            std::vector<causal::BoundedTrustAdjustment> adjustments;
            adjustments.reserve(evidence.output.proposal_count);
            for (uint32_t i = 0; i < evidence.output.proposal_count; ++i) {
                const auto& proposal = evidence.output.proposals[i];
                adjustments.push_back(
                    causal::BoundedTrustAdjustment{
                        proposal.node_index, proposal.proposed_delta_fp});
            }
            if (!engine.apply_bounded_trust_adjustments(
                    adjustments, policy_.maximum_abs_trust_delta_fp)) {
                evidence.gate = neural_gate_result(
                    CAELUS_NEURAL_GATE_REJECTED_INVARIANT,
                    CAELUS_NEURAL_STATUS_RUNTIME_FAILURE,
                    "symbolic authority rejected atomic trust transaction",
                    model_, evidence.output, policy_, evidence.output.input_hash);
                return false;
            } else {
                for (const auto& adjustment : adjustments) {
                    auto& telemetry = evidence.nodes[adjustment.node_index];
                    telemetry.trust_after_fp =
                        engine.nodes()[adjustment.node_index].trust_fp;
                    evidence.applied_proposals.push_back(
                        AppliedTrustProposalV1{
                            adjustment.node_index,
                            engine.nodes()[adjustment.node_index].id,
                            telemetry.trust_before_fp,
                            adjustment.delta_fp,
                            telemetry.trust_after_fp});
                }
            }
        }
        evaluate_levers(engine, evidence);
        evidence.authority_committed = true;
        return true;
    }

    /**
     * Roll back only the V1 trust transaction if the corresponding authority
     * audit event cannot be committed.  Lever evaluation is counterfactual and
     * never mutates the live engine.
     */
    bool rollback_authority(causal::CausalEngine& engine,
                            NeuralTickEvidenceV1& evidence) {
        if (evidence.applied_proposals.empty()) return true;
        std::vector<causal::BoundedTrustAdjustment> rollback;
        rollback.reserve(evidence.applied_proposals.size());
        for (const auto& applied : evidence.applied_proposals) {
            rollback.push_back(causal::BoundedTrustAdjustment{
                applied.node_index, -applied.delta_fp});
        }
        if (!engine.apply_bounded_trust_adjustments(
                rollback, policy_.maximum_abs_trust_delta_fp)) {
            evidence.rollback_failed = true;
            return false;
        }
        for (auto& node : evidence.nodes) {
            node.trust_after_fp = engine.nodes()[node.node_index].trust_fp;
        }
        evidence.authority_committed = false;
        evidence.rollback_applied = true;
        return true;
    }

    void mark_symbolic_fallback(NeuralTickEvidenceV1& evidence,
                                const char* reason) const noexcept {
        evidence.gate = neural_gate_result(
            CAELUS_NEURAL_GATE_SYMBOLIC_FALLBACK,
            CAELUS_NEURAL_STATUS_RUNTIME_FAILURE,
            reason, model_, evidence.output, policy_, evidence.output.input_hash);
        evidence.authority_committed = false;
    }

    void force_symbolic_fallback() noexcept {
        policy_.mode = CAELUS_NEURAL_MODE_SYMBOLIC_ONLY;
    }

private:
    struct NodeHistory {
        std::array<int64_t, CAELUS_NEURAL_HISTORY_TICKS_V1> authoritative{};
        std::array<int64_t, CAELUS_NEURAL_HISTORY_TICKS_V1> reported{};
    };

    static bool identifier_valid(const std::string& value, size_t capacity) noexcept {
        if (value.empty() || value.size() >= capacity) return false;
        for (unsigned char byte : value) {
            if (byte < 0x21u || byte > 0x7eu) return false;
        }
        return true;
    }

    template <size_t N>
    static bool copy_identifier(char (&destination)[N],
                                const std::string& source) noexcept {
        if (!identifier_valid(source, N)) return false;
        std::memset(destination, 0, N);
        std::memcpy(destination, source.data(), source.size());
        return true;
    }

    bool history_matches(const causal::CausalEngine& engine) const noexcept {
        if (!history_initialised_ ||
            engine.nodes().size() != history_.size() ||
            history_node_ids_.size() != history_.size()) {
            return false;
        }
        for (size_t i = 0; i < history_node_ids_.size(); ++i) {
            if (history_node_ids_[i] != engine.nodes()[i].id) return false;
        }
        return true;
    }

    static int64_t threshold_distance_fp(int32_t threshold,
                                         uint64_t tick) noexcept {
        if (threshold < 0) return 0;
        constexpr uint64_t kWindow = 64u;
        const uint64_t threshold_u = static_cast<uint64_t>(threshold);
        if (tick <= threshold_u) {
            const uint64_t delta = std::min<uint64_t>(
                threshold_u - tick, kWindow);
            return static_cast<int64_t>(delta) * CAELUS_NEURAL_FP_SCALE /
                   static_cast<int64_t>(kWindow);
        }
        const uint64_t delta = std::min<uint64_t>(tick - threshold_u, kWindow);
        return -static_cast<int64_t>(delta) * CAELUS_NEURAL_FP_SCALE /
               static_cast<int64_t>(kWindow);
    }

    std::optional<NeuralInputSnapshotV1> build_snapshot(
        const causal::CausalEngine& engine) const {
        if (!history_matches(engine) ||
            engine.edges().size() > CAELUS_NEURAL_MAX_EDGES_V1 ||
            engine.levers().size() > CAELUS_NEURAL_MAX_LEVERS_V1) {
            return std::nullopt;
        }

        const auto& engine_nodes = engine.nodes();
        std::vector<int64_t> incoming(engine_nodes.size(), 0);
        std::vector<int64_t> outgoing(engine_nodes.size(), 0);
        for (const auto& edge : engine.edges()) {
            if (!edge.active || edge.to.empty()) continue;
            size_t source_index = engine_nodes.size();
            size_t destination_index = engine_nodes.size();
            for (size_t i = 0; i < engine_nodes.size(); ++i) {
                if (engine_nodes[i].id == edge.from) source_index = i;
                if (engine_nodes[i].id == edge.to) destination_index = i;
            }
            if (source_index >= engine_nodes.size() ||
                destination_index >= engine_nodes.size() ||
                engine_nodes[source_index].capacity_fp <= 0) {
                continue;
            }
            const int64_t source_ratio = causal::fp_div(
                engine_nodes[source_index].reported_state_fp,
                engine_nodes[source_index].capacity_fp);
            const int64_t contribution = causal::fp_mul(
                causal::fp_mul(source_ratio, edge.multiplier_fp), 50'000);
            incoming[destination_index] = causal::fp_add_saturating(
                incoming[destination_index], contribution);
            outgoing[source_index] = causal::fp_add_saturating(
                outgoing[source_index], contribution);
        }

        std::vector<CaelusNeuralNodeInputV1> nodes;
        nodes.reserve(engine_nodes.size());
        uint32_t missing_count = 0;
        const bool has_hysteresis = !engine.hysteresis_list().empty();
        const int32_t hysteresis_tick = has_hysteresis
            ? engine.hysteresis_list().front().threshold_tick : -1;
        for (size_t i = 0; i < engine_nodes.size(); ++i) {
            const auto& source = engine_nodes[i];
            CaelusNeuralNodeInputV1 node{};
            node.struct_size = sizeof(node);
            node.node_index = static_cast<uint32_t>(i);
            node.node_kind = static_cast<uint32_t>(source.kind);
            if (!copy_identifier(node.node_id, source.id)) return std::nullopt;
            node.capacity_fp = source.capacity_fp;
            node.authoritative_state_fp = source.state_fp;
            node.reported_state_fp = source.reported_state_fp;
            node.trust_fp = source.trust_fp;
            node.incoming_flow_fp = causal::fp_clamp(
                incoming[i], -kMaxAbsFlowV1, kMaxAbsFlowV1);
            node.outgoing_flow_fp = causal::fp_clamp(
                outgoing[i], -kMaxAbsFlowV1, kMaxAbsFlowV1);
            node.queue_utilization_fp = source.capacity_fp > 0
                ? causal::fp_clamp(
                    causal::fp_div(source.reported_state_fp, source.capacity_fp),
                    0, CAELUS_NEURAL_FP_SCALE)
                : 0;
            if (source.deadline_tick >= 0) {
                node.deadline_distance_fp = threshold_distance_fp(
                    source.deadline_tick, engine.current_tick());
            } else {
                node.missing_mask |= CAELUS_NEURAL_MISSING_DEADLINE;
            }
            if (has_hysteresis) {
                node.hysteresis_distance_fp = threshold_distance_fp(
                    hysteresis_tick, engine.current_tick());
            } else {
                node.missing_mask |= CAELUS_NEURAL_MISSING_HYSTERESIS;
            }
            node.outage_latched_fp =
                engine.outage_active() ? CAELUS_NEURAL_FP_SCALE : 0;
            if (engine.has_intel_risk()) {
                node.intel_risk_fp = causal::fp_clamp(
                    engine.last_intel_risk_fp(), 0, CAELUS_NEURAL_FP_SCALE);
            } else {
                node.missing_mask |= CAELUS_NEURAL_MISSING_INTEL;
            }
            std::copy(history_[i].authoritative.begin(),
                      history_[i].authoritative.end(), node.state_history_fp);
            std::copy(history_[i].reported.begin(),
                      history_[i].reported.end(), node.reported_history_fp);
            if (observed_history_ticks_ < CAELUS_NEURAL_HISTORY_TICKS_V1) {
                node.missing_mask |= CAELUS_NEURAL_MISSING_STATE_HISTORY;
                node.missing_mask |= CAELUS_NEURAL_MISSING_REPORTED_HISTORY;
            }
            missing_count += contract_bit_count(node.missing_mask);
            nodes.push_back(node);
        }

        std::vector<CaelusNeuralEdgeInputV1> edges;
        edges.reserve(engine.edges().size());
        for (const auto& source : engine.edges()) {
            if (source.to.empty()) continue;
            size_t source_index = engine_nodes.size();
            size_t destination_index = engine_nodes.size();
            for (size_t i = 0; i < engine_nodes.size(); ++i) {
                if (engine_nodes[i].id == source.from) source_index = i;
                if (engine_nodes[i].id == source.to) destination_index = i;
            }
            if (source_index >= engine_nodes.size() ||
                destination_index >= engine_nodes.size()) {
                continue;
            }
            CaelusNeuralEdgeInputV1 edge{};
            edge.struct_size = sizeof(edge);
            edge.source_index = static_cast<uint32_t>(source_index);
            edge.destination_index = static_cast<uint32_t>(destination_index);
            edge.active = source.active ? 1u : 0u;
            edge.delay_ticks = source.lag_ticks;
            edge.multiplier_fp = source.multiplier_fp;
            edges.push_back(edge);
        }

        std::vector<CaelusNeuralLeverInputV1> levers;
        levers.reserve(engine.levers().size());
        for (size_t i = 0; i < engine.levers().size(); ++i) {
            const auto& source = engine.levers()[i];
            CaelusNeuralLeverInputV1 lever{};
            lever.struct_size = sizeof(lever);
            lever.lever_index = static_cast<uint32_t>(i);
            if (!copy_identifier(lever.lever_id, source.id)) return std::nullopt;
            lever.success_probability_fp = source.success_p_fp;
            lever.cost_ticks = source.cost_ticks;
            lever.remaining_lockout = source.remaining_lockout;
            lever.available =
                source.available && source.remaining_lockout == 0 ? 1u : 0u;
            levers.push_back(lever);
        }

        CaelusNeuralInputV1 metadata{};
        metadata.struct_size = sizeof(metadata);
        metadata.neural_abi_version = CAELUS_NEURAL_ABI_V1;
        metadata.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
        metadata.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
        metadata.tick = engine.current_tick();
        if (!copy_identifier(metadata.scenario_id, scenario_id_) ||
            !copy_identifier(metadata.engine_version, std::string("2.0.0"))) {
            return std::nullopt;
        }
        std::memcpy(metadata.scenario_hash, scenario_hash_.data(),
                    sizeof(metadata.scenario_hash));
        metadata.missing_value_count = missing_count;
        return NeuralInputSnapshotV1::create(metadata, nodes, edges, levers);
    }

    static uint64_t lever_seed(const uint8_t* input_hash,
                               uint32_t lever_index) noexcept {
        uint64_t seed = UINT64_C(0xCAE105DEADBEEF00);
        for (size_t i = 0; i < 8; ++i) {
            seed ^= static_cast<uint64_t>(input_hash[i]) << (i * 8u);
        }
        seed ^= static_cast<uint64_t>(lever_index + 1u) *
                UINT64_C(0x9E3779B97F4A7C15);
        return seed;
    }

    static int64_t symbolic_lever_score(
        const causal::EngineSnapshot& baseline,
        const causal::EngineSnapshot& candidate) noexcept {
        const int64_t friction_gain = causal::fp_add_saturating(
            baseline.clamped_friction_fp, -candidate.clamped_friction_fp);
        const int64_t throughput_gain = causal::fp_add_saturating(
            candidate.throughput_ratio_fp, -baseline.throughput_ratio_fp);
        int64_t outage_term = 0;
        if (baseline.outage_active && !candidate.outage_active) {
            outage_term = 250'000;
        } else if (!baseline.outage_active && candidate.outage_active) {
            outage_term = -250'000;
        }
        int64_t score = 500'000;
        score = causal::fp_add_saturating(score, friction_gain / 4);
        score = causal::fp_add_saturating(score, throughput_gain / 2);
        score = causal::fp_add_saturating(score, outage_term);
        return causal::fp_clamp(score, 0, CAELUS_NEURAL_FP_SCALE);
    }

    static void evaluate_levers(causal::CausalEngine& engine,
                                NeuralTickEvidenceV1& evidence) {
        struct RankedLever {
            uint32_t index;
            int64_t neural_score;
        };
        std::vector<RankedLever> ranked;
        ranked.reserve(evidence.output.lever_score_count);
        for (uint32_t i = 0; i < evidence.output.lever_score_count; ++i) {
            const auto& score = evidence.output.lever_scores[i];
            if (score.lever_index < engine.levers().size() &&
                engine.levers()[score.lever_index].available &&
                engine.levers()[score.lever_index].remaining_lockout == 0) {
                ranked.push_back(RankedLever{score.lever_index, score.score_fp});
            }
        }
        std::stable_sort(
            ranked.begin(), ranked.end(),
            [](const RankedLever& lhs, const RankedLever& rhs) {
                if (lhs.neural_score != rhs.neural_score) {
                    return lhs.neural_score > rhs.neural_score;
                }
                return lhs.index < rhs.index;
            });
        if (ranked.size() > 3u) ranked.resize(3u);

        for (const auto& item : ranked) {
            const auto& lever = engine.levers()[item.index];
            causal::CausalEngine baseline = engine;
            causal::CausalEngine candidate = engine;
            const bool success = candidate.apply_lever(
                lever.id, lever_seed(evidence.output.input_hash, item.index));
            const uint32_t horizon = static_cast<uint32_t>(
                std::max<int32_t>(1, std::min<int32_t>(lever.cost_ticks, 16)));
            const auto baseline_snapshot = baseline.run_ticks(horizon);
            const auto candidate_snapshot = candidate.run_ticks(horizon);
            evidence.lever_evaluations.push_back(SymbolicLeverEvaluationV1{
                item.index,
                lever.id,
                item.neural_score,
                symbolic_lever_score(baseline_snapshot, candidate_snapshot),
                success,
                baseline_snapshot.outage_active,
                candidate_snapshot.outage_active,
                false});
        }
        if (evidence.lever_evaluations.empty()) return;
        auto selected = std::max_element(
            evidence.lever_evaluations.begin(), evidence.lever_evaluations.end(),
            [](const SymbolicLeverEvaluationV1& lhs,
               const SymbolicLeverEvaluationV1& rhs) {
                if (lhs.symbolic_score_fp != rhs.symbolic_score_fp) {
                    return lhs.symbolic_score_fp < rhs.symbolic_score_fp;
                }
                if (lhs.neural_score_fp != rhs.neural_score_fp) {
                    return lhs.neural_score_fp < rhs.neural_score_fp;
                }
                return lhs.lever_index > rhs.lever_index;
            });
        selected->selected = true;
        evidence.selected_lever_id = selected->lever_id;
    }

    CaelusNeuralPolicyV1 policy_{};
    NeuralModelPackage model_{};
    std::string scenario_id_;
    std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1> scenario_hash_{};
    std::vector<NodeHistory> history_;
    std::vector<std::string> history_node_ids_;
    bool history_initialised_ = false;
    uint32_t observed_history_ticks_ = 0;
};

namespace host_detail {

inline std::string json_escape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8u);
    for (unsigned char byte : value) {
        switch (byte) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (byte < 0x20u) {
                    char escaped[7] = {};
                    std::snprintf(
                        escaped, sizeof(escaped), "\\u%04x",
                        static_cast<unsigned>(byte));
                    out += escaped;
                } else {
                    out.push_back(static_cast<char>(byte));
                }
                break;
        }
    }
    return out;
}

inline std::string hex(const uint8_t* bytes, size_t size) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out(size * 2u, '0');
    for (size_t i = 0; i < size; ++i) {
        out[i * 2u] = kHex[(bytes[i] >> 4u) & 0x0fu];
        out[i * 2u + 1u] = kHex[bytes[i] & 0x0fu];
    }
    return out;
}

inline std::string session_hex(uint64_t session_id) {
    std::ostringstream out;
    out << std::hex << std::setfill('0') << std::setw(16) << session_id;
    return out.str();
}

inline int64_t minimum_confidence(const NeuralTickEvidenceV1& evidence) noexcept {
    if (evidence.output.node_count == 0u) return 0;
    int64_t value = CAELUS_NEURAL_FP_SCALE;
    for (uint32_t i = 0; i < evidence.output.node_count; ++i) {
        value = std::min(value, evidence.output.nodes[i].confidence_fp);
    }
    return value;
}

inline int64_t maximum_ood(const NeuralTickEvidenceV1& evidence) noexcept {
    int64_t value = 0;
    for (uint32_t i = 0; i < evidence.output.node_count; ++i) {
        value = std::max(
            value, evidence.output.nodes[i].out_of_distribution_score_fp);
    }
    return value;
}

} // namespace host_detail

inline std::string neural_inference_audit_event(
    const NeuralControllerV1& controller,
    const NeuralTickEvidenceV1& evidence,
    uint64_t session_id) {
    const auto& model = controller.model();
    const bool accepted = neural_gate_accepted(evidence.gate.decision);
    std::ostringstream out;
    out << "{\"type\":\"NEURAL_INFERENCE_V1\""
        << ",\"session_id\":\"" << host_detail::session_hex(session_id) << "\""
        << ",\"tick\":" << evidence.tick
        << ",\"scenario_id\":\""
        << host_detail::json_escape(controller.scenario_id()) << "\""
        << ",\"scenario_hash\":\""
        << host_detail::hex(
            controller.scenario_hash().data(), controller.scenario_hash().size())
        << "\""
        << ",\"engine_version\":\"2.0.0\""
        << ",\"runtime_mode\":\"DETERMINISTIC_FIXED_POINT_ASSURANCE\""
        << ",\"model_id\":\""
        << host_detail::json_escape(model.manifest().model_id) << "\""
        << ",\"model_version\":\""
        << host_detail::json_escape(model.manifest().model_version) << "\""
        << ",\"model_load_status\":\"" << model_load_status_name(model.status()) << "\""
        << ",\"model_trusted\":" << (model.trusted() ? "true" : "false")
        << ",\"model_hash\":\""
        << host_detail::hex(evidence.gate.model_hash, sizeof(evidence.gate.model_hash))
        << "\""
        << ",\"manifest_hash\":\""
        << host_detail::hex(model.manifest_hash().data(), model.manifest_hash().size())
        << "\""
        << ",\"feature_schema_version\":" << CAELUS_FEATURE_SCHEMA_V1
        << ",\"input_hash\":\""
        << host_detail::hex(evidence.gate.input_hash, sizeof(evidence.gate.input_hash))
        << "\""
        << ",\"output_hash\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"policy_hash\":\""
        << host_detail::hex(evidence.gate.policy_hash, sizeof(evidence.gate.policy_hash))
        << "\""
        << ",\"evidence_id\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"runtime_status\":\""
        << neural_runtime_status_name(evidence.gate.runtime_status) << "\""
        << ",\"gate_decision\":\""
        << neural_gate_decision_name(evidence.gate.decision) << "\""
        << ",\"rejection_reason\":\""
        << host_detail::json_escape(evidence.gate.reason) << "\""
        << ",\"confidence_min_fp\":" << host_detail::minimum_confidence(evidence)
        << ",\"ood_max_fp\":" << host_detail::maximum_ood(evidence)
        << ",\"saturation_count\":" << evidence.output.saturation_count
        << ",\"observed_history_ticks\":" << evidence.observed_history_ticks
        << ",\"inference_duration_us\":" << evidence.inference_duration_us
        << ",\"duration_measured\":"
        << (evidence.duration_measured ? "true" : "false")
        << ",\"fallback\":" << (accepted ? "false" : "true")
        << ",\"authority_expected\":"
        << (evidence.authority_record_required ? "true" : "false")
        << "}";
    return out.str();
}

inline std::string neural_authority_audit_event(
    const NeuralControllerV1& controller,
    const NeuralTickEvidenceV1& evidence,
    uint64_t session_id) {
    if (!evidence.authority_record_required) return {};
    std::ostringstream out;
    out << "{\"type\":\"NEURAL_AUTHORITY_V1\""
        << ",\"session_id\":\"" << host_detail::session_hex(session_id) << "\""
        << ",\"tick\":" << evidence.tick
        << ",\"evidence_id\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"model_hash\":\""
        << host_detail::hex(evidence.gate.model_hash, sizeof(evidence.gate.model_hash))
        << "\""
        << ",\"input_hash\":\""
        << host_detail::hex(evidence.gate.input_hash, sizeof(evidence.gate.input_hash))
        << "\""
        << ",\"output_hash\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"policy_hash\":\""
        << host_detail::hex(evidence.gate.policy_hash, sizeof(evidence.gate.policy_hash))
        << "\""
        << ",\"gate_decision\":\""
        << neural_gate_decision_name(evidence.gate.decision) << "\""
        << ",\"applied_proposals\":[";
    for (size_t i = 0; i < evidence.applied_proposals.size(); ++i) {
        if (i != 0u) out << ',';
        const auto& proposal = evidence.applied_proposals[i];
        out << "{\"node_index\":" << proposal.node_index
            << ",\"node_id\":\"" << host_detail::json_escape(proposal.node_id) << "\""
            << ",\"trust_before_fp\":" << proposal.trust_before_fp
            << ",\"delta_fp\":" << proposal.delta_fp
            << ",\"trust_after_fp\":" << proposal.trust_after_fp << "}";
    }
    out << "],\"lever_candidates\":[";
    for (size_t i = 0; i < evidence.lever_evaluations.size(); ++i) {
        if (i != 0u) out << ',';
        const auto& lever = evidence.lever_evaluations[i];
        out << "{\"lever_index\":" << lever.lever_index
            << ",\"lever_id\":\"" << host_detail::json_escape(lever.lever_id) << "\""
            << ",\"neural_score_fp\":" << lever.neural_score_fp
            << ",\"symbolic_score_fp\":" << lever.symbolic_score_fp
            << ",\"simulated_success\":"
            << (lever.simulated_success ? "true" : "false")
            << ",\"baseline_outage\":"
            << (lever.baseline_outage ? "true" : "false")
            << ",\"candidate_outage\":"
            << (lever.candidate_outage ? "true" : "false")
            << ",\"selected\":" << (lever.selected ? "true" : "false") << "}";
    }
    out << "],\"selected_lever_id\":\""
        << host_detail::json_escape(evidence.selected_lever_id)
        << "\",\"authority_committed\":"
        << (evidence.authority_committed ? "true" : "false")
        << ",\"symbolic_state_overwritten\":false"
        << ",\"outage_latch_overridden\":false"
        << "}";
    return out.str();
}

inline std::string neural_authority_resolution_audit_event(
    const NeuralControllerV1& controller,
    const NeuralTickEvidenceV1& evidence,
    uint64_t session_id,
    const char* event_type) {
    if (!evidence.authority_record_required || event_type == nullptr) return {};
    std::ostringstream out;
    out << "{\"type\":\"" << event_type << "\""
        << ",\"session_id\":\"" << host_detail::session_hex(session_id) << "\""
        << ",\"tick\":" << evidence.tick
        << ",\"scenario_id\":\""
        << host_detail::json_escape(controller.scenario_id()) << "\""
        << ",\"evidence_id\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"model_hash\":\""
        << host_detail::hex(evidence.gate.model_hash, sizeof(evidence.gate.model_hash))
        << "\""
        << ",\"input_hash\":\""
        << host_detail::hex(evidence.gate.input_hash, sizeof(evidence.gate.input_hash))
        << "\""
        << ",\"output_hash\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"policy_hash\":\""
        << host_detail::hex(evidence.gate.policy_hash, sizeof(evidence.gate.policy_hash))
        << "\""
        << ",\"gate_decision\":\""
        << neural_gate_decision_name(evidence.gate.decision) << "\""
        << ",\"reason\":\""
        << host_detail::json_escape(evidence.gate.reason) << "\""
        << ",\"authority_committed\":"
        << (evidence.authority_committed ? "true" : "false")
        << ",\"rollback_applied\":"
        << (evidence.rollback_applied ? "true" : "false")
        << ",\"rollback_failed\":"
        << (evidence.rollback_failed ? "true" : "false")
        << ",\"symbolic_state_overwritten\":false"
        << ",\"outage_latch_overridden\":false"
        << "}";
    return out.str();
}

inline std::string neural_war_room_event(
    const NeuralControllerV1& controller,
    const NeuralTickEvidenceV1& evidence) {
    const auto& model = controller.model();
    const bool gate_accepted = neural_gate_accepted(evidence.gate.decision);
    const bool accepted =
        gate_accepted &&
        (!evidence.authority_record_required || evidence.authority_committed);
    std::ostringstream out;
    out << "{\"type\":\"neural_observation\""
        << ",\"schema_ver\":1"
        << ",\"mode\":\"" << neural_mode_name(controller.mode()) << "\""
        << ",\"tick\":\"" << evidence.tick << "\""
        << ",\"model_id\":\""
        << host_detail::json_escape(model.manifest().model_id) << "\""
        << ",\"model_version\":\""
        << host_detail::json_escape(model.manifest().model_version) << "\""
        << ",\"model_load_status\":\"" << model_load_status_name(model.status()) << "\""
        << ",\"model_trusted\":" << (model.trusted() ? "true" : "false")
        << ",\"model_hash\":\""
        << host_detail::hex(evidence.gate.model_hash, sizeof(evidence.gate.model_hash))
        << "\""
        << ",\"input_hash\":\""
        << host_detail::hex(evidence.gate.input_hash, sizeof(evidence.gate.input_hash))
        << "\""
        << ",\"output_hash\":\""
        << host_detail::hex(evidence.gate.output_hash, sizeof(evidence.gate.output_hash))
        << "\""
        << ",\"runtime_status\":\""
        << neural_runtime_status_name(evidence.gate.runtime_status) << "\""
        << ",\"gate_decision\":\""
        << neural_gate_decision_name(evidence.gate.decision) << "\""
        << ",\"gate_reason\":\""
        << host_detail::json_escape(evidence.gate.reason) << "\""
        << ",\"gate_accepted\":" << (gate_accepted ? "true" : "false")
        << ",\"fallback\":" << (accepted ? "false" : "true")
        << ",\"authority_expected\":"
        << (evidence.authority_record_required ? "true" : "false")
        << ",\"authority_committed\":"
        << (evidence.authority_committed ? "true" : "false")
        << ",\"rollback_applied\":"
        << (evidence.rollback_applied ? "true" : "false")
        << ",\"rollback_failed\":"
        << (evidence.rollback_failed ? "true" : "false")
        << ",\"observed_history_ticks\":" << evidence.observed_history_ticks
        << ",\"nodes\":[";
    for (size_t i = 0; i < evidence.nodes.size(); ++i) {
        if (i != 0u) out << ',';
        const auto& node = evidence.nodes[i];
        const bool has_output = node.node_index < evidence.output.node_count;
        out << "{\"node_index\":" << node.node_index
            << ",\"node_id\":\"" << host_detail::json_escape(node.node_id) << "\""
            << ",\"reported_state_fp\":\"" << node.reported_state_fp << "\""
            << ",\"authoritative_state_fp\":\"" << node.authoritative_state_fp << "\""
            << ",\"trust_fp\":\"" << node.trust_after_fp << "\""
            << ",\"neural_output_available\":" << (has_output ? "true" : "false");
        if (has_output) {
            const auto& output = evidence.output.nodes[node.node_index];
            out << ",\"estimated_true_state_fp\":\""
                << output.estimated_true_state_fp << "\""
                << ",\"anomaly_score_fp\":\"" << output.telemetry_anomaly_score_fp
                << "\",\"confidence_fp\":\"" << output.confidence_fp
                << "\",\"ood_score_fp\":\"" << output.out_of_distribution_score_fp
                << "\",\"outage_short_fp\":\"" << output.outage_probability_short_fp
                << "\",\"outage_medium_fp\":\"" << output.outage_probability_medium_fp
                << "\",\"outage_long_fp\":\"" << output.outage_probability_long_fp
                << "\"";
        }
        out << "}";
    }
    out << "],\"lever_candidates\":[";
    for (size_t i = 0; i < evidence.lever_evaluations.size(); ++i) {
        if (i != 0u) out << ',';
        const auto& lever = evidence.lever_evaluations[i];
        out << "{\"lever_id\":\"" << host_detail::json_escape(lever.lever_id) << "\""
            << ",\"neural_score_fp\":\"" << lever.neural_score_fp << "\""
            << ",\"symbolic_score_fp\":\"" << lever.symbolic_score_fp << "\""
            << ",\"selected\":" << (lever.selected ? "true" : "false") << "}";
    }
    out << "],\"selected_lever_id\":\""
        << host_detail::json_escape(evidence.selected_lever_id)
        << "\",\"labels\":{\"reported\":\"Reported telemetry\","
        << "\"estimated\":\"Neural estimate — advisory\","
        << "\"authoritative\":\"Authoritative symbolic state\"},"
        << "\"feature_signal_disclaimer\":\"Input salience is not causal attribution\""
        << "}";
    return out.str();
}

} // namespace caelus::neural
