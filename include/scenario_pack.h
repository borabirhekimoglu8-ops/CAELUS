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
    std::string title;
    std::string region;
    int         tick_minutes   = 15;
    int         horizon_hours  = 240;

    // ── Evrensel açıklama, kaynak etiketi ve kalibrasyon üstverileri ─────────
    std::string enterprise_code;
    std::string sector_label;
    std::string synopsis;
    std::string compliance;
    std::string data_provenance;   ///< "FICTIONAL_SAMPLE" | "USER_DEFINED" | "SOURCE_SPECIFIED"
    std::string data_source_note;
    std::vector<std::string> assumptions;
    std::vector<std::string> data_gaps;

    struct FinancialMeta {
        bool        defined                  = false;
        std::string unit_name;
        double      baseline_units_per_hour  = 0.0;
        double      hourly_downtime_cost_usd = -1.0;
        double      sla_breach_penalty_usd   = -1.0;
        std::string data_source;
    };
    FinancialMeta financials;

    struct NodeMeta {
        std::string id;
        std::string label;
        std::string category;
        std::string notes;
        std::string data_source;
        std::string unit;
        std::string timestamp;
    };
    std::vector<NodeMeta> node_meta;

    struct LeverMeta {
        std::string id;
        std::string code;
        std::string label;
        std::string notes;
        double      cost_usd = -1.0;
        std::string data_source;
    };
    std::vector<LeverMeta> lever_meta;

    // ── İmza kapsamı ────────────────────────────────────────────────────────
    // "V3"           : schema_version + id + blackswan_class + sector + min_caelus_engine + meta + extended_causal_model + v1_engine_bridge (tam kapsam)
    // "V2"           : id + sector + meta + extended_causal_model + v1_engine_bridge imzalı
    // "V1"           : yalnız extended_causal_model + v1_engine_bridge imzalı (meta İMZASIZ)
    // "DEV_UNSIGNED" : SELF_SIGNED_DEV (yalnız geliştirme bayrağıyla veya etkileşimli taslakta)
    std::string signature_scheme;
    bool        meta_signed    = false;   ///< tick_minutes/horizon/id/sector imza kapsamında mı?
    bool        pubkey_pinned  = false;   ///< İmza anahtarı derleme-içi CAELUS_TRUSTED_PUBKEY ile eşleşiyor mu?

    // ── Yüklenen graf ───────────────────────────────────────────────────────
    std::vector<caelus::causal::Node>         nodes;
    std::vector<caelus::causal::Edge>         edges;
    std::vector<caelus::causal::FeedbackLoop> loops;
    std::vector<caelus::causal::Lever>        levers;
    std::vector<caelus::causal::Hysteresis>   hysteresis;
    std::vector<caelus::causal::IntelBinding> intel_bindings;

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
        std::ifstream f(path, std::ios::binary);
        if (!f) {
            std::cout << "[SCENARIO] Paket bulunamadı: " << path << "\n";
            loaded = false;
            return false;
        }
        std::ostringstream buf;
        buf << f.rdbuf();
        return load_from_string(buf.str(), path, false);
    }

    bool load_from_string(const std::string& content,
                          const std::string& source_label = "<memory>",
                          bool allow_interactive_unsigned = false) {
        loaded = false;
        schema_version.clear();
        id.clear();
        blackswan_class.clear();
        sector.clear();
        min_caelus_engine.clear();
        signature.clear();
        title.clear();
        region.clear();
        tick_minutes = 15;
        horizon_hours = 240;
        enterprise_code.clear();
        sector_label.clear();
        synopsis.clear();
        compliance.clear();
        data_provenance.clear();
        data_source_note.clear();
        assumptions.clear();
        data_gaps.clear();
        financials = FinancialMeta{};
        node_meta.clear();
        lever_meta.clear();
        signature_scheme.clear();
        meta_signed = false;
        pubkey_pinned = false;
        nodes.clear();
        edges.clear();
        loops.clear();
        levers.clear();
        hysteresis.clear();
        intel_bindings.clear();
        risk_profile = caelus::intel::OperationalRiskProfile{};
        intel_sequence.clear();

        // Ayrıştır
        JsonParser parser(content.data(), content.size());
        JsonVal root;
        if (!parser.parse(root) || root.type != JsonVal::Obj) {
            std::cerr << "[SCENARIO] JSON ayrıştırma hatası: " << source_label << "\n";
            return false;
        }

        // ── Manifest ────────────────────────────────────────────────────────
        schema_version    = root["schema_version"].as_s();
        id                = root["id"].as_s();
        blackswan_class   = root["blackswan_class"].as_s();
        sector            = root["sector"].as_s();
        min_caelus_engine = root["min_caelus_engine"].as_s();
        signature         = root["signature"].as_s();

        if (!verify_signature_gate(root, signature, signature_scheme, pubkey_pinned, allow_interactive_unsigned)) {
            std::cerr << "[SCENARIO] Paket imzası reddedildi: " << source_label << "\n";
            return false;
        }
        meta_signed = (signature_scheme == "V2" || signature_scheme == "V3");

        if (root.has("meta")) {
            const auto& meta = root["meta"];
            title            = meta["title"].as_s();
            region           = meta["region"].as_s();
            tick_minutes     = (int)meta["tick_minutes"].as_i(15);
            horizon_hours    = (int)meta["horizon_hours"].as_i(240);
            enterprise_code  = meta["enterprise_code"].as_s();
            sector_label     = meta["sector_label"].as_s();
            synopsis         = meta["synopsis"].as_s();
            compliance       = meta["compliance"].as_s();
            data_provenance  = meta["data_provenance"].as_s();
            data_source_note = meta["data_source_note"].as_s();
            if (meta.has("assumptions")) {
                const auto& arr = meta["assumptions"];
                for (size_t i = 0; i < arr.size(); ++i) {
                    const std::string s = arr[i].as_s();
                    if (!s.empty()) assumptions.push_back(s);
                }
            }
            if (meta.has("data_gaps")) {
                const auto& arr = meta["data_gaps"];
                for (size_t i = 0; i < arr.size(); ++i) {
                    const std::string s = arr[i].as_s();
                    if (!s.empty()) data_gaps.push_back(s);
                }
            }
            if (meta.has("financials")) {
                const auto& fin = meta["financials"];
                financials.unit_name = fin.has("unit_name")
                    ? fin["unit_name"].as_s()
                    : fin["unit_label"].as_s();
                financials.baseline_units_per_hour = fin.has("baseline_units_per_hour")
                    ? fin["baseline_units_per_hour"].as_f(0.0)
                    : fin["baseline_units"].as_f(0.0);
                financials.hourly_downtime_cost_usd = fin.has("hourly_downtime_cost_usd")
                    ? fin["hourly_downtime_cost_usd"].as_f(-1.0)
                    : fin["downtime_cost_per_hour_usd"].as_f(-1.0);
                financials.sla_breach_penalty_usd = fin["sla_breach_penalty_usd"].as_f(-1.0);
                financials.data_source = fin["data_source"].as_s();
                const bool explicit_avail = fin.has("available") ? fin["available"].as_b(true) : true;
                if (!explicit_avail) {
                    financials.hourly_downtime_cost_usd = -1.0;
                    financials.sla_breach_penalty_usd   = -1.0;
                }
                financials.defined = !financials.unit_name.empty() ||
                                     financials.baseline_units_per_hour > 0.0 ||
                                     financials.hourly_downtime_cost_usd >= 0.0;
            }
        }
        if (!meta_signed) {
            // Görünürlük: V1 imzası meta'yı kapsamaz. tick_minutes intel replay
            // zamanlamasını belirlediği için imzasız olduğu açıkça bildirilir.
            std::cerr << "[SCENARIO] UYARI: imza şeması " << signature_scheme
                      << " — meta alanları (tick_minutes=" << tick_minutes
                      << ", horizon_hours=" << horizon_hours
                      << ", id, sector) imza kapsamında DEĞİL. "
                         "V2/V3 ile yeniden imzalanması önerilir.\n";
        }

        // ── Causal Model ────────────────────────────────────────────────────
        if (root.has("extended_causal_model")) {
            const auto& cm = root["extended_causal_model"];

            // Düğümler
            if (cm.has("nodes")) {
                for (size_t ni = 0; ni < cm["nodes"].size(); ++ni) {
                    const auto& jn = cm["nodes"][ni];
                    nodes.push_back(parse_node(jn));
                    NodeMeta nm;
                    nm.id          = jn["id"].as_s();
                    nm.label       = jn["label"].as_s();
                    nm.category    = jn["category"].as_s();
                    nm.notes       = jn["notes"].as_s();
                    nm.data_source = jn["data_source"].as_s();
                    nm.unit        = jn["unit"].as_s();
                    nm.timestamp   = jn["timestamp"].as_s();
                    node_meta.push_back(std::move(nm));
                }
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
                for (size_t lv = 0; lv < cm["levers"].size(); ++lv) {
                    const auto& jlv = cm["levers"][lv];
                    levers.push_back(parse_lever(jlv));
                    LeverMeta lm;
                    lm.id          = jlv["id"].as_s();
                    lm.code        = jlv["code"].as_s();
                    lm.label       = jlv["label"].as_s();
                    lm.notes       = jlv["notes"].as_s();
                    lm.cost_usd    = jlv["cost_usd"].as_f(-1.0);
                    lm.data_source = jlv["data_source"].as_s();
                    lever_meta.push_back(std::move(lm));
                }
            }

            // Histerezis
            if (cm.has("hysteresis")) {
                for (size_t hi = 0; hi < cm["hysteresis"].size(); ++hi)
                    hysteresis.push_back(parse_hysteresis(cm["hysteresis"][hi]));
            }

            // Deadline'lar: deadline_tick (ve varsa min_state_fp) düğüm alanına ayarla
            if (cm.has("hard_deadlines")) {
                for (size_t di = 0; di < cm["hard_deadlines"].size(); ++di) {
                    const auto& d = cm["hard_deadlines"][di];
                    auto nid = d["node_id"].as_s();
                    auto at  = (int32_t)d["at_tick"].as_i(-1);
                    for (auto& node : nodes) {
                        if (node.id == nid) {
                            node.deadline_tick = at;
                            if (d.has("min_state_fp")) {
                                node.deadline_min_state_fp = d["min_state_fp"].as_i(node.deadline_min_state_fp);
                            }
                            break;
                        }
                    }
                }
            }

            // Intel bağlamaları (isteğe bağlı; imzalı yükün parçası)
            if (cm.has("intel_bindings")) {
                for (size_t bi = 0; bi < cm["intel_bindings"].size(); ++bi) {
                    auto b = parse_intel_binding(cm["intel_bindings"][bi]);
                    bool found = false;
                    for (const auto& node : nodes) if (node.id == b.node_id) { found = true; break; }
                    if (!found) {
                        std::cerr << "[SCENARIO] UYARI: intel_bindings hedef düğümü bulunamadı: '"
                                  << b.node_id << "' — bağlama yok sayıldı.\n";
                        continue;
                    }
                    intel_bindings.push_back(std::move(b));
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
                  << " Intel:" << intel_sequence.size()
                  << " IntelBağlama:" << intel_bindings.size()
                  << " İmza:" << signature_scheme << "\n";

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
        for (const auto& b  : intel_bindings) eng.add_intel_binding(b);
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
    // payload_version: 1 = CAELUS_SCENARIO_PACK_V1 (geriye uyumlu),
    //                  2 = CAELUS_SCENARIO_PACK_V2 (meta + id + sector dahil),
    //                  3 = CAELUS_SCENARIO_PACK_V3 (tam manifest + meta + model dahil).
    static bool canonical_signed_payload_from_json(
        const std::string& content,
        std::string& out,
        std::string* error = nullptr,
        int payload_version = 1) {
        JsonParser parser(content.data(), content.size());
        JsonVal root;
        if (!parser.parse(root) || root.type != JsonVal::Obj) {
            if (error) *error = "JSON ayrıştırma hatası veya kök nesne değil";
            return false;
        }
        if (payload_version == 3) {
            if (!root.has("extended_causal_model")) {
                if (error) *error = "imzalı kritik alan eksik (extended_causal_model zorunlu)";
                return false;
            }
            out = canonical_signed_payload_v3(root);
            return true;
        }
        if (payload_version == 2) {
            if (!root.has("extended_causal_model")) {
                if (error) *error = "imzalı kritik alan eksik (extended_causal_model zorunlu)";
                return false;
            }
            out = canonical_signed_payload_v2(root);
            return true;
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
        std::string* error = nullptr,
        int payload_version = 1) {
        std::ifstream f(path, std::ios::binary);
        if (!f) {
            if (error) *error = "senaryo dosyası açılamadı: " + path;
            return false;
        }
        std::ostringstream buf;
        buf << f.rdbuf();
        return canonical_signed_payload_from_json(buf.str(), out, error, payload_version);
    }

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
        0xa1, 0x1b, 0x52, 0x8e, 0x53, 0x44, 0xd9, 0xaa,
        0x71, 0x47, 0x47, 0x3b, 0xf1, 0x6c, 0xe9, 0xe9,
        0xc9, 0x77, 0xf8, 0x96, 0x08, 0x95, 0x8b, 0x58,
        0x63, 0x59, 0x41, 0x4c, 0xc7, 0xe9, 0x7e, 0x7f
    };

    // Bilinen deterministik geliştirme/test anahtarı (seed: 010203...1f20).
    // Üretim güven çapası DEĞİLDİR (pubkey_pinned = false kalır; arayüzde ve
    // raporda açıkça "Test Anahtarı — Pinli Değil" olarak etiketlenir).
    static constexpr uint8_t CAELUS_DEV_TEST_PUBKEY[32] = {
        0x79, 0xb5, 0x56, 0x2e, 0x8f, 0xe6, 0x54, 0xf9,
        0x40, 0x78, 0xb1, 0x12, 0xe8, 0xa9, 0x8b, 0xa7,
        0x90, 0x1f, 0x85, 0x3a, 0xe6, 0x95, 0xbe, 0xd7,
        0xe0, 0xe3, 0x91, 0x0b, 0xad, 0x04, 0x96, 0x64
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
                // Bayt sırası İŞARETSİZ karşılaştırılır (Rust signer'daki
                // as_bytes().cmp ile birebir). ASCII anahtarlarda sonuç eskisiyle
                // aynıdır; ASCII dışı anahtarlarda (ör. meta "sınanan_aksiyom")
                // işaretli char sıralaması Rust'tan sapardı.
                std::sort(members.begin(), members.end(),
                          [](const auto& a, const auto& b) {
                              return std::lexicographical_compare(
                                  a.first.begin(), a.first.end(),
                                  b.first.begin(), b.first.end(),
                                  [](char x, char y) {
                                      return static_cast<unsigned char>(x) <
                                             static_cast<unsigned char>(y);
                                  });
                          });
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

    /**
     * CAELUS_SCENARIO_PACK_V2 — V1'in kapsamadığı manifest ve meta alanlarını
     * da imzalar. Böylece tick_minutes (intel replay zamanlaması), horizon,
     * id ve sector imzayı bozmadan değiştirilemez. v1_engine_bridge isteğe
     * bağlıdır (yoksa null); bu, ulaşım odaklı v1 profilini taşımayan yeni
     * sektör paketlerine izin verir.
     */
    static std::string canonical_signed_payload_v2(const JsonVal& root) {
        static const JsonVal null_value;
        const JsonVal* id     = root.find("id");
        const JsonVal* sector = root.find("sector");
        const JsonVal* meta   = root.find("meta");
        const JsonVal* cm     = root.find("extended_causal_model");
        const JsonVal* bridge = root.find("v1_engine_bridge");
        std::string payload;
        payload.reserve(512);
        payload += "CAELUS_SCENARIO_PACK_V2\n";
        payload += "id=";
        payload += canonical_json(id ? *id : null_value);
        payload += "\nsector=";
        payload += canonical_json(sector ? *sector : null_value);
        payload += "\nmeta=";
        payload += canonical_json(meta ? *meta : null_value);
        payload += "\nextended_causal_model=";
        payload += canonical_json(cm ? *cm : null_value);
        payload += "\nv1_engine_bridge=";
        payload += canonical_json(bridge ? *bridge : null_value);
        payload += "\n";
        return payload;
    }

    /**
     * CAELUS_SCENARIO_PACK_V3 — Tam kapsamlı manifest + meta + model imzası.
     * V2'ye ek olarak schema_version, blackswan_class ve min_caelus_engine
     * alanlarını da imzalar; v1_engine_bridge yine isteğe bağlıdır (yoksa null).
     */
    static std::string canonical_signed_payload_v3(const JsonVal& root) {
        static const JsonVal null_value;
        const JsonVal* schema_ver = root.find("schema_version");
        const JsonVal* id         = root.find("id");
        const JsonVal* bs_class   = root.find("blackswan_class");
        const JsonVal* sector     = root.find("sector");
        const JsonVal* min_eng    = root.find("min_caelus_engine");
        const JsonVal* meta       = root.find("meta");
        const JsonVal* cm         = root.find("extended_causal_model");
        const JsonVal* bridge     = root.find("v1_engine_bridge");
        std::string payload;
        payload.reserve(640);
        payload += "CAELUS_SCENARIO_PACK_V3\n";
        payload += "schema_version=";
        payload += canonical_json(schema_ver ? *schema_ver : null_value);
        payload += "\nid=";
        payload += canonical_json(id ? *id : null_value);
        payload += "\nblackswan_class=";
        payload += canonical_json(bs_class ? *bs_class : null_value);
        payload += "\nsector=";
        payload += canonical_json(sector ? *sector : null_value);
        payload += "\nmin_caelus_engine=";
        payload += canonical_json(min_eng ? *min_eng : null_value);
        payload += "\nmeta=";
        payload += canonical_json(meta ? *meta : null_value);
        payload += "\nextended_causal_model=";
        payload += canonical_json(cm ? *cm : null_value);
        payload += "\nv1_engine_bridge=";
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
                                      std::string& scheme_out, bool& pubkey_pinned_out,
                                      bool allow_interactive_unsigned = false) {
        scheme_out.clear();
        pubkey_pinned_out = false;
        if (sig.empty()) {
#ifndef CAELUS_PRODUCTION
            if (allow_interactive_unsigned) {
                std::cout << "[SCENARIO] Etkileşimli kullanıcı taslağı (imzasız) kabul edildi; DEV_UNSIGNED olarak işaretlendi.\n";
                scheme_out = "DEV_UNSIGNED";
                pubkey_pinned_out = false;
                return true;
            }
#endif
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: signature alanı eksik veya boş.\n";
            return false;
        }

        if (sig == "SELF_SIGNED_DEV" || sig == "UNSIGNED_LOCAL_DRAFT") {
#ifdef CAELUS_PRODUCTION
            // CAELUS_PRODUCTION: SELF_SIGNED_DEV kabul yolu derleme-dışı — env'e hiç bakılmaz, her senaryo pinli çapayla imzalı olmak ZORUNDA.
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: SELF_SIGNED_DEV üretim derlemesinde "
                      << "tamamen devre dışı (CAELUS_PRODUCTION); senaryo pinli güven "
                      << "çapasıyla ed25519 imzalı olmak zorunda.\n";
            return false;
#else
            if (allow_interactive_unsigned || env_flag_enabled("CAELUS_ALLOW_DEV_SCENARIOS")) {
                std::cout << "[SCENARIO] " << sig << " geliştirme/etkileşimli modda kabul edildi; prod doğrulama atlandı.\n";
                scheme_out = "DEV_UNSIGNED";
                pubkey_pinned_out = false;
                return true;
            }
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: SELF_SIGNED_DEV varsayılan olarak reddedildi. "
                      << "Geliştirme için CAELUS_ALLOW_DEV_SCENARIOS=1 ayarlayın.\n";
            return false;
#endif
        }

        if (!root.has("extended_causal_model")) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: imzalı kritik alan eksik "
                      << "(extended_causal_model zorunlu).\n";
            return false;
        }

        uint8_t pubkey[32] = {};
        uint8_t signature[64] = {};
        if (!parse_ed25519_signature_format(sig, pubkey, signature)) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: imza formatı geçersiz. "
                      << "Beklenen: ed25519:<hex-pubkey-32B>:<hex-signature-64B>\n";
            return false;
        }

        // Önce V3 (tam manifest + meta + model), sonra V2 (meta + id + sector + model),
        // sonra geriye uyumlu V1 (yalnız model + v1_engine_bridge) denenir.
        const std::string payload_v3 = canonical_signed_payload_v3(root);
        uint8_t ok = caelus_verify_scenario_signature(
            reinterpret_cast<const uint8_t*>(payload_v3.data()), payload_v3.size(),
            pubkey, signature);
        if (ok == 1u) {
            scheme_out = "V3";
        } else {
            const std::string payload_v2 = canonical_signed_payload_v2(root);
            ok = caelus_verify_scenario_signature(
                reinterpret_cast<const uint8_t*>(payload_v2.data()), payload_v2.size(),
                pubkey, signature);
            if (ok == 1u) {
                scheme_out = "V2";
            } else if (root.has("v1_engine_bridge")) {
                const std::string payload = canonical_signed_payload(root);
                ok = caelus_verify_scenario_signature(
                    reinterpret_cast<const uint8_t*>(payload.data()), payload.size(),
                    pubkey, signature);
                if (ok == 1u) scheme_out = "V1";
            }
        }
        if (ok != 1u) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: ed25519 doğrulaması başarısız.\n";
            return false;
        }

        // ── Pinlenmiş güven çapası kontrolü ─────────────────────────────────
        // Matematiksel ed25519 tutarlılığı geçtikten sonra, imzadaki pubkey'in
        // derleme-içi güven çapasıyla (CAELUS_TRUSTED_PUBKEY) eşleşip
        // eşleşmediğini kontrol eder.  "Kim imzaladı?" sorusunu sorar.
        const bool is_pinned_key = (std::memcmp(pubkey, CAELUS_TRUSTED_PUBKEY, 32) == 0);
        const bool is_known_dev_test_key = (std::memcmp(pubkey, CAELUS_DEV_TEST_PUBKEY, 32) == 0);
        pubkey_pinned_out = is_pinned_key;
#ifdef CAELUS_PRODUCTION
        // CAELUS_PRODUCTION: CAELUS_ALLOW_DEV_SCENARIOS / CAELUS_TRUST_ANY_PUBKEY bypass'ları derleme-dışı — pin kontrolü koşulsuz.
        if (!is_pinned_key) {
            std::cerr << "[FATAL] SIGNATURE_MISMATCH: pubkey güven çapası reddi — "
                      << "imzadaki pubkey pinlenmiş güven çapasıyla eşleşmiyor "
                      << "(CAELUS_PRODUCTION: bypass yolu yok).\n";
            return false;
        }
#else
        if (!is_pinned_key) {
            if ((is_known_dev_test_key && !env_flag_enabled("CAELUS_STRICT_PINNED_PUBKEY")) ||
                allow_interactive_unsigned ||
                env_flag_enabled("CAELUS_ALLOW_DEV_SCENARIOS") ||
                env_flag_enabled("CAELUS_TRUST_ANY_PUBKEY")) {
                std::cerr << "[UYARI] TRUSTED_PUBKEY_BYPASS: senaryo test/geliştirme anahtarıyla imzalanmış "
                          << "(UNPINNED_DEV_KEY; pubkey_pinned=false); üretim güven çapası DEĞİLDİR.\n";
            } else {
                std::cerr << "[FATAL] SIGNATURE_MISMATCH: pubkey güven çapası reddi — "
                          << "imzadaki pubkey pinlenmiş güven çapasıyla eşleşmiyor.\n";
                return false;
            }
        }
#endif

        std::cout << "[SCENARIO] ed25519 imza doğrulandı "
                  << "(payload=CAELUS_SCENARIO_PACK_" << scheme_out
                  << ((scheme_out == "V2" || scheme_out == "V3") ? "; meta dahil" : "; meta HARİÇ")
                  << "; anahtar=" << (is_pinned_key ? "PINNED_TRUST_ANCHOR" : "UNPINNED_DEV_KEY")
                  << ").\n";
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
        n.deadline_tick          = (int32_t)v["deadline_tick"].as_i(-1);
        n.deadline_min_state_fp  = v["deadline_min_state_fp"].as_i(0);
        n.irrecoverable          = v["irrecoverable"].as_b(false);
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
        h.min_friction_fp   = v["min_friction_fp"].as_i(0);
        h.condition_node_id = v["condition_node_id"].as_s();
        h.min_node_state_fp = v["min_node_state_fp"].as_i(0);
        return h;
    }

    static caelus::causal::IntelBinding parse_intel_binding(const JsonVal& v) {
        caelus::causal::IntelBinding b;
        b.node_id          = v["node_id"].as_s();
        b.mode             = (v["mode"].as_s() == "add")
                                 ? caelus::causal::IntelBinding::Mode::Add
                                 : caelus::causal::IntelBinding::Mode::Max;
        b.scale_fp         = v["scale_fp"].as_i(caelus::causal::FP_ONE);
        b.crisis_step_fp   = v["crisis_step_fp"].as_i(0);
        b.min_crisis_level = (int32_t)v["min_crisis_level"].as_i(0);
        return b;
    }
};

} // namespace caelus
