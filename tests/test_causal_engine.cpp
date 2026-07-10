#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "causal_engine.h"
#include "neural_contract.h"
#include "neural_gate.h"
#include "neural_host.h"
#include "neural_model.h"
#include "neural_runtime.h"
#include "scenario_pack.h"
#include "plugin/caelus_solver.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <limits>
#include <string>

using namespace caelus::causal;

// ── Test-only ed25519 verifier stub ─────────────────────────────────────────
// The C++ unit-test binary is compiled WITHOUT the Rust FFI object, so the real
// caelus_verify_scenario_signature symbol is unavailable. We provide a
// controllable stub so the signature-gate branches (math pass/fail, pin match,
// dev bypass) can be exercised deterministically. The *real* ed25519 math is
// covered separately by the Rust suite and by the Python end-to-end tamper test
// (tests/run_signature_negative.py), which run against the real signing path.
static int g_stub_ed25519_result = 1;

extern "C" uint8_t caelus_verify_scenario_signature(
    const uint8_t* /*msg*/, size_t /*msg_len*/,
    const uint8_t* /*pubkey32*/, const uint8_t* /*sig64*/) {
    return static_cast<uint8_t>(g_stub_ed25519_result);
}

// Unit-only deterministic hash stub.  Production and end-to-end tests link the
// real Rust Blake3 FFI; this stub lets C++ math/gate tests remain standalone.
extern "C" uint8_t caelus_blake3_hash(
    const uint8_t* data, size_t len, uint8_t* out_hash32) {
    if (!data || len == 0 || !out_hash32) return 0;
    uint64_t state[4] = {
        UINT64_C(1469598103934665603),
        UINT64_C(1099511628211),
        UINT64_C(7809847782465536322),
        UINT64_C(9650029242287828579)
    };
    for (size_t i = 0; i < len; ++i) {
        for (size_t lane = 0; lane < 4; ++lane) {
            state[lane] ^= static_cast<uint64_t>(data[i] + lane);
            state[lane] *= UINT64_C(1099511628211);
        }
    }
    for (size_t lane = 0; lane < 4; ++lane)
        for (size_t byte = 0; byte < 8; ++byte)
            out_hash32[lane * 8 + byte] =
                static_cast<uint8_t>(state[lane] >> (byte * 8u));
    return 1;
}

namespace {
void set_env_flag(const char* name, bool on) {
#if defined(_WIN32)
    _putenv_s(name, on ? "1" : "");
#else
    if (on) setenv(name, "1", 1);
    else    unsetenv(name);
#endif
}

caelus::JsonVal parse_json(const std::string& text) {
    caelus::JsonVal root;
    caelus::JsonParser parser(text.data(), text.size());
    REQUIRE(parser.parse(root));
    return root;
}

// Pinned trust anchor (matches CAELUS_TRUSTED_PUBKEY in scenario_pack.h).
const char* kTrustedPubHex =
    "9bb1dbd039043670b7bf2c5d7533777866135b92f9b38fe6cd8d9735a04fa802";
const char* kUntrustedPubHex =
    "0000000000000000000000000000000000000000000000000000000000000000";
const std::string kSigHex(128, 'a');

std::string scenario_json(const std::string& sig) {
    return std::string("{\"signature\":\"") + sig + "\","
           "\"extended_causal_model\":{\"nodes\":[]},"
           "\"v1_engine_bridge\":{\"k\":1}}";
}

caelus::neural::NeuralModelPackage neural_runtime_fixture_model() {
    using namespace caelus::neural;
    NeuralModelManifestV1 manifest;
    manifest.weight_scale_denominator = 64;
    manifest.input_features = CAELUS_NEURAL_FEATURES_V1;
    manifest.hidden_dimensions = CAELUS_NEURAL_HIDDEN_V1;
    manifest.message_passing_layers = 2;
    manifest.weight_count = kExpectedWeightCountV1;
    manifest.bias_count = kExpectedBiasCountV1;
    manifest.weights_size = static_cast<uint32_t>(
        kWeightsHeaderBytesV1 + kExpectedWeightCountV1 +
        kExpectedBiasCountV1 * 4u);
    std::vector<uint8_t> weights(
        kWeightsHeaderBytesV1 + kExpectedWeightCountV1 +
        kExpectedBiasCountV1 * 4u, 0u);
    const uint8_t magic[8] = {'C','A','E','L','N','N','1','\0'};
    std::memcpy(weights.data(), magic, sizeof(magic));
    auto write_u32 = [&](size_t offset, uint32_t value) {
        for (size_t i = 0; i < 4; ++i)
            weights[offset + i] = static_cast<uint8_t>(value >> (i * 8u));
    };
    auto write_u64 = [&](size_t offset, uint64_t value) {
        for (size_t i = 0; i < 8; ++i)
            weights[offset + i] = static_cast<uint8_t>(value >> (i * 8u));
    };
    write_u32(8, kWeightsFormatVersionV1);
    write_u32(12, kWeightsEndianMarkerV1);
    write_u32(16, CAELUS_NEURAL_FEATURES_V1);
    write_u32(20, CAELUS_NEURAL_HIDDEN_V1);
    write_u32(24, 2);
    write_u32(28, kExpectedWeightCountV1);
    write_u32(32, kExpectedBiasCountV1);
    write_u64(40, kExpectedWeightCountV1 + kExpectedBiasCountV1 * 4u);
    for (size_t i = 0; i < kExpectedWeightCountV1; ++i) {
        const int8_t value = static_cast<int8_t>((i * 17u + 3u) % 15u) - 7;
        weights[kWeightsHeaderBytesV1 + i] = static_cast<uint8_t>(value);
    }
    const size_t bias_start = kWeightsHeaderBytesV1 + kExpectedWeightCountV1;
    for (size_t i = 0; i < kExpectedBiasCountV1; ++i) {
        const int32_t value =
            static_cast<int32_t>((i * 7'919u) % 200'001u) - 100'000;
        const uint32_t bits = static_cast<uint32_t>(value);
        for (size_t b = 0; b < 4; ++b)
            weights[bias_start + i * 4u + b] =
                static_cast<uint8_t>(bits >> (b * 8u));
    }
    std::array<uint8_t, 32> weights_hash{};
    (void)caelus_blake3_hash(
        weights.data(), weights.size(), weights_hash.data());
    std::array<uint8_t, 32> manifest_hash{};
    manifest_hash.fill(0x22u);
    return NeuralModelPackage::test_trusted(
        std::move(manifest), std::move(weights), manifest_hash, weights_hash);
}

struct NeuralRuntimeFixtureInput {
    CaelusNeuralNodeInputV1 nodes[2]{};
    CaelusNeuralEdgeInputV1 edges[1]{};
    CaelusNeuralLeverInputV1 levers[1]{};
    CaelusNeuralInputV1 input{};

    NeuralRuntimeFixtureInput() {
        for (uint32_t i = 0; i < 2; ++i) {
            nodes[i].struct_size = sizeof(nodes[i]);
            nodes[i].node_index = i;
            nodes[i].capacity_fp = FP_ONE;
            nodes[i].trust_fp = FP_ONE;
            std::strncpy(nodes[i].node_id, i == 0 ? "GHOST_INVENTORY" : "HUB_BERTHS",
                         sizeof(nodes[i].node_id) - 1);
        }
        nodes[0].node_kind = static_cast<uint32_t>(NodeKind::Buffer);
        nodes[0].authoritative_state_fp = 110'000;
        nodes[0].reported_state_fp = 0;
        nodes[0].trust_fp = 730'000;
        nodes[0].queue_utilization_fp = 0;
        nodes[0].deadline_distance_fp = 800'000;
        nodes[0].hysteresis_distance_fp = 900'000;
        nodes[0].intel_risk_fp = 270'000;
        const int64_t state0[8] =
            {90'000,95'000,100'000,102'000,105'000,108'000,109'000,110'000};
        std::memcpy(nodes[0].state_history_fp, state0, sizeof(state0));

        nodes[1].node_kind = static_cast<uint32_t>(NodeKind::Service);
        nodes[1].authoritative_state_fp = 650'000;
        nodes[1].reported_state_fp = 650'000;
        nodes[1].queue_utilization_fp = 650'000;
        nodes[1].deadline_distance_fp = 800'000;
        nodes[1].hysteresis_distance_fp = 900'000;
        nodes[1].intel_risk_fp = 270'000;
        const int64_t state1[8] =
            {620'000,625'000,630'000,635'000,640'000,645'000,648'000,650'000};
        std::memcpy(nodes[1].state_history_fp, state1, sizeof(state1));
        std::memcpy(nodes[1].reported_history_fp, state1, sizeof(state1));

        edges[0].struct_size = sizeof(edges[0]);
        edges[0].source_index = 0;
        edges[0].destination_index = 1;
        edges[0].active = 1;
        edges[0].delay_ticks = 1;
        edges[0].multiplier_fp = 1'200'000;

        levers[0].struct_size = sizeof(levers[0]);
        levers[0].lever_index = 0;
        std::strncpy(levers[0].lever_id, "L-01", sizeof(levers[0].lever_id) - 1);
        levers[0].success_probability_fp = 750'000;
        levers[0].cost_ticks = 24;
        levers[0].available = 1;

        input.struct_size = sizeof(input);
        input.neural_abi_version = CAELUS_NEURAL_ABI_V1;
        input.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
        input.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
        input.tick = 8;
        std::strncpy(input.scenario_id, "BS-01_SAHTE_UFUK",
                     sizeof(input.scenario_id) - 1);
        std::strncpy(input.engine_version, "2.0.0",
                     sizeof(input.engine_version) - 1);
        std::memset(input.scenario_hash, 0x11, sizeof(input.scenario_hash));
        input.node_count = 2;
        input.edge_count = 1;
        input.lever_count = 1;
        input.nodes = nodes;
        input.edges = edges;
        input.levers = levers;
    }

    caelus::neural::NeuralInputSnapshotV1 snapshot() const {
        std::vector<CaelusNeuralNodeInputV1> owned_nodes(
            std::begin(nodes), std::end(nodes));
        std::vector<CaelusNeuralEdgeInputV1> owned_edges(
            std::begin(edges), std::end(edges));
        std::vector<CaelusNeuralLeverInputV1> owned_levers(
            std::begin(levers), std::end(levers));
        return caelus::neural::NeuralInputSnapshotV1::create(
                   input, owned_nodes, owned_edges, owned_levers)
            .value();
    }
};
}  // namespace

TEST_CASE("fixed-point arithmetic handles normal values") {
    CHECK(fp_mul(2 * FP_ONE, 3 * FP_ONE) == 6 * FP_ONE);
    CHECK(fp_mul(1'500'000LL, 2 * FP_ONE) == 3 * FP_ONE);
    CHECK(fp_div(3 * FP_ONE, 2 * FP_ONE) == 1'500'000LL);
    CHECK(fp_div(7 * FP_ONE, FP_ONE) == 7 * FP_ONE);
    CHECK(fp_div(FP_ONE, 0LL) == 0LL);
}

TEST_CASE("fixed-point arithmetic saturates near int64 limits") {
    constexpr int64_t kMax = (std::numeric_limits<int64_t>::max)();
    constexpr int64_t kMin = (std::numeric_limits<int64_t>::min)();

    CHECK(fp_mul(kMax, kMax) == kMax);
    CHECK(fp_mul(kMax, -kMax) == kMin);
    CHECK(fp_mul(kMin, FP_ONE) == kMin);
    CHECK(fp_div(kMax, 1LL) == kMax);
    CHECK(fp_div(kMin, 1LL) == kMin);
    CHECK(fp_div(kMax, -1LL) == kMin);
    CHECK(fp_div(kMin, -1LL) == kMax);
    CHECK(fp_mul(kMin, kMin) == kMax);
    CHECK(fp_add_saturating(kMax, 1LL) == kMax);
    CHECK(fp_add_saturating(kMin, -1LL) == kMin);
}

TEST_CASE("double conversion clamps non-finite and huge inputs") {
    constexpr int64_t kMax = (std::numeric_limits<int64_t>::max)();
    constexpr int64_t kMin = (std::numeric_limits<int64_t>::min)();

    CHECK(d_to_fp(std::numeric_limits<double>::infinity()) == kMax);
    CHECK(d_to_fp(-std::numeric_limits<double>::infinity()) == kMin);
    CHECK(d_to_fp(std::numeric_limits<double>::quiet_NaN()) == 0LL);
    CHECK(d_to_fp(1.25) == 1'250'000LL);
}

TEST_CASE("CausalEngine blank slate stays neutral until scenario injection") {
    CausalEngine engine;
    engine.load_universal_blank_slate();

    EngineSnapshot snap = engine.run_ticks(3);
    CHECK(engine.current_tick() == 3u);
    CHECK(snap.tick == 2u);
    CHECK(snap.raw_friction_fp == FP_ONE);
    CHECK(snap.clamped_friction_fp == FP_ONE);
    CHECK(snap.throughput_ratio == 1.0);
    CHECK(snap.throughput_ratio_fp == FP_ONE);
    CHECK(!snap.regime_exceeded);
    CHECK(!snap.outage_active);
}

TEST_CASE("intel injection can change causal friction") {
    CausalEngine engine;
    engine.load_universal_blank_slate();
    const int64_t before = engine.run_ticks(1).clamped_friction_fp;

    engine.inject_intel(0.90, 3, "unit-test escalation");
    const int64_t after = engine.run_ticks(1).clamped_friction_fp;

    CHECK(after > before);
    CHECK(after <= FRICTION_MAX_FP);
}

TEST_CASE("failed lever lockout expires after lockout ticks") {
    CausalEngine engine;
    Node node;
    node.id = "N";
    node.capacity_fp = FP_ONE;
    engine.add_node(node);

    Lever lever;
    lever.id = "L";
    lever.success_p_fp = 0;
    lever.lockout_ticks = 2;
    lever.on_failure.target_node_id = "N";
    lever.on_failure.state_delta_fp = 100'000;
    engine.add_lever(lever);

    CHECK(!engine.apply_lever("L", 0));
    REQUIRE(engine.get_node("N") != nullptr);
    CHECK(engine.get_node("N")->state_fp == 100'000);
    CHECK(!engine.apply_lever("L", 0));
    CHECK(engine.get_node("N")->state_fp == 100'000);
    engine.run_ticks(1);
    CHECK(!engine.apply_lever("L", 0));
    CHECK(engine.get_node("N")->state_fp == 100'000);
    engine.run_ticks(1);
    CHECK(!engine.apply_lever("L", 0));
    CHECK(engine.get_node("N")->state_fp == 200'000);
}

TEST_CASE("successful lever observes cost tick cooldown") {
    CausalEngine engine;
    Node node;
    node.id = "N";
    node.capacity_fp = FP_ONE;
    engine.add_node(node);

    Lever lever;
    lever.id = "L";
    lever.success_p_fp = FP_ONE;
    lever.cost_ticks = 3;
    lever.on_success.target_node_id = "N";
    lever.on_success.state_delta_fp = 100'000;
    engine.add_lever(lever);

    CHECK(engine.apply_lever("L", 0));
    REQUIRE(engine.get_node("N") != nullptr);
    CHECK(engine.get_node("N")->state_fp == 100'000);
    CHECK(!engine.apply_lever("L", 0));
    CHECK(engine.get_node("N")->state_fp == 100'000);
    engine.run_ticks(2);
    CHECK(engine.apply_lever("L", 0));
    CHECK(engine.get_node("N")->state_fp == 200'000);
}

TEST_CASE("snapshot exposes fixed-point throughput ratio") {
    CausalEngine engine;
    engine.load_universal_blank_slate();
    engine.inject_intel(0.90, 3, "unit-test escalation");
    const EngineSnapshot snap = engine.run_ticks(1);

    CHECK(snap.throughput_ratio_fp == fp_div(FP_ONE, snap.clamped_friction_fp));
    CHECK(snap.throughput_ratio == fp_to_d(snap.throughput_ratio_fp));
}

TEST_CASE("neural V1 contract rejects malformed fixed-point inputs") {
    CaelusNeuralNodeInputV1 node{};
    node.struct_size = sizeof(node);
    node.node_index = 0;
    std::strncpy(node.node_id, "N", sizeof(node.node_id) - 1);
    node.node_kind = static_cast<uint32_t>(NodeKind::Buffer);
    node.capacity_fp = FP_ONE;
    node.authoritative_state_fp = 500'000;
    node.reported_state_fp = 800'000;
    node.trust_fp = 700'000;
    node.queue_utilization_fp = 500'000;
    node.outage_latched_fp = 0;
    node.intel_risk_fp = 200'000;
    CHECK(caelus::neural::node_input_ranges_valid(node));

    node.authoritative_state_fp = FP_ONE + 1;
    CHECK(!caelus::neural::node_input_ranges_valid(node));
    node.authoritative_state_fp = 500'000;
    node.trust_fp = -1;
    CHECK(!caelus::neural::node_input_ranges_valid(node));
}

TEST_CASE("neural V1 output ranges reject instead of implicitly clamping") {
    CaelusNeuralNodeInputV1 node{};
    node.struct_size = sizeof(node);
    node.node_index = 0;
    std::strncpy(node.node_id, "N", sizeof(node.node_id) - 1);
    node.capacity_fp = FP_ONE;
    node.trust_fp = FP_ONE;

    CaelusNeuralInputV1 input{};
    input.struct_size = sizeof(input);
    input.neural_abi_version = CAELUS_NEURAL_ABI_V1;
    input.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
    input.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
    std::strncpy(input.scenario_id, "TEST", sizeof(input.scenario_id) - 1);
    std::strncpy(input.engine_version, "2.0.0", sizeof(input.engine_version) - 1);
    input.node_count = 1;
    input.nodes = &node;

    CaelusNeuralOutputBufferV1 output{};
    output.struct_size = sizeof(output);
    output.output_schema_version = CAELUS_NEURAL_OUTPUT_V1;
    output.runtime_status = CAELUS_NEURAL_STATUS_OK;
    output.feature_schema_version = input.feature_schema_version;
    output.node_count = 1;
    output.nodes[0].node_index = 0;
    output.nodes[0].estimated_true_state_fp = 500'000;
    output.nodes[0].telemetry_anomaly_score_fp = 100'000;
    output.nodes[0].confidence_fp = 900'000;
    output.nodes[0].out_of_distribution_score_fp = 100'000;
    output.nodes[0].outage_probability_short_fp = 200'000;
    output.nodes[0].outage_probability_medium_fp = 300'000;
    output.nodes[0].outage_probability_long_fp = 400'000;
    CHECK(caelus::neural::output_ranges_valid(input, output));

    output.nodes[0].confidence_fp = FP_ONE + 1;
    CHECK(!caelus::neural::output_ranges_valid(input, output));
}

TEST_CASE("neural V1 input validation rejects null ABI spans") {
    CaelusNeuralInputV1 input{};
    input.struct_size = sizeof(input);
    input.neural_abi_version = CAELUS_NEURAL_ABI_V1;
    input.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
    input.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
    input.node_count = 1;
    input.nodes = nullptr;
    CHECK(!caelus::neural::input_ranges_valid(input));
}

TEST_CASE("owned neural snapshot derives bounded spans from owned storage") {
    CaelusNeuralNodeInputV1 node{};
    node.struct_size = sizeof(node);
    std::strncpy(node.node_id, "N", sizeof(node.node_id) - 1);
    node.capacity_fp = FP_ONE;
    node.trust_fp = FP_ONE;

    CaelusNeuralInputV1 metadata{};
    metadata.struct_size = sizeof(metadata);
    metadata.neural_abi_version = CAELUS_NEURAL_ABI_V1;
    metadata.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
    metadata.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
    std::strncpy(metadata.scenario_id, "TEST", sizeof(metadata.scenario_id) - 1);
    std::strncpy(metadata.engine_version, "2.0.0",
                 sizeof(metadata.engine_version) - 1);
    metadata.node_count = CAELUS_NEURAL_MAX_NODES_V1;
    metadata.nodes = &node;

    std::vector<CaelusNeuralNodeInputV1> caller_nodes{node};
    auto snapshot = caelus::neural::NeuralInputSnapshotV1::create(
        metadata, caller_nodes, {}, {});
    REQUIRE(snapshot.has_value());
    caller_nodes[0].trust_fp = -1;
    CHECK(snapshot->node_count() == 1u);
    CHECK(caelus::neural::input_ranges_valid(*snapshot));
}

TEST_CASE("neural V1 policy prevents cumulative duplicate trust proposals") {
    CaelusNeuralNodeInputV1 nodes[2]{};
    for (uint32_t i = 0; i < 2; ++i) {
        nodes[i].struct_size = sizeof(nodes[i]);
        nodes[i].node_index = i;
        std::snprintf(nodes[i].node_id, sizeof(nodes[i].node_id), "N%u", i);
        nodes[i].capacity_fp = FP_ONE;
        nodes[i].trust_fp = 980'000;
    }

    CaelusNeuralInputV1 input{};
    input.struct_size = sizeof(input);
    input.neural_abi_version = CAELUS_NEURAL_ABI_V1;
    input.feature_schema_version = CAELUS_FEATURE_SCHEMA_V1;
    input.history_length = CAELUS_NEURAL_HISTORY_TICKS_V1;
    std::strncpy(input.scenario_id, "TEST", sizeof(input.scenario_id) - 1);
    std::strncpy(input.engine_version, "2.0.0", sizeof(input.engine_version) - 1);
    input.node_count = 2;
    input.nodes = nodes;

    CaelusNeuralOutputBufferV1 output{};
    output.struct_size = sizeof(output);
    output.output_schema_version = CAELUS_NEURAL_OUTPUT_V1;
    output.runtime_status = CAELUS_NEURAL_STATUS_OK;
    output.feature_schema_version = input.feature_schema_version;
    output.node_count = 2;
    for (uint32_t i = 0; i < output.node_count; ++i) {
        output.nodes[i].node_index = i;
        output.nodes[i].estimated_true_state_fp = 0;
        output.nodes[i].confidence_fp = 900'000;
    }
    output.proposal_count = 2;
    for (uint32_t i = 0; i < output.proposal_count; ++i) {
        output.proposals[i].kind = CAELUS_NEURAL_PROPOSAL_TRUST_DELTA;
        output.proposals[i].node_index = 0;
        output.proposals[i].proposed_delta_fp = -20'000;
        output.proposals[i].authorized_min_fp = -50'000;
        output.proposals[i].authorized_max_fp = 20'000;
    }
    CHECK(!caelus::neural::output_ranges_valid(input, output));

    output.proposals[0].node_index = 0;
    output.proposals[1].node_index = 1;
    output.proposals[0].proposed_delta_fp = 30'000; // would put trust above 1.0
    CHECK(!caelus::neural::output_ranges_valid(input, output));

    output.proposals[0].proposed_delta_fp = (std::numeric_limits<int64_t>::min)();
    CHECK(!caelus::neural::output_ranges_valid(input, output));
}

TEST_CASE("neural model manifest rejects unknown critical fields") {
    const std::string manifest = R"JSON({
        "manifest_version":1,
        "unexpected_critical_field":true
    })JSON";
    std::vector<uint8_t> bytes(manifest.begin(), manifest.end());
    caelus::neural::NeuralModelManifestV1 parsed;
    caelus::neural::ModelLoadStatus status =
        caelus::neural::ModelLoadStatus::Unavailable;
    std::string error;
    CHECK(!caelus::neural::model_detail::parse_manifest(
        bytes, parsed, status, error));
    CHECK(status == caelus::neural::ModelLoadStatus::UnknownManifestField);
}

TEST_CASE("neural weights header validates exact tensor dimensions and size") {
    using namespace caelus::neural;
    NeuralModelManifestV1 manifest;
    manifest.input_features = CAELUS_NEURAL_FEATURES_V1;
    manifest.hidden_dimensions = CAELUS_NEURAL_HIDDEN_V1;
    manifest.message_passing_layers = 2;
    manifest.weight_count = kExpectedWeightCountV1;
    manifest.bias_count = kExpectedBiasCountV1;
    manifest.weights_size = static_cast<uint32_t>(
        kWeightsHeaderBytesV1 + kExpectedWeightCountV1 +
        kExpectedBiasCountV1 * 4u);

    std::vector<uint8_t> data(manifest.weights_size, 0u);
    const uint8_t magic[8] = {'C','A','E','L','N','N','1','\0'};
    std::memcpy(data.data(), magic, sizeof(magic));
    auto write_u32 = [&](size_t offset, uint32_t value) {
        for (size_t i = 0; i < 4; ++i)
            data[offset + i] = static_cast<uint8_t>(value >> (i * 8u));
    };
    auto write_u64 = [&](size_t offset, uint64_t value) {
        for (size_t i = 0; i < 8; ++i)
            data[offset + i] = static_cast<uint8_t>(value >> (i * 8u));
    };
    write_u32(8, kWeightsFormatVersionV1);
    write_u32(12, kWeightsEndianMarkerV1);
    write_u32(16, manifest.input_features);
    write_u32(20, manifest.hidden_dimensions);
    write_u32(24, manifest.message_passing_layers);
    write_u32(28, manifest.weight_count);
    write_u32(32, manifest.bias_count);
    write_u32(36, 0);
    write_u64(40, static_cast<uint64_t>(manifest.weight_count) +
                      static_cast<uint64_t>(manifest.bias_count) * 4u);
    std::string error;
    CHECK(model_detail::validate_weights_header(data, manifest, error));

    write_u32(20, manifest.hidden_dimensions + 1u);
    CHECK(!model_detail::validate_weights_header(data, manifest, error));
}

TEST_CASE("dedicated neural trust anchor is a valid distinct public key") {
    std::array<uint8_t, 32> neural_key{};
    CHECK(caelus::neural::default_trusted_neural_pubkey(neural_key));
    const std::array<uint8_t, 32> scenario_key = {
        0x9b, 0xb1, 0xdb, 0xd0, 0x39, 0x04, 0x36, 0x70,
        0xb7, 0xbf, 0x2c, 0x5d, 0x75, 0x33, 0x77, 0x78,
        0x66, 0x13, 0x5b, 0x92, 0xf9, 0xb3, 0x8f, 0xe6,
        0xcd, 0x8d, 0x97, 0x35, 0xa0, 0x4f, 0xa8, 0x02
    };
    CHECK(!caelus::neural::model_detail::constant_time_equal(
        neural_key.data(), scenario_key.data(), neural_key.size()));
}

TEST_CASE("neural package identity binds signed manifest and weights") {
    std::array<uint8_t, 32> manifest_a{};
    std::array<uint8_t, 32> manifest_b{};
    std::array<uint8_t, 32> weights_hash{};
    manifest_a.fill(0x11u);
    manifest_b.fill(0x22u);
    weights_hash.fill(0x33u);
    std::array<uint8_t, 32> package_a{};
    std::array<uint8_t, 32> package_b{};
    REQUIRE(caelus::neural::compute_neural_package_hash(
        manifest_a, weights_hash, package_a));
    REQUIRE(caelus::neural::compute_neural_package_hash(
        manifest_b, weights_hash, package_b));
    CHECK(!caelus::neural::hash_detail::hash_equal(
        package_a.data(), package_b.data()));
}

TEST_CASE("deterministic INT8 neural runtime is repeatable and nontrivial") {
    const auto model = neural_runtime_fixture_model();
    NeuralRuntimeFixtureInput fixture;
    const auto snapshot = fixture.snapshot();
    const auto policy = caelus::neural::default_assurance_policy();
    const auto first = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        model, snapshot, policy);
    const auto second = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        model, snapshot, policy);

    REQUIRE(first.runtime_status == CAELUS_NEURAL_STATUS_OK);
    CHECK(first.node_count == 2);
    CHECK(first.proposal_count == 2);
    CHECK(first.lever_score_count == 1);
    CHECK(first.nodes[0].estimated_true_state_fp !=
          fixture.nodes[0].reported_state_fp);
    CHECK(first.saturation_count == second.saturation_count);
    for (uint32_t i = 0; i < first.node_count; ++i) {
        CHECK(first.nodes[i].estimated_true_state_fp ==
              second.nodes[i].estimated_true_state_fp);
        CHECK(first.nodes[i].telemetry_anomaly_score_fp ==
              second.nodes[i].telemetry_anomaly_score_fp);
        CHECK(first.nodes[i].confidence_fp == second.nodes[i].confidence_fp);
        CHECK(first.nodes[i].out_of_distribution_score_fp ==
              second.nodes[i].out_of_distribution_score_fp);
    }
    CHECK(first.lever_scores[0].score_fp == second.lever_scores[0].score_fp);
    CHECK(caelus::neural::output_ranges_valid(snapshot, first, policy));
}

TEST_CASE("deterministic neural operation budget fails closed as timeout") {
    const auto model = neural_runtime_fixture_model();
    NeuralRuntimeFixtureInput fixture;
    const auto snapshot = fixture.snapshot();
    auto policy = caelus::neural::default_assurance_policy();
    policy.max_inference_steps = 1;
    const auto output = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        model, snapshot, policy);
    CHECK(output.runtime_status == CAELUS_NEURAL_STATUS_TIMEOUT);
    CHECK(output.node_count == 0);
    CHECK(output.proposal_count == 0);
    CHECK(output.lever_score_count == 0);

    // This budget expires after the first node proposal would have been
    // produced; no partial proposal/output may escape.
    policy.max_inference_steps = 9'900;
    const auto late_timeout = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        model, snapshot, policy);
    CHECK(late_timeout.runtime_status == CAELUS_NEURAL_STATUS_TIMEOUT);
    CHECK(late_timeout.node_count == 0);
    CHECK(late_timeout.proposal_count == 0);
    CHECK(late_timeout.lever_score_count == 0);
}

TEST_CASE("neural feature V1 withholds authority and encodes telemetry missingness") {
    NeuralRuntimeFixtureInput fixture;
    const auto feature =
        caelus::neural::runtime_detail::encode_features(fixture.nodes[0]);
    CHECK(feature[0] == 0);
    CHECK(feature[1] == 0);
    CHECK(feature[2] == 730'000);
    CHECK(feature[3] == 0);
    CHECK(feature[4] == 0);
    CHECK(feature[5] == 0);
    CHECK(feature[6] == 0);
    CHECK(feature[9] == 0);
    CHECK(feature[14] == 0);
    CHECK(feature[15] == 200'000);

    auto changed_authority = fixture.nodes[0];
    changed_authority.authoritative_state_fp = 900'000;
    std::fill(std::begin(changed_authority.state_history_fp),
              std::end(changed_authority.state_history_fp), 900'000);
    CHECK(caelus::neural::runtime_detail::encode_features(
              changed_authority) == feature);

    fixture.nodes[0].missing_mask =
        CAELUS_NEURAL_MISSING_STATE_HISTORY |
        CAELUS_NEURAL_MISSING_REPORTED_HISTORY;
    const auto missing =
        caelus::neural::runtime_detail::encode_features(fixture.nodes[0]);
    CHECK(missing[3] == 0);
    CHECK(missing[4] == 0);
    CHECK(missing[5] == 0);
    CHECK(missing[6] == 0);
    CHECK(missing[14] == 2 * FP_ONE / 7);
}

TEST_CASE("central neural gate enforces confidence OOD and symbolic-only policy") {
    const auto model = neural_runtime_fixture_model();
    NeuralRuntimeFixtureInput fixture;
    const auto snapshot = fixture.snapshot();
    auto policy = caelus::neural::default_assurance_policy();
    policy.minimum_confidence_fp = 0;
    policy.maximum_ood_fp = FP_ONE;
    auto output = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        model, snapshot, policy);
    REQUIRE(output.runtime_status == CAELUS_NEURAL_STATUS_OK);
    auto gate = caelus::neural::NeuralGateV1::evaluate(
        model, snapshot, output, policy);
    CHECK((gate.decision == CAELUS_NEURAL_GATE_ACCEPTED_BOUNDED ||
           gate.decision == CAELUS_NEURAL_GATE_ACCEPTED_ADVISORY));
    CHECK(caelus::neural::hash_detail::hash_equal(
        gate.model_hash, model.package_hash().data()));
    CHECK(caelus::neural::hash_detail::hash_equal(
        gate.input_hash, output.input_hash));
    std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1> expected_output_hash{};
    REQUIRE(caelus::neural::hash_detail::output_hash(
        output, expected_output_hash.data()));
    CHECK(caelus::neural::hash_detail::hash_equal(
        gate.output_hash, expected_output_hash.data()));
    std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1> expected_policy_hash{};
    REQUIRE(caelus::neural::hash_detail::policy_hash(
        policy, expected_policy_hash.data()));
    CHECK(caelus::neural::hash_detail::hash_equal(
        gate.policy_hash, expected_policy_hash.data()));

    auto no_trust_policy = policy;
    no_trust_policy.require_trusted_model = 0;
    const caelus::neural::NeuralModelPackage untrusted_model;
    auto untrusted_gate = caelus::neural::NeuralGateV1::evaluate(
        untrusted_model, snapshot, output, no_trust_policy);
    CHECK(untrusted_gate.decision ==
          CAELUS_NEURAL_GATE_REJECTED_MODEL_TRUST);

    auto advisory_policy = policy;
    advisory_policy.mode = CAELUS_NEURAL_MODE_ADVISORY;
    CHECK(!caelus::neural::output_ranges_valid(
        snapshot, output, advisory_policy));

    output.input_hash[0] ^= 1u;
    gate = caelus::neural::NeuralGateV1::evaluate(
        model, snapshot, output, policy);
    CHECK(gate.decision == CAELUS_NEURAL_GATE_REJECTED_INVARIANT);
    output.input_hash[0] ^= 1u;

    output.nodes[0].confidence_fp = 500'000;
    policy.minimum_confidence_fp = 500'001;
    gate = caelus::neural::NeuralGateV1::evaluate(
        model, snapshot, output, policy);
    CHECK(gate.decision == CAELUS_NEURAL_GATE_REJECTED_LOW_CONFIDENCE);

    policy.minimum_confidence_fp = 0;
    output.nodes[0].confidence_fp = 500'000;
    output.nodes[0].out_of_distribution_score_fp = 500'000;
    policy.maximum_ood_fp = 499'999;
    gate = caelus::neural::NeuralGateV1::evaluate(
        model, snapshot, output, policy);
    CHECK(gate.decision == CAELUS_NEURAL_GATE_REJECTED_OOD);

    policy.mode = CAELUS_NEURAL_MODE_SYMBOLIC_ONLY;
    gate = caelus::neural::NeuralGateV1::evaluate(
        model, snapshot, output, policy);
    CHECK(gate.decision == CAELUS_NEURAL_GATE_SYMBOLIC_FALLBACK);
}

TEST_CASE("neural missing masks zero unavailable features and obey policy count") {
    const auto model = neural_runtime_fixture_model();
    NeuralRuntimeFixtureInput fixture;
    fixture.nodes[0].missing_mask =
        CAELUS_NEURAL_MISSING_FLOW |
        CAELUS_NEURAL_MISSING_DEADLINE |
        CAELUS_NEURAL_MISSING_HYSTERESIS |
        CAELUS_NEURAL_MISSING_INTEL;
    fixture.input.missing_value_count = 4;
    const auto feature =
        caelus::neural::runtime_detail::encode_features(fixture.nodes[0]);
    CHECK(feature[7] == 0);
    CHECK(feature[8] == 0);
    CHECK(feature[10] == 0);
    CHECK(feature[11] == 0);
    CHECK(feature[13] == 0);

    auto policy = caelus::neural::default_assurance_policy();
    policy.max_missing_values = 3;
    const auto snapshot = fixture.snapshot();
    const auto output = caelus::neural::DeterministicNeuralRuntimeV1::infer(
        model, snapshot, policy);
    CHECK(output.runtime_status == CAELUS_NEURAL_STATUS_MALFORMED_INPUT);
    CHECK(output.node_count == 0);
}

TEST_CASE("symbolic authority applies bounded trust adjustments atomically") {
    CausalEngine engine;
    Node first;
    first.id = "FIRST";
    first.capacity_fp = FP_ONE;
    first.trust_fp = 500'000;
    Node second = first;
    second.id = "SECOND";
    second.trust_fp = 980'000;
    engine.add_node(first);
    engine.add_node(second);

    const std::vector<BoundedTrustAdjustment> duplicate = {
        {0u, 10'000}, {0u, -10'000}};
    CHECK(!engine.apply_bounded_trust_adjustments(duplicate, 50'000));
    CHECK(engine.nodes()[0].trust_fp == 500'000);
    CHECK(engine.nodes()[1].trust_fp == 980'000);

    const std::vector<BoundedTrustAdjustment> overflow = {
        {0u, -10'000}, {1u, 30'000}};
    CHECK(!engine.apply_bounded_trust_adjustments(overflow, 50'000));
    CHECK(engine.nodes()[0].trust_fp == 500'000);
    CHECK(engine.nodes()[1].trust_fp == 980'000);

    const std::vector<BoundedTrustAdjustment> accepted = {
        {0u, -10'000}, {1u, 20'000}};
    CHECK(engine.apply_bounded_trust_adjustments(accepted, 50'000));
    CHECK(engine.nodes()[0].trust_fp == 490'000);
    CHECK(engine.nodes()[1].trust_fp == FP_ONE);
}

TEST_CASE("neural host consumes graph history and safely rejects unavailable model") {
    CausalEngine engine;
    Node source;
    source.id = "SOURCE";
    source.kind = NodeKind::Buffer;
    source.capacity_fp = FP_ONE;
    source.state_fp = 400'000;
    source.reported_state_fp = 200'000;
    source.trust_fp = 700'000;
    Node destination = source;
    destination.id = "DESTINATION";
    destination.kind = NodeKind::Service;
    destination.state_fp = 100'000;
    destination.reported_state_fp = 100'000;
    destination.trust_fp = FP_ONE;
    engine.add_node(source);
    engine.add_node(destination);
    engine.add_edge(Edge{"SOURCE", "DESTINATION", 900'000, 1, true});
    Lever lever;
    lever.id = "RECOVER";
    lever.success_p_fp = 800'000;
    lever.cost_ticks = 2;
    engine.add_lever(lever);
    engine.inject_intel_fp(300'000, 1, "test");

    std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1> scenario_hash{};
    scenario_hash.fill(0x5au);
    caelus::neural::NeuralControllerV1 controller;
    controller.configure(
        CAELUS_NEURAL_MODE_ASSURANCE, "", "TEST_SCENARIO", scenario_hash);
    REQUIRE(controller.initialise_history(engine));
    engine.tick();
    REQUIRE(controller.observe_tick(engine));

    const int64_t trust_before = engine.nodes()[0].trust_fp;
    auto evidence = controller.evaluate(engine, false);
    CHECK(evidence.attempted);
    CHECK(evidence.snapshot_valid);
    CHECK(evidence.observed_history_ticks == 1u);
    CHECK(evidence.gate.decision == CAELUS_NEURAL_GATE_REJECTED_MODEL_TRUST);
    CHECK(evidence.applied_proposals.empty());
    CHECK(!evidence.authority_record_required);
    CHECK(engine.nodes()[0].trust_fp == trust_before);

    const std::string audit =
        caelus::neural::neural_inference_audit_event(controller, evidence, 7u);
    CHECK(audit.find("\"type\":\"NEURAL_INFERENCE_V1\"") != std::string::npos);
    CHECK(audit.find("\"fallback\":true") != std::string::npos);
    CHECK(audit.find("\"authority_expected\":false") != std::string::npos);

    const std::string telemetry =
        caelus::neural::neural_war_room_event(controller, evidence);
    CHECK(telemetry.find("\"reported_state_fp\":\"") != std::string::npos);
    CHECK(telemetry.find("\"authoritative_state_fp\":\"") != std::string::npos);
}

TEST_CASE("solver C ABI structs round-trip through plugin vtable") {
    caelus::SolverRequest req{};
    req.friction_multiplier = 2.0;
    req.task_start_min = 360;
    req.target_deadline_min = 480;
    req.commit_overhead_min = 30;
    req.base_transit_low_min = 45;
    req.base_transit_high_min = 65;

    const CaelusSolverRequest c_req = req.to_c();
    const caelus::SolverRequest req_roundtrip(c_req);
    CHECK(req_roundtrip.travel_low() == 90);
    CHECK(req_roundtrip.travel_high() == 130);

    const CaelusPluginVTable* vtbl = caelus::DeterministicSolver::make_vtable();
    REQUIRE(vtbl != nullptr);
    REQUIRE(vtbl->solve != nullptr);

    CaelusSolverResult c_res{};
    CHECK(vtbl->solve(&c_req, &c_res) == 1);
    CHECK(c_res.travel_low == 90);
    CHECK(c_res.travel_high == 130);
    CHECK(c_res.arrival_min == 490);
    CHECK(c_res.completion_min == 520);
    CHECK(c_res.on_time == 0);
    CHECK(c_res.feasible == 1);
    CHECK(std::strcmp(c_res.status_msg, "SOLVED") == 0);

    const caelus::SolverResult result = caelus::SolverResult::from_c(c_res);
    CHECK(result.travel_low == 90);
    CHECK(result.travel_high == 130);
    CHECK(result.arrival == 490);
    CHECK(result.completion == 520);
    CHECK(!result.on_time);
    CHECK(result.feasible);
}

TEST_CASE("JsonParser rejects malformed numbers without throwing") {
    caelus::JsonVal root;
    std::string malformed = "{\"n\":1e999999999999999999999}";
    caelus::JsonParser parser(malformed.data(), malformed.size());
    CHECK(!parser.parse(root));
}

TEST_CASE("JsonParser enforces recursion depth") {
    std::string nested;
    for (int i = 0; i < 70; ++i) nested.push_back('[');
    nested += "0";
    for (int i = 0; i < 70; ++i) nested.push_back(']');

    caelus::JsonVal root;
    caelus::JsonParser parser(nested.data(), nested.size());
    CHECK(!parser.parse(root));
}

TEST_CASE("signature gate reports REJECTED for empty signature") {
    g_stub_ed25519_result = 1;
    auto root = parse_json(scenario_json(""));
    std::string status = "x", scheme = "x";
    CHECK(!caelus::ScenarioPack::test_verify_signature_gate(root, "", status, scheme));
    CHECK(status == "REJECTED");
}

TEST_CASE("signature gate rejects SELF_SIGNED_DEV without dev flag") {
    set_env_flag("CAELUS_ALLOW_DEV_SCENARIOS", false);
    auto root = parse_json(scenario_json("SELF_SIGNED_DEV"));
    std::string status, scheme;
    CHECK(!caelus::ScenarioPack::test_verify_signature_gate(
        root, "SELF_SIGNED_DEV", status, scheme));
    CHECK(status == "REJECTED");
}

TEST_CASE("signature gate accepts SELF_SIGNED_DEV only with dev flag") {
    set_env_flag("CAELUS_ALLOW_DEV_SCENARIOS", true);
    auto root = parse_json(scenario_json("SELF_SIGNED_DEV"));
    std::string status, scheme;
    CHECK(caelus::ScenarioPack::test_verify_signature_gate(
        root, "SELF_SIGNED_DEV", status, scheme));
    CHECK(status == "SELF_SIGNED_DEV");
    CHECK(scheme == "self-signed-dev");
    set_env_flag("CAELUS_ALLOW_DEV_SCENARIOS", false);
}

TEST_CASE("signature gate rejects a tampered scenario (ed25519 fails)") {
    // Simulates a payload mutation: the canonical bytes no longer match the
    // signature, so the ed25519 check returns 0 and the gate must fail closed.
    set_env_flag("CAELUS_ALLOW_DEV_SCENARIOS", false);
    set_env_flag("CAELUS_TRUST_ANY_PUBKEY", false);
    g_stub_ed25519_result = 0;
    const std::string sig =
        std::string("ed25519:") + kTrustedPubHex + ":" + kSigHex;
    auto root = parse_json(scenario_json(sig));
    std::string status, scheme;
    CHECK(!caelus::ScenarioPack::test_verify_signature_gate(root, sig, status, scheme));
    CHECK(status == "REJECTED");
    g_stub_ed25519_result = 1;
}

TEST_CASE("signature gate VERIFIED only for the pinned trust anchor") {
    set_env_flag("CAELUS_ALLOW_DEV_SCENARIOS", false);
    set_env_flag("CAELUS_TRUST_ANY_PUBKEY", false);
    g_stub_ed25519_result = 1;
    const std::string sig =
        std::string("ed25519:") + kTrustedPubHex + ":" + kSigHex;
    auto root = parse_json(scenario_json(sig));
    std::string status, scheme;
    CHECK(caelus::ScenarioPack::test_verify_signature_gate(root, sig, status, scheme));
    CHECK(status == "VERIFIED");
    CHECK(scheme == "ed25519+pinned");
}

TEST_CASE("signature gate rejects a valid signature from an untrusted key") {
    set_env_flag("CAELUS_ALLOW_DEV_SCENARIOS", false);
    set_env_flag("CAELUS_TRUST_ANY_PUBKEY", false);
    g_stub_ed25519_result = 1;
    const std::string sig =
        std::string("ed25519:") + kUntrustedPubHex + ":" + kSigHex;
    auto root = parse_json(scenario_json(sig));
    std::string status, scheme;
    CHECK(!caelus::ScenarioPack::test_verify_signature_gate(root, sig, status, scheme));
    CHECK(status == "REJECTED");
}

TEST_CASE("untrusted key is DEV_TRUST_BYPASS, never VERIFIED, under dev bypass") {
    set_env_flag("CAELUS_TRUST_ANY_PUBKEY", true);
    g_stub_ed25519_result = 1;
    const std::string sig =
        std::string("ed25519:") + kUntrustedPubHex + ":" + kSigHex;
    auto root = parse_json(scenario_json(sig));
    std::string status, scheme;
    CHECK(caelus::ScenarioPack::test_verify_signature_gate(root, sig, status, scheme));
    CHECK(status == "DEV_TRUST_BYPASS");
    CHECK(status != "VERIFIED");
    CHECK(scheme == "ed25519+unpinned");
    set_env_flag("CAELUS_TRUST_ANY_PUBKEY", false);
}

TEST_CASE("JsonParser strictly handles unicode escapes") {
    {
        std::string ok = "{\"s\":\"A\\u0041\\uD834\\uDD1E\"}";
        caelus::JsonVal root;
        caelus::JsonParser parser(ok.data(), ok.size());
        CHECK(parser.parse(root));
        CHECK(root["s"].as_s().find("AA") == 0);
    }
    {
        std::string lone_low = "{\"s\":\"\\uDD1E\"}";
        caelus::JsonVal root;
        caelus::JsonParser parser(lone_low.data(), lone_low.size());
        CHECK(!parser.parse(root));
    }
    {
        std::string high_without_low = "{\"s\":\"\\uD834x\"}";
        caelus::JsonVal root;
        caelus::JsonParser parser(high_without_low.data(), high_without_low.size());
        CHECK(!parser.parse(root));
    }
}
