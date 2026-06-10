/**
 * CAELUS OS — Plugin Registry  (include/plugin/caelus_plugin_registry.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGISTRY DESIGN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The PluginRegistry is the single authority for all plugin lifecycle and
 * event dispatch.  It owns:
 *
 *   • One active SOLVER (selected at bootstrap)
 *   • One active KEYMGMT provider (optional protected identity seed backend)
 *   • Up to kMaxConnectors CONNECTOR plugins (batched pull on each tick)
 *   • Up to kMaxReporters REPORTER plugins  (called after each solve)
 *   • Up to kMaxListeners generic listener plugins (on_tick / on_intel fans)
 *
 * Memory model:
 *   Built-in plugin vtables live in .rodata (static const structs from
 *   make_vtable()).  The registry holds raw const pointers to them — no
 *   heap allocation.  External plugins loaded via LoadLibrary/dlopen would
 *   also supply a static vtable pointer from their entry function.
 *
 *   PluginSlot stores { const CaelusPluginVTable*, void* state }.  For
 *   stateless built-ins, state is nullptr.  Stateful external plugins
 *   manage their own state; the registry only calls init/cleanup.
 *
 * Thread safety:
 *   Registration and bootstrap are NOT thread-safe (call from main, once).
 *   dispatch_tick / dispatch_intel / solve / dispatch_report are called
 *   from the engine's single main thread — no locking required there.
 *   The WsEmitter referenced via CaelusEngineFns is independently thread-safe.
 *
 * ABI compatibility:
 *   Before calling any vtable method other than `abi_version`, the registry
 *   checks caelus_abi_compatible().  Incompatible plugins are logged and
 *   skipped rather than crashing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include "caelus_plugin_abi.h"
#include "caelus_solver.h"
#include "caelus_connector.h"
#include "caelus_reporter.h"
#include "ws_emitter.h"          // for CaelusEngineFns engine_ctx binding

#include <array>
#include <atomic>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

#if defined(_WIN32)
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

extern "C" {
    // Rust ed25519 doğrulama FFI'si (src/scenario_verify.rs). Plugin sidecar
    // imzaları da bu fonksiyonla doğrulanır (yeni FFI gerekmez); pubkey
    // parametreli olduğu için pinli güven çapası çağıran tarafta uygulanır.
    // Aynı bildirim scenario_pack.h'de de var — C linkage ile birebir aynı
    // imza olduğundan iki başlığın birlikte include edilmesi güvenlidir.
    uint8_t caelus_verify_scenario_signature(
        const uint8_t* msg, size_t msg_len,
        const uint8_t* pubkey32, const uint8_t* sig64);
}

namespace caelus {

// ─────────────────────────────────────────────────────────────────────────────
// Plugin imza doğrulama yardımcıları — T-18 üretim verifier backend'i
// ─────────────────────────────────────────────────────────────────────────────
//
// Sözleşme (signer CLI `--sign-plugin` ile bit-bit uyumlu):
//   • Sidecar dosya : "<plugin_path>.sig", tek satır:
//                       ed25519:<64hex-pubkey>:<128hex-sig>
//   • İmzalı mesaj  : "CAELUS_PLUGIN_V1\n" || plugin dosyasının HAM byte'ları
//     (domain ayrımı — senaryo paketi imzaları "CAELUS_SCENARIO_PACK_V1\n..."
//      canonical payload'u imzalar; iki imza türü asla yer değiştiremez).
//   • Güven çapası  : sidecar'daki pubkey, çağıranın verdiği PİNLİ pubkey ile
//     byte-byte eşleşmek ZORUNDADIR. Salt matematiksel doğrulama yetmez;
//     "bu anahtara güveniyor muyum?" sorusu burada cevaplanır.
//
// Bu fonksiyon yalnız kullanıldığı çeviri biriminde kod üretir (inline) ve
// Rust staticlib'e (caelus_verify_scenario_signature) yalnız o zaman bağımlılık
// doğurur; registry'yi Rust'sız kullanan testler etkilenmez.

inline constexpr char   kPluginSignDomain[]    = "CAELUS_PLUGIN_V1\n";
inline constexpr size_t kPluginSignDomainLen   = sizeof(kPluginSignDomain) - 1;
/// Rust FFI doğrulama yüzeyinin payload üst sınırı (16 MiB) ile aynı.
inline constexpr size_t kPluginVerifyMaxBytes  = 16u * 1024u * 1024u;

namespace plugin_sig_detail {

inline int hex_nibble(char c) noexcept {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
    return -1;
}

inline bool hex_to_bytes(const char* hex, size_t hex_len,
                         uint8_t* out, size_t out_len) noexcept {
    if (!hex || !out || hex_len != out_len * 2) return false;
    for (size_t i = 0; i < out_len; ++i) {
        const int hi = hex_nibble(hex[2 * i]);
        const int lo = hex_nibble(hex[2 * i + 1]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

/// Dosyanın ham byte'larını okur (binary). Boyut sınırı: kPluginVerifyMaxBytes.
inline bool read_file_bytes(const char* path, std::vector<uint8_t>& out) noexcept {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    bool ok = false;
    try {
        out.clear();
        uint8_t buf[64 * 1024];
        size_t n = 0;
        while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) {
            if (out.size() + n > kPluginVerifyMaxBytes) {  // erken kes: sınır aşımı
                std::fclose(f);
                return false;
            }
            out.insert(out.end(), buf, buf + n);
        }
        ok = std::ferror(f) == 0;
    } catch (...) {
        ok = false;  // bad_alloc vb. → reddet (fail-closed)
    }
    std::fclose(f);
    return ok;
}

} // namespace plugin_sig_detail

/**
 * Üretim plugin imza doğrulaması (T-18 backend).
 *
 * Adımlar: sidecar oku → "ed25519:<pub>:<sig>" parse et → pubkey'i pinli
 * güven çapasıyla karşılaştır → plugin ham byte'larını oku →
 * "CAELUS_PLUGIN_V1\n"||bytes mesajını ed25519 FFI ile doğrula.
 * Herhangi bir adım başarısızsa false (strict-fail akışı reddeder) ve
 * neden `[PLUGIN-SIG] ...` öneki ile stderr'e yazılır.
 */
inline bool verify_plugin_sidecar_ed25519(const char* plugin_path,
                                          const uint8_t pinned_pubkey32[32]) noexcept
{
    if (!plugin_path || !pinned_pubkey32) {
        std::cerr << "[PLUGIN-SIG] verifier ic hata: null arguman.\n";
        return false;
    }
    try {
        const std::string sidecar_path = std::string(plugin_path) + ".sig";

        // 1) Sidecar imza dosyasını oku.
        std::vector<uint8_t> sidecar_bytes;
        if (!plugin_sig_detail::read_file_bytes(sidecar_path.c_str(), sidecar_bytes) ||
            sidecar_bytes.empty()) {
            std::cerr << "[PLUGIN-SIG] SIDECAR_MISSING: imza dosyasi yok/okunamadi: "
                      << sidecar_path << "\n";
            return false;
        }

        // İlk satırı al, uçlardaki boşluk/CR/LF'yi kırp.
        std::string line(sidecar_bytes.begin(), sidecar_bytes.end());
        const size_t nl = line.find_first_of("\r\n");
        if (nl != std::string::npos) line.resize(nl);
        const size_t first = line.find_first_not_of(" \t");
        const size_t last  = line.find_last_not_of(" \t");
        line = (first == std::string::npos)
                   ? std::string()
                   : line.substr(first, last - first + 1);

        // 2) "ed25519:<64hex-pubkey>:<128hex-sig>" formatını ayrıştır.
        constexpr char   kScheme[]   = "ed25519:";
        constexpr size_t kSchemeLen  = sizeof(kScheme) - 1;
        constexpr size_t kExpectLen  = kSchemeLen + 64 + 1 + 128;
        uint8_t pubkey[32] = {};
        uint8_t signature[64] = {};
        const bool format_ok =
            line.size() == kExpectLen &&
            line.compare(0, kSchemeLen, kScheme) == 0 &&
            line[kSchemeLen + 64] == ':' &&
            plugin_sig_detail::hex_to_bytes(line.data() + kSchemeLen, 64, pubkey, 32) &&
            plugin_sig_detail::hex_to_bytes(line.data() + kSchemeLen + 64 + 1, 128,
                                            signature, 64);
        if (!format_ok) {
            std::cerr << "[PLUGIN-SIG] SIDECAR_FORMAT_INVALID: beklenen "
                         "ed25519:<64hex-pubkey>:<128hex-sig> — "
                      << sidecar_path << "\n";
            return false;
        }

        // 3) Pinli güven çapası: gömülü pubkey'e KÖRÜ KÖRÜNE güvenilmez.
        if (std::memcmp(pubkey, pinned_pubkey32, 32) != 0) {
            std::cerr << "[PLUGIN-SIG] UNTRUSTED_SIGNER_KEY: sidecar pubkey pinli "
                         "guven capasiyla eslesmiyor: " << plugin_path << "\n";
            return false;
        }

        // 4) Plugin dosyasının ham byte'larını oku.
        std::vector<uint8_t> raw;
        if (!plugin_sig_detail::read_file_bytes(plugin_path, raw)) {
            std::cerr << "[PLUGIN-SIG] PLUGIN_READ_FAILED: dosya okunamadi veya "
                      << (kPluginVerifyMaxBytes / (1024 * 1024))
                      << " MiB FFI sinirini asiyor: " << plugin_path << "\n";
            return false;
        }
        if (raw.size() + kPluginSignDomainLen > kPluginVerifyMaxBytes) {
            std::cerr << "[PLUGIN-SIG] PLUGIN_TOO_LARGE: domain prefix'iyle birlikte "
                         "FFI payload sinirini asiyor: " << plugin_path << "\n";
            return false;
        }

        // 5) Domain-ayrımlı mesajı kur: "CAELUS_PLUGIN_V1\n" || raw.
        std::vector<uint8_t> msg;
        msg.reserve(kPluginSignDomainLen + raw.size());
        msg.insert(msg.end(),
                   reinterpret_cast<const uint8_t*>(kPluginSignDomain),
                   reinterpret_cast<const uint8_t*>(kPluginSignDomain) + kPluginSignDomainLen);
        msg.insert(msg.end(), raw.begin(), raw.end());

        // 6) Ed25519 matematiksel doğrulama (Rust FFI — senaryo verify'ı ile aynı).
        const uint8_t ok = caelus_verify_scenario_signature(
            msg.data(), msg.size(), pubkey, signature);
        if (ok != 1u) {
            std::cerr << "[PLUGIN-SIG] SIGNATURE_MISMATCH: ed25519 dogrulamasi "
                         "basarisiz: " << plugin_path << "\n";
            return false;
        }
        return true;
    } catch (...) {
        std::cerr << "[PLUGIN-SIG] verifier exception — reddedildi: "
                  << plugin_path << "\n";
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PluginSlot — one registered plugin entry (no heap)
// ─────────────────────────────────────────────────────────────────────────────

struct PluginSlot {
    const CaelusPluginVTable* vtbl  = nullptr;
    void*                     state = nullptr;   // plugin-owned; may be nullptr

    bool occupied() const noexcept { return vtbl != nullptr; }

    bool init(const CaelusEngineFns* fns) noexcept {
        if (!vtbl || !vtbl->init) return true;
        return vtbl->init(state, fns) != 0;
    }
    void cleanup() noexcept {
        if (vtbl && vtbl->cleanup) vtbl->cleanup(state);
    }

    uint8_t on_tick(uint64_t tick) const noexcept {
        if (!vtbl || !vtbl->on_tick) return 1;
        return vtbl->on_tick(state, tick);
    }
    uint8_t on_intel(const CaelusIntelEvent* evt) const noexcept {
        if (!vtbl || !vtbl->on_intel) return 1;
        return vtbl->on_intel(state, evt);
    }
    uint8_t solve(const CaelusSolverRequest* req, CaelusSolverResult* out) const noexcept {
        if (!vtbl || !vtbl->solve) return 0;
        return vtbl->solve(req, out);
    }
    uint8_t pull_intel(CaelusIntelEvent* buf, size_t max, size_t* count) const noexcept {
        if (!vtbl || !vtbl->pull_intel) { if (count) *count = 0; return 0; }
        return vtbl->pull_intel(state, buf, max, count);
    }
    uint8_t report(const CaelusReportPayload* p, const char* path) const noexcept {
        if (!vtbl || !vtbl->report) return 1; // silent skip
        return vtbl->report(state, p, path);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PluginRegistry
// ─────────────────────────────────────────────────────────────────────────────

class PluginRegistry {
public:
    // ── Capacity constants ────────────────────────────────────────────────────
    // Fixed-size arrays → zero heap allocation for up to N built-in plugins.
    static constexpr size_t kMaxConnectors = 8;
    static constexpr size_t kMaxReporters  = 4;
    static constexpr size_t kMaxListeners  = 8;  // generic on_tick/on_intel fans
    // Connector pull buffer (stack-allocated; 16 events per connector per tick)
    static constexpr size_t kPullBatchSize = 16;
    using IntelInjectFn = uint8_t (*)(void*, double, uint8_t, const char*, size_t);

    PluginRegistry() = default;
    ~PluginRegistry() { shutdown(); }

    // Non-copyable, non-movable.
    PluginRegistry(const PluginRegistry&)            = delete;
    PluginRegistry& operator=(const PluginRegistry&) = delete;

    // ── Engine service binding ────────────────────────────────────────────────

    /**
     * Bind the engine context and service functions.
     * Must be called before bootstrap().
     * `emitter` may be nullptr (WS disabled).
     */
    void bind_engine(WsEmitter* emitter, std::atomic<uint64_t>* tick_ctr) noexcept {
        emitter_  = emitter;
        tick_ctr_ = tick_ctr;
        // Build the CaelusEngineFns struct for plugins.
        engine_fns_.engine_ctx  = this;
        engine_fns_.emit_json   = &PluginRegistry::ffi_emit_json;
        engine_fns_.inject_intel= &PluginRegistry::ffi_inject_intel;
        engine_fns_.current_tick= &PluginRegistry::ffi_current_tick;
    }

    /**
     * Bind the concrete engine intel sink behind CaelusEngineFns::inject_intel.
     * The registry remains the ABI-facing context; this callback carries the
     * actual CausalEngine / host state without exposing it to plugins.
     */
    void bind_intel_injector(void* ctx, IntelInjectFn fn) noexcept {
        intel_ctx_       = ctx;
        intel_inject_fn_ = fn;
    }

    // ── Registration ─────────────────────────────────────────────────────────

    /**
     * Set the active solver plugin.  Pass `nullptr` to fall back to the
     * built-in DeterministicSolver (always guaranteed to succeed).
     * Returns false if the vtable is ABI-incompatible or init() fails.
     */
    bool set_solver(const CaelusPluginVTable* vtbl, void* state = nullptr) noexcept {
        if (vtbl && !caelus_abi_compatible(vtbl->abi_version)) {
            std::cerr << "[REGISTRY] Solver '" << (vtbl->name ? vtbl->name : "?")
                      << "': ABI uyumsuz — deterministik fallback kullanılıyor.\n";
            return false;
        }
        if (vtbl && vtbl->init) {
            if (!vtbl->init(state, &engine_fns_)) {
                std::cerr << "[REGISTRY] Solver init başarısız — fallback aktif.\n";
                return false;
            }
        }
        solver_.vtbl  = vtbl;
        solver_.state = state;
        return true;
    }

    /**
     * Set the active KEYMGMT provider.
     *
     * T-23 köprüsü: kayıt başarılı olduğunda (ve bir Rust köprüsü
     * set_keymgmt_bridge ile kurulmuşsa) registry, statik trampolinlerini
     * Rust kimlik katmanına (caelus_keymgmt_register) delege olarak kaydeder;
     * provider kaldırıldığında delege NULL/NULL ile temizlenir. KEYMGMT
     * eklentisi yoksa hiçbir şey kaydedilmez → Rust DPAPI/env fallback'i
     * aynen çalışır.
     */
    bool set_keymgmt(const CaelusPluginVTable* vtbl, void* state = nullptr) noexcept {
        if (!vtbl) {
            keymgmt_.cleanup();
            keymgmt_ = {};
            sync_keymgmt_bridge();   // delege varsa NULL/NULL ile temizle
            return true;
        }
        if (!caelus_abi_compatible(vtbl->abi_version)) {
            std::cerr << "[REGISTRY] KEYMGMT '" << (vtbl->name ? vtbl->name : "?")
                      << "': ABI uyumsuz.\n";
            return false;
        }
        if (!caelus_abi_has_keymgmt(vtbl->abi_version) ||
            !vtbl->protect_key || !vtbl->unprotect_key) {
            std::cerr << "[REGISTRY] KEYMGMT provider eksik callback bildiriyor.\n";
            return false;
        }
        PluginSlot slot{vtbl, state};
        if (!slot.init(&engine_fns_)) {
            std::cerr << "[REGISTRY] KEYMGMT init başarısız — atlandı.\n";
            return false;
        }
        keymgmt_.cleanup();
        keymgmt_ = slot;
        sync_keymgmt_bridge();       // yeni provider'ı Rust'a delege et
        return true;
    }

    // ── KEYMGMT → Rust kimlik katmanı köprüsü (T-23'ün C++ yarısı) ───────────
    //
    // Rust tarafı (src/network/mesh_auth.rs) şu C-ABI kayıt fonksiyonunu sunar:
    //   uint8_t caelus_keymgmt_register(protect_fn, unprotect_fn, state);
    //   • iki callback de non-NULL → delege kaydı (kimlik koruması plugin'e gider)
    //   • ikisi de NULL            → temizleme (DPAPI/env fallback'e dönüş)
    // Header'ın kendisi Rust sembolüne SABİT bağımlılık almaz: motor
    // (core_engine.cpp, Rust staticlib ile linklenen TU) kayıt fonksiyonunu
    // set_keymgmt_bridge ile enjekte eder. Köprü kurulmamışsa registry yalnız
    // C++ tarafında çalışır (Rust'sız derlenen testler etkilenmez).

    /// `caelus_keymgmt_register` ile aynı şekilli callback tipi
    /// (CaelusPluginVTable::protect_key / unprotect_key ile de aynı ABI).
    using CaelusKeymgmtCallbackFn =
        uint8_t (*)(void*, const CaelusKeyBlob*, CaelusKeyBlob*);
    using KeymgmtRegisterBridgeFn =
        uint8_t (*)(CaelusKeymgmtCallbackFn protect_fn,
                    CaelusKeymgmtCallbackFn unprotect_fn,
                    void* state);

    /**
     * Rust kayıt fonksiyonunu enjekte et (motor bootstrap'ında, plugin
     * yüklemeden ÖNCE çağrılır). Köprü kurulduğu anda hâlihazırda kayıtlı bir
     * KEYMGMT provider varsa hemen delege edilir.
     */
    void set_keymgmt_bridge(KeymgmtRegisterBridgeFn bridge) noexcept {
        keymgmt_bridge_ = bridge;
        sync_keymgmt_bridge();
    }

    /** Register a CONNECTOR plugin.  Returns false if the slot table is full. */
    bool add_connector(const CaelusPluginVTable* vtbl, void* state = nullptr) noexcept {
        return add_slot_impl(connectors_.data(), n_connectors_, kMaxConnectors,
                             vtbl, state, "CONNECTOR");
    }

    /** Register a REPORTER plugin. */
    bool add_reporter(const CaelusPluginVTable* vtbl, void* state = nullptr) noexcept {
        return add_slot_impl(reporters_.data(), n_reporters_, kMaxReporters,
                             vtbl, state, "REPORTER");
    }

    /** Register a generic listener (receives on_tick + on_intel events). */
    bool add_listener(const CaelusPluginVTable* vtbl, void* state = nullptr) noexcept {
        return add_slot_impl(listeners_.data(), n_listeners_, kMaxListeners,
                             vtbl, state, "LISTENER");
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────

    /**
     * Bootstrap the registry with production defaults.
     *   Solver:    ORToolsSolver if available, DeterministicSolver otherwise.
     *   Connector: NullConnector (no external data source configured).
     *   Reporter:  StdoutReporter (human-readable summary to stdout).
     *
     * In --det-mode, call bootstrap_det() instead — forces DeterministicSolver
     * and NullReporter for a clean, noise-free CI run.
     */
    void bootstrap() noexcept {
        solver_.vtbl  = ActiveSolver::make_default().vtable();
        solver_.state = nullptr;
        add_connector(NullConnector::make_vtable());
        add_reporter (StdoutReporter::make_vtable(), &stdout_reporter_);
        log_config("production");
    }

    /** Bootstrap for --det-mode: DeterministicSolver + NullReporter. */
    void bootstrap_det() noexcept {
        solver_.vtbl  = DeterministicSolver::make_vtable();
        solver_.state = nullptr;
        add_connector(NullConnector::make_vtable());
        add_reporter (NullReporter::make_vtable());
        log_config("det-mode");
    }

    // ── Event dispatch ────────────────────────────────────────────────────────

    /** Dispatch on_tick to all registered listeners. */
    void dispatch_tick(uint64_t tick_nr) noexcept {
        for (size_t i = 0; i < n_listeners_; ++i) listeners_[i].on_tick(tick_nr);
    }

    /** Pull intel from all connectors and inject through the bound engine sink. */
    size_t dispatch_connectors() noexcept
    {
        CaelusIntelEvent buf[kPullBatchSize];
        size_t total = 0;
        for (size_t ci = 0; ci < n_connectors_; ++ci) {
            size_t count = 0;
            connectors_[ci].pull_intel(buf, kPullBatchSize, &count);
            for (size_t ei = 0; ei < count; ++ei) {
                const CaelusIntelEvent& e = buf[ei];
                const uint8_t ok = engine_fns_.inject_intel
                    ? engine_fns_.inject_intel(engine_fns_.engine_ctx,
                                               e.friction_coeff,
                                               e.crisis_level,
                                               e.memo,
                                               std::strlen(e.memo))
                    : 0u;
                if (ok) {
                    dispatch_intel(&e);
                    ++total;
                }
            }
        }
        return total;
    }

    /**
     * Pull intel from all connectors and inject into the supplied legacy sink.
     * Kept for older call sites that map directly to caelus_inject_intel_packet.
     */
    size_t dispatch_connectors(
        bool (*inject_fn)(double, uint8_t, const char*, size_t)) noexcept
    {
        CaelusIntelEvent buf[kPullBatchSize];
        size_t total = 0;
        for (size_t ci = 0; ci < n_connectors_; ++ci) {
            size_t count = 0;
            connectors_[ci].pull_intel(buf, kPullBatchSize, &count);
            for (size_t ei = 0; ei < count; ++ei) {
                const CaelusIntelEvent& e = buf[ei];
                if (inject_fn &&
                    inject_fn(e.friction_coeff, e.crisis_level,
                              e.memo, std::strlen(e.memo))) {
                    dispatch_intel(&e);
                    ++total;
                }
            }
        }
        return total;
    }

    /** Dispatch on_intel to all listeners after an event is processed. */
    void dispatch_intel(const CaelusIntelEvent* evt) noexcept {
        for (size_t i = 0; i < n_listeners_; ++i) listeners_[i].on_intel(evt);
    }

    // ── Solve ─────────────────────────────────────────────────────────────────

    /**
     * Run the active solver.  Falls back to DeterministicSolver if the
     * registered solver returns 0 (failure).
     * Returns the populated SolverResult (never fails — fallback guarantees it).
     */
    [[nodiscard]] SolverResult solve(const SolverRequest& req) noexcept {
        CaelusSolverRequest  c_req = req.to_c();
        CaelusSolverResult   c_res{};

        if (solver_.occupied() && solver_.solve(&c_req, &c_res))
            return SolverResult::from_c(c_res);

        // Registered solver failed — silent fallback to built-in deterministic.
        std::cerr << "[REGISTRY] Solver başarısız — deterministik fallback.\n";
        return DeterministicSolver{}.solve(req);
    }

    // ── Report dispatch ───────────────────────────────────────────────────────

    /**
     * Call all registered reporter plugins with the completed cycle payload.
     * `output_path` is forwarded as-is; pass nullptr for default reporter sinks.
     */
    void dispatch_report(const CaelusReportPayload& payload,
                         const char* output_path = nullptr) noexcept {
        for (size_t i = 0; i < n_reporters_; ++i)
            reporters_[i].report(&payload, output_path);
    }

    bool protect_key(const CaelusKeyBlob* plaintext,
                     CaelusKeyBlob* protected_out) noexcept {
        if (!keymgmt_.occupied() || !keymgmt_.vtbl ||
            !caelus_abi_has_keymgmt(keymgmt_.vtbl->abi_version) ||
            !keymgmt_.vtbl->protect_key) {
            return false;
        }
        return keymgmt_.vtbl->protect_key(keymgmt_.state, plaintext, protected_out) != 0;
    }

    bool unprotect_key(const CaelusKeyBlob* protected_in,
                       CaelusKeyBlob* plaintext_out) noexcept {
        if (!keymgmt_.occupied() || !keymgmt_.vtbl ||
            !caelus_abi_has_keymgmt(keymgmt_.vtbl->abi_version) ||
            !keymgmt_.vtbl->unprotect_key) {
            return false;
        }
        return keymgmt_.vtbl->unprotect_key(keymgmt_.state, protected_in, plaintext_out) != 0;
    }

    // ── Shutdown ──────────────────────────────────────────────────────────────

    void shutdown() noexcept {
        // Dangling fn-ptr önleme (T-23): Rust tarafındaki KEYMGMT delegesini,
        // provider cleanup'ından ve DynamicPluginLoader'ın FreeLibrary/dlclose
        // adımından ÖNCE NULL/NULL ile temizle. Trampolinler motor binary'sinde
        // yaşadığı için zaten unload sonrası bile güvenle 0 dönerdi; yine de
        // delege yaşam döngüsü plugin yaşam döngüsüne sıkı bağlanır.
        if (keymgmt_bridged_ && keymgmt_bridge_) {
            keymgmt_bridge_(nullptr, nullptr, nullptr);
            keymgmt_bridged_ = false;
        }
        solver_.cleanup();
        keymgmt_.cleanup();
        for (size_t i = 0; i < n_connectors_; ++i) connectors_[i].cleanup();
        for (size_t i = 0; i < n_reporters_;  ++i) reporters_[i].cleanup();
        for (size_t i = 0; i < n_listeners_;  ++i) listeners_[i].cleanup();
        solver_ = {};
        keymgmt_ = {};
        n_connectors_ = n_reporters_ = n_listeners_ = 0;
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────

    const char* solver_name() const noexcept {
        return (solver_.vtbl && solver_.vtbl->name) ? solver_.vtbl->name : "(none)";
    }

    const char* keymgmt_name() const noexcept {
        return (keymgmt_.vtbl && keymgmt_.vtbl->name) ? keymgmt_.vtbl->name : "(none)";
    }

private:
    // ── State ─────────────────────────────────────────────────────────────────
    PluginSlot solver_;
    PluginSlot keymgmt_;
    std::array<PluginSlot, kMaxConnectors> connectors_{};
    std::array<PluginSlot, kMaxReporters>  reporters_{};
    std::array<PluginSlot, kMaxListeners>  listeners_{};
    size_t n_connectors_ = 0;
    size_t n_reporters_  = 0;
    size_t n_listeners_  = 0;

    WsEmitter*               emitter_  = nullptr;
    std::atomic<uint64_t>*   tick_ctr_ = nullptr;
    CaelusEngineFns          engine_fns_{};
    void*                    intel_ctx_ = nullptr;
    IntelInjectFn            intel_inject_fn_ = nullptr;

    // T-23 KEYMGMT köprü durumu: enjekte edilen Rust kayıt fonksiyonu ve
    // "şu anda Rust'a delege kayıtlı mı?" bayrağı.
    KeymgmtRegisterBridgeFn  keymgmt_bridge_  = nullptr;
    bool                     keymgmt_bridged_ = false;

    // Stateful reporter instances (stack-allocated, no heap).
    StdoutReporter stdout_reporter_;
    JsonReporter   json_reporter_;

    // ── Private helpers ───────────────────────────────────────────────────────
    bool add_slot_impl(PluginSlot* arr, size_t& n, size_t cap,
                       const CaelusPluginVTable* vtbl, void* state,
                       const char* kind) noexcept {
        if (n >= cap) {
            std::cerr << "[REGISTRY] " << kind << " slot tablosu dolu.\n";
            return false;
        }
        if (vtbl && !caelus_abi_compatible(vtbl->abi_version)) {
            std::cerr << "[REGISTRY] " << kind << " ABI uyumsuz.\n";
            return false;
        }
        PluginSlot slot{vtbl, state};
        if (!slot.init(&engine_fns_)) {
            std::cerr << "[REGISTRY] " << kind << " init başarısız — atlandı.\n";
            return false;
        }
        arr[n++] = slot;
        return true;
    }

    void log_config(const char* mode) const noexcept {
        std::cout << "[REGISTRY] Eklenti kaydı tamamlandı (" << mode << ")\n"
                  << "           Solver    : " << solver_name() << "\n"
                  << "           KEYMGMT   : " << keymgmt_name() << "\n"
                  << "           Connector : " << n_connectors_ << " kayıtlı\n"
                  << "           Reporter  : " << n_reporters_  << " kayıtlı\n";
    }

    // ── T-23 KEYMGMT köprü mekaniği ───────────────────────────────────────────

    /**
     * Registry'nin KEYMGMT durumunu Rust delegesiyle senkronize et:
     *   provider VAR  + köprü var → trampolinleri kaydet (state = this).
     *   provider YOK  + delege kayıtlıysa → NULL/NULL ile temizle.
     * İdempotenttir; set_keymgmt / set_keymgmt_bridge / shutdown çağırır.
     */
    void sync_keymgmt_bridge() noexcept {
        if (!keymgmt_bridge_) return;
        if (keymgmt_.occupied()) {
            const uint8_t ok = keymgmt_bridge_(
                &PluginRegistry::keymgmt_protect_tramp,
                &PluginRegistry::keymgmt_unprotect_tramp,
                this);
            keymgmt_bridged_ = (ok == 1u);
            if (keymgmt_bridged_) {
                std::cout << "[REGISTRY] KEYMGMT delegesi Rust kimlik katmanina "
                             "baglandi: " << keymgmt_name() << "\n";
            } else {
                std::cerr << "[REGISTRY] KEYMGMT delege kaydi Rust tarafinca "
                             "reddedildi — DPAPI/env fallback devam ediyor.\n";
            }
        } else if (keymgmt_bridged_) {
            keymgmt_bridge_(nullptr, nullptr, nullptr);
            keymgmt_bridged_ = false;
            std::cout << "[REGISTRY] KEYMGMT delegesi temizlendi — "
                         "DPAPI/env fallback aktif.\n";
        }
    }

    // Statik trampolinler: Rust'tan gelen protect/unprotect çağrısını
    // registry'nin GUARD'LI protect_key/unprotect_key yoluna yönlendirir
    // (state = PluginRegistry*). Plugin'in vtable fonksiyon pointer'larını
    // Rust'a DOĞRUDAN vermek yerine trampolin kullanılır: DLL unload edilirse
    // doğrudan pointer dangling olurdu; trampolin ise motor binary'sinde
    // yaşar ve slot boşaldığında guard sayesinde güvenle 0 döner.
    static uint8_t keymgmt_protect_tramp(void* state,
                                         const CaelusKeyBlob* plaintext,
                                         CaelusKeyBlob* protected_out) noexcept {
        auto* self = static_cast<PluginRegistry*>(state);
        if (!self || !plaintext || !protected_out) return 0;
        return self->protect_key(plaintext, protected_out) ? 1u : 0u;
    }
    static uint8_t keymgmt_unprotect_tramp(void* state,
                                           const CaelusKeyBlob* protected_in,
                                           CaelusKeyBlob* plaintext_out) noexcept {
        auto* self = static_cast<PluginRegistry*>(state);
        if (!self || !protected_in || !plaintext_out) return 0;
        return self->unprotect_key(protected_in, plaintext_out) ? 1u : 0u;
    }

    // ── Engine FFI callbacks (static, called via CaelusEngineFns) ─────────────
    static uint8_t ffi_emit_json(void* ctx, const char* line) noexcept {
        auto* self = static_cast<PluginRegistry*>(ctx);
        if (!self || !self->emitter_ || !line) return 0;
        self->emitter_->emit(line);
        return 1;
    }
    static uint8_t ffi_inject_intel(void* ctx, double fc, uint8_t cl,
                                    const char* memo, size_t memo_len) noexcept {
        auto* self = static_cast<PluginRegistry*>(ctx);
        if (!self || !self->intel_inject_fn_) return 0;
        return self->intel_inject_fn_(self->intel_ctx_, fc, cl, memo, memo_len);
    }
    static uint64_t ffi_current_tick(void* ctx) noexcept {
        auto* self = static_cast<PluginRegistry*>(ctx);
        if (!self || !self->tick_ctr_) return 0;
        return self->tick_ctr_->load(std::memory_order_relaxed);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DynamicPluginLoader — header-only .dll/.so loader for PluginRegistry
// ─────────────────────────────────────────────────────────────────────────────

class DynamicLibrary {
public:
    DynamicLibrary() = default;
    explicit DynamicLibrary(std::string path) : path_(std::move(path)) {}
    ~DynamicLibrary() { close(); }

    DynamicLibrary(const DynamicLibrary&) = delete;
    DynamicLibrary& operator=(const DynamicLibrary&) = delete;

    DynamicLibrary(DynamicLibrary&& other) noexcept { move_from(std::move(other)); }
    DynamicLibrary& operator=(DynamicLibrary&& other) noexcept {
        if (this != &other) {
            close();
            move_from(std::move(other));
        }
        return *this;
    }

    bool open() noexcept {
        close();
#if defined(_WIN32)
        handle_ = ::LoadLibraryA(path_.c_str());
#else
        handle_ = ::dlopen(path_.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
        if (!handle_) {
            std::cerr << "[LOADER] Eklenti yuklenemedi: " << path_
                      << " (" << last_error() << ")\n";
            return false;
        }
        return true;
    }

    void close() noexcept {
        if (!handle_) return;
#if defined(_WIN32)
        ::FreeLibrary(static_cast<HMODULE>(handle_));
#else
        ::dlclose(handle_);
#endif
        handle_ = nullptr;
    }

    CaelusPluginEntryFn plugin_entry_symbol() const noexcept {
        if (!handle_) return nullptr;
#if defined(_WIN32)
        return reinterpret_cast<CaelusPluginEntryFn>(
            ::GetProcAddress(static_cast<HMODULE>(handle_), CAELUS_PLUGIN_ENTRY_SYMBOL));
#else
        return reinterpret_cast<CaelusPluginEntryFn>(
            ::dlsym(handle_, CAELUS_PLUGIN_ENTRY_SYMBOL));
#endif
    }

private:
    std::string path_;
    void* handle_ = nullptr;

    void move_from(DynamicLibrary&& other) noexcept {
        path_ = std::move(other.path_);
        handle_ = other.handle_;
        other.handle_ = nullptr;
    }

    static std::string last_error() {
#if defined(_WIN32)
        const DWORD err = ::GetLastError();
        if (err == 0) return "unknown";
        char* msg = nullptr;
        const DWORD len = ::FormatMessageA(
            FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
                FORMAT_MESSAGE_IGNORE_INSERTS,
            nullptr, err, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
            reinterpret_cast<LPSTR>(&msg), 0, nullptr);
        std::string out = (len && msg) ? std::string(msg, len) : std::to_string(err);
        if (msg) ::LocalFree(msg);
        while (!out.empty() && (out.back() == '\r' || out.back() == '\n'))
            out.pop_back();
        return out;
#else
        const char* err = ::dlerror();
        return err ? std::string(err) : std::string("unknown");
#endif
    }
};

class DynamicPluginLoader {
public:
    using CaelusPluginSignatureVerifier = bool (*)(const char* path, void* user_ctx) noexcept;

    DynamicPluginLoader() = default;
    ~DynamicPluginLoader() { unload_all(); }

    DynamicPluginLoader(const DynamicPluginLoader&) = delete;
    DynamicPluginLoader& operator=(const DynamicPluginLoader&) = delete;

    /**
     * Bind a production signature verifier for dynamic plugins.
     *
     * The verifier is called before LoadLibrary/dlopen. Returning false rejects
     * the plugin without opening the library. When no verifier is configured,
     * loading is strict-fail by default unless the explicit development bypass
     * CAELUS_PLUGIN_ALLOW_UNVERIFIED=1 is set.
     */
    void set_signature_verifier(CaelusPluginSignatureVerifier verifier,
                                void* user_ctx = nullptr) noexcept {
        signature_verifier_     = verifier;
        signature_verifier_ctx_ = user_ctx;
    }

    bool verify_plugin_signature(const std::string& path) const noexcept {
        if (signature_verifier_) {
            const bool ok = signature_verifier_(path.c_str(), signature_verifier_ctx_);
            if (!ok) {
                std::cerr << "[PLUGIN-SIG] UNVERIFIED_PLUGIN_REJECTED: "
                          << path << "\n";
            }
            return ok;
        }

#ifndef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION'da derleme-dışı: imzasız-plugin dev bypass'ı üretim binary'sinde fiziksel olarak yoktur.
        if (allow_unverified_plugins_for_dev()) {
            std::cerr << "[PLUGIN-SIG] CAELUS_PLUGIN_ALLOW_UNVERIFIED=1 dev bypass: "
                      << path << "\n";
            return true;
        }
#endif

        std::cerr << "[PLUGIN-SIG] SIGNATURE_REQUIRED: " << path << "\n";
        std::cerr << "[PLUGIN-SIG] UNVERIFIED_PLUGIN_REJECTED: " << path << "\n";
        return false;
    }

    /**
     * Load a dynamic plugin, resolve `caelus_plugin_entry`, validate ABI, and
     * register it into PluginRegistry according to plugin_class bits.
     *
     * The loader must outlive registered dynamic plugins. On destruction it
     * first calls registry.shutdown() for the bound registry, then closes all
     * module handles so plugin cleanup code is never called after dlclose.
     */
    bool load_into_registry(const std::string& path, PluginRegistry& registry) noexcept {
        if (bound_registry_ && bound_registry_ != &registry) {
            std::cerr << "[LOADER] Tek loader birden fazla registry'ye baglanamaz.\n";
            return false;
        }

        if (!verify_plugin_signature(path)) return false;

        DynamicLibrary lib(path);
        if (!lib.open()) return false;

        CaelusPluginEntryFn entry = lib.plugin_entry_symbol();
        if (!entry) {
            std::cerr << "[LOADER] '" << path << "' icinde "
                      << CAELUS_PLUGIN_ENTRY_SYMBOL << " sembolu yok.\n";
            return false;
        }

        const CaelusPluginVTable* vtbl = nullptr;
        try {
            vtbl = entry();
        } catch (...) {
            std::cerr << "[LOADER] '" << path << "' entry cagrisi exception firlatti.\n";
            return false;
        }

        if (!vtbl) {
            std::cerr << "[LOADER] '" << path << "' NULL vtable dondurdu.\n";
            return false;
        }
        if (!caelus_abi_compatible(vtbl->abi_version)) {
            std::cerr << "[LOADER] '" << plugin_name(vtbl)
                      << "' ABI uyumsuz: plugin=0x" << std::hex
                      << vtbl->abi_version << " engine=0x"
                      << CAELUS_PLUGIN_ABI_VERSION << std::dec << "\n";
            return false;
        }

        if (!register_vtable(vtbl, registry)) return false;

        bound_registry_ = &registry;
        libraries_.push_back(std::move(lib));
        std::cout << "[LOADER] Dinamik eklenti yuklendi: "
                  << plugin_name(vtbl) << " (" << path << ")\n";
        return true;
    }

    void unload_all() noexcept {
        if (bound_registry_) {
            bound_registry_->shutdown();
            bound_registry_ = nullptr;
        }
        libraries_.clear();
    }

    size_t loaded_count() const noexcept { return libraries_.size(); }

private:
    std::vector<DynamicLibrary> libraries_;
    PluginRegistry* bound_registry_ = nullptr;
    CaelusPluginSignatureVerifier signature_verifier_ = nullptr;
    void* signature_verifier_ctx_ = nullptr;

    static const char* plugin_name(const CaelusPluginVTable* vtbl) noexcept {
        return (vtbl && vtbl->name) ? vtbl->name : "(unnamed)";
    }

#ifndef CAELUS_PRODUCTION
    // CAELUS_PRODUCTION'da derleme-dışı: dev bypass env adı üretim binary'sinin dize taramasına bile girmez.
    static bool allow_unverified_plugins_for_dev() noexcept {
        const char* allow = std::getenv("CAELUS_PLUGIN_ALLOW_UNVERIFIED");
        return allow && std::strcmp(allow, "1") == 0;
    }
#endif

    static bool register_vtable(const CaelusPluginVTable* vtbl,
                                PluginRegistry& registry) noexcept {
        const uint32_t klass = vtbl->plugin_class;
        bool registered = false;

        if (klass & CAELUS_PLUGIN_SOLVER) {
            const bool ok = registry.set_solver(vtbl);
            registered = ok || registered;
            if (!ok) std::cerr << "[LOADER] Solver sinifi kaydedilemedi.\n";
        }
        if (klass & CAELUS_PLUGIN_KEYMGMT) {
            const bool ok = registry.set_keymgmt(vtbl);
            registered = ok || registered;
            if (!ok) std::cerr << "[LOADER] KEYMGMT sinifi kaydedilemedi.\n";
        }
        if (klass & CAELUS_PLUGIN_CONNECTOR) {
            const bool ok = registry.add_connector(vtbl);
            registered = ok || registered;
            if (!ok) std::cerr << "[LOADER] Connector sinifi kaydedilemedi.\n";
        }
        if (klass & CAELUS_PLUGIN_REPORTER) {
            const bool ok = registry.add_reporter(vtbl);
            registered = ok || registered;
            if (!ok) std::cerr << "[LOADER] Reporter sinifi kaydedilemedi.\n";
        }
        if ((klass & CAELUS_PLUGIN_SCENARIO) || vtbl->on_tick || vtbl->on_intel) {
            const bool ok = registry.add_listener(vtbl);
            registered = ok || registered;
            if (!ok) std::cerr << "[LOADER] Listener sinifi kaydedilemedi.\n";
        }

        if (!registered) {
            std::cerr << "[LOADER] '" << plugin_name(vtbl)
                      << "' kaydedilebilir sinif veya callback bildirmiyor.\n";
            return false;
        }
        return true;
    }
};

} // namespace caelus
