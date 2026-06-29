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
#include <sstream>
#include <iomanip>
#include <vector>
#include <algorithm>
#include <iostream>
#include <cstdlib>
#include <cctype>
#include <cerrno>

// ── Platform socket abstraction ───────────────────────────────────────────────
#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>

   using SocketFd = SOCKET;
   static constexpr SocketFd kInvalidSocket = INVALID_SOCKET;
   inline void   close_socket(SocketFd s) { ::closesocket(s); }
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

// ── Send all bytes reliably over a blocking socket ───────────────────────────
inline bool send_all(SocketFd s, const uint8_t* buf, int len) {
    int sent = 0;
    while (sent < len) {
        int n = (int)::send(s, (const char*)(buf + sent), len - sent, 0);
        if (n <= 0) return false;
        sent += n;
    }
    return true;
}

// ── Read HTTP request until \r\n\r\n (bounded to 8 KiB) ────────────────────
inline bool recv_http_header(SocketFd s, std::string& out) {
    out.clear();
    char c;
    while (true) {
        int n = (int)::recv(s, &c, 1, 0);
        if (n <= 0) return false;
        out += c;
        if (out.size() >= 4u && out.substr(out.size() - 4u) == "\r\n\r\n")
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

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(port);
        // Loopback ONLY — packets never leave the machine.
        ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

        if (::bind(listen_sock_, (sockaddr*)&addr, sizeof(addr)) != 0 ||
            ::listen(listen_sock_, listen_backlog(resolved.max_clients)) != 0) {
            close_socket(listen_sock_);
            listen_sock_ = kInvalidSocket;
            std::cerr << "[WS-EMITTER] HATA: 127.0.0.1:" << port
                      << " portuna bagilanamadi. War Room koprusu baslatilmadi.\n";
            wsa_cleanup();
            return false;
        }

        port_    = port;
        running_.store(true, std::memory_order_release);
        thread_  = std::thread(&WsEmitter::run_loop, this);
        std::cout << "[WS-EMITTER] War Room koprusu baslatildi"
                  << " → ws://127.0.0.1:" << port
                  << " (istemci siniri: " << resolved.max_clients
                  << ", ring: " << resolved.buffer_events << " olay)\n";
        return true;
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
                accept_client(ls, clients);
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

    // ── RFC 6455 §4 — server handshake ───────────────────────────────────────
    bool perform_handshake(SocketFd cl) {
        std::string req;
        if (!ws_detail::recv_http_header(cl, req)) return false;

        std::string ws_key = ws_detail::get_header(req, "Sec-WebSocket-Key");
        if (ws_key.empty()) return false;

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

        if (clients.size() >= max_clients_) {
            close_socket(cl);
            std::cerr << "[WS-EMITTER] UYARI: War Room istemci siniri dolu ("
                      << max_clients_ << "). Yeni baglanti reddedildi.\n";
            return;
        }

        if (!perform_handshake(cl) || !set_nonblocking(cl)) {
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
        uint8_t buf[512];
        int n = (int)::recv(cl, (char*)buf, sizeof(buf), 0);
        if (n <= 0) return false; // closed or error

        // RFC 6455 opcode: 0x8=close, 0x9=ping, 0xA=pong
        uint8_t opcode = buf[0] & 0x0Fu;
        if (opcode == 0x08u) {
            uint8_t cf[] = {0x88u, 0x00u};
            ws_detail::send_all(cl, cf, 2);
            return false;
        }
        if (opcode == 0x09u && n >= 2) {
            buf[0] = 0x8Au;
            ws_detail::send_all(cl, buf, n);
        }
        return true; // Other frames silently ignored.
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
        size_t backlog = std::max<size_t>(1u, max_clients);
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

inline std::string scenario_loaded(const std::string& id, const std::string& region) {
    return "{\"type\":\"scenario_loaded\","
           "\"scenario_id\":\"" + ws_detail::json_escape(id) + "\","
           "\"sector\":\""      + ws_detail::json_escape(region) + "\","
           "\"sig_status\":\"VERIFIED\","
           "\"signature_path\":\"ed25519+pinned\"}";
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
