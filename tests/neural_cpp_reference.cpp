// File-backed C++ side of the deterministic neural differential gate.

#include "neural_runtime.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

namespace {

std::string hex(const uint8_t* bytes, size_t length) {
    static constexpr char kDigits[] = "0123456789abcdef";
    std::string output(length * 2u, '0');
    for (size_t i = 0; i < length; ++i) {
        output[i * 2u] = kDigits[(bytes[i] >> 4u) & 0x0fu];
        output[i * 2u + 1u] = kDigits[bytes[i] & 0x0fu];
    }
    return output;
}

struct DifferentialInput {
    CaelusNeuralNodeInputV1 nodes[2]{};
    CaelusNeuralEdgeInputV1 edges[1]{};
    CaelusNeuralLeverInputV1 levers[1]{};
    CaelusNeuralInputV1 input{};

    DifferentialInput() {
        using namespace caelus::causal;
        for (uint32_t index = 0; index < 2; ++index) {
            nodes[index].struct_size = sizeof(nodes[index]);
            nodes[index].node_index = index;
            nodes[index].capacity_fp = FP_ONE;
            nodes[index].trust_fp = FP_ONE;
            std::strncpy(
                nodes[index].node_id,
                index == 0 ? "GHOST_INVENTORY" : "HUB_BERTHS",
                sizeof(nodes[index].node_id) - 1u);
        }

        nodes[0].node_kind = static_cast<uint32_t>(NodeKind::Buffer);
        nodes[0].authoritative_state_fp = 110'000;
        nodes[0].reported_state_fp = 0;
        nodes[0].trust_fp = 730'000;
        nodes[0].queue_utilization_fp = 0;
        nodes[0].deadline_distance_fp = 800'000;
        nodes[0].hysteresis_distance_fp = 900'000;
        nodes[0].intel_risk_fp = 270'000;
        const int64_t ghost_history[CAELUS_NEURAL_HISTORY_TICKS_V1] = {
            90'000, 95'000, 100'000, 102'000,
            105'000, 108'000, 109'000, 110'000};
        std::memcpy(
            nodes[0].state_history_fp, ghost_history, sizeof(ghost_history));

        nodes[1].node_kind = static_cast<uint32_t>(NodeKind::Service);
        nodes[1].authoritative_state_fp = 650'000;
        nodes[1].reported_state_fp = 650'000;
        nodes[1].queue_utilization_fp = 650'000;
        nodes[1].deadline_distance_fp = 800'000;
        nodes[1].hysteresis_distance_fp = 900'000;
        nodes[1].intel_risk_fp = 270'000;
        const int64_t berth_history[CAELUS_NEURAL_HISTORY_TICKS_V1] = {
            620'000, 625'000, 630'000, 635'000,
            640'000, 645'000, 648'000, 650'000};
        std::memcpy(
            nodes[1].state_history_fp, berth_history, sizeof(berth_history));
        std::memcpy(
            nodes[1].reported_history_fp, berth_history, sizeof(berth_history));

        edges[0].struct_size = sizeof(edges[0]);
        edges[0].source_index = 0;
        edges[0].destination_index = 1;
        edges[0].active = 1;
        edges[0].delay_ticks = 1;
        edges[0].multiplier_fp = 1'200'000;

        levers[0].struct_size = sizeof(levers[0]);
        levers[0].lever_index = 0;
        std::strncpy(
            levers[0].lever_id, "L-01", sizeof(levers[0].lever_id) - 1u);
        levers[0].success_probability_fp = 750'000;
        levers[0].cost_ticks = 24;
        levers[0].remaining_lockout = 0;
        levers[0].available = 1;

        input.struct_size = sizeof(input);
        input.neural_abi_version = CAELUS_NEURAL_ABI_V1;
        input.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
        input.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
        input.tick = 8;
        std::strncpy(
            input.scenario_id, "BS-01_SAHTE_UFUK",
            sizeof(input.scenario_id) - 1u);
        std::strncpy(
            input.engine_version, "2.0.0", sizeof(input.engine_version) - 1u);
        std::memset(input.scenario_hash, 0x11, sizeof(input.scenario_hash));
        input.node_count = 2;
        input.edge_count = 1;
        input.lever_count = 1;
        input.nodes = nodes;
        input.edges = edges;
        input.levers = levers;
    }

    std::optional<caelus::neural::NeuralInputSnapshotV1> snapshot() const {
        std::vector<CaelusNeuralNodeInputV1> owned_nodes(
            std::begin(nodes), std::end(nodes));
        std::vector<CaelusNeuralEdgeInputV1> owned_edges(
            std::begin(edges), std::end(edges));
        std::vector<CaelusNeuralLeverInputV1> owned_levers(
            std::begin(levers), std::end(levers));
        return caelus::neural::NeuralInputSnapshotV1::create(
            input, owned_nodes, owned_edges, owned_levers);
    }
};

void write_output(const CaelusNeuralOutputBufferV1& output) {
    std::cout
        << "{\"schema_version\":1"
        << ",\"runtime_status\":" << output.runtime_status
        << ",\"saturation_count\":" << output.saturation_count
        << ",\"tick\":" << output.tick
        << ",\"feature_schema_version\":" << output.feature_schema_version
        << ",\"model_hash\":\""
        << hex(output.model_hash, sizeof(output.model_hash)) << "\""
        << ",\"scenario_hash\":\""
        << hex(output.scenario_hash, sizeof(output.scenario_hash)) << "\""
        << ",\"input_hash\":\""
        << hex(output.input_hash, sizeof(output.input_hash)) << "\""
        << ",\"nodes\":[";
    for (uint32_t index = 0; index < output.node_count; ++index) {
        if (index != 0u) std::cout << ',';
        const auto& node = output.nodes[index];
        std::cout
            << "{\"node_index\":" << node.node_index
            << ",\"estimated_true_state_fp\":" << node.estimated_true_state_fp
            << ",\"telemetry_anomaly_score_fp\":"
            << node.telemetry_anomaly_score_fp
            << ",\"confidence_fp\":" << node.confidence_fp
            << ",\"out_of_distribution_score_fp\":"
            << node.out_of_distribution_score_fp
            << ",\"outage_probability_short_fp\":"
            << node.outage_probability_short_fp
            << ",\"outage_probability_medium_fp\":"
            << node.outage_probability_medium_fp
            << ",\"outage_probability_long_fp\":"
            << node.outage_probability_long_fp << '}';
    }
    std::cout << "],\"proposals\":[";
    for (uint32_t index = 0; index < output.proposal_count; ++index) {
        if (index != 0u) std::cout << ',';
        const auto& proposal = output.proposals[index];
        std::cout
            << "{\"kind\":" << proposal.kind
            << ",\"node_index\":" << proposal.node_index
            << ",\"proposed_delta_fp\":" << proposal.proposed_delta_fp
            << ",\"authorized_min_fp\":" << proposal.authorized_min_fp
            << ",\"authorized_max_fp\":" << proposal.authorized_max_fp << '}';
    }
    std::cout << "],\"lever_scores\":[";
    for (uint32_t index = 0; index < output.lever_score_count; ++index) {
        if (index != 0u) std::cout << ',';
        const auto& score = output.lever_scores[index];
        std::cout
            << "{\"lever_index\":" << score.lever_index
            << ",\"score_fp\":" << score.score_fp << '}';
    }
    std::cout << "]}\n";
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "usage: neural_cpp_reference <model-directory>\n";
        return 2;
    }
    const auto package = caelus::neural::load_neural_model_package(argv[1]);
    if (!package.trusted()) {
        std::cerr << "model rejected: "
                  << caelus::neural::model_load_status_name(package.status())
                  << ": " << package.error() << '\n';
        return 3;
    }
    DifferentialInput fixture;
    auto snapshot = fixture.snapshot();
    if (!snapshot.has_value()) {
        std::cerr << "differential input snapshot is invalid\n";
        return 4;
    }
    const auto policy = caelus::neural::default_assurance_policy();
    const auto output = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        package, *snapshot, policy);
    if (output.runtime_status != CAELUS_NEURAL_STATUS_OK ||
        !caelus::neural::output_ranges_valid(*snapshot, output, policy)) {
        std::cerr << "inference failed with status " << output.runtime_status << '\n';
        return 5;
    }
    write_output(output);
    return 0;
}
