/**
 * CAELUS OS — Audit Log C++ Wrapper  (include/audit_log.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * R6 — GELISTIRME_RAPORU.md: Hash-Zincirli Denetim Günlüğü
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rust `src/audit_log.rs` üzerindeki ince C++ sarıcısı.
 * Harici bağımlılık yok — Rust FFI sembolleri link zamanında çözülür.
 *
 * Kullanım:
 *   caelus::AuditLog g_audit;
 *   g_audit.open(local_id, session_id, "caelus_audit_abc123.log");
 *   g_audit.append(ws_json::handshake_event(...));
 *   g_audit.append(ws_json::intel_event(...));
 *   g_audit.seal();   // ed25519 imzası + flush
 *   g_audit.close();  // (destructor otomatik kapatır)
 *
 * Adli analiz araçları:
 *   • Zincir doğrulama: her satırda prev+hash+event'ı kontrol et
 *   • İmza doğrulama:   seal satırındaki pubkey + sig'i ed25519_verify() ile denetle
 *   • Araç örneği: python3 tools/verify_audit_log.py caelus_audit_XXX.log
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <cstring>
#include <ctime>
#include <string>
#include <sstream>
#include <iomanip>
#include <iostream>

// Rust FFI opak türleri (çözüm link zamanında)
struct CaelusIdentityHandle;
struct CaelusAuditLog;

extern "C" {
    /// Yeni denetim günlüğü tahsis et.
    /// log_path: UTF-8 (ptr+len, NUL sonlandırmasız). NULL hata.
    CaelusAuditLog* caelus_audit_new(
        const CaelusIdentityHandle* identity,
        uint64_t  session_id,
        const uint8_t* log_path,
        size_t    log_path_len);

    /// Bir JSON olayını zincire ekle. 1=başarı.
    uint8_t caelus_audit_append(
        CaelusAuditLog* ctx,
        const uint8_t*  event_json,
        size_t          event_len);

    /// Zinciri ed25519 ile mühürle. İdempotent. 1=başarı.
    uint8_t caelus_audit_seal(CaelusAuditLog* ctx);

    /// Mevcut zincir başını out_hash'e kopyala (≥32 bayt). 1=başarı.
    uint8_t caelus_audit_chain_head(
        const CaelusAuditLog* ctx,
        uint8_t* out_hash);

    /// Mevcut giriş sayısını döndür (genesis + event'lar, seal hariç).
    uint64_t caelus_audit_entry_count(const CaelusAuditLog* ctx);

    /// Denetim günlüğünü serbest bırak (mühürlenmemişse önce mühürler). NULL güvenli.
    void caelus_audit_free(CaelusAuditLog* ctx);
}

namespace caelus {

// ─────────────────────────────────────────────────────────────────────────────
// AuditLog — RAII C++ sarıcısı
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AuditLog
 *
 * Blake3 zincirli, ed25519 mühürlü, append-only denetim günlüğü.
 *
 * Dosya adlandırma:
 *   caelus_audit_<session_id_hex16>.log
 *   Örnek: caelus_audit_000000673b2e5f40.log
 *
 * Zincir kırılma tespiti (harici araç):
 *   Her satır: prev_hash || event_json → Blake3 → hash ile eşleşmeli.
 */
class AuditLog {
public:
    AuditLog()  = default;
    ~AuditLog() { close(); }

    // Kopyalanamaz, taşınamaz (soket+thread ile aynı kural).
    AuditLog(const AuditLog&)            = delete;
    AuditLog& operator=(const AuditLog&) = delete;

    /**
     * open — denetim günlüğünü başlat.
     *
     * @param identity    Mevcut cihaz kimliği (caelus_identity_new / load_or_create).
     * @param session_id  Benzersiz oturum kimliği (ör: time(nullptr) döküm zamanı).
     * @param path        Günlük dosya yolu.
     * @return true = başarılı, false = dosya açılamadı veya identity null.
     */
    bool open(const CaelusIdentityHandle* identity,
              uint64_t session_id,
              const std::string& path) {
        close();
        path_ = path;
        ctx_  = caelus_audit_new(
            identity, session_id,
            reinterpret_cast<const uint8_t*>(path.data()), path.size());
        if (!ctx_) {
            std::cerr << "[AUDIT] Günlük açılamadı: " << path << "\n";
        }
        return ctx_ != nullptr;
    }

    /**
     * append — bir JSON olayını zincire ekle.
     *
     * event_json'ı doğrudan Rust'a iletir; Rust tarafı
     *   h_n = Blake3(h_{n-1} || event_json_bytes)
     * hesaplar ve satırı diske yazar.
     *
     * Güvenlik: event_json içeriksel olarak güvenli olmalıdır (bu sınıf
     *   hiçbir şekilde içeriği yorumlamaz — sadece Rust'a iletir).
     */
    bool append(const std::string& event_json) {
        if (!ctx_) return false;
        return caelus_audit_append(
            ctx_,
            reinterpret_cast<const uint8_t*>(event_json.data()),
            event_json.size()) != 0;
    }

    /**
     * seal — zinciri ed25519 ile mühürle.
     *
     * İmzalanan mesaj (Rust tarafında):
     *   CAELUS_AUDIT_SEAL_V1 || session_id_le8 || seq_le8 || chain_head_32
     *
     * Bir kez çağrılabilir; sonraki çağrılar güvenle yoksayılır.
     * Destructor seal() çağrılmamışsa otomatik çağırır.
     */
    bool seal() {
        if (!ctx_) return false;
        return caelus_audit_seal(ctx_) != 0;
    }

    /**
     * chain_head_hex — mevcut zincir başını 64-karakter hex string olarak döndür.
     * Boş string = günlük açık değil.
     */
    [[nodiscard]] std::string chain_head_hex() const {
        if (!ctx_) return {};
        uint8_t head[32] = {};
        if (!caelus_audit_chain_head(ctx_, head)) return {};
        std::ostringstream oss;
        oss << std::hex << std::setfill('0');
        for (int i = 0; i < 32; ++i)
            oss << std::setw(2) << static_cast<unsigned>(head[i]);
        return oss.str();
    }

    /** Dosyayı kapat (seal edilmemişse önce seal). */
    void close() {
        if (ctx_) { caelus_audit_free(ctx_); ctx_ = nullptr; }
    }

    bool        is_open()  const noexcept { return ctx_ != nullptr; }
    uint64_t    entries()  const noexcept {
        return ctx_ ? caelus_audit_entry_count(ctx_) : 0;
    }
    const std::string& path() const noexcept { return path_; }

    // ── Kolaylık yardımcıları ─────────────────────────────────────────────────

    /**
     * append_raw — C-string JSON ekle (c_str() için kolaylık).
     */
    bool append_raw(const char* json) {
        if (!ctx_ || !json) return false;
        return caelus_audit_append(
            ctx_,
            reinterpret_cast<const uint8_t*>(json),
            std::strlen(json)) != 0;
    }

    /**
     * Statik yardımcı: oturum kimliği ve log yolunu otomatik oluştur.
     * session_id = Unix epoch (deterministik değil; adli benzersizlik için).
     */
    static std::string make_log_path(uint64_t session_id) {
        std::ostringstream oss;
        oss << "caelus_audit_"
            << std::hex << std::setfill('0') << std::setw(16) << session_id
            << ".log";
        return oss.str();
    }

private:
    CaelusAuditLog* ctx_  = nullptr;
    std::string     path_;
};

} // namespace caelus
