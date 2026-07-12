/**
 * CAELUS Mobile — C ABI bridge implementation
 * (src/mobile/caelus_mobile_bridge.cpp)
 *
 * Wraps the shared C++ causal engine, scenario signature gate, deterministic
 * neural stack, and Rust audit chain behind include/mobile/caelus_mobile.h.
 *
 * Design rules enforced here:
 *   • No C++ exception and no Rust panic escapes an entry point — every
 *     public function runs inside guarded() which converts failures into
 *     status codes and stores a description for caelus_mobile_last_error_v1.
 *   • No hidden global engine state: everything lives inside the handle.
 *   • The neural tick sequence is the shared run_neural_tick() runner — the
 *     exact code the desktop host executes, so mobile behaviour cannot
 *     diverge from desktop behaviour.
 *   • Where the desktop fail-stops the process (unaudited neural mutation
 *     that cannot be rolled back), the bridge latches the handle POISONED
 *     instead of calling abort() inside a mobile app.
 */

#include "mobile/caelus_mobile.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <memory>
#include <mutex>
#include <new>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

#include "audit_log.h"
#include "causal_engine.h"
#include "neural_host.h"
#include "neural_model.h"
#include "neural_tick_runner.h"
#include "plugin/caelus_plugin_abi.h"
#include "scenario_pack.h"

extern "C" {
CaelusIdentityHandle* caelus_identity_load_or_create(
    const uint8_t* path, size_t path_len);
void caelus_identity_free(CaelusIdentityHandle* handle);
uint8_t caelus_identity_fingerprint(
    const CaelusIdentityHandle* handle, uint8_t* out_fp);
// Rust identity-layer key-protection delegate registration (mesh_auth.rs).
uint8_t caelus_keymgmt_register(
    uint8_t (*protect_fn)(void*, const CaelusKeyBlob*, CaelusKeyBlob*),
    uint8_t (*unprotect_fn)(void*, const CaelusKeyBlob*, CaelusKeyBlob*),
    void* state);
}

// The public mobile header re-declares the blob layout so Swift-facing code
// never includes plugin ABI headers.  The two must stay bit-identical.
static_assert(sizeof(CaelusMobileKeyBlob) == sizeof(CaelusKeyBlob),
              "CaelusMobileKeyBlob must mirror CaelusKeyBlob");
static_assert(offsetof(CaelusMobileKeyBlob, data) ==
                  offsetof(CaelusKeyBlob, data) &&
              offsetof(CaelusMobileKeyBlob, len) ==
                  offsetof(CaelusKeyBlob, len) &&
              offsetof(CaelusMobileKeyBlob, capacity) ==
                  offsetof(CaelusKeyBlob, capacity) &&
              offsetof(CaelusMobileKeyBlob, format) ==
                  offsetof(CaelusKeyBlob, format) &&
              offsetof(CaelusMobileKeyBlob, flags) ==
                  offsetof(CaelusKeyBlob, flags),
              "CaelusMobileKeyBlob field layout must mirror CaelusKeyBlob");

namespace {

using caelus::causal::CausalEngine;
using caelus::causal::EngineSnapshot;
using caelus::causal::EngineStateV1;

constexpr const char* kEngineVersionString = "2.0.0";

// Scheduled scenario intel event in engine-tick time.
struct ScheduledIntel {
    uint64_t tick = 0;
    double friction_coeff = 0.0;
    int crisis_level = 0;
    std::string memo;
};

enum class Phase : uint8_t {
    Created = 0,
    ScenarioLoaded,
    Sealed,
};

std::string hex_lower(const uint8_t* data, size_t len) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out(len * 2u, '0');
    for (size_t i = 0; i < len; ++i) {
        out[i * 2u] = kHex[(data[i] >> 4u) & 0x0fu];
        out[i * 2u + 1u] = kHex[data[i] & 0x0fu];
    }
    return out;
}

/** Parse exactly 16 lowercase hex chars into a uint64 (session_hex mirror). */
bool parse_hex_u64(const std::string& text, uint64_t& out) {
    if (text.size() != 16u) return false;
    uint64_t value = 0;
    for (const char c : text) {
        uint64_t nibble;
        if (c >= '0' && c <= '9') {
            nibble = static_cast<uint64_t>(c - '0');
        } else if (c >= 'a' && c <= 'f') {
            nibble = static_cast<uint64_t>(c - 'a') + 10u;
        } else {
            return false;
        }
        value = (value << 4u) | nibble;
    }
    out = value;
    return true;
}

} // namespace

/**
 * The opaque engine handle.  All state is per-handle; the only global the
 * bridge keeps is the liveness registry below (handle bookkeeping, not
 * engine state), which is what makes use-after-destroy and double-destroy
 * DETECTABLE without ever touching freed memory.
 */
struct CaelusMobileEngine {
    std::atomic<bool> busy{false};

    // Configuration
    uint32_t flags = 0;
    uint64_t deterministic_seed = 0;
    uint64_t session_id = 0;
    std::string audit_directory;
    std::string identity_path;

    // Lifecycle
    Phase phase = Phase::Created;
    bool ticks_executed = false;
    bool poisoned = false;
    std::string last_error;

    // Core components
    CausalEngine engine;
    caelus::ScenarioPack pack;
    bool pack_loaded = false;
    std::array<uint8_t, CAELUS_NEURAL_HASH_BYTES_V1> scenario_hash{};
    bool scenario_hash_valid = false;

    caelus::neural::NeuralControllerV1 neural;
    bool model_loaded = false;
    std::array<uint8_t, 32> model_package_hash{};
    std::string model_id;
    std::string model_version;

    caelus::AuditLog audit;
    CaelusIdentityHandle* identity = nullptr;

    // Scheduled intel replay (sorted by tick; cursor = delivered count).
    std::vector<ScheduledIntel> intel_schedule;
    size_t intel_cursor = 0;

    // Most recent neural war-room evidence JSON (embedded in snapshots).
    std::string last_neural_event_json;
    caelus::neural::NeuralTickEvidenceV1 last_evidence{};
    bool has_evidence = false;

    ~CaelusMobileEngine() {
        if (identity != nullptr) {
            caelus_identity_free(identity);
            identity = nullptr;
        }
    }
};

namespace {

/**
 * Live-handle registry.
 *
 * Both entry (guarded) and teardown (destroy) resolve the pointer through
 * this registry and transition the per-handle busy flag UNDER the registry
 * lock.  Consequences:
 *   • a destroyed (or never-created) pointer fails the lookup —
 *     use-after-destroy and double-destroy return E_HANDLE / no-op without
 *     ever dereferencing the stale pointer;
 *   • destroy cannot free a handle while a call is executing on it (busy is
 *     held), and no call can start once destroy has erased the handle —
 *     there is no window in which fn() runs on freed memory.
 * The lock protects only the lookup + flag transition, never the engine
 * work itself.
 */
std::mutex& registry_mutex() {
    static std::mutex mutex;
    return mutex;
}

std::unordered_set<const CaelusMobileEngine*>& live_handles() {
    static std::unordered_set<const CaelusMobileEngine*> handles;
    return handles;
}

void register_handle(const CaelusMobileEngine* handle) {
    std::lock_guard<std::mutex> lock(registry_mutex());
    live_handles().insert(handle);
}

enum class Acquire : uint8_t { Ok, Unknown, Busy };

/** Look up + mark busy atomically with respect to destroy. */
Acquire acquire_handle(CaelusMobileEngine* engine) {
    std::lock_guard<std::mutex> lock(registry_mutex());
    if (live_handles().count(engine) == 0u) return Acquire::Unknown;
    bool expected = false;
    if (!engine->busy.compare_exchange_strong(expected, true,
                                              std::memory_order_acquire)) {
        return Acquire::Busy;
    }
    return Acquire::Ok;
}

void release_handle(CaelusMobileEngine* engine) {
    engine->busy.store(false, std::memory_order_release);
}

/** Erase + mark busy atomically; returns nullptr when not live or busy. */
CaelusMobileEngine* unregister_for_destroy(CaelusMobileEngine* engine) {
    std::lock_guard<std::mutex> lock(registry_mutex());
    if (live_handles().count(engine) == 0u) return nullptr;
    bool expected = false;
    if (!engine->busy.compare_exchange_strong(expected, true,
                                              std::memory_order_acquire)) {
        // A call is executing.  Refusing to free is the only memory-safe
        // option; the host violated the serialisation contract.  The handle
        // stays live (and leaks if the host abandons it).
        return nullptr;
    }
    live_handles().erase(engine);
    return engine;
}

int32_t fail(CaelusMobileEngine& handle, int32_t status,
             const std::string& message) {
    handle.last_error = message;
    return status;
}

/**
 * guarded — shared entry-point wrapper.
 *
 * Validates liveness through the registry, enforces single entry, checks
 * the poisoned latch, and contains every C++ exception.  `allow_poisoned`
 * is set only for last_error so a poisoned handle can still explain itself.
 */
template <typename Fn>
int32_t guarded(CaelusMobileEngine* engine, bool allow_poisoned, Fn&& fn) {
    if (engine == nullptr) return CAELUS_MOBILE_E_INVALID_ARGUMENT;
    switch (acquire_handle(engine)) {
        case Acquire::Unknown: return CAELUS_MOBILE_E_HANDLE;
        case Acquire::Busy: return CAELUS_MOBILE_E_BUSY;
        case Acquire::Ok: break;
    }
    int32_t status;
    if (engine->poisoned && !allow_poisoned) {
        status = CAELUS_MOBILE_E_POISONED;
    } else {
        try {
            status = fn(*engine);
        } catch (const std::bad_alloc&) {
            engine->last_error = "allocation failure inside bridge call";
            status = CAELUS_MOBILE_E_ALLOCATION;
        } catch (const std::exception& error) {
            engine->last_error =
                std::string("contained C++ exception: ") + error.what();
            status = CAELUS_MOBILE_E_INTERNAL;
        } catch (...) {
            engine->last_error = "contained non-standard C++ exception";
            status = CAELUS_MOBILE_E_INTERNAL;
        }
    }
    release_handle(engine);
    return status;
}

/** Two-call output helper (see header contract). */
int32_t write_output(CaelusMobileEngine& handle, const std::string& payload,
                     uint8_t* output, size_t output_capacity,
                     size_t* out_len) {
    if (out_len == nullptr) {
        return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                    "out_len must not be NULL");
    }
    *out_len = payload.size();
    if (output == nullptr || output_capacity < payload.size()) {
        return CAELUS_MOBILE_E_BUFFER_TOO_SMALL;
    }
    std::memcpy(output, payload.data(), payload.size());
    return CAELUS_MOBILE_OK;
}

bool utf8_valid(const uint8_t* data, size_t len) {
    std::vector<uint8_t> copy(data, data + len);
    return caelus::neural::model_detail::valid_utf8(copy);
}

std::string escaped(const std::string& value) {
    return caelus::neural::host_detail::json_escape(value);
}

bool append_audit(CaelusMobileEngine& handle, const std::string& event_json) {
    return handle.audit.is_open() && handle.audit.append(event_json);
}

/** Deliver every scheduled intel event with tick <= now (connector parity). */
size_t deliver_scheduled_intel(CaelusMobileEngine& handle) {
    const uint64_t now = handle.engine.current_tick();
    size_t delivered = 0;
    while (handle.intel_cursor < handle.intel_schedule.size() &&
           handle.intel_schedule[handle.intel_cursor].tick <= now) {
        const ScheduledIntel& event =
            handle.intel_schedule[handle.intel_cursor];
        handle.engine.inject_intel(
            event.friction_coeff, event.crisis_level, event.memo.c_str());
        ++handle.intel_cursor;
        ++delivered;
    }
    return delivered;
}

void build_intel_schedule(CaelusMobileEngine& handle) {
    handle.intel_schedule.clear();
    handle.intel_cursor = 0;
    const int tick_minutes =
        handle.pack.tick_minutes > 0 ? handle.pack.tick_minutes : 1;
    const uint64_t ticks_per_hour =
        static_cast<uint64_t>(60 / tick_minutes) > 0
            ? static_cast<uint64_t>(60 / tick_minutes)
            : 1u;
    for (const auto& event : handle.pack.intel_sequence) {
        ScheduledIntel scheduled;
        scheduled.tick = event.t_hour * ticks_per_hour;
        scheduled.friction_coeff = event.friction_coeff;
        scheduled.crisis_level = event.crisis_level;
        scheduled.memo = event.memo;
        handle.intel_schedule.push_back(std::move(scheduled));
    }
    std::stable_sort(
        handle.intel_schedule.begin(), handle.intel_schedule.end(),
        [](const ScheduledIntel& lhs, const ScheduledIntel& rhs) {
            return lhs.tick < rhs.tick;
        });
}

/**
 * One audited engine tick — the mobile equivalent of the desktop
 * run_repl_tick(): scheduled intel → engine.tick() → neural observe →
 * shared neural runner → MOBILE_TICK audit record.
 */
int32_t run_one_tick(CaelusMobileEngine& handle) {
    const uint64_t tick_before = handle.engine.current_tick();
    const size_t delivered = deliver_scheduled_intel(handle);

    const EngineSnapshot snap = handle.engine.tick();
    handle.ticks_executed = true;

    if (handle.neural.enabled()) {
        if (!handle.neural.observe_tick(handle.engine)) {
            handle.last_error =
                "neural graph history observation failed; "
                "symbolic-only fallback is now active";
            handle.neural.force_symbolic_fallback();
        } else {
            caelus::neural::NeuralTickEvidenceV1 evidence;
            const auto outcome = caelus::neural::run_neural_tick(
                handle.neural, handle.engine, handle.audit,
                handle.session_id,
                (handle.flags & CAELUS_MOBILE_FLAG_MEASURE_TIMING) != 0u,
                [&handle](const std::string& event_json) {
                    handle.last_neural_event_json = event_json;
                },
                [&handle](const std::string& message) {
                    handle.last_error = message;
                },
                &evidence);
            if (outcome != caelus::neural::NeuralTickOutcome::Skipped) {
                handle.last_evidence = evidence;
                handle.has_evidence = true;
            }
            if (outcome ==
                caelus::neural::NeuralTickOutcome::FatalRollbackFailed) {
                // Desktop fail-stops the process here.  A mobile bridge must
                // not abort the host app: latch the handle poisoned so no
                // further execution can happen on unaudited mutated state.
                handle.poisoned = true;
                if (handle.audit.is_open()) handle.audit.seal();
                handle.last_error =
                    "FATAL: symbolic pre-state could not be restored after "
                    "an authority audit failure; engine handle is poisoned";
                return CAELUS_MOBILE_E_POISONED;
            }
        }
    }

    std::ostringstream event;
    event << "{\"type\":\"MOBILE_TICK\""
          << ",\"tick_before\":" << tick_before
          << ",\"tick_after\":" << handle.engine.current_tick()
          << ",\"intel_delivered\":" << delivered
          << ",\"raw_friction_fp\":" << snap.raw_friction_fp
          << ",\"clamped_friction_fp\":" << snap.clamped_friction_fp
          << ",\"throughput_ratio_fp\":" << snap.throughput_ratio_fp
          << ",\"regime_exceeded\":" << (snap.regime_exceeded ? "true" : "false")
          << ",\"outage\":" << (snap.outage_active ? "true" : "false")
          << ",\"deadline_missed\":"
          << (snap.any_deadline_missed ? "true" : "false")
          << ",\"hysteresis_flip\":"
          << (snap.any_hysteresis_flip ? "true" : "false")
          << "}";
    if (!append_audit(handle, event.str())) {
        return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                    "MOBILE_TICK audit event could not be committed");
    }
    return CAELUS_MOBILE_OK;
}

void append_node_json(std::ostringstream& out,
                      const caelus::causal::Node& node, bool first) {
    if (!first) out << ",";
    out << "{\"id\":\"" << escaped(node.id) << "\""
        << ",\"kind\":" << static_cast<uint32_t>(node.kind)
        << ",\"capacity_fp\":" << node.capacity_fp
        << ",\"state_fp\":" << node.state_fp
        << ",\"reported_state_fp\":" << node.reported_state_fp
        << ",\"trust_fp\":" << node.trust_fp
        << ",\"weight_fp\":" << node.weight_fp
        << ",\"deadline_tick\":" << node.deadline_tick
        << ",\"deadline_missed\":" << (node.deadline_missed ? "true" : "false")
        << ",\"irrecoverable\":" << (node.irrecoverable ? "true" : "false")
        << "}";
}

std::string build_snapshot_json(CaelusMobileEngine& handle) {
    const CausalEngine& engine = handle.engine;
    std::ostringstream out;
    out << "{\"type\":\"CAELUS_MOBILE_SNAPSHOT_V1\""
        << ",\"abi_version\":" << CAELUS_MOBILE_ABI_VERSION
        << ",\"engine_version\":\"" << kEngineVersionString << "\""
        << ",\"session_id\":\""
        << caelus::neural::host_detail::session_hex(handle.session_id) << "\""
        << ",\"tick\":" << engine.current_tick()
        << ",\"friction_fp\":" << engine.friction_fp()
        << ",\"friction_clamped_fp\":"
        << caelus::causal::fp_clamp(engine.friction_fp(),
                                    caelus::causal::FRICTION_MIN_FP,
                                    caelus::causal::FRICTION_MAX_FP)
        << ",\"regime_exceeded\":" << (engine.regime_exceeded() ? "true" : "false")
        << ",\"outage_active\":" << (engine.outage_active() ? "true" : "false")
        << ",\"has_intel_risk\":" << (engine.has_intel_risk() ? "true" : "false")
        << ",\"last_intel_risk_fp\":" << engine.last_intel_risk_fp()
        << ",\"pending_intel_events\":"
        << (handle.intel_schedule.size() - handle.intel_cursor);

    out << ",\"scenario\":{";
    out << "\"loaded\":" << (handle.pack_loaded ? "true" : "false");
    if (handle.pack_loaded) {
        out << ",\"id\":\"" << escaped(handle.pack.id) << "\""
            << ",\"title\":\"" << escaped(handle.pack.title) << "\""
            << ",\"sector\":\"" << escaped(handle.pack.sector) << "\""
            << ",\"blackswan_class\":\""
            << escaped(handle.pack.blackswan_class) << "\""
            << ",\"signature_status\":\"" << escaped(handle.pack.sig_status)
            << "\""
            << ",\"signature_scheme\":\"" << escaped(handle.pack.sig_scheme)
            << "\""
            << ",\"tick_minutes\":" << handle.pack.tick_minutes
            << ",\"horizon_hours\":" << handle.pack.horizon_hours
            << ",\"scenario_hash\":\"";
        if (handle.scenario_hash_valid) {
            out << hex_lower(handle.scenario_hash.data(),
                             handle.scenario_hash.size());
        }
        out << "\"";
    }
    out << "}";

    out << ",\"neural\":{";
    out << "\"mode\":\""
        << caelus::neural::neural_mode_name(handle.neural.mode()) << "\""
        << ",\"model_loaded\":" << (handle.model_loaded ? "true" : "false")
        << ",\"model_status\":\""
        << caelus::neural::model_load_status_name(handle.neural.model().status())
        << "\"";
    if (handle.model_loaded) {
        out << ",\"model_id\":\"" << escaped(handle.model_id) << "\""
            << ",\"model_version\":\"" << escaped(handle.model_version) << "\""
            << ",\"model_hash\":\""
            << hex_lower(handle.model_package_hash.data(),
                         handle.model_package_hash.size())
            << "\"";
    }
    if (handle.has_evidence) {
        const auto& evidence = handle.last_evidence;
        out << ",\"last_gate_decision\":\""
            << caelus::neural::neural_gate_decision_name(
                   evidence.gate.decision)
            << "\""
            << ",\"last_runtime_status\":\""
            << caelus::neural::neural_runtime_status_name(
                   evidence.gate.runtime_status)
            << "\""
            << ",\"last_rejection_reason\":\""
            << escaped(std::string(evidence.gate.reason)) << "\""
            << ",\"last_tick\":" << evidence.tick
            << ",\"observed_history_ticks\":"
            << evidence.observed_history_ticks
            << ",\"authority_committed\":"
            << (evidence.authority_committed ? "true" : "false")
            << ",\"confidence_min_fp\":"
            << caelus::neural::host_detail::minimum_confidence(evidence)
            << ",\"ood_max_fp\":"
            << caelus::neural::host_detail::maximum_ood(evidence)
            << ",\"selected_lever_id\":\""
            << escaped(evidence.selected_lever_id) << "\"";
        out << ",\"nodes\":[";
        for (uint32_t i = 0; i < evidence.output.node_count; ++i) {
            if (i > 0) out << ",";
            const auto& node_output = evidence.output.nodes[i];
            const std::string node_id =
                i < evidence.nodes.size() ? evidence.nodes[i].node_id
                                          : std::string();
            out << "{\"node_id\":\"" << escaped(node_id) << "\""
                << ",\"estimated_true_state_fp\":"
                << node_output.estimated_true_state_fp
                << ",\"telemetry_anomaly_score_fp\":"
                << node_output.telemetry_anomaly_score_fp
                << ",\"confidence_fp\":" << node_output.confidence_fp
                << ",\"ood_fp\":" << node_output.out_of_distribution_score_fp
                << ",\"outage_short_fp\":"
                << node_output.outage_probability_short_fp
                << ",\"outage_medium_fp\":"
                << node_output.outage_probability_medium_fp
                << ",\"outage_long_fp\":"
                << node_output.outage_probability_long_fp
                << "}";
        }
        out << "]";
        out << ",\"applied_proposals\":[";
        for (size_t i = 0; i < evidence.applied_proposals.size(); ++i) {
            if (i > 0) out << ",";
            const auto& proposal = evidence.applied_proposals[i];
            out << "{\"node_id\":\"" << escaped(proposal.node_id) << "\""
                << ",\"trust_before_fp\":" << proposal.trust_before_fp
                << ",\"delta_fp\":" << proposal.delta_fp
                << ",\"trust_after_fp\":" << proposal.trust_after_fp
                << "}";
        }
        out << "]";
        out << ",\"lever_evaluations\":[";
        for (size_t i = 0; i < evidence.lever_evaluations.size(); ++i) {
            if (i > 0) out << ",";
            const auto& evaluation = evidence.lever_evaluations[i];
            out << "{\"lever_id\":\"" << escaped(evaluation.lever_id) << "\""
                << ",\"neural_score_fp\":" << evaluation.neural_score_fp
                << ",\"symbolic_score_fp\":" << evaluation.symbolic_score_fp
                << ",\"simulated_success\":"
                << (evaluation.simulated_success ? "true" : "false")
                << ",\"baseline_outage\":"
                << (evaluation.baseline_outage ? "true" : "false")
                << ",\"candidate_outage\":"
                << (evaluation.candidate_outage ? "true" : "false")
                << ",\"selected\":" << (evaluation.selected ? "true" : "false")
                << "}";
        }
        out << "]";
    }
    out << "}";

    out << ",\"nodes\":[";
    for (size_t i = 0; i < engine.nodes().size(); ++i) {
        append_node_json(out, engine.nodes()[i], i == 0);
    }
    out << "]";

    out << ",\"edges\":[";
    for (size_t i = 0; i < engine.edges().size(); ++i) {
        const auto& edge = engine.edges()[i];
        if (i > 0) out << ",";
        out << "{\"from\":\"" << escaped(edge.from) << "\""
            << ",\"to\":\"" << escaped(edge.to) << "\""
            << ",\"multiplier_fp\":" << edge.multiplier_fp
            << ",\"lag_ticks\":" << edge.lag_ticks
            << ",\"active\":" << (edge.active ? "true" : "false")
            << "}";
    }
    out << "]";

    out << ",\"levers\":[";
    for (size_t i = 0; i < engine.levers().size(); ++i) {
        const auto& lever = engine.levers()[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escaped(lever.id) << "\""
            << ",\"target\":\"" << escaped(lever.target) << "\""
            << ",\"success_p_fp\":" << lever.success_p_fp
            << ",\"cost_ticks\":" << lever.cost_ticks
            << ",\"lockout_ticks\":" << lever.lockout_ticks
            << ",\"remaining_lockout\":" << lever.remaining_lockout
            << ",\"available\":" << (lever.available ? "true" : "false")
            << "}";
    }
    out << "]";

    out << ",\"hysteresis\":[";
    for (size_t i = 0; i < engine.hysteresis_list().size(); ++i) {
        const auto& hysteresis = engine.hysteresis_list()[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escaped(hysteresis.id) << "\""
            << ",\"threshold_tick\":" << hysteresis.threshold_tick
            << ",\"reversible\":" << (hysteresis.reversible ? "true" : "false")
            << ",\"permanent_loss_fp\":" << hysteresis.permanent_loss_fp
            << ",\"flipped\":" << (hysteresis.flipped ? "true" : "false")
            << "}";
    }
    out << "]";

    out << ",\"feedback_loops\":[";
    for (size_t i = 0; i < engine.feedback_loops().size(); ++i) {
        const auto& loop = engine.feedback_loops()[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escaped(loop.id) << "\""
            << ",\"gain_fp\":" << loop.gain_fp
            << ",\"path\":[";
        for (size_t p = 0; p < loop.path.size(); ++p) {
            if (p > 0) out << ",";
            out << "\"" << escaped(loop.path[p]) << "\"";
        }
        out << "]}";
    }
    out << "]";

    out << ",\"audit\":{"
        << "\"open\":" << (handle.audit.is_open() ? "true" : "false")
        << ",\"entries\":" << handle.audit.entries()
        << ",\"chain_head\":\"" << handle.audit.chain_head_hex() << "\""
        << ",\"path\":\"" << escaped(handle.audit.path()) << "\""
        << "}";

    out << "}";
    return out.str();
}

// ── Checkpoint serialization ─────────────────────────────────────────────────

std::string build_checkpoint_payload(CaelusMobileEngine& handle) {
    const EngineStateV1 state = handle.engine.export_state();
    std::ostringstream out;
    out << "{\"type\":\"CAELUS_MOBILE_CHECKPOINT_V1\""
        << ",\"format_version\":1"
        << ",\"abi_version\":" << CAELUS_MOBILE_ABI_VERSION
        << ",\"engine_version\":\"" << kEngineVersionString << "\""
        << ",\"session_id\":\""
        << caelus::neural::host_detail::session_hex(handle.session_id) << "\""
        << ",\"scenario_id\":\"" << escaped(handle.pack.id) << "\""
        << ",\"scenario_hash\":\""
        << hex_lower(handle.scenario_hash.data(), handle.scenario_hash.size())
        << "\""
        << ",\"neural_mode\":\""
        << caelus::neural::neural_mode_name(handle.neural.mode()) << "\""
        << ",\"model_hash\":\"";
    if (handle.model_loaded) {
        out << hex_lower(handle.model_package_hash.data(),
                         handle.model_package_hash.size());
    }
    out << "\""
        << ",\"audit_chain_head\":\"" << handle.audit.chain_head_hex() << "\""
        << ",\"audit_entry_count\":" << handle.audit.entries()
        << ",\"intel_cursor\":" << handle.intel_cursor
        << ",\"runtime\":{"
        << "\"tick\":" << state.tick
        << ",\"friction_fp\":" << state.friction_fp
        << ",\"permanent_friction_fp\":" << state.permanent_friction_fp
        << ",\"regime_exceeded\":" << (state.regime_exceeded ? "true" : "false")
        << ",\"outage\":" << (state.outage ? "true" : "false")
        // Hex string: full uint64 range does not survive the strict JSON
        // parser's signed-int64 number path.
        << ",\"prng_seed_hex\":\""
        << caelus::neural::host_detail::session_hex(state.prng_seed) << "\""
        << ",\"last_intel_risk_fp\":" << state.last_intel_risk_fp
        << ",\"has_intel_risk\":" << (state.has_intel_risk ? "true" : "false")
        << "}";

    out << ",\"nodes\":[";
    for (size_t i = 0; i < state.nodes.size(); ++i) {
        const auto& node = state.nodes[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escaped(node.id) << "\""
            << ",\"state_fp\":" << node.state_fp
            << ",\"reported_state_fp\":" << node.reported_state_fp
            << ",\"trust_fp\":" << node.trust_fp
            << ",\"deadline_missed\":"
            << (node.deadline_missed ? "true" : "false")
            << ",\"irrecoverable\":" << (node.irrecoverable ? "true" : "false")
            << "}";
    }
    out << "]";

    out << ",\"levers\":[";
    for (size_t i = 0; i < state.levers.size(); ++i) {
        const auto& lever = state.levers[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escaped(lever.id) << "\""
            << ",\"remaining_lockout\":" << lever.remaining_lockout
            << ",\"available\":" << (lever.available ? "true" : "false")
            << "}";
    }
    out << "]";

    out << ",\"hysteresis\":[";
    for (size_t i = 0; i < state.hysteresis.size(); ++i) {
        const auto& hysteresis = state.hysteresis[i];
        if (i > 0) out << ",";
        out << "{\"id\":\"" << escaped(hysteresis.id) << "\""
            << ",\"flipped\":" << (hysteresis.flipped ? "true" : "false")
            << "}";
    }
    out << "]";
    out << "}";
    return out.str();
}

bool checkpoint_integrity_hash(const std::string& payload,
                               std::array<uint8_t, 32>& out_hash) {
    return caelus_blake3_hash(
               reinterpret_cast<const uint8_t*>(payload.data()),
               payload.size(), out_hash.data()) == 1u;
}

/**
 * Parse + validate + apply a checkpoint.  The checkpoint carries ONLY
 * dynamic state; every static topology field is taken from the already
 * loaded, signature-verified scenario, so a checkpoint can never introduce
 * or alter topology.
 */
int32_t apply_checkpoint(CaelusMobileEngine& handle,
                         const std::string& text,
                         std::array<uint8_t, 32>& out_hash) {
    // Envelope format: <payload_json>\n<integrity_hex64>\n
    const size_t separator = text.rfind("\n");
    std::string payload;
    std::string integrity_hex;
    {
        std::string trimmed = text;
        while (!trimmed.empty() &&
               (trimmed.back() == '\n' || trimmed.back() == '\r')) {
            trimmed.pop_back();
        }
        const size_t last_newline = trimmed.rfind('\n');
        if (last_newline == std::string::npos) {
            return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                        "checkpoint envelope is missing the integrity line");
        }
        payload = trimmed.substr(0, last_newline);
        integrity_hex = trimmed.substr(last_newline + 1);
    }
    (void)separator;
    if (integrity_hex.size() != 64u) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint integrity line malformed");
    }
    std::array<uint8_t, 32> expected_hash{};
    if (!checkpoint_integrity_hash(payload, expected_hash)) {
        return fail(handle, CAELUS_MOBILE_E_INTERNAL,
                    "Blake3 service failed while checking checkpoint");
    }
    if (hex_lower(expected_hash.data(), expected_hash.size()) !=
        integrity_hex) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint integrity hash mismatch (corrupt or tampered)");
    }
    out_hash = expected_hash;

    caelus::JsonParser parser(payload.data(), payload.size());
    caelus::JsonVal root;
    if (!parser.parse(root) || root.type != caelus::JsonVal::Obj) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint payload is not strict JSON");
    }
    if (root["type"].as_s() != "CAELUS_MOBILE_CHECKPOINT_V1" ||
        root["format_version"].as_i(0) != 1) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "unsupported checkpoint type or format_version");
    }
    if (root["engine_version"].as_s() != kEngineVersionString) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint engine_version does not match this engine");
    }
    const std::string checkpoint_scenario_hash = root["scenario_hash"].as_s();
    if (!handle.scenario_hash_valid ||
        checkpoint_scenario_hash !=
            hex_lower(handle.scenario_hash.data(),
                      handle.scenario_hash.size())) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint is bound to a different scenario");
    }
    if (root["scenario_id"].as_s() != handle.pack.id) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint scenario_id mismatch");
    }
    const std::string checkpoint_model_hash = root["model_hash"].as_s();
    const std::string current_model_hash =
        handle.model_loaded
            ? hex_lower(handle.model_package_hash.data(),
                        handle.model_package_hash.size())
            : std::string();
    if (checkpoint_model_hash != current_model_hash) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint neural model binding does not match the "
                    "currently loaded model");
    }

    // Build the restored state: static topology from the verified scenario
    // (current engine state), dynamic fields from the checkpoint.
    EngineStateV1 state = handle.engine.export_state();

    const auto& runtime = root["runtime"];
    if (runtime.type != caelus::JsonVal::Obj) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint runtime section missing");
    }
    state.tick = static_cast<uint64_t>(runtime["tick"].as_i(0));
    state.friction_fp = runtime["friction_fp"].as_i(caelus::causal::FP_ONE);
    state.permanent_friction_fp = runtime["permanent_friction_fp"].as_i(0);
    state.regime_exceeded = runtime["regime_exceeded"].as_b(false);
    state.outage = runtime["outage"].as_b(false);
    if (!parse_hex_u64(runtime["prng_seed_hex"].as_s(), state.prng_seed)) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint prng_seed_hex malformed");
    }
    state.last_intel_risk_fp = runtime["last_intel_risk_fp"].as_i(0);
    state.has_intel_risk = runtime["has_intel_risk"].as_b(false);

    const auto& nodes = root["nodes"];
    if (nodes.type != caelus::JsonVal::Arr ||
        nodes.size() != state.nodes.size()) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint node list does not match scenario topology");
    }
    for (size_t i = 0; i < state.nodes.size(); ++i) {
        const auto& entry = nodes[i];
        if (entry["id"].as_s() != state.nodes[i].id) {
            return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                        "checkpoint node identifiers do not match scenario");
        }
        state.nodes[i].state_fp = entry["state_fp"].as_i(0);
        state.nodes[i].reported_state_fp = entry["reported_state_fp"].as_i(0);
        state.nodes[i].trust_fp =
            entry["trust_fp"].as_i(caelus::causal::FP_ONE);
        state.nodes[i].deadline_missed = entry["deadline_missed"].as_b(false);
        state.nodes[i].irrecoverable = entry["irrecoverable"].as_b(false);
    }

    const auto& levers = root["levers"];
    if (levers.type != caelus::JsonVal::Arr ||
        levers.size() != state.levers.size()) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint lever list does not match scenario topology");
    }
    for (size_t i = 0; i < state.levers.size(); ++i) {
        const auto& entry = levers[i];
        if (entry["id"].as_s() != state.levers[i].id) {
            return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                        "checkpoint lever identifiers do not match scenario");
        }
        state.levers[i].remaining_lockout =
            static_cast<int32_t>(entry["remaining_lockout"].as_i(0));
        state.levers[i].available = entry["available"].as_b(true);
    }

    const auto& hysteresis = root["hysteresis"];
    if (hysteresis.type != caelus::JsonVal::Arr ||
        hysteresis.size() != state.hysteresis.size()) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                    "checkpoint hysteresis list does not match scenario");
    }
    for (size_t i = 0; i < state.hysteresis.size(); ++i) {
        const auto& entry = hysteresis[i];
        if (entry["id"].as_s() != state.hysteresis[i].id) {
            return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INCOMPATIBLE,
                        "checkpoint hysteresis identifiers do not match");
        }
        state.hysteresis[i].flipped = entry["flipped"].as_b(false);
    }

    const int64_t cursor_value = root["intel_cursor"].as_i(0);
    if (cursor_value < 0 ||
        static_cast<size_t>(cursor_value) > handle.intel_schedule.size()) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint intel cursor out of range");
    }

    if (!handle.engine.restore_state(state)) {
        return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                    "checkpoint state violates engine invariants");
    }
    handle.intel_cursor = static_cast<size_t>(cursor_value);

    // Neural temporal history is intentionally NOT restored: fabricating
    // eight ticks of history would forge temporal evidence.  History is
    // re-observed with explicit missing-data masks.
    if (handle.neural.enabled()) {
        if (!handle.neural.initialise_history(handle.engine)) {
            handle.neural.force_symbolic_fallback();
        }
    }
    handle.has_evidence = false;
    handle.last_neural_event_json.clear();
    return CAELUS_MOBILE_OK;
}

} // namespace

// ─────────────────────────────────────────────────────────────────────────────
// Public ABI
// ─────────────────────────────────────────────────────────────────────────────

extern "C" {

uint32_t caelus_mobile_abi_version_v1(void) {
    return CAELUS_MOBILE_ABI_VERSION;
}

int32_t caelus_mobile_register_key_protection_v1(
    CaelusMobileKeyProtectFn protect_fn,
    CaelusMobileKeyUnprotectFn unprotect_fn,
    void* state) {
    // Layout equivalence is asserted at compile time above; the function
    // pointer casts below only re-name the identical blob type.
    const auto protect =
        reinterpret_cast<uint8_t (*)(void*, const CaelusKeyBlob*,
                                     CaelusKeyBlob*)>(protect_fn);
    const auto unprotect =
        reinterpret_cast<uint8_t (*)(void*, const CaelusKeyBlob*,
                                     CaelusKeyBlob*)>(unprotect_fn);
    return caelus_keymgmt_register(protect, unprotect, state) == 1u
               ? CAELUS_MOBILE_OK
               : CAELUS_MOBILE_E_INVALID_ARGUMENT;
}

CaelusMobileEngine* caelus_mobile_engine_create_v1(
    const CaelusMobileEngineConfigV1* config,
    int32_t* out_status) {
    const auto set_status = [&](int32_t status) {
        if (out_status != nullptr) *out_status = status;
    };
    set_status(CAELUS_MOBILE_E_INTERNAL);
    if (config == nullptr ||
        config->struct_size != sizeof(CaelusMobileEngineConfigV1)) {
        set_status(CAELUS_MOBILE_E_INVALID_ARGUMENT);
        return nullptr;
    }
    if (config->abi_version != CAELUS_MOBILE_ABI_VERSION) {
        set_status(CAELUS_MOBILE_E_ABI_MISMATCH);
        return nullptr;
    }
    if (config->audit_directory_utf8 == nullptr ||
        config->audit_directory_len == 0u ||
        config->audit_directory_len > 4096u ||
        config->identity_path_utf8 == nullptr ||
        config->identity_path_len == 0u ||
        config->identity_path_len > 4096u) {
        set_status(CAELUS_MOBILE_E_INVALID_ARGUMENT);
        return nullptr;
    }
    if (!utf8_valid(config->audit_directory_utf8,
                    config->audit_directory_len) ||
        !utf8_valid(config->identity_path_utf8, config->identity_path_len)) {
        set_status(CAELUS_MOBILE_E_UTF8);
        return nullptr;
    }

    try {
        auto handle = std::make_unique<CaelusMobileEngine>();
        handle->flags = config->flags;
        handle->deterministic_seed = config->deterministic_seed;
        handle->session_id =
            config->session_id != 0u
                ? config->session_id
                : static_cast<uint64_t>(std::time(nullptr));
        handle->audit_directory.assign(
            reinterpret_cast<const char*>(config->audit_directory_utf8),
            config->audit_directory_len);
        handle->identity_path.assign(
            reinterpret_cast<const char*>(config->identity_path_utf8),
            config->identity_path_len);
        if (handle->audit_directory.find('\0') != std::string::npos ||
            handle->identity_path.find('\0') != std::string::npos) {
            set_status(CAELUS_MOBILE_E_INVALID_ARGUMENT);
            return nullptr;
        }

        handle->identity = caelus_identity_load_or_create(
            reinterpret_cast<const uint8_t*>(handle->identity_path.data()),
            handle->identity_path.size());
        if (handle->identity == nullptr) {
            set_status(CAELUS_MOBILE_E_INTERNAL);
            return nullptr;
        }

        std::string audit_path = handle->audit_directory;
        if (!audit_path.empty() && audit_path.back() != '/' &&
            audit_path.back() != '\\') {
            audit_path += '/';
        }
        audit_path += caelus::AuditLog::make_log_path(handle->session_id);
        if (!handle->audit.open(handle->identity, handle->session_id,
                                audit_path)) {
            set_status(CAELUS_MOBILE_E_AUDIT_FAILURE);
            return nullptr;
        }

        handle->engine.set_prng_seed(handle->deterministic_seed);
        handle->engine.load_universal_blank_slate();
        handle->neural.configure(
            CAELUS_NEURAL_MODE_SYMBOLIC_ONLY, std::string(), std::string(),
            handle->scenario_hash);

        uint8_t fingerprint[32] = {};
        std::string fingerprint_hex;
        if (caelus_identity_fingerprint(handle->identity, fingerprint) == 1u) {
            fingerprint_hex = hex_lower(fingerprint, sizeof(fingerprint));
        }
        std::ostringstream event;
        event << "{\"type\":\"SESSION_START\""
              << ",\"platform\":\"mobile_bridge\""
              << ",\"abi_version\":" << CAELUS_MOBILE_ABI_VERSION
              << ",\"engine_version\":\"" << kEngineVersionString << "\""
              << ",\"neural_assurance_requested\":"
              << ((config->flags & CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE) != 0u
                      ? "true"
                      : "false")
              << ",\"identity_fingerprint\":\"" << fingerprint_hex << "\""
              << "}";
        if (!handle->audit.append(event.str())) {
            set_status(CAELUS_MOBILE_E_AUDIT_FAILURE);
            return nullptr;
        }

        register_handle(handle.get());
        set_status(CAELUS_MOBILE_OK);
        return handle.release();
    } catch (const std::bad_alloc&) {
        set_status(CAELUS_MOBILE_E_ALLOCATION);
        return nullptr;
    } catch (...) {
        set_status(CAELUS_MOBILE_E_INTERNAL);
        return nullptr;
    }
}

void caelus_mobile_engine_destroy_v1(CaelusMobileEngine* engine) {
    if (engine == nullptr) return;
    CaelusMobileEngine* owned = unregister_for_destroy(engine);
    if (owned == nullptr) return; // not live (double destroy) or busy
    try {
        if (owned->audit.is_open()) {
            std::ostringstream event;
            event << "{\"type\":\"SESSION_END\""
                  << ",\"tick\":" << owned->engine.current_tick()
                  << ",\"poisoned\":" << (owned->poisoned ? "true" : "false")
                  << "}";
            (void)owned->audit.append(event.str());
            (void)owned->audit.seal();
        }
    } catch (...) {
        // Never propagate from destroy.
    }
    delete owned;
}

int32_t caelus_mobile_load_scenario_v1(
    CaelusMobileEngine* engine,
    const uint8_t* scenario_json_utf8,
    size_t scenario_json_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (scenario_json_utf8 == nullptr || scenario_json_len == 0u) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "scenario buffer must not be NULL/empty");
        }
        if (scenario_json_len > CAELUS_MOBILE_MAX_SCENARIO_BYTES) {
            return fail(handle, CAELUS_MOBILE_E_LIMIT,
                        "scenario buffer exceeds the 4 MiB limit");
        }
        if (handle.phase != Phase::Created) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "scenario already loaded (one scenario per handle)");
        }
        if (!utf8_valid(scenario_json_utf8, scenario_json_len)) {
            return fail(handle, CAELUS_MOBILE_E_UTF8,
                        "scenario buffer is not valid UTF-8");
        }
        const std::string content(
            reinterpret_cast<const char*>(scenario_json_utf8),
            scenario_json_len);

        if (!handle.pack.load_from_memory(content, "mobile-import")) {
            std::ostringstream event;
            event << "{\"type\":\"SCENARIO_REJECTED\""
                  << ",\"reason\":\"signature or schema validation failed\""
                  << ",\"size_bytes\":" << scenario_json_len << "}";
            (void)append_audit(handle, event.str());
            return fail(handle, CAELUS_MOBILE_E_SCENARIO_REJECTED,
                        "scenario rejected: signature or schema validation "
                        "failed");
        }

        handle.pack.apply_to_engine(handle.engine);
        handle.engine.set_prng_seed(handle.deterministic_seed);
        handle.pack_loaded = true;
        handle.phase = Phase::ScenarioLoaded;
        build_intel_schedule(handle);

        // Blake3 commitment over the exact canonical payload that passed the
        // signature gate (same value the desktop host commits).
        const std::string& canonical =
            handle.pack.verified_canonical_payload();
        handle.scenario_hash_valid =
            !canonical.empty() &&
            caelus_blake3_hash(
                reinterpret_cast<const uint8_t*>(canonical.data()),
                canonical.size(), handle.scenario_hash.data()) == 1u;

        const bool neural_requested =
            (handle.flags & CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE) != 0u;
        const bool neural_authorized =
            neural_requested && handle.pack.sig_status == "VERIFIED" &&
            handle.scenario_hash_valid && handle.audit.is_open();

        std::ostringstream event;
        event << "{\"type\":\"SCENARIO_ACTIVATED\",\"scenario_id\":\""
              << escaped(handle.pack.id)
              << "\",\"signature_status\":\""
              << escaped(handle.pack.sig_status)
              << "\",\"signature_scheme\":\""
              << escaped(handle.pack.sig_scheme)
              << "\",\"neural_assurance_authorized\":"
              << (neural_authorized ? "true" : "false")
              << ",\"scenario_hash\":\"";
        if (handle.scenario_hash_valid) {
            event << hex_lower(handle.scenario_hash.data(),
                               handle.scenario_hash.size());
        }
        event << "\"}";
        if (!append_audit(handle, event.str())) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "SCENARIO_ACTIVATED audit event could not be "
                        "committed");
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_load_neural_model_v1(
    CaelusMobileEngine* engine,
    const uint8_t* manifest_bytes,
    size_t manifest_len,
    const uint8_t* weights_bytes,
    size_t weights_len,
    const uint8_t* signature_bytes,
    size_t signature_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (manifest_bytes == nullptr || manifest_len == 0u ||
            weights_bytes == nullptr || weights_len == 0u ||
            signature_bytes == nullptr || signature_len == 0u) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "model buffers must not be NULL/empty");
        }
        if (manifest_len > CAELUS_MOBILE_MAX_MANIFEST_BYTES ||
            weights_len > CAELUS_MOBILE_MAX_WEIGHTS_BYTES ||
            signature_len > CAELUS_MOBILE_MAX_SIGNATURE_BYTES) {
            return fail(handle, CAELUS_MOBILE_E_LIMIT,
                        "model buffer exceeds its size limit");
        }
        if ((handle.flags & CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE) == 0u) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "engine was created without "
                        "CAELUS_MOBILE_FLAG_NEURAL_ASSURANCE");
        }
        if (handle.phase != Phase::ScenarioLoaded || handle.ticks_executed) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "neural model must load after the scenario and "
                        "before the first tick");
        }
        if (handle.model_loaded) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "a neural model is already active on this handle");
        }
        if (handle.pack.sig_status != "VERIFIED") {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "neural assurance requires a scenario verified by "
                        "the pinned production anchor");
        }
        if (!handle.scenario_hash_valid) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "scenario Blake3 commitment unavailable");
        }

        const std::vector<uint8_t> manifest(
            manifest_bytes, manifest_bytes + manifest_len);
        std::vector<uint8_t> weights(
            weights_bytes, weights_bytes + weights_len);
        const std::vector<uint8_t> signature(
            signature_bytes, signature_bytes + signature_len);

        auto package = caelus::neural::NeuralModelLoader::load_from_memory(
            manifest, std::move(weights), signature,
            caelus::neural::kEngineVersionCode,
            caelus::neural::kScenarioSchemaCode);

        if (!package.trusted()) {
            std::ostringstream event;
            event << "{\"type\":\"NEURAL_MODEL_REJECTED\""
                  << ",\"load_status\":\""
                  << caelus::neural::model_load_status_name(package.status())
                  << "\",\"reason\":\"" << escaped(package.error())
                  << "\"}";
            (void)append_audit(handle, event.str());
            return fail(handle, CAELUS_MOBILE_E_MODEL_REJECTED,
                        std::string("neural model rejected: ") +
                            package.error());
        }

        handle.model_package_hash = package.package_hash();
        handle.model_id = package.manifest().model_id;
        handle.model_version = package.manifest().model_version;
        const std::string manifest_hash_hex =
            hex_lower(package.manifest_hash().data(),
                      package.manifest_hash().size());
        handle.neural.configure_with_package(
            CAELUS_NEURAL_MODE_ASSURANCE, std::move(package), handle.pack.id,
            handle.scenario_hash);
        if (!handle.neural.initialise_history(handle.engine)) {
            handle.neural.force_symbolic_fallback();
            std::ostringstream event;
            event << "{\"type\":\"NEURAL_MODEL_REJECTED\""
                  << ",\"load_status\":\"HISTORY_INIT_FAILED\""
                  << ",\"reason\":\"graph history could not be initialised\""
                  << "}";
            (void)append_audit(handle, event.str());
            return fail(handle, CAELUS_MOBILE_E_MODEL_REJECTED,
                        "neural graph history could not be initialised");
        }
        handle.model_loaded = true;

        std::ostringstream event;
        event << "{\"type\":\"NEURAL_MODEL_LOADED\""
              << ",\"model_id\":\"" << escaped(handle.model_id) << "\""
              << ",\"model_version\":\"" << escaped(handle.model_version)
              << "\""
              << ",\"model_hash\":\""
              << hex_lower(handle.model_package_hash.data(),
                           handle.model_package_hash.size())
              << "\""
              << ",\"manifest_hash\":\"" << manifest_hash_hex << "\""
              << "}";
        if (!append_audit(handle, event.str())) {
            // Fail closed: without an audited load, the model must not run.
            handle.neural.configure(
                CAELUS_NEURAL_MODE_SYMBOLIC_ONLY, std::string(),
                handle.pack.id, handle.scenario_hash);
            handle.model_loaded = false;
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "NEURAL_MODEL_LOADED audit event could not be "
                        "committed; model unloaded (fail closed)");
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_tick_v1(
    CaelusMobileEngine* engine,
    uint32_t tick_count) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (tick_count == 0u || tick_count > CAELUS_MOBILE_MAX_TICKS_PER_CALL) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "tick_count must be 1..10000");
        }
        if (handle.phase == Phase::Sealed) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "session is sealed; no further ticks are possible");
        }
        if (handle.phase != Phase::ScenarioLoaded) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "load a scenario before ticking");
        }
        for (uint32_t i = 0; i < tick_count; ++i) {
            const int32_t status = run_one_tick(handle);
            if (status != CAELUS_MOBILE_OK) return status;
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_apply_lever_v1(
    CaelusMobileEngine* engine,
    const uint8_t* lever_id,
    size_t lever_id_len,
    uint8_t* out_success) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (lever_id == nullptr || lever_id_len == 0u ||
            out_success == nullptr) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "lever_id and out_success must not be NULL/empty");
        }
        if (lever_id_len > CAELUS_MOBILE_MAX_LEVER_ID_BYTES) {
            return fail(handle, CAELUS_MOBILE_E_LIMIT,
                        "lever_id exceeds the 256-byte limit");
        }
        if (!utf8_valid(lever_id, lever_id_len)) {
            return fail(handle, CAELUS_MOBILE_E_UTF8,
                        "lever_id is not valid UTF-8");
        }
        if (handle.phase != Phase::ScenarioLoaded) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "load a scenario before applying levers");
        }
        *out_success = 0u;
        const std::string id(
            reinterpret_cast<const char*>(lever_id), lever_id_len);
        if (id.find('\0') != std::string::npos) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "lever_id must not contain NUL bytes");
        }

        const caelus::causal::Lever* found = nullptr;
        for (const auto& lever : handle.engine.levers()) {
            if (lever.id == id) {
                found = &lever;
                break;
            }
        }
        if (found == nullptr) {
            return fail(handle, CAELUS_MOBILE_E_LEVER_UNKNOWN,
                        "lever_id does not exist in the active scenario");
        }
        if (!found->available || found->remaining_lockout > 0) {
            return fail(handle, CAELUS_MOBILE_E_LEVER_UNAVAILABLE,
                        "lever is locked out or disabled");
        }

        const uint64_t tick = handle.engine.current_tick();
        const bool success = handle.engine.apply_lever(id, 0u);
        *out_success = success ? 1u : 0u;

        std::ostringstream event;
        event << "{\"type\":\"LEVER_APPLIED\""
              << ",\"lever_id\":\"" << escaped(id) << "\""
              << ",\"tick\":" << tick
              << ",\"success\":" << (success ? "true" : "false")
              << "}";
        if (!append_audit(handle, event.str())) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "LEVER_APPLIED audit event could not be committed");
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_snapshot_json_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        return write_output(handle, build_snapshot_json(handle), output,
                            output_capacity, out_len);
    });
}

int32_t caelus_mobile_checkpoint_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (handle.phase != Phase::ScenarioLoaded) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "load a scenario before checkpointing");
        }
        if (!handle.scenario_hash_valid) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "scenario Blake3 commitment unavailable");
        }
        const std::string payload = build_checkpoint_payload(handle);
        std::array<uint8_t, 32> integrity{};
        if (!checkpoint_integrity_hash(payload, integrity)) {
            return fail(handle, CAELUS_MOBILE_E_INTERNAL,
                        "Blake3 service failed while hashing checkpoint");
        }
        const std::string envelope =
            payload + "\n" + hex_lower(integrity.data(), integrity.size()) +
            "\n";
        if (out_len == nullptr) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "out_len must not be NULL");
        }
        *out_len = envelope.size();
        if (output == nullptr || output_capacity < envelope.size()) {
            return CAELUS_MOBILE_E_BUFFER_TOO_SMALL;
        }
        // Audit before releasing the artifact: no unaudited checkpoint may
        // leave the bridge.
        std::ostringstream event;
        event << "{\"type\":\"CHECKPOINT_CREATED\""
              << ",\"checkpoint_hash\":\""
              << hex_lower(integrity.data(), integrity.size()) << "\""
              << ",\"tick\":" << handle.engine.current_tick()
              << ",\"size_bytes\":" << envelope.size()
              << "}";
        if (!append_audit(handle, event.str())) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "CHECKPOINT_CREATED audit event could not be "
                        "committed");
        }
        std::memcpy(output, envelope.data(), envelope.size());
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_restore_checkpoint_v1(
    CaelusMobileEngine* engine,
    const uint8_t* checkpoint_bytes,
    size_t checkpoint_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (checkpoint_bytes == nullptr || checkpoint_len == 0u) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "checkpoint buffer must not be NULL/empty");
        }
        if (checkpoint_len > CAELUS_MOBILE_MAX_CHECKPOINT_BYTES) {
            return fail(handle, CAELUS_MOBILE_E_LIMIT,
                        "checkpoint exceeds the 16 MiB limit");
        }
        if (handle.phase != Phase::ScenarioLoaded || handle.ticks_executed) {
            return fail(handle, CAELUS_MOBILE_E_LIFECYCLE,
                        "restore requires a freshly loaded scenario with no "
                        "ticks executed");
        }
        if (!utf8_valid(checkpoint_bytes, checkpoint_len)) {
            return fail(handle, CAELUS_MOBILE_E_CHECKPOINT_INVALID,
                        "checkpoint is not valid UTF-8");
        }
        const std::string prior_chain_head = handle.audit.chain_head_hex();
        const std::string text(
            reinterpret_cast<const char*>(checkpoint_bytes), checkpoint_len);
        std::array<uint8_t, 32> checkpoint_hash{};
        const int32_t status = apply_checkpoint(handle, text, checkpoint_hash);
        if (status != CAELUS_MOBILE_OK) return status;

        std::ostringstream event;
        event << "{\"type\":\"CHECKPOINT_RESTORED\""
              << ",\"checkpoint_hash\":\""
              << hex_lower(checkpoint_hash.data(), checkpoint_hash.size())
              << "\""
              << ",\"restored_tick\":" << handle.engine.current_tick()
              << ",\"prior_chain_head\":\"" << prior_chain_head << "\""
              << "}";
        if (!append_audit(handle, event.str())) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "CHECKPOINT_RESTORED audit event could not be "
                        "committed");
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_audit_path_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        return write_output(handle, handle.audit.path(), output,
                            output_capacity, out_len);
    });
}

int32_t caelus_mobile_audit_status_json_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        std::ostringstream json;
        json << "{\"open\":" << (handle.audit.is_open() ? "true" : "false")
             << ",\"sealed\":"
             << (handle.phase == Phase::Sealed ? "true" : "false")
             << ",\"entries\":" << handle.audit.entries()
             << ",\"chain_head\":\"" << handle.audit.chain_head_hex() << "\""
             << ",\"session_id\":\""
             << caelus::neural::host_detail::session_hex(handle.session_id)
             << "\"}";
        return write_output(handle, json.str(), output, output_capacity,
                            out_len);
    });
}

int32_t caelus_mobile_export_audit_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        std::ifstream file(handle.audit.path(), std::ios::binary);
        if (!file) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "audit segment file could not be opened");
        }
        file.seekg(0, std::ios::end);
        const std::streamoff size = file.tellg();
        if (size < 0 ||
            static_cast<uint64_t>(size) > CAELUS_MOBILE_MAX_CHECKPOINT_BYTES) {
            return fail(handle, CAELUS_MOBILE_E_LIMIT,
                        "audit segment exceeds the export size limit");
        }
        file.seekg(0, std::ios::beg);
        std::string content(static_cast<size_t>(size), '\0');
        file.read(content.data(), size);
        if (!file.good() && !file.eof()) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "audit segment file could not be read");
        }
        if (out_len == nullptr) {
            return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                        "out_len must not be NULL");
        }
        *out_len = content.size();
        if (output == nullptr || output_capacity < content.size()) {
            return CAELUS_MOBILE_E_BUFFER_TOO_SMALL;
        }
        std::memcpy(output, content.data(), content.size());
        // Audited AFTER the read so the exported bytes verify cleanly.
        // A sealed chain rejects appends by design, so the final
        // export-after-seal is intentionally not recorded as a new event —
        // the SEAL line itself is the terminal record.
        if (handle.phase != Phase::Sealed) {
            std::ostringstream event;
            event << "{\"type\":\"REPORT_EXPORTED\""
                  << ",\"kind\":\"audit_ndjson\""
                  << ",\"size_bytes\":" << content.size()
                  << "}";
            if (!append_audit(handle, event.str())) {
                return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                            "REPORT_EXPORTED audit event could not be "
                            "committed");
            }
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_note_lifecycle_v1(
    CaelusMobileEngine* engine,
    uint32_t phase) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        const char* name = nullptr;
        switch (phase) {
            case CAELUS_MOBILE_LIFECYCLE_BACKGROUND: name = "background"; break;
            case CAELUS_MOBILE_LIFECYCLE_FOREGROUND: name = "foreground"; break;
            case CAELUS_MOBILE_LIFECYCLE_TERMINATING:
                name = "terminating";
                break;
            default:
                return fail(handle, CAELUS_MOBILE_E_INVALID_ARGUMENT,
                            "unknown lifecycle phase");
        }
        std::ostringstream event;
        event << "{\"type\":\"APP_LIFECYCLE\""
              << ",\"phase\":\"" << name << "\""
              << ",\"tick\":" << handle.engine.current_tick()
              << "}";
        if (!append_audit(handle, event.str())) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "APP_LIFECYCLE audit event could not be committed");
        }
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_seal_session_v1(CaelusMobileEngine* engine) {
    return guarded(engine, false, [&](CaelusMobileEngine& handle) -> int32_t {
        if (!handle.audit.is_open()) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "audit chain is not open");
        }
        if (!handle.audit.seal()) {
            return fail(handle, CAELUS_MOBILE_E_AUDIT_FAILURE,
                        "audit seal failed");
        }
        handle.phase = Phase::Sealed;
        return CAELUS_MOBILE_OK;
    });
}

int32_t caelus_mobile_last_error_v1(
    CaelusMobileEngine* engine,
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    return guarded(engine, true, [&](CaelusMobileEngine& handle) -> int32_t {
        return write_output(handle, handle.last_error, output,
                            output_capacity, out_len);
    });
}

int32_t caelus_mobile_blake3_v1(
    const uint8_t* data,
    size_t data_len,
    uint8_t* out_hash32) {
    if (data == nullptr || data_len == 0u || out_hash32 == nullptr) {
        return CAELUS_MOBILE_E_INVALID_ARGUMENT;
    }
    return caelus_blake3_hash(data, data_len, out_hash32) == 1u
               ? CAELUS_MOBILE_OK
               : CAELUS_MOBILE_E_INTERNAL;
}

int32_t caelus_mobile_verify_model_signature_v1(
    const uint8_t* manifest_hash32,
    const uint8_t* blob_hash32,
    const uint8_t* signature64) {
    if (manifest_hash32 == nullptr || blob_hash32 == nullptr ||
        signature64 == nullptr) {
        return CAELUS_MOBILE_E_INVALID_ARGUMENT;
    }
    std::array<uint8_t, 32> trusted_public_key{};
    if (!caelus::neural::default_trusted_neural_pubkey(trusted_public_key)) {
        return CAELUS_MOBILE_E_INTERNAL;
    }
    return caelus_verify_neural_model_signature(
               manifest_hash32, blob_hash32, trusted_public_key.data(),
               signature64) == 1u
               ? CAELUS_MOBILE_OK
               : CAELUS_MOBILE_E_MODEL_REJECTED;
}

int32_t caelus_mobile_trusted_anchors_json_v1(
    uint8_t* output,
    size_t output_capacity,
    size_t* out_len) {
    if (out_len == nullptr) return CAELUS_MOBILE_E_INVALID_ARGUMENT;
    std::array<uint8_t, 32> neural_public_key{};
    if (!caelus::neural::default_trusted_neural_pubkey(neural_public_key)) {
        return CAELUS_MOBILE_E_INTERNAL;
    }
    std::ostringstream json;
    json << "{\"type\":\"CAELUS_MOBILE_TRUST_ANCHORS_V1\""
         << ",\"abi_version\":" << CAELUS_MOBILE_ABI_VERSION
         << ",\"engine_version\":\"" << kEngineVersionString << "\""
         << ",\"scenario_pubkey\":\""
         << hex_lower(caelus::ScenarioPack::trusted_scenario_pubkey(),
                      caelus::ScenarioPack::trusted_scenario_pubkey_len())
         << "\""
         << ",\"neural_pubkey\":\""
         << hex_lower(neural_public_key.data(), neural_public_key.size())
         << "\"}";
    const std::string payload = json.str();
    *out_len = payload.size();
    if (output == nullptr || output_capacity < payload.size()) {
        return CAELUS_MOBILE_E_BUFFER_TOO_SMALL;
    }
    std::memcpy(output, payload.data(), payload.size());
    return CAELUS_MOBILE_OK;
}

} // extern "C"
