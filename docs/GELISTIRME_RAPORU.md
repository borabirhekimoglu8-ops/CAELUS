# CAELUS OS — Geliştirme ve Eklenti Önerileri Raporu

**Sürüm:** 1.0
**Kapsam:** Mimari değerlendirme + yol haritası
**Dayanak:** Mevcut kaynak ağacı (`core_engine.cpp`, `src/intel_core.*`, `src/network/*.rs`, `ui/*`, derleme zinciri)
**Tarih:** 2026-06-10

> Bu rapor, daha önce üretilen Kara Kuğu (Black Swan) kriz senaryolarıyla (BS-01 "Sahte Ufuk", BS-02 "Gölge Arşiv", BS-03 "Kum Saati") bilinçli olarak köprülüdür. O senaryoların _yürütülebilir_ olması için motorun nasıl evrilmesi gerektiğini somut iş paketlerine çevirir.

---

## 1. Yönetici Özeti

CAELUS OS'un **altyapı kalitesi, iddiasının önündedir.** Rust kriptografi katmanı (ed25519 + X25519 + Blake3, transkript-bağlı el sıkışma, anti-replay, kapasite sınırlı peer tablosu) ciddi ve test edilmiştir. C++ tarafındaki AES-256 FIPS-197 KAT ile doğrulanır. Derleme zinciri ABI-eşleştirmelidir ve dürüsttür (gömülü UI'ın şifreleme _olmadığını_ açıkça belirtir). Bu sağlam bir temeldir.

Ancak üç stratejik açık, ürünün vaadiyle gerçeği arasında uçurum yaratır:

1. **Arayüz motordan tamamen kopuk.** `app.js` bunu kendi başlığında itiraf eder — tüm metrikler sahte demo verisidir.
2. **"Nedensel Dünya Modeli" iddiası kodda karşılıksız.** Gerçekte 3 değişkenli bir zamanlama modeli + ağırlıklı doğrusal bir sürtünme toplamı vardır. Nedensel kenar, geri besleme, zaman, histerezis yoktur.
3. **Sektörel uyarlanabilirlik yok.** Her şey Vathy limanına gömülüdür (sabit baseline'lar, sabit UI etiketleri). "Her sektöre uyarlanabilirlik" için soyutlama/eklenti katmanı bulunmaz.

Bu rapor, bu üç açığı kapatan ve projeyi gerçek bir **eklenti-tabanlı nedensel kriz motoruna** dönüştüren bir yol haritası önerir. Amiral gemisi öneri (**Causal Engine v2**), Kara Kuğu JSON'larını birebir çalıştırabilen bir çekirdektir.

---

## 2. Mevcut Mimari — Hızlı Röntgen

| Katman | Dosya | Durum | Değerlendirme |
|---|---|---|---|
| Çekirdek orkestrasyon | `core_engine.cpp` | Çalışıyor | Faz akışı net; ama `main()` tek senaryoya gömülü, sonda `std::cin.get()` ile bloklanıyor |
| Risk/sürtünme | `src/intel_core.cpp` | Çalışıyor | Gerçek AES-256; ama sürtünme = ağırlıklı doğrusal toplam, `[1.0, 3.0]`'a clamp'li |
| Optimizasyon | `core_engine.cpp` (`RunVathyPortOptimization`) | Kısmî | CP-SAT modeli 3 değişkenli; `CAELUS_WITH_ORTOOLS` çoğu derlemede tanımsız → "simülasyon modu" |
| Kripto/ağ | `src/network/*.rs` | **Güçlü** | Transkript-bağlı el sıkışma, imzalı beacon, anti-replay, FFI panic-guard, ~13 birim testi |
| Intel köprüsü | `discovery.rs` (`IntelFeedPacket`) | Çalışıyor | Sınırlı, doğrulanmış; ama tek yönlü ve `main()`'de tek sabit paket enjekte ediliyor |
| Arayüz | `ui/app.js` | **Kopuk** | Motora bağlı değil; tüm veri sahte (kendi notunda yazılı) |
| Derleme | `build.bat` / `build.sh` / `CMakeLists.txt` | İyi | ABI-eşleştirme doğru; C++ tarafında otomatik test/CI yok |

### Sürtünmenin gerçekte nasıl hesaplandığı

İddia edilen "nedensellik" burada bir ağırlıklı toplamdır.

```cpp
// Kaynak: src/intel_core.cpp  (CalculateFrictionMultiplier)
double multiplier = 1.0;
multiplier += clamp01(profile.bureaucratic_complexity)  * 0.30;
multiplier += clamp01(profile.historical_delay_rate)    * 0.25;
multiplier += clamp01(profile.labor_action_probability) * 0.35;
multiplier += clamp01(profile.route_congestion)         * 0.20;
multiplier += clamp01(profile.weather_severity)         * 0.15;

// Hard clamp: the optimiser must never see an out-of-band multiplier.
multiplier = std::clamp(multiplier, FRICTION_MULTIPLIER_MIN, FRICTION_MULTIPLIER_MAX);
```

### Arayüzün kopukluğu — kendi kaynağındaki itiraf

```js
// Kaynak: ui/app.js  (dosya başlığı)
 * SIMULATION NOTE: All metrics, telemetry and analysis reports are illustrative
 * demo data generated locally. This interface is NOT connected live to the
 * C++/Rust CAELUS engine binary. All figures are sample data.
```

---

## 3. Kritik Boşluklar

- **G-1 · Anlatı-gerçek uçurumu (UI):** War Room motoru göstermiyor; demo. Bir yatırımcı/operatör `strings` ile bunu dakikalar içinde görebilir.
- **G-2 · Nedensellik yok:** Tek skaler çarpan; graf, kenar gecikmesi, geri besleme döngüsü, histerezis yok. Kara Kuğu senaryolarının (BS-01/02/03) beslenebileceği bir yapı yok.
- **G-3 · Sektör kilidi:** `BuiltinBaseline` Vathy'e gömülü; UI etiketleri Türkçe-Vathy-spesifik. Çok-sektör soyutlaması yok.
- **G-4 · Senaryo girişi yok:** `main()` `VATHY_BASELINE` sabiti; CLI/JSON yükleyici yok. Şifreli profil yalnızca 5 float için `key=value`.
- **G-5 · Determinizm doğrulanmıyor:** "100% Deterministic" deniyor ama `query_live_peers` HashMap'i sırasız döküyor, `now_secs()` duvar saatine bağlı, C++ `std::random_device` kullanıyor. Golden-output testi yok.
- **G-6 · C++ test/CI yok:** Rust'ta testler var; C++ ve entegrasyon yolu yalnızca açılışta self-test.
- **G-7 · Denetim izi yok:** Air-gap + determinizm iddiasına rağmen yeniden-oynatılabilir, kurcalama-kanıtlı olay günlüğü yok.

---

## 4. Geliştirme Önerileri (Önceliklendirilmiş)

Öncelik: **P0** temel/itibar · **P1** yüksek · **P2** orta · **P3** vizyon. Efor: S/M/L/XL.

| Kod | Öneri | Öncelik | Efor | Kapattığı açık |
|---|---|---|---|---|
| R1 | **Causal Engine v2** (amiral gemisi) | P0 | XL | G-2 |
| R2 | **Senaryo Paketi formatı + yükleyici** (JSON, imzalı) | P0 | M | G-3, G-4 |
| R3 | **UI↔Motor canlı köprü** (loopback NDJSON/WS) | P0 | M | G-1 |
| R4 | **Eklenti SDK'sı** (C ABI kontratı: solver/connector/report) | P1 | L | G-3 |
| R5 | **Determinizm koşum kemeri** (sabit nokta + sanal saat + golden) | P1 | M | G-5 |
| R6 | **Hash-zincirli denetim günlüğü** (Blake3 + ed25519) | P1 | M | G-7 |
| R7 | **C++ test paketi + yerel CI** (doctest + build script) | P1 | M | G-6 |
| R8 | **Connector eklentileri** (Zapier/CSV/MQTT → IntelFeed) | P2 | M | G-1, G-3 |
| R9 | **CLI + senaryo REPL** | P2 | S | G-4 |
| R10 | **Güvenlik sertleştirme** (TPM/DPAPI anahtar, slot gizliliği) | P2 | M | — |

---

## 5. Amiral Gemisi: Causal Engine v2 (R1)

Bu, "Nedensel Dünya Modeli" iddiasını gerçeğe çeviren ve Kara Kuğu senaryolarını **yürütülebilir** kılan çekirdektir.

### 5.1 Bugün ne var, neyi değiştirmeli

Şu an optimizasyon tek değişkenli bir zamanlamadır:

```cpp
// Kaynak: core_engine.cpp  (RunVathyPortOptimization)
IntVar travel_time  = cp.NewIntVar(Domain(travel_low, travel_high)).WithName("travel_time");
IntVar doc_arrival  = cp.NewIntVar(Domain(0, 2000)).WithName("doc_arrival");
IntVar boarding_end = cp.NewIntVar(Domain(0, 2000)).WithName("boarding_end");
cp.AddEquality(doc_arrival,  LinearExpr::Term(travel_time, 1).AddConstant(COURIER_START));
cp.AddEquality(boarding_end, LinearExpr::Term(doc_arrival,  1).AddConstant(BOARDING_CEREMONY));
cp.Minimize(boarding_end);
```

Bunu, **tipli bir nedensel graf + tick-tabanlı yayılım** ile sarmalayın. CP-SAT alt-problem (kaynak tahsisi/zamanlama) çözücüsü olarak kalır; üstünde graf yaşar.

### 5.2 Önerilen çekirdek yapılar (C++)

```cpp
namespace caelus::causal {

enum class NodeKind { Service, Buffer, Queue, Perishable, Gate, Adversary };

struct Node {
    std::string id;
    NodeKind    kind;
    int64_t     capacity_fp;      // sabit nokta (1e6) — determinizm
    int64_t     state_fp;         // tick'te güncellenen durum
    int32_t     deadline_tick;    // -1 = yok
};

struct Edge {
    std::string from, to;
    int64_t     multiplier_fp;    // friction kenarı
    int32_t     lag_ticks;        // gecikmeli etki (BS-01 ghost_inventory → berth)
};

struct FeedbackLoop {             // BS-03'ün pekiştirme döngüleri
    std::vector<std::string> path;
    int64_t gain_fp;              // >1e6 ⇒ pekiştiren
};

struct Lever {                    // ikna kaldıracı = durum-değiştiren aksiyon
    std::string id, target;
    int64_t     success_p_fp;     // tohumlu PRNG ile değerlendirilir
    // on_success / on_failure deltaları, lockout_ticks
};

struct Hysteresis {               // BS-03 kalıcı kayıp eşiği
    int32_t threshold_tick;
    bool    reversible;
};

} // namespace caelus::causal
```

### 5.3 Üç kritik yetenek (doğrudan BS senaryolarından)

- **Satürasyon/rejim algısı:** Gerçek-dünya talebi `[1.0, 3.0]` clamp'ini aştığında (BS senaryolarındaki `saturation_note`), motor sessizce doymak yerine **`REGIME_EXCEEDED` bayrağı** kaldırmalı. Mevcut clamp güvenlik için doğru ama "model tanım kümesi aşıldı" sinyali kaybedilmemeli.

```cpp
// Kaynak: src/intel_core.h
constexpr double FRICTION_MULTIPLIER_MIN = 1.0;
constexpr double FRICTION_MULTIPLIER_MAX = 3.0;
```

- **Aldatma/gözlemlenebilirlik katmanı (BS-01):** Düğümlerde `reported` vs `true` değer ayrımı + güven katsayısı. Plan-gerçekleşme sapması eşiği aşınca motor güven-ağırlıklı yeniden planlamaya geçer.
- **Histerezis + geri besleme (BS-03):** `throughput × çarpan` rejiminden `throughput = 0` (kesinti) rejimine geçiş ayrı bir faz; eşik aşılırsa kayıp geri alınamaz.

> **Through-line:** R1 tamamlandığında, Kara Kuğu senaryolarının `extended_causal_model` blokları (nodes/edges/feedback_loops/levers/hysteresis) doğrudan motor girdisi olur. Bugünkü `v1_engine_bridge` blokları ise geçiş döneminde mevcut `ProfileManager` + `caelus_inject_intel_packet` yoluyla zaten çalışır.

---

## 6. Senaryo Paketi Formatı + Yükleyici (R2)

`main()`'deki gömülü senaryoyu kaldırın; senaryolar **imzalı JSON paketleri** olsun. Mevcut şifreli profil mekanizmasını (`profiles/<id>.bin`, AES-256-CBC) genişletin.

**Önerilen manifest:**

```json
{
  "plugin": "scenario-pack",
  "schema_version": "1.0",
  "id": "BS-01_SAHTE_UFUK",
  "sector": "global_transshipment_hub",
  "entry": "graph.json",
  "signature": "ed25519:9f2c...",
  "min_engine": "2.0.0"
}
```

**Neden imzalı:** Zaten ed25519 kimlik altyapınız var (`DeviceIdentity`). Senaryo paketlerini aynı anahtarla imzalamak, air-gap forensics ve "yetkili senaryo" doğrulaması sağlar — kripto temaya birebir oturur.

**Yükleyici:** `ProfileManager::LoadProfile`'ı genelleştirip bir `ScenarioPack LoadPack(path)` ekleyin; çözme yolu mevcut `DecryptCBC` ile aynı.

---

## 7. UI ↔ Motor Canlı Köprü (R3) — İtibar açığını kapatır

En düşük eforla en yüksek algı kazanımı. Motor, olaylarını **NDJSON** olarak yaysın; UI tüketsin.

**Air-gap uyumlu seçenek (önerilen):** Motor `127.0.0.1`'e bağlı küçük bir WebSocket emitter çalıştırsın. Loopback, UDP multicast'inizin link-local olması gibi **dışarı çıkış değildir** — air-gap iddiasını bozmaz; raporda bu nüansı belirtin.

**Akış:**

```
core_engine → emit_event(json) → 127.0.0.1:47809 (WS) → app.js (gerçek veriyi çizer)
```

`app.js`'teki sahte üreteçler (`fluctuate`, `CRYPTO_EVENTS`, `SCENARIOS`) "canlı yoksa demo'ya düş" moduna alınır; böylece çevrimdışı demo da korunur, canlı bağlanınca gerçek `friction_mult`, `IntelFeedPacket` ve OTP slotları akar.

---

## 8. Eklenti SDK'sı (R4) — "Her sektöre uyarlanabilirlik"in motoru

Projeniz zaten C ABI / `repr(C)` köprüsü kullanıyor (`IntelFeedPacket`, `CaelusSessionResult`). Aynı deseni bir **eklenti kontratına** yükseltin. Dört eklenti sınıfı:

| Sınıf | Görev | Mevcut tutamak |
|---|---|---|
| **Scenario Pack** | Sektörel nedensel graf | R2 manifesti |
| **Connector** | Gerçek veri → IntelFeed | `caelus_inject_intel_packet` (zaten var!) |
| **Solver** | CP-SAT / yerleşik simülatör / min-maliyet-akış | `RunVathyPortOptimization` soyutlanır |
| **Reporter** | İmzalı JSON / War Room / PDF | yeni |

**Önerilen C ABI kontratı (mevcut stilinizle):**

```c
typedef struct {
    uint32_t abi_version;          // uyumluluk kapısı
    const char* name;
    uint8_t (*on_tick)(CaelusEngineCtx*, uint64_t tick);
    uint8_t (*on_intel)(CaelusEngineCtx*, const IntelFeedPacket*);
} CaelusPluginVTable;

// Her eklenti bunu dışa verir (Rust #[no_mangle] veya C++ extern "C")
const CaelusPluginVTable* caelus_plugin_entry(void);
```

**Solver soyutlaması** özellikle önemli: `CAELUS_WITH_ORTOOLS` çoğu derlemede kapalı olduğundan motor sık sık "simülasyon modunda". Bir **yerleşik deterministik simülatör eklentisini** birinci sınıf çözücü yapın; OR-Tools varsa onu tercih etsin, yoksa düşsün — ama ikisi de aynı arayüzün arkasında dursun.

---

## 9. Determinizm Koşum Kemeri (R5)

"100% Deterministic" iddiası şu an doğrulanmıyor ve birkaç yerde fiilen ihlal ediliyor:

- `query_live_peers()` → `HashMap` değerlerini **sırasız** döküyor.
- `now_secs()` / `SystemTime::now()` → duvar saatine bağlı.
- C++ `csprng_fill` → `std::random_device`.

**Öneriler:**

1. **Sanal saat:** Tick sayacı enjekte edilebilir olsun; üretimde gerçek saat, testte sabit.
2. **Sıralı çıktı:** Peer/iterasyon sıralarını fingerprint'e göre deterministik sırala.
3. **Tohumlu PRNG:** İkna kaldıracı başarı olasılıkları (`success_p`) için seed'li ChaCha (zaten `rand_chacha` bağımlılığınız var).
4. **Sabit nokta aritmetiği:** Sürtünmeyi `int64` (1e6 ölçek) ile taşıyın — zaten `friction_coefficient_fp` ile bu deseni kullanıyorsunuz.
5. **`--verify-deterministic`:** Aynı senaryoyu iki kez koşup çıktının Blake3 özetini karşılaştıran mod + golden-file testleri.

---

## 10. Hash-Zincirli Denetim Günlüğü (R6)

Air-gap + determinizm iddiasının doğal tamamlayıcısı: her tick olayını **append-only, Blake3 ile zincirlenmiş** (`h_n = Blake3(h_{n-1} || event)`) bir günlüğe yazın, oturum sonunda ed25519 ile imzalayın. Bu:

- Yeniden oynatma (replay) sağlar,
- Kurcalama-kanıtı verir,
- Mevcut kripto yığınınızı (Blake3 + ed25519) yeniden kullanır — yeni bağımlılık yok.

---

## 11. C++ Test Paketi + Yerel CI (R7)

Rust tarafında ~13 birim testi var (`mesh_auth.rs`, `discovery.rs`); C++ tarafı yalnızca açılış self-testleriyle korunuyor. Öneri:

- **doctest/GoogleTest** ile: AES KAT vektörleri (ek vektörler), `CalculateFrictionMultiplier` sınır/clamp testleri, FFI gidiş-dönüş testleri.
- **Yerel CI scripti** (`ci.bat`/`ci.sh`): `cargo test` + C++ testleri + `build.bat` + boyut kontrolü (`<50 MB`) tek komutta. Air-gap olduğu için bulut CI yerine yerel kapı.

---

## 12. Connector Eklentileri (R8) — gerçek dünya verisi

`caelus_inject_intel_packet` zaten güvenli, sınırlı bir giriş kapısı (friction `[0,1e6]`'a, crisis `0..3`'e clamp, memo 127 bayta). Üstüne connector'lar:

- **Zapier connector:** Bu çalışma alanında Zapier MCP mevcut. Bir Slack/e-posta/tablo tetikleyicisini saha intel paketine çeviren bir köprü, "kriz sinyali otomatik akışı" demosu için güçlü. (Yazma aksiyonları onay gerektirir; okuma serbest.)
- **CSV/JSONL replay connector:** Tarihsel kriz kayıtlarını tick-zamanlı besler — BS senaryolarının `intel_feed_sequence` blokları birebir bu formatta.
- **MQTT/seri/LoRa connector:** Gerçek air-gapped saha cihazları için.

---

## 13. Yol Haritası

| Faz | Süre (öneri) | İçerik | Çıktı |
|---|---|---|---|
| **F0 — Hızlı kazanımlar** | 1–2 hafta | R9 (CLI), R3 iskeleti, R7 başlangıç | Senaryo dışarıdan verilebilir; UI canlı iskelet |
| **F1 — Temel** | 3–5 hafta | R2 (senaryo paketi), R5 (determinizm), R6 (denetim) | İmzalı senaryo + doğrulanmış determinizm |
| **F2 — Amiral gemisi** | 6–10 hafta | R1 (Causal Engine v2) | BS-01/02/03 yürütülebilir |
| **F3 — Genişleme** | 4–6 hafta | R4 (eklenti SDK), R8 (connector'lar) | Çok-sektör + gerçek veri |
| **F4 — Sertleştirme** | 2–3 hafta | R10 (güvenlik), kapsamlı testler | Üretim adayı |

---

## 14. Hemen Yapılabilecek Hızlı Kazanımlar

- **`main()`'i senaryodan ayır:** `--scenario <id>` argümanı + sondaki `std::cin.get()`'i `--interactive` bayrağına bağla (otomasyon/CI için).
- **`REGIME_EXCEEDED` bayrağı:** `FieldMultiplierFromPacket` clamp'inden _önce_ ham talebi loglayıp, tavan aşıldığında uyarı bas — BS `saturation_note`'larını bugünkü motorda bile görünür kılar.
- **Determinizm akıntısını kapat:** `query_live_peers` çıktısını fingerprint'e göre sırala (tek satır, büyük kazanım).
- **UI "DEMO" filigranı:** Köprü gelene kadar, sahte veri modunda arayüze görünür "DEMO VERİSİ" rozeti — itibar riskini anında düşürür.

---

## Ek: Açık → Öneri İzlenebilirlik Matrisi

| Açık | Birincil öneri | Destekleyen |
|---|---|---|
| G-1 (UI kopuk) | R3 | R8, hızlı kazanım (DEMO filigranı) |
| G-2 (nedensellik yok) | R1 | R2 |
| G-3 (sektör kilidi) | R4 | R2 |
| G-4 (senaryo girişi) | R2 | R9 |
| G-5 (determinizm) | R5 | R6 |
| G-6 (test/CI) | R7 | R5 |
| G-7 (denetim izi) | R6 | R5 |
