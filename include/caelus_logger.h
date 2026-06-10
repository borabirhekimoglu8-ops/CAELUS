#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

#ifndef CAELUS_CAUSAL_LOGGING
#define CAELUS_CAUSAL_LOGGING 0
#endif

#ifndef CAELUS_CAUSAL_LOGGER_CAPACITY
#define CAELUS_CAUSAL_LOGGER_CAPACITY 1024
#endif

namespace caelus::logging {

enum class LogLevel : uint8_t {
    Trace = 0,
    Info,
    Warn,
    Error,
    Critical,
};

enum class CausalLogCode : uint16_t {
    IntelInjected = 1,
    LeverSucceeded,
    LeverFailed,
    ScenarioBs01Injected,
    ScenarioBs03Injected,
    ObservabilityTrustLow,
    RegimeExceeded,
    HysteresisFlipPermanent,
    HysteresisFlipReversible,
    DeadlineMissed,
};

struct LogEvent {
    LogLevel level = LogLevel::Info;
    uint64_t tick = 0;
    CausalLogCode code = CausalLogCode::IntelInjected;
    const char* message = "";
};

template <std::size_t N>
class StaticRingLogger {
public:
    static_assert(N > 0, "StaticRingLogger capacity must be greater than zero");

    void log(LogLevel level, uint64_t tick, CausalLogCode code, const char* message) noexcept {
        const std::size_t slot = head_.fetch_add(1, std::memory_order_relaxed) % N;
        events_[slot] = LogEvent{level, tick, code, message ? message : ""};
    }

    [[nodiscard]] std::size_t written() const noexcept {
        return head_.load(std::memory_order_relaxed);
    }

    [[nodiscard]] const LogEvent& at(std::size_t index) const noexcept {
        return events_[index % N];
    }

    void reset() noexcept {
        head_.store(0, std::memory_order_relaxed);
    }

private:
    std::array<LogEvent, N> events_{};
    std::atomic<std::size_t> head_{0};
};

#if CAELUS_CAUSAL_LOGGING
inline StaticRingLogger<CAELUS_CAUSAL_LOGGER_CAPACITY>& causal_logger() noexcept {
    static StaticRingLogger<CAELUS_CAUSAL_LOGGER_CAPACITY> logger;
    return logger;
}
#endif

} // namespace caelus::logging

#if CAELUS_CAUSAL_LOGGING
#define CAELUS_CAUSAL_LOG_EVENT(level, code, tick, message) \
    (::caelus::logging::causal_logger().log((level), (tick), (code), (message)))
#else
#define CAELUS_CAUSAL_LOG_EVENT(level, code, tick, message) ((void)0)
#endif

