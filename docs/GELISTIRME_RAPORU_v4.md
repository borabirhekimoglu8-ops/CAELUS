# CAELUS OS — Geliştirme Raporu v4

**Sürüm:** 4.0
**Kapsam:** v3.0'dan bu yana inen "ticari-aday sertleştirme + genişleme dalgası"nın teknik denetimi; güncel güvenlik duruşu; teknik borç kapanma matrisi; kalan açıklar, yeni riskler ve önceliklendirilmiş yol haritası
**Dayanak:** Mevcut kaynak ağacı — `core_engine.cpp`, `include/causal_engine.h`, `include/caelus_logger.h`, `include/scenario_pack.h`, `include/ws_emitter.h`, `include/det_rng.h`, `include/audit_log.h`, `include/plugin/*` (`caelus_plugin_abi.h`, `caelus_plugin_registry.h`, `caelus_connector.h`, `caelus_solver.h`, `caelus_reporter.h`), `src/lib.rs`, `src/audit_log.rs`, `src/scenario_verify.rs`, `src/network/mesh_auth.rs`, `src/network/discovery.rs`, `ci.bat`, `build.bat`, `CMakeLists.txt`, `Cargo.toml`, `tests/test_causal_engine.cpp`, `tests/golden/*`, `tests/run_bs_exec_golden.{bat,py}`, `tools/verify_audit_log.py`, `docs/BS_EXEC_GOLDEN_MATRIX.md`, `docs/BS_EXEC_REPL_KILAVUZU.md`, `scenarios/BS-0{1,2,3}*.json`, `ui/app.js`, `ui/index.html`
**Tarih:** 2026-06-10
**Önceki raporlar:** `docs/GELISTIRME_RAPORU.md` (v1.0) · `docs/GELISTIRME_RAPORU_v2.md` (v2.0) · `docs/GELISTIRME_RAPORU_v3.md` (v3.0)

> Bu rapor v3.0'ın devamıdır. v3.0, motorun **agnostik, kurcalanamaz ve ticari-aday** bir çekirdeğe dönüştüğünü; senaryo imzasının fiilen zorlandığını, JSON ayrıştırıcının sertleştiğini, connector hattının uyandığını ve REPL'in eklendiğini doğrulamıştı. Aradan geçen sürede yoğun bir değişiklik dalgası indi: hot-path logger, det-mode determinizm sabitlemesi, KEYMGMT eklenti kontratı, gerçek connector'lar (MQTT/Zapier), dinamik plugin yükleyici sınıfı, SIG-CI negatif imza testi, dinamik connector/WS limitleri, evrensel UI temizliği ve BS-EXEC golden süiti. **Bu işlerin bir kısmı hem "geniş" hem "dar (sniper)" koşumlarda denenmiş; son hâl yer yer belirsizdir.** Bu nedenle bu rapordaki her iddia ilgili dosya **okunarak** ve mümkün olan yerde **çalıştırılarak** teyit edilmiştir. Birkaç kritik noktada (signer, KEYMGMT/DPAPI, dinamik loader, derleme durumu) gerçek kod, ilk niyetten **farklı** çıkmıştır; bunlar dürüstçe işaretlenmiştir.

---

## 1. Yönetici Özeti — Sertleştirme + Genişleme Dalgası (ve Bir Derleme Regresyonu)

v3.0'daki CAELUS OS, imzalı senaryo paketlerini güvenle yürütebilen, deterministik ve denetlenebilir bir çekirdekti. v3 sonrası dalga üç eksende ilerledi:

- **Güvenlik / determinizm.** `--det-mode`'da denetim `session_id=0` sabitlenerek CDET `audit_chain_head`'i duvar saatinden bağımsızlaştırıldı (T-10 kapandı). Hot-path artık `std::cout/std::cerr` kullanmıyor; nedensel motor olayları kapalı-varsayılanlı `caelus_logger.h` makrosuna bağlandı (T-8 kapandı). `ci.bat`'a beşinci adım — **negatif imza testi (SIG-CI)** — eklendi: dev kapısı kapalıyken `SELF_SIGNED_DEV` paket reddedilip motor `AWAITING_SCENARIO_INJECTION` nötr tabanına düşüyor.
- **Genişletilebilirlik.** Eklenti ABI'si **1.1**'e çıkarıldı; `CAELUS_PLUGIN_KEYMGMT` sınıfı + `CaelusKeyBlob` + `protect_key/unprotect_key` kontratı eklendi. Gerçek dünya connector'ları (`MqttConnector` MQTT 3.1.1 QoS0, `ZapierWebhookConnector` loopback HTTP POST) implemente edildi ve env-gated hâle getirildi. Bir `DynamicPluginLoader` sınıfı (`LoadLibrary`/`dlopen`) yazıldı.
- **Kalite / sınırlar.** Connector replay tamponu sabit 256'dan dinamik `std::vector`'e geçti (varsayılan 65536, sert tavan 1048576); WS istemci/tampon limitleri çalışma-zamanı yapılandırılabilir oldu (`CAELUS_WS_MAX_CLIENTS`, `CAELUS_WS_BUFFER_EVENTS`). UI sektörel kalıntılardan arındırılıp `UNIVERSAL_BASELINE`/`AWAITING_SCENARIO_INJECTION` durumlarını dinamik etiketlerle gösteriyor. BS-01/02/03 için **golden REPL süiti** (komut + beklenen JSON + iki runner) eklendi; REPL'e `status --json` / `snapshot --json` kondu.

Ancak teyit sürecinde **üç dürüst gerçek** ortaya çıktı:

1. **Üretim imzalama aracı (signer) hâlâ YOK.** C++ kanonik yükü üretebiliyor (`--print-scenario-payload`), fakat seed ile ed25519 imzalayan bir FFI export edilmemiş; `--sign-scenario` çağrısı bilinçli olarak **`[SIGNER] BLOCKER`** raporluyor. Strict imza operasyonel olarak hâlâ `SELF_SIGNED_DEV` + `CAELUS_ALLOW_DEV_SCENARIOS=1`'e bağlı (T-9 açık).
2. **KEYMGMT yalnızca ABI kontratı düzeyinde var.** `mesh_auth.rs` cihaz kimliğini **hâlâ düz metin 32-bayt seed** olarak yazıyor; Windows DPAPI sihirli-başlıklı blob, POSIX env/TPM yolu ve `crypt32` linki **kaynak ağacında yok**. Eklenti ABI'sindeki KEYMGMT kancası kimlik yoluna bağlı değil.
3. **`DynamicPluginLoader` çift-tanım riski gerçekleşmedi, ama loader atıl.** `caelus_dynamic_loader.h` dosyası mevcut **değil**; `DynamicPluginLoader` yalnızca `caelus_plugin_registry.h` içinde **tek** tanımlı. Buna karşılık `core_engine.cpp`'de ne bir `--plugin` CLI'si var ne de loader örnekleniyor → sınıf yazılmış ama motora **bağlanmamış** (ölü kod yolu).

Ve dalganın bıraktığı en kritik sürpriz:

> **🔴 Kaynak ağacı şu an DERLENMİYOR.** `src/network/mesh_auth.rs:138`'deki `seed.copy_from_slice(bytes)` çağrısı `&[u8]` beklenen yere `Vec<u8>` veriyor (`E0308`). Bu yüzden `cargo test` ve `cargo build --release` **derleme aşamasında** başarısız oluyor; sonuçta Rust statik kütüphanesi ve binary **üretilemiyor** (`dist/` boş). Bu, neredeyse kesinlikle KEYMGMT/DPAPI işinin "geniş koşumda eklenip dar koşumda geri alınması" sırasında bırakılmış tek-karakterlik (`bytes` → `&bytes`) bir regresyondur. Düzeltme bir satırlıktır, ancak **bu rapor hiçbir kaynak dosyayı değiştirmez** (kapsam kısıtı); bulgu T-16 olarak işaretlenmiştir.

**Tek cümlede:** v4 dalgası mimariyi gerçek anlamda genişletti ve sertleştirdi (logger, det-mode, KEYMGMT kontratı, gerçek connector'lar, SIG-CI, dinamik limitler, golden süit), fakat üç vaadi (signer, KEYMGMT'in fiilen bağlanması, dinamik loader'ın motora bağlanması) yalnızca kısmen tamamlandı ve dalga, ağacı geçici olarak derlenemez bırakan bir Rust regresyonu bıraktı. Öncelik artık nettir: **önce derlemeyi onar (T-16), sonra signer'ı operasyonelleştir.**

---

## 2. Tamamlanan İşler (v3 sonrası)

| # | Başlık | Birincil dosyalar | Teyit edilmiş durum |
|---|---|---|---|
| 1 | T-8 Hot-path logger | `include/caelus_logger.h`, `include/causal_engine.h` | ✅ Tamam |
| 2 | T-10 Det-mode determinizm sabitlemesi | `core_engine.cpp` | ✅ Tamam |
| 3 | T-9 Signer (payload + blocker) | `include/scenario_pack.h`, `core_engine.cpp`, `src/lib.rs` | ◑ Kısmî / **BLOCKER** (signer YOK) |
| 4 | Dinamik plugin loader | `include/plugin/caelus_plugin_registry.h` | ◑ Yazıldı ama **bağlanmadı** (atıl) |
| 5 | KEYMGMT | `include/plugin/caelus_plugin_abi.h`, `caelus_plugin_registry.h` | ◑ Yalnız **ABI kontratı**; `mesh_auth` DPAPI **YOK** |
| 6 | CONN-RT gerçek connector'lar | `include/plugin/caelus_connector.h`, `core_engine.cpp` | ✅ Tamam |
| 7 | SIG-CI + dinamik connector tamponu | `ci.bat`, `include/plugin/caelus_connector.h` | ✅ Tamam |
| 8 | T-13 WS çalışma-zamanı limitleri | `include/ws_emitter.h` | ✅ Tamam (`CAELUS_WS_PORT` sunucu tarafında YOK) |
| 9 | Evrensel UI | `ui/app.js`, `ui/index.html`, `include/ui_payload.h` | ✅ Tamam |
| 10 | BS-EXEC golden süiti | `tests/golden/*`, `tests/run_bs_exec_golden.{bat,py}`, docs | ✅ Tamam (+ semantik bulgu) |

### 2.1 T-8 — Hot-path Logger (`caelus_logger.h`)

`include/caelus_logger.h` yeni eklendi. Varsayılan olarak **kapalıdır** (`CAELUS_CAUSAL_LOGGING` tanımsızsa `0`); açıkken sabit boyutlu, kilitsiz bir `StaticRingLogger<N>` kullanır (kapasite `CAELUS_CAUSAL_LOGGER_CAPACITY`, varsayılan 1024).

```cpp
#ifndef CAELUS_CAUSAL_LOGGING
#define CAELUS_CAUSAL_LOGGING 0
#endif
#ifndef CAELUS_CAUSAL_LOGGER_CAPACITY
#define CAELUS_CAUSAL_LOGGER_CAPACITY 1024
#endif
// ...
#if CAELUS_CAUSAL_LOGGING
#define CAELUS_CAUSAL_LOG_EVENT(level, code, tick, message) \
    (::caelus::logging::causal_logger().log((level), (tick), (code), (message)))
#else
#define CAELUS_CAUSAL_LOG_EVENT(level, code, tick, message) ((void)0)   // no-op
#endif
```

`include/causal_engine.h` artık `<iostream>` **içermiyor** ve sıcak yolda (`inject_intel`, `apply_lever`, `check_regime`, `check_hysteresis`, `check_deadlines`, `update_trust`) doğrudan `std::cout`/`std::cerr` çağrısı **bulunmuyor**; tüm olaylar `CAELUS_CAUSAL_LOG_EVENT(...)` makrosundan geçiyor (`IntelInjected`, `RegimeExceeded`, `HysteresisFlipPermanent`, `DeadlineMissed`, ...). Sadece `build_snapshot()` içinde yerel `summary[128]` tamponuna `std::snprintf` var — bu bir akış G/Ç değildir. Kütüphane katmanı varsayılan derlemede tamamen sessizdir.

### 2.2 T-10 — Det-mode Determinizm Sabitlemesi

v3'te `--det-mode`'da bile `audit_session_id = time(nullptr)` idi ve genesis hash buna bağlı olduğundan iki CI koşumu farklı saniyeye denk gelirse CDET SHA-256 ayrışabiliyordu. v4'te düzeltildi:

```cpp
// core_engine.cpp
const uint64_t audit_session_id =
    det_mode ? 0ULL : static_cast<uint64_t>(std::time(nullptr));
```

`--det-mode`'da `session_id=0` sabit; genesis `Blake3(AUDIT_GENESIS_CTX || session_id_le)` deterministik; dolayısıyla CDET bloğundaki `audit_chain_head` artık duvar saatinden **bağımsız**. (Üretimde duvar saati adli benzersizliği korur.)

### 2.3 T-9 — Signer (Kanonik Payload + Bilinçli Blocker) — KISMÎ

`scenario_pack.h`, kanonik imzalı yükü dış araçlar için üretecek **public** yardımcılar kazandı:

```cpp
static bool canonical_signed_payload_from_json(const std::string& content,
                                               std::string& out, std::string* error = nullptr);
static bool canonical_signed_payload_from_file(const std::string& path,
                                               std::string& out, std::string* error = nullptr);
```

`core_engine.cpp` iki yeni CLI modu sunuyor:

- `--print-scenario-payload <json>` → `PrintScenarioCanonicalPayload`: `CAELUS_SCENARIO_PACK_V1` kanonik yükünü stdout'a basar (çalışır).
- `--sign-scenario <json> --key <seed>` → `ReportScenarioSignerBlocked`: **gerçek imza atmaz**, blocker raporlar ve çıkış kodu `3` döner.

```cpp
std::cerr
  << "[SIGNER] BLOCKER: Bu binary içinde export edilmiş ed25519 signing FFI sembolü yok.\n"
  << "         Mevcut Rust FFI yalnız doğrulama sağlıyor "
  << "(caelus_verify_scenario_signature); C++ tarafında seed ile imza atacak\n"
  << "         hazır fonksiyon bulunmadığı için iki dosya sınırında gerçek imza üretilemiyor.\n"
  << "         Payload almak için: --print-scenario-payload <json>\n";
```

**Teyit (dürüst durum):**
- `src/lib.rs` yalnızca `caelus_verify_scenario_signature`'ı export ediyor; **imzalama (signing) FFI YOK**.
- `src/bin/` dizini **mevcut değil**; `Cargo.toml`'da hiçbir `[[bin]]` tanımı yok (yalnız `crate-type = ["staticlib"]`).
- `target/.../caelus_sign_scenario*` altında **bayat (stale) derleme artıkları** var → signer erken bir koşumda eklenip sonra **kaldırılmış**.
- **Sonuç:** Doğrulama hattı tam; üretim imzalama hattı **yok**. Strict imza, pratikte hâlâ `SELF_SIGNED_DEV` + `CAELUS_ALLOW_DEV_SCENARIOS=1`'e bağlı. T-9 **açık** (bkz. Bölüm 5).

### 2.4 Dinamik Plugin Loader — YAZILDI, BAĞLANMADI

`include/plugin/caelus_plugin_registry.h` içinde, header-only bir `DynamicLibrary` (RAII `LoadLibraryA`/`dlopen` + `GetProcAddress`/`dlsym`) ve bir `DynamicPluginLoader` sınıfı tanımlı:

```cpp
class DynamicPluginLoader {
    bool load_into_registry(const std::string& path, PluginRegistry& registry) noexcept;
    // entry() çağrısı try/catch içinde; caelus_abi_compatible() kapısı;
    // plugin_class bitlerine göre set_solver/set_keymgmt/add_connector/add_reporter/add_listener
};
```

**Çift-tanım riski teyidi:** Görev tanımında uyarılan "iki ayrı başlık (`caelus_dynamic_loader.h` + `caelus_plugin_registry.h`) `DynamicPluginLoader`'ı iki kez tanımlar" senaryosu **gerçekleşmemiştir**: `caelus_dynamic_loader.h` **dosyası yoktur** (`include/plugin/` altında yalnız `caelus_plugin_abi.h`, `caelus_plugin_registry.h`, `caelus_connector.h`, `caelus_solver.h`, `caelus_reporter.h` bulunur) ve `DynamicPluginLoader` **tek** noktada (registry başlığında) tanımlıdır. Yani çakışma yoktur.

**Ancak (yeni teknik borç):** `core_engine.cpp` ne bir `--plugin <path>` CLI bayrağı içeriyor ne de `DynamicPluginLoader`'ı **örnekliyor**. Loader sınıfı mevcut, fakat motora **hiç bağlanmamış** → fiilen atıl/ölü kod yolu (bkz. T-17). Tüm aktif eklentiler hâlâ statik (yerleşik).

### 2.5 KEYMGMT — Yalnızca ABI Kontratı (DPAPI/identity yolu YOK)

Eklenti ABI'si **1.1**'e yükseltildi ve bir anahtar-yönetimi kontratı eklendi (`caelus_plugin_abi.h`):

```c
#define CAELUS_PLUGIN_ABI_MAJOR 1u
#define CAELUS_PLUGIN_ABI_MINOR 1u
/* plugin class bitmask */
CAELUS_PLUGIN_KEYMGMT = 0x10u,           /* Protects/unprotects local identity seeds */
/* CaelusKeyBlob { data,len,capacity,format,flags } + format tagları (RAW_SEED, PROTECTED_OS/TPM/PLUGIN) */
uint8_t (*protect_key)(void*, const CaelusKeyBlob* plaintext,    CaelusKeyBlob* protected_out);
uint8_t (*unprotect_key)(void*, const CaelusKeyBlob* protected_in, CaelusKeyBlob* plaintext_out);
static inline int caelus_abi_has_keymgmt(uint32_t v);   /* minor >= 1 kapısı */
```

`caelus_plugin_registry.h` buna karşılık gelen `set_keymgmt(...)`, `protect_key(...)`, `unprotect_key(...)` API'lerini ve bir `keymgmt_` slotunu kazandı; ABI uyumu + callback varlığı denetleniyor.

**Teyit (dürüst durum — görev tanımından SAPMA):** Görev tanımı, `mesh_auth.rs`'in artık `caelus_identity.key`'i düz metin yazmadığını; Windows DPAPI sihirli-başlıklı blob (`CAELUSKEY1\0` + `WIN-DPAPI\0` + len + blob), POSIX plaintext reddi (`CAELUS_IDENTITY_KEY_HEX`/`CAELUS_TPM_KEY_HANDLE`) ve `crypt32` linki içerdiğini varsayıyordu. **Bunların hiçbiri mevcut kaynak ağacında yok:**

```rust
// src/network/mesh_auth.rs — persist(): hâlâ DÜZ METİN 32-bayt seed
fn persist(&self, path: &Path) -> io::Result<()> {
    fs::write(path, self.signing_key.to_bytes())?;   // ham seed, şifrelenmemiş
    #[cfg(unix)] { /* yalnız 0600 izin */ }
    Ok(())
}
```

- Tüm ağaçta (`target/` hariç) `DPAPI`/`CAELUSKEY1`/`CryptProtectData`/`crypt32`/`CAELUS_IDENTITY_KEY_HEX`/`CAELUS_TPM_KEY_HANDLE` aramaları **yalnızca** `caelus_plugin_abi.h` yorumlarında ve eski raporlarda eşleşiyor; `mesh_auth.rs`, `CMakeLists.txt`, `build.bat`'ta **eşleşme yok**.
- `CMakeLists.txt` ve `build.bat` Windows'ta `advapi32 ws2_32 userenv bcrypt ntdll` linkliyor — **`crypt32` YOK**.
- Registry yorumu da bunu kabul ediyor: *"This is an ABI-level hook only: the current Rust identity path is not wired to it yet."*
- **Sonuç:** KEYMGMT *eklenti kontratı* (ABI 1.1 + `CaelusKeyBlob` + `protect_key/unprotect_key` + registry API) eklendi ama **kullanılmıyor**; cihaz kimliği koruması (DPAPI/TPM) ve kimlik yolunun keymgmt'e bağlanması **yapılmadı** (büyük olasılıkla geniş koşumda eklenip dar koşumda geri alındı — bkz. T-16/T-19). `caelus_identity.key` düz metindir.

### 2.6 CONN-RT — Gerçek Connector'lar (MQTT + Zapier)

`caelus_connector.h` iki gerçek connector kazandı:

- **`MqttConnector`** — Minimal **MQTT 3.1.1 QoS0** istemcisi. LAN/loopback broker'a bağlanır, `CONNECT` + `SUBSCRIBE` gönderir, gelen `PUBLISH` paketlerini ayrıştırır, çözülen olayları sabit bir ring'e (`IntelRing`, 128) koyar. Env: `CAELUS_MQTT_HOST` (varsayılan `127.0.0.1`), `CAELUS_MQTT_PORT` (1883), `CAELUS_MQTT_TOPIC` (`caelus/intel`), `CAELUS_MQTT_CLIENT_ID`. Arka plan iş parçacığı; 30 sn PINGREQ keep-alive.
- **`ZapierWebhookConnector`** — Yalnız **loopback** (`127.0.0.1`) HTTP dinleyicisi; `POST` gövdelerini aynı JSON/CSV intel formatında kabul eder, ayrıştırır, ring'e kuyruklar. Env: `CAELUS_ZAPIER_WEBHOOK_PORT` (varsayılan **47810**). `Content-Length` ≤ 1024 bayt; `202 Accepted` / `422` / `400` yanıtları.

`core_engine.cpp` her ikisini **env-gated** ve **det-mode'da atlanır** biçimde bağlıyor:

```cpp
const bool enable_mqtt   = caelus_env_enabled("CAELUS_ENABLE_MQTT_CONNECTOR");
const bool enable_zapier = caelus_env_enabled("CAELUS_ENABLE_ZAPIER_CONNECTOR");
if (!det_mode && enable_mqtt)   g_registry.add_connector(MqttConnector::make_vtable(), &mqtt_connector);
else if (det_mode && enable_mqtt)  std::cout << "[CONNECTOR] MqttConnector det-mode nedeniyle atlandi.\n";
// Zapier için aynı desen
```

Reader iş parçacıkları olayları kuyruklar; motor tick'leri bunları `dispatch_connectors()` ile ana nedensel yoldan (`InjectConnectorIntel` → `CausalEngine::inject_intel`) çeker.

### 2.7 SIG-CI + Dinamik Connector Tamponu + CDET Durum Alanı

**SIG-CI (`ci.bat` 5. adım).** `ci.bat` artık **beş adımlı**: (1) `cargo test`, (2) C++ unit tests, (3) binary boyut (<50MB), (4) determinizm (UNIVERSAL_BASELINE × 2 → CDET SHA-256), (5) **negatif imza testi**:

```bat
set "CAELUS_ALLOW_DEV_SCENARIOS=0"
"%EXE%" --scenario BS-01_SAHTE_UFUK --det-mode > "%SIG_OUT%" 2>&1
findstr /C:"SIGNATURE_MISMATCH" "%SIG_OUT%"
findstr /C:"AWAITING_SCENARIO_INJECTION" "%SIG_OUT%"
findstr /C:"CDET: raw_friction=1.000000" "%SIG_OUT%"
findstr /C:"CDET: final_friction=1.000000" "%SIG_OUT%"
```

Dev kapısı kapalıyken `SELF_SIGNED_DEV` paket reddedilmeli; motor çökmeden `UNIVERSAL_BASELINE`/`AWAITING_SCENARIO_INJECTION` nötr tabanına düşmeli ve sürtünme `1.000000x` olmalı.

**Dinamik connector tamponu (T-12 kapandı).** `CsvReplayConnector` artık 256 sabit dizi yerine dinamik `std::vector<ReplayEvent>` kullanıyor:

```cpp
static constexpr size_t kDefaultMaxReplayEvents = 65536;     // CAELUS_CONNECTOR_MAX_EVENTS ile
static constexpr size_t kHardMaxReplayEvents    = 1048576;   // sert tavan
```

`CAELUS_CONNECTOR_MAX_EVENTS` ile yapılandırılır; tavan aşılırsa istek tavana çekilir; ve **taşma olursa kaynak sessizce kırpılmaz — reddedilir** (`events_.clear(); return false`), böylece eksik replay ile devam edilmez.

**CDET durum alanı.** v3'teki nötrlüğe ek olarak CDET bloğuna senaryo durumu eklendi. (Not: alan adı görev tanımındaki `effective_scenario=UNIVERSAL_BASELINE` değil, gerçekte `scenario_state` + `scenario`'dur:)

```
CDET: scenario=UNIVERSAL_BASELINE
CDET: scenario_state=AWAITING_SCENARIO_INJECTION   (paket yoksa)  | SCENARIO_ACTIVE
```

### 2.8 T-13 — WS Çalışma-zamanı Limitleri

`ws_emitter.h` artık `WsEmitter::Config` ile yapılandırılabilir ve env'den okur:

```cpp
static constexpr size_t kMaxRuntimeClients = 128u;   // ayrıca FD_SETSIZE-1 ile sınırlanır
static constexpr size_t kMaxBufferEvents   = 65536u; // derleme-zamanı tavan
base.max_clients   = parse_size_env("CAELUS_WS_MAX_CLIENTS",   base.max_clients,   1, client_upper);
base.buffer_events = parse_size_env("CAELUS_WS_BUFFER_EVENTS", base.buffer_events, 16, kMaxBufferEvents);
```

- `CAELUS_WS_MAX_CLIENTS` — varsayılan 8, üst sınır `min(128, FD_SETSIZE-1)`.
- `CAELUS_WS_BUFFER_EVENTS` — varsayılan 4096, aralık [16, 65536].
- İstemciler artık `std::vector<ClientSlot>` ile yönetiliyor; geride kalan istemciye `{"type":"ws_gap","dropped":N}` gönderiliyor.

**`CAELUS_WS_PORT` teyidi:** Görev tanımındaki nüans doğrulandı — sunucu tarafında `CAELUS_WS_PORT` **yoktur**; `core_engine.cpp` portu sabit `g_emitter.start(47809)` ile açar. `CAELUS_WS_PORT` yalnız **istemci** tarafında (`ui/app.js`) bir sorgu parametresi/`window` değişkeni olarak okunur. Yani port env'i dar koşumda sunucudan hariç tutulmuştur.

### 2.9 Evrensel UI

`ui/app.js` + `ui/index.html` sektörel kalıntılardan arındırıldı ve durum-temelli, dinamik etiketli hâle geldi:

- Varsayılan `scenarioMeta`: `scenarioId: 'UNIVERSAL_BASELINE'`, `sector: 'UNIVERSAL'`, `labels: {}`.
- Başlık modu: `scenarioId === 'UNIVERSAL_BASELINE'` ise **`EVRENSEL TABAN`**, aksi halde `SENARYO`.
- `AWAITING_SCENARIO_INJECTION` (canlı-bekliyor) ve `UNIVERSAL_BASELINE` (nötr) durumları ayrı ayrı ele alınıyor.
- `labels`/`sector`/`scenario_id` dinamik: `normalizeLabelMap`/`pickLabel` ile gelen `meta`/`pack`/`data` etiketleri birleştiriliyor; sabit Vathy/sektör metinleri kaldırıldı.
- `include/ui_payload.h`, `build.bat` Aşama 1'de `index.html` + `app.js`'ten yeniden üretilen hex bayt dizisidir (mevcut).

### 2.10 BS-EXEC Golden Süiti (+ Önemli Semantik Bulgu)

BS-01/02/03 senaryolarını uçtan uca REPL üzerinden doğrulayan deterministik golden süit eklendi:

- `tests/golden/bs0{1,2,3}_repl.commands` — REPL komut dizileri (status/list levers/lever/tick/snapshot/quit).
- `tests/golden/bs0{1,2,3}_expected.json` — beklenen snapshot/milestone/lever matrisleri.
- `tests/run_bs_exec_golden.bat` — `dist/caelus_os.exe`'yi `--repl --det-mode` ile koşar, `CAELUS_ALLOW_DEV_SCENARIOS=1` ayarlar, PowerShell ile beklenen `runner_assertions.must_contain` izlerini doğrular (binary yoksa `SKIP`).
- `tests/run_bs_exec_golden.py` — yalnız stdlib; histerezis eşik tick'lerini, `outage_active` durumlarını ve normalize edilmiş snapshot **SHA-256** hash'lerini doğrular.
- REPL'e `status --json` / `snapshot --json` eklendi (`print_repl_snapshot_json`, `[REPL_JSON] {...}`).
- `docs/BS_EXEC_GOLDEN_MATRIX.md` + `docs/BS_EXEC_REPL_KILAVUZU.md` güncellendi (lever determinizm matrisi, deadline/histerezis matrisi, çok-ufuklu doğrulama).

**🔍 Doğrulama bulgusu / kalan tasarım sorusu (outage ↔ histerezis).** Golden süit, mevcut motor davranışını **regression olarak kilitler** ve bu sırada bir semantik tutarsızlığı açığa çıkarır. `CausalEngine::check_hysteresis()` outage'ı bir **atama** ile belirliyor:

```cpp
if (!h.reversible) {
    permanent_friction_fp_ = fp_add_saturating(permanent_friction_fp_, h.permanent_loss_fp);
    outage_ = (permanent_friction_fp_ >= FRICTION_MAX_FP);   // ATAMA (|= değil)
}
```

Buna karşılık `check_deadlines()`, bir `Perishable` düğüm deadline'a ulaşınca outage'ı **ayrıca/anında** açıyor (`outage_ = true`). Sonuç:

1. Senaryolardaki `permanent_loss_fp` değerleri (BS-01 `HYST_PERM_REROUTE` = 0.22x, BS-03 `HYST_TRAFIK_KAYBI` = 0.35x) **3.0x outage sentinel'ine tek başına ulaşmıyor** → non-reversible histerezis flip'i **kendi başına outage yaratmıyor**.
2. Daha kötüsü: outage ataması, daha önce bir **perishable deadline ile açılmış** outage'ı **silebiliyor**. BS-01'de outage tick 384'te (REEFER_PHARMA) `true`, ama tick 576'daki `HYST_PERM_REROUTE` flip'inde `outage_` `false`'a **resetleniyor**. BS-03'te tick 120 (REEFER_CONVOY) `true` → tick 216 (`HYST_TRAFIK_KAYBI`) `false`.

`tests/run_bs_exec_golden.py` bunu açıkça belgeleyip her histerezis flip'inde `outage_active=False` bekliyor:

```python
# Hysteresis only sets outage when accumulated permanent friction reaches 3.0x. These scenarios do not.
EXPECTED_HYSTERESIS_OUTAGE = {
    ("BS-01_SAHTE_UFUK",  "HYST_PERM_REROUTE"):     False,
    ("BS-02_GOLGE_ARSIV", "HYST_PAYROLL_MISS"):     False,
    ("BS-02_GOLGE_ARSIV", "HYST_SUPPLIER_FLIGHT"):  False,
    ("BS-03_KUM_SAATI",   "HYST_BLOKAJ"):           False,
    ("BS-03_KUM_SAATI",   "HYST_TRAFIK_KAYBI"):     False,
}
```

`docs/BS_EXEC_GOLDEN_MATRIX.md` da aynı notu taşıyor ve golden dosyaların "regression'sız yakalamak için **mevcut kodu** referans aldığını" söylüyor. Bu, kasıtlı bir tasarım kararı değil, **çözülmesi gereken bir semantik sorudur** (bkz. T-20): kalıcı (geri-alınamaz) bir histerezis flip'i mantıken outage'ı korumalı/açmalı, silmemeli.

---

## 3. Güvenlik Duruşu

### 3.1 İmza Zinciri — Doğrulama Var, Üretim İmzalama Yok

| Yetenek | Durum | Kanıt |
|---|---|---|
| Senaryo imza **doğrulaması** (ed25519) | ✅ Var, zorlanıyor | `scenario_pack.h::verify_signature_gate` + `src/scenario_verify.rs` (`ed25519-dalek`, panik-korumalı, 16 MiB sınır) |
| Kanonik yük üretimi (dış araç için) | ✅ Var | `canonical_signed_payload_from_file` + `--print-scenario-payload` |
| Üretim **imzalama** (signer) | ❌ Yok | `--sign-scenario` → `[SIGNER] BLOCKER`; `src/lib.rs` yalnız verify export ediyor; `src/bin/` yok |
| Dev bypass kapısı | ⚠️ Aktif | `SELF_SIGNED_DEV` varsayılan ret; `CAELUS_ALLOW_DEV_SCENARIOS=1` ile kabul |

Üç BS paketi de (`scenarios/BS-0{1,2,3}*.json`) hâlâ `"signature": "SELF_SIGNED_DEV"`. Signer olmadığı için tüm pratik kullanım dev bypass'a yöneliyor; **kurcalanamazlık kapısı kodda var ama operasyonel olarak nötr** (T-9). SIG-CI bunun *negatif* tarafını (geçersiz imza → reddet) artık otomatik test ediyor — bu güçlü bir regresyon koruması.

### 3.2 KEYMGMT Tehdit Modeli — Disk Plaintext HÂLÂ Açık

| Boyut | Hedeflenen | Mevcut gerçek |
|---|---|---|
| Cihaz kimliği diskte | DPAPI/TPM ile korumalı blob | ❌ **Düz metin 32-bayt seed** (`mesh_auth.rs::persist`) |
| Windows | DPAPI sihirli-başlık blob + `crypt32` | ❌ Yok (`crypt32` linklenmiyor) |
| POSIX | plaintext reddi + env/TPM stub | ❌ Yok (yalnız `0600` izin) |
| Eklenti kancası | `protect_key`/`unprotect_key` bağlı | ◑ ABI 1.1 kontratı var, **kimlik yoluna bağlı değil** |

KEYMGMT'in tehdit modeli açısından net durumu: **disk plaintext kaldırılmadı.** ABI kontratı ileride bir DPAPI/TPM eklentisinin takılmasını mümkün kılıyor, fakat bugün koruma sağlayan bir kod yolu yok (R10 büyük ölçüde açık — bkz. T-19).

### 3.3 Dinamik Plugin Yükleme — Yeni (Potansiyel) Saldırı Yüzeyi

`DynamicPluginLoader` yazıldı (henüz motora bağlı değil). Bağlandığında dikkat edilmesi gereken yeni yüzey: loader **yalnızca ABI uyumunu** (`caelus_abi_compatible`) ve `caelus_plugin_entry` sembolünün varlığını denetliyor; **imza/karma/whitelist doğrulaması YAPMIYOR**. Yani imzasız/güvenilmeyen bir `.dll`/`.so`, ABI'si uyumlu olduğu sürece solver/connector/reporter/keymgmt/listener olarak kaydedilebilir. Air-gap forensics iddiasıyla tutarlı olması için, loader devreye alınmadan **önce** imzalı eklenti zorunluluğu (örn. ed25519 modül imzası) gerekir (T-18).

### 3.4 Olumlu Güvenlik Kazanımları (Korunan)

- JSON ayrıştırıcı sertliği korunuyor: exception-free sayı (`from_chars`/`strtod`), `MAX_RECURSION_DEPTH=64`, katı `\uXXXX` vekil-çift, çift anahtar/artık-çöp reddi.
- Sabit nokta taşma-doyması korunuyor (`fp_mul_div_u64_sat`, `a*b` ara çarpımı oluşmaz) — doctest sınır vakalarıyla doğrulandı.
- Mesh el sıkışma (`mesh_auth.rs`) güçlü: transkript-bağlı imza, küçük-mertebe DH reddi, ZK slot zorlaması; 7 birim testi (derleme onarıldığında koşar).
- Connector girişleri sınırlı: payload ≤1024 bayt, memo sanitize, MQTT paket ≤4096 bayt, friction `[0,1]` / crisis `[0,3]` clamp.

---

## 4. Mevcut Mimari Durum

### 4.1 Güncellenmiş Katman Tablosu

| Katman | Dosya | v3 Durumu | v4 Durumu | Değerlendirme |
|---|---|---|---|---|
| Çekirdek orkestrasyon | `core_engine.cpp` | CLI + REPL + connector dispatch | **+ `--print-scenario-payload`/`--sign-scenario`(blocker), env-gated connector'lar, det session_id=0** | `--plugin` yok |
| Nedensel model | `causal_engine.h` | Taşma-doymalı, evrensel | **+ hot-path logger makrosu (iostream'siz)** | outage↔histerezis semantiği açık (T-20) |
| Hot-path logger | `caelus_logger.h` | (yoktu) | **Kapalı-varsayılan StaticRingLogger** | Üretimde sessiz |
| Senaryo girişi | `scenario_pack.h` | Sertleşmiş + zorunlu imza | **+ public canonical payload helper** | Signer yok (T-9) |
| İmza doğrulama | `scenario_verify.rs` | ed25519-dalek FFI | **Değişmedi** | Yalnız verify; signing export yok |
| Solver | `plugin/caelus_solver.h` | Agnostik alanlar | **Değişmedi** | Deterministik + ops. OR-Tools |
| Connector | `plugin/caelus_connector.h` | CsvReplay (256) | **+ Mqtt/Zapier gerçek; dinamik vektör 65536/1048576** | Gerçek broker testi yok (T-21) |
| KEYMGMT | `plugin/caelus_plugin_abi.h`, registry | (yoktu) | **ABI 1.1 + CaelusKeyBlob + set_keymgmt** | Kimlik yoluna bağlı değil (T-19) |
| Dinamik loader | `plugin/caelus_plugin_registry.h` | (yoktu) | **DynamicPluginLoader sınıfı** | Motora bağlanmamış (T-17), imza doğrulamıyor (T-18) |
| Determinizm | `det_rng.h`, `discovery.rs`, `ci.bat` | Sanal saat + CDET + C++ test | **+ det session_id=0; ci.bat 5. adım SIG-CI** | T-10 kapandı |
| Denetim izi | `audit_log.rs`, `audit_log.h` | Segment rotasyonu + Python doğrulayıcı | **Değişmedi** | `prev_segment_chain_head` zinciri |
| WS / UI | `ws_emitter.h`, `ui/*` | 8 istemci + ws_gap | **+ yapılandırılabilir limitler; evrensel UI** | Sunucu `CAELUS_WS_PORT` yok |
| Kripto/ağ | `src/network/*.rs` | Güçlü | **Güçlü (ama derlenmiyor — T-16)** | Kimlik hâlâ plaintext |

### 4.2 Teknik Borç Kapanma Matrisi (T-1…T-15)

| # | Risk (kaynak) | v4 Durumu | Açıklama |
|---|---|---|---|
| T-1 | JSON parser sertleştirme (v2) | ✅ Kapalı | Değişmedi; doctest hâlâ doğruluyor |
| T-2 | İmza doğrulanmıyor (v2) | ✅ Kapalı | ed25519 gate zorlanıyor |
| T-3 | Causal taşma sınırları (v2) | ✅ Kapalı | `fp_mul_div_u64_sat` + doctest |
| T-4 | WS tek-istemci (v2) | ✅ Kapalı | Çok-istemci + ws_gap |
| T-5 | Audit log büyümesi (v2) | ✅ Kapalı | Segment rotasyonu + `verify_audit_log.py` |
| T-6 | Connector callback stub (v2) | ✅ Kapalı | `ffi_inject_intel` gerçek |
| T-7 | session_id duvar saati (v2) | ✅ Kapalı | → T-10 ile çözüldü |
| **T-8** | `cout` log gürültüsü (v3) | ✅ **Kapalı** | `caelus_logger.h`; `causal_engine.h` iostream'siz |
| **T-9** | Signer yok → dev bypass (v3) | ❌ **Açık** | `--print-scenario-payload` var; signing FFI/`--sign-scenario` yok → blocker |
| **T-10** | CDET `audit_chain_head` duvar saati (v3) | ✅ **Kapalı** | `--det-mode` → `session_id=0` |
| T-11 | Canonical JSON imza kırılganlığı (v3) | ◑ Geçerli ama atıl | `setprecision(17)`+sıralı anahtar; signer olmadığı için pratik etkisi yok |
| **T-12** | Connector replay 256 sınırı (v3) | ✅ **Kapalı** | Dinamik vektör 65536/1048576 + taşmada ret |
| **T-13** | WS 8-istemci sabiti (v3) | ✅ **Kapalı** | `CAELUS_WS_MAX_CLIENTS` (cap 128/FD_SETSIZE) |
| T-14 | Python doğrulayıcı `blake3` bağımlılığı (v3) | ◑ Geçerli | `verify_audit_log.py` hâlâ `blake3` gerektiriyor |
| T-15 | REPL ↔ determinizm etkileşimi (v3) | ◑ Kısmen iyileşti | Golden runner deterministik komut dosyaları kullanıyor; serbest REPL hâlâ CDET'e uygun değil |

v3'ten gelen sekiz aktif borçtan **T-8, T-10, T-12, T-13 kapandı**; **T-9 açık**; T-11/T-14/T-15 nüans olarak duruyor.

---

## 5. Kalan Açıklar ve Yeni Riskler (T-16+)

> v3 borç dizisi T-15'e kadar kullanıldığı için yeni borçlar **T-16'dan** numaralandırılır.

| # | Risk | Konum | Önem | Açıklama |
|---|---|---|---|---|
| **T-16** | **Rust derleme kırık** | `src/network/mesh_auth.rs:138` | 🔴 **Kritik** | `seed.copy_from_slice(bytes)` → `&[u8]` beklenen yere `Vec<u8>` (`E0308`). `cargo test`/`cargo build --release` **derlenmiyor**; Rust statik kütüphanesi ve binary **üretilemiyor** (`dist/` boş). Tek-karakter düzeltme (`&bytes`); muhtemelen KEYMGMT/DPAPI geri-alma artığı. |
| **T-17** | **DynamicPluginLoader atıl/bağlanmamış** | `caelus_plugin_registry.h`, `core_engine.cpp` | Orta | Loader sınıfı var ama `--plugin` CLI'si yok, motorda hiç örneklenmiyor → ölü kod yolu. "Dinamik yükleyici var" iddiası operasyonel değil. |
| **T-18** | **Dinamik plugin imza doğrulaması yok** | `caelus_plugin_registry.h::DynamicPluginLoader` | Yüksek (devreye alınırsa) | Loader yalnız ABI uyumunu denetliyor; imza/whitelist yok → imzasız `.dll`/`.so` yüklenebilir. Air-gap forensics iddiasıyla çelişir. |
| **T-19** | **KEYMGMT yalnız ABI-hook; kimlik hâlâ plaintext** | `mesh_auth.rs`, registry | Yüksek | `caelus_identity.key` düz metin 32-bayt seed; DPAPI/POSIX-TPM/`crypt32` yok; registry keymgmt kimlik yoluna bağlı değil. R10 büyük ölçüde açık. |
| **T-20** | **Outage ↔ histerezis semantik tutarsızlığı** | `causal_engine.h::check_hysteresis` | Orta | `outage_ = (perm >= 3.0x)` ataması; non-reversible histerezis 3.0x altında outage üretmiyor ve **önceki perishable-deadline outage'ını siliyor**. Golden mevcut davranışı kilitliyor; doğru semantik kararı açık. |
| **T-21** | **Connector gerçek broker/webhook entegrasyon testi yok** | `caelus_connector.h`, `ci.bat` | Orta | Mqtt/Zapier connector kodu var ama gerçek broker/loopback POST'a karşı otomatik test yok; det-mode'da atlanıyor, CI koşmuyor. |
| **T-22** | **Binary üretilemiyor → boyut/akış hedefleri doğrulanamadı; MinGW-only** | `build.bat`, toolchain | Orta | T-16 nedeniyle `dist/caelus_os.exe` yok; `<50MB`, det-mode akışı, BS-EXEC golden ve SIG-CI taze derlemeyle koşulamadı. Ortamda yalnız `g++` (MinGW, x86_64) var; MSVC yok → tek-toolchain riski. |

### 5.1 Hâlâ Yapılmamış / Yarım Öneriler

- **R10 — Güvenlik sertleştirme kalanı:** DPAPI/TPM kimlik koruması, pubkey whitelist, slot gizliliği (T-19).
- **Signer CLI (T-9):** kanonik yükü C++ ile **bit-bit aynı** üretip ed25519 ile imzalayacak araç/FFI hâlâ yok.
- **Dinamik loader'ın motora bağlanması + imza doğrulaması (T-17, T-18).**
- **Gerçek dünya connector doğrulaması (T-21).**

---

## 6. Doğrulama / Test Durumu

### 6.1 Çalıştırılan Doğrulamalar (bu rapor için)

| Doğrulama | Yöntem | Sonuç |
|---|---|---|
| **Rust birim testleri** | `cargo test` (cargo 1.94.0) | ❌ **Derleme HATASI** — `E0308` `mesh_auth.rs:138`; test koşulamadı |
| **C++ doctest** | `g++ 15.2.0` ile derle + çalıştır | ✅ **9 vaka / 50 doğrulama / 0 hata (PASS)** |
| Binary varlığı | `dist/` taraması | ❌ Boş — prebuilt binary yok |
| Derleyici envanteri | `g++ --version` / `cl` | `g++ 15.2.0` (MinGW) var; MSVC (`cl`) yok |

C++ doctest çıktısı (gerçek koşum):

```
[doctest] PASS fixed-point arithmetic handles normal values
[doctest] PASS fixed-point arithmetic saturates near int64 limits
[doctest] PASS double conversion clamps non-finite and huge inputs
[doctest] PASS CausalEngine blank slate stays neutral until scenario injection
[doctest] PASS intel injection can change causal friction
[doctest] PASS solver C ABI structs round-trip through plugin vtable
[doctest] PASS JsonParser rejects malformed numbers without throwing
[doctest] PASS JsonParser enforces recursion depth
[doctest] PASS JsonParser strictly handles unicode escapes
[doctest] 9 test case(s), 50 assertion(s), 0 failure(s)
```

`cargo test` hatası (gerçek koşum):

```
error[E0308]: mismatched types
   --> src\network\mesh_auth.rs:138:38
138 |                 seed.copy_from_slice(bytes);
    |                      --------------- ^^^^^ expected `&[u8]`, found `Vec<u8>`
help: consider borrowing here
138 |                 seed.copy_from_slice(&bytes);
error: could not compile `caelus_network` (lib test) due to 1 previous error
```

### 6.2 Kaynaktan Sayılan (derleme onarıldığında koşacak) Testler

| Süit | Konum | Sayı (kaynaktan) | Çalıştı mı? |
|---|---|---|---|
| `mesh_auth.rs` | `src/network/mesh_auth.rs` | 7 test | ❌ (derleme kırık) |
| `discovery.rs` | `src/network/discovery.rs` | 8 test | ❌ (derleme kırık) |
| `audit_log.rs` | `src/audit_log.rs` | 6 test | ❌ (derleme kırık) |
| **Rust toplam** | — | **21 test** | ❌ |
| C++ doctest | `tests/test_causal_engine.cpp` | **9 vaka / 50 doğrulama** | ✅ (geçti) |

### 6.3 `ci.bat` Akışı (5 Adım)

1. **Rust birim testleri** (`cargo test`) — *şu an T-16 nedeniyle başarısız olur.*
2. **C++ unit tests** (`test_causal_engine.cpp` → `build_tests\caelus_cpp_tests.exe`) — bağımsız; geçer.
3. **Binary boyut** (`dist/caelus_os.exe < 50 MB`) — *binary üretilemediği için geçilemez/derleme dener.*
4. **Determinizm** (`UNIVERSAL_BASELINE --det-mode` × 2 → CDET SHA-256) — *binary'ye bağlı.*
5. **SIG-CI** (`BS-01 --det-mode`, `CAELUS_ALLOW_DEV_SCENARIOS=0` → `SIGNATURE_MISMATCH` + `AWAITING_SCENARIO_INJECTION` + `raw/final_friction=1.000000`) — *binary'ye bağlı.*

> **Net durum:** Adım 2 (C++) bağımsızdır ve geçer. Adım 1 ve 3–5 mevcut Rust derleme regresyonu (T-16) yüzünden — taze derlemede — **başarısız** olur. Onarım sonrası bu adımların geçmesi beklenir, fakat bu raporda binary üretilemediği için 3/4/5 ve BS-EXEC golden **çalıştırılamadı**; yalnızca kaynaktan ve C++ tarafından teyit edildiler.

### 6.4 Smoke / Golden Testleri

| Test | Nasıl | Beklenen | Durum |
|---|---|---|---|
| C++ doctest | `g++` + çalıştır | 9/50 PASS | ✅ Çalıştırıldı, geçti |
| det-mode determinizm | `ci.bat` Adım 4 | İki koşum CDET eşit | ⏸ Binary yok (T-16) |
| SIG-CI negatif imza | `ci.bat` Adım 5 | `SIGNATURE_MISMATCH` + blank slate | ⏸ Binary yok (T-16) |
| BS-EXEC golden (`.bat`) | `must_contain` izleri | lever/deadline/histerezis izleri | ⏸ Binary yok (T-16) |
| BS-EXEC golden (`.py`) | tick/outage/SHA-256 | histerezis flip'lerde `outage=false` | ⏸ Binary yok (T-16) |

### 6.5 Derleme

`build.bat` üç aşamalı (UI gömme → Rust LTO+opt-z → C++ statik link + strip). Aşama 2 (`cargo build --release [--target x86_64-pc-windows-gnu]`) **T-16 yüzünden başarısız** → binary üretilemiyor. C++ tarafı (`g++ -static ... -lws2_32 -ladvapi32 -luserenv -lbcrypt -lntdll`) ABI-eşleşmeli Rust kütüphanesini bekler. `crypt32` linklenmez (KEYMGMT/DPAPI olmadığını teyit eder). Ortamda MSVC yoktur; yalnız MinGW `g++ 15.2.0` mevcuttur.

---

## 7. Sıradaki Yol Haritası

Öncelik: **P0** kritik/itibar · **P1** yüksek · **P2** orta. Efor: S/M/L.

| Kod | İş paketi | Öncelik | Efor | Kapattığı |
|---|---|---|---|---|
| BUILD-FIX | **T-16: `mesh_auth.rs:138` `&bytes` düzeltmesi** → `cargo test`/`build` yeşil, binary üretilir | **P0** | S | T-16 |
| SIGNER | **T-9: Üretim signer** — kanonik yükü C++ ile bit-bit aynı üretip ed25519 imzalayan FFI/araç; gerçek imzalı senaryo akışı | **P0** | M | T-9, T-11, R10 |
| LOADER-WIRE | **DynamicPluginLoader'ı motora bağla** (`--plugin <path>` CLI) — çift-tanım riski yok, sadece bağlanmamış | P1 | S | T-17 |
| PLUGIN-SIG | **Dinamik plugin imza doğrulaması** (ed25519 modül imzası / whitelist) loader devreye girmeden önce | P1 | M | T-18 |
| OUTAGE-SEM | **Outage ↔ histerezis semantiğini düzelt** (`outage_ |= ...` veya kalıcı flip'te outage'ı koru); golden'ı yeniden üret | P1 | M | T-20 |
| KEYMGMT-WIRE | **Kimlik yolunu KEYMGMT'e bağla** (DPAPI Windows eklentisi + `crypt32`; POSIX TPM/env); plaintext seed'i kaldır | P1 | M | T-19, R10 |
| CONN-IT | **Connector entegrasyon testleri** (yerel MQTT broker + loopback webhook smoke) | P2 | M | T-21 |
| BUILD-MATRIX | **Toolchain matrisi** (MSVC + MinGW); taze derlemeyle <50MB + det + SIG-CI + golden'ı CI'da koştur | P2 | M | T-22 |

**Önerilen faz sıralaması:**
- **Faz H (acil onarım — P0):** BUILD-FIX. Tek satır; tüm CI/golden/binary zincirini geri açar. **Her şeyin önündedir.**
- **Faz I (imza operasyonelleştirme — P0):** SIGNER. Kurcalanamazlık kapısını "kodda var" → "fiilen kullanılır" yapar; dev bypass bağımlılığını kaldırır.
- **Faz J (genişleme güvenliği — P1):** LOADER-WIRE + PLUGIN-SIG + OUTAGE-SEM + KEYMGMT-WIRE. Yazılan ama bağlanmamış/yarım yetenekleri güvenli biçimde tamamlar.
- **Faz K (kalite/üretim — P2):** CONN-IT + BUILD-MATRIX.

---

## 8. Ek: v1 → v2 → v3 → v4 İzlenebilirlik Matrisi

| Öneri / Borç | v1 | v2 | v3 | v4 (teyit edilmiş) | Kanıt |
|---|---|---|---|---|---|
| R1 Causal Engine v2 | öneri | ✅ | ✅ | ✅ (+ hot-path logger) | `causal_engine.h`, `caelus_logger.h` |
| R2 Senaryo Paketi | öneri | ✅ | ✅ (imza zorlanıyor) | ✅ (+ public payload helper) | `scenario_pack.h` |
| R3 UI canlı köprü | öneri | ✅ | ✅ | ✅ (+ evrensel UI, yapılandırılabilir WS) | `ws_emitter.h`, `ui/app.js` |
| R4 Eklenti SDK | öneri | ✅ (stub) | ◑ | ◑ (ABI 1.1 + KEYMGMT + connector'lar; loader bağlanmamış) | `include/plugin/*` |
| R5 Determinizm | öneri | ✅ | ✅ | ✅ (+ det session_id=0) | `det_rng.h`, `core_engine.cpp` |
| R6 Denetim günlüğü | öneri | ✅ | ✅ | ✅ (değişmedi) | `audit_log.rs`, `verify_audit_log.py` |
| R7 C++ test + CI | öneri | ◑ | ✅ (9/50) | ✅ (9/50, koştu) + SIG-CI 5. adım | `tests/*`, `ci.bat` |
| R8 Connector'lar | öneri | ✗ | ◑ (CsvReplay) | ✅ (Mqtt/Zapier gerçek; gerçek broker testi yok) | `caelus_connector.h` |
| R9 CLI REPL | öneri | ✗ | ✅ | ✅ (+ `status/snapshot --json`, golden süit) | `core_engine.cpp`, `tests/golden/*` |
| R10 Güvenlik sertleştirme | öneri | ✗ | ◑ | ◑ (KEYMGMT yalnız ABI; kimlik plaintext) | `caelus_plugin_abi.h`, `mesh_auth.rs` |
| T-8 cout log | — | — | açık | ✅ kapandı | `caelus_logger.h` |
| T-9 signer | — | — | açık | ❌ **hâlâ açık** | `core_engine.cpp` (blocker), `src/lib.rs` |
| T-10 CDET session_id | — | — | açık→kapandı | ✅ kapandı | `core_engine.cpp` |
| T-11 canonical JSON | — | — | açık | ◑ atıl | `scenario_pack.h` |
| T-12 connector 256 | — | — | açık | ✅ kapandı | `caelus_connector.h` |
| T-13 WS 8-istemci | — | — | açık | ✅ kapandı | `ws_emitter.h` |
| T-14 verifier blake3 | — | — | açık | ◑ geçerli | `verify_audit_log.py` |
| T-15 REPL determinizm | — | — | açık | ◑ kısmen | `run_bs_exec_golden.py` |
| T-16 derleme kırık | — | — | — | 🔴 **yeni/açık** | `mesh_auth.rs:138` |
| T-17 loader bağlanmadı | — | — | — | açık | `caelus_plugin_registry.h` |
| T-18 plugin imza doğrulaması | — | — | — | açık | `DynamicPluginLoader` |
| T-19 KEYMGMT bağlanmadı | — | — | — | açık | `mesh_auth.rs` |
| T-20 outage↔histerezis | — | — | — | açık | `causal_engine.h`, `run_bs_exec_golden.py` |
| T-21 connector gerçek test | — | — | — | açık | `caelus_connector.h` |
| T-22 binary/toolchain | — | — | — | açık | `build.bat` |

---

*Bu rapor, mevcut kaynak ağacındaki gerçek dosya ve sembollere dayanır ve mümkün olan yerlerde çalıştırılarak (C++ doctest geçti; `cargo test` derleme hatası verdi) teyit edilmiştir. "✅ Kapandı" işaretli her madde için kanıt dosyası verilmiştir; "◑/❌/🔴" işaretli maddeler Bölüm 5 ve 7'de kalan iş olarak izlenir. En kritik bulgular: (1) ağaç şu an T-16 nedeniyle derlenmiyor; (2) T-9 signer hâlâ yok (strict imza dev bypass'a bağlı); (3) `DynamicPluginLoader` çift-tanımı yok ama loader motora bağlanmamış; (4) KEYMGMT yalnız ABI kontratı düzeyinde — kimlik hâlâ düz metin.*
