/**
 * CAELUS Mobile — C ABI bridge host-side tests
 * (tests/test_mobile_bridge.cpp)
 *
 * Exercises include/mobile/caelus_mobile.h against the REAL shared core:
 * the genuine Rust staticlib (ed25519 scenario gate, neural trust chain,
 * Blake3 audit chain) is linked in — no crypto stubs.  This is the desktop
 * stand-in for the iOS host: everything the Swift EngineController calls
 * crosses exactly this boundary, so every contract in the header is
 * enforced here first.
 *
 * Fixtures (paths relative to the repository root, override with
 * CAELUS_REPO_ROOT):
 *   scenarios/BS-01_SAHTE_UFUK.json — committed, signed with the pinned
 *     production anchor (sig_status VERIFIED).
 *   scenarios/BS-02_GOLGE_ARSIV.json — second signed scenario for
 *     cross-scenario checkpoint rejection.
 *   models/assurance_v1/ — committed signed deterministic neural package.
 *
 * Build (Linux host):
 *   g++ -std=c++17 -O2 -I. -Iinclude -Isrc \
 *       tests/test_mobile_bridge.cpp src/mobile/caelus_mobile_bridge.cpp \
 *       target/release/libcaelus_network.a -ldl -lpthread -lm \
 *       -o dist/test_mobile_bridge
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#include <direct.h>
#else
#include <sys/stat.h>
#include <unistd.h>
#endif

#include "mobile/caelus_mobile.h"

namespace {

// ── Fixture helpers ─────────────────────────────────────────────────────────

std::string repo_root() {
    const char* env = std::getenv("CAELUS_REPO_ROOT");
    return (env != nullptr && env[0] != '\0') ? std::string(env)
                                              : std::string(".");
}

std::string read_file(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    REQUIRE_MESSAGE(static_cast<bool>(file),
                    ("fixture missing: " + path).c_str());
    std::ostringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

std::vector<uint8_t> read_bytes(const std::string& path) {
    const std::string text = read_file(path);
    return std::vector<uint8_t>(text.begin(), text.end());
}

/** Unique writable scratch directory per test run. */
std::string scratch_dir() {
    static std::atomic<uint32_t> counter{0};
    std::ostringstream path;
#if defined(_WIN32)
    const char* base = std::getenv("TEMP");
    path << (base != nullptr ? base : ".") << "\\caelus_bridge_"
         << static_cast<unsigned long>(_getpid()) << "_"
         << counter.fetch_add(1);
    _mkdir(path.str().c_str());
#else
    const char* base = std::getenv("TMPDIR");
    path << (base != nullptr ? base : "/tmp") << "/caelus_bridge_"
         << static_cast<unsigned long>(getpid()) << "_"
         << counter.fetch_add(1);
    mkdir(path.str().c_str(), 0700);
#endif
    return path.str();
}

struct Fixtures {
    std::string scenario_bs01;
    std::string scenario_bs02;
    std::vector<uint8_t> manifest;
    std::vector<uint8_t> weights;
    std::vector<uint8_t> signature_file;
};

const Fixtures& fixtures() {
    static const Fixtures fixture = [] {
        const std::string root = repo_root();
        Fixtures out;
        out.scenario_bs01 =
            read_file(root + "/scenarios/BS-01_SAHTE_UFUK.json");
        out.scenario_bs02 =
            read_file(root + "/scenarios/BS-02_GOLGE_ARSIV.json");
        out.manifest = read_bytes(root + "/models/assurance_v1/manifest.json");
        out.weights = read_bytes(root + "/models/assurance_v1/weights.bin");
        out.signature_file = read_bytes(root + "/models/assurance_v1/model.sig");
        return out;
    }();
    return fixture;
}

// ── Platform key-protection test delegate ───────────────────────────────────
//
// Stands in for the iOS Keychain/Secure Enclave provider: the identity seed
// is XOR-masked before persistence (obviously NOT protection — the point of
// the host test is the registration/round-trip plumbing, not the platform
// cryptography, which only exists on the device).

constexpr uint8_t kTestKeyMask = 0x5au;
constexpr uint32_t kTestProtectedFormat = 0x00000004u; // PROTECTED_PLUGIN

uint8_t test_protect_key(void* state, const CaelusMobileKeyBlob* plaintext,
                         CaelusMobileKeyBlob* protected_out) {
    (void)state;
    if (plaintext == nullptr || protected_out == nullptr) return 0;
    if (plaintext->len != 32 || protected_out->capacity < 32) return 0;
    for (size_t i = 0; i < 32; ++i) {
        protected_out->data[i] =
            static_cast<uint8_t>(plaintext->data[i] ^ kTestKeyMask);
    }
    protected_out->len = 32;
    protected_out->format = kTestProtectedFormat;
    return 1;
}

uint8_t test_unprotect_key(void* state,
                           const CaelusMobileKeyBlob* protected_in,
                           CaelusMobileKeyBlob* plaintext_out) {
    (void)state;
    if (protected_in == nullptr || plaintext_out == nullptr) return 0;
    if (protected_in->len != 32 || protected_in->format != kTestProtectedFormat ||
        plaintext_out->capacity < 32) {
        return 0;
    }
    for (size_t i = 0; i < 32; ++i) {
        plaintext_out->data[i] =
            static_cast<uint8_t>(protected_in->data[i] ^ kTestKeyMask);
    }
    plaintext_out->len = 32;
    return 1;
}

void register_test_key_protection() {
    REQUIRE(caelus_mobile_register_key_protection_v1(
                &test_protect_key, &test_unprotect_key, nullptr) ==
            CAELUS_MOBILE_OK);
}

// ── Engine construction helpers ─────────────────────────────────────────────

struct EngineBox {
    CaelusMobileEngine* handle = nullptr;
    std::string directory;

    ~EngineBox() { caelus_mobile_engine_destroy_v1(handle); }
};

CaelusMobileEngineConfigV1 base_config(const std::string& directory,
                                       const std::string& identity_path,
                                       uint32_t flags, uint64_t seed,
                                       uint64_t session_id) {
    CaelusMobileEngineConfigV1 config{};
    config.struct_size = sizeof(CaelusMobileEngineConfigV1);
    config.abi_version = CAELUS_MOBILE_ABI_VERSION;
    config.flags = flags;
    config.deterministic_seed = seed;
    config.session_id = session_id;
    config.audit_directory_utf8 =
        reinterpret_cast<const uint8_t*>(directory.data());
    config.audit_directory_len = directory.size();
    config.identity_path_utf8 =
        reinterpret_cast<const uint8_t*>(identity_path.data());
    config.identity_path_len = identity_path.size();
    return config;
}

/** Create a ready engine (fresh scratch dir, fixed seed + session). */
void make_engine(EngineBox& box, uint32_t flags = 0,
                 uint64_t seed = UINT64_C(0xCAE105000000AAAA),
                 uint64_t session_id = UINT64_C(0x1122334455667788)) {
    register_test_key_protection();
    box.directory = scratch_dir();
    const std::string identity_path = box.directory + "/identity.key";
    const CaelusMobileEngineConfigV1 config =
        base_config(box.directory, identity_path, flags, seed, session_id);
    int32_t status = CAELUS_MOBILE_E_INTERNAL;
    box.handle = caelus_mobile_engine_create_v1(&config, &status);
    REQUIRE(status == CAELUS_MOBILE_OK);
    REQUIRE(box.handle != nullptr);
}

int32_t load_scenario(CaelusMobileEngine* engine, const std::string& json) {
    return caelus_mobile_load_scenario_v1(
        engine, reinterpret_cast<const uint8_t*>(json.data()), json.size());
}

int32_t load_model(CaelusMobileEngine* engine, const Fixtures& fixture) {
    return caelus_mobile_load_neural_model_v1(
        engine, fixture.manifest.data(), fixture.manifest.size(),
        fixture.weights.data(), fixture.weights.size(),
        fixture.signature_file.data(), fixture.signature_file.size());
}

std::string fetch_string(
    CaelusMobileEngine* engine,
    int32_t (*getter)(CaelusMobileEngine*, uint8_t*, size_t, size_t*)) {
    size_t needed = 0;
    const int32_t probe = getter(engine, nullptr, 0, &needed);
    if (probe == CAELUS_MOBILE_OK && needed == 0) return {};
    REQUIRE(probe == CAELUS_MOBILE_E_BUFFER_TOO_SMALL);
    std::string payload(needed, '\0');
    size_t written = 0;
    REQUIRE(getter(engine, reinterpret_cast<uint8_t*>(payload.data()),
                   payload.size(), &written) == CAELUS_MOBILE_OK);
    REQUIRE(written == needed);
    return payload;
}

std::string snapshot(CaelusMobileEngine* engine) {
    return fetch_string(engine, &caelus_mobile_snapshot_json_v1);
}

std::string checkpoint(CaelusMobileEngine* engine) {
    return fetch_string(engine, &caelus_mobile_checkpoint_v1);
}

std::string last_error(CaelusMobileEngine* engine) {
    return fetch_string(engine, &caelus_mobile_last_error_v1);
}

/**
 * Deterministic core of a snapshot: everything before the trailing audit
 * section (audit file paths and chain heads legitimately differ between two
 * concurrently running engines writing to different scratch directories).
 */
std::string deterministic_prefix(const std::string& snapshot_json) {
    const size_t position = snapshot_json.rfind(",\"audit\":{");
    REQUIRE(position != std::string::npos);
    return snapshot_json.substr(0, position);
}

int32_t restore(CaelusMobileEngine* engine, const std::string& envelope) {
    return caelus_mobile_restore_checkpoint_v1(
        engine, reinterpret_cast<const uint8_t*>(envelope.data()),
        envelope.size());
}

} // namespace

// ─────────────────────────────────────────────────────────────────────────────
// ABI + configuration validation
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile ABI version is 1") {
    CHECK(caelus_mobile_abi_version_v1() == CAELUS_MOBILE_ABI_VERSION);
}

TEST_CASE("mobile create rejects invalid configuration") {
    int32_t status = 0;

    SUBCASE("null config") {
        CHECK(caelus_mobile_engine_create_v1(nullptr, &status) == nullptr);
        CHECK(status == CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("null out_status is tolerated") {
        CHECK(caelus_mobile_engine_create_v1(nullptr, nullptr) == nullptr);
    }
    SUBCASE("wrong struct_size") {
        const std::string dir = scratch_dir();
        const std::string identity = dir + "/id.key";
        auto config = base_config(dir, identity, 0, 1, 1);
        config.struct_size = 4;
        CHECK(caelus_mobile_engine_create_v1(&config, &status) == nullptr);
        CHECK(status == CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("ABI version mismatch") {
        const std::string dir = scratch_dir();
        const std::string identity = dir + "/id.key";
        auto config = base_config(dir, identity, 0, 1, 1);
        config.abi_version = 999;
        CHECK(caelus_mobile_engine_create_v1(&config, &status) == nullptr);
        CHECK(status == CAELUS_MOBILE_E_ABI_MISMATCH);
    }
    SUBCASE("missing audit directory") {
        const std::string dir = scratch_dir();
        const std::string identity = dir + "/id.key";
        auto config = base_config(dir, identity, 0, 1, 1);
        config.audit_directory_utf8 = nullptr;
        config.audit_directory_len = 0;
        CHECK(caelus_mobile_engine_create_v1(&config, &status) == nullptr);
        CHECK(status == CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("invalid UTF-8 in audit directory") {
        const std::string dir = scratch_dir();
        const std::string identity = dir + "/id.key";
        auto config = base_config(dir, identity, 0, 1, 1);
        static const uint8_t bad[] = {0xff, 0xfe, 0x2f};
        config.audit_directory_utf8 = bad;
        config.audit_directory_len = sizeof(bad);
        CHECK(caelus_mobile_engine_create_v1(&config, &status) == nullptr);
        CHECK(status == CAELUS_MOBILE_E_UTF8);
    }
    SUBCASE("unwritable audit directory fails audit open") {
        register_test_key_protection();
        const std::string dir = "/nonexistent_caelus_dir_zz";
        const std::string identity = scratch_dir() + "/id.key";
        auto config = base_config(dir, identity, 0, 1, 1);
        CHECK(caelus_mobile_engine_create_v1(&config, &status) == nullptr);
        CHECK(status != CAELUS_MOBILE_OK);
    }
}

TEST_CASE("mobile key protection registration contract") {
    SUBCASE("one-sided registration is rejected") {
        CHECK(caelus_mobile_register_key_protection_v1(
                  &test_protect_key, nullptr, nullptr) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_register_key_protection_v1(
                  nullptr, &test_unprotect_key, nullptr) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("without a delegate, plaintext identity persistence is refused") {
        // Clear the delegate: POSIX fallback refuses plaintext key files, so
        // engine creation must fail closed instead of writing a raw seed.
        REQUIRE(caelus_mobile_register_key_protection_v1(
                    nullptr, nullptr, nullptr) == CAELUS_MOBILE_OK);
        const std::string dir = scratch_dir();
        const std::string identity = dir + "/identity.key";
        const auto config = base_config(dir, identity, 0, 1, 1);
        int32_t status = 0;
        CHECK(caelus_mobile_engine_create_v1(&config, &status) == nullptr);
        CHECK(status == CAELUS_MOBILE_E_INTERNAL);
        register_test_key_protection();
    }
    SUBCASE("identity persists and reloads through the delegate") {
        register_test_key_protection();
        const std::string dir = scratch_dir();
        const std::string identity = dir + "/identity.key";
        // First engine creates the protected identity file...
        {
            EngineBox box;
            box.directory = dir;
            const auto config = base_config(dir, identity, 0, 1, 100);
            int32_t status = 0;
            box.handle = caelus_mobile_engine_create_v1(&config, &status);
            REQUIRE(status == CAELUS_MOBILE_OK);
        }
        // ...whose bytes must NOT contain a raw plaintext seed scheme.
        const std::string key_file = read_file(identity);
        CHECK(key_file.find("KEYMGMT") != std::string::npos);
        // Second engine must reload the same identity without error.
        const auto config = base_config(dir, identity, 0, 1, 101);
        int32_t status = 0;
        CaelusMobileEngine* second =
            caelus_mobile_engine_create_v1(&config, &status);
        CHECK(status == CAELUS_MOBILE_OK);
        caelus_mobile_engine_destroy_v1(second);
    }
}

TEST_CASE("mobile create/destroy lifecycle is clean and repeatable") {
    for (int i = 0; i < 3; ++i) {
        EngineBox box;
        make_engine(box);
        CHECK(box.handle != nullptr);
    }
}

TEST_CASE("mobile destroy is NULL-safe; double-destroy and use-after-destroy "
          "are contained by the liveness registry") {
    caelus_mobile_engine_destroy_v1(nullptr);

    EngineBox box;
    make_engine(box);
    CaelusMobileEngine* raw = box.handle;
    box.handle = nullptr; // EngineBox must not double-free below.
    caelus_mobile_engine_destroy_v1(raw);
    // Second destroy: the registry lookup fails, so the pointer is never
    // dereferenced — safe no-op even under ASan.
    caelus_mobile_engine_destroy_v1(raw);
    // Use-after-destroy: every call fails the registry lookup.
    size_t needed = 0;
    CHECK(caelus_mobile_tick_v1(raw, 1) == CAELUS_MOBILE_E_HANDLE);
    CHECK(caelus_mobile_snapshot_json_v1(raw, nullptr, 0, &needed) ==
          CAELUS_MOBILE_E_HANDLE);
    CHECK(caelus_mobile_last_error_v1(raw, nullptr, 0, &needed) ==
          CAELUS_MOBILE_E_HANDLE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario trust gate
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile scenario gate: signed BS-01 loads, tampered byte rejects") {
    SUBCASE("valid signed scenario is accepted with VERIFIED status") {
        EngineBox box;
        make_engine(box);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        const std::string state = snapshot(box.handle);
        CHECK(state.find("\"id\":\"BS-01_SAHTE_UFUK\"") != std::string::npos);
        CHECK(state.find("\"signature_status\":\"VERIFIED\"") !=
              std::string::npos);
        CHECK(state.find("\"loaded\":true") != std::string::npos);
    }

    SUBCASE("a single flipped payload byte is rejected") {
        EngineBox box;
        make_engine(box);
        std::string tampered = fixtures().scenario_bs01;
        // Flip one digit INSIDE the signed critical region
        // (extended_causal_model): a lever success probability.
        const std::string original = "\"success_p_fp\": 750000";
        const size_t position = tampered.find(original);
        REQUIRE(position != std::string::npos);
        tampered.replace(position, original.size(),
                         "\"success_p_fp\": 750001");
        CHECK(load_scenario(box.handle, tampered) ==
              CAELUS_MOBILE_E_SCENARIO_REJECTED);
        const std::string error = last_error(box.handle);
        CHECK(error.find("scenario rejected") != std::string::npos);
        // The engine must still be in the pre-scenario state.
        CHECK(caelus_mobile_tick_v1(box.handle, 1) ==
              CAELUS_MOBILE_E_LIFECYCLE);
    }

    SUBCASE("garbage bytes are rejected") {
        EngineBox box;
        make_engine(box);
        const std::string garbage = "{\"not\":\"a scenario\"}";
        CHECK(load_scenario(box.handle, garbage) ==
              CAELUS_MOBILE_E_SCENARIO_REJECTED);
    }

    SUBCASE("invalid UTF-8 is rejected before parsing") {
        EngineBox box;
        make_engine(box);
        static const uint8_t bad[] = {'{', 0xc0, 0x80, '}'};
        CHECK(caelus_mobile_load_scenario_v1(box.handle, bad, sizeof(bad)) ==
              CAELUS_MOBILE_E_UTF8);
    }

    SUBCASE("null/empty/oversized buffers are rejected") {
        EngineBox box;
        make_engine(box);
        CHECK(caelus_mobile_load_scenario_v1(box.handle, nullptr, 10) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        const uint8_t byte = '{';
        CHECK(caelus_mobile_load_scenario_v1(box.handle, &byte, 0) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_load_scenario_v1(
                  box.handle, &byte,
                  static_cast<size_t>(CAELUS_MOBILE_MAX_SCENARIO_BYTES) + 1) ==
              CAELUS_MOBILE_E_LIMIT);
    }

    SUBCASE("second scenario load is a lifecycle error") {
        EngineBox box;
        make_engine(box);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        CHECK(load_scenario(box.handle, fixtures().scenario_bs01) ==
              CAELUS_MOBILE_E_LIFECYCLE);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Neural model trust gate
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile neural gate: signed package loads, any tamper rejects") {
    const uint32_t flags = CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE;

    SUBCASE("valid signed package is accepted after a verified scenario") {
        EngineBox box;
        make_engine(box, flags);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        REQUIRE(load_model(box.handle, fixtures()) == CAELUS_MOBILE_OK);
        const std::string state = snapshot(box.handle);
        CHECK(state.find("\"mode\":\"ASSURANCE\"") != std::string::npos);
        CHECK(state.find("\"model_loaded\":true") != std::string::npos);
        CHECK(state.find("\"model_status\":\"LOADED\"") != std::string::npos);
    }

    SUBCASE("model before scenario is a lifecycle error") {
        EngineBox box;
        make_engine(box, flags);
        CHECK(load_model(box.handle, fixtures()) == CAELUS_MOBILE_E_LIFECYCLE);
    }

    SUBCASE("model without the assurance flag is a lifecycle error") {
        EngineBox box;
        make_engine(box, 0);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        CHECK(load_model(box.handle, fixtures()) == CAELUS_MOBILE_E_LIFECYCLE);
    }

    SUBCASE("one flipped weights byte fails the signature chain") {
        EngineBox box;
        make_engine(box, flags);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        std::vector<uint8_t> weights = fixtures().weights;
        weights[weights.size() / 2] ^= 0x01u;
        CHECK(caelus_mobile_load_neural_model_v1(
                  box.handle, fixtures().manifest.data(),
                  fixtures().manifest.size(), weights.data(), weights.size(),
                  fixtures().signature_file.data(),
                  fixtures().signature_file.size()) ==
              CAELUS_MOBILE_E_MODEL_REJECTED);
        // Fail-closed: symbolic mode continues to work.
        CHECK(caelus_mobile_tick_v1(box.handle, 1) == CAELUS_MOBILE_OK);
        const std::string state = snapshot(box.handle);
        CHECK(state.find("\"mode\":\"SYMBOLIC_ONLY\"") != std::string::npos);
    }

    SUBCASE("one flipped manifest byte fails the signature chain") {
        EngineBox box;
        make_engine(box, flags);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        std::vector<uint8_t> manifest = fixtures().manifest;
        const std::string needle = "\"model_id\":";
        const auto it = std::search(manifest.begin(), manifest.end(),
                                    needle.begin(), needle.end());
        REQUIRE(it != manifest.end());
        *(it + static_cast<long>(needle.size()) + 1) ^= 0x01u;
        CHECK(caelus_mobile_load_neural_model_v1(
                  box.handle, manifest.data(), manifest.size(),
                  fixtures().weights.data(), fixtures().weights.size(),
                  fixtures().signature_file.data(),
                  fixtures().signature_file.size()) ==
              CAELUS_MOBILE_E_MODEL_REJECTED);
    }

    SUBCASE("null model buffers are rejected") {
        EngineBox box;
        make_engine(box, flags);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        CHECK(caelus_mobile_load_neural_model_v1(
                  box.handle, nullptr, 1, fixtures().weights.data(),
                  fixtures().weights.size(), fixtures().signature_file.data(),
                  fixtures().signature_file.size()) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }

    SUBCASE("oversized manifest is rejected before verification") {
        EngineBox box;
        make_engine(box, flags);
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        const uint8_t byte = '{';
        CHECK(caelus_mobile_load_neural_model_v1(
                  box.handle, &byte,
                  static_cast<size_t>(CAELUS_MOBILE_MAX_MANIFEST_BYTES) + 1,
                  fixtures().weights.data(), fixtures().weights.size(),
                  fixtures().signature_file.data(),
                  fixtures().signature_file.size()) == CAELUS_MOBILE_E_LIMIT);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation + determinism
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile tick validation") {
    EngineBox box;
    make_engine(box);
    SUBCASE("tick before scenario is a lifecycle error") {
        CHECK(caelus_mobile_tick_v1(box.handle, 1) ==
              CAELUS_MOBILE_E_LIFECYCLE);
    }
    SUBCASE("tick_count bounds are enforced") {
        REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        CHECK(caelus_mobile_tick_v1(box.handle, 0) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_tick_v1(box.handle,
                                    CAELUS_MOBILE_MAX_TICKS_PER_CALL + 1) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_tick_v1(box.handle, 1) == CAELUS_MOBILE_OK);
    }
    SUBCASE("null engine is rejected") {
        CHECK(caelus_mobile_tick_v1(nullptr, 1) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
}

TEST_CASE("mobile determinism: same seed and inputs give identical state") {
    EngineBox first;
    EngineBox second;
    make_engine(first, 0, UINT64_C(0xD00D), UINT64_C(0xAA01));
    make_engine(second, 0, UINT64_C(0xD00D), UINT64_C(0xAA02));
    REQUIRE(load_scenario(first.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(load_scenario(second.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);

    REQUIRE(caelus_mobile_tick_v1(first.handle, 24) == CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(second.handle, 24) == CAELUS_MOBILE_OK);

    uint8_t first_success = 9;
    uint8_t second_success = 9;
    REQUIRE(caelus_mobile_apply_lever_v1(
                first.handle,
                reinterpret_cast<const uint8_t*>("L-01_ZAFER_ANLATI"), 17, &first_success) == CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_apply_lever_v1(
                second.handle,
                reinterpret_cast<const uint8_t*>("L-01_ZAFER_ANLATI"), 17, &second_success) == CAELUS_MOBILE_OK);
    CHECK(first_success == second_success);

    REQUIRE(caelus_mobile_tick_v1(first.handle, 12) == CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(second.handle, 12) == CAELUS_MOBILE_OK);

    // Session ids differ by construction; the deterministic core must not.
    CHECK(deterministic_prefix(snapshot(first.handle))
              .find("\"session_id\":\"000000000000aa01\"") !=
          std::string::npos);
    const std::string first_core =
        deterministic_prefix(snapshot(first.handle));
    const std::string second_core =
        deterministic_prefix(snapshot(second.handle));
    CHECK(first_core.substr(first_core.find("\"tick\":")) ==
          second_core.substr(second_core.find("\"tick\":")));
}

TEST_CASE("mobile lever validation and outcomes") {
    EngineBox box;
    make_engine(box);
    REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    uint8_t success = 9;

    SUBCASE("unknown lever id") {
        CHECK(caelus_mobile_apply_lever_v1(
                  box.handle, reinterpret_cast<const uint8_t*>("NOPE"), 4,
                  &success) == CAELUS_MOBILE_E_LEVER_UNKNOWN);
    }
    SUBCASE("null arguments") {
        CHECK(caelus_mobile_apply_lever_v1(box.handle, nullptr, 4, &success) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_apply_lever_v1(
                  box.handle, reinterpret_cast<const uint8_t*>("X"), 1,
                  nullptr) == CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("oversized lever id") {
        const std::string long_id(CAELUS_MOBILE_MAX_LEVER_ID_BYTES + 1, 'A');
        CHECK(caelus_mobile_apply_lever_v1(
                  box.handle,
                  reinterpret_cast<const uint8_t*>(long_id.data()),
                  long_id.size(), &success) == CAELUS_MOBILE_E_LIMIT);
    }
    SUBCASE("invalid UTF-8 lever id") {
        static const uint8_t bad[] = {0xff, 0xfe};
        CHECK(caelus_mobile_apply_lever_v1(box.handle, bad, sizeof(bad),
                                           &success) == CAELUS_MOBILE_E_UTF8);
    }
    SUBCASE("embedded NUL in lever id") {
        static const uint8_t embedded[] = {'A', 0x00, 'B'};
        CHECK(caelus_mobile_apply_lever_v1(box.handle, embedded,
                                           sizeof(embedded), &success) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("successful application then lockout") {
        REQUIRE(caelus_mobile_apply_lever_v1(
                    box.handle,
                    reinterpret_cast<const uint8_t*>("L-01_ZAFER_ANLATI"), 17, &success) == CAELUS_MOBILE_OK);
        // Immediately after application the lever is cooling down (either
        // cost_ticks or failure lockout) — a second application must be
        // rejected as unavailable, never silently re-applied.
        CHECK(caelus_mobile_apply_lever_v1(
                  box.handle,
                  reinterpret_cast<const uint8_t*>("L-01_ZAFER_ANLATI"), 17, &success) == CAELUS_MOBILE_E_LEVER_UNAVAILABLE);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint / restore
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile checkpoint restore is a bit-exact resume point") {
    EngineBox source;
    make_engine(source, 0, UINT64_C(0xFEED), UINT64_C(0xBB01));
    REQUIRE(load_scenario(source.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(source.handle, 30) == CAELUS_MOBILE_OK);
    uint8_t success = 9;
    REQUIRE(caelus_mobile_apply_lever_v1(
                source.handle,
                reinterpret_cast<const uint8_t*>("L-01_ZAFER_ANLATI"), 17, &success) == CAELUS_MOBILE_OK);
    const std::string envelope = checkpoint(source.handle);
    REQUIRE(!envelope.empty());

    EngineBox target;
    make_engine(target, 0, UINT64_C(0xFEED), UINT64_C(0xBB02));
    REQUIRE(load_scenario(target.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(restore(target.handle, envelope) == CAELUS_MOBILE_OK);

    // State must match immediately after restore...
    const std::string source_now =
        deterministic_prefix(snapshot(source.handle));
    const std::string target_now =
        deterministic_prefix(snapshot(target.handle));
    CHECK(source_now.substr(source_now.find("\"tick\":")) ==
          target_now.substr(target_now.find("\"tick\":")));

    // ...and must stay bit-exact when both continue ticking.
    REQUIRE(caelus_mobile_tick_v1(source.handle, 20) == CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(target.handle, 20) == CAELUS_MOBILE_OK);
    const std::string source_later =
        deterministic_prefix(snapshot(source.handle));
    const std::string target_later =
        deterministic_prefix(snapshot(target.handle));
    CHECK(source_later.substr(source_later.find("\"tick\":")) ==
          target_later.substr(target_later.find("\"tick\":")));
}

TEST_CASE("mobile checkpoint rejection paths") {
    EngineBox source;
    make_engine(source);
    REQUIRE(load_scenario(source.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(source.handle, 5) == CAELUS_MOBILE_OK);
    const std::string envelope = checkpoint(source.handle);

    SUBCASE("checkpoint before scenario is a lifecycle error") {
        EngineBox blank;
        make_engine(blank);
        size_t needed = 0;
        CHECK(caelus_mobile_checkpoint_v1(blank.handle, nullptr, 0, &needed) ==
              CAELUS_MOBILE_E_LIFECYCLE);
    }

    SUBCASE("flipped payload byte fails the integrity hash") {
        EngineBox target;
        make_engine(target);
        REQUIRE(load_scenario(target.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        std::string corrupt = envelope;
        const size_t position = corrupt.find("\"tick\":");
        REQUIRE(position != std::string::npos);
        corrupt[position + 8] = (corrupt[position + 8] == '0') ? '1' : '0';
        CHECK(restore(target.handle, corrupt) ==
              CAELUS_MOBILE_E_CHECKPOINT_INVALID);
        const std::string error = last_error(target.handle);
        CHECK(error.find("integrity") != std::string::npos);
    }

    SUBCASE("flipped integrity hex fails") {
        EngineBox target;
        make_engine(target);
        REQUIRE(load_scenario(target.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        std::string corrupt = envelope;
        const size_t hash_start = corrupt.size() - 65; // 64 hex + trailing \n
        corrupt[hash_start] = (corrupt[hash_start] == 'a') ? 'b' : 'a';
        CHECK(restore(target.handle, corrupt) ==
              CAELUS_MOBILE_E_CHECKPOINT_INVALID);
    }

    SUBCASE("truncated envelope fails") {
        EngineBox target;
        make_engine(target);
        REQUIRE(load_scenario(target.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        CHECK(restore(target.handle, envelope.substr(0, 40)) ==
              CAELUS_MOBILE_E_CHECKPOINT_INVALID);
    }

    SUBCASE("checkpoint bound to a different scenario is incompatible") {
        EngineBox target;
        make_engine(target);
        REQUIRE(load_scenario(target.handle, fixtures().scenario_bs02) ==
                CAELUS_MOBILE_OK);
        CHECK(restore(target.handle, envelope) ==
              CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE);
    }

    SUBCASE("restore after ticks is a lifecycle error") {
        EngineBox target;
        make_engine(target);
        REQUIRE(load_scenario(target.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        REQUIRE(caelus_mobile_tick_v1(target.handle, 1) == CAELUS_MOBILE_OK);
        CHECK(restore(target.handle, envelope) == CAELUS_MOBILE_E_LIFECYCLE);
    }

    SUBCASE("restore without a scenario is a lifecycle error") {
        EngineBox target;
        make_engine(target);
        CHECK(restore(target.handle, envelope) == CAELUS_MOBILE_E_LIFECYCLE);
    }

    SUBCASE("null/empty/oversized checkpoint buffers") {
        EngineBox target;
        make_engine(target);
        REQUIRE(load_scenario(target.handle, fixtures().scenario_bs01) ==
                CAELUS_MOBILE_OK);
        CHECK(caelus_mobile_restore_checkpoint_v1(target.handle, nullptr, 1) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        const uint8_t byte = '{';
        CHECK(caelus_mobile_restore_checkpoint_v1(target.handle, &byte, 0) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_restore_checkpoint_v1(
                  target.handle, &byte,
                  static_cast<size_t>(CAELUS_MOBILE_MAX_CHECKPOINT_BYTES) +
                      1) == CAELUS_MOBILE_E_LIMIT);
    }
}

TEST_CASE("mobile checkpoint with a loaded model binds the model hash") {
    const uint32_t flags = CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE;
    EngineBox source;
    make_engine(source, flags, UINT64_C(0xFEED), UINT64_C(0xCC01));
    REQUIRE(load_scenario(source.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(load_model(source.handle, fixtures()) == CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(source.handle, 3) == CAELUS_MOBILE_OK);
    const std::string envelope = checkpoint(source.handle);

    // Restoring into a symbolic-only engine (no model) must be rejected:
    // the checkpoint state was produced under neural authority.
    EngineBox symbolic;
    make_engine(symbolic, 0, UINT64_C(0xFEED), UINT64_C(0xCC02));
    REQUIRE(load_scenario(symbolic.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    CHECK(restore(symbolic.handle, envelope) ==
          CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE);

    // Restoring into an engine with the same model succeeds.
    EngineBox neural;
    make_engine(neural, flags, UINT64_C(0xFEED), UINT64_C(0xCC03));
    REQUIRE(load_scenario(neural.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(load_model(neural.handle, fixtures()) == CAELUS_MOBILE_OK);
    CHECK(restore(neural.handle, envelope) == CAELUS_MOBILE_OK);
}

// ─────────────────────────────────────────────────────────────────────────────
// Neural assurance through the bridge (real model, real crypto)
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile neural assurance runs the shared audited tick sequence") {
    EngineBox box;
    make_engine(box, CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE,
                UINT64_C(0xCAE105000000AAAA), UINT64_C(0xDD01));
    REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(load_model(box.handle, fixtures()) == CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(box.handle, 12) == CAELUS_MOBILE_OK);

    const std::string state = snapshot(box.handle);
    CHECK(state.find("\"mode\":\"ASSURANCE\"") != std::string::npos);
    CHECK(state.find("\"last_gate_decision\":\"") != std::string::npos);
    CHECK(state.find("\"observed_history_ticks\":") != std::string::npos);

    // The audit chain must contain the full neural evidence trail.
    const std::string audit =
        fetch_string(box.handle, &caelus_mobile_export_audit_v1);
    CHECK(audit.find("NEURAL_INFERENCE_V1") != std::string::npos);
    CHECK(audit.find("SESSION_START") != std::string::npos);
    CHECK(audit.find("SCENARIO_ACTIVATED") != std::string::npos);
    CHECK(audit.find("NEURAL_MODEL_LOADED") != std::string::npos);
    CHECK(audit.find("MOBILE_TICK") != std::string::npos);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit surface
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile audit surface: path, status, export, lifecycle, seal") {
    EngineBox box;
    make_engine(box);
    REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_tick_v1(box.handle, 2) == CAELUS_MOBILE_OK);

    const std::string path =
        fetch_string(box.handle, &caelus_mobile_audit_path_v1);
    CHECK(path.find(box.directory) == 0);
    CHECK(path.find("caelus_audit_") != std::string::npos);

    const std::string status =
        fetch_string(box.handle, &caelus_mobile_audit_status_json_v1);
    CHECK(status.find("\"open\":true") != std::string::npos);
    CHECK(status.find("\"chain_head\":\"") != std::string::npos);
    CHECK(status.find("\"session_id\":\"1122334455667788\"") !=
          std::string::npos);

    REQUIRE(caelus_mobile_note_lifecycle_v1(
                box.handle, CAELUS_MOBILE_LIFECYCLE_BACKGROUND) ==
            CAELUS_MOBILE_OK);
    REQUIRE(caelus_mobile_note_lifecycle_v1(
                box.handle, CAELUS_MOBILE_LIFECYCLE_FOREGROUND) ==
            CAELUS_MOBILE_OK);
    CHECK(caelus_mobile_note_lifecycle_v1(box.handle, 99) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);

    // Seal, then export: the exported NDJSON must end with the SEAL line.
    REQUIRE(caelus_mobile_seal_session_v1(box.handle) == CAELUS_MOBILE_OK);
    const std::string exported =
        fetch_string(box.handle, &caelus_mobile_export_audit_v1);
    CHECK(exported.find("\"SESSION_START\"") != std::string::npos);
    CHECK(exported.find("APP_LIFECYCLE") != std::string::npos);
    CHECK(exported.find("SEAL") != std::string::npos);

    // After sealing, audited operations must fail closed.
    CHECK(caelus_mobile_note_lifecycle_v1(
              box.handle, CAELUS_MOBILE_LIFECYCLE_FOREGROUND) ==
          CAELUS_MOBILE_E_AUDIT_FAILURE);
    CHECK(caelus_mobile_tick_v1(box.handle, 1) == CAELUS_MOBILE_E_LIFECYCLE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Output buffer contract
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile two-call buffer pattern is exact") {
    EngineBox box;
    make_engine(box);
    REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);

    size_t needed = 0;
    REQUIRE(caelus_mobile_snapshot_json_v1(box.handle, nullptr, 0, &needed) ==
            CAELUS_MOBILE_E_BUFFER_TOO_SMALL);
    REQUIRE(needed > 2);

    // One byte short must still report the same exact requirement.
    std::vector<uint8_t> short_buffer(needed - 1);
    size_t reported = 0;
    CHECK(caelus_mobile_snapshot_json_v1(box.handle, short_buffer.data(),
                                         short_buffer.size(), &reported) ==
          CAELUS_MOBILE_E_BUFFER_TOO_SMALL);
    CHECK(reported == needed);

    std::vector<uint8_t> exact(needed);
    CHECK(caelus_mobile_snapshot_json_v1(box.handle, exact.data(),
                                         exact.size(), &reported) ==
          CAELUS_MOBILE_OK);
    CHECK(reported == needed);
    CHECK(exact.front() == '{');
    CHECK(exact.back() == '}');

    CHECK(caelus_mobile_snapshot_json_v1(box.handle, exact.data(),
                                         exact.size(), nullptr) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error retrieval + handle misuse
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile last_error reflects the most recent failure") {
    EngineBox box;
    make_engine(box);
    CHECK(last_error(box.handle).empty());
    CHECK(caelus_mobile_tick_v1(box.handle, 1) == CAELUS_MOBILE_E_LIFECYCLE);
    CHECK(last_error(box.handle).find("scenario") != std::string::npos);
}

TEST_CASE("mobile calls on NULL handles are rejected, not crashed") {
    size_t needed = 0;
    uint8_t success = 0;
    CHECK(caelus_mobile_load_scenario_v1(nullptr, nullptr, 0) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
    CHECK(caelus_mobile_snapshot_json_v1(nullptr, nullptr, 0, &needed) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
    CHECK(caelus_mobile_checkpoint_v1(nullptr, nullptr, 0, &needed) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
    CHECK(caelus_mobile_apply_lever_v1(nullptr, nullptr, 0, &success) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
    CHECK(caelus_mobile_seal_session_v1(nullptr) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
    CHECK(caelus_mobile_last_error_v1(nullptr, nullptr, 0, &needed) ==
          CAELUS_MOBILE_E_INVALID_ARGUMENT);
}

TEST_CASE("mobile stateless crypto helpers") {
    SUBCASE("Blake3 matches the official test vector") {
        // Official BLAKE3 test vector: blake3("abc")
        const uint8_t abc[3] = {'a', 'b', 'c'};
        uint8_t hash[32] = {};
        REQUIRE(caelus_mobile_blake3_v1(abc, 3, hash) == CAELUS_MOBILE_OK);
        static const uint8_t expected[32] = {
            0x64, 0x37, 0xb3, 0xac, 0x38, 0x46, 0x51, 0x33,
            0xff, 0xb6, 0x3b, 0x75, 0x27, 0x3a, 0x8d, 0xb5,
            0x48, 0xc5, 0x58, 0x46, 0x5d, 0x79, 0xdb, 0x03,
            0xfd, 0x35, 0x9c, 0x6c, 0xd5, 0xbd, 0x9d, 0x85};
        CHECK(std::memcmp(hash, expected, 32) == 0);
    }
    SUBCASE("Blake3 rejects NULL/empty input") {
        uint8_t hash[32] = {};
        CHECK(caelus_mobile_blake3_v1(nullptr, 3, hash) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        const uint8_t byte = 'x';
        CHECK(caelus_mobile_blake3_v1(&byte, 0, hash) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_blake3_v1(&byte, 1, nullptr) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("model signature helper verifies the committed package") {
        uint8_t manifest_hash[32] = {};
        uint8_t weights_hash[32] = {};
        REQUIRE(caelus_mobile_blake3_v1(fixtures().manifest.data(),
                                        fixtures().manifest.size(),
                                        manifest_hash) == CAELUS_MOBILE_OK);
        REQUIRE(caelus_mobile_blake3_v1(fixtures().weights.data(),
                                        fixtures().weights.size(),
                                        weights_hash) == CAELUS_MOBILE_OK);

        // model.sig format: CAELUS_NEURAL_SIG_V1:<pub hex64>:<sig hex128>
        const std::string sig_text(fixtures().signature_file.begin(),
                                   fixtures().signature_file.end());
        const size_t first_colon = sig_text.find(':');
        const size_t second_colon = sig_text.find(':', first_colon + 1);
        REQUIRE(first_colon != std::string::npos);
        REQUIRE(second_colon != std::string::npos);
        std::string sig_hex = sig_text.substr(second_colon + 1);
        while (!sig_hex.empty() &&
               (sig_hex.back() == '\n' || sig_hex.back() == '\r')) {
            sig_hex.pop_back();
        }
        REQUIRE(sig_hex.size() == 128);
        uint8_t signature[64] = {};
        for (size_t i = 0; i < 64; ++i) {
            signature[i] = static_cast<uint8_t>(
                std::stoul(sig_hex.substr(i * 2, 2), nullptr, 16));
        }
        CHECK(caelus_mobile_verify_model_signature_v1(
                  manifest_hash, weights_hash, signature) == CAELUS_MOBILE_OK);

        // Any flipped signature byte must fail.
        signature[10] ^= 0x01u;
        CHECK(caelus_mobile_verify_model_signature_v1(
                  manifest_hash, weights_hash, signature) ==
              CAELUS_MOBILE_E_MODEL_REJECTED);
        signature[10] ^= 0x01u;

        // A different blob hash must fail.
        weights_hash[0] ^= 0x01u;
        CHECK(caelus_mobile_verify_model_signature_v1(
                  manifest_hash, weights_hash, signature) ==
              CAELUS_MOBILE_E_MODEL_REJECTED);
    }
    SUBCASE("NULL arguments are rejected") {
        uint8_t buffer[64] = {};
        CHECK(caelus_mobile_verify_model_signature_v1(nullptr, buffer,
                                                      buffer) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_verify_model_signature_v1(buffer, nullptr,
                                                      buffer) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
        CHECK(caelus_mobile_verify_model_signature_v1(buffer, buffer,
                                                      nullptr) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
    SUBCASE("trusted anchors expose the compiled-in PUBLIC keys") {
        size_t needed = 0;
        REQUIRE(caelus_mobile_trusted_anchors_json_v1(nullptr, 0, &needed) ==
                CAELUS_MOBILE_E_BUFFER_TOO_SMALL);
        REQUIRE(needed > 0);
        std::string payload(needed, '\0');
        size_t written = 0;
        REQUIRE(caelus_mobile_trusted_anchors_json_v1(
                    reinterpret_cast<uint8_t*>(payload.data()),
                    payload.size(), &written) == CAELUS_MOBILE_OK);
        REQUIRE(written == needed);
        CHECK(payload.find("\"type\":\"CAELUS_MOBILE_TRUST_ANCHORS_V1\"") !=
              std::string::npos);
        // The exact pinned production anchors (public key material only).
        CHECK(payload.find("\"scenario_pubkey\":\"9bb1dbd039043670b7bf2c5d7533"
                           "777866135b92f9b38fe6cd8d9735a04fa802\"") !=
              std::string::npos);
        CHECK(payload.find("\"neural_pubkey\":\"c8527f9105465967aea81d07514ea1"
                           "1f597f32fedc7d6f8f9e7d182f999fc51f\"") !=
              std::string::npos);
        CHECK(caelus_mobile_trusted_anchors_json_v1(nullptr, 0, nullptr) ==
              CAELUS_MOBILE_E_INVALID_ARGUMENT);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency contract (best-effort busy detection)
// ─────────────────────────────────────────────────────────────────────────────

TEST_CASE("mobile concurrent entry returns E_BUSY or completes, never races") {
    EngineBox box;
    make_engine(box);
    REQUIRE(load_scenario(box.handle, fixtures().scenario_bs01) ==
            CAELUS_MOBILE_OK);

    std::atomic<int> busy_count{0};
    std::atomic<int> ok_count{0};
    std::atomic<int> other_count{0};
    const auto worker = [&] {
        for (int i = 0; i < 200; ++i) {
            size_t needed = 0;
            const int32_t status =
                caelus_mobile_snapshot_json_v1(box.handle, nullptr, 0,
                                               &needed);
            if (status == CAELUS_MOBILE_E_BUSY) {
                busy_count.fetch_add(1);
            } else if (status == CAELUS_MOBILE_E_BUFFER_TOO_SMALL) {
                ok_count.fetch_add(1); // expected probe result
            } else {
                other_count.fetch_add(1);
            }
        }
    };
    std::thread first(worker);
    std::thread second(worker);
    first.join();
    second.join();
    CHECK(other_count.load() == 0);
    CHECK(ok_count.load() > 0);
}
