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
    /**
     * ScenarioPack replay için tick/saat oranı. 0 → eski davranış (dosya
     * metninde ilk "tick_minutes" araması). Motor, ayrıştırılmış ScenarioPack
     * değerini buraya yazar; böylece zamanlama ham metin aramasına değil,
     * imza kapısından geçmiş paket ayrıştırmasına dayanır.
     */
    uint64_t    ticks_per_hour_override = 0;

    /**
     * Çalışırken yeni bir kaynağa geçiş (REPL senaryo değişimi). Önceki
     * senaryonun olayları atılır; imleç sıfırlanır. init edilmemişse false.
     */
    bool reload(const char* new_source_path, uint64_t new_ticks_per_hour) noexcept {
        if (!fns_) return false;
        source_path = new_source_path;
        ticks_per_hour_override = new_ticks_per_hour;
        return do_init(fns_);
    }

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
        uint64_t ticks_per_hour = ticks_per_hour_override;
        if (ticks_per_hour == 0) {
            double tick_minutes_d = 15.0;
            json_number(content, "tick_minutes", tick_minutes_d);
            const uint64_t tick_minutes = tick_minutes_d > 0.0
                ? static_cast<uint64_t>(tick_minutes_d)
                : 15ULL;
            ticks_per_hour = tick_minutes ? (60ULL / tick_minutes) : 4ULL;
        }

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
//
// ── Signature layer (CAELUS_TRUSTED_INTEL_PUBKEY) ────────────────────────────
//
// On top of the transport token, the data plane supports asymmetric source
// authenticity (docs/INTEL_IMZA_SOZLESMESI.md — the FIELD-IDENTITY item from
// docs/GERCEK_DUNYA_GECIS_RAPORU.md §5):
//
//   CAELUS_TRUSTED_INTEL_PUBKEY set (64 hex = pinned ed25519 pubkey):
//     every intel message MUST start with the envelope line
//       #sig=ed25519:<64hex-pubkey>:<128hex-signature>\n
//     The signature covers the byte string
//       "CAELUS_INTEL_V1\n" || <every byte after that first newline>
//     (domain separation: an intel signature can never double as a scenario,
//     plugin, or mesh signature). The presented pubkey must match the pin
//     byte-for-byte BEFORE the signature is checked. Unsigned, malformed,
//     wrong-key, or bad-signature messages are rejected before parsing and
//     counted into intel_rejected_total() for the engine-thread audit trail.
//   CAELUS_TRUSTED_INTEL_PUBKEY unset:
//     legacy behaviour (token-only) with a single process-wide dev warning;
//     a stray #sig= line is still stripped so it cannot reach the graph.
//     CAELUS_PRODUCTION builds refuse to start live connectors without the
//     pin (do_init FATAL) — same fail-closed rule as the token.
//
// ed25519 math itself lives in the Rust staticlib. To preserve this header's
// "no Rust FFI linkage" property for header-only consumers (the connector
// smoke harness), verification goes through the intel_sig_verifier() hook:
// core_engine installs the real Rust verifier at bootstrap; test harnesses
// may install a stub. Pin set + no verifier installed = reject everything
// (fail-closed), never accept-by-default.

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

/** Constant-time fixed-length byte equality (for 32-byte Ed25519 pins). */
inline bool constant_time_bytes_equal(const uint8_t* a, const uint8_t* b,
                                      size_t n) noexcept {
    volatile unsigned char acc = 0u;
    for (size_t i = 0; i < n; ++i) {
        acc = static_cast<unsigned char>(acc | static_cast<unsigned char>(a[i] ^ b[i]));
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

// ── Intel signature-layer primitives (v1 single-pin + v2 slot manifest) ──────

/** Domain-separation prefix for v1 intel payload signatures (includes '\n'). */
static constexpr const char kIntelSigDomain[]   = "CAELUS_INTEL_V1\n";
/** Domain-separation prefix for v2 slot-bound intel signatures (includes '\n'). */
static constexpr const char kIntelSigDomainV2[] = "CAELUS_INTEL_V2\n";
/** Mandatory first-line envelope prefix when the v1 signature pin is active. */
static constexpr const char kIntelSigPrefix[]   = "#sig=ed25519:";
/** Mandatory first-line envelope prefix when the v2 source manifest is active. */
static constexpr const char kIntelSigPrefixV2[] = "#sig=ed25519v2:";
/** Hard upper bound on pinned sources in CAELUS_TRUSTED_INTEL_MANIFEST. */
static constexpr size_t kMaxIntelManifestSources = 256u;

/**
 * ed25519 verify hook. Matches the Rust caelus_verify_scenario_signature ABI:
 * returns 1 when sig64 is a valid signature of msg under pubkey32.
 * Installed once at bootstrap (engine thread) before any reader thread
 * starts; read-only afterwards, hence a plain atomic without further locking.
 */
using IntelSigVerifyFn = uint8_t (*)(const uint8_t* msg, size_t msg_len,
                                     const uint8_t* pubkey32, const uint8_t* sig64);

inline std::atomic<IntelSigVerifyFn>& intel_sig_verifier_slot() noexcept {
    static std::atomic<IntelSigVerifyFn> fn{nullptr};
    return fn;
}

inline void set_intel_sig_verifier(IntelSigVerifyFn fn) noexcept {
    intel_sig_verifier_slot().store(fn, std::memory_order_release);
}

/** Process-wide count of rejected intel messages (auth OR signature layer).
 *  Reader threads increment; the engine thread drains the delta into the
 *  audit chain after each dispatch_connectors() pass. */
inline std::atomic<uint64_t>& intel_rejected_total() noexcept {
    static std::atomic<uint64_t> total{0};
    return total;
}

inline int intel_hex_nibble(char c) noexcept {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

inline bool intel_hex_to_bytes(const char* hex, size_t hex_len,
                               uint8_t* out, size_t out_len) noexcept {
    if (!hex || !out || hex_len != out_len * 2u) return false;
    for (size_t i = 0; i < out_len; ++i) {
        const int hi = intel_hex_nibble(hex[i * 2u]);
        const int lo = intel_hex_nibble(hex[i * 2u + 1u]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

inline bool intel_hex16_to_u64(const char* hex, size_t hex_len,
                               uint64_t& slot_out) noexcept {
    if (!hex || hex_len != 16u) return false;
    uint64_t v = 0ULL;
    for (size_t i = 0; i < 16u; ++i) {
        const int nib = intel_hex_nibble(hex[i]);
        if (nib < 0) return false;
        v = (v << 4u) | static_cast<uint64_t>(nib);
    }
    if (v == 0ULL) return false;
    slot_out = v;
    return true;
}

inline std::string intel_u64_to_hex16_lower(uint64_t slot_id) {
    static constexpr const char kHex[] = "0123456789abcdef";
    std::string out(16u, '0');
    for (int i = 15; i >= 0; --i) {
        out[static_cast<size_t>(i)] = kHex[slot_id & 0xFu];
        slot_id >>= 4u;
    }
    return out;
}

/**
 * Parse a non-zero 64-bit source slot specification:
 *   - `0x<1..16 hex>` / `0X<1..16 hex>`
 *   - `<16 hex>` (canonical 64-bit hex slot ID)
 *   - `<1..20 decimal digits>` (when not 16-char hex with a..f)
 */
inline bool parse_intel_slot_spec(const std::string& raw_spec,
                                  uint64_t& slot_out) noexcept {
    const std::string s = trim(raw_spec);
    if (s.empty()) return false;

    if (s.size() > 2u && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        const size_t hex_len = s.size() - 2u;
        if (hex_len == 0u || hex_len > 16u) return false;
        uint64_t v = 0ULL;
        for (size_t i = 2u; i < s.size(); ++i) {
            const int nib = intel_hex_nibble(s[i]);
            if (nib < 0) return false;
            v = (v << 4u) | static_cast<uint64_t>(nib);
        }
        if (v == 0ULL) return false;
        slot_out = v;
        return true;
    }

    if (s.size() == 16u) {
        bool all_hex = true;
        for (char c : s) {
            if (intel_hex_nibble(c) < 0) { all_hex = false; break; }
        }
        if (all_hex) {
            return intel_hex16_to_u64(s.data(), 16u, slot_out);
        }
    }

    if (s.size() > 20u) return false;
    uint64_t v = 0ULL;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
        const uint64_t digit = static_cast<uint64_t>(c - '0');
        if (v > (std::numeric_limits<uint64_t>::max() - digit) / 10ULL) return false;
        v = v * 10ULL + digit;
    }
    if (v == 0ULL) return false;
    slot_out = v;
    return true;
}

/**
 * IntelSourceManifest — FIELD-IDENTITY v2 slot-to-pubkey pin table.
 *
 * Configured via `CAELUS_TRUSTED_INTEL_MANIFEST`:
 *   - Inline: `<slot_id>:<64hex_pubkey>[,;<slot_id>:<64hex_pubkey>...]`
 *   - File:   `@<path>` where each non-empty, non-`#` line is `<slot_id>:<64hex_pubkey>`
 *
 * Fail-closed: empty input, unreadable `@file`, malformed entries, `slot_id == 0`,
 * >256 sources, or duplicate `slot_id` with conflicting pubkeys all return `false`.
 */
struct IntelSourceManifest {
    std::vector<CaelusIntelSourceDescriptor> entries;

    void clear() noexcept { entries.clear(); }

    [[nodiscard]] bool empty() const noexcept { return entries.empty(); }

    [[nodiscard]] bool load_from_env_spec(const char* spec) noexcept {
        entries.clear();
        if (!spec || !spec[0]) return false;

        std::string text;
        const std::string trimmed_spec = trim(std::string(spec));
        if (trimmed_spec.empty()) return false;

        if (trimmed_spec[0] == '@') {
            const std::string path = trim(trimmed_spec.substr(1u));
            if (path.empty()) return false;
            std::ifstream in(path, std::ios::binary);
            if (!in.is_open()) return false;
            std::ostringstream ss;
            ss << in.rdbuf();
            if (in.bad()) return false;
            text = ss.str();
        } else {
            text = trimmed_spec;
        }

        return parse_text(text);
    }

    [[nodiscard]] bool parse_text(const std::string& text) noexcept {
        entries.clear();
        std::istringstream lines(text);
        std::string line;
        while (std::getline(lines, line)) {
            const std::string clean_line = trim(line);
            if (clean_line.empty() || clean_line[0] == '#') continue;

            size_t start = 0u;
            while (start <= clean_line.size()) {
                size_t sep = clean_line.find_first_of(",;", start);
                const std::string token = trim(
                    sep == std::string::npos
                        ? clean_line.substr(start)
                        : clean_line.substr(start, sep - start));
                if (!token.empty()) {
                    if (!add_token(token)) {
                        entries.clear();
                        return false;
                    }
                }
                if (sep == std::string::npos) break;
                start = sep + 1u;
            }
        }
        return !entries.empty();
    }

    /** Constant-time lookup verifying `(slot_id, pubkey32)` is pinned in this manifest. */
    [[nodiscard]] bool verify_slot_pubkey_ct(uint64_t slot_id,
                                             const uint8_t pubkey32[32]) const noexcept {
        if (slot_id == 0ULL || !pubkey32 || entries.empty()) return false;
        volatile unsigned char matched_any = 0u;
        for (const auto& entry : entries) {
            const uint64_t x = entry.source_slot_id ^ slot_id;
            unsigned char slot_diff = 0u;
            for (int b = 0; b < 8; ++b) {
                slot_diff = static_cast<unsigned char>(
                    slot_diff | static_cast<unsigned char>((x >> (b * 8)) & 0xFFu));
            }
            unsigned char key_diff = 0u;
            for (size_t i = 0; i < 32u; ++i) {
                key_diff = static_cast<unsigned char>(
                    key_diff | static_cast<unsigned char>(entry.pubkey[i] ^ pubkey32[i]));
            }
            const unsigned char both_equal =
                (slot_diff == 0u && key_diff == 0u) ? 1u : 0u;
            matched_any = static_cast<unsigned char>(matched_any | both_equal);
        }
        return matched_any != 0u;
    }

private:
    bool add_token(const std::string& token) noexcept {
        const size_t colon = token.find(':');
        if (colon == std::string::npos) return false;
        const std::string slot_part = trim(token.substr(0u, colon));
        const std::string rest = trim(token.substr(colon + 1u));
        const size_t second_colon = rest.find(':');
        const std::string pub_part =
            (second_colon == std::string::npos) ? rest : trim(rest.substr(0u, second_colon));

        uint64_t slot_id = 0ULL;
        uint8_t pub[32] = {};
        if (!parse_intel_slot_spec(slot_part, slot_id)) return false;
        if (!intel_hex_to_bytes(pub_part.data(), pub_part.size(), pub, 32u)) return false;

        uint32_t flags = 0u;
        if (second_colon != std::string::npos) {
            const std::string flags_part = trim(rest.substr(second_colon + 1u));
            if (flags_part.empty() || flags_part.find(':') != std::string::npos) return false;
            char* ep = nullptr;
            const unsigned long f = std::strtoul(flags_part.c_str(), &ep, 0);
            if (!ep || *ep != '\0' || f > 0xFFFFFFFFul) return false;
            flags = static_cast<uint32_t>(f);
        }

        for (const auto& existing : entries) {
            if (existing.source_slot_id == slot_id) {
                return constant_time_bytes_equal(existing.pubkey, pub, 32u) &&
                       existing.allowed_flags == flags;
            }
        }
        if (entries.size() >= kMaxIntelManifestSources) return false;

        CaelusIntelSourceDescriptor desc{};
        desc.source_slot_id = slot_id;
        std::memcpy(desc.pubkey, pub, 32u);
        desc.allowed_flags = flags;
        desc._reserved = 0u;
        entries.push_back(desc);
        return true;
    }
};

enum class IntelSigLine : uint8_t { kAbsent, kOk, kMalformed };
enum class IntelSigEnvelopeKind : uint8_t { kAbsent, kV1, kV2, kMalformed };

/**
 * Parse and strip either:
 *   - v1: `#sig=ed25519:<64hex-pub>:<128hex-sig>\n`
 *   - v2: `#sig=ed25519v2:<16hex-slot>:<64hex-pub>:<128hex-sig>\n`
 *
 * Any payload starting with `#sig` that does not match exact v1 or v2 framing
 * returns `kMalformed` and is rejected fail-closed.
 */
inline IntelSigEnvelopeKind extract_intel_sig_envelope(std::string& raw,
                                                       uint64_t& slot_out,
                                                       uint8_t pub_out[32],
                                                       uint8_t sig_out[64]) noexcept {
    slot_out = 0ULL;
    if (raw.compare(0, 4u, "#sig") != 0) return IntelSigEnvelopeKind::kAbsent;

    static constexpr size_t kV2PrefixLen = sizeof(kIntelSigPrefixV2) - 1u;
    static constexpr size_t kV1PrefixLen = sizeof(kIntelSigPrefix) - 1u;
    static constexpr size_t kSlotHex = 16u;
    static constexpr size_t kPubHex  = 64u;
    static constexpr size_t kSigHex  = 128u;

    if (raw.compare(0, kV2PrefixLen, kIntelSigPrefixV2) == 0) {
        const size_t slot_at   = kV2PrefixLen;
        const size_t colon1_at = slot_at + kSlotHex;
        const size_t pub_at    = colon1_at + 1u;
        const size_t colon2_at = pub_at + kPubHex;
        const size_t sig_at    = colon2_at + 1u;
        const size_t nl_at     = sig_at + kSigHex;
        if (raw.size() <= nl_at ||
            raw[colon1_at] != ':' ||
            raw[colon2_at] != ':' ||
            raw[nl_at] != '\n') {
            return IntelSigEnvelopeKind::kMalformed;
        }
        uint64_t parsed_slot = 0ULL;
        if (!intel_hex16_to_u64(raw.data() + slot_at, kSlotHex, parsed_slot) ||
            !intel_hex_to_bytes(raw.data() + pub_at, kPubHex, pub_out, 32u) ||
            !intel_hex_to_bytes(raw.data() + sig_at, kSigHex, sig_out, 64u)) {
            return IntelSigEnvelopeKind::kMalformed;
        }
        slot_out = parsed_slot;
        raw.erase(0, nl_at + 1u);
        return IntelSigEnvelopeKind::kV2;
    }

    if (raw.compare(0, kV1PrefixLen, kIntelSigPrefix) == 0) {
        const size_t pub_at   = kV1PrefixLen;
        const size_t colon_at = pub_at + kPubHex;
        const size_t sig_at   = colon_at + 1u;
        const size_t nl_at    = sig_at + kSigHex;
        if (raw.size() <= nl_at || raw[colon_at] != ':' || raw[nl_at] != '\n') {
            return IntelSigEnvelopeKind::kMalformed;
        }
        if (!intel_hex_to_bytes(raw.data() + pub_at, kPubHex, pub_out, 32u) ||
            !intel_hex_to_bytes(raw.data() + sig_at, kSigHex, sig_out, 64u)) {
            return IntelSigEnvelopeKind::kMalformed;
        }
        raw.erase(0, nl_at + 1u);
        return IntelSigEnvelopeKind::kV1;
    }

    return IntelSigEnvelopeKind::kMalformed;
}

/**
 * Parse and strip the v1 `#sig=ed25519:<pub>:<sig>` envelope line.
 * Preserved for direct v1 callers; v2 envelopes return kMalformed here because
 * v1 callers do not inspect `slot_id`.
 */
inline IntelSigLine extract_intel_sig_line(std::string& raw,
                                           uint8_t pub_out[32],
                                           uint8_t sig_out[64]) noexcept {
    uint64_t unused_slot = 0ULL;
    const IntelSigEnvelopeKind k =
        extract_intel_sig_envelope(raw, unused_slot, pub_out, sig_out);
    if (k == IntelSigEnvelopeKind::kAbsent) return IntelSigLine::kAbsent;
    if (k == IntelSigEnvelopeKind::kV1) return IntelSigLine::kOk;
    return IntelSigLine::kMalformed;
}

/**
 * Standalone ABI 1.2 helper for `CaelusEngineFns::verify_intel_source`:
 * verifies `(source_slot_id, pubkey32, sig64)` over `(msg, msg_len)` against an
 * active `IntelSourceManifest` and the installed Ed25519 verifier hook.
 */
inline bool verify_intel_source_against_manifest(const IntelSourceManifest& manifest,
                                                 uint64_t source_slot_id,
                                                 const uint8_t* msg,
                                                 size_t msg_len,
                                                 const uint8_t* pubkey32,
                                                 const uint8_t* sig64) noexcept {
    if (!msg || !pubkey32 || !sig64 || manifest.empty()) return false;
    if (!manifest.verify_slot_pubkey_ct(source_slot_id, pubkey32)) return false;
    const IntelSigVerifyFn verify =
        intel_sig_verifier_slot().load(std::memory_order_acquire);
    if (!verify) return false;
    return verify(msg, msg_len, pubkey32, sig64) == 1u;
}

/**
 * IntelAuthGate — per-connector intel data-plane auth policy.
 *
 * Layer 1: ed25519 source signature:
 *   - v2 (preferred): `CAELUS_TRUSTED_INTEL_MANIFEST` (`slot_id -> pubkey` pin table,
 *     wire envelope `#sig=ed25519v2:<16hex-slot>:<64hex-pub>:<128hex-sig>\n` over
 *     `"CAELUS_INTEL_V2\n" || <16hex-slot> || "\n" || <body>`).
 *   - v1 (backward-compatible): `CAELUS_TRUSTED_INTEL_PUBKEY` (single 64-hex pin,
 *     wire envelope `#sig=ed25519:<64hex-pub>:<128hex-sig>\n` over
 *     `"CAELUS_INTEL_V1\n" || <body>`).
 * Layer 2: shared transport token (`CAELUS_INTEL_TOKEN`).
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

        manifest_.clear();
        std::memset(pin_, 0, sizeof(pin_));
        pin_state_ = PinState::kUnset;

        const char* manifest_spec = std::getenv("CAELUS_TRUSTED_INTEL_MANIFEST");
        const char* pin_hex = std::getenv("CAELUS_TRUSTED_INTEL_PUBKEY");

        // Validate v1 pin syntax even if manifest is also set so broken env
        // configuration never goes unnoticed.
        bool v1_syntax_bad = false;
        if (pin_hex && pin_hex[0]) {
            if (!intel_hex_to_bytes(pin_hex, std::strlen(pin_hex), pin_, 32u)) {
                v1_syntax_bad = true;
            }
        }

        if (manifest_spec && manifest_spec[0]) {
            if (v1_syntax_bad || !manifest_.load_from_env_spec(manifest_spec)) {
                pin_state_ = PinState::kInvalid;
                std::cerr << "[CONN-AUTH] HATA: CAELUS_TRUSTED_INTEL_MANIFEST "
                             "gecersiz/okunamadi; tum intel payload'lari "
                             "reddedilecek (kanal=" << channel_ << ")\n";
            } else {
                pin_state_ = PinState::kPinnedManifestV2;
            }
        } else if (pin_hex && pin_hex[0]) {
            // A present-but-unparseable pin is a configuration error, never a
            // downgrade to unsigned: the gate stays fail-closed (kInvalid).
            pin_state_ = v1_syntax_bad ? PinState::kInvalid : PinState::kPinnedV1;
            if (pin_state_ == PinState::kInvalid) {
                std::cerr << "[CONN-AUTH] HATA: CAELUS_TRUSTED_INTEL_PUBKEY 64 hex "
                             "degil; tum intel payload'lari reddedilecek (kanal="
                          << channel_ << ")\n";
            }
        }
#ifndef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION'da derleme-dışı: token'sız/pin'siz "uyar ve kabul et"
        // miras yolu üretimde yoktur; eksikliği connector do_init FATAL'e çevirir.
        if (token_.empty()) warn_unauthenticated_once();
        if (pin_state_ == PinState::kUnset) warn_unsigned_once();
#endif
    }

    [[nodiscard]] bool enabled() const noexcept { return !token_.empty(); }

    /** True when the ed25519 signature layer is active (v1 pin, v2 manifest, or invalid fail-closed). */
    [[nodiscard]] bool sig_enabled() const noexcept {
        return pin_state_ != PinState::kUnset;
    }

    /** True ONLY when a valid v1 pubkey pin or v2 source manifest is loaded. */
    [[nodiscard]] bool sig_ready() const noexcept {
        return pin_state_ == PinState::kPinnedV1 ||
               pin_state_ == PinState::kPinnedManifestV2;
    }

    /** Constant-time check for transport-level auth (Zapier X-Caelus-Auth). */
    [[nodiscard]] bool header_matches(const std::string& presented) const noexcept {
        return enabled() && !presented.empty() && constant_time_equal(presented, token_);
    }

    /**
     * Validate and strip in-payload auth material.
     * Returns false when the message must be rejected (never parsed/injected).
     * When `CAELUS_TRUSTED_INTEL_MANIFEST` (v2) is active and `verified_slot_out`
     * is non-null, writes the cryptographically authenticated `source_slot_id`.
     */
    [[nodiscard]] bool admit(std::string& raw,
                             bool transport_authenticated,
                             uint64_t* verified_slot_out = nullptr) noexcept {
        if (verified_slot_out) *verified_slot_out = 0ULL;
        uint64_t verified_slot_local = 0ULL;

        // Layer 1 — source signature. Independent of the transport token:
        // a valid X-Caelus-Auth header proves link access, not authorship.
        if (sig_enabled()) {
            if (pin_state_ == PinState::kInvalid) { note_rejected(); return false; }

            uint64_t env_slot = 0ULL;
            uint8_t pub[32];
            uint8_t sig[64];
            const IntelSigEnvelopeKind kind =
                extract_intel_sig_envelope(raw, env_slot, pub, sig);

            const IntelSigVerifyFn verify =
                intel_sig_verifier_slot().load(std::memory_order_acquire);

            if (pin_state_ == PinState::kPinnedManifestV2) {
                // v2 manifest requires v2 slot-bound envelope (v1 downgrade forbidden).
                if (kind != IntelSigEnvelopeKind::kV2) {
                    note_rejected();
                    return false;
                }
                if (!manifest_.verify_slot_pubkey_ct(env_slot, pub)) {
                    note_rejected();
                    return false;
                }
                if (!verify) {
                    note_rejected();
                    std::cerr << "[CONN-AUTH] HATA: imza dogrulayicisi kurulmamis "
                                 "(set_intel_sig_verifier); payload reddedildi (kanal="
                              << channel_ << ")\n";
                    return false;
                }
                const std::string slot_hex16 = intel_u64_to_hex16_lower(env_slot);
                std::string msg;
                msg.reserve((sizeof(kIntelSigDomainV2) - 1u) + 17u + raw.size());
                msg.append(kIntelSigDomainV2, sizeof(kIntelSigDomainV2) - 1u);
                msg.append(slot_hex16);
                msg.push_back('\n');
                msg.append(raw);
                if (verify(reinterpret_cast<const uint8_t*>(msg.data()), msg.size(),
                           pub, sig) != 1u) {
                    note_rejected();
                    return false;
                }
                verified_slot_local = env_slot;
            } else {
                // PinState::kPinnedV1 — exact backward-compatible v1 behaviour.
                if (kind != IntelSigEnvelopeKind::kV1) {
                    note_rejected();
                    return false;
                }
                if (!constant_time_bytes_equal(pub, pin_, 32u)) {
                    note_rejected();
                    return false;
                }
                if (!verify) {
                    // Pin configured but no verifier wired: fail closed, loudly.
                    note_rejected();
                    std::cerr << "[CONN-AUTH] HATA: imza dogrulayicisi kurulmamis "
                                 "(set_intel_sig_verifier); payload reddedildi (kanal="
                              << channel_ << ")\n";
                    return false;
                }
                std::string msg;
                msg.reserve(sizeof(kIntelSigDomain) - 1u + raw.size());
                msg.append(kIntelSigDomain, sizeof(kIntelSigDomain) - 1u);
                msg.append(raw);
                if (verify(reinterpret_cast<const uint8_t*>(msg.data()), msg.size(),
                           pub, sig) != 1u) {
                    note_rejected();
                    return false;
                }
            }
        } else {
            // Hygiene: a stray envelope on an unsigned channel must not flow
            // into memo fields; malformed envelopes are still rejected.
            uint64_t unused_slot = 0ULL;
            uint8_t pub[32];
            uint8_t sig[64];
            if (extract_intel_sig_envelope(raw, unused_slot, pub, sig) ==
                IntelSigEnvelopeKind::kMalformed) {
                note_rejected();
                return false;
            }
        }

        // Layer 2 — shared transport token (unchanged legacy behaviour).
        const size_t first = raw.find_first_not_of(" \t\r\n");
        const bool is_json = (first != std::string::npos && raw[first] == '{');

        if (!enabled() || transport_authenticated) {
            strip_payload_auth(raw, is_json);
            if (verified_slot_out) *verified_slot_out = verified_slot_local;
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
        if (verified_slot_out) *verified_slot_out = verified_slot_local;
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
    enum class PinState : uint8_t { kUnset, kPinnedV1, kPinnedManifestV2, kInvalid };

    std::string token_;
    uint8_t pin_[32] = {};
    IntelSourceManifest manifest_{};
    PinState pin_state_ = PinState::kUnset;
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

    // CAELUS_PRODUCTION'da derleme-dışı: imzasız-kabul uyarısı yalnız dev/demo build'inde anlamlıdır.
    static void warn_unsigned_once() noexcept {
        static std::atomic<bool> warned{false};
        bool expected = false;
        if (warned.compare_exchange_strong(expected, true)) {
            std::cerr << "[CONN-AUTH] UYARI: intel imza pini yok "
                         "(CAELUS_TRUSTED_INTEL_PUBKEY set degil); payload "
                         "kaynak imzasi dogrulanmiyor.\n";
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
        intel_rejected_total().fetch_add(1u, std::memory_order_relaxed);
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
                                CaelusIntelEvent& ev,
                                bool slot_locked = false) noexcept {
    if (raw.empty() || raw.size() > kMaxPayloadBytes) return false;

    const std::string body = trim(raw);
    if (body.empty()) return false;

    double coeff = 0.0;
    int crisis = 0;
    std::string memo;
    bool has_coeff = false;

    if (body[0] == '{') {
        if (slot_locked && body.find("\"source_slot_id\"") != std::string::npos) {
            const std::string body_slot_str = json_string(body, "source_slot_id");
            uint64_t body_slot = 0ULL;
            if (!body_slot_str.empty()) {
                if (!parse_intel_slot_spec(body_slot_str, body_slot) ||
                    body_slot != source_slot) {
                    return false;
                }
            } else {
                double slot_num = -1.0;
                if (!json_number(body, "source_slot_id", slot_num) ||
                    slot_num <= 0.0 ||
                    static_cast<uint64_t>(slot_num) != source_slot) {
                    return false;
                }
            }
        }
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
 * token ("auth" JSON member or "#auth=" CSV first line); when
 * CAELUS_TRUSTED_INTEL_PUBKEY is set, each payload must additionally open with
 * a valid pinned "#sig=ed25519:..." envelope line. See IntelAuthGate.
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
        if (!auth_.sig_ready()) {
            std::cerr << "[CONN-AUTH] FATAL: CAELUS_TRUSTED_INTEL_MANIFEST veya "
                         "CAELUS_TRUSTED_INTEL_PUBKEY gecerli degil — "
                         "MqttConnector uretim derlemesinde (CAELUS_PRODUCTION) "
                         "imzasiz/gecersiz intel veri duzlemiyle baslatilmiyor.\n";
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
        uint64_t verified_slot = 0ULL;
        if (!auth_.admit(payload, /*transport_authenticated=*/false, &verified_slot)) return;

        const uint64_t effective_slot =
            (verified_slot != 0ULL) ? verified_slot : connector_detail::kMqttSourceSlot;
        CaelusIntelEvent ev{};
        if (connector_detail::parse_intel_payload(
                payload, effective_slot, fns_, ev, verified_slot != 0ULL)) {
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
 * "#auth=" CSV first line); failures answer 401. When
 * CAELUS_TRUSTED_INTEL_PUBKEY is set, each body must additionally open with a
 * valid pinned "#sig=ed25519:..." envelope line. See IntelAuthGate.
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
        if (!auth_.sig_ready()) {
            std::cerr << "[CONN-AUTH] FATAL: CAELUS_TRUSTED_INTEL_MANIFEST veya "
                         "CAELUS_TRUSTED_INTEL_PUBKEY gecerli degil — "
                         "ZapierWebhookConnector uretim derlemesinde (CAELUS_PRODUCTION) "
                         "imzasiz/gecersiz intel veri duzlemiyle baslatilmiyor.\n";
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
        uint64_t verified_slot = 0ULL;
        if (!auth_.admit(body, header_ok, &verified_slot)) {
            send_response(cl, 401, "Unauthorized", "unauthorized\n");
            return;
        }

        const uint64_t effective_slot =
            (verified_slot != 0ULL) ? verified_slot : connector_detail::kZapierSourceSlot;
        CaelusIntelEvent ev{};
        if (!connector_detail::parse_intel_payload(
                body, effective_slot, fns_, ev, verified_slot != 0ULL)) {
            send_response(cl, 422, "Unprocessable Entity", "invalid intel payload\n");
            return;
        }
        queue_.push(ev);
        send_response(cl, 202, "Accepted", "accepted\n");
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar Airlock v2 (`CAELUS_INTEL_V2`) Header-Only Verifier & File Connector
// ─────────────────────────────────────────────────────────────────────────────
//
// Implements PR-1 Sidecar Airlock (§1–§3.4, §5):
//   • Pure C++17 CC0 BLAKE3 plain digest (zero external crates/libs).
//   • `AirlockSourceManifestV2` (`source_manifest.json` parser with constant-time
//     `pubkey` matching, `key_id`, `expires_at_ms`, `allowed_event_kinds`,
//     `independence_group`, `origin_class`, and `legacy_v1_pubkey`).
//   • `v1` (`CAELUS_INTEL_V1` -> `LEGACY_UNSCOPED`) and `v2` (`CAELUS_INTEL_V2`
//     single-line `.airlock.ndjson` + 5-line wire format) envelope router.
//   • `AirlockFileConnector`: deterministic offline `.airlock.ndjson` reader via
//     `pull_intel()` with `O(log N)` binary search on sorted `learned_at_ms`,
//     total tie-breaking order, idempotent duplicate suppression, and fail-closed
//     per-packet rejection (`intel_rejected_total()`).

namespace airlock_detail {

static constexpr int64_t kAirlockFpScale = 1000000LL;
static constexpr int64_t kAirlockSafeMaxAbs = (1LL << 62);

inline uint32_t blake3_rotr32(uint32_t x, unsigned n) noexcept {
    return (x >> n) | (x << (32u - n));
}

inline void blake3_g(uint32_t s[16], size_t a, size_t b, size_t c, size_t d,
                     uint32_t mx, uint32_t my) noexcept {
    s[a] = s[a] + s[b] + mx;
    s[d] = blake3_rotr32(s[d] ^ s[a], 16u);
    s[c] = s[c] + s[d];
    s[b] = blake3_rotr32(s[b] ^ s[c], 12u);
    s[a] = s[a] + s[b] + my;
    s[d] = blake3_rotr32(s[d] ^ s[a], 8u);
    s[c] = s[c] + s[d];
    s[b] = blake3_rotr32(s[b] ^ s[c], 7u);
}

inline void blake3_round(uint32_t s[16], const uint32_t m[16]) noexcept {
    blake3_g(s, 0, 4, 8, 12, m[0], m[1]);
    blake3_g(s, 1, 5, 9, 13, m[2], m[3]);
    blake3_g(s, 2, 6, 10, 14, m[4], m[5]);
    blake3_g(s, 3, 7, 11, 15, m[6], m[7]);
    blake3_g(s, 0, 5, 10, 15, m[8], m[9]);
    blake3_g(s, 1, 6, 11, 12, m[10], m[11]);
    blake3_g(s, 2, 7, 8, 13, m[12], m[13]);
    blake3_g(s, 3, 4, 9, 14, m[14], m[15]);
}

inline void blake3_compress(const uint32_t cv[8], const uint32_t block_words[16],
                            uint64_t counter, uint32_t block_len, uint32_t flags,
                            uint32_t out16[16]) noexcept {
    static constexpr uint32_t kIv[4] = {
        0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au
    };
    static constexpr uint8_t kPerm[16] = {
        2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8
    };
    uint32_t state[16] = {
        cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
        kIv[0], kIv[1], kIv[2], kIv[3],
        static_cast<uint32_t>(counter & 0xFFFFFFFFULL),
        static_cast<uint32_t>((counter >> 32u) & 0xFFFFFFFFULL),
        block_len, flags
    };
    uint32_t m[16];
    std::memcpy(m, block_words, sizeof(m));
    for (int r = 0; r < 7; ++r) {
        blake3_round(state, m);
        if (r < 6) {
            uint32_t next_m[16];
            for (size_t i = 0; i < 16u; ++i) next_m[i] = m[kPerm[i]];
            std::memcpy(m, next_m, sizeof(m));
        }
    }
    for (size_t i = 0; i < 8u; ++i) {
        out16[i] = state[i] ^ state[i + 8u];
        out16[i + 8u] = state[i + 8u] ^ cv[i];
    }
}

inline void blake3_words_from_block(const uint8_t* block, size_t len,
                                    uint32_t out_words[16]) noexcept {
    uint8_t padded[64] = {};
    if (block && len > 0) {
        std::memcpy(padded, block, len > 64u ? 64u : len);
    }
    for (size_t i = 0; i < 16u; ++i) {
        const size_t o = i * 4u;
        out_words[i] = static_cast<uint32_t>(padded[o]) |
                       (static_cast<uint32_t>(padded[o + 1u]) << 8u) |
                       (static_cast<uint32_t>(padded[o + 2u]) << 16u) |
                       (static_cast<uint32_t>(padded[o + 3u]) << 24u);
    }
}

struct Blake3Output {
    uint32_t input_cv[8] = {};
    uint32_t block_words[16] = {};
    uint64_t counter = 0;
    uint32_t block_len = 0;
    uint32_t flags = 0;

    void chaining_value(uint32_t out_cv[8]) const noexcept {
        uint32_t full[16];
        blake3_compress(input_cv, block_words, counter, block_len, flags, full);
        std::memcpy(out_cv, full, 8u * sizeof(uint32_t));
    }

    void root_bytes32(uint8_t out32[32]) const noexcept {
        uint32_t full[16];
        blake3_compress(input_cv, block_words, 0ULL, block_len, flags | 8u, full);
        for (size_t i = 0; i < 8u; ++i) {
            out32[i * 4u]      = static_cast<uint8_t>(full[i] & 0xFFu);
            out32[i * 4u + 1u] = static_cast<uint8_t>((full[i] >> 8u) & 0xFFu);
            out32[i * 4u + 2u] = static_cast<uint8_t>((full[i] >> 16u) & 0xFFu);
            out32[i * 4u + 3u] = static_cast<uint8_t>((full[i] >> 24u) & 0xFFu);
        }
    }
};

struct Blake3ChunkState {
    uint32_t cv[8] = {
        0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au,
        0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u
    };
    uint64_t chunk_counter = 0;
    uint8_t block[64] = {};
    size_t block_len = 0;
    size_t blocks_compressed = 0;

    [[nodiscard]] size_t length() const noexcept {
        return 64u * blocks_compressed + block_len;
    }

    [[nodiscard]] uint32_t start_flag() const noexcept {
        return blocks_compressed == 0u ? 1u : 0u;
    }

    void update(const uint8_t* data, size_t len) noexcept {
        size_t pos = 0;
        while (pos < len) {
            if (block_len == 64u) {
                uint32_t words[16];
                uint32_t full[16];
                blake3_words_from_block(block, 64u, words);
                blake3_compress(cv, words, chunk_counter, 64u, start_flag(), full);
                std::memcpy(cv, full, 8u * sizeof(uint32_t));
                ++blocks_compressed;
                block_len = 0;
            }
            const size_t take = std::min<size_t>(64u - block_len, len - pos);
            std::memcpy(block + block_len, data + pos, take);
            block_len += take;
            pos += take;
        }
    }

    [[nodiscard]] Blake3Output output() const noexcept {
        Blake3Output o{};
        std::memcpy(o.input_cv, cv, sizeof(cv));
        blake3_words_from_block(block, block_len, o.block_words);
        o.counter = chunk_counter;
        o.block_len = static_cast<uint32_t>(block_len);
        o.flags = start_flag() | 2u;
        return o;
    }
};

inline Blake3Output blake3_parent_output(const uint32_t left_cv[8],
                                         const uint32_t right_cv[8]) noexcept {
    static constexpr uint32_t kIv[8] = {
        0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au,
        0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u
    };
    Blake3Output o{};
    std::memcpy(o.input_cv, kIv, sizeof(kIv));
    std::memcpy(o.block_words, left_cv, 8u * sizeof(uint32_t));
    std::memcpy(o.block_words + 8u, right_cv, 8u * sizeof(uint32_t));
    o.counter = 0ULL;
    o.block_len = 64u;
    o.flags = 4u;
    return o;
}

inline void blake3_hash32(const uint8_t* data, size_t len, uint8_t out32[32]) noexcept {
    Blake3ChunkState chunk{};
    uint32_t cv_stack[54][8] = {};
    size_t stack_len = 0;
    uint64_t total_chunks = 0;

    size_t pos = 0;
    while (pos < len) {
        if (chunk.length() == 1024u) {
            uint32_t new_cv[8];
            chunk.output().chaining_value(new_cv);
            ++total_chunks;
            uint64_t tc = total_chunks;
            while ((tc & 1ULL) == 0ULL && stack_len > 0) {
                --stack_len;
                Blake3Output parent = blake3_parent_output(cv_stack[stack_len], new_cv);
                parent.chaining_value(new_cv);
                tc >>= 1u;
            }
            std::memcpy(cv_stack[stack_len++], new_cv, sizeof(new_cv));
            chunk = Blake3ChunkState{};
            chunk.chunk_counter = total_chunks;
        }
        const size_t take = std::min<size_t>(1024u - chunk.length(), len - pos);
        chunk.update(data + pos, take);
        pos += take;
    }

    Blake3Output out = chunk.output();
    while (stack_len > 0) {
        --stack_len;
        uint32_t right_cv[8];
        out.chaining_value(right_cv);
        out = blake3_parent_output(cv_stack[stack_len], right_cv);
    }
    out.root_bytes32(out32);
}

inline std::string blake3_hex(const std::string& s) {
    static constexpr const char kHex[] = "0123456789abcdef";
    uint8_t digest[32];
    blake3_hash32(reinterpret_cast<const uint8_t*>(s.data()), s.size(), digest);
    std::string out(64u, '0');
    for (size_t i = 0; i < 32u; ++i) {
        out[i * 2u]      = kHex[(digest[i] >> 4u) & 0xFu];
        out[i * 2u + 1u] = kHex[digest[i] & 0xFu];
    }
    return out;
}

inline bool parse_i64_decimal_strict(const std::string& s, int64_t& out) noexcept {
    if (s.empty()) return false;
    size_t pos = 0;
    bool neg = false;
    if (s[0] == '-') {
        neg = true;
        pos = 1u;
    }
    const size_t digits = s.size() - pos;
    if (digits == 0u || digits > 19u) return false;
    if (digits > 1u && s[pos] == '0') return false;
    uint64_t acc = 0ULL;
    const uint64_t limit = neg
        ? (static_cast<uint64_t>(std::numeric_limits<int64_t>::max()) + 1ULL)
        : static_cast<uint64_t>(std::numeric_limits<int64_t>::max());
    for (size_t i = pos; i < s.size(); ++i) {
        const char c = s[i];
        if (c < '0' || c > '9') return false;
        const uint64_t d = static_cast<uint64_t>(c - '0');
        if (acc > (limit - d) / 10ULL) return false;
        acc = acc * 10ULL + d;
    }
    if (neg) {
        if (acc == limit) out = std::numeric_limits<int64_t>::min();
        else out = -static_cast<int64_t>(acc);
    } else {
        out = static_cast<int64_t>(acc);
    }
    return true;
}

inline bool parse_u64_decimal_strict(const std::string& s, uint64_t& out) noexcept {
    if (s.empty() || s.size() > 20u) return false;
    if (s.size() > 1u && s[0] == '0') return false;
    uint64_t acc = 0ULL;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
        const uint64_t d = static_cast<uint64_t>(c - '0');
        if (acc > (std::numeric_limits<uint64_t>::max() - d) / 10ULL) return false;
        acc = acc * 10ULL + d;
    }
    out = acc;
    return true;
}

inline bool is_safe_airlock_fp(int64_t fp_val) noexcept {
    if (fp_val == std::numeric_limits<int64_t>::min()) return false;
    const int64_t mag = fp_val < 0 ? -fp_val : fp_val;
    return mag <= kAirlockSafeMaxAbs;
}

/** Locate a top-level key in JSON object `obj` (depth == 1), returning value start index. */
inline bool json_find_top_level_value(const std::string& obj,
                                      const char* key,
                                      size_t& val_pos_out) noexcept {
    val_pos_out = std::string::npos;
    size_t i = 0;
    while (i < obj.size() && connector_detail::is_ws_char(obj[i])) ++i;
    if (i >= obj.size() || obj[i] != '{') return false;
    ++i;

    int depth = 1;
    while (i < obj.size() && depth > 0) {
        while (i < obj.size() && (connector_detail::is_ws_char(obj[i]) || (depth == 1 && obj[i] == ','))) ++i;
        if (i >= obj.size()) return false;
        if (depth == 1 && obj[i] == '}') return false;

        if (depth == 1) {
            if (obj[i] != '"') return false;
            ++i;
            std::string cur_key;
            bool closed = false;
            while (i < obj.size()) {
                const char c = obj[i++];
                if (c == '"') { closed = true; break; }
                if (c == '\\') {
                    if (i >= obj.size()) return false;
                    cur_key.push_back(obj[i++]);
                } else {
                    cur_key.push_back(c);
                }
            }
            if (!closed) return false;
            while (i < obj.size() && connector_detail::is_ws_char(obj[i])) ++i;
            if (i >= obj.size() || obj[i] != ':') return false;
            ++i;
            while (i < obj.size() && connector_detail::is_ws_char(obj[i])) ++i;
            if (i >= obj.size()) return false;
            if (cur_key == key) {
                val_pos_out = i;
                return true;
            }
            // Skip this value at depth == 1
            if (obj[i] == '"') {
                ++i;
                while (i < obj.size()) {
                    const char c = obj[i++];
                    if (c == '"') break;
                    if (c == '\\' && i < obj.size()) ++i;
                }
            } else if (obj[i] == '{' || obj[i] == '[') {
                ++depth;
                ++i;
            } else {
                while (i < obj.size() && obj[i] != ',' && obj[i] != '}') ++i;
            }
        } else {
            const char c = obj[i++];
            if (c == '"') {
                while (i < obj.size()) {
                    const char sc = obj[i++];
                    if (sc == '"') break;
                    if (sc == '\\' && i < obj.size()) ++i;
                }
            } else if (c == '{' || c == '[') {
                ++depth;
            } else if (c == '}' || c == ']') {
                --depth;
            }
        }
    }
    return false;
}

inline bool json_has_top_level_key(const std::string& obj, const char* key) noexcept {
    size_t pos = std::string::npos;
    return json_find_top_level_value(obj, key, pos);
}

/** Check whether top-level `"key"` in JSON `obj` is strictly a quoted string `"..."` (64-bit JSON rule). */
inline bool json_strict_quoted_string(const std::string& obj, const char* key,
                                      std::string& out) {
    out.clear();
    size_t pos = std::string::npos;
    if (!json_find_top_level_value(obj, key, pos)) return false;
    if (pos >= obj.size() || obj[pos] != '"') return false;
    ++pos;
    while (pos < obj.size()) {
        const char c = obj[pos++];
        if (c == '"') return true;
        if (c == '\\') {
            if (pos >= obj.size()) return false;
            const char esc = obj[pos++];
            switch (esc) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\x08'); break;
                case 'f': out.push_back('\x0c'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    if (pos + 4u > obj.size()) return false;
                    uint32_t cp = 0u;
                    for (size_t k = 0; k < 4u; ++k) {
                        const int nib = connector_detail::intel_hex_nibble(obj[pos + k]);
                        if (nib < 0) return false;
                        cp = (cp << 4u) | static_cast<uint32_t>(nib);
                    }
                    pos += 4u;
                    if (cp <= 0x7Fu) {
                        out.push_back(static_cast<char>(cp));
                    } else if (cp <= 0x7FFu) {
                        out.push_back(static_cast<char>(0xC0u | ((cp >> 6u) & 0x1Fu)));
                        out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
                    } else {
                        out.push_back(static_cast<char>(0xE0u | ((cp >> 12u) & 0x0Fu)));
                        out.push_back(static_cast<char>(0x80u | ((cp >> 6u) & 0x3Fu)));
                        out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
                    }
                    break;
                }
                default: return false;
            }
        } else {
            out.push_back(c);
        }
    }
    return false;
}

inline bool json_bool_field(const std::string& obj, const char* key, bool default_val) noexcept {
    size_t pos = std::string::npos;
    if (!json_find_top_level_value(obj, key, pos)) return default_val;
    if (obj.compare(pos, 4u, "true") == 0) return true;
    if (obj.compare(pos, 5u, "false") == 0) return false;
    return default_val;
}

inline bool json_is_null_field(const std::string& obj, const char* key) noexcept {
    size_t pos = std::string::npos;
    if (!json_find_top_level_value(obj, key, pos)) return false;
    return obj.compare(pos, 4u, "null") == 0;
}

inline bool json_strict_int_field(const std::string& obj, const char* key, int64_t& out) noexcept {
    size_t pos = std::string::npos;
    if (!json_find_top_level_value(obj, key, pos)) return false;
    if (pos >= obj.size() || obj[pos] == '"') return false;
    size_t end = pos;
    while (end < obj.size() && obj[end] != ',' && obj[end] != '}' &&
           !connector_detail::is_ws_char(obj[end])) {
        ++end;
    }
    return parse_i64_decimal_strict(obj.substr(pos, end - pos), out);
}

inline std::vector<std::string> json_string_array_field(const std::string& obj,
                                                        const char* key) {
    std::vector<std::string> items;
    size_t pos = std::string::npos;
    if (!json_find_top_level_value(obj, key, pos)) return items;
    if (pos >= obj.size() || obj[pos] != '[') return items;
    ++pos;
    while (pos < obj.size()) {
        while (pos < obj.size() && (connector_detail::is_ws_char(obj[pos]) || obj[pos] == ',')) ++pos;
        if (pos >= obj.size() || obj[pos] == ']') break;
        if (obj[pos] != '"') break;
        ++pos;
        std::string cur;
        while (pos < obj.size()) {
            const char c = obj[pos++];
            if (c == '"') break;
            if (c == '\\' && pos < obj.size()) cur.push_back(obj[pos++]);
            else cur.push_back(c);
        }
        items.push_back(cur);
    }
    return items;
}

inline uint64_t fnv1a64_str(const std::string& s) noexcept {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (unsigned char c : s) {
        h ^= static_cast<uint64_t>(c);
        h *= 0x100000001b3ULL;
    }
    return (h == 0ULL) ? 1ULL : h;
}

struct AirlockSourceEntryV2 {
    std::string source_id;
    std::string key_id;
    std::string independence_group;
    uint8_t pubkey[32] = {};
    std::vector<std::string> allowed_event_kinds;
    uint32_t origin_class = 0u; // 0=CALIBRATED_SENSOR, 1=HUMAN_OPERATOR, 2=MODEL_OR_AGENT
    int64_t expires_at_ms = -1;
};

struct AirlockSourceManifestV2 {
    bool require_v2_airlock = true;
    bool has_legacy_v1_pubkey = false;
    uint8_t legacy_v1_pubkey[32] = {};
    std::vector<AirlockSourceEntryV2> sources;

    void clear() noexcept {
        require_v2_airlock = true;
        has_legacy_v1_pubkey = false;
        std::memset(legacy_v1_pubkey, 0, sizeof(legacy_v1_pubkey));
        sources.clear();
    }

    [[nodiscard]] bool load_from_file(const std::string& path) noexcept {
        clear();
        std::ifstream in(path, std::ios::binary);
        if (!in.is_open()) return false;
        std::ostringstream ss;
        ss << in.rdbuf();
        if (in.bad()) return false;
        return parse_json(ss.str());
    }

    [[nodiscard]] bool parse_json(const std::string& json) noexcept {
        clear();
        std::string ver;
        if (json_strict_quoted_string(json, "manifest_version", ver) && ver != "2.0") {
            return false;
        }
        require_v2_airlock = json_bool_field(json, "require_v2_airlock", true);

        std::string legacy_hex;
        if (json_strict_quoted_string(json, "legacy_v1_pubkey", legacy_hex) && !legacy_hex.empty()) {
            if (!connector_detail::intel_hex_to_bytes(
                    legacy_hex.data(), legacy_hex.size(), legacy_v1_pubkey, 32u)) {
                return false;
            }
            has_legacy_v1_pubkey = true;
        }

        const size_t src_pos = json.find("\"sources\"");
        if (src_pos == std::string::npos) return false;
        const size_t arr_pos = json.find('[', src_pos);
        if (arr_pos == std::string::npos) return false;

        int depth = 0;
        size_t obj_start = std::string::npos;
        bool in_str = false;
        bool esc = false;
        for (size_t i = arr_pos + 1u; i < json.size(); ++i) {
            const char c = json[i];
            if (esc) { esc = false; continue; }
            if (in_str) {
                if (c == '\\') esc = true;
                else if (c == '"') in_str = false;
                continue;
            }
            if (c == '"') in_str = true;
            else if (c == '{') {
                if (depth == 0) obj_start = i;
                ++depth;
            } else if (c == '}') {
                if (depth > 0) --depth;
                if (depth == 0 && obj_start != std::string::npos) {
                    const std::string item = json.substr(obj_start, i - obj_start + 1u);
                    AirlockSourceEntryV2 entry{};
                    std::string pk_hex;
                    if (!json_strict_quoted_string(item, "source_id", entry.source_id) ||
                        !json_strict_quoted_string(item, "key_id", entry.key_id) ||
                        !json_strict_quoted_string(item, "pubkey", pk_hex) ||
                        !json_strict_quoted_string(item, "independence_group", entry.independence_group) ||
                        entry.source_id.empty() || entry.key_id.empty() || entry.independence_group.empty() ||
                        !connector_detail::intel_hex_to_bytes(pk_hex.data(), pk_hex.size(), entry.pubkey, 32u)) {
                        clear();
                        return false;
                    }
                    entry.allowed_event_kinds = json_string_array_field(item, "allowed_event_kinds");
                    if (entry.allowed_event_kinds.empty()) {
                        clear();
                        return false;
                    }
                    std::string origin_str;
                    if (json_strict_quoted_string(item, "origin_class", origin_str)) {
                        if (origin_str == "CALIBRATED_SENSOR" || origin_str == "SENSOR") entry.origin_class = 0u;
                        else if (origin_str == "HUMAN_OPERATOR" || origin_str == "OPERATOR") entry.origin_class = 1u;
                        else if (origin_str == "MODEL_OR_AGENT" || origin_str == "MODEL" || origin_str == "AGENT") entry.origin_class = 2u;
                        else { clear(); return false; }
                    }
                    if (json_has_top_level_key(item, "expires_at_ms") &&
                        !json_is_null_field(item, "expires_at_ms")) {
                        std::string exp_s;
                        if (!json_strict_quoted_string(item, "expires_at_ms", exp_s) ||
                            !parse_i64_decimal_strict(exp_s, entry.expires_at_ms)) {
                            clear();
                            return false;
                        }
                    }
                    sources.push_back(std::move(entry));
                    obj_start = std::string::npos;
                }
            } else if (c == ']' && depth == 0) {
                break;
            }
        }
        return !sources.empty();
    }

    /** Constant-time `(source_id, key_id, pubkey)` verification. */
    [[nodiscard]] const AirlockSourceEntryV2* find_verified(
        const std::string& source_id,
        const std::string& key_id,
        const uint8_t pubkey32[32]) const noexcept {
        const AirlockSourceEntryV2* matched = nullptr;
        for (const auto& e : sources) {
            const bool ids_eq = (e.source_id == source_id) && (e.key_id == key_id);
            const bool pk_eq = connector_detail::constant_time_bytes_equal(e.pubkey, pubkey32, 32u);
            if (ids_eq && pk_eq) matched = &e;
        }
        return matched;
    }
};

struct AirlockVerifiedRecordV2 {
    std::string schema_version;
    std::string source_id;
    std::string key_id;
    std::string independence_group;
    std::string event_kind;
    std::string event_id;
    uint64_t seq_no = 0;
    int64_t observed_at_ms = 0;
    int64_t learned_at_ms = 0;
    std::string epistemic_status;
    std::string subject_id;
    std::string metric_key;
    int64_t fp_val = 0;
    std::string unit;
    std::string payload_blake3_hex;
    std::string note;
    bool legacy_unscoped = false;
};

inline bool verify_ed25519_airlock(const CaelusEngineFns* fns,
                                   const char* source_id,
                                   const char* key_id,
                                   const char* event_kind,
                                   const std::string& signed_msg,
                                   const uint8_t pubkey32[32],
                                   const uint8_t sig64[64],
                                   uint32_t& abi_err_out) noexcept {
    abi_err_out = CAELUS_AIRLOCK_OK;
    if (fns && fns->verify_airlock_v2) {
        return fns->verify_airlock_v2(
                   fns->engine_ctx,
                   source_id,
                   key_id,
                   event_kind,
                   reinterpret_cast<const uint8_t*>(signed_msg.data()),
                   signed_msg.size(),
                   pubkey32,
                   sig64,
                   &abi_err_out) == 1u;
    }
    const connector_detail::IntelSigVerifyFn verify =
        connector_detail::intel_sig_verifier_slot().load(std::memory_order_acquire);
    if (!verify) {
        abi_err_out = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    if (verify(reinterpret_cast<const uint8_t*>(signed_msg.data()),
               signed_msg.size(), pubkey32, sig64) != 1u) {
        abi_err_out = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    return true;
}

inline bool verify_v2_components_cpp(const std::string& sig_line,
                                     const std::string& schema_version,
                                     const std::string& header_line,
                                     const std::string& payload_raw,
                                     const AirlockSourceManifestV2& manifest,
                                     const CaelusEngineFns* fns,
                                     AirlockVerifiedRecordV2& out_rec,
                                     CaelusAirlockErrorCode& out_err) noexcept {
    static constexpr const char kSigPrefix[] = "#sig=ed25519:";
    static constexpr size_t kSigPrefixLen = sizeof(kSigPrefix) - 1u;
    if (sig_line.size() != kSigPrefixLen + 64u + 1u + 128u ||
        sig_line.compare(0, kSigPrefixLen, kSigPrefix) != 0 ||
        sig_line[kSigPrefixLen + 64u] != ':') {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    uint8_t pub[32] = {};
    uint8_t sig[64] = {};
    if (!connector_detail::intel_hex_to_bytes(sig_line.data() + kSigPrefixLen, 64u, pub, 32u) ||
        !connector_detail::intel_hex_to_bytes(sig_line.data() + kSigPrefixLen + 65u, 128u, sig, 64u)) {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }

    std::vector<std::string> parts;
    parts.reserve(9u);
    size_t start = 0;
    for (;;) {
        const size_t bar = header_line.find('|', start);
        if (bar == std::string::npos) {
            parts.push_back(header_line.substr(start));
            break;
        }
        parts.push_back(header_line.substr(start, bar - start));
        start = bar + 1u;
    }
    if (parts.size() != 9u) {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    const AirlockSourceEntryV2* entry = manifest.find_verified(parts[0], parts[1], pub);
    if (!entry) {
        out_err = CAELUS_AIRLOCK_ERR_UNTRUSTED_SOURCE;
        return false;
    }

    const std::string signed_msg =
        std::string("CAELUS_INTEL_V2\n") + schema_version + "\n" + header_line + "\n" + payload_raw;
    uint32_t abi_err = CAELUS_AIRLOCK_OK;
    if (!verify_ed25519_airlock(fns, parts[0].c_str(), parts[1].c_str(), parts[2].c_str(),
                                signed_msg, pub, sig, abi_err)) {
        out_err = static_cast<CaelusAirlockErrorCode>(
            abi_err != 0u ? abi_err : CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH);
        return false;
    }

    const std::string computed_b3 = blake3_hex(payload_raw);
    uint8_t hdr_b3[32] = {};
    uint8_t cmp_b3[32] = {};
    if (!connector_detail::intel_hex_to_bytes(parts[8].data(), parts[8].size(), hdr_b3, 32u) ||
        !connector_detail::intel_hex_to_bytes(computed_b3.data(), computed_b3.size(), cmp_b3, 32u) ||
        !connector_detail::constant_time_bytes_equal(hdr_b3, cmp_b3, 32u)) {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }

    uint64_t seq_no = 0ULL;
    int64_t observed_ms = 0LL;
    int64_t learned_ms = 0LL;
    if (!parse_u64_decimal_strict(parts[4], seq_no) ||
        !parse_i64_decimal_strict(parts[5], observed_ms) ||
        !parse_i64_decimal_strict(parts[6], learned_ms) ||
        observed_ms < 0 || learned_ms < 0) {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    if (entry->expires_at_ms >= 0 && learned_ms > entry->expires_at_ms) {
        out_err = CAELUS_AIRLOCK_ERR_UNTRUSTED_SOURCE;
        return false;
    }

    if (schema_version != "2.0") {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    bool kind_allowed = false;
    for (const auto& k : entry->allowed_event_kinds) {
        if (k == parts[2]) { kind_allowed = true; break; }
    }
    if (!kind_allowed) {
        out_err = CAELUS_AIRLOCK_ERR_UNAUTHORIZED_KIND;
        return false;
    }

    const std::string& ep = parts[7];
    if (ep != "OBSERVATION" && ep != "CLAIM" && ep != "HYPOTHESIS") {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }
    if ((entry->origin_class == 1u && ep == "OBSERVATION") ||
        (entry->origin_class == 2u && ep != "HYPOTHESIS")) {
        out_err = CAELUS_AIRLOCK_ERR_UNAUTHORIZED_KIND;
        return false;
    }

    std::string fp_val_s, subject_id, metric_key, unit, rounding, overflow_pol;
    if (!json_strict_quoted_string(payload_raw, "fp_val", fp_val_s) ||
        !json_strict_quoted_string(payload_raw, "subject_id", subject_id) ||
        !json_strict_quoted_string(payload_raw, "metric_key", metric_key) ||
        !json_strict_quoted_string(payload_raw, "unit", unit) ||
        !json_strict_quoted_string(payload_raw, "rounding", rounding) ||
        !json_strict_quoted_string(payload_raw, "overflow_policy", overflow_pol) ||
        subject_id.empty() || metric_key.empty() || unit.empty() ||
        rounding != "HALF_EVEN" || overflow_pol != "REJECT_AT_AIRLOCK") {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    int64_t fp_val = 0LL;
    if (!parse_i64_decimal_strict(fp_val_s, fp_val) || !is_safe_airlock_fp(fp_val)) {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    int64_t fp_scale_i = 0LL;
    if (!json_strict_int_field(payload_raw, "fp_scale", fp_scale_i) ||
        fp_scale_i != kAirlockFpScale) {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    std::string note;
    json_strict_quoted_string(payload_raw, "note", note);

    out_rec = AirlockVerifiedRecordV2{};
    out_rec.schema_version = schema_version;
    out_rec.source_id = parts[0];
    out_rec.key_id = parts[1];
    out_rec.independence_group = entry->independence_group;
    out_rec.event_kind = parts[2];
    out_rec.event_id = parts[3];
    out_rec.seq_no = seq_no;
    out_rec.observed_at_ms = observed_ms;
    out_rec.learned_at_ms = learned_ms;
    out_rec.epistemic_status = ep;
    out_rec.subject_id = subject_id;
    out_rec.metric_key = metric_key;
    out_rec.fp_val = fp_val;
    out_rec.unit = unit;
    out_rec.payload_blake3_hex = computed_b3;
    out_rec.note = note;
    out_rec.legacy_unscoped = false;
    out_err = CAELUS_AIRLOCK_OK;
    return true;
}

inline bool verify_v1_legacy_cpp(const std::string& sig_line,
                                 const std::string& body,
                                 const AirlockSourceManifestV2& manifest,
                                 AirlockVerifiedRecordV2& out_rec,
                                 CaelusAirlockErrorCode& out_err) noexcept {
    static constexpr const char kSigPrefix[] = "#sig=ed25519:";
    static constexpr size_t kSigPrefixLen = sizeof(kSigPrefix) - 1u;
    if (sig_line.size() != kSigPrefixLen + 64u + 1u + 128u ||
        sig_line.compare(0, kSigPrefixLen, kSigPrefix) != 0 ||
        sig_line[kSigPrefixLen + 64u] != ':') {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    uint8_t pub[32] = {};
    uint8_t sig[64] = {};
    if (!connector_detail::intel_hex_to_bytes(sig_line.data() + kSigPrefixLen, 64u, pub, 32u) ||
        !connector_detail::intel_hex_to_bytes(sig_line.data() + kSigPrefixLen + 65u, 128u, sig, 64u)) {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    if (!manifest.has_legacy_v1_pubkey ||
        !connector_detail::constant_time_bytes_equal(manifest.legacy_v1_pubkey, pub, 32u)) {
        out_err = CAELUS_AIRLOCK_ERR_UNTRUSTED_SOURCE;
        return false;
    }
    const connector_detail::IntelSigVerifyFn verify =
        connector_detail::intel_sig_verifier_slot().load(std::memory_order_acquire);
    if (!verify) {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    const std::string signed_msg = std::string("CAELUS_INTEL_V1\n") + body;
    if (verify(reinterpret_cast<const uint8_t*>(signed_msg.data()),
               signed_msg.size(), pub, sig) != 1u) {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    if (manifest.require_v2_airlock) {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    out_rec = AirlockVerifiedRecordV2{};
    out_rec.schema_version = "1.0";
    out_rec.source_id = "LEGACY_UNSCOPED";
    out_rec.key_id = "legacy_v1";
    out_rec.event_kind = "LEGACY_UNSCOPED";
    out_rec.payload_blake3_hex = blake3_hex(body);
    out_rec.event_id = std::string("v1-") + out_rec.payload_blake3_hex.substr(0, 16u);
    out_rec.seq_no = 1ULL;
    out_rec.epistemic_status = "CLAIM";
    out_rec.subject_id = "LEGACY_SUBJECT";
    out_rec.metric_key = "friction_coeff";
    out_rec.unit = "ratio";
    out_rec.note = "LEGACY_UNSCOPED";
    out_rec.legacy_unscoped = true;
    double coeff = 0.0;
    if (connector_detail::json_number(body, "friction_coeff", coeff)) {
        out_rec.fp_val = static_cast<int64_t>(connector_detail::clamp_coeff(coeff) * 1000000.0);
    }
    out_err = CAELUS_AIRLOCK_OK;
    return true;
}

/** Envelope router supporting `.airlock.ndjson` lines, 5-line `CAELUS_INTEL_V2`, and 2-line `CAELUS_INTEL_V1`. */
inline bool verify_airlock_envelope_v1_or_v2(const std::string& raw_record,
                                             const AirlockSourceManifestV2& manifest,
                                             const CaelusEngineFns* fns,
                                             AirlockVerifiedRecordV2& out_rec,
                                             CaelusAirlockErrorCode& out_err) noexcept {
    if (raw_record.empty() || raw_record.find('\r') != std::string::npos) {
        out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
        return false;
    }

    if (raw_record[0] == '{') {
        std::string contract, sig_line;
        if (!json_strict_quoted_string(raw_record, "contract", contract) ||
            !json_strict_quoted_string(raw_record, "sig", sig_line)) {
            out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
            return false;
        }
        if (contract == "CAELUS_INTEL_V1") {
            std::string body;
            if (!json_strict_quoted_string(raw_record, "body", body)) {
                out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
                return false;
            }
            return verify_v1_legacy_cpp(sig_line, body, manifest, out_rec, out_err);
        }
        if (contract != "CAELUS_INTEL_V2") {
            out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
            return false;
        }
        std::string schema_version, header_line, payload_raw;
        if (!json_strict_quoted_string(raw_record, "schema_version", schema_version) ||
            !json_strict_quoted_string(raw_record, "header", header_line) ||
            !json_strict_quoted_string(raw_record, "payload_raw", payload_raw)) {
            out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
            return false;
        }
        if (!verify_v2_components_cpp(sig_line, schema_version, header_line, payload_raw,
                                      manifest, fns, out_rec, out_err)) {
            return false;
        }
        if (json_has_top_level_key(raw_record, "learned_at_ms")) {
            std::string outer_learned;
            int64_t outer_ms = -1;
            if (!json_strict_quoted_string(raw_record, "learned_at_ms", outer_learned) ||
                !parse_i64_decimal_strict(outer_learned, outer_ms)) {
                out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
                return false;
            }
            if (outer_ms != out_rec.learned_at_ms) {
                out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
                return false;
            }
        }
        return true;
    }

    const size_t nl1 = raw_record.find('\n');
    if (nl1 == std::string::npos) {
        out_err = CAELUS_AIRLOCK_ERR_SIGNATURE_MISMATCH;
        return false;
    }
    const std::string sig_line = raw_record.substr(0, nl1);
    const std::string after_sig = raw_record.substr(nl1 + 1u);
    static constexpr const char kV2Line[] = "CAELUS_INTEL_V2\n";
    static constexpr size_t kV2LineLen = sizeof(kV2Line) - 1u;
    if (after_sig.compare(0, kV2LineLen, kV2Line) == 0) {
        const std::string rest = after_sig.substr(kV2LineLen);
        const size_t nl2 = rest.find('\n');
        if (nl2 == std::string::npos) {
            out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
            return false;
        }
        const size_t nl3 = rest.find('\n', nl2 + 1u);
        if (nl3 == std::string::npos) {
            out_err = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
            return false;
        }
        const std::string schema_version = rest.substr(0, nl2);
        const std::string header_line = rest.substr(nl2 + 1u, nl3 - (nl2 + 1u));
        std::string payload_raw = rest.substr(nl3 + 1u);
        if (!payload_raw.empty() && payload_raw.back() == '\n') payload_raw.pop_back();
        return verify_v2_components_cpp(sig_line, schema_version, header_line, payload_raw,
                                        manifest, fns, out_rec, out_err);
    }
    return verify_v1_legacy_cpp(sig_line, after_sig, manifest, out_rec, out_err);
}

inline bool peek_outer_learned_ms(const std::string& rec, int64_t& out_ms) noexcept {
    if (rec.empty() || rec[0] != '{') return false;
    std::string s;
    if (!json_strict_quoted_string(rec, "learned_at_ms", s)) return false;
    return parse_i64_decimal_strict(s, out_ms);
}

} // namespace airlock_detail

/**
 * AirlockFileConnector — deterministic offline `.airlock.ndjson` / `CAELUS_INTEL_V2`
 * batch connector (PR-1 §1, §2, §3, §5).
 */
struct AirlockFileConnector : ConnectorBase<AirlockFileConnector> {
    static constexpr const char* kName    = "AirlockFileConnector";
    static constexpr const char* kVersion = "2.0.0";

    const char* source_path = nullptr;
    const char* manifest_path = nullptr;
    int64_t cutoff_learned_at_ms = std::numeric_limits<int64_t>::max();
    int64_t policy_max_fp = 20LL * airlock_detail::kAirlockFpScale;
    size_t cursor = 0;

    bool do_init(const CaelusEngineFns* fns) noexcept {
        fns_ = fns;
        cursor = 0;
        events_.clear();
        verified_.clear();
        rejected_count_ = 0;
        duplicate_count_ = 0;
        last_error_ = CAELUS_AIRLOCK_OK;
        used_binary_search_ = false;

        const char* m_path = (manifest_path && manifest_path[0])
            ? manifest_path
            : std::getenv("CAELUS_AIRLOCK_MANIFEST_PATH");
        const char* b_path = (source_path && source_path[0])
            ? source_path
            : std::getenv("CAELUS_AIRLOCK_BATCH_PATH");

        if (!m_path || !m_path[0] || !manifest_.load_from_file(m_path)) {
            std::cerr << "[AIRLOCK] HATA: source_manifest.json okunamadi/gecersiz.\n";
            return false;
        }
#ifdef CAELUS_PRODUCTION
        if (!connector_detail::intel_sig_verifier_slot().load(std::memory_order_acquire) &&
            !(fns_ && fns_->verify_airlock_v2)) {
            std::cerr << "[AIRLOCK] FATAL: CAELUS_PRODUCTION modunda imza dogrulayicisi yok.\n";
            return false;
        }
#endif
        if (!b_path || !b_path[0]) return true;

        std::ifstream in(b_path, std::ios::binary);
        if (!in.is_open()) {
            std::cerr << "[AIRLOCK] HATA: .airlock.ndjson dosyasi acilamadi: " << b_path << "\n";
            return false;
        }
        std::ostringstream ss;
        ss << in.rdbuf();
        const std::string content = ss.str();
        if (content.find('\r') != std::string::npos) {
            last_error_ = CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE;
            return false;
        }

        std::vector<std::string> raw_records;
        {
            std::istringstream ls(content);
            std::string line;
            std::vector<std::string> all_lines;
            while (std::getline(ls, line)) all_lines.push_back(line);
            for (size_t i = 0; i < all_lines.size();) {
                if (connector_detail::trim(all_lines[i]).empty()) { ++i; continue; }
                if (all_lines[i][0] == '{') {
                    raw_records.push_back(all_lines[i]);
                    ++i;
                } else if (all_lines[i].compare(0, 5u, "#sig=") == 0) {
                    if (i + 1u < all_lines.size() && all_lines[i + 1u] == "CAELUS_INTEL_V2") {
                        if (i + 4u >= all_lines.size()) {
                            note_reject(CAELUS_AIRLOCK_ERR_SCHEMA_OR_RANGE);
                            break;
                        }
                        raw_records.push_back(
                            all_lines[i] + "\n" + all_lines[i + 1u] + "\n" +
                            all_lines[i + 2u] + "\n" + all_lines[i + 3u] + "\n" +
                            all_lines[i + 4u]);
                        i += 5u;
                    } else if (i + 1u < all_lines.size()) {
                        raw_records.push_back(all_lines[i] + "\n" + all_lines[i + 1u]);
                        i += 2u;
                    } else {
                        raw_records.push_back(all_lines[i]);
                        ++i;
                    }
                } else {
                    raw_records.push_back(all_lines[i]);
                    ++i;
                }
            }
        }

        // §5: O(log N) binary search on sorted append-only NDJSON `learned_at_ms`
        std::vector<int64_t> hints;
        hints.reserve(raw_records.size());
        bool sorted_hints = !raw_records.empty();
        for (const auto& rec : raw_records) {
            int64_t ts = 0;
            if (!airlock_detail::peek_outer_learned_ms(rec, ts)) {
                sorted_hints = false;
                break;
            }
            if (!hints.empty() && ts < hints.back()) {
                sorted_hints = false;
                break;
            }
            hints.push_back(ts);
        }

        size_t scan_limit = raw_records.size();
        if (sorted_hints) {
            used_binary_search_ = true;
            const auto it = std::upper_bound(hints.begin(), hints.end(), cutoff_learned_at_ms);
            scan_limit = static_cast<size_t>(std::distance(hints.begin(), it));
        }

        struct SeenSeq {
            std::string source_id;
            uint64_t seq_no;
            std::string payload_b3;
        };
        std::vector<SeenSeq> seen_seq;

        for (size_t i = 0; i < scan_limit; ++i) {
            airlock_detail::AirlockVerifiedRecordV2 ver{};
            CaelusAirlockErrorCode err = CAELUS_AIRLOCK_OK;
            if (!airlock_detail::verify_airlock_envelope_v1_or_v2(
                    raw_records[i], manifest_, fns_, ver, err)) {
                note_reject(err);
                continue;
            }
            // Strict bi-temporal cutoff filter (`learned_at_ms <= cutoff_learned_at_ms`)
            if (ver.learned_at_ms > cutoff_learned_at_ms) {
                continue;
            }

            bool is_dup = false;
            bool is_equiv = false;
            for (const auto& s : seen_seq) {
                if (s.source_id == ver.source_id && s.seq_no == ver.seq_no) {
                    if (s.payload_b3 == ver.payload_blake3_hex) is_dup = true;
                    else is_equiv = true;
                    break;
                }
            }
            if (is_equiv) {
                note_reject(CAELUS_AIRLOCK_ERR_SOURCE_EQUIVOCATION);
                continue;
            }
            if (is_dup) {
                ++duplicate_count_;
                continue;
            }
            seen_seq.push_back(SeenSeq{ver.source_id, ver.seq_no, ver.payload_blake3_hex});
            verified_.push_back(std::move(ver));
        }

        // §3.3.3: Deterministic total tie-breaking order:
        // (observed_at_ms ASC, learned_at_ms ASC, source_id ASC, seq_no ASC, event_id ASC)
        std::sort(verified_.begin(), verified_.end(),
                  [](const airlock_detail::AirlockVerifiedRecordV2& a,
                     const airlock_detail::AirlockVerifiedRecordV2& b) {
                      if (a.observed_at_ms != b.observed_at_ms) return a.observed_at_ms < b.observed_at_ms;
                      if (a.learned_at_ms != b.learned_at_ms) return a.learned_at_ms < b.learned_at_ms;
                      if (a.source_id != b.source_id) return a.source_id < b.source_id;
                      if (a.seq_no != b.seq_no) return a.seq_no < b.seq_no;
                      return a.event_id < b.event_id;
                  });

        events_.reserve(verified_.size());
        for (const auto& v : verified_) {
            CaelusIntelEvent ev{};
            const int64_t clamped_pos = v.fp_val < 0 ? 0LL : v.fp_val;
            const double denom = policy_max_fp > 0
                ? static_cast<double>(policy_max_fp * 2LL)
                : static_cast<double>(airlock_detail::kAirlockFpScale);
            ev.friction_coeff = connector_detail::clamp_coeff(
                static_cast<double>(clamped_pos) / denom);
            if (v.epistemic_status == "OBSERVATION" && policy_max_fp > 0 && v.fp_val > policy_max_fp) {
                ev.crisis_level = 3u;
            } else if (policy_max_fp > 0 && v.fp_val > policy_max_fp) {
                ev.crisis_level = 2u;
            } else if (v.fp_val > 0) {
                ev.crisis_level = 1u;
            } else {
                ev.crisis_level = 0u;
            }
            ev.source_slot_id = airlock_detail::fnv1a64_str(v.source_id);
            ev.observed_at_tick = connector_detail::current_tick(fns_);
            const std::string memo_tag =
                v.source_id + ":" + v.event_id + ":" + v.epistemic_status + ":" + v.note;
            connector_detail::copy_memo(ev.memo, sizeof(ev.memo), memo_tag);
            events_.push_back(ev);
        }
        return true;
    }

    void do_cleanup() noexcept {
        fns_ = nullptr;
        cursor = 0;
        events_.clear();
        verified_.clear();
        manifest_.clear();
    }

    [[nodiscard]] size_t do_pull(CaelusIntelEvent* out, size_t max) noexcept {
        if (!out || max == 0) return 0;
        const uint64_t now = connector_detail::current_tick(fns_);
        size_t n = 0;
        while (cursor < events_.size() && n < max) {
            out[n] = events_[cursor];
            out[n].observed_at_tick = now;
            ++n;
            ++cursor;
        }
        return n;
    }

    [[nodiscard]] size_t accepted_count() const noexcept { return verified_.size(); }
    [[nodiscard]] size_t rejected_count() const noexcept { return rejected_count_; }
    [[nodiscard]] size_t duplicate_count() const noexcept { return duplicate_count_; }
    [[nodiscard]] CaelusAirlockErrorCode last_error_code() const noexcept { return last_error_; }
    [[nodiscard]] bool used_binary_search() const noexcept { return used_binary_search_; }
    [[nodiscard]] const std::vector<airlock_detail::AirlockVerifiedRecordV2>& verified_records() const noexcept {
        return verified_;
    }

private:
    const CaelusEngineFns* fns_ = nullptr;
    airlock_detail::AirlockSourceManifestV2 manifest_{};
    std::vector<airlock_detail::AirlockVerifiedRecordV2> verified_;
    std::vector<CaelusIntelEvent> events_;
    size_t rejected_count_ = 0;
    size_t duplicate_count_ = 0;
    CaelusAirlockErrorCode last_error_ = CAELUS_AIRLOCK_OK;
    bool used_binary_search_ = false;

    void note_reject(CaelusAirlockErrorCode code) noexcept {
        ++rejected_count_;
        last_error_ = code;
        connector_detail::intel_rejected_total().fetch_add(1u, std::memory_order_relaxed);
    }
};

} // namespace caelus
