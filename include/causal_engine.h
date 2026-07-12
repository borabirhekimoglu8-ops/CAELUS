/**
 * CAELUS OS — Causal Engine v2  (include/causal_engine.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MİMARİ GEREKÇE (R1 — GELISTIRME_RAPORU.md)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Önceki motor:  ağırlıklı doğrusal toplam (weighted linear sum)
 *   multiplier = 1.0 + 0.30*bureaucracy + 0.35*labor + 0.20*congestion + ...
 *   → Düğümler arası nedensellik yok. Geri besleme yok. Histerezis yok.
 *   → Saha verisi (IntelFeedPacket) formüle değil, sisteme entegre edilemez.
 *
 * Bu motor:  tick-tabanlı nedensel yayılım (causal propagation)
 *   → Her düğümün durumu komşularının durumundan etkilenir.
 *   → Kenar çarpanları (multiplier_fp) dinamik olarak değişir.
 *   → Geri besleme döngüleri sürtünmeyi kendi kendine büyütür.
 *   → Histerezis: bir eşik aşılırsa sistem geri alınamaz biçimde değişir.
 *   → Gözlemlenebilirlik katmanı: raporlanan ≠ gerçek durum.
 *   → REGIME_EXCEEDED: kenet öncesi yangın düğmesi — sessiz doyum yok.
 *
 * Sabit nokta aritmetiği:
 *   Tüm değerler int64_t, ölçek = 1_000_000 (1.0 = 1_000_000).
 *   • Çarpma: saturating((a * b) / FP_SCALE), ara çarpım taşması yok
 *   • Bölme:  saturating((a * FP_SCALE) / b), ara çarpım taşması yok
 *   → IEEE 754 platform farklarından bağımsız tam determinizm.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <array>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>
#include <algorithm>
#include <limits>

#include "src/intel_core.h"   // OperationalRiskProfile, FRICTION_MULTIPLIER_MAX
#include "det_rng.h"           // DetRng for lever probability
#include "caelus_logger.h"     // Zero-overhead causal hot-path events

namespace caelus::causal {

// ─────────────────────────────────────────────────────────────────────────────
// Sabit nokta aritmetik yardımcıları  (FP_SCALE = 1e6)
// ─────────────────────────────────────────────────────────────────────────────

static constexpr int64_t FP_SCALE = 1'000'000LL;   ///< 1.0 sabit noktada
static constexpr int64_t FP_ONE   = FP_SCALE;

namespace detail {

static constexpr int64_t FP_I64_MAX = (std::numeric_limits<int64_t>::max)();
static constexpr int64_t FP_I64_MIN = (std::numeric_limits<int64_t>::min)();
static constexpr uint64_t FP_I64_MIN_MAG = (uint64_t{1} << 63);

inline constexpr uint64_t fp_abs_u64(int64_t v) noexcept {
    return v < 0
        ? static_cast<uint64_t>(-(v + 1)) + 1u
        : static_cast<uint64_t>(v);
}

inline constexpr uint64_t fp_sat_add_u64(uint64_t a, uint64_t b, uint64_t cap) noexcept {
    if (a >= cap || b >= cap) return cap;
    return a > cap - b ? cap : a + b;
}

inline constexpr uint64_t fp_sat_double_u64(uint64_t v, uint64_t cap) noexcept {
    if (v >= cap) return cap;
    return v > cap - v ? cap : v + v;
}

// Computes min(cap, floor((a * b) / divisor)) without ever forming a * b.
inline constexpr uint64_t fp_mul_div_u64_sat(
    uint64_t a, uint64_t b, uint64_t divisor, uint64_t cap) noexcept
{
    if (divisor == 0u || a == 0u || b == 0u || cap == 0u) return 0u;

    uint64_t result_q = 0u;
    uint64_t result_r = 0u;
    uint64_t add_q = a / divisor;
    uint64_t add_r = a % divisor;

    while (b != 0u) {
        if ((b & 1u) != 0u) {
            result_q = fp_sat_add_u64(result_q, add_q, cap);
            result_r += add_r; // add_r < divisor, so this stays below 2*divisor.
            if (result_r >= divisor) {
                result_r -= divisor;
                result_q = fp_sat_add_u64(result_q, 1u, cap);
            }
            if (result_q >= cap) return cap;
        }
        b >>= 1u;
        if (b == 0u) break;

        const bool carry = add_r >= divisor - add_r;
        add_r += add_r;
        if (carry) add_r -= divisor;
        add_q = fp_sat_double_u64(add_q, cap);
        if (carry) add_q = fp_sat_add_u64(add_q, 1u, cap);
    }

    return result_q > cap ? cap : result_q;
}

inline constexpr int64_t fp_from_signed_mag(uint64_t mag, bool negative) noexcept {
    if (!negative) {
        return mag > static_cast<uint64_t>(FP_I64_MAX)
            ? FP_I64_MAX
            : static_cast<int64_t>(mag);
    }
    if (mag >= FP_I64_MIN_MAG) return FP_I64_MIN;
    return -static_cast<int64_t>(mag);
}

} // namespace detail

inline constexpr int64_t fp_add_saturating(int64_t a, int64_t b) noexcept {
    if (b > 0 && a > detail::FP_I64_MAX - b) return detail::FP_I64_MAX;
    if (b < 0 && a < detail::FP_I64_MIN - b) return detail::FP_I64_MIN;
    return a + b;
}

inline constexpr int64_t fp_mul(int64_t a, int64_t b) noexcept {
    const bool negative = (a < 0) != (b < 0);
    const uint64_t cap = negative
        ? detail::FP_I64_MIN_MAG
        : static_cast<uint64_t>(detail::FP_I64_MAX);
    const uint64_t mag = detail::fp_mul_div_u64_sat(
        detail::fp_abs_u64(a),
        detail::fp_abs_u64(b),
        static_cast<uint64_t>(FP_SCALE),
        cap);
    return detail::fp_from_signed_mag(mag, negative);
}
inline constexpr int64_t fp_div(int64_t a, int64_t b) noexcept {
    if (b == 0LL) return 0LL;
    const bool negative = (a < 0) != (b < 0);
    const uint64_t cap = negative
        ? detail::FP_I64_MIN_MAG
        : static_cast<uint64_t>(detail::FP_I64_MAX);
    const uint64_t mag = detail::fp_mul_div_u64_sat(
        detail::fp_abs_u64(a),
        static_cast<uint64_t>(FP_SCALE),
        detail::fp_abs_u64(b),
        cap);
    return detail::fp_from_signed_mag(mag, negative);
}
inline constexpr int64_t fp_clamp(int64_t v, int64_t lo, int64_t hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}
inline constexpr double  fp_to_d(int64_t v) noexcept {
    return static_cast<double>(v) / static_cast<double>(FP_SCALE);
}
inline int64_t d_to_fp(double v) noexcept {
    if (std::isnan(v)) return 0LL;
    if (v >= static_cast<double>(detail::FP_I64_MAX) / static_cast<double>(FP_SCALE)) {
        return detail::FP_I64_MAX;
    }
    if (v <= static_cast<double>(detail::FP_I64_MIN) / static_cast<double>(FP_SCALE)) {
        return detail::FP_I64_MIN;
    }
    return static_cast<int64_t>(v * static_cast<double>(FP_SCALE));
}

/// Motor sürtünme tavanı — FRICTION_MULTIPLIER_MAX ile hizalı.
static constexpr int64_t FRICTION_MIN_FP = FP_ONE;            ///< 1.0x
static constexpr int64_t FRICTION_MAX_FP = 3LL * FP_SCALE;   ///< 3.0x
/// Throughput=0 sentinel (akış tıkanması, rejim aşımı).
static constexpr int64_t FRICTION_OUTAGE_FP = 1000LL * FP_SCALE;

// ─────────────────────────────────────────────────────────────────────────────
// Node — sistem kaynağı / tüketicisi
// ─────────────────────────────────────────────────────────────────────────────

enum class NodeKind : uint8_t {
    Service    = 0,  ///< Aktif hizmet düğümü (soyut işlem/kapasite birimi)
    Buffer     = 1,  ///< Envanter / bekletme tamponu
    Queue      = 2,  ///< Dış kuyruk / bekleme koridoru
    Perishable = 3,  ///< Zaman-kritik (bozulabilir) kaynak
    Gate       = 4,  ///< Regülasyon / bürokratik kapı
    Adversary  = 5,  ///< Çıkarı sisteme karşı olan aktör düğümü
};

/**
 * Node — nedensel grafın en küçük birimi.
 *
 * Gözlemlenebilirlik katmanı:
 *   reported_state_fp ≠ state_fp  →  plan-gerçekleşme sapması.
 *   trust_fp azaldıkça raporlanan durum ağırlığı düşer, motor
 *   güven-ağırlıklı yeniden planlamaya geçer.
 */
struct Node {
    std::string id;
    NodeKind    kind            = NodeKind::Service;

    int64_t     capacity_fp    = FP_ONE;  ///< Maksimum durum [0..n]
    int64_t     state_fp       = 0LL;     ///< Gerçek durum [0..capacity]
    int64_t     weight_fp      = 0LL;     ///< Sürtünme katkı ağırlığı [0..1]

    // ── Gözlemlenebilirlik ─────────────────────────────────────────────────
    int64_t     reported_state_fp = 0LL;  ///< Dışarıya görünen durum
    int64_t     trust_fp       = FP_ONE;  ///< Veri güvenilirliği [0..1]

    // ── Zaman / kriz ──────────────────────────────────────────────────────
    int32_t     deadline_tick  = -1;   ///< Deadline tick'i (-1=yok)
    bool        deadline_missed = false;
    bool        irrecoverable  = false; ///< true → düğüm geri kazanılamaz
};

/**
 * A bounded, pre-validated trust adjustment submitted to the symbolic
 * authority.  The neural layer can propose these values, but only
 * CausalEngine applies them after atomically re-checking every adjustment.
 */
struct BoundedTrustAdjustment {
    uint32_t node_index = 0;
    int64_t  delta_fp   = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Edge — nedensel kenar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Edge — from düğümünün durumu to düğümünü nasıl etkiler.
 *
 * multiplier_fp: 1.0'ın üzeri kuvvetlendirir, altı zayıflatır.
 * lag_ticks:     0 = anlık etki, N = N tick sonra etkili.
 *
 * Geçerli kenar tipleri:
 *   • Sürtünme katkısı: from (kaynak düğüm) → to = "" (aggregation path)
 *     from.state * from.weight * this.multiplier → toplam sürtünmeye eklenir
 *   • Durum yayılımı: from → to (normal düğüm)
 *     from.state * this.multiplier / 100 → to.state değişimine eklenir
 */
struct Edge {
    std::string from;
    std::string to;           ///< "" = sürtünme toplamasına (aggregation)
    int64_t     multiplier_fp = FP_ONE;
    int32_t     lag_ticks     = 0;
    bool        active        = true;
};

// ─────────────────────────────────────────────────────────────────────────────
// FeedbackLoop — pekiştirme / dengeleme döngüsü
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FeedbackLoop — yol boyunca bir döngü tanımlar.
 *
 * gain_fp > FP_ONE → pekiştiren (reinforcing): her tick döngüdeki
 *   en zayıf sinyal gain ile çarpılır, ilk düğüme geri beslenir.
 *   gain_fp = 1.30 × FP_ONE → orta şiddetli pekiştiren döngü örneği.
 *
 * gain_fp < FP_ONE → dengeleyici (balancing): sistemi kararlıya çeker.
 */
struct FeedbackLoop {
    std::string              id;
    std::vector<std::string> path;          ///< Sıralı düğüm id'leri
    int64_t                  gain_fp = FP_ONE;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lever — ikna kaldıracı (durumu dönüştüren aksiyon)
// ─────────────────────────────────────────────────────────────────────────────

struct LeverOutcome {
    std::string target_node_id;
    int64_t     state_delta_fp     = 0LL;   ///< Hedef düğümün durum değişimi
    int64_t     trust_delta_fp     = 0LL;   ///< Güven katsayısı değişimi
    int64_t     friction_delta_fp  = 0LL;   ///< Doğrudan sürtünme etkisi
    bool        clear_irrecoverable= false; ///< Geri kazanılamaz bayrağını kaldır
};

/**
 * Lever — "ikna kaldıracı" = psikolojik veya operasyonel müdahale.
 *
 * success_p_fp: başarı olasılığı [0..FP_ONE].
 * Sonuç, tohumlu DetRng ile deterministik olarak hesaplanır.
 * Başarısız lever lockout_ticks boyunca kilitlenir.
 */
struct Lever {
    std::string  id;
    std::string  target;            ///< Hedef aktör / düğüm
    int64_t      success_p_fp;      ///< Başarı olasılığı [0..FP_ONE]
    int32_t      cost_ticks  = 1;
    int32_t      lockout_ticks = 0;
    LeverOutcome on_success;
    LeverOutcome on_failure;
    // ── Çalışma zamanı ──────────────────────────────────────────────────────
    int32_t      remaining_lockout = 0;
    bool         available         = true;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hysteresis — geri alınamaz eşik (kalıcı kapasite/akış kaybı)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hysteresis — threshold_tick tick'inde ya sistem iyileşir ya da
 * kalıcı olarak değişir.
 *
 * reversible=false → eşik aşılırsa permanent_loss_fp kadar sürtünme
 * kalıcı olarak eklenir ve flipped=true olur (geri alınamaz akış kaybı).
 */
struct Hysteresis {
    std::string id;
    int32_t     threshold_tick;
    bool        reversible         = true;
    int64_t     permanent_loss_fp  = 0LL;   ///< Kalıcı sürtünme artışı
    // ── Çalışma zamanı ──────────────────────────────────────────────────────
    bool        flipped = false;
};

// ─────────────────────────────────────────────────────────────────────────────
// EngineSnapshot — tek tick'in anlık görüntüsü
// ─────────────────────────────────────────────────────────────────────────────

struct EngineSnapshot {
    uint64_t tick                 = 0;
    int64_t  raw_friction_fp      = FP_ONE;   ///< Kenet öncesi toplam sürtünme
    int64_t  clamped_friction_fp  = FP_ONE;   ///< [FRICTION_MIN..MAX]'a kenetlenmiş
    bool     regime_exceeded      = false;    ///< raw > 3.0x → REGIME_EXCEEDED
    bool     any_deadline_missed  = false;
    bool     any_hysteresis_flip  = false;
    bool     outage_active        = false;    ///< throughput = 0 (akış tıkanması)
    int64_t  throughput_ratio_fp  = FP_ONE;   ///< Fixed-point throughput ratio
    double   throughput_ratio     = 1.0;      ///< 0..1, 1=nominal akış
    char     summary[128]         = {};       ///< İnsan okunur durum

    double raw_friction_d()     const noexcept { return fp_to_d(raw_friction_fp);     }
    double clamped_friction_d() const noexcept { return fp_to_d(clamped_friction_fp); }
};

// ─────────────────────────────────────────────────────────────────────────────
// EngineStateV1 — tam motor durumu (checkpoint/restore sözleşmesi)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EngineStateV1
 *
 * Complete, versioned copy of every field that determines future engine
 * behaviour: the full graph (nodes, edges, loops, levers, hysteresis) plus
 * runtime scalars including the PRNG seed.  Used by host checkpoint layers
 * (mobile suspension/restore) — the tick path itself never reads this type,
 * so exporting/restoring cannot change simulation semantics.
 *
 * Restoring replaces engine state wholesale.  Trust-boundary validation
 * (topology binding against the signed scenario, integrity hashes) is the
 * responsibility of the host checkpoint layer; the engine itself only
 * enforces structural sanity so that a restored state cannot break engine
 * invariants that the tick path relies on.
 */
struct EngineStateV1 {
    static constexpr size_t kMaxNodes      = 4096;
    static constexpr size_t kMaxEdges      = 16384;
    static constexpr size_t kMaxLoops      = 1024;
    static constexpr size_t kMaxLevers     = 1024;
    static constexpr size_t kMaxHysteresis = 1024;

    std::vector<Node>         nodes;
    std::vector<Edge>         edges;
    std::vector<FeedbackLoop> loops;
    std::vector<Lever>        levers;
    std::vector<Hysteresis>   hysteresis;

    uint64_t tick                  = 0;
    int64_t  friction_fp           = FP_ONE;
    int64_t  permanent_friction_fp = 0LL;
    bool     regime_exceeded       = false;
    bool     outage                = false;
    uint64_t prng_seed             = 0;
    int64_t  last_intel_risk_fp    = 0LL;
    bool     has_intel_risk        = false;
};


// ─────────────────────────────────────────────────────────────────────────────
// CausalEngine — nedensel graf motoru
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CausalEngine
 *
 * Kullanım (üretim modu):
 *   CausalEngine eng;
 *   eng.load_universal_blank_slate();          // evrensel boş şablon (sıfır akış)
 *   eng.inject_intel(0.82, 2, "FIELD...");     // saha verisi enjekte et
 *   EngineSnapshot snap = eng.run_ticks(3);    // yay
 *   double mu = snap.clamped_friction_d();     // → SolverRequest'e gönder
 *
 * Senaryo enjeksiyonu yoksa motor boş şablonla 1.0x taban sürtünmede bekler
 * (AWAITING SCENARIO INJECTION). Tüm kriz yapısı dış JSON senaryo paketinden
 * (ScenarioPack::apply_to_engine) gelir; motor sektör-agnostiktir.
 *
 * Kullanım (CI --det-mode):
 *   eng.set_prng_seed(0xCAE105DEADBEEF00ULL);  // deterministik kol
 *   // Aksi durumda aynı çağrı sırası aynı sonucu verir.
 */
class CausalEngine {
public:
    CausalEngine() = default;

    // ── Graf yapılandırma ────────────────────────────────────────────────────

    void add_node      (Node n)         { nodes_.push_back(std::move(n));   }
    void add_edge      (Edge e)         { edges_.push_back(std::move(e));   }
    void add_loop      (FeedbackLoop f) { loops_.push_back(std::move(f));   }
    void add_lever     (Lever l)        { levers_.push_back(std::move(l));  }
    void add_hysteresis(Hysteresis h)   { hysts_.push_back(std::move(h));   }

    /** Deterministik lever olasılık hesabı için PRNG tohumu (0 = gerçek CSPRNG). */
    void set_prng_seed(uint64_t seed) noexcept { prng_seed_ = seed; }

    // ── Senaryo yükleme ──────────────────────────────────────────────────────

    /**
     * load_universal_blank_slate
     *
     * Sektör-agnostik EVRENSEL BOŞ ŞABLON kurar. Soyut/matematiksel isimli
     * iskelet düğümler içerir; tüm durumlar SIFIR (nötr) olduğundan motor
     * akış üretmez → taban sürtünme 1.0x.  Bu, "AWAITING SCENARIO INJECTION"
     * durumudur: gerçek kriz yapısı yalnızca dış JSON senaryo paketinden gelir.
     *
     *   friction = 1.0 + Σ(node.state/cap × node.weight) = 1.0   (state=0 iken)
     *
     * Düğümler sektör-bağımsızdır:
     *   Regulatory_Gate  — regülasyon / bürokratik kapı  (intel hedefi)
     *   Actor_Alpha      — birincil aktör (sürtünme sürücüsü, intel hedefi)
     *   Transit_Node     — akış / transit / kuyruk düğümü (intel hedefi)
     *   Friction_Entity  — dışsal sürtünme kaynağı
     *   Buffer_Node      — tampon / gecikme belleği
     */
    void load_universal_blank_slate() {
        nodes_.clear(); edges_.clear(); loops_.clear(); levers_.clear(); hysts_.clear();
        tick_ = 0; friction_fp_ = FP_ONE; regime_exceeded_ = false; outage_ = false;
        permanent_friction_fp_ = 0LL;
        last_intel_risk_fp_ = 0LL;
        has_intel_risk_ = false;

        // ── Evrensel iskelet düğümler (state=0 → sıfır akış, sürtünme 1.0x) ──
        // weight_fp atanır ama state_fp=0 olduğu için katkı = 0'dır. Ağırlıklar
        // yalnızca intel enjekte edildiğinde (inject_intel) anlam kazanır.
        auto mk = [&](const char* id, NodeKind kind, double weight) {
            Node n;
            n.id              = id;
            n.kind            = kind;
            n.capacity_fp     = FP_ONE;
            n.state_fp        = 0LL;          // BOŞ ŞABLON: nötr/sıfır durum
            n.weight_fp       = d_to_fp(weight);
            n.reported_state_fp = 0LL;        // raporlanan = gerçek = 0
            n.trust_fp        = FP_ONE;
            nodes_.push_back(std::move(n));
        };

        mk("Regulatory_Gate", NodeKind::Gate,    0.30);
        mk("Actor_Alpha",     NodeKind::Service, 0.35);
        mk("Transit_Node",    NodeKind::Queue,   0.20);
        mk("Friction_Entity", NodeKind::Service, 0.15);
        mk("Buffer_Node",     NodeKind::Buffer,  0.25);
    }

    // ── Saha verisi enjeksiyonu ──────────────────────────────────────────────

    /**
     * inject_intel
     *
     * Sahadan gelen IntelFeedPacket değerlerini evrensel graf düğümlerine
     * yansıtır (sektör-agnostik). Düğüm adları boş şablondaki soyut isimlerdir;
     * bir senaryo paketi farklı düğüm adları kullanıyorsa ilgili güncelleme
     * sessizce atlanır (get_node nullptr döner) — paketin kendi grafı geçerlidir.
     *   • Actor_Alpha.state     = max(current, field_coeff)   (birincil sinyal)
     *   • Regulatory_Gate.state += crisis_level * 0.10 (damped) (regülasyon tepkisi)
     *   • Transit_Node.state    += 0.20  (yalnız crisis_level≥3)  (akış baskısı)
     */
    void inject_intel(double field_coeff, int crisis_level, const char* memo) noexcept {
        field_coeff = std::max(0.0, std::min(1.0, field_coeff));
        inject_intel_fp(d_to_fp(field_coeff), crisis_level, memo);
    }

    void inject_intel_fp(int64_t field_coeff_fp, int crisis_level, const char* memo) noexcept {
        field_coeff_fp = fp_clamp(field_coeff_fp, 0LL, FP_ONE);
        crisis_level = crisis_level < 0 ? 0 : (crisis_level > 3 ? 3 : crisis_level);
        last_intel_risk_fp_ = field_coeff_fp;
        has_intel_risk_ = true;

        // Birincil aktör: kriz sinyalini taşıyan düğüm
        if (Node* actor = get_node("Actor_Alpha")) {
            actor->state_fp         = std::max(actor->state_fp, field_coeff_fp);
            actor->reported_state_fp= actor->state_fp;  // tam kriz sinyali raporlanır
        }
        if (Node* gate = get_node("Regulatory_Gate")) {
            // Regülasyon tepkisi: kriz seviyesiyle orantılı, damped
            int64_t bump = d_to_fp(crisis_level * 0.10);
            gate->state_fp = fp_clamp(fp_add_saturating(gate->state_fp, bump),
                                      0LL, gate->capacity_fp);
            gate->reported_state_fp = gate->state_fp;
        }
        if (crisis_level >= 3) {
            if (Node* transit = get_node("Transit_Node")) {
                int64_t bump = d_to_fp(0.20);
                transit->state_fp = fp_clamp(fp_add_saturating(transit->state_fp, bump),
                                             0LL, transit->capacity_fp);
                transit->reported_state_fp = transit->state_fp;
            }
        }

        (void)memo;
        CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Info,
                                ::caelus::logging::CausalLogCode::IntelInjected,
                                tick_,
                                "intel injected");
    }

    // ── Tick yayılımı ────────────────────────────────────────────────────────

    /**
     * tick — motoru bir adım ilerletir.
     *
     * Sıra:
     *   1. Kenar yayılımı (durum değişimlerini komşulara ilet)
     *   2. Geri besleme döngüsü kazanımları
     *   3. Güven güncellemesi (gözlemlenebilirlik sapma kontrolü)
     *   4. Toplam sürtünme hesabı
     *   5. REGIME_EXCEEDED kontrolü (kenet ÖNCESİNDE ateşlenir)
     *   6. Histerezis eşik kontrolü
     *   7. Deadline kontrolü
     *   8. tick_ artışı
     */
    EngineSnapshot tick() noexcept {
        propagate_edges();
        apply_feedback_loops();
        update_trust();
        decay_lever_lockouts();

        int64_t raw = aggregate_friction();
        friction_fp_ = fp_add_saturating(raw, permanent_friction_fp_);

        check_regime(friction_fp_);
        check_hysteresis();
        check_deadlines();
        ++tick_;

        return build_snapshot();
    }

    /** N tick koştur; son anlık görüntüyü döndür. */
    EngineSnapshot run_ticks(uint32_t n) noexcept {
        EngineSnapshot snap{};
        for (uint32_t i = 0; i < n; ++i) snap = tick();
        return snap;
    }

    // ── İkna kaldıracı ──────────────────────────────────────────────────────

    /**
     * apply_lever
     *
     * Tohumlu DetRng ile deterministik ikna kaldıracı uygular.
     * seed=0 ise zaman-tabanlı bir tohum kullanılır (üretim).
     * Başarısız lever lockout_ticks boyunca bloke edilir.
     */
    [[nodiscard]] bool apply_lever(const std::string& lever_id,
                                   uint64_t seed = 0) noexcept {
        Lever* lev = nullptr;
        for (auto& l : levers_) { if (l.id == lever_id) { lev = &l; break; } }
        if (!lev || !lev->available || lev->remaining_lockout > 0) return false;

        // Deterministik olasılık
        uint64_t s = seed ? seed : (prng_seed_ ? prng_seed_ + tick_ : (uint64_t)tick_);
        DetRng rng(s);
        int64_t roll = static_cast<int64_t>(rng.next() % (uint64_t)FP_SCALE);
        bool success = roll < lev->success_p_fp;

        const LeverOutcome& outcome = success ? lev->on_success : lev->on_failure;
        if (!outcome.target_node_id.empty()) {
            if (Node* n = get_node(outcome.target_node_id)) {
                n->state_fp = fp_clamp(fp_add_saturating(n->state_fp, outcome.state_delta_fp),
                                       0LL, n->capacity_fp);
                n->trust_fp = fp_clamp(fp_add_saturating(n->trust_fp, outcome.trust_delta_fp),
                                       0LL, FP_ONE);
                n->reported_state_fp = n->state_fp;
                if (success && outcome.clear_irrecoverable) n->irrecoverable = false;
            }
        }
        if (success && outcome.clear_irrecoverable) {
            clear_outage_recovery();
        }
        if (outcome.friction_delta_fp != 0LL) {
            permanent_friction_fp_ = fp_clamp(
                fp_add_saturating(permanent_friction_fp_, outcome.friction_delta_fp),
                -FP_ONE, FRICTION_MAX_FP);
        }
        const int32_t action_cost_lockout = lev->cost_ticks > 1 ? (lev->cost_ticks - 1) : 0;
        lev->remaining_lockout = success
            ? action_cost_lockout
            : std::max(action_cost_lockout, lev->lockout_ticks);
        (void)lever_id;
        CAELUS_CAUSAL_LOG_EVENT(success ? ::caelus::logging::LogLevel::Info
                                        : ::caelus::logging::LogLevel::Warn,
                                success ? ::caelus::logging::CausalLogCode::LeverSucceeded
                                        : ::caelus::logging::CausalLogCode::LeverFailed,
                                tick_,
                                success ? "lever succeeded" : "lever failed");
        return success;
    }

    // ── Sorgulama ────────────────────────────────────────────────────────────

    /**
     * reset — graf ve çalışma zamanı durumunu sıfırla.
     * prng_seed_ KORUNUR (çağrıcı seed'i önceden veya sonradan ayarlar).
     * ScenarioPack::apply_to_engine() tarafından çağrılır.
     */
    void reset() noexcept {
        nodes_.clear(); edges_.clear(); loops_.clear(); levers_.clear(); hysts_.clear();
        tick_                 = 0;
        friction_fp_          = FP_ONE;
        permanent_friction_fp_= 0LL;
        regime_exceeded_      = false;
        outage_               = false;
        last_intel_risk_fp_    = 0LL;
        has_intel_risk_        = false;
        // prng_seed_ intentionally preserved
    }

    uint64_t current_tick()     const noexcept { return tick_; }
    int64_t  friction_fp()      const noexcept { return friction_fp_; }
    bool     regime_exceeded()  const noexcept { return regime_exceeded_; }
    bool     outage_active()    const noexcept { return outage_; }
    bool     has_intel_risk()   const noexcept { return has_intel_risk_; }
    int64_t  last_intel_risk_fp() const noexcept { return last_intel_risk_fp_; }

    // Stable scenario insertion order is the neural feature/index order.
    // These are read-only views; they do not grant mutation authority.
    const std::vector<Node>& nodes() const noexcept { return nodes_; }
    const std::vector<Edge>& edges() const noexcept { return edges_; }
    const std::vector<FeedbackLoop>& feedback_loops() const noexcept {
        return loops_;
    }
    const std::vector<Lever>& levers() const noexcept { return levers_; }
    const std::vector<Hysteresis>& hysteresis_list() const noexcept {
        return hysts_;
    }

    /**
     * Atomically apply a bounded set of trust deltas.
     *
     * All indices, duplicate constraints, policy bounds, current trust values,
     * and post-addition values are checked before the first mutation.  This is
     * the only neural-authority write path in V1; state, reported state,
     * deadlines, hysteresis, and outage latches are not writable here.
     */
    [[nodiscard]] bool apply_bounded_trust_adjustments(
        const std::vector<BoundedTrustAdjustment>& adjustments,
        int64_t maximum_abs_delta_fp) noexcept {
        static constexpr int64_t kAbsoluteV1Limit = 50'000LL;
        if (maximum_abs_delta_fp < 0 ||
            maximum_abs_delta_fp > kAbsoluteV1Limit ||
            adjustments.size() > nodes_.size() ||
            adjustments.size() > 64u) {
            return false;
        }
        for (size_t i = 0; i < adjustments.size(); ++i) {
            const auto& adjustment = adjustments[i];
            if (adjustment.node_index >= nodes_.size() ||
                adjustment.delta_fp < -maximum_abs_delta_fp ||
                adjustment.delta_fp > maximum_abs_delta_fp) {
                return false;
            }
            for (size_t prior = 0; prior < i; ++prior) {
                if (adjustments[prior].node_index == adjustment.node_index) {
                    return false;
                }
            }
            const int64_t current = nodes_[adjustment.node_index].trust_fp;
            if (current < 0 || current > FP_ONE ||
                (adjustment.delta_fp > 0 &&
                 current > FP_ONE - adjustment.delta_fp) ||
                (adjustment.delta_fp < 0 &&
                 current < -adjustment.delta_fp)) {
                return false;
            }
        }
        for (const auto& adjustment : adjustments) {
            Node& node = nodes_[adjustment.node_index];
            node.trust_fp = fp_add_saturating(node.trust_fp, adjustment.delta_fp);
        }
        return true;
    }

    double friction_multiplier() const noexcept {
        return fp_to_d(fp_clamp(friction_fp_, FRICTION_MIN_FP, FRICTION_MAX_FP));
    }

    // ── Checkpoint state export / restore (host persistence layers) ─────────

    /** Complete copy of graph + runtime state, including the PRNG seed. */
    [[nodiscard]] EngineStateV1 export_state() const {
        EngineStateV1 state;
        state.nodes                 = nodes_;
        state.edges                 = edges_;
        state.loops                 = loops_;
        state.levers                = levers_;
        state.hysteresis            = hysts_;
        state.tick                  = tick_;
        state.friction_fp           = friction_fp_;
        state.permanent_friction_fp = permanent_friction_fp_;
        state.regime_exceeded       = regime_exceeded_;
        state.outage                = outage_;
        state.prng_seed             = prng_seed_;
        state.last_intel_risk_fp    = last_intel_risk_fp_;
        state.has_intel_risk        = has_intel_risk_;
        return state;
    }

    /**
     * restore_state — validated wholesale state replacement.
     *
     * Rejects (returns false, engine unchanged) when the state violates the
     * structural invariants the tick path relies on:
     *   • collection sizes above EngineStateV1 hard caps
     *   • empty node / lever / loop / hysteresis identifiers
     *   • duplicate node identifiers
     *   • trust outside [0, FP_ONE]
     *   • negative capacity, or state/reported outside [0, capacity]
     *   • negative lever lockout counters
     *
     * Deliberately does NOT verify scenario provenance — the host checkpoint
     * layer must bind the restored topology to a signed scenario before
     * calling this.
     */
    [[nodiscard]] bool restore_state(const EngineStateV1& state) {
        if (state.nodes.size()      > EngineStateV1::kMaxNodes  ||
            state.edges.size()      > EngineStateV1::kMaxEdges  ||
            state.loops.size()      > EngineStateV1::kMaxLoops  ||
            state.levers.size()     > EngineStateV1::kMaxLevers ||
            state.hysteresis.size() > EngineStateV1::kMaxHysteresis) {
            return false;
        }
        for (size_t i = 0; i < state.nodes.size(); ++i) {
            const Node& n = state.nodes[i];
            if (n.id.empty() || n.capacity_fp < 0LL) return false;
            if (n.state_fp < 0LL || n.state_fp > n.capacity_fp) return false;
            if (n.reported_state_fp < 0LL ||
                n.reported_state_fp > n.capacity_fp) {
                return false;
            }
            if (n.trust_fp < 0LL || n.trust_fp > FP_ONE) return false;
            for (size_t prior = 0; prior < i; ++prior) {
                if (state.nodes[prior].id == n.id) return false;
            }
        }
        for (const Edge& e : state.edges) {
            if (e.from.empty()) return false;
        }
        for (const FeedbackLoop& l : state.loops) {
            if (l.id.empty()) return false;
        }
        for (const Lever& lv : state.levers) {
            if (lv.id.empty() || lv.remaining_lockout < 0) return false;
        }
        for (const Hysteresis& h : state.hysteresis) {
            if (h.id.empty()) return false;
        }
        nodes_                 = state.nodes;
        edges_                 = state.edges;
        loops_                 = state.loops;
        levers_                = state.levers;
        hysts_                 = state.hysteresis;
        tick_                  = state.tick;
        friction_fp_           = state.friction_fp;
        permanent_friction_fp_ = state.permanent_friction_fp;
        regime_exceeded_       = state.regime_exceeded;
        outage_                = state.outage;
        prng_seed_             = state.prng_seed;
        last_intel_risk_fp_    = state.last_intel_risk_fp;
        has_intel_risk_        = state.has_intel_risk;
        return true;
    }

    Node* get_node(const std::string& id) noexcept {
        for (auto& n : nodes_) if (n.id == id) return &n;
        return nullptr;
    }
    const Node* get_node(const std::string& id) const noexcept {
        for (const auto& n : nodes_) if (n.id == id) return &n;
        return nullptr;
    }

    // ── BS senaryo yükleme stub'ları (gelecek genişleme noktaları) ───────────

    /**
     * inject_scenario_bs01 — Gözlemlenebilirlik saldırısı düğümlerini ekler
     * (evrensel boş şablon üzerine). hidden_state_pct: gizli/raporlanmayan
     * durum oranı [0..1]; report_bias: raporlanan durumu şişiren önyargı.
     * Sektör-agnostik: yalnız boş şablon düğüm adlarını kullanır.
     */
    void inject_scenario_bs01(double hidden_state_pct, double report_bias) noexcept {
        // Gözlemlenebilirlik saldırısı: raporlanan != gerçek
        if (Node* gate = get_node("Regulatory_Gate")) {
            // Önyargı etkisi: sürtünme yapay olarak artırılır
            int64_t bias_fp = d_to_fp(report_bias - 1.0);
            gate->state_fp = fp_clamp(fp_add_saturating(gate->state_fp, bias_fp),
                                      0LL, gate->capacity_fp);
            // Raporlanan düşük tutulur (telemetri karartması)
            gate->reported_state_fp = fp_mul(gate->state_fp, d_to_fp(0.29));
            gate->trust_fp = d_to_fp(0.73);  // %27 durum uyumsuzluğu
        }
        // Gizli durum → ek sürtünme (lag=0 anında etki)
        Edge hidden_edge;
        hidden_edge.from         = "Transit_Node"; // proxy düğüm
        hidden_edge.to           = "";              // aggregation
        hidden_edge.multiplier_fp= d_to_fp(hidden_state_pct * 0.30);
        hidden_edge.lag_ticks    = 0;
        hidden_edge.active       = true;
        add_edge(hidden_edge);
        CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Info,
                                ::caelus::logging::CausalLogCode::ScenarioBs01Injected,
                                tick_,
                                "scenario bs01 injected");
    }

    /**
     * inject_scenario_bs03 — Pekiştiren geri besleme döngüsü + geri alınamaz
     * histerezis eşiği ekler (evrensel boş şablon üzerine). Sektör-agnostik.
     */
    void inject_scenario_bs03(int32_t hysteresis_tick, double permanent_loss) noexcept {
        FeedbackLoop loop;
        loop.id      = "FL-1_REINFORCING";
        loop.path    = {"Regulatory_Gate", "Transit_Node", "Actor_Alpha"};
        loop.gain_fp = d_to_fp(1.30); // pekiştiren döngü
        add_loop(loop);

        Hysteresis h;
        h.id                = "HYST_PERMANENT";
        h.threshold_tick    = hysteresis_tick;
        h.reversible        = false;
        h.permanent_loss_fp = d_to_fp(permanent_loss);
        add_hysteresis(h);
        CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Info,
                                ::caelus::logging::CausalLogCode::ScenarioBs03Injected,
                                tick_,
                                "scenario bs03 injected");
    }

private:
    // ── Graf verisi ──────────────────────────────────────────────────────────
    std::vector<Node>         nodes_;
    std::vector<Edge>         edges_;
    std::vector<FeedbackLoop> loops_;
    std::vector<Lever>        levers_;
    std::vector<Hysteresis>   hysts_;

    // ── Çalışma zamanı durumu ────────────────────────────────────────────────
    uint64_t tick_                  = 0;
    int64_t  friction_fp_           = FP_ONE;
    int64_t  permanent_friction_fp_ = 0LL;   ///< Histerezis kaynaklı kalıcı artış
    bool     regime_exceeded_       = false;
    bool     outage_                = false;  ///< Throughput = 0 sentinel
    uint64_t prng_seed_             = 0;
    int64_t  last_intel_risk_fp_    = 0LL;
    bool     has_intel_risk_        = false;

    // ── Özel hesaplama fonksiyonları ─────────────────────────────────────────

    /**
     * aggregate_friction — tüm düğüm katkılarını toplar.
     *
     * total = 1.0 (taban)
     *       + Σ( trust_i × reported_state_i/capacity_i × weight_i )   [düğümler]
     *       + Σ( edge.multiplier × from.utilization )                  [kenar yükleri]
     *
     * Gözlemlenebilirlik: trust_fp < FP_ONE → raporlanan durum ağırlığı azalır.
     */
    [[nodiscard]] int64_t aggregate_friction() const noexcept {
        int64_t total = FP_ONE;  // taban 1.0x

        // Düğüm ağırlık katkıları
        for (const auto& node : nodes_) {
            if (node.weight_fp == 0LL || node.capacity_fp == 0LL) continue;
            int64_t utilization  = fp_div(node.reported_state_fp, node.capacity_fp);
            int64_t trusted_util = fp_mul(node.trust_fp, utilization);
            total = fp_add_saturating(total, fp_mul(trusted_util, node.weight_fp));
        }

        // Kenar çarpan katkıları (durum yayılımı dışındaki agregasyon kenarları)
        for (const auto& edge : edges_) {
            if (!edge.active || !edge.to.empty()) continue; // yalnız to="" olanlar
            if (edge.lag_ticks > 0 && tick_ < (uint64_t)edge.lag_ticks) continue;
            const Node* from = get_node(edge.from);
            if (!from || from->capacity_fp == 0LL) continue;
            int64_t util = fp_div(from->reported_state_fp, from->capacity_fp);
            total = fp_add_saturating(
                total, fp_mul(fp_mul(from->trust_fp, util), edge.multiplier_fp));
        }

        // Geri besleme döngüsü güçlendirmesi
        for (const auto& loop : loops_) {
            if (loop.path.empty() || loop.gain_fp <= FP_ONE) continue;
            // Döngü gücü = yoldaki en zayıf sinyal
            int64_t signal = FP_ONE;
            for (const auto& nid : loop.path) {
                const Node* n = get_node(nid);
                if (!n || n->capacity_fp == 0LL) continue;
                int64_t u = fp_div(n->state_fp, n->capacity_fp);
                signal = std::min(signal, u);
            }
            // Ek katkı = (gain - 1.0) × döngü_sinyali × taban
            total = fp_add_saturating(total, fp_mul(loop.gain_fp - FP_ONE, signal));
        }

        return total;
    }

    /**
     * propagate_edges — kenar=bağlantılı düğümler arası durum yayılımı.
     *
     * to ≠ "" olan kenarlar için (agregasyon kenarları değil):
     *   delta = (from.state/from.cap) × edge.multiplier × DAMP_FP
     *   to.state += delta
     *
     * Damped yayılım (DAMP=0.05/tick): ani sarsıntıları engeller.
     */
    void propagate_edges() noexcept {
        static constexpr int64_t DAMP_FP = 50'000LL;  // 0.05 per tick

        // Delta'ları önce toparla, sonra atomik uygula (okuma/yazma ayrımı)
        struct Delta { size_t idx; int64_t val; };
        std::vector<Delta> deltas;
        deltas.reserve(edges_.size());

        for (const auto& edge : edges_) {
            if (!edge.active || edge.to.empty()) continue;
            if (edge.lag_ticks > 0 && tick_ < (uint64_t)edge.lag_ticks) continue;

            const Node* from = get_node(edge.from);
            if (!from || from->capacity_fp == 0LL) continue;

            size_t to_idx = SIZE_MAX;
            for (size_t i = 0; i < nodes_.size(); ++i)
                if (nodes_[i].id == edge.to) { to_idx = i; break; }
            if (to_idx == SIZE_MAX) continue;

            int64_t utilization = fp_div(from->state_fp, from->capacity_fp);
            int64_t trusted_u   = fp_mul(from->trust_fp, utilization);
            int64_t delta       = fp_mul(fp_mul(trusted_u, edge.multiplier_fp), DAMP_FP);
            deltas.push_back({to_idx, delta});
        }

        for (auto& d : deltas) {
            Node& n = nodes_[d.idx];
            n.state_fp          = fp_clamp(fp_add_saturating(n.state_fp, d.val),
                                           0LL, n.capacity_fp);
            n.reported_state_fp = n.state_fp;  // gizleme yoksa raporlanan = gerçek
        }
    }

    /**
     * apply_feedback_loops — pekiştiren döngülerin kazanım etkisi.
     *
     * Her döngüdeki en zayıf düğümün durumu (gain - 1.0) oranında artırılır.
     * Döngünün ilk düğümüne geri beslenir → sonraki aggregate_friction()'ı yükseltir.
     */
    void apply_feedback_loops() noexcept {
        static constexpr int64_t LOOP_DAMP_FP = 10'000LL;  // 0.01 per tick

        for (const auto& loop : loops_) {
            if (loop.path.empty() || loop.gain_fp <= FP_ONE) continue;

            // Yol boyunca minimum sinyal
            int64_t min_signal = FP_ONE;
            for (const auto& nid : loop.path) {
                const Node* n = get_node(nid);
                if (!n || n->capacity_fp == 0LL) continue;
                min_signal = std::min(min_signal, fp_div(n->state_fp, n->capacity_fp));
            }

            // Döngünün ilk düğümüne geri besle (damped)
            Node* first = get_node(loop.path.front());
            if (first) {
                int64_t amplification = fp_mul(
                    fp_mul(loop.gain_fp - FP_ONE, min_signal), LOOP_DAMP_FP);
                first->state_fp = fp_clamp(
                    fp_add_saturating(first->state_fp, amplification),
                    0LL, first->capacity_fp);
                first->reported_state_fp = first->state_fp;
            }
        }
    }

    /**
     * update_trust — raporlanan ile gerçek durum arasındaki fark.
     *
     * |reported - true| / capacity > sapma_esigi → trust azalır.
     * Plan-gerçekleşme sapması > %18 → gözlemlenebilirlik uyarısı.
     */
    void update_trust() noexcept {
        static constexpr int64_t DEVIATION_THRESHOLD_FP = 180'000LL;  // 0.18

        for (auto& node : nodes_) {
            if (node.capacity_fp == 0LL) continue;
            const int64_t diff = fp_add_saturating(node.reported_state_fp, -node.state_fp);
            const uint64_t diff_mag = detail::fp_abs_u64(diff);
            const int64_t abs_diff = diff_mag > static_cast<uint64_t>(detail::FP_I64_MAX)
                ? detail::FP_I64_MAX
                : static_cast<int64_t>(diff_mag);
            int64_t deviation = fp_div(abs_diff, node.capacity_fp);

            if (deviation > DEVIATION_THRESHOLD_FP) {
                // Güven katsayısını azalt (minimum %10)
                node.trust_fp = fp_clamp(
                    node.trust_fp - 10'000LL,  // -0.01 per tick
                    100'000LL,                  // min trust = 0.10
                    FP_ONE);
                if (node.trust_fp < 800'000LL) {  // < 0.80 → uyar
                    CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Warn,
                                            ::caelus::logging::CausalLogCode::ObservabilityTrustLow,
                                            tick_,
                                            "observability trust below threshold");
                }
            }
        }
    }

    /** decrement timed lever lockouts once per engine tick. */
    void decay_lever_lockouts() noexcept {
        for (auto& lever : levers_) {
            if (lever.remaining_lockout > 0) --lever.remaining_lockout;
        }
    }

    /**
     * check_regime — raw sürtünme 3.0x'i aşarsa REGIME_EXCEEDED ateşlenir.
     *
     * Kenet ÖNCESİNDE kontrol edilir: motor sessizce doymak yerine sistemi uyarır.
     * İlk aşımda uyarı basılır; sonraki tick'lerde yalnızca bayrak korunur.
     */
    void check_regime(int64_t raw_fp) noexcept {
        if (raw_fp > FRICTION_MAX_FP) {
            if (!regime_exceeded_) {
                regime_exceeded_ = true;
                CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Critical,
                                        ::caelus::logging::CausalLogCode::RegimeExceeded,
                                        tick_,
                                        "regime exceeded");
            }
        }
    }

    /**
     * check_hysteresis — geri alınamaz eşik kontrolü.
     *
     * threshold_tick'e ulaşılırsa:
     *   reversible=false → permanent_friction_fp_ kalıcı olarak artar,
     *                       outage_ latched true olur (akış tıkanması).
     */
    void check_hysteresis() noexcept {
        for (auto& h : hysts_) {
            const uint64_t threshold =
                h.threshold_tick <= 0 ? 0ULL : static_cast<uint64_t>(h.threshold_tick);
            if (h.flipped || tick_ < threshold) continue;
            h.flipped = true;
            if (!h.reversible) {
                permanent_friction_fp_ = fp_add_saturating(
                    permanent_friction_fp_, h.permanent_loss_fp);
                latch_outage();
                CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Warn,
                                        ::caelus::logging::CausalLogCode::HysteresisFlipPermanent,
                                        tick_,
                                        "hysteresis flipped permanent");
            } else {
                CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Info,
                                        ::caelus::logging::CausalLogCode::HysteresisFlipReversible,
                                        tick_,
                                        "hysteresis flipped reversible");
            }
        }
    }

    /**
     * check_deadlines — deadline_tick'e ulaşılan düğümleri işaretle.
     */
    void check_deadlines() noexcept {
        for (auto& node : nodes_) {
            if (node.deadline_tick < 0 || node.deadline_missed) continue;
            if (tick_ >= static_cast<uint64_t>(node.deadline_tick)) {
                node.deadline_missed = true;
                CAELUS_CAUSAL_LOG_EVENT(::caelus::logging::LogLevel::Error,
                                        ::caelus::logging::CausalLogCode::DeadlineMissed,
                                        tick_,
                                        "deadline missed");
                if (node.kind == NodeKind::Perishable) {
                    // Perishable deadline → latched outage until explicit recovery.
                    node.irrecoverable = true;
                    latch_outage();
                }
            }
        }
    }

    /** Outage state machine: kritik olaylar yalnızca latch eder. */
    void latch_outage() noexcept {
        outage_ = true;
    }

    /** Başarılı recovery lever'ı outage latch'ini ve irrecoverable bayraklarını temizler. */
    void clear_outage_recovery() noexcept {
        outage_ = false;
        for (auto& node : nodes_) {
            node.irrecoverable = false;
        }
    }

    /** Mevcut durumdan EngineSnapshot üret. */
    EngineSnapshot build_snapshot() const noexcept {
        EngineSnapshot s;
        s.tick               = tick_ - 1;
        s.raw_friction_fp    = friction_fp_;
        s.clamped_friction_fp= fp_clamp(friction_fp_, FRICTION_MIN_FP, FRICTION_MAX_FP);
        s.regime_exceeded    = regime_exceeded_;
        s.any_hysteresis_flip= std::any_of(hysts_.begin(), hysts_.end(),
                                            [](const Hysteresis& h){ return h.flipped; });
        s.any_deadline_missed= std::any_of(nodes_.begin(), nodes_.end(),
                                            [](const Node& n){ return n.deadline_missed; });
        s.outage_active      = outage_;
        if (outage_) {
            s.throughput_ratio_fp = 0LL;
            s.throughput_ratio = 0.0;
            std::snprintf(s.summary, sizeof(s.summary),
                          "OUTAGE: throughput=0, tick=%llu", (unsigned long long)tick_);
        } else {
            s.throughput_ratio_fp = fp_div(FP_ONE, s.clamped_friction_fp);
            s.throughput_ratio = fp_to_d(s.throughput_ratio_fp);
            std::snprintf(s.summary, sizeof(s.summary),
                          "mu=%.3fx%s",
                          fp_to_d(s.clamped_friction_fp),
                          regime_exceeded_ ? " REGIME_EXCEEDED" : "");
        }
        return s;
    }
};

} // namespace caelus::causal
