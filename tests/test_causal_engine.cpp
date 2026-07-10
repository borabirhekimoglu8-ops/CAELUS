#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "causal_engine.h"
#include "scenario_pack.h"
#include "plugin/caelus_solver.h"

#include <cmath>
#include <cstring>
#include <limits>
#include <string>

using namespace caelus::causal;

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

// ─── JsonParser sınır vakaları (güvenlik yüzeyi: untrusted senaryo JSON'u) ───

static bool json_parses(const std::string& doc) {
    caelus::JsonVal root;
    caelus::JsonParser parser(doc.data(), doc.size());
    return parser.parse(root);
}

TEST_CASE("JsonParser rejects truncated documents without crashing") {
    CHECK(!json_parses(""));
    CHECK(!json_parses("   \n\t "));
    CHECK(!json_parses("{"));
    CHECK(!json_parses("["));
    CHECK(!json_parses("{\"k\""));
    CHECK(!json_parses("{\"k\":"));
    CHECK(!json_parses("{\"k\":1,"));
    CHECK(!json_parses("[1,2,"));
    CHECK(!json_parses("\"unterminated"));
    CHECK(!json_parses("\"escape at end\\"));
    CHECK(!json_parses("{\"k\":\"\\u00\"}"));
    CHECK(!json_parses("-"));
    CHECK(!json_parses("1e"));
    CHECK(!json_parses("1e+"));
}

TEST_CASE("JsonParser rejects trailing garbage after a valid document") {
    CHECK(!json_parses("{} {}"));
    CHECK(!json_parses("[1,2] x"));
    CHECK(!json_parses("1 2"));
    CHECK(json_parses("  {\"k\":1}  "));  // çevre boşluğu serbest
}

TEST_CASE("JsonParser rejects malformed literals and number grammar") {
    CHECK(!json_parses("tru"));
    CHECK(!json_parses("TRUE"));
    CHECK(!json_parses("nul"));
    CHECK(!json_parses("None"));
    CHECK(!json_parses("+1"));
    CHECK(!json_parses("01"));       // öncü sıfır yasak (RFC 8259)
    CHECK(!json_parses("-01"));
    CHECK(!json_parses(".5"));
    CHECK(!json_parses("1."));
    CHECK(!json_parses("0x10"));
    CHECK(json_parses("-0"));
    CHECK(json_parses("0.5"));
    CHECK(json_parses("1e10"));
    CHECK(json_parses("-1.25E-3"));
}

TEST_CASE("JsonParser rejects raw control characters inside strings") {
    std::string raw_nl = "{\"s\":\"a\nb\"}";
    CHECK(!json_parses(raw_nl));
    std::string raw_nul("{\"s\":\"a\0b\"}", 12);
    CHECK(!json_parses(raw_nul));
    std::string raw_tab = "{\"s\":\"a\tb\"}";
    CHECK(!json_parses(raw_tab));
    CHECK(json_parses("{\"s\":\"a\\n\\t\\u0000b\"}"));  // escape'li halleri serbest
    CHECK(!json_parses("{\"s\":\"bad\\x escape\"}"));
}

TEST_CASE("JsonParser recursion limit is an exact boundary") {
    auto nested_arrays = [](int levels) {
        std::string doc(static_cast<size_t>(levels), '[');
        doc += "0";
        doc.append(static_cast<size_t>(levels), ']');
        return doc;
    };
    CHECK(json_parses(nested_arrays(64)));   // MAX_RECURSION_DEPTH tam sınırda
    CHECK(!json_parses(nested_arrays(65)));  // bir fazlası reddedilir

    // Nesne + dizi karışık derinlik de aynı limite tabidir.
    std::string mixed;
    for (int i = 0; i < 40; ++i) mixed += "{\"k\":[";
    mixed += "0";
    for (int i = 0; i < 40; ++i) mixed += "]}";
    CHECK(!json_parses(mixed));  // 80 seviye
}

TEST_CASE("JsonParser survives adversarial small inputs (fuzz corpus)") {
    // Sabit tohumlu xoshiro benzeri LCG ile üretilmiş rastgele baytlar:
    // amaç çökmemek ve tutarlı kabul/ret vermek, belirli bir sonuç değil.
    uint64_t s = 0xC0FFEE1234567890ULL;
    auto next = [&s]() {
        s ^= s << 13; s ^= s >> 7; s ^= s << 17;
        return static_cast<unsigned char>(s & 0xFF);
    };
    for (int round = 0; round < 500; ++round) {
        std::string doc;
        const int len = 1 + static_cast<int>(next() % 48);
        for (int i = 0; i < len; ++i) {
            static const char alphabet[] = "{}[]\":,0123456789.eE+-\\utrflans \n\x01\x7f";
            doc += alphabet[next() % (sizeof(alphabet) - 1)];
        }
        caelus::JsonVal root;
        caelus::JsonParser parser(doc.data(), doc.size());
        (void)parser.parse(root);  // çökmediği ve UB üretmediği sürece geçerli
    }
    CHECK(true);
}
