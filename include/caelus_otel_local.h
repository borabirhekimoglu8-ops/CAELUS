#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// CAELUS Local OpenTelemetry C++ Span & Counter Collector (caelus_otel_local.h)
// ═════════════════════════════════════════════════════════════════════════════
// Repo referansı : open-telemetry/opentelemetry-cpp (Apache-2.0)
// Tasarım kuralı : ANA_PROMPT.txt Bölüm 3.6 & 8:
//   - "OpenTelemetry ve tüm tanılama araçları yalnızca yerel çalışmalıdır;
//      dışa telemetri gönderimi kapalı kalmalıdır."
//   - W3C TraceContext uyumlu trace_id (128-bit hex) ve span_id (64-bit hex)
//   - Sabit kapasiteli halka tampon (ring buffer) ve sayaç (counter) kaydı
//   - Dış ağ ihracı (OTLP HTTP/gRPC exporter) derleme zamanı ve çalışma
//     zamanında kesinlikle devre dışıdır (kExternalExportEnabled = false).
// ═════════════════════════════════════════════════════════════════════════════

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

namespace caelus {
namespace telemetry {

struct LocalOtelSpanRecord {
    char trace_id[33];       // 32 hex + NUL (128-bit W3C TraceContext)
    char span_id[17];        // 16 hex + NUL (64-bit W3C SpanId)
    char parent_span_id[17]; // 16 hex + NUL
    char name[64];           // örn. "http.request", "connector.pull_intel", "engine.tick"
    char component[32];      // örn. "caelus_os_cpp", "mqtt_connector", "causal_engine"
    char status[16];         // "OK" | "ERROR"
    uint64_t start_unix_us;
    uint64_t duration_us;
    uint64_t tick;
};

struct LocalOtelCounterRecord {
    char name[64];
    uint64_t value;
};

class LocalOtelCollector {
public:
    static constexpr size_t kMaxSpans = 256;
    static constexpr size_t kMaxCounters = 32;
    static constexpr bool kExternalExportEnabled = false;

    static LocalOtelCollector& instance() {
        static LocalOtelCollector inst;
        return inst;
    }

    LocalOtelCollector() : head_(0), count_(0), total_spans_recorded_(0), seq_(1) {
        std::memset(spans_.data(), 0, sizeof(LocalOtelSpanRecord) * kMaxSpans);
        std::memset(counters_.data(), 0, sizeof(LocalOtelCounterRecord) * kMaxCounters);
    }

    bool external_export_enabled() const noexcept {
        return kExternalExportEnabled;
    }

    void record_span(const char* name,
                     const char* component,
                     uint64_t duration_us,
                     uint64_t tick = 0,
                     const char* status = "OK",
                     const char* parent_span_id = "0000000000000000") {
        std::lock_guard<std::mutex> lock(mu_);
        const uint64_t seq = seq_.fetch_add(1, std::memory_order_relaxed);
        const uint64_t now_us = current_unix_us();

        LocalOtelSpanRecord rec{};
        std::snprintf(rec.trace_id, sizeof(rec.trace_id),
                      "cae10500%08llx%016llx",
                      static_cast<unsigned long long>(tick & 0xFFFFFFFFULL),
                      static_cast<unsigned long long>(seq));
        std::snprintf(rec.span_id, sizeof(rec.span_id),
                      "%016llx",
                      static_cast<unsigned long long>((seq * 0x9E3779B97F4A7C15ULL) ^ now_us));
        copy_str(rec.parent_span_id, sizeof(rec.parent_span_id),
                 parent_span_id ? parent_span_id : "0000000000000000");
        copy_str(rec.name, sizeof(rec.name), name ? name : "unnamed_span");
        copy_str(rec.component, sizeof(rec.component), component ? component : "caelus_core");
        copy_str(rec.status, sizeof(rec.status), status ? status : "OK");
        rec.start_unix_us = (now_us >= duration_us) ? (now_us - duration_us) : now_us;
        rec.duration_us = duration_us;
        rec.tick = tick;

        spans_[head_] = rec;
        head_ = (head_ + 1) % kMaxSpans;
        if (count_ < kMaxSpans) {
            ++count_;
        }
        ++total_spans_recorded_;
    }

    void increment_counter(const char* name, uint64_t delta = 1) {
        if (!name || !*name) return;
        std::lock_guard<std::mutex> lock(mu_);
        for (size_t i = 0; i < kMaxCounters; ++i) {
            if (counters_[i].name[0] != '\0' && std::strncmp(counters_[i].name, name, sizeof(counters_[i].name)) == 0) {
                counters_[i].value += delta;
                return;
            }
            if (counters_[i].name[0] == '\0') {
                copy_str(counters_[i].name, sizeof(counters_[i].name), name);
                counters_[i].value = delta;
                return;
            }
        }
    }

    uint64_t counter_value(const char* name) const {
        if (!name || !*name) return 0;
        std::lock_guard<std::mutex> lock(mu_);
        for (size_t i = 0; i < kMaxCounters; ++i) {
            if (counters_[i].name[0] != '\0' && std::strncmp(counters_[i].name, name, sizeof(counters_[i].name)) == 0) {
                return counters_[i].value;
            }
        }
        return 0;
    }

    size_t buffered_span_count() const {
        std::lock_guard<std::mutex> lock(mu_);
        return count_;
    }

    uint64_t total_spans_recorded() const {
        std::lock_guard<std::mutex> lock(mu_);
        return total_spans_recorded_;
    }

    std::string export_local_json(size_t max_items = 32) const {
        std::lock_guard<std::mutex> lock(mu_);
        std::ostringstream oss;
        oss << "{\"schema\":\"caelus.opentelemetry.local.v1\","
            << "\"external_export_enabled\":false,"
            << "\"exporter_mode\":\"LOCAL_RING_BUFFER_ONLY\","
            << "\"total_spans_recorded\":" << total_spans_recorded_ << ","
            << "\"buffered_span_count\":" << count_ << ","
            << "\"counters\":{";
        bool first_c = true;
        for (size_t i = 0; i < kMaxCounters; ++i) {
            if (counters_[i].name[0] == '\0') continue;
            if (!first_c) oss << ",";
            first_c = false;
            oss << "\"" << counters_[i].name << "\":" << counters_[i].value;
        }
        oss << "},\"spans\":[";
        const size_t limit = (max_items < count_) ? max_items : count_;
        for (size_t i = 0; i < limit; ++i) {
            const size_t idx = (head_ + kMaxSpans - 1 - i) % kMaxSpans;
            const auto& s = spans_[idx];
            if (i > 0) oss << ",";
            oss << "{\"trace_id\":\"" << s.trace_id << "\","
                << "\"span_id\":\"" << s.span_id << "\","
                << "\"parent_span_id\":\"" << s.parent_span_id << "\","
                << "\"name\":\"" << s.name << "\","
                << "\"component\":\"" << s.component << "\","
                << "\"status\":\"" << s.status << "\","
                << "\"start_unix_us\":" << s.start_unix_us << ","
                << "\"duration_us\":" << s.duration_us << ","
                << "\"tick\":" << s.tick << "}";
        }
        oss << "]}";
        return oss.str();
    }

private:
    static uint64_t current_unix_us() noexcept {
        using namespace std::chrono;
        return static_cast<uint64_t>(
            duration_cast<microseconds>(system_clock::now().time_since_epoch()).count());
    }

    static void copy_str(char* dst, size_t cap, const char* src) noexcept {
        if (!dst || cap == 0) return;
        if (!src) {
            dst[0] = '\0';
            return;
        }
        std::strncpy(dst, src, cap - 1);
        dst[cap - 1] = '\0';
    }

    mutable std::mutex mu_;
    std::array<LocalOtelSpanRecord, kMaxSpans> spans_;
    std::array<LocalOtelCounterRecord, kMaxCounters> counters_;
    size_t head_;
    size_t count_;
    uint64_t total_spans_recorded_;
    std::atomic<uint64_t> seq_;
};

class ScopedLocalSpan {
public:
    ScopedLocalSpan(const char* name,
                    const char* component,
                    uint64_t tick = 0,
                    const char* status = "OK")
        : name_(name),
          component_(component),
          tick_(tick),
          status_(status),
          start_(std::chrono::steady_clock::now()) {}

    void set_status(const char* status) noexcept { status_ = status; }

    ~ScopedLocalSpan() {
        const auto end = std::chrono::steady_clock::now();
        const uint64_t dur_us = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::microseconds>(end - start_).count());
        LocalOtelCollector::instance().record_span(name_, component_, dur_us, tick_, status_);
    }

private:
    const char* name_;
    const char* component_;
    uint64_t tick_;
    const char* status_;
    std::chrono::steady_clock::time_point start_;
};

} // namespace telemetry
} // namespace caelus

