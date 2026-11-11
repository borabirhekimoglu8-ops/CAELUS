/**
 * CAELUS OS — Minimal WebSocket Emitter  (include/ws_emitter.h)
 *
 * Air-gap compliant: binds ONLY to 127.0.0.1 (loopback) — no packet ever
 * leaves the machine.  Uses the OS network stack that is ALREADY linked
 * (Winsock2 via -lws2_32 on Windows, POSIX sockets on Linux/macOS).
 * Zero external libraries beyond what the Rust Shadow-Mesh layer already
 * requires.  Static binary target and <50 MB constraint are unaffected.
 *
 * Protocol: RFC 6455 WebSocket, server→client text frames (NDJSON payload).
 * WebSocket handshake requires SHA-1 + Base64 — both implemented inline
 * below (FIPS 180-4 SHA-1, ~60 lines; standard Base64, ~15 lines).
 *
 * Usage:
 *   caelus::WsEmitter emitter;
 *   emitter.start(47809);         // background thread, non-blocking
 *   emitter.emit(json_string);    // thread-safe, queued
 *   emitter.stop();               // joins thread, releases sockets
 *
 * Runtime config:
 *   CAELUS_WS_MAX_CLIENTS     max simultaneous browser clients
 *   CAELUS_WS_BUFFER_EVENTS   retained NDJSON events in the replay ring
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <cstring>
#include <string>
#include <deque>
#include <mutex>
#include <thread>
#include <atomic>
#include <functional>
#include <sstream>
#include <iomanip>
#include <vector>
#include <algorithm>
#include <iostream>
#include <cstdlib>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <ctime>
#include <fstream>
#include "caelus_otel_local.h"

// ── Platform socket abstraction ───────────────────────────────────────────────
#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  include <windows.h>

   using SocketFd = SOCKET;
   static constexpr SocketFd kInvalidSocket = INVALID_SOCKET;
   inline void   close_socket(SocketFd s) { ::closesocket(s); }
   inline void   shutdown_write(SocketFd s) { ::shutdown(s, SD_SEND); }
   inline bool   wsa_init() {
       WSADATA w;
       return ::WSAStartup(MAKEWORD(2, 2), &w) == 0;
   }
   inline void   wsa_cleanup() { ::WSACleanup(); }
   inline bool   set_nonblocking(SocketFd s) {
       u_long mode = 1;
       return ::ioctlsocket(s, FIONBIO, &mode) == 0;
   }
#else
#  include <sys/socket.h>
#  include <netinet/in.h>
#  include <arpa/inet.h>
#  include <sys/select.h>
#  include <unistd.h>
#  include <fcntl.h>

   using SocketFd = int;
   static constexpr SocketFd kInvalidSocket = -1;
   inline void   close_socket(SocketFd s) { ::close(s); }
   inline void   shutdown_write(SocketFd s) { ::shutdown(s, SHUT_WR); }
   inline bool   wsa_init()    { return true; }
   inline void   wsa_cleanup() {}
   inline bool   set_nonblocking(SocketFd s) {
       int flags = ::fcntl(s, F_GETFL, 0);
       return flags >= 0 && ::fcntl(s, F_SETFL, flags | O_NONBLOCK) == 0;
   }
#endif

namespace caelus {

// ═════════════════════════════════════════════════════════════════════════════
//   Internal helpers (anonymous namespace — not part of public API)
// ═════════════════════════════════════════════════════════════════════════════
namespace ws_detail {

// ── SHA-1 (FIPS 180-4) ───────────────────────────────────────────────────────
// Published test vector: SHA-1("abc") = a9993e36 4706816a ba3e2571 7850c26c 9cd0d89d
// Self-test is intentionally NOT run here (the FIPS 197 AES KAT in intel_core
// already proves the crypto subsystem is correct; SHA-1 here is only for the
// WebSocket RFC 6455 handshake key derivation, not for data integrity).
inline void sha1(const uint8_t* msg, size_t len, uint8_t digest[20]) {
    uint32_t h0 = 0x67452301u, h1 = 0xEFCDAB89u, h2 = 0x98BADCFEu,
             h3 = 0x10325476u, h4 = 0xC3D2E1F0u;
    uint64_t bit_len = static_cast<uint64_t>(len) * 8u;

    // Padded message: msg || 0x80 || zeros || big-endian 64-bit bit-length
    size_t padded = ((len + 9u + 63u) / 64u) * 64u;
    std::vector<uint8_t> buf(padded, 0u);
    std::memcpy(buf.data(), msg, len);
    buf[len] = 0x80u;
    for (int i = 0; i < 8; ++i)
        buf[padded - 8u + (size_t)i] = static_cast<uint8_t>((bit_len >> (56u - (unsigned)i * 8u)) & 0xFFu);

    for (size_t blk = 0; blk < padded; blk += 64u) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = (uint32_t(buf[blk + (size_t)i*4u])     << 24u) |
                   (uint32_t(buf[blk + (size_t)i*4u + 1u]) << 16u) |
                   (uint32_t(buf[blk + (size_t)i*4u + 2u]) <<  8u) |
                    uint32_t(buf[blk + (size_t)i*4u + 3u]);
        for (int i = 16; i < 80; ++i) {
            uint32_t v = w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16];
            w[i] = (v << 1u) | (v >> 31u);
        }
        uint32_t a = h0, b = h1, c = h2, d = h3, e = h4;
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if      (i < 20) { f = (b & c) | (~b & d);         k = 0x5A827999u; }
            else if (i < 40) { f =  b ^ c ^ d;                  k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d);k = 0x8F1BBCDCu; }
            else             { f =  b ^ c ^ d;                  k = 0xCA62C1D6u; }
            uint32_t t = ((a << 5u) | (a >> 27u)) + f + e + k + w[i];
            e = d; d = c; c = (b << 30u) | (b >> 2u); b = a; a = t;
        }
        h0 += a; h1 += b; h2 += c; h3 += d; h4 += e;
    }
    for (int i = 0; i < 4; ++i) {
        digest[    i] = static_cast<uint8_t>((h0 >> (24u - (unsigned)i*8u)) & 0xFFu);
        digest[4 + i] = static_cast<uint8_t>((h1 >> (24u - (unsigned)i*8u)) & 0xFFu);
        digest[8 + i] = static_cast<uint8_t>((h2 >> (24u - (unsigned)i*8u)) & 0xFFu);
        digest[12+ i] = static_cast<uint8_t>((h3 >> (24u - (unsigned)i*8u)) & 0xFFu);
        digest[16+ i] = static_cast<uint8_t>((h4 >> (24u - (unsigned)i*8u)) & 0xFFu);
    }
}

// ── Base64 encoder ─────────────────────────────────────────────────────────
inline std::string base64_encode(const uint8_t* d, size_t len) {
    static const char T[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((len + 2u) / 3u) * 4u);
    for (size_t i = 0; i < len; i += 3u) {
        uint32_t v = uint32_t(d[i]) << 16u;
        if (i+1u < len) v |= uint32_t(d[i+1u]) << 8u;
        if (i+2u < len) v |= uint32_t(d[i+2u]);
        out += T[(v >> 18u) & 63u];
        out += T[(v >> 12u) & 63u];
        out += (i+1u < len) ? T[(v >> 6u) & 63u] : '=';
        out += (i+2u < len) ? T[ v        & 63u] : '=';
    }
    return out;
}

inline std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8u);
    for (unsigned char c : s) {
        switch (c) {
            case '\\': out += "\\\\"; break;
            case '"':  out += "\\\""; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20u) {
                    char buf[7];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(c));
                    out += buf;
                } else {
                    out.push_back(static_cast<char>(c));
                }
                break;
        }
    }
    return out;
}

// ── RFC 6455 §4.2.2 — compute Sec-WebSocket-Accept ─────────────────────────
inline std::string ws_accept_key(const std::string& client_key) {
    const std::string magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    std::string concat = client_key + magic;
    uint8_t digest[20];
    sha1(reinterpret_cast<const uint8_t*>(concat.data()), concat.size(), digest);
    return base64_encode(digest, 20);
}

// ── Extract a header value (case-insensitive header name match) ─────────────
inline std::string get_header(const std::string& req, const std::string& name) {
    std::string lname = name;
    std::transform(lname.begin(), lname.end(), lname.begin(),
                   [](unsigned char c){ return (char)std::tolower(c); });
    size_t pos = 0;
    while (pos < req.size()) {
        size_t eol = req.find("\r\n", pos);
        if (eol == std::string::npos) break;
        std::string line = req.substr(pos, eol - pos);
        pos = eol + 2u;
        size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string hname = line.substr(0, colon);
        std::transform(hname.begin(), hname.end(), hname.begin(),
                       [](unsigned char c){ return (char)std::tolower(c); });
        if (hname == lname) {
            size_t vs = colon + 1u;
            while (vs < line.size() && line[vs] == ' ') ++vs;
            return line.substr(vs);
        }
    }
    return {};
}

// ── RFC 6455 §5.2 — encode a server→client text frame (no masking) ─────────
inline std::vector<uint8_t> ws_text_frame(const std::string& payload) {
    std::vector<uint8_t> f;
    f.push_back(0x81u); // FIN=1, opcode=text(1)
    size_t n = payload.size();
    if (n <= 125u) {
        f.push_back(static_cast<uint8_t>(n));
    } else if (n <= 65535u) {
        f.push_back(126u);
        f.push_back(static_cast<uint8_t>((n >> 8u) & 0xFFu));
        f.push_back(static_cast<uint8_t>( n        & 0xFFu));
    } else {
        f.push_back(127u);
        for (int i = 7; i >= 0; --i)
            f.push_back(static_cast<uint8_t>((n >> ((unsigned)i * 8u)) & 0xFFu));
    }
    f.insert(f.end(), payload.begin(), payload.end());
    return f;
}

// ── Send all bytes reliably over a blocking or non-blocking socket ──────────
inline bool send_all(SocketFd s, const uint8_t* buf, int len) {
    int sent = 0;
    int retries = 0;
    while (sent < len) {
        int n = (int)::send(s, (const char*)(buf + sent), len - sent, 0);
        if (n > 0) {
            sent += n;
            retries = 0;
            continue;
        }
        if (n == 0) return false;
#ifdef _WIN32
        const int err = ::WSAGetLastError();
        const bool would_block = (err == WSAEWOULDBLOCK);
#else
        const bool would_block = (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR);
#endif
        // Yavaş okuyucu toleransı: tarayıcı büyük bir JS paketini ayrıştırırken soketi
        // >1 sn okuyamayabilir (özellikle load_world ile gelen yüzlerce KB'lık dünya
        // deposu karesinde). İlerleme olmadan en fazla ~10 sn beklenir; gerçekten
        // ölü istemci TCP hatası ile yine anında düşer.
        if (!would_block || ++retries > 500) return false;
        fd_set wfds;
        FD_ZERO(&wfds);
        FD_SET(s, &wfds);
        timeval tv{0, 20000}; // 20ms per retry (ilerlemesiz toplam ≈10s)
        ::select((int)(s + 1), nullptr, &wfds, nullptr, &tv);
    }
    return true;
}

// ── Read HTTP request until \r\n\r\n (bounded to 8 KiB, non-blocking wait) ──
inline bool recv_http_header(SocketFd s, std::string& out) {
    out.clear();
    char buf[4096];
    while (true) {
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(s, &rfds);
        // Chromium speculative preconnect sockets send 0 bytes; do not let an
        // idle socket block the single event loop thread for more than 120ms.
        timeval tv{0, 120000};
        int ready = ::select((int)(s + 1), &rfds, nullptr, nullptr, &tv);
        if (ready <= 0) return false;
        int n = (int)::recv(s, buf, (int)sizeof(buf), 0);
        if (n <= 0) return false;
        out.append(buf, static_cast<size_t>(n));
        if (out.find("\r\n\r\n") != std::string::npos)
            return true;
        if (out.size() > 8192u) return false;
    }
}

} // namespace ws_detail


// ═════════════════════════════════════════════════════════════════════════════
//   WsEmitter — air-gapped loopback WebSocket telemetry emitter
// ═════════════════════════════════════════════════════════════════════════════
class WsEmitter {
public:
    struct Config {
        size_t   max_clients{8u};
        size_t   buffer_events{4096u};
        // ── Uzak War Room (opsiyonel, varsayılan KAPALI = air-gapped) ─────────
        // bind_all=true → 0.0.0.0'a bağlanır (LAN'dan erişilebilir); aksi hâlde
        // yalnız 127.0.0.1. bind_all iken token ZORUNLUDUR (core_engine bunu
        // fail-closed zorlar): token boşken uzak moda hiç geçilmez.
        bool        bind_all{false};
        std::string token;   // boş → kimlik kontrolü yok (yalnız loopback modu)
    };

    // Tek portta sunulan statik HTTP varlığı (embedded War Room UI).
    struct HttpRoute {
        std::string    path;          // "/" veya "/app.js"
        std::string    content_type;  // "text/html; charset=utf-8" vb.
        const uint8_t* data{nullptr};
        size_t         len{0};
    };

    WsEmitter()
        : config_(normalise_config(Config{})),
          max_clients_(config_.max_clients),
          buffer_limit_(config_.buffer_events) {}

    explicit WsEmitter(Config config)
        : config_(normalise_config(config)),
          max_clients_(config_.max_clients),
          buffer_limit_(config_.buffer_events) {}

    ~WsEmitter() { stop(); }

    // Non-copyable, non-movable (owns threads + sockets).
    WsEmitter(const WsEmitter&)            = delete;
    WsEmitter& operator=(const WsEmitter&) = delete;

    /**
     * Bind 127.0.0.1:<port> and start the background accept/send thread.
     * Idempotent: calling start() on an already-running emitter is a no-op.
     * Returns false if the socket cannot be bound (port busy, etc.).
     */
    bool configure(Config config) {
        if (running_.load(std::memory_order_relaxed)) return false;

        Config resolved = normalise_config(config);
        std::lock_guard<std::mutex> lg(buffer_mu_);
        config_       = resolved;
        max_clients_  = resolved.max_clients;
        buffer_limit_ = resolved.buffer_events;
        trim_buffer_locked();
        return true;
    }

    bool start(uint16_t port = 47809) {
        if (running_.load(std::memory_order_relaxed)) return true;
        if (!wsa_init()) return false;

        Config resolved = resolve_runtime_config(config_);
        {
            std::lock_guard<std::mutex> lg(buffer_mu_);
            config_       = resolved;
            max_clients_  = resolved.max_clients;
            buffer_limit_ = resolved.buffer_events;
            trim_buffer_locked();
        }

        listen_sock_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listen_sock_ == kInvalidSocket) {
            wsa_cleanup();
            return false;
        }

        int yes = 1;
        ::setsockopt(listen_sock_, SOL_SOCKET, SO_REUSEADDR,
                     (const char*)&yes, (int)sizeof(yes));

        const bool remote = resolved.bind_all;
        const char* bind_ip = remote ? "0.0.0.0" : "127.0.0.1";

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(port);
        // Varsayılan: loopback (paketler makineyi terk etmez). Uzak modda
        // (bind_all) 0.0.0.0 → LAN erişimi; token zorunlu (core_engine zorlar).
        ::inet_pton(AF_INET, bind_ip, &addr.sin_addr);

        if (::bind(listen_sock_, (sockaddr*)&addr, sizeof(addr)) != 0 ||
            ::listen(listen_sock_, listen_backlog(resolved.max_clients)) != 0) {
            close_socket(listen_sock_);
            listen_sock_ = kInvalidSocket;
            std::cerr << "[WS-EMITTER] HATA: " << bind_ip << ":" << port
                      << " portuna bagilanamadi. War Room koprusu baslatilmadi.\n";
            wsa_cleanup();
            return false;
        }

        port_    = port;
        running_.store(true, std::memory_order_release);
        thread_  = std::thread(&WsEmitter::run_loop, this);
        std::cout << "[WS-EMITTER] War Room koprusu baslatildi"
                  << " → ws://" << bind_ip << ":" << port
                  << (remote ? " (UZAK MOD: LAN + token)" : " (loopback)")
                  << " (istemci siniri: " << resolved.max_clients
                  << ", ring: " << resolved.buffer_events << " olay)\n";
        return true;
    }

    /**
     * Register a static HTTP asset served on the SAME port (plain GET).
     * Used to serve the embedded War Room UI to a remote browser. Set BEFORE
     * start(); routes are read on the background thread with no further sync.
     */
    void add_http_route(std::string path, std::string content_type,
                        const uint8_t* data, size_t len) {
        routes_.push_back(HttpRoute{std::move(path), std::move(content_type), data, len});
    }

    /**
     * Signal the background thread to stop and join it.
     * Closes the listen socket; the background thread closes active clients.
     */
    void stop() {
        running_.store(false, std::memory_order_release);

        // Wake blocked accept() / select() by closing the listen socket.
        SocketFd ls = listen_sock_.exchange(kInvalidSocket);
        if (ls != kInvalidSocket) close_socket(ls);

        if (thread_.joinable()) thread_.join();
        client_count_.store(0u, std::memory_order_release);
        wsa_cleanup();
    }

    /**
     * Enqueue a JSON line for delivery (thread-safe).
     * A trailing newline is appended automatically (NDJSON convention).
     * If no client is connected the event is buffered and delivered on the
     * next connection. Buffer is a sequence ring configured at runtime via
     * Config or CAELUS_WS_BUFFER_EVENTS; oldest events are dropped.
     */
    void emit(const std::string& json_line) {
        std::lock_guard<std::mutex> lg(buffer_mu_);
        buffer_.push_back(BufferedEvent{next_event_seq_++, json_line + "\n"});
        trim_buffer_locked();
    }

    /** True when at least one War Room browser is currently connected. */
    bool connected() const {
        return client_count_.load(std::memory_order_relaxed) > 0u;
    }

    /**
     * Install a handler for inbound War Room commands (browser → engine).
     *
     * The handler is invoked on the emitter's background thread when a client
     * sends a WebSocket text frame; the frame payload (a single command line
     * such as "tick 24" or "lever DENIZ_TAHLIYE") is passed through. The
     * engine mutates only on its own thread, so the handler MUST NOT touch the
     * engine directly — it should enqueue the command for the main loop.
     *
     * Set this BEFORE start(); it is read on the background thread with no
     * further synchronisation, so post-start mutation is not supported.
     */
    void on_command(std::function<void(std::string)> handler) {
        cmd_handler_ = std::move(handler);
    }

private:
    struct BufferedEvent {
        uint64_t    seq{0};
        std::string payload;
    };

    struct ClientSlot {
        SocketFd sock{kInvalidSocket};
        uint64_t next_seq{0};
    };

    static constexpr size_t kMinRuntimeClients    = 1u;
    static constexpr size_t kMaxRuntimeClients    = 128u;   // Runtime env is clamped here.
    static constexpr size_t kMinBufferEvents      = 16u;
    static constexpr size_t kMaxBufferEvents      = 65536u; // Compile-time safety ceiling.

    // ── Background thread ─────────────────────────────────────────────────────
    void run_loop() {
        std::vector<ClientSlot> clients;
        clients.reserve(max_clients_);

        while (running_.load(std::memory_order_acquire)) {
            SocketFd ls = listen_sock_.load(std::memory_order_relaxed);
            if (ls == kInvalidSocket && clients.empty()) break;

            fd_set rd;
            fd_set wr;
            FD_ZERO(&rd);
            FD_ZERO(&wr);

            int max_fd = 0;
            if (ls != kInvalidSocket) {
                FD_SET(ls, &rd);
                max_fd = static_cast<int>(ls);
            }

            for (const auto& c : clients) {
                FD_SET(c.sock, &rd);
                if (client_has_pending(c)) FD_SET(c.sock, &wr);
                if (static_cast<int>(c.sock) > max_fd) max_fd = static_cast<int>(c.sock);
            }

            timeval tv{0, 50000}; // 50 ms keeps stop() responsive.
            int sel = ::select(max_fd + 1, &rd, &wr, nullptr, &tv);
            if (sel < 0) break;

            if (ls != kInvalidSocket && FD_ISSET(ls, &rd)) {
                // Drain all pending connections in the listen queue so concurrent
                // HTTP asset requests (CesiumJS, workers, tiles, app.js) are served immediately.
                for (int accept_burst = 0; accept_burst < 32; ++accept_burst) {
                    fd_set lrd;
                    FD_ZERO(&lrd);
                    FD_SET(ls, &lrd);
                    timeval ztv{0, 0};
                    if (accept_burst > 0 && ::select((int)(ls + 1), &lrd, nullptr, nullptr, &ztv) <= 0) {
                        break;
                    }
                    accept_client(ls, clients);
                }
            }

            for (size_t i = 0; i < clients.size();) {
                bool keep = true;
                ClientSlot& c = clients[i];

                if (FD_ISSET(c.sock, &rd)) {
                    keep = handle_client_read(c.sock);
                }
                if (keep && FD_ISSET(c.sock, &wr)) {
                    keep = send_pending(c);
                }

                if (!keep) {
                    close_socket(c.sock);
                    clients.erase(clients.begin() + static_cast<std::ptrdiff_t>(i));
                    client_count_.store(clients.size(), std::memory_order_release);
                    std::cout << "[WS-EMITTER] War Room baglantisi kesildi"
                              << " — aktif istemci: " << clients.size() << "\n";
                } else {
                    ++i;
                }
            }
        }

        for (auto& c : clients) close_socket(c.sock);
        client_count_.store(0u, std::memory_order_release);
    }

    // İstek satırından hedefi (path?query) çıkar: "GET /?token=x HTTP/1.1".
    static std::string request_target(const std::string& req) {
        const size_t sp1 = req.find(' ');
        if (sp1 == std::string::npos) return "/";
        const size_t sp2 = req.find(' ', sp1 + 1);
        if (sp2 == std::string::npos) return "/";
        return req.substr(sp1 + 1, sp2 - sp1 - 1);
    }

    // Hedeften bir sorgu parametresini çıkarır (URL-decode YOK — token hex/base).
    static std::string query_param(const std::string& target, const std::string& key) {
        const size_t q = target.find('?');
        if (q == std::string::npos) return {};
        const std::string qs = target.substr(q + 1);
        const std::string needle = key + "=";
        size_t pos = 0;
        while (pos < qs.size()) {
            size_t amp = qs.find('&', pos);
            std::string kv = qs.substr(pos, amp == std::string::npos ? std::string::npos : amp - pos);
            if (kv.compare(0, needle.size(), needle) == 0)
                return kv.substr(needle.size());
            if (amp == std::string::npos) break;
            pos = amp + 1;
        }
        return {};
    }

    // Sabit-zaman string eşitliği (token karşılaştırması timing sızdırmasın).
    static bool ct_equal(const std::string& a, const std::string& b) {
        const size_t n = a.size() > b.size() ? a.size() : b.size();
        volatile unsigned char acc = (a.size() == b.size()) ? 0u : 1u;
        for (size_t i = 0; i < n; ++i) {
            const unsigned char ca = i < a.size() ? (unsigned char)a[i] : 0u;
            const unsigned char cb = i < b.size() ? (unsigned char)b[i] : 0u;
            acc = (unsigned char)(acc | (unsigned char)(ca ^ cb));
        }
        return acc == 0u;
    }

    // token_ boşsa (loopback modu) her istek geçer; doluysa query token şart.
    bool token_ok(const std::string& target) const {
        if (config_.token.empty()) return true;
        return ct_equal(query_param(target, "token"), config_.token);
    }

public:
    /**
     * Doğrulanan yerel Origin kontrolü (CSWSH koruması).
     *
     * Kurallar:
     *   1. Boş Origin (CLI/otomasyon istemcisi) → izin verilir.
     *   2. "null" Origin → varsayılan olarak REDDEDİLİR (sandboxed iframe
     *      `<iframe sandbox="allow-scripts">` saldırgan siteden `Origin: null`
     *      gönderir). Yalnızca `allow_null_origin=true` veya
     *      `CAELUS_WS_ALLOW_NULL_ORIGIN=1` ortam değişkeni ile açılabilir.
     *   3. "file://" veya "file:///..." → yerel dosya şeması (host içeremez).
     *   4. "http://" veya "https://" → host TAM OLARAK "127.0.0.1", "localhost"
     *      veya "[::1]" olmalıdır (`localhost.evil.example` veya
     *      `127.0.0.1.evil.com` önek atlatmaları reddedilir).
     *   5. Port belirtilmişse 1..65535 aralığında salt rakam olmalıdır.
     */
    static bool is_allowed_local_origin(std::string origin, bool allow_null_origin = false) {
        while (!origin.empty() &&
               (origin.back() == ' ' || origin.back() == '\t' ||
                origin.back() == '\r' || origin.back() == '\n')) {
            origin.pop_back();
        }
        if (origin.empty()) return true;

        for (char& c : origin) {
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        }

        if (origin == "null") {
            return allow_null_origin;
        }

        if (origin == "file://" || origin.rfind("file:///", 0) == 0) {
            return true;
        }

        std::string rest;
        if (origin.rfind("http://", 0) == 0) {
            rest = origin.substr(7);
        } else if (origin.rfind("https://", 0) == 0) {
            rest = origin.substr(8);
        } else {
            return false;
        }

        // Opsiyonel sonda '/' varsa kaldır; başka path/query/userinfo olamaz.
        if (!rest.empty() && rest.back() == '/') {
            rest.pop_back();
        }
        if (rest.empty()) return false;
        if (rest.find('/') != std::string::npos ||
            rest.find('@') != std::string::npos ||
            rest.find('?') != std::string::npos ||
            rest.find('#') != std::string::npos) {
            return false;
        }

        std::string host;
        std::string port_str;
        if (rest.front() == '[') {
            const size_t close_bracket = rest.find(']');
            if (close_bracket == std::string::npos) return false;
            host = rest.substr(0, close_bracket + 1);
            if (close_bracket + 1 < rest.size()) {
                if (rest[close_bracket + 1] != ':') return false;
                port_str = rest.substr(close_bracket + 2);
                if (port_str.empty()) return false;
            }
        } else {
            const size_t colon = rest.find(':');
            if (colon == std::string::npos) {
                host = rest;
            } else {
                host = rest.substr(0, colon);
                port_str = rest.substr(colon + 1);
                if (port_str.empty()) return false;
            }
        }

        if (host != "127.0.0.1" && host != "localhost" && host != "[::1]") {
            return false;
        }

        if (!port_str.empty()) {
            if (port_str.size() > 5) return false;
            unsigned long port_val = 0;
            for (char ch : port_str) {
                if (ch < '0' || ch > '9') return false;
                port_val = port_val * 10ul + static_cast<unsigned long>(ch - '0');
            }
            if (port_val < 1ul || port_val > 65535ul) return false;
        }

        return true;
    }

private:
    // Loopback CSWSH koruması: token yokken tarayıcı yabancı bir Origin gönderirse
    // (örn. https://evil.example, http://localhost.evil.example, Origin: null)
    // bağlantıyı reddet.
    bool origin_ok(const std::string& req) const {
        if (!config_.token.empty()) return true;  // Token doğrulaması aktifken token_ok() belirleyicidir.
        const std::string origin = ws_detail::get_header(req, "Origin");
        const char* allow_null_env = std::getenv("CAELUS_WS_ALLOW_NULL_ORIGIN");
        const bool allow_null = allow_null_env &&
            (std::strcmp(allow_null_env, "1") == 0 || std::strcmp(allow_null_env, "true") == 0);
        return is_allowed_local_origin(origin, allow_null);
    }

    // Plain HTTP GET → embedded War Room varlığını sun (uzak tarayıcı için).
    // Statik varlıklar (HTML/JS) herkese açıktır — sır içermez ve <script
    // src="app.js"> isteği token taşıyamaz. Güvenlik sınırı WS upgrade'dedir:
    // token olmadan hiçbir canlı veri akmaz ve hiçbir komut kabul edilmez.
    void serve_http(SocketFd cl, const std::string& target) {
        std::string path = target;
        const size_t q = path.find('?');
        if (q != std::string::npos) path.erase(q);
        if (path.empty()) path = "/";

        caelus::telemetry::ScopedLocalSpan http_span(
            path == "/api/local-otel-spans" ? "http.get.local_otel_spans" :
            (path == "/api/os-host-telemetry" ? "http.get.os_host_telemetry" : "http.get.static_asset"),
            "ws_emitter_http", 0, "OK");
        caelus::telemetry::LocalOtelCollector::instance().increment_counter("http.requests.total", 1);

        if (path == "/api/local-otel-spans") {
            const std::string body = caelus::telemetry::LocalOtelCollector::instance().export_local_json(32);
            std::ostringstream hdr;
            hdr << "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
                << "Cache-Control: no-store\r\n"
                << "Content-Length: " << body.size() << "\r\n"
                << "Connection: close\r\n\r\n";
            const std::string h = hdr.str();
            ws_detail::send_all(cl, (const uint8_t*)h.data(), (int)h.size());
            ws_detail::send_all(cl, (const uint8_t*)body.data(), (int)body.size());
            return;
        }

        if (path == "/api/os-host-telemetry") {
            uint32_t mem_load_pct = 50;
            uint64_t total_phys_mb = 16384;
            uint64_t avail_phys_mb = 8192;
            uint64_t uptime_sec = 0;
#ifdef _WIN32
            MEMORYSTATUSEX ms{};
            ms.dwLength = sizeof(ms);
            if (::GlobalMemoryStatusEx(&ms)) {
                mem_load_pct = static_cast<uint32_t>(ms.dwMemoryLoad);
                total_phys_mb = static_cast<uint64_t>(ms.ullTotalPhys / (1024ULL * 1024ULL));
                avail_phys_mb = static_cast<uint64_t>(ms.ullAvailPhys / (1024ULL * 1024ULL));
            }
            uptime_sec = static_cast<uint64_t>(::GetTickCount64() / 1000ULL);
#endif
            auto now = std::chrono::system_clock::now();
            std::time_t tt = std::chrono::system_clock::to_time_t(now);
            std::tm gmt{};
#ifdef _WIN32
            gmtime_s(&gmt, &tt);
#else
            gmtime_r(&tt, &gmt);
#endif
            char iso_buf[32]{};
            std::strftime(iso_buf, sizeof(iso_buf), "%Y-%m-%dT%H:%M:%SZ", &gmt);

            std::ostringstream body_ss;
            body_ss << "{\"source_name\":\"WIN32_OS_HOST_TELEMETRY_127_0_0_1\","
                    << "\"data_classification\":\"OBSERVED_DATA\","
                    << "\"read_only\":true,"
                    << "\"occurrence_time_iso\":\"" << iso_buf << "\","
                    << "\"memory_load_pct\":" << mem_load_pct << ","
                    << "\"total_phys_mb\":" << total_phys_mb << ","
                    << "\"avail_phys_mb\":" << avail_phys_mb << ","
                    << "\"uptime_sec\":" << uptime_sec << "}";
            const std::string body = body_ss.str();
            std::ostringstream hdr;
            hdr << "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
                << "Cache-Control: no-store\r\n"
                << "Content-Length: " << body.size() << "\r\n"
                << "Connection: close\r\n\r\n";
            const std::string h = hdr.str();
            ws_detail::send_all(cl, (const uint8_t*)h.data(), (int)h.size());
            ws_detail::send_all(cl, (const uint8_t*)body.data(), (int)body.size());
            return;
        }

        for (const auto& rt : routes_) {
            if (rt.path == path) {
                std::ostringstream hdr;
                hdr << "HTTP/1.1 200 OK\r\nContent-Type: " << rt.content_type
                    << "\r\nContent-Length: " << rt.len
                    << "\r\nConnection: close\r\n\r\n";
                const std::string h = hdr.str();
                ws_detail::send_all(cl, (const uint8_t*)h.data(), (int)h.size());
                ws_detail::send_all(cl, rt.data, (int)rt.len);
                return;
            }
        }

        // Safe static asset serving for /vendor/..., /assets/..., and UI engine modules
        if ((path.rfind("/vendor/", 0) == 0 || path.rfind("/ui/vendor/", 0) == 0 ||
             path.rfind("/assets/", 0) == 0 || path.rfind("/ui/assets/", 0) == 0 ||
             path == "/tokens.css" || path == "/ui/tokens.css" ||
             path == "/manifest.webmanifest" || path == "/ui/manifest.webmanifest" ||
             path == "/learned_world_model.js" || path == "/ui/learned_world_model.js" ||
             path == "/living_world_model.js" || path == "/ui/living_world_model.js" ||
             path == "/discovery_value_engine.js" || path == "/ui/discovery_value_engine.js" ||
             path == "/first_real_task_engine.js" || path == "/ui/first_real_task_engine.js" ||
             path == "/personal_agent_and_advisor.js" || path == "/ui/personal_agent_and_advisor.js" ||
             path == "/spatial_experience.js" || path == "/ui/spatial_experience.js" ||
             path == "/sidecar_airlock_mcp.js" || path == "/ui/sidecar_airlock_mcp.js" ||
             path == "/war_room_i18n.js" || path == "/ui/war_room_i18n.js" ||
             path == "/war_room_ag_ui_engine.js" || path == "/ui/war_room_ag_ui_engine.js" ||
             path == "/war_room_cockpit.js" || path == "/ui/war_room_cockpit.js") &&
            path.find("..") == std::string::npos &&
            path.find('\\') == std::string::npos &&
            path.find(':') == std::string::npos) {
            std::string raw_rel = (path.rfind("/ui/", 0) == 0) ? path.substr(3) : path;
            std::string rel;
            rel.reserve(raw_rel.size());
            for (size_t i = 0; i < raw_rel.size(); ++i) {
                if (raw_rel[i] == '/' && !rel.empty() && rel.back() == '/') continue;
                rel.push_back(raw_rel[i]);
            }
            std::vector<std::string> base_dirs = {"./ui", "../ui"};
            if (const char* env_root = std::getenv("CAELUS_STATIC_ROOT")) {
                if (*env_root) base_dirs.insert(base_dirs.begin(), std::string(env_root));
            }
#ifdef _WIN32
            char exe_buf[MAX_PATH]{};
            DWORD exe_len = ::GetModuleFileNameA(nullptr, exe_buf, MAX_PATH);
            if (exe_len > 0 && exe_len < MAX_PATH) {
                std::string exe_p(exe_buf, exe_len);
                for (char& ch : exe_p) if (ch == '\\') ch = '/';
                size_t sl = exe_p.find_last_of('/');
                if (sl != std::string::npos) {
                    std::string exe_dir = exe_p.substr(0, sl);
                    base_dirs.push_back(exe_dir + "/ui");
                    base_dirs.push_back(exe_dir + "/../ui");
                }
            }
#endif
            for (const auto& bdir : base_dirs) {
                std::string full_p = bdir + rel;
                std::ifstream ifs(full_p, std::ios::binary | std::ios::ate);
                if (!ifs.is_open()) continue;
                std::streamsize fsize = ifs.tellg();
                if (fsize < 0 || fsize > 64 * 1024 * 1024) continue;
                ifs.seekg(0, std::ios::beg);
                std::vector<uint8_t> fbuf(static_cast<size_t>(fsize));
                if (fsize > 0 && !ifs.read(reinterpret_cast<char*>(fbuf.data()), fsize)) continue;

                std::string ctype = "application/octet-stream";
                auto ends_ci = [&](const char* suf) {
                    size_t slen = std::strlen(suf);
                    if (rel.size() < slen) return false;
                    for (size_t i = 0; i < slen; ++i) {
                        if (std::tolower((unsigned char)rel[rel.size() - slen + i]) != suf[i]) return false;
                    }
                    return true;
                };
                if (ends_ci(".js") || ends_ci(".mjs") || ends_ci(".cjs")) ctype = "application/javascript; charset=utf-8";
                else if (ends_ci(".css")) ctype = "text/css; charset=utf-8";
                else if (ends_ci(".webmanifest")) ctype = "application/manifest+json; charset=utf-8";
                else if (ends_ci(".pmtiles")) ctype = "application/octet-stream";
                else if (ends_ci(".json") || ends_ci(".geojson")) ctype = "application/json; charset=utf-8";
                else if (ends_ci(".xml")) ctype = "application/xml; charset=utf-8";
                else if (ends_ci(".html")) ctype = "text/html; charset=utf-8";
                else if (ends_ci(".md") || ends_ci(".txt")) ctype = "text/plain; charset=utf-8";
                else if (ends_ci(".png")) ctype = "image/png";
                else if (ends_ci(".jpg") || ends_ci(".jpeg")) ctype = "image/jpeg";
                else if (ends_ci(".gif")) ctype = "image/gif";
                else if (ends_ci(".svg")) ctype = "image/svg+xml";
                else if (ends_ci(".wasm")) ctype = "application/wasm";
                else if (ends_ci(".glb")) ctype = "model/gltf-binary";
                else if (ends_ci(".gltf")) ctype = "model/gltf+json; charset=utf-8";
                else if (ends_ci(".b3dm") || ends_ci(".i3dm") || ends_ci(".pnts") || ends_ci(".cmpt")) ctype = "application/octet-stream";
                else if (ends_ci(".pbf")) ctype = "application/x-protobuf";
                else if (ends_ci(".woff2")) ctype = "font/woff2";
                else if (ends_ci(".woff")) ctype = "font/woff";

                std::ostringstream hdr;
                hdr << "HTTP/1.1 200 OK\r\nContent-Type: " << ctype
                    << "\r\nCache-Control: public, max-age=3600"
                    << "\r\nContent-Length: " << fbuf.size()
                    << "\r\nConnection: close\r\n\r\n";
                const std::string h = hdr.str();
                ws_detail::send_all(cl, (const uint8_t*)h.data(), (int)h.size());
                if (!fbuf.empty()) {
                    ws_detail::send_all(cl, fbuf.data(), (int)fbuf.size());
                }
                return;
            }
        }
        static const char* nf =
            "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n"
            "Connection: close\r\n\r\nbulunamdi";
        ws_detail::send_all(cl, (const uint8_t*)nf, (int)std::strlen(nf));
    }

    // ── RFC 6455 §4 — server handshake ───────────────────────────────────────
    // WS upgrade → true (istemci olur). Plain GET → varlık sunulur, false.
    bool perform_handshake(SocketFd cl, bool& served_http) {
        served_http = false;
        std::string req;
        if (!ws_detail::recv_http_header(cl, req)) return false;

        const std::string target = request_target(req);
        std::string ws_key = ws_detail::get_header(req, "Sec-WebSocket-Key");
        if (ws_key.empty()) {
            // WebSocket değil → statik HTTP isteği (UI sayfası/asset).
            serve_http(cl, target);
            served_http = true;
            return false;
        }
        // WS upgrade: token kapısı (tarayıcı WS'i header set edemez → query token).
        if (!token_ok(target) || !origin_ok(req)) {
            static const char* r =
                "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n";
            ws_detail::send_all(cl, (const uint8_t*)r, (int)std::strlen(r));
            std::cerr << "[WS-EMITTER] Gecersiz token veya yabanci Origin — WS reddedildi.\n";
            return false;
        }

        std::string accept = ws_detail::ws_accept_key(ws_key);
        std::string resp =
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";

        return ws_detail::send_all(
            cl, reinterpret_cast<const uint8_t*>(resp.data()), (int)resp.size());
    }

    void accept_client(SocketFd ls, std::vector<ClientSlot>& clients) {
        SocketFd cl = ::accept(ls, nullptr, nullptr);
        if (cl == kInvalidSocket) return;

        bool served_http = false;
        if (!perform_handshake(cl, served_http)) {
            if (served_http) {
                shutdown_write(cl);
            }
            close_socket(cl);
            return;
        }

        if (clients.size() >= max_clients_) {
            close_socket(cl);
            std::cerr << "[WS-EMITTER] UYARI: War Room istemci siniri dolu ("
                      << max_clients_ << "). Yeni baglanti reddedildi.\n";
            return;
        }

        if (!set_nonblocking(cl)) {
            close_socket(cl);
            return;
        }

        ClientSlot c;
        c.sock = cl;
        {
            std::lock_guard<std::mutex> lg(buffer_mu_);
            c.next_seq = buffer_.empty() ? next_event_seq_ : buffer_.front().seq;
        }

        clients.push_back(c);
        client_count_.store(clients.size(), std::memory_order_release);
        std::cout << "[WS-EMITTER] War Room baglandi"
                  << " — ws://127.0.0.1:" << port_
                  << " (aktif istemci: " << clients.size() << ")\n";
    }

    bool handle_client_read(SocketFd cl) {
        std::vector<uint8_t> buf(262144);
        int n = (int)::recv(cl, (char*)buf.data(), (int)buf.size(), 0);
        if (n <= 0) return false; // closed or error

        size_t total = static_cast<size_t>(n);
        size_t offset = 0;
        while (offset + 2 <= total) {
            uint8_t opcode = buf[offset] & 0x0Fu;
            if (opcode == 0x08u) {
                uint8_t cf[] = {0x88u, 0x00u};
                ws_detail::send_all(cl, cf, 2);
                return false;
            }
            const bool masked = (buf[offset + 1] & 0x80u) != 0u;
            size_t hdr_len = 2 + (masked ? 4 : 0);
            size_t payload_len = buf[offset + 1] & 0x7Fu;
            if (payload_len == 126u) {
                if (offset + 4 > total) break;
                hdr_len += 2;
                payload_len = (static_cast<size_t>(buf[offset + 2]) << 8) | buf[offset + 3];
            } else if (payload_len == 127u) {
                if (offset + 10 > total) break;
                hdr_len += 8;
                uint64_t len64 = 0;
                for (int b = 0; b < 8; ++b) {
                    len64 = (len64 << 8) | static_cast<uint64_t>(buf[offset + 2 + b]);
                }
                payload_len = static_cast<size_t>(len64);
            }
            const size_t expected_end = offset + hdr_len + payload_len;
            if (expected_end > buf.size()) {
                buf.resize(expected_end + 4096);
            }
            int retry_spins = 0;
            // Büyük çerçeveler (ör. yüzlerce KB'lık save_world) birkaç TCP okumasına
            // bölünebilir; tarayıcı meşgulken parçalar gecikebilir → ~5 sn sabır.
            while (total < expected_end && expected_end <= buf.size() && retry_spins < 500) {
                fd_set rfds;
                FD_ZERO(&rfds);
                FD_SET(cl, &rfds);
                timeval tv{0, 10000}; // 10ms per wait (ilerlemesiz toplam ≈5 sn)
                int sel = ::select((int)(cl + 1), &rfds, nullptr, nullptr, &tv);
                if (sel < 0) break;
                if (sel == 0) {
                    ++retry_spins;
                    continue;
                }
                int more = (int)::recv(cl, (char*)buf.data() + total, (int)(buf.size() - total), 0);
                if (more > 0) {
                    total += static_cast<size_t>(more);
                } else if (more == 0) {
                    break;
                } else {
                    ++retry_spins;
                }
            }
            // Eksik (kesik) çerçeve ASLA komut olarak işlenmez: kesik bir save_world JSON'u
            // diske yazılırsa dünya deposu bozulur ve her açılışta bağlantıyı düşürür.
            if (expected_end > total) {
                std::cerr << "[WS-EMITTER] UYARI: eksik WebSocket cercevesi atildi ("
                          << (total - offset) << "/" << (hdr_len + payload_len)
                          << " bayt); komut calistirilmadi.\n";
                break;
            }
            const size_t frame_bytes = hdr_len + payload_len;
            if (opcode == 0x09u && frame_bytes >= 2) {
                buf[offset] = 0x8Au;
                ws_detail::send_all(cl, buf.data() + offset, (int)frame_bytes);
            } else if (opcode == 0x01u) {
                handle_text_frame(buf.data() + offset, frame_bytes);
            }
            if (expected_end > total) break;
            offset = expected_end;
        }
        return true; // Non-text / oversized frames silently ignored.
    }

    /**
     * RFC 6455 §5 — decode a single client text frame and forward its payload
     * to the command handler. Client→server frames are ALWAYS masked (§5.1);
     * we unmask in place.
     */
    void handle_text_frame(uint8_t* buf, size_t n) {
        if (!cmd_handler_ || n < 2) return;
        const bool masked = (buf[1] & 0x80u) != 0u;
        uint64_t len = buf[1] & 0x7Fu;
        size_t pos = 2;
        if (len == 126u) {
            if (n < 4) return;
            len = (static_cast<uint64_t>(buf[2]) << 8) | buf[3];
            pos = 4;
        } else if (len == 127u) {
            if (n < 10) return;
            len = 0;
            for (int b = 0; b < 8; ++b) {
                len = (len << 8) | static_cast<uint64_t>(buf[2 + b]);
            }
            pos = 10;
        }
        uint8_t mask[4] = {0, 0, 0, 0};
        if (masked) {
            if (n < pos + 4) return;
            std::memcpy(mask, buf + pos, 4);
            pos += 4;
        }
        if (pos > n) return;
        if (len > n - pos) return; // kesik çerçeve: çalıştırma (bozuk komut diske yazılmasın)
        std::string payload;
        payload.resize(static_cast<size_t>(len));
        for (uint64_t i = 0; i < len; ++i) {
            payload[i] = static_cast<char>(buf[pos + i] ^ (masked ? mask[i & 3u] : 0u));
        }
        // Strip trailing CR/LF/NUL a browser or proxy might append.
        while (!payload.empty() &&
               (payload.back() == '\r' || payload.back() == '\n' || payload.back() == '\0')) {
            payload.pop_back();
        }
        if (!payload.empty()) cmd_handler_(payload);
    }

    bool client_has_pending(const ClientSlot& c) {
        std::lock_guard<std::mutex> lg(buffer_mu_);
        return c.next_seq < next_event_seq_;
    }

    bool send_pending(ClientSlot& c) {
        std::vector<std::string> batch;
        {
            std::lock_guard<std::mutex> lg(buffer_mu_);
            if (c.next_seq >= next_event_seq_) return true;

            uint64_t first_seq = buffer_.empty() ? next_event_seq_ : buffer_.front().seq;
            if (c.next_seq < first_seq) {
                uint64_t dropped = first_seq - c.next_seq;
                batch.push_back(gap_event(dropped));
                c.next_seq = first_seq;
            }

            for (const auto& ev : buffer_) {
                if (ev.seq >= c.next_seq) batch.push_back(ev.payload);
            }
            c.next_seq = next_event_seq_;
        }

        for (const auto& msg : batch) {
            auto frame = ws_detail::ws_text_frame(msg);
            if (!ws_detail::send_all(c.sock, frame.data(), (int)frame.size()))
                return false;
        }
        return true;
    }

    std::string gap_event(uint64_t dropped) const {
        std::ostringstream o;
        o << "{\"type\":\"ws_gap\",\"dropped\":" << dropped << "}\n";
        return o.str();
    }

    void trim_buffer_locked() {
        while (buffer_.size() > buffer_limit_) buffer_.pop_front();
    }

    static size_t platform_client_ceiling() {
#ifdef FD_SETSIZE
        return FD_SETSIZE > 1 ? static_cast<size_t>(FD_SETSIZE - 1) : 1u;
#else
        return kMaxRuntimeClients;
#endif
    }

    static Config normalise_config(Config config) {
        const size_t client_upper = std::min(kMaxRuntimeClients, platform_client_ceiling());
        config.max_clients = std::max(kMinRuntimeClients,
                                      std::min(config.max_clients, client_upper));
        config.buffer_events = std::max(kMinBufferEvents,
                                        std::min(config.buffer_events, kMaxBufferEvents));
        return config;
    }

    static size_t parse_size_env(const char* name, size_t fallback,
                                 size_t min_value, size_t max_value) {
        const char* env = std::getenv(name);
        if (!env || !*env) return fallback;

        char* end = nullptr;
        unsigned long parsed = std::strtoul(env, &end, 10);
        if (end == env || parsed == 0ul) return fallback;
        if (parsed > static_cast<unsigned long>(max_value)) return max_value;
        return static_cast<size_t>(std::max<unsigned long>(
            static_cast<unsigned long>(min_value), parsed));
    }

    static Config resolve_runtime_config(Config base) {
        const size_t client_upper = std::min(kMaxRuntimeClients, platform_client_ceiling());
        base.max_clients = parse_size_env("CAELUS_WS_MAX_CLIENTS",
                                          base.max_clients,
                                          kMinRuntimeClients,
                                          client_upper);
        base.buffer_events = parse_size_env("CAELUS_WS_BUFFER_EVENTS",
                                            base.buffer_events,
                                            kMinBufferEvents,
                                            kMaxBufferEvents);
        return normalise_config(base);
    }

    static int listen_backlog(size_t max_clients) {
        size_t backlog = std::max<size_t>(64u, max_clients);
#ifdef SOMAXCONN
        backlog = std::min<size_t>(backlog, static_cast<size_t>(SOMAXCONN));
#endif
        return static_cast<int>(backlog);
    }

    // ── Member data ───────────────────────────────────────────────────────────
    std::atomic<bool>       running_{false};
    std::atomic<SocketFd>   listen_sock_{kInvalidSocket};
    std::atomic<size_t>     client_count_{0u};
    Config                  config_;
    size_t                  max_clients_{8u};
    uint16_t                port_{47809};
    std::thread             thread_;
    std::mutex              buffer_mu_;
    std::deque<BufferedEvent> buffer_;
    uint64_t                next_event_seq_{0};
    size_t                  buffer_limit_{4096u};

    // Inbound War Room command sink (browser → engine). Set before start();
    // invoked only on the background thread thereafter.
    std::function<void(std::string)> cmd_handler_;

    // Statik HTTP rotaları (embedded UI). Set before start(); read-only after.
    std::vector<HttpRoute> routes_;
};


// ═════════════════════════════════════════════════════════════════════════════
//   NDJSON builder helpers  (inline, no heap allocation beyond std::string)
// ═════════════════════════════════════════════════════════════════════════════

namespace ws_json {

inline std::string friction(double value, int crisis_level, uint64_t tick) {
    std::ostringstream o;
    o << std::fixed << std::setprecision(4);
    o << "{\"type\":\"friction\","
      << "\"value\":"         << value
      << ",\"crisis_level\":" << crisis_level
      << ",\"tick\":"         << tick
      << "}";
    return o.str();
}

inline std::string intel_event(uint64_t session_id, int crisis_level,
                                double friction_coeff, const char* memo) {
    // Sanitise memo: replace '"' and '\' to avoid JSON injection.
    // (Memo is already bounded to 127 ASCII bytes by the Rust FFI layer.)
    std::string safe;
    if (memo) {
        for (const char* p = memo; *p; ++p) {
            char c = *p;
            safe += (c == '"' || c == '\\') ? '_' : c;
        }
    }
    std::ostringstream o;
    o << std::fixed << std::setprecision(4);
    o << "{\"type\":\"intel\","
      << "\"session_id\":\"0x" << std::hex << session_id << std::dec << "\","
      << "\"crisis_level\":"   << crisis_level           << ","
      << "\"friction_coeff\":" << friction_coeff         << ","
      << "\"memo\":\""         << safe                   << "\""
      << "}";
    return o.str();
}

inline std::string regime_exceeded(double raw, double cap) {
    std::ostringstream o;
    o << std::fixed << std::setprecision(3);
    o << "{\"type\":\"regime_exceeded\","
      << "\"raw_multiplier\":" << raw << ","
      << "\"capped_at\":"      << cap
      << "}";
    return o.str();
}

inline std::string handshake_event(const std::string& peer_fp,
                                    uint64_t session_id, bool ok) {
    std::ostringstream o;
    o << "{\"type\":\"handshake\","
      << "\"peer_fp\":\""    << peer_fp << "\","
      << "\"session_id\":\"0x" << std::hex << session_id << std::dec << "\","
      << "\"status\":\""     << (ok ? "success" : "rejected") << "\""
      << "}";
    return o.str();
}

inline std::string scenario_loaded(const std::string& id, const std::string& region,
                                   const std::string& sig_status,
                                   const std::string& sig_scheme) {
    // sig_status / sig_scheme, ScenarioPack imza yolundan gelen GERÇEK sonuçtur;
    // burada asla sabit "VERIFIED" üretilmez (yanıltıcı forensics önlenir).
    const std::string status = sig_status.empty() ? std::string("UNKNOWN") : sig_status;
    const std::string scheme = sig_scheme.empty() ? std::string("none") : sig_scheme;
    return "{\"type\":\"scenario_loaded\","
           "\"scenario_id\":\"" + ws_detail::json_escape(id) + "\","
           "\"sector\":\""      + ws_detail::json_escape(region) + "\","
           "\"sig_status\":\""  + ws_detail::json_escape(status) + "\","
           "\"signature_path\":\"" + ws_detail::json_escape(scheme) + "\"}";
}

inline std::string engine_state(const std::string& state, const std::string& scenario_id,
                                uint64_t tick, double friction_mult,
                                double throughput_ratio = 1.0,
                                bool outage_active = false,
                                bool any_hysteresis_flip = false) {
    std::ostringstream o;
    o << std::fixed << std::setprecision(6);
    o << "{\"type\":\"engine_state\","
      << "\"state\":\""            << ws_detail::json_escape(state)       << "\","
      << "\"scenario_id\":\""      << ws_detail::json_escape(scenario_id) << "\","
      << "\"tick\":"               << tick              << ","
      << "\"friction_mult\":"      << friction_mult     << ","
      << "\"throughput_ratio\":"   << throughput_ratio  << ","
      << "\"outage_active\":"      << (outage_active      ? "true" : "false") << ","
      << "\"any_hysteresis_flip\":" << (any_hysteresis_flip ? "true" : "false")
      << "}";
    return o.str();
}

inline std::string otp_slot(const std::string& slot_id,
                             const std::string& status, int remaining_secs) {
    std::ostringstream o;
    o << "{\"type\":\"otp\","
      << "\"slot_id\":\""       << slot_id       << "\","
      << "\"status\":\""        << status        << "\","
      << "\"remaining_secs\":"  << remaining_secs
      << "}";
    return o.str();
}

inline std::string optimization_result(bool on_time, int arrival_min,
                                        int completion_min, double friction_mult) {
    std::ostringstream o;
    o << std::fixed << std::setprecision(3);
    o << "{\"type\":\"optimization\","
      << "\"on_time\":"          << (on_time ? "true" : "false") << ","
      << "\"arrival_min\":"      << arrival_min                  << ","
      << "\"completion_min\":"   << completion_min               << ","
      << "\"friction_mult\":"    << friction_mult
      << "}";
    return o.str();
}

} // namespace ws_json
} // namespace caelus
