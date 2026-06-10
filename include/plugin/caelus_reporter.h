/**
 * CAELUS OS — Reporter Abstraction  (include/plugin/caelus_reporter.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REPORTER ROLE
 * ═══════════════════════════════════════════════════════════════════════════
 * A Reporter formats and persists the results of a completed engine cycle.
 * The PluginRegistry calls `report()` after RunOptimizationCycle returns.
 *
 * Built-in reporters:
 *   • StdoutReporter   — prints a human-readable summary to stdout.
 *   • JsonReporter     — writes a signed NDJSON line to a file or the WS stream.
 *   • NullReporter     — no-op (useful for --det-mode CI runs that only need
 *                        the CDET: block, not a full report).
 *
 * Zero-cost guarantee:
 *   Built-in reporters are CRTP structs; no heap allocation, no virtual calls.
 *   External reporters registered via the PluginRegistry use the vtable path.
 *
 * Air-gap guarantee:
 *   No reporter opens network connections.  JsonReporter writes to a local
 *   file or the already-established WS loopback (127.0.0.1:47809).
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include "caelus_plugin_abi.h"
#include <iostream>
#include <iomanip>
#include <cstring>
#include <cstdio>

namespace caelus {

// ─────────────────────────────────────────────────────────────────────────────
// CRTP base for built-in reporters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ReporterBase<Derived>
 *
 * Derived must implement:
 *   static constexpr const char* kName;
 *   static constexpr const char* kVersion;
 *   bool do_report(const CaelusReportPayload&, const char* path) noexcept;
 */
template<typename Derived>
struct ReporterBase {
    /** Emit a report.  path may be nullptr (use the reporter's default sink). */
    bool report(const CaelusReportPayload& payload, const char* path = nullptr) noexcept {
        return static_cast<Derived*>(this)->do_report(payload, path);
    }

    /** Generate the static C ABI VTable for this reporter. */
    static const CaelusPluginVTable* make_vtable() noexcept {
        static constexpr auto init_fn =
            [](void*, const CaelusEngineFns*) -> uint8_t { return 1; };
        static constexpr auto cleanup_fn =
            [](void*) noexcept {};
        static constexpr auto report_fn =
            [](void* ps, const CaelusReportPayload* p, const char* path) -> uint8_t {
                auto* self = static_cast<Derived*>(ps);
                if (!self || !p) return 0;
                return self->do_report(*p, path) ? 1u : 0u;
            };

        static const CaelusPluginVTable kVTable = [&]() {
            CaelusPluginVTable v{};
            v.abi_version  = CAELUS_PLUGIN_ABI_VERSION;
            v.plugin_class = CAELUS_PLUGIN_REPORTER;
            v.name         = Derived::kName;
            v.version      = Derived::kVersion;
            v.init         = init_fn;
            v.cleanup      = cleanup_fn;
            v.on_tick      = nullptr;
            v.on_intel     = nullptr;
            v.solve        = nullptr;
            v.pull_intel   = nullptr;
            v.report       = report_fn;
            return v;
        }();
        return &kVTable;
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Reporter 1: NullReporter (no-op)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NullReporter
 *
 * Silently discards every report.  Used as the default in --det-mode so that
 * only the CDET: block is written to stdout — no extra output noise.
 */
struct NullReporter : ReporterBase<NullReporter> {
    static constexpr const char* kName    = "NullReporter";
    static constexpr const char* kVersion = "1.0.0";

    bool do_report(const CaelusReportPayload&, const char*) noexcept { return true; }
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Reporter 2: StdoutReporter (human-readable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * StdoutReporter
 *
 * Prints a formatted operational report to stdout.
 * Identical content to the existing [CORE] block — used when no file path
 * is provided and the War Room WS stream is not available.
 */
struct StdoutReporter : ReporterBase<StdoutReporter> {
    static constexpr const char* kName    = "StdoutReporter";
    static constexpr const char* kVersion = "1.0.0";

    bool do_report(const CaelusReportPayload& p, const char*) noexcept {
        auto fmt_time = [](int total_min) -> std::string {
            int h = total_min / 60, m = total_min % 60;
            char buf[8];
            std::snprintf(buf, sizeof(buf), "%d:%02d", h, m < 0 ? -m : m);
            return buf;
        };
        std::cout << "\n[REPORT] ─── " << p.scenario_id << " ───────────────────────\n"
                  << "[REPORT] Final friction  : "
                  << std::fixed << std::setprecision(3) << p.final_friction << "x"
                  << (p.regime_exceeded ? "  *** REGIME_EXCEEDED ***" : "") << "\n"
                  << "[REPORT] Completion      : " << fmt_time(p.completion_min) << "\n"
                  << "[REPORT] OTP Status      : "
                  << (p.on_time ? "ON TIME" : "AT RISK / DELAYED") << "\n"
                  << "[REPORT] Engine tick     : " << p.tick_nr << "\n"
                  << "[REPORT] ─────────────────────────────────────────────────\n";
        return true;
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Reporter 3: JsonReporter (NDJSON, optionally signed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JsonReporter
 *
 * Writes one NDJSON line per engine cycle to a file or to the WS emitter.
 *
 * Output format (single-line JSON):
 *   {"type":"report","scenario":"UNIVERSAL_BASELINE","friction":1.00,
 *    "completion_min":540,"on_time":false,"regime_exceeded":false,"tick":1}
 *
 * If `output_path` is provided, the line is appended to that file.
 * If `output_path` is NULL, the line is emitted via the engine's emit_json
 * callback (requires the WS emitter to be running).
 *
 * Future: add ed25519 signature over the NDJSON line (same key as the
 * persistent device identity) — integrate with caelus_identity in mesh_auth.rs.
 */
struct JsonReporter : ReporterBase<JsonReporter> {
    static constexpr const char* kName    = "JsonReporter";
    static constexpr const char* kVersion = "1.0.0";

    const CaelusEngineFns* engine_fns = nullptr;

    bool do_report(const CaelusReportPayload& p, const char* path) noexcept {
        // Build NDJSON line.
        char buf[512];
        int n = std::snprintf(buf, sizeof(buf),
            "{\"type\":\"report\","
            "\"scenario\":\"%s\","
            "\"friction\":%.4f,"
            "\"completion_min\":%d,"
            "\"on_time\":%s,"
            "\"regime_exceeded\":%s,"
            "\"tick\":%llu}",
            p.scenario_id,
            p.final_friction,
            p.completion_min,
            p.on_time          ? "true" : "false",
            p.regime_exceeded  ? "true" : "false",
            (unsigned long long)p.tick_nr);
        if (n <= 0 || (size_t)n >= sizeof(buf)) return false;

        // Write to file if path provided.
        if (path && path[0]) {
            if (std::FILE* f = std::fopen(path, "a")) {
                std::fputs(buf, f);
                std::fputc('\n', f);
                std::fclose(f);
                return true;
            }
            return false;
        }

        // Otherwise push to War Room WS stream.
        if (engine_fns && engine_fns->emit_json) {
            return engine_fns->emit_json(engine_fns->engine_ctx, buf) != 0;
        }

        // Fallback: stdout.
        std::puts(buf);
        return true;
    }
};

} // namespace caelus
