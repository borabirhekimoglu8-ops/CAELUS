# CAELUS OS — Geliştirme Raporu v2

**Sürüm:** 2.0
**Kapsam:** İlk rapordan (v1.0) bu yana tamamlanan iş paketlerinin teknik denetimi + güncel mimari durum + kalan açıklar ve yeni yol haritası
**Dayanak:** Mevcut kaynak ağacı — `core_engine.cpp`, `include/causal_engine.h`, `include/scenario_pack.h`, `include/ws_emitter.h`, `include/det_rng.h`, `include/audit_log.h`, `include/plugin/*`, `src/audit_log.rs`, `src/network/discovery.rs`, `scenarios/BS-0{1,2,3}*.json`, `ci.bat`, `build.bat`, `CMakeLists.txt`, `Cargo.toml`
**Tarih:** 2026-06-10
**Önceki rapor:** `docs/GELISTIRME_RAPORU.md` (v1.0 — R1…R10 önerileri ve G-1…G-7 açıkları)

> Bu rapor v1.0'ın devamıdır. v1.0, projenin "altyapısının iddiasının önünde" olduğunu ve üç stratejik açık (kopuk UI, karşılıksız nedensellik iddiası, sektör kilidi) bulunduğunu tespit etmişti. Aradan geçen sürede R1–R7 ile F0+R3 iş paketleri **kodlandı**. Bu rapor neyin gerçekten yapıldığını dosya/satır kanıtıyla doğrular, hangi v1 açıklarının kapandığını ölçer ve yeni kodun getirdiği teknik borcu masaya yatırır.

---

## 1. Yönetici Özeti — Olgunluk Sıçraması

v1.0 raporundaki CAELUS OS, **dürüst ama eksik** bir prototipti: güçlü bir Rust kripto/mesh katmanı, gerçek bir AES-256 FIPS-197 KAT, fakat motora bağlı olmayan bir demo arayüzü ve "nedensel dünya modeli" iddiasını karşılamayan tek skaler bir sürtünme formülü.

v2.0 itibarıyla proje **yapısal olarak farklı bir olgunluk seviyesindedir:**

- **İddia artık kodla karşılanıyor.** Ağırlıklı doğrusal toplam (`CalculateFrictionMultiplier`) motorun sıcak yolundan **çıkarıldı**; yerini int64 sabit nokta aritmetiğiyle çalışan, tick-tabanlı, geri beslemeli ve histerezisli gerçek bir nedensel graf motoru (`CausalEngine v2`) aldı. `core_engine.cpp` içindeki eski `FieldMultiplierFromPacket` fonksiyonu silinip yerine `causal_engine.inject_intel(...)` çağrısı kondu.
- **Senaryolar artık dışarıdan, veri olarak geliyor.** `main()`'e gömülü tek senaryo yerine `--scenario <id>` CLI argümanı + `scenarios/<id>.json` paket yükleyicisi var. Üç Kara Kuğu paketi (BS-01, BS-02, BS-03) gerçek nedensel graf olarak diske yazıldı ve motora yükleniyor.
- **Arayüz–motor uçurumu köprülendi.** Motor, olaylarını loopback `127.0.0.1:47809` üzerinden RFC 6455 WebSocket ile yayıyor (`ws_emitter.h`); air-gap iddiası korunuyor (paket makineden çıkmıyor).
- **Determinizm artık iddia değil, kanıt.** Sanal saat, fingerprint-sıralı peer çıktısı, tohumlu PRNG ve sabit nokta aritmetiği birleşip `--det-mode` + `CDET:` bloğu + hash-zinciri başı (`audit_chain_head`) üzerinden `ci.bat` ile iki-koşum SHA-256 karşılaştırmasıyla doğrulanıyor.
- **Adli iz tutuldu.** Her oturum, Blake3 ile zincirlenmiş, ed25519 ile mühürlenmiş, append-only bir denetim günlüğü üretiyor (`audit_log.rs`).
- **Genişleme zemini kuruldu.** Saf C99 bir eklenti ABI'si (`caelus_plugin_abi.h`), CRTP tabanlı sıfır-maliyet solver/connector/reporter sarmalayıcıları ve bir `PluginRegistry` mevcut.

**Tek cümlede:** v1.0'da "vaadi karşılayan motor yok"tu; v2.0'da motor var, çalışıyor, deterministik ve denetlenebilir. Kalan iş, **eklenti ekosistemini gerçek hale getirmek** (connector implementasyonları, dinamik yükleyici, REPL) ve **yeni kodun teknik borcunu kapatmaktır** (JSON parser sertleştirme, imza doğrulamanın fiilen zorlanması, günlük rotasyonu).

---

## 2. Tamamlanan İşler

Aşağıdaki tablo hangi v1 önerisinin hangi dosyalarla hayata geçtiğini özetler. Detaylar alt bölümlerde.

| Kod | Öneri | Durum | Birincil dosyalar |
|---|---|---|---|
| F0+R3 | CLI + REGIME_EXCEEDED + WS köprü + UI canlı | ✅ Tamamlandı | `core_engine.cpp`, `include/ws_emitter.h`, `ui/app.js`, `ui/index.html` |
| R5+R7 | Determinizm kemeri + yerel CI | ✅ Tamamlandı (R7 kısmî) | `include/det_rng.h`, `src/network/discovery.rs` (sanal saat/sıralama), `ci.bat` |
| R4 | Eklenti SDK'sı (C ABI kontratı) | ✅ İskelet tam, connector'lar stub | `include/plugin/*.h` |
| R1 | Causal Engine v2 (amiral gemisi) | ✅ Tamamlandı | `include/causal_engine.h`, `core_engine.cpp` |
| R2 | Senaryo Paketi formatı + yükleyici | ✅ Tamamlandı | `include/scenario_pack.h`, `scenarios/*.json` |
| R6 | Hash-zincirli denetim günlüğü | ✅ Tamamlandı | `src/audit_log.rs`, `include/audit_log.h` |

### 2.1 F0 + R3 — CLI, REGIME_EXCEEDED, WS Köprü

**CLI argümanları.** `main()` artık üç bayrak ayrıştırıyor: `--scenario <id>`, `--interactive`, `--det-mode` (ve `--help`). Eski "sonda `std::cin.get()` ile blok" sorunu çözüldü: bekleme artık yalnızca `--interactive` verilince yapılıyor; CI/otomasyon engelsiz koşuyor.

```cpp
// core_engine.cpp — CLI ayrıştırma
if (arg == "--scenario" && i + 1 < argc)      scenario_id = argv[++i];
else if (arg == "--interactive")              interactive = true;
else if (arg == "--det-mode")                 det_mode    = true;
```

**REGIME_EXCEEDED bayrağı.** v1'in "model tanım kümesi aşıldığında sessizce doyma" riski kapatıldı. Sürtünme kenetlemesinden (`clamp`) **önce** ham talep kontrol ediliyor; tavan (`3.0x`) aşılırsa motor uyarı basıyor, WS'e ve denetim günlüğüne `regime_exceeded` olayı yazıyor:

```cpp
// include/causal_engine.h — check_regime (kenet ÖNCESİNDE)
void check_regime(int64_t raw_fp) noexcept {
    if (raw_fp > FRICTION_MAX_FP) {
        if (!regime_exceeded_) {
            regime_exceeded_ = true;
            std::cerr << "[CAUSAL-v2] *** REGIME_EXCEEDED *** ...";
        }
    }
}
```

**WS Emitter (air-gap uyumlu).** `ws_emitter.h`, OS ağ yığınını (Winsock2 / POSIX soketleri) kullanarak yalnızca `127.0.0.1:47809`'a bağlanan minimal bir RFC 6455 sunucusu. WebSocket el sıkışması için gereken SHA-1 (FIPS 180-4) ve Base64 inline implemente edilmiş; **hiçbir dış kütüphane eklenmedi**, `<50 MB` ve statik binary kısıtları korundu. `emit()` thread-safe (mutex korumalı kuyruk, 512 olayda eski olay düşürülür). Motorun ürettiği her kritik olay (`friction`, `intel`, `handshake`, `regime_exceeded`, `optimization`, `scenario_loaded`) NDJSON satırı olarak yayılıyor (`ws_json::*` yardımcıları).

**UI canlı köprü.** `ui/app.js` "canlı yoksa demo'ya düş" moduna alındı; `ui/index.html`'e görünür "DEMO VERİSİ" filigranı eklendi (itibar açığının ilk önlemi). Köprü bağlanınca gerçek `friction_mult`, intel paketleri ve durum akıyor.

### 2.2 R5 + R7 — Determinizm Kemeri ve Yerel CI

v1'de listelenen üç determinizm ihlali de kapatıldı:

| v1 ihlali | v2 çözümü | Kanıt |
|---|---|---|
| `query_live_peers()` HashMap'i sırasız döküyor | `peers.sort_unstable_by_key(\|p\| p.device_fingerprint)` | `discovery.rs` `query_live_peers` |
| `now_secs()` duvar saatine bağlı | Enjekte edilebilir sanal saat (`VIRTUAL_CLOCK_ENABLED` + `caelus_clock_set_virtual`) | `discovery.rs` |
| C++ rastgelelik kaynağı | xoshiro256** deterministik PRNG (`DetRng`, SplitMix64 tohumlayıcı) | `include/det_rng.h` |

**Sabit nokta aritmetiği.** Causal Engine tüm hesabı `int64_t`, ölçek `1e6` ile yapıyor (`fp_mul`, `fp_div`, `fp_clamp`). Bu, IEEE-754 platform farklarını saf dışı bırakıp bit-bit determinizmi garantiliyor.

**`--det-mode`.** Bu modda motor: sabit tohum (`CAELUS_DET_SEED`) + sabit enclave anahtarı enjekte ediyor, sanal saati `0`'a donduruyor, ağ ve WS'i atlıyor, deterministik solver + NullReporter ile bootstrap ediyor ve çıktının sonunda yalnızca saf hesap sonuçlarını içeren bir `CDET:` bloğu basıyor.

**Yerel CI (`ci.bat`).** Üç adım: (1) `cargo test`, (2) binary boyut kontrolü (`<50 MB`), (3) determinizm doğrulama — aynı senaryo iki kez `--det-mode` ile koşulur, `CDET:` satırları `findstr` ile çıkartılır, `certutil` SHA-256 ile karşılaştırılır; eşleşme = PASS. Air-gap doğası gereği bulut CI yerine yerel kapı tercih edilmiş.

> R7 **kısmî**: `ci.bat` + Rust birim testleri + determinizm koşum kemeri var; ancak henüz bir C++ birim test çerçevesi (doctest/GoogleTest) ve AES KAT / `CausalEngine` sınır testleri yok. Determinizm hash'i fiilen bir entegrasyon golden-testi görevi görüyor.

### 2.3 R4 — Eklenti SDK'sı

`include/plugin/` altında dört başlık:

- **`caelus_plugin_abi.h`** — Saf C99 kontrat (STL yok, exception yok). ABI sürümleme `(MAJOR<<16)|MINOR`; `caelus_abi_compatible()` kapısı. Dört eklenti sınıfı bitmask'i (`SOLVER`/`CONNECTOR`/`REPORTER`/`SCENARIO`). Tek dışa-verilen sembol: `caelus_plugin_entry`. Motor→eklenti geri çağrıları (`CaelusEngineFns`: `emit_json`, `inject_intel`, `current_tick`).
- **`caelus_solver.h`** — İki katman: (Tier 1) çalışma-zamanı C ABI vtable; (Tier 2) CRTP C++ sarmalayıcılar — yerleşik solver'lar (`DeterministicSolver`, `ORToolsSolver`) sanal fonksiyonsuz struct'lar, `std::variant` + `std::visit` ile sıfır-maliyet dağıtım. `RunVathyPortOptimization` artık solver mantığı içermiyor; sadece `g_registry.solve(req)` çağırıyor. OR-Tools varsa tercih edilir, yoksa deterministik fallback.
- **`caelus_connector.h`** — `ConnectorBase<Derived>` CRTP'si + `NullConnector` (aktif varsayılan). `CsvReplayConnector`, `MqttConnector`, `ZapierWebhookConnector` **tip-bildirimi/stub** halinde (henüz implementasyon yok; `do_pull` → `0`).
- **`caelus_reporter.h`** — `NullReporter`, `StdoutReporter`, `JsonReporter`. JsonReporter NDJSON satırı üretir; ed25519 imzalama "gelecek" notuyla işaretlenmiş.
- **`caelus_plugin_registry.h`** — Yığın-tabanlı (heap'siz) sabit boyutlu slot tabloları (`kMaxConnectors=8`, `kMaxReporters=4`, `kMaxListeners=8`). `bootstrap()` / `bootstrap_det()` ile mod seçimi. ABI uyumsuz eklentiyi loglar ve atlar (çökmez).

### 2.4 R1 — Causal Engine v2 (Amiral Gemisi)

`include/causal_engine.h`, raporun en büyük teknik kazanımı. v1'deki `multiplier = 1.0 + Σ(ağırlık × faktör)` formülünün yerine tipli bir nedensel graf geldi:

- **`Node`** — `Service/Buffer/Queue/Perishable/Gate/Adversary` tipleri; `capacity_fp`, `state_fp`, `weight_fp`; **gözlemlenebilirlik katmanı**: `reported_state_fp` ≠ `state_fp` ve `trust_fp` (BS-01 "Sahte Ufuk" telemetri karartması).
- **`Edge`** — `multiplier_fp` (çarpan), `lag_ticks` (gecikmeli etki). `to=""` → sürtünme toplamasına (aggregation) katkı; `to=düğüm` → durum yayılımı (damped, 0.05/tick).
- **`FeedbackLoop`** — `gain_fp > 1.0` → pekiştiren döngü (BS-03 muayene→yakalama→meşruiyet); yoldaki en zayıf sinyal kazançla çarpılıp ilk düğüme geri beslenir.
- **`Lever`** — tohumlu `DetRng` ile deterministik başarı/başarısızlık; `lockout_ticks` ile başarısız kaldıraç kilitlenir.
- **`Hysteresis`** — `reversible=false` ise eşik aşıldığında `permanent_friction_fp_` kalıcı artar ve `outage_` (throughput=0) tetiklenir (BS-03 köprü tıkanması).

Tick döngüsü deterministik ve sıralı: kenar yayılımı → geri besleme → güven güncellemesi → toplam sürtünme → REGIME_EXCEEDED (kenet öncesi) → histerezis → deadline. `core_engine.cpp` baseline'da `run_ticks(1)`, intel enjeksiyonundan sonra `run_ticks(2)` koşturup nihai `clamped_friction` değerini solver'a veriyor.

```cpp
// core_engine.cpp — eski formül kaldırıldı, yeni yol:
causal_engine.inject_intel(field_coeff, (int)pkt.crisis_level, (const char*)pkt.memo);
causal_snap   = causal_engine.run_ticks(2);
friction_mult = causal_snap.clamped_friction_d();   // → SolverRequest
```

### 2.5 R2 — Senaryo Paketi Formatı + Yükleyici

`include/scenario_pack.h`, **sıfır dış bağımlılıklı** bir recursive-descent JSON ayrıştırıcısı (`JsonVal` + `JsonParser`) ve `ScenarioPack` yükleyicisi içerir. Paket iki katmanlı:

1. **`extended_causal_model`** → `nodes`, `edges`, `feedback_loops`, `levers`, `hysteresis`, `hard_deadlines` → doğrudan `CausalEngine` grafına çevrilir (`apply_to_engine`).
2. **`v1_engine_bridge`** → `operational_risk_profile` (5 float) + `intel_feed_sequence` (zamanlı intel olayları) → geriye dönük uyum.

`scenarios/` altında üç gerçek Kara Kuğu paketi:

| Paket | `blackswan_class` | Öne çıkan yapı |
|---|---|---|
| `BS-01_SAHTE_UFUK` | `observability_attack` | `GHOST_INVENTORY`→`HUB_BERTHS` (lag=0), `DIRECTOR_EGO` trust=0.20 telemetri karartması, REEFER_PHARMA deadline=384 tick |
| `BS-02_GOLGE_ARSIV` | `tacit_knowledge_singularity` | Çok uluslu birleşme Günü-1 örtük bilgi krizi; düğüm/kenar grafı + intel dizisi |
| `BS-03_KUM_SAATI` | `reinforcing_loop_hysteresis` | 3 pekiştiren döngü (`gain_fp` 1.18–1.30), `HYST_TRAFIK_KAYBI` (tick=216, kalıcı %35 kayıp), blokaj→`outage` |

`core_engine.cpp`, `scenarios/<id>.json` varsa paketi yükleyip motora uyguluyor ve profilini aktif profil yapıyor; yoksa `load_vathy_baseline()` ile varsayılan grafı kuruyor.

> **Not (teknik borç):** `signature` alanı şu an **yalnızca bilgilendirme** amaçlı loglanıyor; gerçek ed25519 doğrulaması henüz zorlanmıyor (Bölüm 4.2). Tüm paketler `SELF_SIGNED_DEV`.

### 2.6 R6 — Hash-Zincirli Denetim Günlüğü

`src/audit_log.rs` (Rust çekirdek) + `include/audit_log.h` (ince C++ RAII sarıcı). Mevcut kripto yığını (Blake3 + ed25519) yeniden kullanıldı, **yeni bağımlılık eklenmedi**.

- Zincir kuralı: `h_n = Blake3(h_{n-1} || event_json_bytes)`; genesis `Blake3(CTX || session_id_le)`.
- Dosya append-only (`O_APPEND`), her yazımdan sonra `flush` (güç kesintisi dayanımı), NDJSON.
- Oturum sonunda `seal()`: domain-ayrılmış mesaj `AUDIT_SEAL_CTX || session_id || seq || chain_head` ed25519 ile imzalanır; mühür satırı pubkey + fingerprint + sig taşır. `Drop` ile mühürlenmemiş günlük otomatik mühürlenir.
- `core_engine.cpp`, oturum boyunca `SESSION_START`, `CAUSAL_BASELINE`, `INTEL_POST_FRICTION`, `SOLVER_RESULT`, `SESSION_END` olaylarını ve WS olaylarını zincire ekliyor; CDET bloğu `audit_chain_head()` ve `audit_entry_count()` ile zincir başını determinizm kanıtına dahil ediyor.
- FFI yüzeyi panik-korumalı (`catch_unwind`); `audit_log.rs` içinde 5 birim testi var (zincir determinizmi, farklı olay→farklı hash, seal/append davranışı, FFI roundtrip).

---

## 3. Mevcut Mimari Durum — Güncel "Hızlı Röntgen"

v1 tablosunun güncellenmiş hali. Çoğu boşluk kapandı.

| Katman | Dosya | v1 Durumu | v2 Durumu | Değerlendirme |
|---|---|---|---|---|
| Çekirdek orkestrasyon | `core_engine.cpp` | Tek senaryoya gömülü, `cin.get()` bloğu | **CLI'lı, fazlı, eklenti-dispatch'li** | `--scenario/--det-mode`, audit + WS + causal entegre |
| Nedensel model | `include/causal_engine.h` | (yoktu) — skaler çarpan | **Tick-tabanlı graf motoru** | Düğüm/kenar/döngü/lever/histerezis; int64 fixed-point |
| Senaryo girişi | `include/scenario_pack.h`, `scenarios/*.json` | (yoktu) | **JSON paket yükleyici + 3 BS paketi** | İmza doğrulama henüz zorlanmıyor |
| Solver | `include/plugin/caelus_solver.h` | `main()`'e gömülü CP-SAT | **Eklenti soyutlaması** | Deterministik fallback + opsiyonel OR-Tools |
| Determinizm | `det_rng.h`, `discovery.rs`, `ci.bat` | İddia, doğrulanmıyor | **Sanal saat + sıralı peer + DetRng + CDET hash** | İki-koşum SHA-256 kapısı |
| Denetim izi | `src/audit_log.rs`, `audit_log.h` | (yoktu) | **Blake3 zinciri + ed25519 mühür** | Append-only, replay'lenebilir |
| Eklenti SDK | `include/plugin/*` | (yoktu) | **C99 ABI + CRTP + Registry** | Dinamik yükleyici yok; connector'lar stub |
| Kripto/ağ | `src/network/*.rs` | Güçlü | **Güçlü (+ sanal saat, sıralı çıktı)** | ~13+ birim testi, panic-guard |
| Arayüz | `ui/app.js`, `ui/index.html` | Kopuk, sahte | **WS köprü + demo-fallback + filigran** | Loopback canlı veri |
| Derleme | `build.bat`/`CMakeLists.txt` | İyi, CI yok | **İyi + `ci.bat` yerel CI** | ABI-eşleştirme korundu |

### 3.1 v1 Açıklarının Kapanma Durumu (G-1…G-7)

| Açık | Birincil öneri | Durum | Açıklama |
|---|---|---|---|
| **G-1** UI kopuk | R3 | ✅ Kapandı | WS emitter + canlı köprü + DEMO filigranı |
| **G-2** Nedensellik yok | R1 | ✅ Kapandı | Causal Engine v2 (graf + geri besleme + histerezis) |
| **G-3** Sektör kilidi | R4, R2 | ◑ Büyük ölçüde | Senaryo paketleri + eklenti ABI sektörü veri yaptı; ancak yerleşik baseline hâlâ Vathy'e gömülü |
| **G-4** Senaryo girişi yok | R2 | ✅ Kapandı | `--scenario` + JSON paket yükleyici |
| **G-5** Determinizm doğrulanmıyor | R5 | ✅ Kapandı | Sanal saat + sıralı peer + fixed-point + CDET hash + `ci.bat` |
| **G-6** C++ test/CI yok | R7 | ◑ Kısmî | `ci.bat` + Rust testleri + determinizm golden'ı var; C++ birim test çerçevesi yok |
| **G-7** Denetim izi yok | R6 | ✅ Kapandı | Blake3 zinciri + ed25519 mühür |

Yedi açıktan **beşi tam**, ikisi (G-3, G-6) **kısmî** kapandı.

---

## 4. Kalan Açıklar ve Yeni Riskler

İki kategori: (4.1) henüz yapılmamış v1 önerileri, (4.2) yeni kodun getirdiği teknik borç.

### 4.1 Henüz Yapılmamış Öneriler

**R8 — Connector eklentileri (tam implementasyon).** ABI ve CRTP iskeleti hazır ama yalnızca `NullConnector` aktif. `CsvReplayConnector`, `MqttConnector`, `ZapierWebhookConnector` `do_pull()`'ları sabit `0` döndüren stub'lar. Dahası:
- `PluginRegistry::dispatch_connectors()` **`main()` içinde hiç çağrılmıyor** → connector boru hattı uykuda.
- Motor servis geri çağrısı `ffi_inject_intel` şu an **no-op stub** (yorumda "core_engine'de bağlanacak" deniyor ama bağlanmamış) → eklentiler fiilen intel enjekte edemez.
- Sonuç: BS paketlerinin `intel_feed_sequence` blokları yalnızca `inject_intel_at(..., 0)` ile t=0 anında giriyor; tam zaman çizelgesi (t+24h, t+48h…) henüz koşturulmuyor.

**R9 — CLI + senaryo REPL.** `apply_lever()` motorda var ve test edilebilir durumda, ancak `main()` içinden hiçbir kaldıraç **otomatik veya etkileşimli** uygulanmıyor. BS senaryolarındaki levers (örn. `L-01_ZAFER_ANLATI`, `L-03_FOMO`) yükleniyor ama tetiklenmiyor. Çok-tick'li ufuk boyunca adım adım ilerleme + kaldıraç uygulama bir REPL gerektiriyor.

**R10 — Güvenlik sertleştirme.** Henüz yok: TPM/DPAPI tabanlı anahtar saklama, senaryo paketi imza doğrulamasının fiilen zorlanması, slot gizliliği iyileştirmesi, denetim günlüğü erişim kontrolü.

**Dinamik eklenti yükleyici.** ABI `caelus_plugin_entry` sembolünü ve `.dll/.so` yükleme sözleşmesini tanımlıyor ama `LoadLibrary`/`dlopen` ile gerçek bir yükleyici **yok**. Şu an tüm eklentiler statik (yerleşik) — gerçek "üçüncü taraf eklenti" senaryosu henüz çalışmıyor.

### 4.2 Yeni Kodun Getirdiği Teknik Borç / Riskler

| # | Risk | Konum | Önem | Açıklama |
|---|---|---|---|---|
| T-1 | **JSON parser sertleştirme eksik** | `scenario_pack.h` | Yüksek | `parse_number` içinde `std::stod`/`std::stoll` malformed sayıda exception fırlatır (yakalanmıyor → çökme). Recursion derinlik sınırı yok → kötü niyetli derin-içiçe JSON ile yığın taşması. `\u` unicode escape desteklenmiyor. |
| T-2 | **Senaryo imzası doğrulanmıyor** | `scenario_pack.h` | Yüksek | `signature` alanı sadece loglanıyor; ed25519 doğrulaması zorlanmıyor. "Yetkili senaryo" garantisi şu an yok — air-gap forensics iddiasını zayıflatır. |
| T-3 | **Causal taşma sınırları test edilmemiş** | `causal_engine.h` | Orta | `fp_mul = (a*b)/FP_SCALE` yorumda "a,b < 9.2e12 güvenli" diyor; ancak JSON'dan gelen `multiplier_fp` veya `permanent_loss_fp` sınırsız. Aşırı büyük değer çarpımda int64 taşmasına yol açabilir. Giriş clamp'i / sınır testi yok. |
| T-4 | **WS emitter tek-istemci + blocking** | `ws_emitter.h` | Orta | Aynı anda yalnızca bir War Room istemcisi; `recv_http_header` baytı bayt okuyor; SHA-1 self-test bilinçli atlanmış (handshake için kabul edilebilir ama not edilmeli). Kuyruk 512'de eski olayı düşürüyor (uzun kopuklukta veri kaybı). |
| T-5 | **Denetim günlüğü büyümesi** | `audit_log.rs` | Orta | Append-only + her yazımda `flush`; rotasyon/boyut sınırı yok. Oturum başına bir dosya (`session_id` = duvar saati). Uzun koşumlarda dosya sınırsız büyür; flush-per-append I/O maliyeti yüksek. `tools/verify_audit_log.py` referans veriliyor ama dosya mevcut değil. |
| T-6 | **Connector geri çağrısı stub** | `caelus_plugin_registry.h` | Orta | `ffi_inject_intel` no-op; connector'lar intel enjekte edemez (bkz. R8). |
| T-7 | **Determinizmde session_id duvar saati** | `core_engine.cpp` | Düşük | `--det-mode`'da hesap deterministik ama `audit_session_id = time(nullptr)` → günlük dosya yolu deterministik değil. Çözüm doğru (CDET `chain_head`'i kıyaslıyor) ama nüans belgelenmeli. |
| T-8 | **`std::cout` log gürültüsü motor sıcak yolunda** | `causal_engine.h` | Düşük | `inject_intel`, `apply_lever`, `check_*` fonksiyonları doğrudan `std::cout`/`std::cerr`'e yazıyor. Kütüphane katmanı için bu sıkı bağ; ileride yapılandırılabilir logger gerekebilir. |

---

## 5. Sıradaki Yol Haritası

Öncelik: **P0** kritik/itibar · **P1** yüksek · **P2** orta. Efor: S/M/L.

| Kod | İş paketi | Öncelik | Efor | Kapattığı |
|---|---|---|---|---|
| R8a | `ffi_inject_intel`'i gerçekle + `dispatch_connectors`'ı tick döngüsüne bağla | P1 | S | T-6, R8 |
| R8b | `CsvReplayConnector` tam implementasyon (BS `intel_feed_sequence` replay) | P1 | M | R8, G-3 |
| T-1 | JSON parser sertleştirme (derinlik sınırı, sayı parse guard, `\u` desteği, fuzz) | P0 | M | T-1 |
| T-2 | Senaryo paketi ed25519 imza doğrulamasını **zorla** (geçersiz imza → reddet) | P0 | S | T-2, G-3 |
| R9 | Senaryo REPL: çok-tick ufuk + zamanlı intel + etkileşimli `apply_lever` | P1 | M | R9, G-4 |
| BS-EXEC | BS-01/02/03'ü tam ufuk boyunca koştur (deadline, histerezis, döngü canlı) | P1 | M | G-2 (derinleştirme) |
| R7b | C++ birim test çerçevesi (doctest): AES KAT, `CausalEngine` sınır/clamp, FFI roundtrip | P1 | M | G-6, T-3 |
| LOADER | Dinamik eklenti yükleyici (`LoadLibrary`/`dlopen` + `caelus_plugin_entry`) | P2 | M | R4 (tamamlama) |
| T-5 | Denetim günlüğü rotasyonu + `tools/verify_audit_log.py` aracını yaz | P2 | S | T-5 |
| R10 | Güvenlik sertleştirme (TPM/DPAPI anahtar, slot gizliliği) | P2 | M | — |
| T-4 | WS emitter çok-istemci + backpressure politikası | P2 | S | T-4 |

**Önerilen faz sıralaması:**
- **Faz A (sertleştirme — P0):** T-1 + T-2. Yeni kodun en kritik güvenlik borcunu kapatır; air-gap/forensics iddiasını sağlamlaştırır.
- **Faz B (canlandırma — P1):** R8a + R8b + R9 + BS-EXEC. Connector boru hattını uyandırır, BS senaryolarını tam ufuk boyunca yürütülebilir kılar — projenin asıl vaadinin gösterimi.
- **Faz C (kalite — P1):** R7b. C++ tarafına gerçek birim testleri.
- **Faz D (genişleme — P2):** LOADER + T-5 + R10 + T-4. Üçüncü taraf eklenti ekosistemi ve üretim sertleştirmesi.

---

## 6. Doğrulama / Test Durumu

### 6.1 `ci.bat` Ne Yapıyor

Üç adımlı yerel kapı (çıkış kodu 0 = tümü geçti):

1. **Rust birim testleri** — `cargo test` (`mesh_auth.rs`, `discovery.rs`, `audit_log.rs`).
2. **Binary boyut kontrolü** — `dist/caelus_os.exe` `< 50 MB` mı? (yoksa `build.bat` ile derler).
3. **Determinizm doğrulama** — aynı senaryo iki kez `--det-mode` ile koşulur:

```
caelus_os.exe --scenario VATHY_BASELINE --det-mode > run1.txt
caelus_os.exe --scenario VATHY_BASELINE --det-mode > run2.txt
findstr "CDET:" run1.txt | certutil -hashfile ... SHA256
findstr "CDET:" run2.txt | certutil -hashfile ... SHA256
→ iki SHA-256 eşleşmeli
```

### 6.2 Determinizm Nasıl Kanıtlanıyor

`--det-mode` çıktısının sonundaki `CDET:` bloğu **yalnızca saf hesap sonuçlarını** içerir — zaman damgası, anahtar veya UUID yok. Bloktaki kritik alanlar:

- `raw_friction`, `clamped_friction`, `regime_exceeded`, `causal_engine_ticks`
- `field_friction_coeff`, `field_crisis_level`, `causal_post_intel_friction`, `final_friction`
- `travel_band_low/high`, `doc_arrival_min`, `boarding_end_min`, `on_time`
- **`audit_chain_head`** + **`audit_entry_count`** — denetim zincirinin başı

`audit_chain_head`'in CDET bloğuna dahil edilmesi kritik: zincir, deterministik olayların (genesis + her append) Blake3 birikimidir. İki koşum aynı `chain_head`'i üretiyorsa, hem hesap hem de olay sırası bit-bit aynıdır. Bu, determinizmi tek bir hash'te yoğunlaştıran güçlü bir kanıttır.

Determinizmin **kaynakları:**
- int64 sabit nokta aritmetiği (IEEE-754 platform farkı yok),
- sanal saat (`caelus_clock_set_virtual(0)`),
- tohumlu `DetRng` (xoshiro256** + SplitMix64),
- fingerprint-sıralı peer çıktısı,
- deterministik solver (OR-Tools yerine `DeterministicSolver` zorlanır),
- ed25519 deterministik imza (RFC 8032 §5.1 — rastgele nonce yok).

### 6.3 Rust Birim Testleri

- **`mesh_auth.rs` / `discovery.rs`** — ed25519 imzalı beacon, fingerprint↔anahtar bağı (`spoofed_fingerprint_is_rejected`), anti-replay, kapasite sınırı (`MAX_PEERS` flood koruması), sanal saat.
- **`audit_log.rs`** — `chain_is_deterministic_for_same_events`, `different_events_give_different_hashes`, `seal_writes_and_marks_sealed`, `append_after_seal_is_rejected`, `ffi_roundtrip`.

### 6.4 Test Boşlukları (öneri için)

- C++ tarafında birim test çerçevesi yok → `CausalEngine` taşma/clamp sınırları, `scenario_pack` malformed JSON dayanımı, `ws_emitter` çerçeve kodlaması test edilmiyor (bkz. R7b, T-1, T-3).
- BS senaryolarının tam-ufuk yürütülmesi için golden çıktı testi yok (bkz. BS-EXEC).

---

## Ek: v1 → v2 İzlenebilirlik Özeti

| v1 Önerisi | v2 Sonuç | Kanıt dosyası |
|---|---|---|
| R1 Causal Engine v2 | ✅ Tamamlandı | `include/causal_engine.h` |
| R2 Senaryo Paketi | ✅ Tamamlandı | `include/scenario_pack.h`, `scenarios/*.json` |
| R3 UI canlı köprü | ✅ Tamamlandı | `include/ws_emitter.h`, `ui/app.js` |
| R4 Eklenti SDK | ✅ İskelet (connector'lar stub) | `include/plugin/*` |
| R5 Determinizm kemeri | ✅ Tamamlandı | `det_rng.h`, `discovery.rs`, `ci.bat` |
| R6 Denetim günlüğü | ✅ Tamamlandı | `src/audit_log.rs`, `include/audit_log.h` |
| R7 C++ test + CI | ◑ Kısmî (CI var, C++ birim test yok) | `ci.bat` |
| F0 Hızlı kazanımlar | ✅ Tamamlandı | `core_engine.cpp` (CLI, REGIME_EXCEEDED) |
| R8 Connector'lar | ✗ Stub | `include/plugin/caelus_connector.h` |
| R9 CLI REPL | ✗ Yapılmadı | — |
| R10 Güvenlik sertleştirme | ✗ Yapılmadı | — |
