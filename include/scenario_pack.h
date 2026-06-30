/**
 * CAELUS OS — Scenario Pack Loader  (include/scenario_pack.h)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * R2 — GELISTIRME_RAPORU.md: Senaryo Paketi Formatı + Yükleyici
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Her senaryo paketi, `scenarios/<ID>.json` dosyasında bulunur.
 * Paket iki katmandan oluşur:
 *
 *  1. extended_causal_model  →  CausalEngine v2 grafı
 *     (Düğümler, kenarlar, geri besleme döngüleri, kaldıraçlar, histerezis)
 *
 *  2. v1_engine_bridge       →  Geriye dönük uyum
 *     (OperationalRiskProfile + zamanlı intel dizisi)
 *
 * Güvenlik:  `signature` alanı ed25519:<pubkey-hex>:<signature-hex>
 *            formatında zorunludur. SELF_SIGNED_DEV varsayılan olarak reddedilir;
 *            yalnız CAELUS_ALLOW_DEV_SCENARIOS=1 ile geliştirme amaçlı kabul edilir.
 *
 * JSON ayrıştırıcı:  Sıfır dış bağımlılık, yalnızca projemiz şemasını
 *   işler. RFC 8259 uyumlu unicode escaping, sayı sınır kontrolü ve
 *   recursion-depth limiti içerir.
 *
 * Kullanım:
 *   caelus::ScenarioPack pack;
 *   if (pack.load("scenarios/BS-01_SAHTE_UFUK.json")) {
 *       pack.apply_to_engine(causal_engine);
 *       *profile = pack.risk_profile;   // v1 uyum
 *   }
 * ═══════════════════════════════════════════════════════════════════════════
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdlib>
#include <cerrno>
#include <cmath>
#include <limits>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <iostream>
#include <utility>
#include <algorithm>
#include <charconv>
#include <iomanip>

#include "causal_engine.h"
#include "src/intel_core.h"

extern "C" {
    uint8_t caelus_verify_scenario_signature(
        const uint8_t* msg, size_t msg_len,
        const uint8_t* pubkey32, const uint8_t* sig64);
}

namespace caelus {

// ─────────────────────────────────────────────────────────────────────────────
// Minimal JSON değer tipi ve ayrıştırıcı
// ─────────────────────────────────────────────────────────────────────────────

struct JsonVal {
    enum Type : uint8_t { Null=0, Bool, Int, Float, Str, Arr, Obj } type = Null;
    bool        b  = false;
    int64_t     i  = 0;
    double      f  = 0.0;
    std::string s;
    std::vector<JsonVal>                         a;  // dizi elemanları
    std::vector<std::pair<std::string,JsonVal>>  o;  // nesne alanları (sıralı)

    // ── Fabrika yardımcıları ────────────────────────────────────────────────
    static JsonVal null_v()             { return {}; }
    static JsonVal bool_v(bool v)       { JsonVal x; x.type=Bool;  x.b=v; return x; }
    static JsonVal int_v(int64_t v)     { JsonVal x; x.type=Int;   x.i=v; return x; }
    static JsonVal float_v(double v)    { JsonVal x; x.type=Float; x.f=v; return x; }
    static JsonVal str_v(std::string v) { JsonVal x; x.type=Str;   x.s=std::move(v); return x; }

    // ── Nesne erişimi (doğrusal arama, N<50 için yeterli) ─────────────────
    const JsonVal* find(const char* key) const {
        for (const auto& kv : o)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }
    bool has(const char* key) const { return find(key) != nullptr; }

    // ── Tip dönüştürücüler ──────────────────────────────────────────────────
    int64_t as_i(int64_t def=0) const {
        if (type == Int)   return i;
        if (type == Float) return static_cast<int64_t>(f);
        if (type == Bool)  return b ? 1 : 0;
        return def;
    }
    double as_f(double def=0.0) const {
        if (type == Float) return f;
        if (type == Int)   return static_cast<double>(i);
        return def;
    }
    const std::string& as_s() const { static const std::string empty; return type==Str ? s : empty; }
    bool as_b(bool def=false) const {
        if (type == Bool) return b;
        if (type == Int)  return i != 0;
        return def;
    }
    size_t size() const {
        if (type == Arr) return a.size();
        if (type == Obj) return o.size();
        return 0;
    }
    const JsonVal& operator[](size_t idx) const {
        static const JsonVal null_inst;
        return (type==Arr && idx<a.size()) ? a[idx] : null_inst;
    }
    const JsonVal& operator[](const char* key) const {
        static const JsonVal null_inst;
        const JsonVal* v = find(key);
        return v ? *v : null_inst;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Minimal JSON ayrıştırıcı (recursive-descent)
// ─────────────────────────────────────────────────────────────────────────────

class JsonParser {
    const char* p;
    const char* end;
    bool ok_ = true;
    static constexpr size_t MAX_RECURSION_DEPTH = 64;

    void skip_ws() noexcept {
        while (p < end && (*p==' '||*p=='\n'||*p=='\r'||*p=='\t')) ++p;
    }

    void fail() noexcept {
        ok_ = false;
    }

    static bool is_digit(char c) noexcept {
        return c >= '0' && c <= '9';
    }

    static int hex_value(char c) noexcept {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
        if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
        return -1;
    }

    bool read_hex4(uint32_t& out) noexcept {
        if ((size_t)(end - p) < 4) {
            fail();
            return false;
        }
        uint32_t cp = 0;
        for (int i = 0; i < 4; ++i) {
            int hv = hex_value(*p++);
            if (hv < 0) {
                fail();
                return false;
            }
            cp = (cp << 4) | static_cast<uint32_t>(hv);
        }
        out = cp;
        return true;
    }

    bool read_unicode_escape(uint32_t& cp) noexcept {
        uint32_t first = 0;
        if (!read_hex4(first)) return false;

        if (first >= 0xD800 && first <= 0xDBFF) {
            if ((size_t)(end - p) < 6 || p[0] != '\\' || p[1] != 'u') {
                fail();
                return false;
            }
            p += 2;
            uint32_t second = 0;
            if (!read_hex4(second)) return false;
            if (second < 0xDC00 || second > 0xDFFF) {
                fail();
                return false;
            }
            cp = 0x10000u + (((first - 0xD800u) << 10) | (second - 0xDC00u));
            return true;
        }

        if (first >= 0xDC00 && first <= 0xDFFF) {
            fail();
            return false;
        }

        cp = first;
        return true;
    }

    static void append_utf8(std::string& s, uint32_t cp) {
        if (cp <= 0x7Fu) {
            s += static_cast<char>(cp);
        } else if (cp <= 0x7FFu) {
            s += static_cast<char>(0xC0u | (cp >> 6));
            s += static_cast<char>(0x80u | (cp & 0x3Fu));
        } else if (cp <= 0xFFFFu) {
            s += static_cast<char>(0xE0u | (cp >> 12));
            s += static_cast<char>(0x80u | ((cp >> 6) & 0x3Fu));
            s += static_cast<char>(0x80u | (cp & 0x3Fu));
        } else {
            s += static_cast<char>(0xF0u | (cp >> 18));
            s += static_cast<char>(0x80u | ((cp >> 12) & 0x3Fu));
            s += static_cast<char>(0x80u | ((cp >> 6) & 0x3Fu));
            s += static_cast<char>(0x80u | (cp & 0x3Fu));
        }
    }

    JsonVal parse_string() {
        if (p >= end || *p != '"') {
            fail();
            return {};
        }
        ++p; // '"' atla
        std::string s;
        s.reserve(64);
        while (p < end) {
            unsigned char ch = static_cast<unsigned char>(*p++);
            if (ch == '"') {
                return JsonVal::str_v(std::move(s));
            }
            if (ch == '\\') {
                if (p >= end) {
                    fail();
                    return {};
                }
                char esc = *p++;
                switch (esc) {
                    case '"':  s+='"';  break;
                    case '\\': s+='\\'; break;
                    case '/':  s+='/';  break;
                    case 'b':  s+='\b'; break;
                    case 'f':  s+='\f'; break;
                    case 'n':  s+='\n'; break;
                    case 'r':  s+='\r'; break;
                    case 't':  s+='\t'; break;
                    case 'u': {
                        uint32_t cp = 0;
                        if (!read_unicode_escape(cp)) return {};
                        append_utf8(s, cp);
                        break;
                    }
                    default:
                        fail();
                        return {};
                }
            } else {
                if (ch < 0x20u) {
                    fail();
                    return {};
                }
                s += static_cast<char>(ch);
            }
        }
        fail();
        return {};
    }

    JsonVal parse_number() {
        const char* start = p;
        bool negative = false;
        if (p < end && *p == '-') {
            negative = true;
            ++p;
        }
        if (p >= end) {
            fail();
            return {};
        }
        if (*p == '0') {
            ++p;
            if (p < end && is_digit(*p)) {
                fail();
                return {};
            }
        } else if (*p >= '1' && *p <= '9') {
            while (p < end && is_digit(*p)) ++p;
        } else {
            fail();
            return {};
        }
        bool is_float = false;
        if (p < end && *p == '.') {
            is_float = true;
            ++p;
            if (p >= end || !is_digit(*p)) {
                fail();
                return {};
            }
            while (p < end && is_digit(*p)) ++p;
        }
        if (p < end && (*p=='e'||*p=='E')) {
            is_float = true;
            ++p;
            if (p<end && (*p=='+'||*p=='-')) ++p;
            if (p >= end || !is_digit(*p)) {
                fail();
                return {};
            }
            while (p < end && is_digit(*p)) ++p;
        }
        std::string num(start, p);
        if (is_float) {
            errno = 0;
            char* parsed_end = nullptr;
            double v = std::strtod(num.c_str(), &parsed_end);
            if (errno == ERANGE || parsed_end != num.c_str() + num.size() || !std::isfinite(v)) {
                fail();
                return {};
            }
            return JsonVal::float_v(v);
        }

        int64_t parsed = 0;
        const auto conv = std::from_chars(start, p, parsed, 10);
        if (conv.ec != std::errc{} || conv.ptr != p) {
            fail();
            return {};
        }
        return JsonVal::int_v(parsed);
    }

    JsonVal parse_object(size_t depth) {
        ++p; // '{' atla
        JsonVal v; v.type = JsonVal::Obj;
        skip_ws();
        if (p < end && *p == '}') {
            ++p;
            return v;
        }
        while (ok_) {
            if (p >= end || *p != '"') {
                fail();
                return {};
            }
            auto key = parse_string().s;
            if (!ok_) return {};
            for (const auto& existing : v.o) {
                if (existing.first == key) {
                    fail();
                    return {};
                }
            }
            skip_ws();
            if (p >= end || *p != ':') {
                fail();
                return {};
            }
            ++p;
            skip_ws();
            v.o.emplace_back(std::move(key), parse_value(depth + 1));
            if (!ok_) return {};
            skip_ws();
            if (p >= end) {
                fail();
                return {};
            }
            if (*p == '}') {
                ++p;
                return v;
            }
            if (*p != ',') {
                fail();
                return {};
            }
            ++p;
            skip_ws();
            if (p < end && *p == '}') {
                fail();
                return {};
            }
        }
        return {};
    }

    JsonVal parse_array(size_t depth) {
        ++p; // '[' atla
        JsonVal v; v.type = JsonVal::Arr;
        skip_ws();
        if (p < end && *p == ']') {
            ++p;
            return v;
        }
        while (ok_) {
            if (p >= end) {
                fail();
                return {};
            }
            v.a.push_back(parse_value(depth + 1));
            if (!ok_) return {};
            skip_ws();
            if (p >= end) {
                fail();
                return {};
            }
            if (*p == ']') {
                ++p;
                return v;
            }
            if (*p != ',') {
                fail();
                return {};
            }
            ++p;
            skip_ws();
            if (p < end && *p == ']') {
                fail();
                return {};
            }
        }
        return {};
    }

    JsonVal try_literal(const char* lit, size_t len, JsonVal val) {
        if ((size_t)(end - p) >= len && std::strncmp(p, lit, len) == 0) {
            p += len; return val;
        }
        fail();
        return JsonVal::null_v();
    }

public:
    explicit JsonParser(const char* data, size_t n) : p(data), end(data+n) {}

    JsonVal parse_value(size_t depth = 0) {
        if (depth > MAX_RECURSION_DEPTH) {
            fail();
            return {};
        }
        skip_ws();
        if (p >= end) {
            fail();
            return {};
        }
        char c = *p;
        if (c == '"') return parse_string();
        if (c == '{') return parse_object(depth);
        if (c == '[') return parse_array(depth);
        if (c == 't') return try_literal("true",  4, JsonVal::bool_v(true));
        if (c == 'f') return try_literal("false", 5, JsonVal::bool_v(false));
        if (c == 'n') return try_literal("null",  4, {});
        if (c == '-' || (c>='0'&&c<='9')) return parse_number();
        fail();
        return {};
    }

    bool parse(JsonVal& out) {
        out = parse_value();
        if (!ok_) return false;
        skip_ws();
        if (p != end) {
            fail();
            return false;
        }
        return true;
    }

    bool ok() const noexcept {
        return ok_;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Senaryo Paketi yükleyici
// ─────────────────────────────────────────────────────────────────────────────

class ScenarioPack {
public:
    // ── Manifest alanları ────────────────────────────────────────────────────
    std::string schema_version;
    std::string id;
    std::string blackswan_class;
    std::string sector;
    std::string min_caelus_engine;
    std::string signature;
    // Gerçek doğrulama sonucu (load() sırasında verify_signature_gate doldurur).
    // Asla sabit "VERIFIED" değildir — imza yolunu olduğu gibi yansıtır:
    //   VERIFIED          → ed25519 geçti VE pinli güven çapasıyla eşleşti
    //   DEV_TRUST_BYPASS  → ed25519 geçti ama pin kontrolü dev bypass ile atlandı
    //   SELF_SIGNED_DEV   → SELF_SIGNED_DEV imza dev flag ile kabul edildi
    std::string sig_status;
    std::string sig_scheme;
    std::string title;
    std::string region;
    int         tick_minutes   = 15;
    int         horizon_hours  = 240;

    // ── Yüklenen graf ───────────────────────────────────────────────────────
    std::vector<caelus::causal::Node>         nodes;
    std::vector<caelus::causal::Edge>         edges;
    std::vector<caelus::causal::FeedbackLoop> loops;
    std::vector<caelus::causal::Lever>        levers;
    std::vector<caelus::causal::Hysteresis>   hysteresis;

    // ── v1 uyum köprüsü ─────────────────────────────────────────────────────
    caelus::intel::OperationalRiskProfile risk_profile;

    struct IntelEvent {
        uint64_t    t_hour        = 0;
        double      friction_coeff= 0.0;
        int         crisis_level  = 0;
        std::string memo;
    };
    std::vector<IntelEvent> intel_sequence;

    bool loaded = false;

    // ── Yükleme ─────────────────────────────────────────────────────────────

    bool load(const std::string& path) {
        loaded = false;
        schema_version.clear();
        id.clear();
        blackswan_class.clear();
        sector.clear();
        min_caelus_engine.clear();
        signature.clear();
        sig_status.clear();
        sig_scheme.clear();
        title.clear();
        region.clear();
        tick_minutes = 15;
        horizon_hours = 240;
        nodes.clear();
        edges.clear();
        loops.clear();
        levers.clear();
        hysteresis.clear();
        risk_profile = caelus::intel::OperationalRiskProfile{};
        intel_sequence.clear();

        // Dosya oku
        std::ifstream f(path, std::ios::binary);
        if (!f) {
            std::cout << "[SCENARIO] Paket bulunamadı: " << path << "\n";
            return false;
        }
        std::ostringstream buf;
        buf << f.rdbuf();
        std::string content = buf.str();

        // Ayrıştır
        JsonParser parser(content.data(), content.size());
        JsonVal root;
        if (!parser.parse(root) || root.type != JsonVal::Obj) {
            std::cerr << "[SCENARIO] JSON ayrıştırma hatası: " << path << "\n";
            return false;
        }

        // ── Manifest ────────────────────────────────────────────────────────
        schema_version    = root["schema_version"].as_s();
        id                = root["id"].as_s();
        blackswan_class   = root["blackswan_class"].as_s();
        sector            = root["sector"].as_s();
        min_caelus_engine = root["min_caelus_engine"].as_s();
        signature         = root["signature"].as_s();

        if (!verify_signature_gate(root, signature, sig_status, sig_scheme)) {
            std::cerr << "[SCENARIO] Paket imzası reddedildi: " << path << "\n";
            return false;
        }

        if (root.has("meta")) {
            const auto& meta = root["meta"];
            title         = meta["title"].as_s();
            region        = meta["region"].as_s();
            tick_minutes  = (int)meta["tick_minutes"].as_i(15);
            horizon_hours = (int)meta["horizon_hours"].as_i(240);
        }

        // ── Causal Model ────────────────────────────────────────────────────
        if (root.has("extended_causal_model")) {
            const auto& cm = root["extended_causal_model"];

            // Düğümler
            if (cm.has("nodes")) {
                for (size_t ni = 0; ni < cm["nodes"].size(); ++ni)
                    nodes.push_back(parse_node(cm["nodes"][ni]));
            }

            // Kenarlar
            if (cm.has("edges")) {
                for (size_t ei = 0; ei < cm["edges"].size(); ++ei)
                    edges.push_back(parse_edge(cm["edges"][ei]));
            }

            // Geri besleme döngüleri
            if (cm.has("feedback_loops")) {
                for (size_t li = 0; li < cm["feedback_loops"].size(); ++li)
                    loops.push_back(parse_loop(cm["feedback_loops"][li]));
            }

            // İkna kaldıraçları
            if (cm.has("levers")) {
                for (size_t lv = 0; lv < cm["levers"].size(); ++lv)
                    levers.push_back(parse_lever(cm["levers"][lv]));
            }

            // Histerezis
            if (cm.has("hysteresis")) {
                for (size_t hi = 0; hi < cm["hysteresis"].size(); ++hi)
                    hysteresis.push_back(parse_hysteresis(cm["hysteresis"][hi]));
            }

            // Deadline'lar: deadline_tick düğüm alanına ayarla
            if (cm.has("hard_deadlines")) {
                for (size_t di = 0; di < cm["hard_deadlines"].size(); ++di) {
                    const auto& d = cm["hard_deadlines"][di];
                    auto nid = d["node_id"].as_s();
                    auto at  = (int32_t)d["at_tick"].as_i(-1);
                    for (auto& node : nodes)
                        if (node.id == nid) { node.deadline_tick = at; break; }
                }
            }
        }

        // ── v1 Uyum Köprüsü ─────────────────────────────────────────────────
        if (root.has("v1_engine_bridge")) {
            const auto& bridge = root["v1_engine_bridge"];
            if (bridge.has("operational_risk_profile")) {
                const auto& orp = bridge["operational_risk_profile"];
                risk_profile.scenario_id              = orp["scenario_id"].as_s();
                risk_profile.region                   = orp["region"].as_s();
                risk_profile.bureaucratic_complexity  = orp["bureaucratic_complexity"].as_f(0.5);
                risk_profile.historical_delay_rate    = orp["historical_delay_rate"].as_f(0.5);
                risk_profile.labor_action_probability = orp["labor_action_probability"].as_f(0.5);
                risk_profile.route_congestion         = orp["route_congestion"].as_f(0.5);
                risk_profile.weather_severity         = orp["weather_severity"].as_f(0.5);
            }
            if (bridge.has("intel_feed_sequence")) {
                const auto& seq = bridge["intel_feed_sequence"];
                for (size_t si = 0; si < seq.size(); ++si) {
                    IntelEvent ev;
                    ev.t_hour          = (uint64_t)seq[si]["t_hour"].as_i(0);
                    ev.friction_coeff  = seq[si]["friction_coefficient"].as_f(0.0);
                    ev.crisis_level    = (int)seq[si]["crisis_level"].as_i(0);
                    ev.memo            = seq[si]["memo"].as_s();
                    intel_sequence.push_back(std::move(ev));
                }
            }
        }

        std::cout << "[SCENARIO] Yüklendi: " << id
                  << " [" << blackswan_class << "] sektör=" << sector << "\n"
                  << "           Düğüm:" << nodes.size()
                  << " Kenar:" << edges.size()
                  << " Döngü:" << loops.size()
                  << " Kaldıraç:" << levers.size()
                  << " Histerezis:" << hysteresis.size()
                  << " Intel:" << intel_sequence.size() << "\n";

        loaded = true;
        return true;
    }

    // ── Graf uygulama ────────────────────────────────────────────────────────

    void apply_to_engine(caelus::causal::CausalEngine& eng) const {
        if (!loaded) return;
        eng.reset();
        for (const auto& n  : nodes)      eng.add_node(n);
        for (const auto& e  : edges)      eng.add_edge(e);
        for (const auto& l  : loops)      eng.add_loop(l);
        for (const auto& lv : levers)     eng.add_lever(lv);
        for (const auto& h  : hysteresis) eng.add_hysteresis(h);
        if (nodes.empty()) {
            // Uzatılmış model boşsa evrensel boş şablona dön.
            eng.load_universal_blank_slate();
        }
        std::cout << "[SCENARIO] Nedensel motor '" << id << "' ile yapılandırıldı.\n";
    }

    /**
     * Intel olaylarını tick zamanına göre enjekte eder.
     * t_hour=0 → hemen; sonrakiler tick içinde sırayla tetiklenir.
     */
    void inject_intel_at(caelus::causal::CausalEngine& eng, uint64_t current_tick) const {
        // tick → saat dönüşümü: tick_minutes dakika / saat başına
        uint64_t ticks_per_hour = 60 / (uint64_t)(tick_minutes > 0 ? tick_minutes : 1);
        for (const auto& ev : intel_sequence) {
            uint64_t ev_tick = ev.t_hour * ticks_per_hour;
            if (ev_tick == current_tick) {
                eng.inject_intel(ev.friction_coeff, ev.crisis_level, ev.memo.c_str());
            }
        }
    }

    // C++ verifier ile aynı canonical signed payload'u dış araç/CLI için üretir.
    static bool canonical_signed_payload_from_json(
        const std::string& content,
        std::string& out,
        std::string* error = nullptr) {
        JsonParser parser(content.data(), content.size());
        JsonVal root;
        if (!parser.parse(root) || root.type != JsonVal::Obj) {
            if (error) *error = "JSON ayrıştırma hatası veya kök nesne değil";
            return false;
        }
        if (!root.has("extended_causal_model") || !root.has("v1_engine_bridge")) {
            if (error) {
                *error = "imzalı kritik alanlar eksik "
                         "(extended_causal_model + v1_engine_bridge zorunlu)";
            }
            return false;
        }
        out = canonical_signed_payload(root);
        return true;
    }

    static bool canonical_signed_payload_from_file(
        const std::string& path,
        std::string& out,
        std::string* error = nullptr) {
        std::ifstream f(path, std::ios::binary);
        if (!f) {
            if (error) *error = "senaryo dosyası açılamadı: " + path;
            return false;
        }
        std::ostringstream buf;
        buf << f.rdbuf();
        return canonical_signed_payload_from_json(buf.str(), out, error);
    }

#ifdef CAELUS_CPP_UNIT_TEST
    // Test-only erişim kancası: imza gate'inin tüm dallarını (boş imza,
    // SELF_SIGNED_DEV, ed25519 başarısız/tamper, pin reddi, dev bypass)
    // birim testten doğrulanabilir kılar. Üretim derlemesine girmez.
    static bool test_verify_signature_gate(const JsonVal& root, const std::string& sig,
                                           std::string& out_status, std::string& out_scheme) {
        return verify_signature_gate(root, sig, out_status, out_scheme);
    }
#endif

private:
    // ─────────────────────────────────────────────────────────────────────────
    // CAELUS_TRUSTED_PUBKEY — Pinlenmiş üretim imzalama pubkey'i (32 bayt).
    // Derleme zamanında sabittir; tüm üretim senaryo paketleri yalnızca bu
    // anahtarla imzalanmış olmalıdır.
    //
    // ANAHTAR TÖRENİ: Bu sabiti güncellemek için:
    //   1. Repo DISINDA/offline tutulan signer seed'den CLI ile pubkey türetin:
    //        cargo run --bin caelus_sign_scenario -- --key /secure/offline/seed --export-pubkey \
    //            > tools/caelus_trusted_pubkey.txt
    //   2. Aşağıdaki 32 hex baytı yeni pubkey değerleriyle değiştirin.
    //   3. Tüm üretim senaryolarını yeni anahtar çiftiyle yeniden imzalayın.
    //   4. Public trust anchor + imzalı senaryoları commit edin; private seed'i
    //      ASLA commit etmeyin.
    //   5. Bu başlık dosyasını (include/scenario_pack.h) commit edin;
    //      CI pin doğrulamasını otomatik olarak onaylayacaktır.
    // ─────────────────────────────────────────────────────────────────────────
    static constexpr uint8_t CAELUS_TRUSTED_PUBKEY[32] = {
        0x9b, 0xb1, 0xdb, 0xd0, 0x39, 0x04, 0x36, 0x70,
        0xb7, 0xbf, 0x2c, 0x5d, 0x75, 0x33, 0x77, 0x78,
        0x66, 0x13, 0x5b, 0x92, 0xf9, 0xb3, 0x8f, 0xe6,
        0xcd, 0x8d, 0x97, 0x35, 0xa0, 0x4f, 0xa8, 0x02
    };

    // ── JSON → Struct dönüştürücüler ─────────────────────────────────────────

    static bool env_flag_enabled(const char* name) noexcept {
        const char* v = std::getenv(name);
        return v && (std::strcmp(v, "1") == 0 || std::strcmp(v, "true") == 0 ||
                     std::strcmp(v, "TRUE") == 0 || std::strcmp(v, "yes") == 0 ||
                     std::strcmp(v, "YES") == 0);
    }

    static bool is_hex_string(const std::string& s, size_t expected_len) noexcept {
        if (s.size() != expected_len) return false;
        for (char c : s) {
            bool digit = (c >= '0' && c <= '9');
            bool lower = (c >= 'a' && c <= 'f');
            bool upper = (c >= 'A' && c <= 'F');
            if (!digit && !lower && !upper) return false;
        }
        return true;
    }

    static void append_json_string(std::string& out, const std::string& s) {
        static const char* hex = "0123456789abcdef";
        out.push_back('"');
        for (unsigned char c : s) {
            switch (c) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\b': out += "\\b";  break;
                case '\f': out += "\\f";  break;
                case '\n': out += "\\n";  break;
                case '\r': out += "\\r";  break;
                case '\t': out += "\\t";  break;
                default:
                    if (c < 0x20u) {
                        out += "\\u00";
                        out.push_back(hex[(c >> 4) & 0x0f]);
                        out.push_back(hex[c & 0x0f]);
                    } else {
                        out.push_back(static_cast<char>(c));
                    }
                    break;
            }
        }
        out.push_back('"');
    }

    static std::string canonical_json(const JsonVal& v) {
        std::string out;
        switch (v.type) {
            case JsonVal::Null:
                out = "null";
                break;
            case JsonVal::Bool:
                out = v.b ? "true" : "false";
                break;
            case JsonVal::Int:
                out = std::to_string(v.i);
                break;
            case JsonVal::Float: {
                std::ostringstream ss;
                ss << std::setprecision(17) << v.f;
                out = ss.str();
                break;
            }
            case JsonVal::Str:
                append_json_string(out, v.s);
                break;
            case JsonVal::Arr: {
                out.push_back('[');
                for (size_t i = 0; i < v.a.size(); ++i) {
                    if (i) out.push_back(',');
                    out += canonical_json(v.a[i]);
                }
                out.push_back(']');
                break;
            }
            case JsonVal::Obj: {
                std::vector<std::pair<std::string, const JsonVal*>> members;
                members.reserve(v.o.size());
                for (const auto& kv : v.o) members.push_back({kv.first, &kv.second});
                std::sort(members.begin(), members.end(),
                          [](const auto& a, const auto& b) { return a.first < b.first; });
                out.push_back('{');
                for (size_t i = 0; i < members.size(); ++i) {
                    if (i) out.push_back(',');
                    append_json_string(out, members[i].first);
                    out.push_back(':');
                    out += canonical_json(*members[i].second);
                }
                out.push_back('}');
                break;
            }
        }
        return out;
    }

    static std::string canonical_signed_payload(const JsonVal& root) {
        static const JsonVal null_value;
        const JsonVal* cm = root.find("extended_causal_model");
        const JsonVal* bridge = root.find("v1_engine_bridge");
        std::string payload;
        payload.reserve(256);
        payload += "CAELUS_SCENARIO_PACK_V1\n";
        payload += "extended_causal_model=";
        payload += canonical_json(cm ? *cm : null_value);
        payload += "\n";
        payload += "v1_engine_bridge=";
        payload += canonical_json(bridge ? *bridge : null_value);
        payload += "\n";
        return payload;
    }

    static int hex_nibble(char c) noexcept {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
        if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
        return -1;
    }

    static bool hex_to_bytes(const std::string& hex, uint8_t* out, size_t out_len) noexcept {
        if (!out || hex.size() != out_len * 2u) return false;
        for (size_t i = 0; i < out_len; ++i) {
            int hi = hex_nibble(hex[i * 2u]);
            int lo = hex_nibble(hex[i * 2u + 1u]);
            if (hi < 0 || lo < 0) return false;
            out[i] = static_cast<uint8_t>((hi << 4) | lo);
        }
        return true;
    }

    static bool parse_ed25519_signature_format(
        const std::string& sig, uint8_t pubkey[32], uint8_t signature[64]) {
        static const std::string prefix = "ed25519:";
        if (sig.compare(0, prefix.size(), prefix) != 0) return false;

        size_t pub_start = prefix.size();
        size_t sep = sig.find(':', pub_start);
        if (sep == std::string::npos) return false;
        std::string pubkey_hex = sig.substr(pub_start, sep - pub_start);
        std::string sig_hex = sig.substr(sep + 1);

        // ed25519 public key = 32 bytes, signature = 64 bytes.
        if (!is_hex_string(pubkey_hex, 64) || !is_hex_string(sig_hex, 128)) return false;
        return hex_to_bytes(pubkey_hex, pubkey, 32) &&
               hex_to_bytes(sig_hex, signature, 64);
    }

    static bool verify_signature_gate(const JsonVal& root, const std::string& sig,
                                      std::string& out_status, std::string& out_scheme) {
        out_status = "REJECTED";
        out_scheme = "none";
        if (sig.empty()) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: signature alanı eksik veya boş.\n";
            return false;
        }

        if (sig == "SELF_SIGNED_DEV") {
#ifdef CAELUS_PRODUCTION
            // CAELUS_PRODUCTION: SELF_SIGNED_DEV kabul yolu derleme-dışı — env'e hiç bakılmaz, her senaryo pinli çapayla imzalı olmak ZORUNDA.
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: SELF_SIGNED_DEV üretim derlemesinde "
                      << "tamamen devre dışı (CAELUS_PRODUCTION); senaryo pinli güven "
                      << "çapasıyla ed25519 imzalı olmak zorunda.\n";
            return false;
#else
            if (env_flag_enabled("CAELUS_ALLOW_DEV_SCENARIOS")) {
                std::cout << "[SCENARIO] SELF_SIGNED_DEV yalnızca CAELUS_ALLOW_DEV_SCENARIOS=1 ile kabul edildi; prod doğrulama atlandı.\n";
                out_status = "SELF_SIGNED_DEV";
                out_scheme = "self-signed-dev";
                return true;
            }
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: SELF_SIGNED_DEV varsayılan olarak reddedildi. "
                      << "Geliştirme için CAELUS_ALLOW_DEV_SCENARIOS=1 ayarlayın.\n";
            return false;
#endif
        }

        if (!root.has("extended_causal_model") || !root.has("v1_engine_bridge")) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: imzalı kritik alanlar eksik "
                      << "(extended_causal_model + v1_engine_bridge zorunlu).\n";
            return false;
        }

        uint8_t pubkey[32] = {};
        uint8_t signature[64] = {};
        if (!parse_ed25519_signature_format(sig, pubkey, signature)) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: imza formatı geçersiz. "
                      << "Beklenen: ed25519:<hex-pubkey-32B>:<hex-signature-64B>\n";
            return false;
        }

        const std::string payload = canonical_signed_payload(root);
        const uint8_t ok = caelus_verify_scenario_signature(
            reinterpret_cast<const uint8_t*>(payload.data()), payload.size(),
            pubkey, signature);
        if (ok != 1u) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: ed25519 doğrulaması başarısız.\n";
            return false;
        }

        // ── Pinlenmiş güven çapası kontrolü ─────────────────────────────────
        // Matematiksel ed25519 tutarlılığı geçtikten sonra, imzadaki pubkey'in
        // derleme-içi güven çapasıyla (CAELUS_TRUSTED_PUBKEY) eşleşip
        // eşleşmediğini kontrol eder.  "Kim imzaladı?" sorusunu sorar.
#ifdef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION: CAELUS_ALLOW_DEV_SCENARIOS / CAELUS_TRUST_ANY_PUBKEY bypass'ları derleme-dışı — pin kontrolü koşulsuz.
        if (std::memcmp(pubkey, CAELUS_TRUSTED_PUBKEY, 32) != 0) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: pubkey güven çapası reddi — "
                      << "imzadaki pubkey pinlenmiş güven çapasıyla eşleşmiyor "
                      << "(CAELUS_PRODUCTION: bypass yolu yok).\n";
            return false;
        }
        out_status = "VERIFIED";
        out_scheme = "ed25519+pinned";
#else
        if (env_flag_enabled("CAELUS_ALLOW_DEV_SCENARIOS") ||
            env_flag_enabled("CAELUS_TRUST_ANY_PUBKEY")) {
            // ed25519 matematiksel olarak geçti ama "kim imzaladı?" pin kontrolü
            // bypass edildi. Bu doğrulanmış güven değildir; durum açıkça ayrılır.
            std::cerr << "[UYARI] TRUSTED_PUBKEY_BYPASS: geliştirme modu — "
                      << "pubkey pin kontrolü atlandı; üretimde bu log asla sessiz olmamalı.\n";
            out_status = "DEV_TRUST_BYPASS";
            out_scheme = "ed25519+unpinned";
        } else {
            if (std::memcmp(pubkey, CAELUS_TRUSTED_PUBKEY, 32) != 0) {
                std::cerr << "[FATAL] SIGNATURE_MISMATCH: pubkey güven çapası reddi — "
                          << "imzadaki pubkey pinlenmiş güven çapasıyla eşleşmiyor.\n";
                return false;
            }
            out_status = "VERIFIED";
            out_scheme = "ed25519+pinned";
        }
#endif

        std::cout << "[SCENARIO] ed25519 imza doğrulandı "
                  << "(payload=CAELUS_SCENARIO_PACK_V1 canonical critical fields).\n";
        return true;
    }

    static caelus::causal::NodeKind kind_from_str(const std::string& s) {
        if (s == "Buffer")     return caelus::causal::NodeKind::Buffer;
        if (s == "Queue")      return caelus::causal::NodeKind::Queue;
        if (s == "Perishable") return caelus::causal::NodeKind::Perishable;
        if (s == "Gate")       return caelus::causal::NodeKind::Gate;
        if (s == "Adversary")  return caelus::causal::NodeKind::Adversary;
        return caelus::causal::NodeKind::Service; // varsayılan
    }

    static caelus::causal::Node parse_node(const JsonVal& v) {
        caelus::causal::Node n;
        n.id                = v["id"].as_s();
        n.kind              = kind_from_str(v["kind"].as_s());
        n.capacity_fp       = v["capacity_fp"].as_i(caelus::causal::FP_ONE);
        n.state_fp          = v["state_fp"].as_i(0);
        n.weight_fp         = v["weight_fp"].as_i(0);
        n.reported_state_fp = v.has("reported_state_fp")
                                ? v["reported_state_fp"].as_i(n.state_fp)
                                : n.state_fp;
        n.trust_fp          = v.has("trust_fp")
                                ? v["trust_fp"].as_i(caelus::causal::FP_ONE)
                                : caelus::causal::FP_ONE;
        n.deadline_tick     = (int32_t)v["deadline_tick"].as_i(-1);
        n.irrecoverable     = v["irrecoverable"].as_b(false);
        return n;
    }

    static caelus::causal::Edge parse_edge(const JsonVal& v) {
        caelus::causal::Edge e;
        e.from          = v["from"].as_s();
        e.to            = v["to"].as_s();         // "" = agregasyon kenarı
        e.multiplier_fp = v["multiplier_fp"].as_i(caelus::causal::FP_ONE);
        e.lag_ticks     = (int32_t)v["lag_ticks"].as_i(0);
        e.active        = v.has("active") ? v["active"].as_b(true) : true;
        return e;
    }

    static caelus::causal::FeedbackLoop parse_loop(const JsonVal& v) {
        caelus::causal::FeedbackLoop l;
        l.id      = v["id"].as_s();
        l.gain_fp = v["gain_fp"].as_i(caelus::causal::FP_ONE);
        const auto& path = v["path"];
        for (size_t i = 0; i < path.size(); ++i)
            l.path.push_back(path[i].as_s());
        return l;
    }

    static caelus::causal::LeverOutcome parse_outcome(const JsonVal& v) {
        caelus::causal::LeverOutcome o;
        o.target_node_id      = v["target_node_id"].as_s();
        o.state_delta_fp      = v["state_delta_fp"].as_i(0);
        o.trust_delta_fp      = v["trust_delta_fp"].as_i(0);
        o.friction_delta_fp   = v["friction_delta_fp"].as_i(0);
        o.clear_irrecoverable = v["clear_irrecoverable"].as_b(false);
        return o;
    }

    static caelus::causal::Lever parse_lever(const JsonVal& v) {
        caelus::causal::Lever l;
        l.id           = v["id"].as_s();
        l.target       = v["target"].as_s();
        l.success_p_fp = v["success_p_fp"].as_i(500'000);
        l.cost_ticks   = (int32_t)v["cost_ticks"].as_i(1);
        l.lockout_ticks= (int32_t)v["lockout_ticks"].as_i(0);
        if (v.has("on_success")) l.on_success = parse_outcome(v["on_success"]);
        if (v.has("on_failure")) l.on_failure = parse_outcome(v["on_failure"]);
        return l;
    }

    static caelus::causal::Hysteresis parse_hysteresis(const JsonVal& v) {
        caelus::causal::Hysteresis h;
        h.id                = v["id"].as_s();
        h.threshold_tick    = (int32_t)v["threshold_tick"].as_i(0);
        h.reversible        = v["reversible"].as_b(true);
        h.permanent_loss_fp = v["permanent_loss_fp"].as_i(0);
        return h;
    }
};

} // namespace caelus
