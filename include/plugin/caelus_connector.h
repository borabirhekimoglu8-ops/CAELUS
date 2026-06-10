/**
 * CAELUS OS — Connector Abstraction  (include/plugin/caelus_connector.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONNECTOR ROLE
 * ═══════════════════════════════════════════════════════════════════════════
 * A Connector bridges an external data source (MQTT broker, CSV file, REST
 * endpoint, serial device, LoRa radio) and the CAELUS Intel Queue.
 *
 * On each engine tick the registry calls the connector's `pull_intel` method.
 * The connector returns batches of CaelusIntelEvent structs; the engine
 * injects them into the Rust IntelFeedQueue via caelus_inject_intel_packet.
 *
 * Zero-cost guarantee:
 *   Built-in connectors are CRTP structs with no virtual functions.
 *   CsvReplayConnector uses a bounded dynamic replay store so dense crisis
 *   feeds do not silently truncate at a small fixed buffer. External
 *   connectors use the C ABI path (one indirect call per pull_intel).
 *
 * Memory ownership:
 *   ConnectorBase never allocates.  External state (file handles, sockets)
 *   is managed by the Derived class; `cleanup` must release it.
 *
 * Thread safety:
 *   `pull_intel` may be called from the engine's main tick thread only.
 *   If the connector has a background reader thread it must protect its
 *   internal queue with a mutex (see CsvReplayConnector for an example).
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include "caelus_plugin_abi.h"
#include "ws_emitter.h"          // SocketFd / cross-platform socket helpers
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <exception>
#include <fstream>
#include <iostream>
#include <limits>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#ifndef _WIN32
#  include <netdb.h>
#endif

namespace caelus {

// ─────────────────────────────────────────────────────────────────────────────
// CRTP base for built-in connectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ConnectorBase<Derived>
 *
 * Derived must implement:
 *   static constexpr const char* kName;
 *   static constexpr const char* kVersion;
 *   size_t do_pull(CaelusIntelEvent* out, size_t max) noexcept;
 *   void   do_cleanup() noexcept;          (optional — default no-op)
 *   bool   do_init(const CaelusEngineFns*) noexcept;  (optional — default ok)
 */
template<typename Derived>
struct ConnectorBase {
    /** Pull up to max pending events.  Returns actual count written. */
    [[nodiscard]] size_t pull(CaelusIntelEvent* out, size_t max) noexcept {
        return static_cast<Derived*>(this)->do_pull(out, max);
    }

    /** Generate the static C ABI VTable for this connector. */
    static const CaelusPluginVTable* make_vtable() noexcept {
        static constexpr auto init_fn =
            [](void* ps, const CaelusEngineFns* fns) -> uint8_t {
                auto* self = static_cast<Derived*>(ps);
                return self ? (self->do_init(fns) ? 1u : 0u) : 1u;
            };
        static constexpr auto cleanup_fn =
            [](void* ps) noexcept {
                if (auto* self = static_cast<Derived*>(ps)) self->do_cleanup();
            };
        static constexpr auto pull_fn =
            [](void* ps, CaelusIntelEvent* out,
               size_t max, size_t* count) -> uint8_t {
                auto* self = static_cast<Derived*>(ps);
                if (!self || !out || !count) return 0;
                *count = self->do_pull(out, max);
                return (*count > 0) ? 1u : 0u;
            };

        static const CaelusPluginVTable kVTable = [&]() {
            CaelusPluginVTable v{};
            v.abi_version  = CAELUS_PLUGIN_ABI_VERSION;
            v.plugin_class = CAELUS_PLUGIN_CONNECTOR;
            v.name         = Derived::kName;
            v.version      = Derived::kVersion;
            v.init         = init_fn;
            v.cleanup      = cleanup_fn;
            v.on_tick      = nullptr;
            v.on_intel     = nullptr;
            v.solve        = nullptr;
            v.pull_intel   = pull_fn;
            v.report       = nullptr;
            return v;
        }();
        return &kVTable;
    }

protected:
    // Default implementations (Derived may override any of these).
    bool do_init(const CaelusEngineFns*) noexcept { return true; }
    void do_cleanup() noexcept {}
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Connector 1: NullConnector (always available)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NullConnector
 *
 * A no-op connector that produces no events.
 * Used as the default when no external data source is configured.
 * Zero overhead: do_pull() returns 0 immediately.
 */
struct NullConnector : ConnectorBase<NullConnector> {
    static constexpr const char* kName    = "NullConnector";
    static constexpr const char* kVersion = "1.0.0";

    [[nodiscard]] size_t do_pull(CaelusIntelEvent*, size_t) noexcept { return 0; }
};


// ─────────────────────────────────────────────────────────────────────────────
// Built-in Connector 2: CsvReplayConnector (tick-timed file replay)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CsvReplayConnector
 *
 * Reads a scenario JSON, CSV, or JSONL file of historical intel events and
 * replays them tick-by-tick.  Supported row formats:
 *
 *   CSV:   tick,friction_coeff,crisis_level,memo
 *   JSONL: {"tick":0,"friction_coefficient":0.82,"crisis_level":2,"memo":"..."}
 *   ScenarioPack: v1_engine_bridge.intel_feed_sequence[] with t_hour values.
 *
 * Useful for: regression tests, scenario playback, CI integration.
 */
struct CsvReplayConnector : ConnectorBase<CsvReplayConnector> {
private:
    struct ReplayEvent {
        uint64_t tick = 0;
        CaelusIntelEvent event{};
    };

public:
    static constexpr const char* kName    = "CsvReplayConnector";
    static constexpr const char* kVersion = "1.0.0";
    static constexpr size_t      kDefaultMaxReplayEvents = 65536;
    static constexpr size_t      kHardMaxReplayEvents = 1048576;

    /** Path to the CSV/JSONL file (set before init). */
    const char* source_path = nullptr;
    /** Current read position (event index). */
    size_t      cursor      = 0;

    bool do_init(const CaelusEngineFns* fns) noexcept {
        fns_ = fns;
        cursor = 0;
        events_.clear();
        overflow_count_ = 0;
        first_overflow_tick_ = 0;
        max_events_ = configured_max_events();
        if (!source_path || !source_path[0]) return true;

        std::ifstream in(source_path, std::ios::binary);
        if (!in) {
            std::cerr << "[CONNECTOR] CsvReplayConnector kaynak acilamadi: "
                      << source_path << "\n";
            return false;
        }

        std::ostringstream buf;
        buf << in.rdbuf();
        const std::string content = buf.str();
        const size_t first = content.find_first_not_of(" \t\r\n");
        if (first == std::string::npos) return true;

        try {
            events_.reserve(max_events_);
            if (content.find("\"intel_feed_sequence\"") != std::string::npos) {
                parse_scenario_json(content);
            } else if (content[first] == '{') {
                parse_jsonl(content);
            } else {
                parse_csv(content);
            }
            sort_events();
        } catch (const std::exception& ex) {
            std::cerr << "[CONNECTOR] CsvReplayConnector bellek/parse hatasi; "
                      << "kaynak reddedildi: " << ex.what() << "\n";
            events_.clear();
            return false;
        } catch (...) {
            std::cerr << "[CONNECTOR] CsvReplayConnector beklenmeyen parse hatasi; "
                      << "kaynak reddedildi.\n";
            events_.clear();
            return false;
        }

        if (overflow_count_ > 0) {
            std::cerr << "[CONNECTOR] CsvReplayConnector kapasite asimi: "
                      << events_.size() << " olay kabul edildi, "
                      << overflow_count_ << " olay reddedildi"
                      << " (ilk reddedilen tick=" << first_overflow_tick_
                      << ", max=" << max_events_ << "). "
                      << "Eksik replay ile devam edilmemesi icin kaynak reddedildi. "
                      << "CAELUS_CONNECTOR_MAX_EVENTS ile limiti artirin.\n";
            events_.clear();
            return false;
        }

        std::cout << "[CONNECTOR] CsvReplayConnector yuklendi: "
                  << events_.size() << " olay (" << source_path
                  << ", max=" << max_events_ << ")\n";
        return true;
    }

    void do_cleanup() noexcept {
        fns_ = nullptr;
        cursor = 0;
        overflow_count_ = 0;
        first_overflow_tick_ = 0;
        std::vector<ReplayEvent>().swap(events_);
    }

    [[nodiscard]] size_t do_pull(CaelusIntelEvent* out, size_t max) noexcept {
        if (!out || max == 0) return 0;
        const uint64_t now = current_tick();
        size_t n = 0;
        while (cursor < events_.size() && n < max && events_[cursor].tick <= now) {
            out[n] = events_[cursor].event;
            out[n].observed_at_tick = now;
            ++n;
            ++cursor;
        }
        return n;
    }

private:
    const CaelusEngineFns* fns_ = nullptr;
    std::vector<ReplayEvent> events_;
    size_t max_events_ = kDefaultMaxReplayEvents;
    size_t overflow_count_ = 0;
    uint64_t first_overflow_tick_ = 0;

    [[nodiscard]] uint64_t current_tick() const noexcept {
        if (!fns_ || !fns_->current_tick) return 0;
        return fns_->current_tick(fns_->engine_ctx);
    }

    static double clamp_coeff(double v) noexcept {
        return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
    }

    static uint8_t clamp_crisis(int v) noexcept {
        return static_cast<uint8_t>(v < 0 ? 0 : (v > 3 ? 3 : v));
    }

    static size_t configured_max_events() noexcept {
        const char* raw = std::getenv("CAELUS_CONNECTOR_MAX_EVENTS");
        if (!raw || !raw[0]) return kDefaultMaxReplayEvents;

        char* end = nullptr;
        const unsigned long long requested = std::strtoull(raw, &end, 10);
        if (end == raw || requested == 0ULL) {
            std::cerr << "[CONNECTOR] CAELUS_CONNECTOR_MAX_EVENTS gecersiz; "
                      << kDefaultMaxReplayEvents << " varsayilani kullaniliyor.\n";
            return kDefaultMaxReplayEvents;
        }
        if (requested > static_cast<unsigned long long>(kHardMaxReplayEvents)) {
            std::cerr << "[CONNECTOR] CAELUS_CONNECTOR_MAX_EVENTS cok buyuk; "
                      << kHardMaxReplayEvents << " ust sinirina cekildi.\n";
            return kHardMaxReplayEvents;
        }
        return static_cast<size_t>(requested);
    }

    static void copy_memo(char* dst, size_t dst_len, const std::string& src) noexcept {
        if (!dst || dst_len == 0) return;
        size_t n = src.size();
        if (n >= dst_len) n = dst_len - 1;
        std::memcpy(dst, src.data(), n);
        dst[n] = '\0';
        for (size_t i = 0; i < n; ++i) {
            if (dst[i] == '\r' || dst[i] == '\n') dst[i] = ' ';
        }
    }

    void add_event(uint64_t tick, double coeff, int crisis,
                   const std::string& memo) {
        if (events_.size() >= max_events_) {
            if (overflow_count_ == 0) first_overflow_tick_ = tick;
            ++overflow_count_;
            return;
        }
        ReplayEvent item{};
        item.tick = tick;
        item.event.friction_coeff = clamp_coeff(coeff);
        item.event.crisis_level = clamp_crisis(crisis);
        item.event.source_slot_id = 0xCAE105C0FFEEULL;
        item.event.observed_at_tick = tick;
        copy_memo(item.event.memo, sizeof(item.event.memo), memo);
        events_.push_back(item);
    }

    static std::string trim(std::string s) {
        const size_t a = s.find_first_not_of(" \t\r\n");
        if (a == std::string::npos) return {};
        const size_t b = s.find_last_not_of(" \t\r\n");
        return s.substr(a, b - a + 1);
    }

    static bool csv_field(const char*& p, const char* end, std::string& out) {
        out.clear();
        while (p < end && (*p == ' ' || *p == '\t')) ++p;
        if (p < end && *p == '"') {
            ++p;
            while (p < end) {
                if (*p == '"') {
                    if (p + 1 < end && p[1] == '"') {
                        out.push_back('"');
                        p += 2;
                        continue;
                    }
                    ++p;
                    break;
                }
                out.push_back(*p++);
            }
            while (p < end && *p != ',') ++p;
        } else {
            while (p < end && *p != ',') out.push_back(*p++);
            out = trim(out);
        }
        if (p < end && *p == ',') ++p;
        return true;
    }

    void parse_csv_line(const std::string& line) {
        std::string stripped = trim(line);
        if (stripped.empty() || stripped[0] == '#') return;
        if (stripped.find("tick") != std::string::npos &&
            stripped.find("friction") != std::string::npos) {
            return;
        }

        const char* p = stripped.data();
        const char* end = p + stripped.size();
        std::string tick_s, coeff_s, crisis_s, memo_s;
        csv_field(p, end, tick_s);
        csv_field(p, end, coeff_s);
        csv_field(p, end, crisis_s);
        csv_field(p, end, memo_s);
        if (tick_s.empty() || coeff_s.empty()) return;

        const uint64_t tick = std::strtoull(tick_s.c_str(), nullptr, 10);
        const double coeff = std::strtod(coeff_s.c_str(), nullptr);
        const int crisis = static_cast<int>(std::strtol(crisis_s.c_str(), nullptr, 10));
        add_event(tick, coeff, crisis, memo_s);
    }

    void parse_csv(const std::string& content) {
        std::istringstream lines(content);
        std::string line;
        while (std::getline(lines, line)) parse_csv_line(line);
    }

    static bool json_number(const std::string& obj, const char* key, double& out) {
        const std::string needle = std::string("\"") + key + "\"";
        size_t pos = obj.find(needle);
        if (pos == std::string::npos) return false;
        pos = obj.find(':', pos + needle.size());
        if (pos == std::string::npos) return false;
        ++pos;
        while (pos < obj.size() && (obj[pos] == ' ' || obj[pos] == '\t')) ++pos;
        char* ep = nullptr;
        out = std::strtod(obj.c_str() + pos, &ep);
        return ep && ep != obj.c_str() + pos;
    }

    static bool json_u64(const std::string& obj, const char* key, uint64_t& out) {
        double v = 0.0;
        if (!json_number(obj, key, v)) return false;
        out = v < 0.0 ? 0ULL : static_cast<uint64_t>(v);
        return true;
    }

    static std::string json_string(const std::string& obj, const char* key) {
        const std::string needle = std::string("\"") + key + "\"";
        size_t pos = obj.find(needle);
        if (pos == std::string::npos) return {};
        pos = obj.find(':', pos + needle.size());
        if (pos == std::string::npos) return {};
        pos = obj.find('"', pos + 1);
        if (pos == std::string::npos) return {};
        ++pos;

        std::string out;
        while (pos < obj.size()) {
            const char c = obj[pos++];
            if (c == '"') break;
            if (c == '\\' && pos < obj.size()) {
                const char esc = obj[pos++];
                switch (esc) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    default: out.push_back(esc); break;
                }
            } else {
                out.push_back(c);
            }
        }
        return out;
    }

    void parse_json_event(const std::string& obj, uint64_t ticks_per_hour) {
        uint64_t tick = 0;
        uint64_t t_hour = 0;
        if (!json_u64(obj, "tick", tick)) {
            if (json_u64(obj, "t_hour", t_hour)) {
                tick = t_hour * ticks_per_hour;
            } else {
                return;
            }
        }

        double coeff = 0.0;
        if (!json_number(obj, "friction_coefficient", coeff)) {
            json_number(obj, "friction_coeff", coeff);
        }
        double crisis_d = 0.0;
        json_number(obj, "crisis_level", crisis_d);
        add_event(tick, coeff, static_cast<int>(crisis_d), json_string(obj, "memo"));
    }

    void parse_jsonl(const std::string& content) {
        std::istringstream lines(content);
        std::string line;
        while (std::getline(lines, line)) {
            if (line.find('{') != std::string::npos) parse_json_event(line, 1);
        }
    }

    void parse_scenario_json(const std::string& content) {
        double tick_minutes_d = 15.0;
        json_number(content, "tick_minutes", tick_minutes_d);
        const uint64_t tick_minutes = tick_minutes_d > 0.0
            ? static_cast<uint64_t>(tick_minutes_d)
            : 15ULL;
        const uint64_t ticks_per_hour = tick_minutes ? (60ULL / tick_minutes) : 4ULL;

        size_t seq = content.find("\"intel_feed_sequence\"");
        if (seq == std::string::npos) return;
        size_t arr = content.find('[', seq);
        if (arr == std::string::npos) return;

        int depth = 0;
        size_t obj_begin = std::string::npos;
        bool in_string = false;
        bool escape = false;
        for (size_t i = arr + 1; i < content.size(); ++i) {
            const char c = content[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (in_string) {
                if (c == '\\') escape = true;
                else if (c == '"') in_string = false;
                continue;
            }
            if (c == '"') {
                in_string = true;
            } else if (c == '{') {
                if (depth == 0) obj_begin = i;
                ++depth;
            } else if (c == '}') {
                if (depth > 0) --depth;
                if (depth == 0 && obj_begin != std::string::npos) {
                    parse_json_event(content.substr(obj_begin, i - obj_begin + 1),
                                     ticks_per_hour ? ticks_per_hour : 1ULL);
                    obj_begin = std::string::npos;
                }
            } else if (c == ']' && depth == 0) {
                break;
            }
        }
    }

    void sort_events() {
        std::stable_sort(events_.begin(), events_.end(),
                         [](const ReplayEvent& a, const ReplayEvent& b) {
                             return a.tick < b.tick;
                         });
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Live LAN / loopback connectors
// ─────────────────────────────────────────────────────────────────────────────

namespace connector_detail {

static constexpr size_t kRingCapacity     = 128;
static constexpr size_t kMaxPayloadBytes  = 1024;
static constexpr size_t kMaxMqttPacket    = 4096;
static constexpr uint64_t kMqttSourceSlot = 0xCAE1050000A10001ULL;
static constexpr uint64_t kZapierSourceSlot = 0xCAE1050000A10002ULL;

inline double clamp_coeff(double v) noexcept {
    return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

inline uint8_t clamp_crisis(int v) noexcept {
    return static_cast<uint8_t>(v < 0 ? 0 : (v > 3 ? 3 : v));
}

inline uint64_t current_tick(const CaelusEngineFns* fns) noexcept {
    return (fns && fns->current_tick) ? fns->current_tick(fns->engine_ctx) : 0ULL;
}

inline std::string trim(std::string s) {
    const size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return {};
    const size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

inline void copy_memo(char* dst, size_t dst_len, const std::string& src) noexcept {
    if (!dst || dst_len == 0) return;
    size_t n = std::min(src.size(), dst_len - 1);
    for (size_t i = 0; i < n; ++i) {
        const unsigned char c = static_cast<unsigned char>(src[i]);
        dst[i] = (c == '\r' || c == '\n' || c < 0x20u) ? ' ' : static_cast<char>(c);
    }
    dst[n] = '\0';
}

inline bool csv_field(const char*& p, const char* end, std::string& out) {
    out.clear();
    while (p < end && (*p == ' ' || *p == '\t')) ++p;
    if (p < end && *p == '"') {
        ++p;
        while (p < end) {
            if (*p == '"') {
                if (p + 1 < end && p[1] == '"') {
                    out.push_back('"');
                    p += 2;
                    continue;
                }
                ++p;
                break;
            }
            out.push_back(*p++);
        }
        while (p < end && *p != ',') ++p;
    } else {
        while (p < end && *p != ',') out.push_back(*p++);
        out = trim(out);
    }
    if (p < end && *p == ',') ++p;
    return true;
}

inline bool json_number(const std::string& obj, const char* key, double& out) {
    const std::string needle = std::string("\"") + key + "\"";
    size_t pos = obj.find(needle);
    if (pos == std::string::npos) return false;
    pos = obj.find(':', pos + needle.size());
    if (pos == std::string::npos) return false;
    ++pos;
    while (pos < obj.size() && (obj[pos] == ' ' || obj[pos] == '\t')) ++pos;
    char* ep = nullptr;
    out = std::strtod(obj.c_str() + pos, &ep);
    return ep && ep != obj.c_str() + pos;
}

inline std::string json_string(const std::string& obj, const char* key) {
    const std::string needle = std::string("\"") + key + "\"";
    size_t pos = obj.find(needle);
    if (pos == std::string::npos) return {};
    pos = obj.find(':', pos + needle.size());
    if (pos == std::string::npos) return {};
    pos = obj.find('"', pos + 1);
    if (pos == std::string::npos) return {};
    ++pos;

    std::string out;
    while (pos < obj.size()) {
        const char c = obj[pos++];
        if (c == '"') break;
        if (c == '\\' && pos < obj.size()) {
            const char esc = obj[pos++];
            switch (esc) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                default: out.push_back(esc); break;
            }
        } else {
            out.push_back(c);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intel data-plane authentication (CAELUS_INTEL_TOKEN)
// ─────────────────────────────────────────────────────────────────────────────
//
// The mesh CONTROL plane is ed25519-authenticated with anti-replay
// (src/network/discovery.rs), but intel DATA-plane payloads (MQTT publishes,
// Zapier webhook POSTs) historically carried no identity at all: anyone who
// could reach the LAN broker or loopback port could inject events straight
// into the causal graph. The shared-token gate below closes that gap without
// any external dependency (std C++17 only; no Rust FFI linkage so header-only
// consumers such as tests/connector_smoke.py keep building):
//
//   CAELUS_INTEL_TOKEN set (32+ char secret recommended):
//     every intel message MUST present the token —
//       * JSON payload : "auth":"<token>" member            (MQTT + Zapier)
//       * CSV payload  : first line "#auth=<token>"         (MQTT + Zapier)
//       * HTTP header  : "X-Caelus-Auth: <token>"           (Zapier only)
//     missing/wrong token → message is rejected BEFORE parsing; the first
//     IntelAuthGate::kMaxRejectLogs rejects are logged per channel, the rest
//     are only counted (log-flood guard; total reported at cleanup).
//   CAELUS_INTEL_TOKEN unset:
//     legacy behaviour (accept without auth) is preserved and a single
//     process-wide warning is printed, so existing deployments keep working
//     and the demo→production switch is one environment variable.
//
// Token comparison is constant-time (volatile XOR accumulator). Presented
// auth material is ALWAYS stripped from the payload before parsing so the
// token can never leak into engine memo fields or the causal graph.
// Full signature-based data-plane identity (per-source keys) remains a
// design item in docs/GERCEK_DUNYA_GECIS_RAPORU.md.

inline bool is_ws_char(char c) noexcept {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

/** Constant-time string equality: runtime independent of mismatch position. */
inline bool constant_time_equal(const std::string& a, const std::string& b) noexcept {
    const size_t n = a.size() > b.size() ? a.size() : b.size();
    // volatile accumulator: the compiler may not short-circuit the loop, so
    // timing does not reveal where the first differing byte is.
    volatile unsigned char acc = (a.size() == b.size()) ? 0u : 1u;
    for (size_t i = 0; i < n; ++i) {
        const unsigned char ca = i < a.size() ? static_cast<unsigned char>(a[i]) : 0u;
        const unsigned char cb = i < b.size() ? static_cast<unsigned char>(b[i]) : 0u;
        acc = static_cast<unsigned char>(acc | static_cast<unsigned char>(ca ^ cb));
    }
    return acc == 0u;
}

/** Remove `"key":"value"` (plus one adjacent comma) from a flat JSON object. */
inline void json_strip_string_field(std::string& obj, const char* key) noexcept {
    const std::string needle = std::string("\"") + key + "\"";
    const size_t kpos = obj.find(needle);
    if (kpos == std::string::npos) return;
    const size_t colon = obj.find(':', kpos + needle.size());
    if (colon == std::string::npos) return;
    const size_t vstart = obj.find('"', colon + 1);
    if (vstart == std::string::npos) return;

    size_t vend = vstart + 1;
    bool escape = false;
    while (vend < obj.size()) {
        const char c = obj[vend];
        if (escape) escape = false;
        else if (c == '\\') escape = true;
        else if (c == '"') break;
        ++vend;
    }
    if (vend >= obj.size()) return;   // unterminated value: leave untouched

    size_t erase_begin = kpos;
    size_t erase_end = vend + 1u;
    size_t after = erase_end;
    while (after < obj.size() && is_ws_char(obj[after])) ++after;
    if (after < obj.size() && obj[after] == ',') {
        erase_end = after + 1u;                       // "auth":"x", rest...
    } else {
        size_t before = erase_begin;
        while (before > 0 && is_ws_char(obj[before - 1u])) --before;
        if (before > 0 && obj[before - 1u] == ',') {  // ...rest, "auth":"x"
            erase_begin = before - 1u;
        }
    }
    obj.erase(erase_begin, erase_end - erase_begin);
}

/**
 * If the payload's first non-blank line is `#auth=<value>`, remove that line
 * and return its value. Returns false when no auth line is present.
 */
inline bool csv_strip_auth_line(std::string& raw, std::string& value_out) noexcept {
    value_out.clear();
    static constexpr const char kPrefix[] = "#auth=";
    static constexpr size_t kPrefixLen = sizeof(kPrefix) - 1u;
    const size_t start = raw.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return false;
    if (raw.compare(start, kPrefixLen, kPrefix) != 0) return false;
    const size_t eol = raw.find('\n', start);
    const size_t value_end = (eol == std::string::npos) ? raw.size() : eol;
    value_out = trim(raw.substr(start + kPrefixLen, value_end - (start + kPrefixLen)));
    raw.erase(0, (eol == std::string::npos) ? raw.size() : eol + 1u);
    return true;
}

/**
 * IntelAuthGate — per-connector intel data-plane auth policy.
 *
 * Thread model: init() runs on the engine thread before the connector's
 * reader thread starts; admit()/header_matches() run on that single reader
 * thread; summarize() runs after the reader thread is joined. No locking
 * is therefore required.
 */
struct IntelAuthGate {
    static constexpr unsigned kMaxRejectLogs = 5;

    void init(const char* channel_name) noexcept {
        channel_ = (channel_name && channel_name[0]) ? channel_name : "?";
        const char* v = std::getenv("CAELUS_INTEL_TOKEN");
        token_ = (v && v[0]) ? v : "";
        rejected_total_ = 0;
        rejected_logged_ = 0;
#ifndef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION'da derleme-dışı: token'sız "uyar ve kabul et" miras yolu üretimde yoktur; eksik token'ı connector do_init FATAL'e çevirir.
        if (token_.empty()) warn_unauthenticated_once();
#endif
    }

    [[nodiscard]] bool enabled() const noexcept { return !token_.empty(); }

    /** Constant-time check for transport-level auth (Zapier X-Caelus-Auth). */
    [[nodiscard]] bool header_matches(const std::string& presented) const noexcept {
        return enabled() && !presented.empty() && constant_time_equal(presented, token_);
    }

    /**
     * Validate and strip in-payload auth material.
     * Returns false when the message must be rejected (never parsed/injected).
     * `transport_authenticated` short-circuits the payload check for messages
     * already authenticated at the transport layer (HTTP header); inline auth
     * material is still stripped so it cannot flow further.
     */
    [[nodiscard]] bool admit(std::string& raw, bool transport_authenticated) noexcept {
        const size_t first = raw.find_first_not_of(" \t\r\n");
        const bool is_json = (first != std::string::npos && raw[first] == '{');

        if (!enabled() || transport_authenticated) {
            strip_payload_auth(raw, is_json);
            return true;
        }

        std::string presented;
        if (is_json) {
            presented = json_string(raw, "auth");
        } else {
            csv_strip_auth_line(raw, presented);
        }
        if (!constant_time_equal(presented, token_)) {
            note_rejected();
            return false;
        }
        if (is_json) json_strip_string_field(raw, "auth");
        return true;
    }

    /** One-line total after the reader thread stops (suppressed-log visibility). */
    void summarize() const noexcept {
        if (rejected_total_ > 0) {
            std::cerr << "[CONN-AUTH] kanal=" << channel_
                      << " toplam INTEL_REJECTED=" << rejected_total_ << "\n";
        }
    }

private:
    std::string token_;
    const char* channel_ = "?";
    uint64_t rejected_total_ = 0;
    unsigned rejected_logged_ = 0;

#ifndef CAELUS_PRODUCTION
    // CAELUS_PRODUCTION'da derleme-dışı: kimliksiz-kabul uyarısı yalnız dev/demo build'inde anlamlıdır.
    static void warn_unauthenticated_once() noexcept {
        static std::atomic<bool> warned{false};
        bool expected = false;
        if (warned.compare_exchange_strong(expected, true)) {
            std::cerr << "[CONN-AUTH] UYARI: intel veri duzlemi kimliksiz "
                         "(CAELUS_INTEL_TOKEN set degil); MQTT/Zapier intel "
                         "payload'lari dogrulanmadan kabul ediliyor.\n";
        }
    }
#endif

    static void strip_payload_auth(std::string& raw, bool is_json) noexcept {
        if (is_json) {
            json_strip_string_field(raw, "auth");
        } else {
            std::string ignored;
            csv_strip_auth_line(raw, ignored);
        }
    }

    void note_rejected() noexcept {
        ++rejected_total_;
        if (rejected_logged_ < kMaxRejectLogs) {
            ++rejected_logged_;
            std::cerr << "[CONN-AUTH] INTEL_REJECTED: auth eksik/gecersiz (kanal="
                      << channel_ << ", ret #" << rejected_total_ << ")";
            if (rejected_logged_ == kMaxRejectLogs) {
                std::cerr << "; bundan sonraki retler yalnizca sayilacak";
            }
            std::cerr << "\n";
        }
    }
};

inline bool parse_intel_payload(const std::string& raw,
                                uint64_t source_slot,
                                const CaelusEngineFns* fns,
                                CaelusIntelEvent& ev) noexcept {
    if (raw.empty() || raw.size() > kMaxPayloadBytes) return false;

    const std::string body = trim(raw);
    if (body.empty()) return false;

    double coeff = 0.0;
    int crisis = 0;
    std::string memo;
    bool has_coeff = false;

    if (body[0] == '{') {
        has_coeff = json_number(body, "friction_coeff", coeff);
        if (!has_coeff) has_coeff = json_number(body, "friction_coefficient", coeff);
        double crisis_d = 0.0;
        if (json_number(body, "crisis_level", crisis_d)) {
            crisis = static_cast<int>(crisis_d);
        }
        memo = json_string(body, "memo");
    } else {
        const char* p = body.data();
        const char* end = p + body.size();
        std::string coeff_s, crisis_s, memo_s;
        csv_field(p, end, coeff_s);
        csv_field(p, end, crisis_s);
        csv_field(p, end, memo_s);
        if (!coeff_s.empty()) {
            coeff = std::strtod(coeff_s.c_str(), nullptr);
            has_coeff = true;
        }
        if (!crisis_s.empty()) {
            crisis = static_cast<int>(std::strtol(crisis_s.c_str(), nullptr, 10));
        }
        memo = memo_s;
    }

    if (!has_coeff) return false;
    ev = CaelusIntelEvent{};
    ev.friction_coeff = clamp_coeff(coeff);
    ev.crisis_level = clamp_crisis(crisis);
    ev.source_slot_id = source_slot;
    ev.observed_at_tick = current_tick(fns);
    copy_memo(ev.memo, sizeof(ev.memo), memo);
    return true;
}

struct IntelRing {
    CaelusIntelEvent events[kRingCapacity]{};
    size_t head = 0;
    size_t count = 0;
    size_t dropped = 0;
    std::mutex mu;

    void push(const CaelusIntelEvent& ev) noexcept {
        std::lock_guard<std::mutex> lg(mu);
        if (count == kRingCapacity) {
            head = (head + 1u) % kRingCapacity;
            --count;
            ++dropped;
        }
        const size_t tail = (head + count) % kRingCapacity;
        events[tail] = ev;
        ++count;
    }

    size_t drain(CaelusIntelEvent* out, size_t max) noexcept {
        if (!out || max == 0) return 0;
        std::lock_guard<std::mutex> lg(mu);
        size_t n = 0;
        while (n < max && count > 0) {
            out[n++] = events[head];
            head = (head + 1u) % kRingCapacity;
            --count;
        }
        return n;
    }

    void clear() noexcept {
        std::lock_guard<std::mutex> lg(mu);
        head = 0;
        count = 0;
        dropped = 0;
    }
};

inline bool socket_would_block() noexcept {
#ifdef _WIN32
    const int e = ::WSAGetLastError();
    return e == WSAEWOULDBLOCK || e == WSAEINPROGRESS || e == WSAEALREADY;
#else
    return errno == EAGAIN || errno == EWOULDBLOCK || errno == EINPROGRESS;
#endif
}

inline bool wait_socket(SocketFd s, bool write, unsigned timeout_ms,
                        const std::atomic<bool>& running) noexcept {
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(timeout_ms);
    while (running.load(std::memory_order_acquire)) {
        fd_set set;
        FD_ZERO(&set);
        FD_SET(s, &set);
        timeval tv{0, 100000};
        const auto now = std::chrono::steady_clock::now();
        if (now >= deadline) return false;
        const auto remaining =
            std::chrono::duration_cast<std::chrono::microseconds>(deadline - now);
        if (remaining.count() < 100000) {
            tv.tv_sec = 0;
            tv.tv_usec = static_cast<long>(remaining.count());
        }
        const int rc = write
            ? ::select(static_cast<int>(s) + 1, nullptr, &set, nullptr, &tv)
            : ::select(static_cast<int>(s) + 1, &set, nullptr, nullptr, &tv);
        if (rc > 0 && FD_ISSET(s, &set)) return true;
        if (rc < 0) return false;
    }
    return false;
}

inline bool send_all_running(SocketFd s, const uint8_t* buf, size_t len,
                             const std::atomic<bool>& running) noexcept {
    size_t sent = 0;
    while (sent < len && running.load(std::memory_order_acquire)) {
        if (!wait_socket(s, true, 1000, running)) return false;
        const int chunk = static_cast<int>(std::min<size_t>(len - sent, 4096u));
        const int n = static_cast<int>(::send(
            s, reinterpret_cast<const char*>(buf + sent), chunk, 0));
        if (n > 0) {
            sent += static_cast<size_t>(n);
        } else if (!socket_would_block()) {
            return false;
        }
    }
    return sent == len;
}

inline bool recv_exact(SocketFd s, uint8_t* out, size_t len,
                       const std::atomic<bool>& running) noexcept {
    size_t got = 0;
    while (got < len && running.load(std::memory_order_acquire)) {
        if (!wait_socket(s, false, 1000, running)) return false;
        const int want = static_cast<int>(std::min<size_t>(len - got, 4096u));
        const int n = static_cast<int>(::recv(
            s, reinterpret_cast<char*>(out + got), want, 0));
        if (n > 0) {
            got += static_cast<size_t>(n);
        } else if (n == 0 || !socket_would_block()) {
            return false;
        }
    }
    return got == len;
}

inline uint16_t env_port(const char* name, uint16_t fallback) noexcept {
    const char* v = std::getenv(name);
    if (!v || !v[0]) return fallback;
    const long p = std::strtol(v, nullptr, 10);
    return (p > 0 && p <= 65535) ? static_cast<uint16_t>(p) : fallback;
}

inline std::string env_string(const char* name, const char* fallback,
                              size_t max_len) {
    const char* v = std::getenv(name);
    std::string out = (v && v[0]) ? v : fallback;
    if (out.size() > max_len) out.resize(max_len);
    return out;
}

inline void append_u16(std::string& out, size_t v) {
    out.push_back(static_cast<char>((v >> 8u) & 0xFFu));
    out.push_back(static_cast<char>(v & 0xFFu));
}

inline void append_remaining_length(std::string& out, size_t len) {
    do {
        uint8_t byte = static_cast<uint8_t>(len % 128u);
        len /= 128u;
        if (len > 0) byte |= 0x80u;
        out.push_back(static_cast<char>(byte));
    } while (len > 0);
}

} // namespace connector_detail

/**
 * MqttConnector
 *
 * Minimal MQTT 3.1.1 QoS0 client. It connects to a LAN/loopback broker, sends
 * CONNECT + SUBSCRIBE for one topic, parses inbound PUBLISH packets, and stores
 * decoded intel events in a fixed ring. Engine ticks drain the ring through
 * pull_intel(), keeping causal engine mutation on the main engine path.
 *
 * Data-plane auth: when CAELUS_INTEL_TOKEN is set, each payload must carry the
 * token ("auth" JSON member or "#auth=" CSV first line); see IntelAuthGate.
 */
struct MqttConnector : ConnectorBase<MqttConnector> {
    static constexpr const char* kName    = "MqttConnector";
    static constexpr const char* kVersion = "1.0.0";

    bool do_init(const CaelusEngineFns* fns) noexcept {
        fns_ = fns;
        host_ = connector_detail::env_string("CAELUS_MQTT_HOST", "127.0.0.1", 255);
        port_ = connector_detail::env_port("CAELUS_MQTT_PORT", 1883);
        topic_ = connector_detail::env_string("CAELUS_MQTT_TOPIC", "caelus/intel", 255);
        client_id_ = connector_detail::env_string("CAELUS_MQTT_CLIENT_ID", "", 80);
        if (client_id_.empty()) {
            const auto now = std::chrono::steady_clock::now().time_since_epoch().count();
            client_id_ = "caelus-os-" + std::to_string(static_cast<long long>(now & 0x7FFFFFFF));
        }
        if (topic_.empty()) topic_ = "caelus/intel";
        auth_.init("MQTT");
#ifdef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION: kimliksiz intel veri düzlemi yasak — token yoksa connector init'te açık hata ile reddedilir, hiç başlamaz.
        if (!auth_.enabled()) {
            std::cerr << "[CONN-AUTH] FATAL: CAELUS_INTEL_TOKEN set degil — "
                         "MqttConnector uretim derlemesinde (CAELUS_PRODUCTION) "
                         "baslatilmiyor.\n";
            return false;
        }
#endif

        if (!wsa_init()) {
            std::cerr << "[CONNECTOR] MqttConnector socket init basarisiz.\n";
            return false;
        }

        running_.store(true, std::memory_order_release);
        thread_ = std::thread(&MqttConnector::run_loop, this);
        std::cout << "[CONNECTOR] MqttConnector aktif: mqtt://" << host_ << ":"
                  << port_ << " topic=" << topic_ << "\n";
        return true;
    }

    void do_cleanup() noexcept {
        running_.store(false, std::memory_order_release);
        SocketFd s = sock_.exchange(kInvalidSocket);
        if (s != kInvalidSocket) close_socket(s);
        if (thread_.joinable()) thread_.join();
        auth_.summarize();
        queue_.clear();
        fns_ = nullptr;
        wsa_cleanup();
    }

    [[nodiscard]] size_t do_pull(CaelusIntelEvent* out, size_t max) noexcept {
        return queue_.drain(out, max);
    }

private:
    const CaelusEngineFns* fns_ = nullptr;
    std::string host_;
    uint16_t port_ = 1883;
    std::string topic_;
    std::string client_id_;
    connector_detail::IntelRing queue_;
    connector_detail::IntelAuthGate auth_;
    std::atomic<bool> running_{false};
    std::atomic<SocketFd> sock_{kInvalidSocket};
    std::thread thread_;

    void run_loop() noexcept {
        while (running_.load(std::memory_order_acquire)) {
            SocketFd s = connect_tcp();
            if (s == kInvalidSocket) {
                sleep_ms(1000);
                continue;
            }
            sock_.store(s, std::memory_order_release);

            if (mqtt_handshake(s)) {
                read_publish_loop(s);
            }

            SocketFd old = sock_.exchange(kInvalidSocket);
            if (old != kInvalidSocket) close_socket(old);
            sleep_ms(1000);
        }
    }

    void sleep_ms(unsigned ms) const noexcept {
        const auto until = std::chrono::steady_clock::now() +
                           std::chrono::milliseconds(ms);
        while (running_.load(std::memory_order_acquire) &&
               std::chrono::steady_clock::now() < until) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    }

    SocketFd connect_tcp() noexcept {
        char service[16];
        std::snprintf(service, sizeof(service), "%u", static_cast<unsigned>(port_));

        addrinfo hints{};
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_protocol = IPPROTO_TCP;
        addrinfo* res = nullptr;
        if (::getaddrinfo(host_.c_str(), service, &hints, &res) != 0 || !res) {
            return kInvalidSocket;
        }

        SocketFd connected = kInvalidSocket;
        for (addrinfo* ai = res; ai && running_.load(std::memory_order_acquire); ai = ai->ai_next) {
            SocketFd s = ::socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
            if (s == kInvalidSocket) continue;
            set_nonblocking(s);
            const int rc = ::connect(s, ai->ai_addr, static_cast<int>(ai->ai_addrlen));
            if (rc == 0 || connector_detail::socket_would_block()) {
                if (connector_detail::wait_socket(s, true, 3000, running_)) {
                    int err = 0;
#ifdef _WIN32
                    int len = sizeof(err);
#else
                    socklen_t len = sizeof(err);
#endif
                    if (::getsockopt(s, SOL_SOCKET, SO_ERROR,
                                     reinterpret_cast<char*>(&err), &len) == 0 && err == 0) {
                        connected = s;
                        break;
                    }
                }
            }
            close_socket(s);
        }
        ::freeaddrinfo(res);
        return connected;
    }

    bool mqtt_handshake(SocketFd s) noexcept {
        if (!send_connect(s)) return false;
        uint8_t type = 0;
        std::string body;
        if (!read_packet(s, type, body)) return false;
        if ((type >> 4u) != 2u || body.size() < 2u || body[1] != '\0') {
            std::cerr << "[CONNECTOR] MqttConnector CONNACK reddedildi.\n";
            return false;
        }
        if (!send_subscribe(s)) return false;
        if (!read_packet(s, type, body)) return false;
        if ((type >> 4u) != 9u) {
            std::cerr << "[CONNECTOR] MqttConnector SUBACK beklenirken farkli paket alindi.\n";
            return false;
        }
        return true;
    }

    bool send_connect(SocketFd s) noexcept {
        std::string var;
        connector_detail::append_u16(var, 4);
        var += "MQTT";
        var.push_back(4);      // MQTT 3.1.1
        var.push_back(0x02);   // clean session
        connector_detail::append_u16(var, 60);
        connector_detail::append_u16(var, client_id_.size());
        var += client_id_;

        std::string pkt;
        pkt.push_back(0x10);
        connector_detail::append_remaining_length(pkt, var.size());
        pkt += var;
        return connector_detail::send_all_running(
            s, reinterpret_cast<const uint8_t*>(pkt.data()), pkt.size(), running_);
    }

    bool send_subscribe(SocketFd s) noexcept {
        std::string var;
        connector_detail::append_u16(var, 1); // packet id
        connector_detail::append_u16(var, topic_.size());
        var += topic_;
        var.push_back(0); // QoS0

        std::string pkt;
        pkt.push_back(static_cast<char>(0x82));
        connector_detail::append_remaining_length(pkt, var.size());
        pkt += var;
        return connector_detail::send_all_running(
            s, reinterpret_cast<const uint8_t*>(pkt.data()), pkt.size(), running_);
    }

    bool read_packet(SocketFd s, uint8_t& type, std::string& body) noexcept {
        uint8_t h = 0;
        if (!connector_detail::recv_exact(s, &h, 1, running_)) return false;
        size_t remaining = 0;
        size_t multiplier = 1;
        for (int i = 0; i < 4; ++i) {
            uint8_t encoded = 0;
            if (!connector_detail::recv_exact(s, &encoded, 1, running_)) return false;
            remaining += static_cast<size_t>(encoded & 0x7Fu) * multiplier;
            if ((encoded & 0x80u) == 0) break;
            multiplier *= 128u;
            if (i == 3) return false;
        }
        if (remaining > connector_detail::kMaxMqttPacket) return false;
        body.assign(remaining, '\0');
        if (remaining > 0 &&
            !connector_detail::recv_exact(
                s, reinterpret_cast<uint8_t*>(&body[0]), remaining, running_)) {
            return false;
        }
        type = h;
        return true;
    }

    void read_publish_loop(SocketFd s) noexcept {
        auto last_ping = std::chrono::steady_clock::now();
        while (running_.load(std::memory_order_acquire)) {
            fd_set rd;
            FD_ZERO(&rd);
            FD_SET(s, &rd);
            timeval tv{0, 500000};
            const int rc = ::select(static_cast<int>(s) + 1, &rd, nullptr, nullptr, &tv);
            if (rc < 0) break;
            if (rc == 0) {
                const auto now = std::chrono::steady_clock::now();
                if (now - last_ping > std::chrono::seconds(30)) {
                    const uint8_t ping[] = {0xC0u, 0x00u};
                    if (!connector_detail::send_all_running(s, ping, sizeof(ping), running_)) break;
                    last_ping = now;
                }
                continue;
            }

            uint8_t type = 0;
            std::string body;
            if (!read_packet(s, type, body)) break;
            const uint8_t packet_type = static_cast<uint8_t>(type >> 4u);
            if (packet_type == 3u) handle_publish(type, body);
        }
    }

    void handle_publish(uint8_t header, const std::string& body) noexcept {
        const uint8_t qos = static_cast<uint8_t>((header & 0x06u) >> 1u);
        if (qos != 0 || body.size() < 2u) return;
        const size_t topic_len =
            (static_cast<uint8_t>(body[0]) << 8u) | static_cast<uint8_t>(body[1]);
        if (2u + topic_len > body.size()) return;
        const std::string topic = body.substr(2u, topic_len);
        if (topic != topic_) return;
        std::string payload = body.substr(2u + topic_len);
        if (payload.size() > connector_detail::kMaxPayloadBytes) return;

        // Intel data-plane auth gate: rejected payloads are dropped before
        // parsing; accepted payloads continue with auth material stripped.
        if (!auth_.admit(payload, /*transport_authenticated=*/false)) return;

        CaelusIntelEvent ev{};
        if (connector_detail::parse_intel_payload(
                payload, connector_detail::kMqttSourceSlot, fns_, ev)) {
            queue_.push(ev);
        }
    }
};

/**
 * ZapierWebhookConnector
 *
 * Loopback-only HTTP listener for local Zapier/webhook bridge tools. Accepts
 * POST bodies in the same JSON/CSV intel format as MqttConnector, then queues
 * parsed events for normal registry pull/inject dispatch.
 *
 * Data-plane auth: when CAELUS_INTEL_TOKEN is set, each POST must carry the
 * token via the "X-Caelus-Auth" header OR in-payload ("auth" JSON member /
 * "#auth=" CSV first line); failures answer 401. See IntelAuthGate.
 */
struct ZapierWebhookConnector : ConnectorBase<ZapierWebhookConnector> {
    static constexpr const char* kName    = "ZapierWebhookConnector";
    static constexpr const char* kVersion = "1.0.0";

    bool do_init(const CaelusEngineFns* fns) noexcept {
        fns_ = fns;
        port_ = connector_detail::env_port("CAELUS_ZAPIER_WEBHOOK_PORT", 47810);
        auth_.init("Zapier");
#ifdef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION: kimliksiz intel veri düzlemi yasak — token yoksa connector init'te açık hata ile reddedilir, hiç başlamaz.
        if (!auth_.enabled()) {
            std::cerr << "[CONN-AUTH] FATAL: CAELUS_INTEL_TOKEN set degil — "
                         "ZapierWebhookConnector uretim derlemesinde (CAELUS_PRODUCTION) "
                         "baslatilmiyor.\n";
            return false;
        }
#endif
        if (!wsa_init()) {
            std::cerr << "[CONNECTOR] ZapierWebhookConnector socket init basarisiz.\n";
            return false;
        }

        listen_sock_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listen_sock_ == kInvalidSocket) {
            wsa_cleanup();
            return false;
        }

        int yes = 1;
        ::setsockopt(listen_sock_, SOL_SOCKET, SO_REUSEADDR,
                     reinterpret_cast<const char*>(&yes), static_cast<int>(sizeof(yes)));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(port_);
        ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

        if (::bind(listen_sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 ||
            ::listen(listen_sock_, 8) != 0) {
            close_socket(listen_sock_);
            listen_sock_ = kInvalidSocket;
            wsa_cleanup();
            std::cerr << "[CONNECTOR] ZapierWebhookConnector 127.0.0.1:"
                      << port_ << " bind basarisiz.\n";
            return false;
        }

        running_.store(true, std::memory_order_release);
        thread_ = std::thread(&ZapierWebhookConnector::run_loop, this);
        std::cout << "[CONNECTOR] ZapierWebhookConnector aktif: http://127.0.0.1:"
                  << port_ << "/\n";
        return true;
    }

    void do_cleanup() noexcept {
        running_.store(false, std::memory_order_release);
        SocketFd ls = listen_sock_.exchange(kInvalidSocket);
        if (ls != kInvalidSocket) close_socket(ls);
        if (thread_.joinable()) thread_.join();
        auth_.summarize();
        queue_.clear();
        fns_ = nullptr;
        wsa_cleanup();
    }

    [[nodiscard]] size_t do_pull(CaelusIntelEvent* out, size_t max) noexcept {
        return queue_.drain(out, max);
    }

private:
    const CaelusEngineFns* fns_ = nullptr;
    uint16_t port_ = 47810;
    connector_detail::IntelRing queue_;
    connector_detail::IntelAuthGate auth_;
    std::atomic<bool> running_{false};
    std::atomic<SocketFd> listen_sock_{kInvalidSocket};
    std::thread thread_;

    void run_loop() noexcept {
        while (running_.load(std::memory_order_acquire)) {
            SocketFd ls = listen_sock_.load(std::memory_order_relaxed);
            if (ls == kInvalidSocket) break;

            fd_set rd;
            FD_ZERO(&rd);
            FD_SET(ls, &rd);
            timeval tv{0, 100000};
            const int rc = ::select(static_cast<int>(ls) + 1, &rd, nullptr, nullptr, &tv);
            if (rc < 0) break;
            if (rc == 0 || !FD_ISSET(ls, &rd)) continue;

            sockaddr_in peer{};
#ifdef _WIN32
            int peer_len = sizeof(peer);
#else
            socklen_t peer_len = sizeof(peer);
#endif
            SocketFd cl = ::accept(ls, reinterpret_cast<sockaddr*>(&peer), &peer_len);
            if (cl == kInvalidSocket) continue;
            handle_client(cl);
            close_socket(cl);
        }
    }

    static bool starts_with_post(const std::string& header) {
        return header.size() >= 5u &&
               header[0] == 'P' && header[1] == 'O' &&
               header[2] == 'S' && header[3] == 'T' && header[4] == ' ';
    }

    static bool header_name_eq(const std::string& line, const char* name) {
        size_t i = 0;
        for (; name[i] && i < line.size(); ++i) {
            const char a = static_cast<char>(std::tolower(static_cast<unsigned char>(line[i])));
            const char b = static_cast<char>(std::tolower(static_cast<unsigned char>(name[i])));
            if (a != b) return false;
        }
        return name[i] == '\0' && i < line.size() && line[i] == ':';
    }

    static bool content_length(const std::string& header, size_t& out) {
        out = 0;
        size_t pos = 0;
        while (pos < header.size()) {
            const size_t eol = header.find("\r\n", pos);
            const size_t end = (eol == std::string::npos) ? header.size() : eol;
            const std::string line = header.substr(pos, end - pos);
            if (header_name_eq(line, "content-length")) {
                const size_t colon = line.find(':');
                if (colon == std::string::npos) return false;
                const long n = std::strtol(line.c_str() + colon + 1, nullptr, 10);
                if (n < 0 || static_cast<size_t>(n) > connector_detail::kMaxPayloadBytes) {
                    return false;
                }
                out = static_cast<size_t>(n);
                return true;
            }
            if (eol == std::string::npos) break;
            pos = eol + 2u;
        }
        return false;
    }

    /** Extract a header value by case-insensitive name ("" when absent). */
    static bool header_value(const std::string& header, const char* name,
                             std::string& out) {
        out.clear();
        size_t pos = 0;
        while (pos < header.size()) {
            const size_t eol = header.find("\r\n", pos);
            const size_t end = (eol == std::string::npos) ? header.size() : eol;
            const std::string line = header.substr(pos, end - pos);
            if (header_name_eq(line, name)) {
                const size_t colon = line.find(':');
                if (colon == std::string::npos) return false;
                out = connector_detail::trim(line.substr(colon + 1u));
                return true;
            }
            if (eol == std::string::npos) break;
            pos = eol + 2u;
        }
        return false;
    }

    bool recv_http(SocketFd cl, std::string& body, std::string& auth_header) noexcept {
        auth_header.clear();
        std::string req;
        req.reserve(2048);
        size_t header_end = std::string::npos;
        size_t clen = 0;
        while (running_.load(std::memory_order_acquire)) {
            if (!connector_detail::wait_socket(cl, false, 1000, running_)) return false;
            char buf[512];
            const int n = static_cast<int>(::recv(cl, buf, sizeof(buf), 0));
            if (n <= 0) return false;
            req.append(buf, static_cast<size_t>(n));
            if (req.size() > 8192u + connector_detail::kMaxPayloadBytes) return false;

            if (header_end == std::string::npos) {
                header_end = req.find("\r\n\r\n");
                if (header_end != std::string::npos) {
                    const std::string header = req.substr(0, header_end + 4u);
                    if (!starts_with_post(header) || !content_length(header, clen)) {
                        return false;
                    }
                    header_value(header, "x-caelus-auth", auth_header);
                }
            }
            if (header_end != std::string::npos &&
                req.size() >= header_end + 4u + clen) {
                body = req.substr(header_end + 4u, clen);
                return true;
            }
        }
        return false;
    }

    void send_response(SocketFd cl, int code, const char* reason,
                       const char* body) noexcept {
        char resp[192];
        const int n = std::snprintf(
            resp, sizeof(resp),
            "HTTP/1.1 %d %s\r\nConnection: close\r\nContent-Length: %zu\r\n"
            "Content-Type: text/plain\r\n\r\n%s",
            code, reason, std::strlen(body), body);
        if (n > 0) {
            connector_detail::send_all_running(
                cl, reinterpret_cast<const uint8_t*>(resp),
                static_cast<size_t>(n), running_);
        }
    }

    void handle_client(SocketFd cl) noexcept {
        std::string body;
        std::string presented_auth;
        if (!recv_http(cl, body, presented_auth)) {
            send_response(cl, 400, "Bad Request", "bad request\n");
            return;
        }

        // Intel data-plane auth gate: the X-Caelus-Auth header authenticates
        // the transport; otherwise the payload itself must carry the token
        // ("auth" JSON member / "#auth=" CSV first line). Rejects answer 401
        // and never reach the parser; accepted payloads continue stripped.
        const bool header_ok = auth_.header_matches(presented_auth);
        if (!auth_.admit(body, header_ok)) {
            send_response(cl, 401, "Unauthorized", "unauthorized\n");
            return;
        }

        CaelusIntelEvent ev{};
        if (!connector_detail::parse_intel_payload(
                body, connector_detail::kZapierSourceSlot, fns_, ev)) {
            send_response(cl, 422, "Unprocessable Entity", "invalid intel payload\n");
            return;
        }
        queue_.push(ev);
        send_response(cl, 202, "Accepted", "accepted\n");
    }
};

} // namespace caelus
