#!/usr/bin/env python3
"""Connector smoke / integration tests for CAELUS live MQTT and Zapier connectors.

The script builds a tiny C++ harness against include/plugin/caelus_connector.h
and include/causal_engine.h. No dist/caelus_os.exe and no external broker are
required: the harness starts a loopback HTTP server path for
ZapierWebhookConnector and a minimal local MQTT 3.1.1 QoS0 broker fixture for
MqttConnector.

End-to-end crisis-signal path proven by the harness:
    network (loopback) -> connector pull_intel -> registry inject_intel callback
    -> CausalEngine.inject_intel -> graph node state change -> friction rise.

Intel data-plane auth scenarios (CAELUS_INTEL_TOKEN, see IntelAuthGate in
include/plugin/caelus_connector.h):
    (a) token SET + correct auth  -> accepted + graph propagation
        - Zapier: X-Caelus-Auth header, JSON "auth" member, CSV "#auth=" line
        - MQTT:   JSON "auth" member
    (b) token SET + wrong/missing -> rejected (Zapier 401, MQTT drop);
        inject_intel is never called, graph stays untouched, token never
        leaks into memo fields.
    (c) token UNSET               -> legacy behaviour (accept without auth),
        verified both before and after the token scenarios.
    (d) signature pin SET (CAELUS_TRUSTED_INTEL_PUBKEY) + valid #sig= envelope
        -> accepted with the envelope stripped; graph propagation intact.
    (e) signature pin SET + unsigned/malformed/wrong-key/tampered payloads
        -> rejected before parsing (Zapier 401 / gate false); fail-closed when
        no verifier hook is installed. ed25519 math is exercised by the Rust
        unit tests; the harness installs a deterministic stub verifier to
        prove the gate plumbing (envelope, pin match, byte-exact signed
        region, strip) without linking the Rust staticlib.

This is a NON-deterministic, network-active integration test; it must run
OUTSIDE ci.bat --det-mode (det-mode skips networking).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build_tests"
HARNESS_CPP = BUILD_DIR / "connector_smoke_harness.cpp"
HARNESS_EXE = BUILD_DIR / ("connector_smoke_harness.exe" if os.name == "nt" else "connector_smoke_harness")


HARNESS_SOURCE = r"""
#include "plugin/caelus_connector.h"
#include "causal_engine.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

// Shared intel data-plane test token (32 hex chars, mirrors CAELUS_INTEL_TOKEN docs).
constexpr const char kIntelTestToken[] = "5f2a9c4d8e1b7a3c6d0f4e8a2b9c1d7e";

struct EngineState {
    uint64_t tick = 77;
    std::vector<CaelusIntelEvent> injected;          // connector->registry boundary record
    caelus::causal::CausalEngine engine;             // real causal graph (header-only)
    bool graph_loaded = false;
};

uint64_t current_tick_cb(void* ctx) {
    return static_cast<EngineState*>(ctx)->tick;
}

uint8_t inject_intel_cb(void* ctx,
                        double friction_coeff,
                        uint8_t crisis_level,
                        const char* memo,
                        size_t memo_len) {
    auto* state = static_cast<EngineState*>(ctx);
    if (!state) return 0;
    CaelusIntelEvent ev{};
    ev.friction_coeff = friction_coeff;
    ev.crisis_level = crisis_level;
    ev.observed_at_tick = state->tick;
    const size_t n = (memo && memo_len < sizeof(ev.memo)) ? memo_len : sizeof(ev.memo) - 1u;
    if (memo && n > 0) std::memcpy(ev.memo, memo, n);
    ev.memo[n] = '\0';
    state->injected.push_back(ev);

    // Drive the REAL causal graph. This mirrors the engine's registry wiring so
    // the smoke test proves the field/crisis signal reaches graph NODES, not
    // just the connector->registry boundary.
    if (state->graph_loaded) {
        state->engine.inject_intel(friction_coeff,
                                   static_cast<int>(crisis_level),
                                   ev.memo);
    }
    return 1;
}

CaelusEngineFns make_engine_fns(EngineState& state) {
    state.engine.load_universal_blank_slate();   // neutral graph: every node state = 0
    state.graph_loaded = true;
    CaelusEngineFns fns{};
    fns.engine_ctx = &state;
    fns.inject_intel = inject_intel_cb;
    fns.current_tick = current_tick_cb;
    return fns;
}

void set_env_var(const char* name, const std::string& value) {
#ifdef _WIN32
    _putenv_s(name, value.c_str());
#else
    setenv(name, value.c_str(), 1);
#endif
}

void unset_env_var(const char* name) {
#ifdef _WIN32
    _putenv_s(name, "");
#else
    unsetenv(name);
#endif
}

void append_u16(std::string& out, size_t v) {
    out.push_back(static_cast<char>((v >> 8u) & 0xFFu));
    out.push_back(static_cast<char>(v & 0xFFu));
}

void append_remaining_length(std::string& out, size_t len) {
    do {
        uint8_t byte = static_cast<uint8_t>(len % 128u);
        len /= 128u;
        if (len > 0) byte |= 0x80u;
        out.push_back(static_cast<char>(byte));
    } while (len > 0);
}

bool send_all_blocking(SocketFd s, const std::string& data) {
    size_t sent = 0;
    while (sent < data.size()) {
        const int n = static_cast<int>(::send(
            s, data.data() + sent, static_cast<int>(data.size() - sent), 0));
        if (n <= 0) return false;
        sent += static_cast<size_t>(n);
    }
    return true;
}

bool recv_exact_blocking(SocketFd s, uint8_t* out, size_t len) {
    size_t got = 0;
    while (got < len) {
        const int n = static_cast<int>(::recv(
            s, reinterpret_cast<char*>(out + got), static_cast<int>(len - got), 0));
        if (n <= 0) return false;
        got += static_cast<size_t>(n);
    }
    return true;
}

bool read_mqtt_packet(SocketFd s, uint8_t& fixed_header, std::string& body) {
    if (!recv_exact_blocking(s, &fixed_header, 1)) return false;

    size_t remaining = 0;
    size_t multiplier = 1;
    for (int i = 0; i < 4; ++i) {
        uint8_t encoded = 0;
        if (!recv_exact_blocking(s, &encoded, 1)) return false;
        remaining += static_cast<size_t>(encoded & 0x7Fu) * multiplier;
        if ((encoded & 0x80u) == 0) break;
        multiplier *= 128u;
        if (i == 3) return false;
    }

    body.assign(remaining, '\0');
    return remaining == 0 ||
           recv_exact_blocking(s, reinterpret_cast<uint8_t*>(&body[0]), remaining);
}

void set_socket_timeouts(SocketFd s, int timeout_ms) {
#ifdef _WIN32
    DWORD tv = static_cast<DWORD>(timeout_ms);
    ::setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));
    ::setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));
#else
    timeval tv{};
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;
    ::setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    ::setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
#endif
}

uint16_t reserve_loopback_port() {
    if (!wsa_init()) return 0;
    SocketFd s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == kInvalidSocket) {
        wsa_cleanup();
        return 0;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(0);
    ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    if (::bind(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        close_socket(s);
        wsa_cleanup();
        return 0;
    }

#ifdef _WIN32
    int len = sizeof(addr);
#else
    socklen_t len = sizeof(addr);
#endif
    uint16_t port = 0;
    if (::getsockname(s, reinterpret_cast<sockaddr*>(&addr), &len) == 0) {
        port = ntohs(addr.sin_port);
    }
    close_socket(s);
    wsa_cleanup();
    return port;
}

class FakeMqttBroker {
public:
    explicit FakeMqttBroker(std::vector<std::string> payloads)
        : payloads_(std::move(payloads)) {}

    ~FakeMqttBroker() {
        stop();
    }

    bool start() {
        if (!wsa_init()) return false;
        listen_sock_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listen_sock_ == kInvalidSocket) return false;

        int yes = 1;
        ::setsockopt(listen_sock_, SOL_SOCKET, SO_REUSEADDR,
                     reinterpret_cast<const char*>(&yes), static_cast<int>(sizeof(yes)));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(0);
        ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
        if (::bind(listen_sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 ||
            ::listen(listen_sock_, 1) != 0) {
            return false;
        }

#ifdef _WIN32
        int len = sizeof(addr);
#else
        socklen_t len = sizeof(addr);
#endif
        if (::getsockname(listen_sock_, reinterpret_cast<sockaddr*>(&addr), &len) != 0) {
            return false;
        }
        port_ = ntohs(addr.sin_port);
        running_.store(true, std::memory_order_release);
        thread_ = std::thread(&FakeMqttBroker::run, this);
        return true;
    }

    uint16_t port() const {
        return port_;
    }

    void stop() {
        running_.store(false, std::memory_order_release);
        if (listen_sock_ != kInvalidSocket) {
            close_socket(listen_sock_);
            listen_sock_ = kInvalidSocket;
        }
        if (thread_.joinable()) thread_.join();
        wsa_cleanup();
    }

private:
    std::vector<std::string> payloads_;
    uint16_t port_ = 0;
    SocketFd listen_sock_ = kInvalidSocket;
    std::atomic<bool> running_{false};
    std::thread thread_;

    void run() {
        fd_set rd;
        FD_ZERO(&rd);
        FD_SET(listen_sock_, &rd);
        timeval tv{5, 0};
        const int rc = ::select(static_cast<int>(listen_sock_) + 1, &rd, nullptr, nullptr, &tv);
        if (rc <= 0 || !FD_ISSET(listen_sock_, &rd)) return;

        sockaddr_in peer{};
#ifdef _WIN32
        int peer_len = sizeof(peer);
#else
        socklen_t peer_len = sizeof(peer);
#endif
        SocketFd client = ::accept(listen_sock_, reinterpret_cast<sockaddr*>(&peer), &peer_len);
        if (client == kInvalidSocket) return;
        set_socket_timeouts(client, 5000);

        uint8_t type = 0;
        std::string body;
        if (!read_mqtt_packet(client, type, body) || (type >> 4u) != 1u) {
            close_socket(client);
            return;
        }
        send_all_blocking(client, std::string("\x20\x02\x00\x00", 4));

        if (!read_mqtt_packet(client, type, body) || (type >> 4u) != 8u || body.size() < 5u) {
            close_socket(client);
            return;
        }

        const unsigned packet_id_hi = static_cast<unsigned char>(body[0]);
        const unsigned packet_id_lo = static_cast<unsigned char>(body[1]);
        const size_t topic_len =
            (static_cast<unsigned char>(body[2]) << 8u) |
            static_cast<unsigned char>(body[3]);
        if (4u + topic_len > body.size()) {
            close_socket(client);
            return;
        }
        const std::string topic = body.substr(4u, topic_len);

        std::string suback;
        suback.push_back(static_cast<char>(0x90));
        suback.push_back(0x03);
        suback.push_back(static_cast<char>(packet_id_hi));
        suback.push_back(static_cast<char>(packet_id_lo));
        suback.push_back(0x00);
        send_all_blocking(client, suback);

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        for (const std::string& payload : payloads_) {
            if (!running_.load(std::memory_order_acquire)) break;
            std::string publish_body;
            append_u16(publish_body, topic.size());
            publish_body += topic;
            publish_body += payload;

            std::string publish;
            publish.push_back(0x30);
            append_remaining_length(publish, publish_body.size());
            publish += publish_body;
            if (!send_all_blocking(client, publish)) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(60));
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        close_socket(client);
    }
};

bool post_loopback(uint16_t port, const std::string& payload, std::string& response,
                   const std::string& extra_headers = std::string()) {
    if (!wsa_init()) return false;
    SocketFd s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == kInvalidSocket) {
        wsa_cleanup();
        return false;
    }
    set_socket_timeouts(s, 5000);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    if (::connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        close_socket(s);
        wsa_cleanup();
        return false;
    }

    std::ostringstream req;
    req << "POST / HTTP/1.1\r\n"
        << "Host: 127.0.0.1:" << port << "\r\n"
        << "Content-Type: application/json\r\n"
        << "Content-Length: " << payload.size() << "\r\n"
        << extra_headers
        << "Connection: close\r\n\r\n"
        << payload;

    const std::string wire = req.str();
    if (!send_all_blocking(s, wire)) {
        close_socket(s);
        wsa_cleanup();
        return false;
    }

    char buf[512];
    for (;;) {
        const int n = static_cast<int>(::recv(s, buf, sizeof(buf), 0));
        if (n <= 0) break;
        response.append(buf, static_cast<size_t>(n));
    }
    close_socket(s);
    wsa_cleanup();
    return response.find("202 Accepted") != std::string::npos;
}

bool approximately(double a, double b) {
    return std::fabs(a - b) < 0.000001;
}

// Prove the registry-injected signal propagated into the causal graph nodes and
// that the propagation is deterministic. This is the core of intent #3: the
// field/crisis signal must MOVE graph node state, not merely cross the
// connector->registry boundary.
bool verify_graph_propagation(EngineState& state,
                              double expected_coeff,
                              int expected_crisis) {
    using namespace caelus::causal;
    CausalEngine& engine = state.engine;

    const Node* actor = engine.get_node("Actor_Alpha");
    const Node* gate  = engine.get_node("Regulatory_Gate");
    if (!actor || !gate) {
        std::cerr << "causal graph node missing (Actor_Alpha/Regulatory_Gate)\n";
        return false;
    }

    auto close_fp = [](int64_t a, int64_t b) {
        const int64_t d = a - b;
        return (d < 0 ? -d : d) <= 1000;  // 0.001 fixed-point tolerance
    };

    // (a) Field coefficient must land on the primary actor node (state was 0).
    const int64_t expect_actor = d_to_fp(expected_coeff);
    if (actor->state_fp <= 0 || !close_fp(actor->state_fp, expect_actor)) {
        std::cerr << "Actor_Alpha.state_fp=" << actor->state_fp
                  << " expected ~" << expect_actor << "\n";
        return false;
    }
    // (b) Crisis level must move the regulatory gate node (state was 0).
    const int64_t expect_gate = d_to_fp(expected_crisis * 0.10);
    if (gate->state_fp <= 0 || !close_fp(gate->state_fp, expect_gate)) {
        std::cerr << "Regulatory_Gate.state_fp=" << gate->state_fp
                  << " expected ~" << expect_gate << "\n";
        return false;
    }

    // (c) Tick propagation must raise friction above the 1.0x blank-slate baseline.
    const double baseline = engine.friction_multiplier();
    const EngineSnapshot snap = engine.run_ticks(3);
    const double propagated = snap.clamped_friction_d();
    if (!(propagated > baseline + 1e-6) || !(propagated > 1.0 + 1e-6)) {
        std::cerr << "friction did not propagate: baseline=" << baseline
                  << " propagated=" << propagated << "\n";
        return false;
    }

    // (d) Determinism: an independent engine fed the same signal reproduces the
    //     exact fixed-point friction (no network, no shared state).
    CausalEngine replay;
    replay.load_universal_blank_slate();
    replay.inject_intel(expected_coeff, expected_crisis, "determinism-replay");
    const EngineSnapshot rsnap = replay.run_ticks(3);
    if (rsnap.clamped_friction_fp != snap.clamped_friction_fp) {
        std::cerr << "non-deterministic friction: live=" << snap.clamped_friction_fp
                  << " replay=" << rsnap.clamped_friction_fp << "\n";
        return false;
    }

    std::cout << "[SMOKE OK] causal graph propagation: Actor_Alpha="
              << fp_to_d(actor->state_fp) << " Regulatory_Gate="
              << fp_to_d(gate->state_fp) << " | friction "
              << baseline << "x -> " << propagated
              << "x (deterministic fp=" << snap.clamped_friction_fp << ")\n";
    return true;
}

template<typename Connector>
bool drain_through_registry(Connector& connector,
                            const CaelusPluginVTable* vtbl,
                            CaelusEngineFns& fns,
                            EngineState& state,
                            double expected_coeff,
                            uint8_t expected_crisis,
                            const char* expected_memo,
                            bool verify_graph = true) {
    for (int attempt = 0; attempt < 80; ++attempt) {
        CaelusIntelEvent events[4]{};
        size_t count = 0;
        if (vtbl->pull_intel(&connector, events, 4, &count) && count > 0) {
            for (size_t i = 0; i < count; ++i) {
                const size_t memo_len = std::strlen(events[i].memo);
                if (!fns.inject_intel(fns.engine_ctx,
                                      events[i].friction_coeff,
                                      events[i].crisis_level,
                                      events[i].memo,
                                      memo_len)) {
                    std::cerr << "registry inject_intel callback failed\n";
                    return false;
                }
            }

            if (state.injected.empty()) return false;
            const CaelusIntelEvent& got = state.injected.back();
            if (!approximately(got.friction_coeff, expected_coeff) ||
                got.crisis_level != expected_crisis ||
                std::string(got.memo).find(expected_memo) == std::string::npos) {
                std::cerr << "unexpected event: coeff=" << got.friction_coeff
                          << " crisis=" << static_cast<int>(got.crisis_level)
                          << " memo=" << got.memo << "\n";
                return false;
            }
            // Boundary reached → now prove graph-node propagation (intent #3).
            // verify_graph=false is used by follow-up injects into an engine
            // whose graph already absorbed a prior event (boundary-only check).
            if (!verify_graph) return true;
            return verify_graph_propagation(state, expected_coeff,
                                            static_cast<int>(expected_crisis));
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    std::cerr << "timed out waiting for connector event\n";
    return false;
}

// Assert that NO intel event surfaces from the connector for wait_ms — used to
// prove rejected (unauthenticated) payloads never reach the pull/inject path.
template<typename Connector>
bool expect_no_intel(Connector& connector, const CaelusPluginVTable* vtbl,
                     unsigned wait_ms) {
    const auto until = std::chrono::steady_clock::now() +
                       std::chrono::milliseconds(wait_ms);
    while (std::chrono::steady_clock::now() < until) {
        CaelusIntelEvent events[4]{};
        size_t count = 0;
        if (vtbl->pull_intel(&connector, events, 4, &count) && count > 0) {
            std::cerr << "rejected intel unexpectedly reached the queue (count="
                      << count << ")\n";
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    return true;
}

bool run_zapier_smoke() {
    // Scenario (c): token UNSET → legacy unauthenticated behaviour must hold.
    unset_env_var("CAELUS_INTEL_TOKEN");
    const uint16_t port = reserve_loopback_port();
    if (port == 0) {
        std::cerr << "could not reserve loopback port for Zapier smoke\n";
        return false;
    }
    set_env_var("CAELUS_ZAPIER_WEBHOOK_PORT", std::to_string(port));

    EngineState state{};
    CaelusEngineFns fns = make_engine_fns(state);
    caelus::ZapierWebhookConnector connector;
    const CaelusPluginVTable* vtbl = caelus::ZapierWebhookConnector::make_vtable();
    if (!vtbl || !vtbl->init || !vtbl->pull_intel || !vtbl->cleanup) return false;
    if (!vtbl->init(&connector, &fns)) {
        std::cerr << "ZapierWebhookConnector init failed\n";
        return false;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    std::string response;
    const bool posted = post_loopback(port, "0.82,2,zapier smoke csv", response);
    const bool ok = posted &&
        drain_through_registry(connector, vtbl, fns, state, 0.82, 2, "zapier smoke csv");
    vtbl->cleanup(&connector);
    if (!posted) std::cerr << "Zapier POST failed, response=" << response << "\n";
    if (ok) std::cout << "[SMOKE OK] ZapierWebhookConnector loopback POST reached registry inject callback\n";
    return ok;
}

bool run_mqtt_smoke() {
    // Scenario (c): token UNSET → legacy unauthenticated behaviour must hold.
    unset_env_var("CAELUS_INTEL_TOKEN");
    FakeMqttBroker broker(
        {"{\"friction_coeff\":0.82,\"crisis_level\":2,\"memo\":\"mqtt smoke json\"}"});
    if (!broker.start() || broker.port() == 0) {
        std::cerr << "fake MQTT broker failed to start\n";
        return false;
    }

    set_env_var("CAELUS_MQTT_HOST", "127.0.0.1");
    set_env_var("CAELUS_MQTT_PORT", std::to_string(broker.port()));
    set_env_var("CAELUS_MQTT_TOPIC", "caelus/intel");
    set_env_var("CAELUS_MQTT_CLIENT_ID", "caelus-smoke-test");

    EngineState state{};
    CaelusEngineFns fns = make_engine_fns(state);
    caelus::MqttConnector connector;
    const CaelusPluginVTable* vtbl = caelus::MqttConnector::make_vtable();
    if (!vtbl || !vtbl->init || !vtbl->pull_intel || !vtbl->cleanup) return false;
    if (!vtbl->init(&connector, &fns)) {
        std::cerr << "MqttConnector init failed\n";
        broker.stop();
        return false;
    }

    const bool ok =
        drain_through_registry(connector, vtbl, fns, state, 0.82, 2, "mqtt smoke json");
    vtbl->cleanup(&connector);
    broker.stop();
    if (ok) std::cout << "[SMOKE OK] MqttConnector fake broker PUBLISH reached registry inject callback\n";
    return ok;
}

// Scenarios (a)+(b) for Zapier: CAELUS_INTEL_TOKEN set; wrong/missing auth must
// answer 401 and never touch the graph; header / JSON-member / CSV-line auth
// must all be accepted with the token stripped from the payload.
bool run_zapier_auth_smoke() {
    const uint16_t port = reserve_loopback_port();
    if (port == 0) {
        std::cerr << "could not reserve loopback port for Zapier auth smoke\n";
        return false;
    }
    set_env_var("CAELUS_ZAPIER_WEBHOOK_PORT", std::to_string(port));
    set_env_var("CAELUS_INTEL_TOKEN", kIntelTestToken);

    EngineState state{};
    CaelusEngineFns fns = make_engine_fns(state);
    caelus::ZapierWebhookConnector connector;
    const CaelusPluginVTable* vtbl = caelus::ZapierWebhookConnector::make_vtable();
    if (!vtbl || !vtbl->init || !vtbl->pull_intel || !vtbl->cleanup) return false;
    if (!vtbl->init(&connector, &fns)) {
        std::cerr << "ZapierWebhookConnector init failed (auth smoke)\n";
        unset_env_var("CAELUS_INTEL_TOKEN");
        return false;
    }

    bool ok = true;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    {   // (b) auth tamamen eksik → 401
        std::string resp;
        if (post_loopback(port, "0.82,2,zapier auth eksik", resp) ||
            resp.find("401") == std::string::npos) {
            std::cerr << "missing-auth POST was not rejected: " << resp << "\n";
            ok = false;
        }
    }
    {   // (b) JSON govdesinde yanlis "auth" → 401
        std::string resp;
        if (post_loopback(port,
                          "{\"auth\":\"WRONG-TOKEN\",\"friction_coeff\":0.9,"
                          "\"crisis_level\":3,\"memo\":\"zapier auth yanlis\"}",
                          resp) ||
            resp.find("401") == std::string::npos) {
            std::cerr << "wrong-json-auth POST was not rejected: " << resp << "\n";
            ok = false;
        }
    }
    {   // (b) yanlis X-Caelus-Auth basligi → 401
        std::string resp;
        if (post_loopback(port, "0.7,1,zapier header yanlis", resp,
                          "X-Caelus-Auth: definitely-not-the-token\r\n") ||
            resp.find("401") == std::string::npos) {
            std::cerr << "wrong-header POST was not rejected: " << resp << "\n";
            ok = false;
        }
    }

    // Rejects must never surface: no pull event, no inject, untouched graph.
    if (!expect_no_intel(connector, vtbl, 300)) ok = false;
    if (!state.injected.empty()) {
        std::cerr << "rejected intel reached inject_intel callback\n";
        ok = false;
    }
    {
        const caelus::causal::Node* actor = state.engine.get_node("Actor_Alpha");
        if (!actor || actor->state_fp != 0) {
            std::cerr << "graph mutated by rejected intel\n";
            ok = false;
        }
    }

    if (ok) {  // (a) dogru X-Caelus-Auth basligi + CSV govde → kabul + graf propagasyonu
        std::string resp;
        const std::string hdr = std::string("X-Caelus-Auth: ") + kIntelTestToken + "\r\n";
        if (!post_loopback(port, "0.82,2,zapier auth header ok", resp, hdr)) {
            std::cerr << "header-auth POST rejected: " << resp << "\n";
            ok = false;
        } else {
            ok = drain_through_registry(connector, vtbl, fns, state,
                                        0.82, 2, "zapier auth header ok") && ok;
        }
    }
    if (ok) {  // (a) JSON "auth" alani → kabul (sinir dogrulamasi)
        std::string resp;
        const std::string body = std::string("{\"auth\":\"") + kIntelTestToken +
            "\",\"friction_coeff\":0.61,\"crisis_level\":1,"
            "\"memo\":\"zapier auth json ok\"}";
        if (!post_loopback(port, body, resp)) {
            std::cerr << "json-auth POST rejected: " << resp << "\n";
            ok = false;
        } else {
            ok = drain_through_registry(connector, vtbl, fns, state,
                                        0.61, 1, "zapier auth json ok",
                                        /*verify_graph=*/false) && ok;
        }
    }
    if (ok) {  // (a) CSV ilk satir "#auth=" → kabul; coeff=0.55 strip kanitidir
        std::string resp;
        const std::string body = std::string("#auth=") + kIntelTestToken +
            "\n0.55,1,zapier auth csvline ok";
        if (!post_loopback(port, body, resp)) {
            std::cerr << "csv-line-auth POST rejected: " << resp << "\n";
            ok = false;
        } else {
            ok = drain_through_registry(connector, vtbl, fns, state,
                                        0.55, 1, "zapier auth csvline ok",
                                        /*verify_graph=*/false) && ok;
        }
    }

    if (ok && state.injected.size() != 3) {
        std::cerr << "expected exactly 3 accepted intel events, got "
                  << state.injected.size() << "\n";
        ok = false;
    }
    if (ok) {  // token hicbir memo'ya sizmamali (strip kaniti)
        for (const CaelusIntelEvent& ev : state.injected) {
            if (std::string(ev.memo).find(kIntelTestToken) != std::string::npos) {
                std::cerr << "token leaked into memo: " << ev.memo << "\n";
                ok = false;
            }
        }
    }

    vtbl->cleanup(&connector);
    unset_env_var("CAELUS_INTEL_TOKEN");
    if (ok) {
        std::cout << "[SMOKE OK] Zapier auth: eksik/yanlis auth 401 ile reddedildi; "
                     "header/JSON/CSV auth kabul edildi (token memo'ya sizmadi)\n";
    }
    return ok;
}

// Scenarios (a)+(b) for MQTT: broker publishes missing-auth, wrong-auth, then a
// correctly authenticated payload over one ordered TCP stream. Only the last
// may inject; TCP ordering proves the first two were dropped, not delayed.
bool run_mqtt_auth_smoke() {
    const std::string good_payload = std::string("{\"auth\":\"") + kIntelTestToken +
        "\",\"friction_coeff\":0.82,\"crisis_level\":2,\"memo\":\"mqtt auth ok\"}";
    FakeMqttBroker broker({
        "{\"friction_coeff\":0.5,\"crisis_level\":1,\"memo\":\"mqtt auth eksik\"}",
        "{\"auth\":\"WRONG-TOKEN\",\"friction_coeff\":0.6,\"crisis_level\":3,"
        "\"memo\":\"mqtt auth yanlis\"}",
        good_payload,
    });
    if (!broker.start() || broker.port() == 0) {
        std::cerr << "fake MQTT broker failed to start (auth smoke)\n";
        return false;
    }

    set_env_var("CAELUS_MQTT_HOST", "127.0.0.1");
    set_env_var("CAELUS_MQTT_PORT", std::to_string(broker.port()));
    set_env_var("CAELUS_MQTT_TOPIC", "caelus/intel");
    set_env_var("CAELUS_MQTT_CLIENT_ID", "caelus-smoke-auth");
    set_env_var("CAELUS_INTEL_TOKEN", kIntelTestToken);

    EngineState state{};
    CaelusEngineFns fns = make_engine_fns(state);
    caelus::MqttConnector connector;
    const CaelusPluginVTable* vtbl = caelus::MqttConnector::make_vtable();
    if (!vtbl || !vtbl->init || !vtbl->pull_intel || !vtbl->cleanup) return false;
    if (!vtbl->init(&connector, &fns)) {
        std::cerr << "MqttConnector init failed (auth smoke)\n";
        broker.stop();
        unset_env_var("CAELUS_INTEL_TOKEN");
        return false;
    }

    bool ok = drain_through_registry(connector, vtbl, fns, state,
                                     0.82, 2, "mqtt auth ok");
    if (ok) ok = expect_no_intel(connector, vtbl, 250);
    if (ok && state.injected.size() != 1) {
        std::cerr << "expected exactly 1 accepted intel event, got "
                  << state.injected.size() << "\n";
        ok = false;
    }
    if (ok && std::string(state.injected.back().memo).find(kIntelTestToken) !=
                  std::string::npos) {
        std::cerr << "token leaked into memo: " << state.injected.back().memo << "\n";
        ok = false;
    }

    vtbl->cleanup(&connector);
    broker.stop();
    unset_env_var("CAELUS_INTEL_TOKEN");
    if (ok) {
        std::cout << "[SMOKE OK] MQTT auth: auth'suz/yanlis PUBLISH'ler dusuruldu; "
                     "dogru auth kabul edildi ve graf'a ulasti\n";
    }
    return ok;
}

} // namespace

// ─── Signature-layer scenarios (d)+(e) ──────────────────────────────────────
// Deterministic stub "signature": first 8 bytes = FNV-1a64(msg) little-endian,
// rest zero. Same shape as the ed25519 hook, so the full gate path (envelope
// parse, pin memcmp, byte-exact signed region, strip) is exercised without
// linking the Rust staticlib.

constexpr const char kIntelTestPinHex[] =
    "1111111111111111111111111111111111111111111111111111111111111111";
constexpr const char kIntelWrongPinHex[] =
    "2222222222222222222222222222222222222222222222222222222222222222";

uint64_t fnv1a64(const uint8_t* p, size_t n) {
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < n; ++i) { h ^= p[i]; h *= 1099511628211ULL; }
    return h;
}

uint8_t stub_sig_verify(const uint8_t* msg, size_t len,
                        const uint8_t* pub, const uint8_t* sig) {
    (void)pub;
    const uint64_t h = fnv1a64(msg, len);
    for (int i = 0; i < 8; ++i) {
        if (sig[i] != static_cast<uint8_t>(h >> (8 * i))) return 0;
    }
    for (int i = 8; i < 64; ++i) {
        if (sig[i] != 0) return 0;
    }
    return 1;
}

std::string stub_sign_envelope(const std::string& body, const char* pub_hex) {
    std::string msg = std::string("CAELUS_INTEL_V1\n") + body;
    const uint64_t h = fnv1a64(reinterpret_cast<const uint8_t*>(msg.data()), msg.size());
    uint8_t sig[64] = {};
    for (int i = 0; i < 8; ++i) sig[i] = static_cast<uint8_t>(h >> (8 * i));
    static const char* hexd = "0123456789abcdef";
    std::string sig_hex;
    sig_hex.reserve(128);
    for (int i = 0; i < 64; ++i) {
        sig_hex.push_back(hexd[sig[i] >> 4]);
        sig_hex.push_back(hexd[sig[i] & 0x0f]);
    }
    return std::string("#sig=ed25519:") + pub_hex + ":" + sig_hex + "\n" + body;
}

bool gate_check(bool cond, const char* what, bool& ok) {
    if (!cond) {
        std::cerr << "[GATE] FAIL: " << what << "\n";
        ok = false;
    }
    return cond;
}

// Direct IntelAuthGate::admit() semantics, no sockets: deterministic and fast.
bool run_gate_unit_checks() {
    using caelus::connector_detail::IntelAuthGate;
    using caelus::connector_detail::set_intel_sig_verifier;
    bool ok = true;
    const std::string body = "0.5,1,gate unit";

    unset_env_var("CAELUS_INTEL_TOKEN");
    set_env_var("CAELUS_TRUSTED_INTEL_PUBKEY", kIntelTestPinHex);

    {   // (e) pin set + verifier hook NOT installed -> fail closed
        set_intel_sig_verifier(nullptr);
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = stub_sign_envelope(body, kIntelTestPinHex);
        gate_check(!gate.admit(raw, false), "no-verifier must reject", ok);
    }

    set_intel_sig_verifier(&stub_sig_verify);
    {   // (d) valid envelope -> accepted, envelope stripped byte-exactly
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = stub_sign_envelope(body, kIntelTestPinHex);
        gate_check(gate.admit(raw, false), "valid signature must pass", ok);
        gate_check(raw == body, "envelope must be stripped to exact body", ok);
    }
    {   // (e) unsigned payload -> rejected while pin set
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = body;
        gate_check(!gate.admit(raw, false), "unsigned must be rejected", ok);
    }
    {   // (e) leading whitespace breaks byte-exact envelope -> unsigned -> reject
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = " " + stub_sign_envelope(body, kIntelTestPinHex);
        gate_check(!gate.admit(raw, false), "leading-space envelope must reject", ok);
    }
    {   // (e) malformed envelope -> reject (never demoted to unsigned)
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = std::string("#sig=ed25519:deadbeef\n") + body;
        gate_check(!gate.admit(raw, false), "malformed envelope must reject", ok);
    }
    {   // (e) wrong pubkey (valid stub sig) -> pin mismatch reject
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = stub_sign_envelope(body, kIntelWrongPinHex);
        gate_check(!gate.admit(raw, false), "wrong pubkey must reject", ok);
    }
    {   // (e) tampered body after signing -> reject
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = stub_sign_envelope(body, kIntelTestPinHex);
        raw[raw.size() - 1] ^= 1;  // flip last body byte
        gate_check(!gate.admit(raw, false), "tampered body must reject", ok);
    }
    {   // (e) transport auth must NOT bypass the signature layer
        set_env_var("CAELUS_INTEL_TOKEN", kIntelTestToken);
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = body;
        gate_check(!gate.admit(raw, true), "header auth must not bypass signature", ok);
        unset_env_var("CAELUS_INTEL_TOKEN");
    }
    {   // (e) present-but-invalid pin env -> reject everything
        set_env_var("CAELUS_TRUSTED_INTEL_PUBKEY", "not-hex-at-all");
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = stub_sign_envelope(body, kIntelTestPinHex);
        gate_check(!gate.admit(raw, false), "invalid pin must reject", ok);
        set_env_var("CAELUS_TRUSTED_INTEL_PUBKEY", kIntelTestPinHex);
    }

    unset_env_var("CAELUS_TRUSTED_INTEL_PUBKEY");
    {   // pin unset: stray valid envelope is stripped, payload accepted (legacy)
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = stub_sign_envelope(body, kIntelTestPinHex);
        gate_check(gate.admit(raw, false), "pin unset must accept legacy", ok);
        gate_check(raw == body, "stray envelope must still be stripped", ok);
    }
    {   // pin unset: malformed envelope is still rejected (hygiene)
        IntelAuthGate gate;
        gate.init("gate-unit");
        std::string raw = std::string("#sig=bogus\n") + body;
        gate_check(!gate.admit(raw, false), "malformed envelope rejects even unpinned", ok);
    }

    std::cout << "[SMOKE] gate unit checks " << (ok ? "OK" : "FAILED") << "\n";
    return ok;
}

// (d)+(e) end-to-end over the Zapier HTTP path: signed accept propagates to the
// graph, unsigned/tampered answer 401 and never reach pull/inject.
bool run_zapier_sig_smoke() {
    const uint16_t port = reserve_loopback_port();
    if (port == 0) {
        std::cerr << "could not reserve loopback port for Zapier sig smoke\n";
        return false;
    }
    set_env_var("CAELUS_ZAPIER_WEBHOOK_PORT", std::to_string(port));
    unset_env_var("CAELUS_INTEL_TOKEN");
    set_env_var("CAELUS_TRUSTED_INTEL_PUBKEY", kIntelTestPinHex);
    caelus::connector_detail::set_intel_sig_verifier(&stub_sig_verify);

    EngineState state{};
    CaelusEngineFns fns = make_engine_fns(state);
    caelus::ZapierWebhookConnector connector;
    const CaelusPluginVTable* vtbl = caelus::ZapierWebhookConnector::make_vtable();
    if (!vtbl || !vtbl->init || !vtbl->pull_intel || !vtbl->cleanup) return false;
    if (!vtbl->init(&connector, &fns)) {
        std::cerr << "ZapierWebhookConnector init failed (sig smoke)\n";
        unset_env_var("CAELUS_TRUSTED_INTEL_PUBKEY");
        return false;
    }

    bool ok = true;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    {   // (e) imzasiz govde -> 401
        std::string resp;
        if (post_loopback(port, "0.82,2,zapier imzasiz", resp) ||
            resp.find("401") == std::string::npos) {
            std::cerr << "unsigned POST was not rejected: " << resp << "\n";
            ok = false;
        }
    }
    {   // (e) imza sonrasi kurcalanan govde -> 401
        std::string signed_body = stub_sign_envelope("0.9,3,zapier tamper", kIntelTestPinHex);
        signed_body[signed_body.size() - 1] ^= 1;
        std::string resp;
        if (post_loopback(port, signed_body, resp) ||
            resp.find("401") == std::string::npos) {
            std::cerr << "tampered POST was not rejected: " << resp << "\n";
            ok = false;
        }
    }

    // Rejects must never surface: no pull event, no inject, untouched graph.
    if (!expect_no_intel(connector, vtbl, 300)) ok = false;
    if (!state.injected.empty()) {
        std::cerr << "rejected signed intel reached inject_intel callback\n";
        ok = false;
    }

    if (ok) {  // (d) gecerli imzali CSV -> kabul + graf propagasyonu
        std::string resp;
        const std::string body =
            stub_sign_envelope("0.82,2,zapier sig ok", kIntelTestPinHex);
        if (!post_loopback(port, body, resp)) {
            std::cerr << "signed POST rejected: " << resp << "\n";
            ok = false;
        } else {
            ok = drain_through_registry(connector, vtbl, fns, state,
                                        0.82, 2, "zapier sig ok") && ok;
        }
    }

    vtbl->cleanup(&connector);
    unset_env_var("CAELUS_TRUSTED_INTEL_PUBKEY");
    unset_env_var("CAELUS_ZAPIER_WEBHOOK_PORT");
    std::cout << "[SMOKE] zapier signature smoke " << (ok ? "OK" : "FAILED") << "\n";
    return ok;
}

int main(int argc, char** argv) {
    std::string mode = "all";
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--only" && i + 1 < argc) mode = argv[++i];
    }

    bool ok = true;
    if (mode == "all" || mode == "zapier") {
        ok = run_gate_unit_checks() && ok;   // (d)+(e) imza kapisi semantigi
        ok = run_zapier_smoke() && ok;       // (c) token UNSET → legacy
        ok = run_zapier_auth_smoke() && ok;  // (a)+(b) token SET kabul/ret
        ok = run_zapier_sig_smoke() && ok;   // (d)+(e) imza uctan uca
    }
    if (mode == "all" || mode == "mqtt") {
        ok = run_mqtt_smoke() && ok;         // (c) token UNSET → legacy
        ok = run_mqtt_auth_smoke() && ok;    // (a)+(b) token SET kabul/ret
    }
    if (mode == "all") {
        // (c) devamı: token SET edilip UNSET edildikten sonra eski davranışın
        // geri geldiğini kanıtla (gate env'i her init'te yeniden okur).
        std::cout << "[SMOKE] token UNSET sonrasi eski davranis yeniden dogrulaniyor\n";
        ok = run_zapier_smoke() && ok;
    }
    if (mode != "all" && mode != "zapier" && mode != "mqtt") {
        std::cerr << "unknown --only mode: " << mode << "\n";
        return 2;
    }
    return ok ? 0 : 1;
}
"""


def find_compiler() -> tuple[str, list[str]]:
    override = os.environ.get("CAELUS_CXX", "").strip()
    if override.upper() == "MSVC":
        if shutil.which("cl.exe") or shutil.which("cl"):
            return "MSVC", ["cl.exe"]
        raise RuntimeError("CAELUS_CXX=MSVC istendi ama cl.exe bulunamadi")
    if override.upper() == "GCC":
        gxx = shutil.which("g++")
        if gxx:
            return "GCC", [gxx]
        raise RuntimeError("CAELUS_CXX=GCC istendi ama g++ bulunamadi")
    if override:
        name = Path(override).name.lower()
        return ("MSVC" if name in {"cl", "cl.exe"} else "GCC"), [override]

    gxx = shutil.which("g++")
    if gxx:
        return "GCC", [gxx]
    if shutil.which("cl.exe") or shutil.which("cl"):
        return "MSVC", ["cl.exe"]
    raise RuntimeError("C++ derleyici bulunamadi (g++ veya cl.exe gerekli)")


def compile_command(tool: str, compiler: list[str]) -> list[str]:
    # project_root is required so causal_engine.h's `#include "src/intel_core.h"`
    # resolves (it is written relative to the repo root, like the main build).
    project_root = str(ROOT)
    include_root = str(ROOT / "include")
    include_src = str(ROOT / "src")
    source = str(HARNESS_CPP)
    output = str(HARNESS_EXE)
    if tool == "MSVC":
        return [
            *compiler,
            "/nologo",
            "/std:c++17",
            "/O2",
            "/EHsc",
            f"/I{project_root}",
            f"/I{include_root}",
            f"/I{include_src}",
            source,
            f"/Fe:{output}",
            "/link",
            "/INCREMENTAL:NO",
            "ws2_32.lib",
        ]
    cmd = [
        *compiler,
        "-std=c++17",
        "-O2",
        f"-I{project_root}",
        f"-I{include_root}",
        f"-I{include_src}",
        source,
        "-o",
        output,
    ]
    if os.name == "nt":
        cmd.append("-lws2_32")
    else:
        cmd.append("-pthread")
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser(description="CAELUS connector smoke tests")
    parser.add_argument("--dry-run", action="store_true", help="derleme/kosum yapmadan plan ve araclari dogrula")
    parser.add_argument("--only", choices=("all", "mqtt", "zapier"), default="all")
    parser.add_argument("--keep", action="store_true", help="gecici harness kaynagini koru")
    args = parser.parse_args()

    try:
        tool, compiler = find_compiler()
    except RuntimeError as exc:
        print(f"[SMOKE FAIL] {exc}", file=sys.stderr)
        return 1

    cmd = compile_command(tool, compiler)

    print(f"[SMOKE] root={ROOT}")
    print(f"[SMOKE] compiler={tool} ({' '.join(compiler)})")
    print(f"[SMOKE] harness={HARNESS_CPP}")
    print(f"[SMOKE] output={HARNESS_EXE}")
    if args.dry_run:
        print(f"[SMOKE] compile={' '.join(cmd)}")
        print("[SMOKE OK] dry-run tamamlandi")
        return 0

    BUILD_DIR.mkdir(exist_ok=True)
    HARNESS_CPP.write_text(textwrap.dedent(HARNESS_SOURCE).lstrip(), encoding="utf-8")

    build = subprocess.run(cmd, cwd=ROOT)
    if build.returncode != 0:
        print(f"[SMOKE FAIL] harness derlenemedi (exit={build.returncode})", file=sys.stderr)
        return build.returncode

    run = subprocess.run([str(HARNESS_EXE), "--only", args.only], cwd=ROOT)
    if run.returncode != 0:
        print(f"[SMOKE FAIL] connector smoke basarisiz (exit={run.returncode})", file=sys.stderr)
        return run.returncode

    if not args.keep:
        # Keep the executable for fast local reruns; the generated source is disposable.
        try:
            HARNESS_CPP.unlink()
        except OSError:
            pass

    print("[SMOKE OK] connector smoke testleri gecti")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
