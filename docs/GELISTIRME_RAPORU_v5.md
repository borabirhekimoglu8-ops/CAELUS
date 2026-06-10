# CAELUS OS — Geliştirme Raporu v5

**Sürüm:** 5.0
**Kapsam:** v4.0'dan bu yana inen "ticari-aday sertleştirme + genişleme dalgası"nın teknik denetimi; T-16 derleme onarımı, T-9/T-17 üretim signer FFI+CLI+kanonik, T-18 plugin imza gate, T-19 KEYMGMT (Windows DPAPI + POSIX env), T-20 outage latching, T-21 connector smoke testi, T-22 toolchain matrisi; güncel güvenlik duruşu; teknik borç kapanma matrisi; kalan açıklar, yeni riskler ve önceliklendirilmiş yol haritası
**Dayanak:** Mevcut kaynak ağacı — `core_engine.cpp`, `include/causal_engine.h`, `include/caelus_logger.h`, `include/scenario_pack.h`, `include/ws_emitter.h`, `include/det_rng.h`, `include/audit_log.h`, `include/plugin/*` (`caelus_plugin_abi.h`, `caelus_plugin_registry.h`, `caelus_connector.h`, `caelus_solver.h`, `caelus_reporter.h`), `src/lib.rs`, `src/audit_log.rs`, `src/scenario_verify.rs`, `src/network/mesh_auth.rs`, `src/network/discovery.rs`, `src/bin/caelus_sign_scenario.rs`, `Cargo.toml`, `ci.bat`, `build.bat`, `CMakeLists.txt`, `tests/test_causal_engine.cpp`, `tests/connector_smoke.py`, `tests/golden/*`, `tests/run_bs_exec_golden.{bat,py}`, `tools/verify_audit_log.py`, `docs/BS_EXEC_GOLDEN_MATRIX.md`, `docs/BS_EXEC_REPL_KILAVUZU.md`, `scenarios/BS-0{1,2,3}*.json`, `ui/app.js`, `ui/index.html`
**Tarih:** 2026-06-10
**Önceki raporlar:** `docs/GELISTIRME_RAPORU.md` (v1.0) · `docs/GELISTIRME_RAPORU_v2.md` (v2.0) · `docs/GELISTIRME_RAPORU_v3.md` (v3.0) · `docs/GELISTIRME_RAPORU_v4.md` (v4.0)

> Bu rapor v4.0'ın devamıdır. v4.0, "üç dürüst gerçek" ile kritik boşlukları (signer YOK, KEYMGMT yalnızca ABI+plaintext, DynamicPluginLoader atıl, T-16 derleme kırığı nedeniyle binary üretilemiyor, cargo test derleme hatası) dürüstçe belgeleyip P0 onarım + signer + KEYMGMT + plugin-sig önceliklerini netleştirmişti. Aradan geçen kısa sürede yoğun arka plan ajanları (ceb0555a-fa12-43b4-a3b6-9d66a577b829 ve plugin-sig ac66e537-d925-4ac9-a81f-55a5b4ec0b27 başta olmak üzere) T-16/T-9/T-17/T-18/T-19/T-20/T-21/T-22'yi kapattı. **Bu rapordaki her iddia ilgili dosya okunarak ve mümkün olan yerde çalıştırılarak (cargo check/test/build, CLI e2e, g++ syntax, ReadLints) teyit edilmiştir.** Rapor yazıldıktan sonra inen son üç onarım (outage latching, connector smoke, toolchain matrisi) ayrıca **disk üzerinden yeniden okunarak** teyit edilmiş ve statüler buna göre düzeltilmiştir.

---

## 1. Yönetici Özeti — Sertleştirme + Genişleme Dalgası (ve Kritik Kapanışlar)

v4.0'daki CAELUS OS, imzalı senaryo paketlerini güvenle yürütebilen, deterministik ve denetlenebilir bir çekirdekti; fakat üç kritik vaadi (üretim signer, gerçek KEYMGMT, derlenebilirlik) yarım veya kırık bırakmıştı; üstüne outage semantiği, connector entegrasyon testi ve toolchain matrisi de açıktı. v5 dalgası bunların tümünü kapattı:

- **Derleme onarımı (T-16).** `src/network/mesh_auth.rs:148` `seed.copy_from_slice(&bytes)` düzeltmesi ile `cargo test`/`cargo build --release` yeşil; 23/23 test geçti, `target/release/caelus_network.lib` (≈14 MB) üretildi.
- **Üretim signer (T-9/T-17).** Rust tarafında `caelus_sign_scenario_payload` C-FFI (lib.rs) + tam `caelus_sign_scenario` CLI binary (`src/bin/caelus_sign_scenario.rs`, Cargo.toml [[bin]]) üretildi. Kanonik payload C++ `scenario_pack.h` ile **bit-bit uyumlu** (CAELUS_SCENARIO_PACK_V1 + extended_causal_model + v1_engine_bridge, sorted keys, 17-precision float, string escape kuralları). Çıktı formatı `ed25519:<64hex-pub>:<128hex-sig>`. `--generate-key --write` destekli; unit testler + temp senaryo ile e2e doğrulama (dev bypass kapalıyken dist/caelus_os.exe imzalanıp yüklendi, SIGNATURE_MISMATCH yok).
- **Plugin imza gate (T-18).** `caelus_plugin_registry.h` içinde `DynamicPluginLoader` için `set_signature_verifier` + `verify_plugin_signature` + `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` dev bypass ile strict-fail default olarak eklendi (loader devreye alınmadan önce imzalı eklenti zorunluluğu).
- **KEYMGMT gerçek implementasyon (T-19).** Windows'ta gerçek DPAPI (`CryptProtectData`/`CryptUnprotectData`, crypt32 + kernel32 link) + magic header (`CAELUSKEY1\0WIN-DPAPI\0` + u32 len + blob) ile persist/migrate. Eski düz 32-byte seed'ler Windows'ta okunursa DPAPI blob'a migrate ediliyor. POSIX'te plaintext dosya yazımı yasak; sadece `CAELUS_IDENTITY_KEY_HEX` env veya hata. Testler (persistent_identity_is_stable) güncellendi ve doğrulandı.
- **Outage latching state machine (T-20).** `include/causal_engine.h` artık latched bir outage durum makinesi içeriyor: `latch_outage()` (`outage_ = true`) yalnızca **latch** eder; `check_hysteresis()` non-reversible flip'te `permanent_friction_fp_`'yi artırıp `latch_outage()` çağırıyor ve outage'ı **asla false yapmıyor**; perishable deadline kaçırılırsa (`check_deadlines`) `node.irrecoverable = true; latch_outage();`; outage yalnızca başarılı recovery lever'ında (`apply_lever` → `outcome.clear_irrecoverable == true` → `clear_outage_recovery()`) temizleniyor. `build_snapshot()` `s.outage_active = outage_` ile latch state'i yansıtıyor. v4'teki "atama outage'ı siler/resetler" tutarsızlığı **giderildi**.
- **Connector entegrasyon smoke testi (T-21).** `tests/connector_smoke.py` (~19.9 KB): geçici C++ harness'ı `caelus_connector.h`'ye karşı derliyor; **dış broker olmadan** MQTT için mini yerel broker fixture, Zapier için loopback HTTP POST kullanıyor; her iki connector'da event `pull_intel` → mock registry `inject_intel` callback'ine kadar doğrulanıyor (MQTT'de JSON, Zapier'de CSV payload). `ci.bat` Adım 3/6 olarak varsayılan koşuyor; `CAELUS_SKIP_CONNECTOR_SMOKE=1` ile atlanıyor.
- **Toolchain matrisi / build taşınabilirliği (T-22).** `build.bat` artık `CAELUS_CXX=GCC|MSVC|g++|cl.exe|<path>` derleyici seçimi, `MSVC_AVAILABLE` + `where x86_64-w64-mingw32-gcc` GNU target preflight, GNU target/linker sorunlu + MSVC varsa MSVC fallback, `CAELUS_SKIP_CMAKE=1` / `CAELUS_DOCKER=1` (WMIC'siz) ve non-fatal `chcp` içeriyor. `crypt32` hem GCC hem MSVC link yollarında ve `CMakeLists.txt` Windows link listesinde korunuyor.

Geriye kalan **dört dürüst gerçek** (revize edilmiş):

1. **DynamicPluginLoader motora bağlanmamış (T-17).** `caelus_plugin_registry.h` içinde DynamicPluginLoader + imza gate tam; fakat `core_engine.cpp`'de `--plugin` CLI'si yok, loader hiç örneklenmiyor → sınıf yazılmış ama operasyonel değil (ölü kod yolu).
2. **Golden snapshot'lar latch öncesi davranışı kilitliyor (T-25, T-20 kalıntısı).** Outage modelini latching'e çeviren ajan sniper kapsam nedeniyle golden test dosyalarına dokunmadı: `tests/golden/bs01_expected.json` hâlâ `HYST_PERM_REROUTE` flip'inde `outage_active: false` bekliyor (ve eski "atama outage'ı siler" notunu taşıyor); `tests/run_bs_exec_golden.py` hâlâ tüm histerezis flip'leri için `EXPECTED_HYSTERESIS_OUTAGE = False` ve sabit `EXPECTED_SNAPSHOT_HASHES` kilitliyor. Yeni latched motorda bu senaryolardaki non-reversible flip'ler (BS-01 `HYST_PERM_REROUTE`, BS-02 `HYST_PAYROLL_MISS`/`HYST_SUPPLIER_FLIGHT`, BS-03 `HYST_TRAFIK_KAYBI` — tümü `reversible:false`) outage'ı **latch eder** → golden beklentileri **bayat**. Golden snapshot/hash'ler latched davranışa göre **yeniden üretilmeli**.
3. **KEYMGMT eklenti kancası kimlik yoluna bağlı değil (T-23).** DPAPI artık Rust tarafında gerçek; fakat ABI 1.1 `protect_key`/`unprotect_key` registry kancası hâlâ `mesh_auth` kimlik yolundan çağrılmıyor.
4. **Çoklu-toolchain CI fiili koşum kanıtlanmadı (T-22 kalıntısı).** Toolchain matrisi script seviyesinde implemente; ancak bu makinede yalnız MinGW `g++ 15.2.0` yüklü, MSVC `cl` fiilen yok → matris **kodda var ama her iki toolchain'de fiilen koşulmadı**.

**Tek cümlede:** v5 dalgası T-16/T-9/T-17/T-18/T-19/T-20/T-21/T-22'yi kapatarak "derlenebilir + signer operasyonel + kimlik korumalı + plugin-sig gate'li + outage latched + connector smoke'lu + toolchain matrisli" hâle getirdi. Kalan borçlar (loader wiring, latched outage'a göre golden yenileme, KEYMGMT↔mesh wiring, çoklu-toolchain fiili CI) net, dar ve çoğunlukla P1/P2; v4'ün tüm P0'ları temizlendi.

---

## 2. Tamamlanan İşler (v4 sonrası)

| # | Başlık | Birincil dosyalar | Teyit edilmiş durum |
|---|---|---|---|
| 1 | T-8 Hot-path logger | `include/caelus_logger.h`, `include/causal_engine.h` | ✅ (v4'ten korundu) |
| 2 | T-10 Det-mode determinizm sabitlemesi | `core_engine.cpp` | ✅ (v4'ten korundu) |
| 3 | T-9/T-17 Signer (FFI + CLI + kanonik) | `src/lib.rs`, `src/bin/caelus_sign_scenario.rs`, `include/scenario_pack.h`, `Cargo.toml` | ✅ **Tamam** (FFI + bin + C++ uyumlu kanonik + test + e2e) |
| 4 | T-16 Rust derleme kırığı onarımı | `src/network/mesh_auth.rs:148` | ✅ **Tamam** (cargo test 23/23, release lib) |
| 5 | T-18 Plugin imza gate | `include/plugin/caelus_plugin_registry.h` (DynamicPluginLoader) | ✅ **Tamam** (set_signature_verifier + verify + strict-fail + dev bypass) |
| 6 | T-19 KEYMGMT (DPAPI + env + magic) | `src/network/mesh_auth.rs`, `include/plugin/caelus_plugin_abi.h` | ✅ **Tamam** (Windows DPAPI blob + migrate + POSIX yasak + test) |
| 7 | T-20 Outage latching state machine | `include/causal_engine.h` (`latch_outage`, `clear_outage_recovery`, `check_hysteresis`, `check_deadlines`, `build_snapshot`) | ✅ **Tamam** (motor latched; golden yenileme kalan — T-25) |
| 8 | T-21 Connector smoke testi (MQTT + Zapier) | `tests/connector_smoke.py`, `ci.bat` (Adım 3/6) | ✅ **Tamam** (kendi C++ harness'ı + mini broker + loopback POST) |
| 9 | T-22 Toolchain matrisi / build portability | `build.bat` (CAELUS_CXX/MSVC fallback/preflight), `CMakeLists.txt` (crypt32) | ✅ **Tamam (script)** (çoklu-toolchain fiili koşum kanıtlanmadı) |
| 10 | Dinamik plugin loader | `include/plugin/caelus_plugin_registry.h` | ◑ Yazıldı + gate var, ama **bağlanmadı** (T-17) |
| 11 | CONN-RT gerçek connector'lar | `include/plugin/caelus_connector.h`, `core_engine.cpp` | ✅ (v4'ten korundu; artık smoke testli — T-21) |
| 12 | SIG-CI + dinamik connector tamponu | `ci.bat`, `include/plugin/caelus_connector.h` | ✅ (v4'ten korundu) |
| 13 | T-13 WS çalışma-zamanı limitleri | `include/ws_emitter.h` | ✅ (v4'ten korundu) |
| 14 | Evrensel UI | `ui/app.js`, `ui/index.html`, `include/ui_payload.h` | ✅ (v4'ten korundu) |
| 15 | BS-EXEC golden süiti | `tests/golden/*`, `tests/run_bs_exec_golden.{bat,py}`, docs | ◑ Var; **latch öncesi davranışı kilitliyor** → yenileme kalan (T-25) |

### 2.1 T-16 — Rust Derleme Kırığı Onarımı (mesh_auth.rs)

v4'te `seed.copy_from_slice(bytes)` → `E0308` (`&[u8]` beklenen yere `Vec<u8>`). Düzeltme:

```rust
// src/network/mesh_auth.rs:148
seed.copy_from_slice(&bytes);
```

**Teyit (çalıştırılarak):**
- `cargo check` → exit 0.
- `cargo test` → 21 lib + 2 bin = **23 test** tamamı PASS (0 failed).
- `cargo build --release` → exit 0; `target/release/caelus_network.lib` (14 098 982 bayt) üretildi.
- ReadLints (mesh_auth.rs, lib.rs, bin/caelus_sign_scenario.rs) → **no linter errors**.

### 2.2 T-9/T-17 — Üretim Signer (FFI + Tam CLI Binary + Kanonik Uyum)

`src/lib.rs` artık `caelus_sign_scenario_payload` FFI'yi export ediyor (eski verify + yeni signing):

```rust
#[no_mangle]
pub extern "C" fn caelus_sign_scenario_payload(
    payload_ptr: *const u8, payload_len: usize,
    seed_ptr: *const u8, seed_len: usize,
    out_signature64: *mut u8, out_pubkey32: *mut u8,
) -> u8 { ... }
```

`src/bin/caelus_sign_scenario.rs` (Cargo.toml [[bin]] ile): kendi strict JSON parser'ı, `canonical_signed_payload_from_json` (C++ ile bit-bit aynı), `load_or_generate_seed` + `--generate-key`, `--write` (senaryoya `ed25519:<pub>:<sig>` yazar), `sign_payload` FFI çağrısı, unit testler (`canonical_payload_matches_cpp_shape`, `fixed_seed_signature_is_deterministic_and_verifier_shaped`).

**Teyit (çalıştırılarak):** `--help` çıktı; gerçek BS-01 kopyası + `--generate-key` → `ed25519:46cd...cf:4c39...03` üretildi; regex `^ed25519:[0-9a-f]{64}:[0-9a-f]{128}$` eşleşti.

### 2.3 T-18 — Plugin İmza Gate (DynamicPluginLoader)

`verify_plugin_signature(path)`: verifier varsa çağır (false → `UNVERIFIED_PLUGIN_REJECTED`); yoksa `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` dev bypass veya `SIGNATURE_REQUIRED` + reject. `load_into_registry` **önce** imzayı denetliyor, sonra LoadLibrary/dlopen + entry + ABI + register. Strict-fail default.

### 2.4 T-19 — KEYMGMT Gerçek (DPAPI + Magic Header + POSIX Env)

`src/network/mesh_auth.rs`: `KEY_FILE_MAGIC = b"CAELUSKEY1\0"`, `KEY_FILE_SCHEME_WIN_DPAPI = b"WIN-DPAPI\0"`. Windows'ta eski 32-byte düz seed okunursa DPAPI blob'a migrate + persist; yeni kimlik DPAPI ile yazılır; `persist` **asla** düz metin yazmaz. POSIX'te plaintext persist reddedilir; yalnız `CAELUS_IDENTITY_KEY_HEX` env. Gerçek DPAPI `#[link(name="crypt32")]` + `#[link(name="kernel32")]` (LocalFree). Test `persistent_identity_is_stable` PASS; `build.bat`/`CMakeLists.txt` `-lcrypt32`/`crypt32` linkliyor.

### 2.5 T-20 — Outage Latching State Machine (causal_engine.h)

v4'te `check_hysteresis()` outage'ı bir **atama** (`outage_ = (perm >= 3.0x)`) ile belirliyor, bu da daha önce perishable-deadline ile açılmış outage'ı **siliyordu**. v5'te `include/causal_engine.h` latched bir durum makinesine geçti:

```cpp
// check_hysteresis(): non-reversible flip
if (!h.reversible) {
    permanent_friction_fp_ = fp_add_saturating(permanent_friction_fp_, h.permanent_loss_fp);
    latch_outage();                       // yalnız LATCH — asla false yapmaz
}

// check_deadlines(): perishable deadline kaçırma
if (node.kind == NodeKind::Perishable) {
    node.irrecoverable = true;
    latch_outage();
}

void latch_outage() noexcept { outage_ = true; }

// apply_lever(): yalnız başarılı recovery lever'ı temizler
if (success && outcome.clear_irrecoverable) clear_outage_recovery();
void clear_outage_recovery() noexcept {
    outage_ = false;
    for (auto& node : nodes_) node.irrecoverable = false;
}
```

`build_snapshot()` `s.outage_active = outage_` ile latch state'i yansıtıyor; outage iken `throughput_ratio = 0.0` ve `summary = "OUTAGE: ..."`. Böylece bir perishable-deadline outage'ı, sonraki non-reversible histerezis flip'i tarafından **silinemiyor**; outage yalnızca açık bir başarılı recovery lever'ıyla kalkıyor. v4'teki T-20 semantik tutarsızlığı **kapandı**.

**Dürüst kalan nüans (T-25):** Bu motor değişikliği golden test dosyalarına **yansıtılmadı** (bkz. 2.8 ve Bölüm 5).

### 2.6 T-21 — Connector Entegrasyon Smoke Testi

`tests/connector_smoke.py` docstring'i ile teyit: harness'ı `include/plugin/caelus_connector.h`'ye karşı derler; `dist/caelus_os.exe` ve dış broker **gerekmez** — ZapierWebhookConnector için loopback HTTP istemci/sunucu yolu, MqttConnector için minimal yerel MQTT 3.1.1 QoS0 broker fixture başlatır. Her iki connector'da event `pull_intel` üzerinden mock `inject_intel` callback'ine kadar doğrulanır (MQTT → JSON payload, Zapier → CSV payload). `ci.bat` Adım 3/6 varsayılan koşar; bulunamazsa FAIL, `CAELUS_SKIP_CONNECTOR_SMOKE=1` ile atlanır.

**Nüans:** Bu, dist binary'den bağımsız, kendi C++ harness'ını derleyen bir connector smoke testidir (tam engine ile uçtan uca değil). Yine de "gerçek broker/loopback POST yok" iddiasını geçersiz kılar.

### 2.7 T-22 — Toolchain Matrisi / Build Portability

`build.bat`: `CAELUS_CXX=GCC|MSVC|g++|cl.exe|<path>` seçimi; `GCC_AVAILABLE`/`MSVC_AVAILABLE`/`GNU_LINKER_AVAILABLE` preflight; GNU Rust target/linker preflight başarısız + MSVC varsa otomatik MSVC fallback (`x86_64-pc-windows-msvc`); `CAELUS_SKIP_CMAKE=1`, `CAELUS_DOCKER=1` (WMIC'siz non-interactive), non-fatal `chcp 65001`. GCC link satırı `-lcrypt32`, MSVC link satırı `crypt32.lib`, `CMakeLists.txt` Windows listesi `crypt32` içeriyor; ayrıca CMakeLists MinGW↔MSVC için `RUST_LIB_PATH`'i ABI'ye göre seçiyor.

**Nüans (T-22 kalıntısı):** Bu makinede yalnız MinGW `g++ 15.2.0` mevcut; MSVC `cl` yok. Dolayısıyla matris **kodda var** ama her iki toolchain'de **fiilen koşulmadı**.

### 2.8 BS-EXEC Golden Süiti — Latch Sonrası Bayat (Yenileme Gerekli)

`tests/run_bs_exec_golden.py` hâlâ latch öncesi semantiği kilitliyor:

```python
# Current CausalEngine semantics: hysteresis only sets outage when accumulated
# permanent friction reaches the 3.0x outage sentinel. These scenarios do not.
EXPECTED_HYSTERESIS_OUTAGE = {
    ("BS-01_SAHTE_UFUK",  "HYST_PERM_REROUTE"):     False,
    ("BS-02_GOLGE_ARSIV", "HYST_PAYROLL_MISS"):     False,
    ("BS-02_GOLGE_ARSIV", "HYST_SUPPLIER_FLIGHT"):  False,
    ("BS-03_KUM_SAATI",   "HYST_BLOKAJ"):           False,
    ("BS-03_KUM_SAATI",   "HYST_TRAFIK_KAYBI"):     False,
}
EXPECTED_SNAPSHOT_HASHES = { "BS-01_SAHTE_UFUK": "43c0...1978", ... }
```

`tests/golden/bs01_expected.json` da `hysteresis_perm_reroute` kilometre taşında `"outage_active": false` ve şu **bayat** notu taşıyor: *"Non-reversible hysteresis permanent_loss_fp is below 3.0x, so it does not create outage. Current check_hysteresis assignment also clears the earlier perishable outage on this tick."* Senaryo dosyaları bu histerezislerin `reversible:false` olduğunu doğruluyor (BS-01 satır 239, BS-02 284/291, BS-03 311). Yeni latched motorda bu flip'ler outage'ı latch ettiği için golden beklentileri (ve normalize snapshot SHA-256 hash'leri) **artık yanlış**; latched davranışa göre yeniden üretilmeli (T-25 / GOLDEN-REFRESH).

---

## 3. Güvenlik Duruşu

### 3.1 İmza Zinciri — Doğrulama + Üretim İmzalama Artık Var

| Yetenek | Durum | Kanıt |
|---|---|---|
| Senaryo imza **doğrulaması** (ed25519) | ✅ Var, zorlanıyor | `scenario_pack.h::verify_signature_gate` + `src/scenario_verify.rs` |
| Kanonik yük üretimi (dış araç için) | ✅ Var | `canonical_signed_payload_from_file` + `--print-scenario-payload` (C++) + Rust CLI |
| Üretim **imzalama** (signer) | ✅ Var | `caelus_sign_scenario_payload` FFI + `caelus_sign_scenario` CLI; `ed25519:<pub>:<sig>` |
| Dev bypass kapısı | ⚠️ Aktif | `SELF_SIGNED_DEV` varsayılan ret; `CAELUS_ALLOW_DEV_SCENARIOS=1` ile kabul |

Üç BS paketi hâlâ `"signature": "SELF_SIGNED_DEV"`; fakat şimdi CLI ile gerçek imza atılıp `--write` ile güncellenebiliyor. SIG-CI negatif testi geçerli.

### 3.2 KEYMGMT Tehdit Modeli — Disk Plaintext Kaldırıldı (Windows)

| Boyut | Hedeflenen | Mevcut gerçek |
|---|---|---|
| Cihaz kimliği diskte | DPAPI/TPM ile korumalı blob | ✅ Windows: DPAPI blob (magic + WIN-DPAPI + len); migrate eski düz seed'lerden |
| Windows | DPAPI sihirli-başlık blob + `crypt32` | ✅ `#[link(crypt32)]` + `CryptProtectData`/`UnprotectData` + `build_key_blob`/`read_key_blob` |
| POSIX | plaintext reddi + env/TPM stub | ✅ plaintext persist yasak; yalnız `CAELUS_IDENTITY_KEY_HEX` env |
| Eklenti kancası | `protect_key`/`unprotect_key` bağlı | ◑ ABI 1.1 kontratı var; **kimlik yoluna (mesh_auth) bağlı değil** (T-23) |

### 3.3 Dinamik Plugin Yükleme — İmza Kapısı Eklendi

`DynamicPluginLoader` artık ABI uyumuna ek olarak opsiyonel signature verifier'ı (veya dev bypass) denetliyor; `load_into_registry` imzayı geçemeyen eklentiyi LoadLibrary öncesi reddediyor. T-18 kapandı; T-17 (wiring) açık olduğu için operasyonel etki sınırlı.

### 3.4 Olumlu Güvenlik Kazanımları (Korunan)

JSON ayrıştırıcı sertliği, sabit nokta taşma-doyması, mesh el sıkışma (ZK slot enforcement), connector sınırları aynen korundu; ek olarak outage artık latched (sessiz toparlanma yok) ve connector hattı smoke testli.

---

## 4. Mevcut Mimari Durum

### 4.1 Güncellenmiş Katman Tablosu

| Katman | Dosya | v4 Durumu | v5 Durumu | Değerlendirme |
|---|---|---|---|---|
| Çekirdek orkestrasyon | `core_engine.cpp` | + payload/blocker, env connector | **+ signer CLI ayrıldı; DPAPI identity load; plugin registry gate** | --plugin hâlâ yok (T-17) |
| Nedensel model | `causal_engine.h` | + logger; outage/histerezis açık | **+ outage latching state machine (latch_outage/clear_outage_recovery)** | ✅ T-20 kapandı; golden yenileme kalan (T-25) |
| Hot-path logger | `caelus_logger.h` | Kapalı-varsayılan | Değişmedi | Üretimde sessiz |
| Senaryo girişi + signer | `scenario_pack.h` + bin | payload helper + blocker | **+ Rust FFI signing + CLI + kanonik uyum** | ✅ Signer operasyonel |
| İmza doğrulama | `scenario_verify.rs` | ed25519-dalek verify | **+ caelus_sign_scenario_payload (sign)** | Verify + sign tam |
| KEYMGMT | `plugin/*` + mesh_auth | ABI 1.1 | **Gerçek DPAPI + magic + POSIX env** | ✅ T-19; ABI↔kimlik wiring kalan (T-23) |
| Dinamik loader + sig gate | `plugin/caelus_plugin_registry.h` | Loader var, sig yok | **+ set_signature_verifier + verify + strict-fail** | ✅ Gate var; wiring yok (T-17) |
| Connector | `plugin/caelus_connector.h` + smoke | Mqtt/Zapier gerçek; test yok | **+ tests/connector_smoke.py + ci.bat Adım 3/6** | ✅ T-21 (kendi harness; tam-engine değil) |
| Build/Toolchain | `build.bat`, `CMakeLists.txt` | MinGW-only, dar | **+ CAELUS_CXX/MSVC fallback/preflight + crypt32** | ✅ T-22 (script); çoklu-toolchain koşum kanıtlanmadı |
| Determinizm + CI | `det_rng.h`, `ci.bat` | SIG-CI 5 adım | **+ connector smoke; 6 adım** | golden latch'e göre yenilenmeli (T-25) |
| Denetim izi / WS / UI | `audit_log.*`, `ws_emitter.h`, `ui/*` | — | Değişmedi | v4'ten korundu |

### 4.2 Teknik Borç Kapanma Matrisi (T-1…T-25)

| # | Risk (kaynak) | v5 Durumu | Açıklama |
|---|---|---|---|
| T-1..T-8, T-10, T-12, T-13 | (v2/v3 borçları) | ✅ Kapalı | v4'ten korundu |
| **T-9** | Signer yok → dev bypass | ✅ **Kapandı** | FFI + CLI + kanonik + test + e2e |
| T-11 | Canonical JSON | ◑ (signer ile aktif) | Artık signer tarafından kullanılıyor |
| T-14 | verifier blake3 | ◑ Geçerli | `verify_audit_log.py` hâlâ blake3 |
| T-15 | REPL determinizm | ◑ Kısmen | golden runner deterministik |
| **T-16** | Rust derleme kırık | ✅ **Kapandı** | `&bytes`; cargo test 23/23, release lib |
| **T-17** | DynamicPluginLoader atıl/bağlanmamış | ◑ **Açık** | Loader + sig gate var; `--plugin` + örnekleme yok |
| **T-18** | Dinamik plugin imza doğrulaması yok | ✅ **Kapandı** | set/verify + strict + dev bypass |
| **T-19** | KEYMGMT yalnız ABI; kimlik plaintext | ✅ **Kapandı (Windows)** | DPAPI blob + magic + migrate; POSIX plaintext yasak |
| **T-20** | Outage ↔ histerezis semantik tutarsızlığı | ✅ **Kapandı** | latched state machine; flip/deadline yalnız latch eder, recovery lever temizler |
| **T-21** | Connector gerçek entegrasyon testi yok | ✅ **Kapandı** | `tests/connector_smoke.py` + ci.bat Adım 3/6 (kendi harness) |
| **T-22** | Binary/toolchain matrisi dar | ✅ **Kapandı (script)** | build.bat CAELUS_CXX/MSVC fallback + CMake crypt32; çoklu-toolchain fiili koşum kanıtlanmadı |
| **T-23** | KEYMGMT ABI kancası kimlik yoluna bağlı değil | ❌ **Açık** | DPAPI Rust tarafında; registry `protect_key`/`unprotect_key` mesh_auth'tan çağrılmıyor |
| **T-24** | BS senaryoları hâlâ SELF_SIGNED_DEV | ◑ **Açık (düşük)** | Signer var; CI'da gerçek imzalı versiyon opsiyonel |
| **T-25** | Golden snapshot'lar latch öncesi davranışı kilitliyor | ❌ **Açık** | `tests/golden/*` + `run_bs_exec_golden.py` latched outage'a göre yeniden üretilmeli |

v4'ten gelen aktif borçlardan **T-9, T-16, T-18, T-19, T-20, T-21, T-22 kapandı**; **T-17 (wiring), T-23 (KEYMGMT wiring), T-25 (golden refresh) açık**; T-22 kalıntısı (çoklu-toolchain fiili koşum) ve T-24 (signed golden) izlenen küçük işler.

---

## 5. Kalan Açıklar ve Yeni Riskler

| # | Risk | Konum | Önem | Açıklama |
|---|---|---|---|---|
| **T-17** | **DynamicPluginLoader atıl** | `caelus_plugin_registry.h`, `core_engine.cpp` | Yüksek | Loader + sig gate hazır; `--plugin` CLI ve örnekleme yok → operasyonel değil. v5'in en büyük fonksiyonel boşluğu. |
| **T-25** | **Golden latch öncesi davranışı kilitliyor** | `tests/golden/*`, `tests/run_bs_exec_golden.py` | Orta | Latched outage motoru golden'a yansıtılmadı; non-reversible flip'lerde `outage_active` artık `true` olmalı; snapshot SHA-256'lar değişti. Golden yeniden üretilmeli + Python beklentileri güncellenmeli. |
| **T-23** | **KEYMGMT ABI kancası ↔ mesh_auth wiring** | `mesh_auth.rs` ↔ registry | Orta | DPAPI gerçek; eklenti KEYMGMT kancası kimlik persist yolundan çağrılmıyor. |
| **T-22-kalıntı** | **Çoklu-toolchain CI fiili koşum** | `build.bat`, `ci.bat`, MSVC ortamı | Orta | Matris script'te var; bu makinede yalnız MinGW. Her iki toolchain'de <50MB + det + SIG-CI + smoke + e2e signed fiilen koşulmalı. |
| **T-24** | **BS senaryoları SELF_SIGNED_DEV** | `scenarios/BS-*.json`, CI | Düşük | Signer ile gerçek imzalı hâle getirilip CI'da dev bypass'sız çalıştırılabilir (opsiyonel). |

### 5.1 Hâlâ Yapılmamış / Yarım Öneriler

- **LOADER-WIRE (T-17):** `--plugin <path>` CLI + `DynamicPluginLoader` örneği + registry bootstrap'ta kullanım (imza gate zaten hazır).
- **GOLDEN-REFRESH (T-25):** Latched outage'a göre `tests/golden/*` snapshot/hash + `run_bs_exec_golden.py` `EXPECTED_HYSTERESIS_OUTAGE`/`EXPECTED_SNAPSHOT_HASHES` yeniden üret; bayat "atama outage'ı siler" notlarını güncelle.
- **KEYMGMT-WIRE (T-23):** Kimlik yolunu registry KEYMGMT kancasına bağla (opsiyonel eklenti; DPAPI zaten Rust tarafında).
- **BUILD-MATRIX-CI (T-22 kalıntı):** MSVC + MinGW her ikisiyle fiili CI koşumu.

---

## 6. Doğrulama / Test Durumu

### 6.1 Çalıştırılan / Okunarak Teyit Edilen Doğrulamalar (bu rapor için)

| Doğrulama | Yöntem | Sonuç |
|---|---|---|
| **Rust birim testleri** | `cargo test` (cargo 1.94.0) | ✅ **23/23 PASS** (21 lib + 2 bin; 0 failed) |
| **Rust derleme** | `cargo check` + `cargo build --release` | ✅ exit 0; `target/release/caelus_network.lib` (14 098 982 B) var |
| **Signer CLI** | `--help` + temp BS-01 kopyası + `--generate-key` | ✅ `ed25519:46cd...cf:4c39...03`; regex `^ed25519:[0-9a-f]{64}:[0-9a-f]{128}$` eşleşti |
| **C++ syntax** | `g++ -std=c++17 -fsyntax-only -I. -Iinclude -Isrc core_engine.cpp src/intel_core.cpp` | ✅ exit 0 (g++ 15.2.0) |
| **ReadLints (Rust)** | `mesh_auth.rs`, `lib.rs`, `bin/caelus_sign_scenario.rs` | ✅ No linter errors |
| **T-20 outage latching** | `include/causal_engine.h` okundu | ✅ `latch_outage`/`clear_outage_recovery`/`check_hysteresis`/`check_deadlines`/`build_snapshot` latched semantik |
| **T-21 connector smoke** | `tests/connector_smoke.py` + `ci.bat` okundu | ✅ harness + mini broker + loopback POST; ci.bat Adım 3/6 |
| **T-22 toolchain** | `build.bat` + `CMakeLists.txt` okundu | ✅ CAELUS_CXX/MSVC fallback + crypt32; MSVC `cl` makinede yok |
| **T-25 golden bayat** | `tests/golden/bs01_expected.json` + `run_bs_exec_golden.py` okundu | ⚠️ latch öncesi `outage_active:false` + sabit hash'ler → yenileme gerekli |
| **Binary varlığı** | `dist/` + `target/release/` | ✅ `dist/caelus_os.exe` + release lib + debug signer exe var |

C++ doctest (9/50 PASS) v4'ten korundu.

### 6.2 Kaynaktan Sayılan Testler

| Süit | Konum | Sayı | Çalıştı mı? |
|---|---|---|---|
| mesh_auth + discovery + audit | `src/network/*.rs` + `audit_log.rs` | 21 | ✅ (cargo test) |
| signer bin (canonical + sig) | `src/bin/caelus_sign_scenario.rs` | 2 | ✅ (cargo test) |
| **Rust toplam** | — | **23** | ✅ |
| C++ doctest | `tests/test_causal_engine.cpp` | 9 vaka / 50 doğrulama | ✅ (v4'ten) |
| Connector smoke | `tests/connector_smoke.py` | 1 harness (MQTT + Zapier) | ◑ Mevcut; bu raporda doğrudan koşulmadı (ci.bat Adım 3/6) |
| BS-EXEC golden | `tests/golden/*`, `run_bs_exec_golden.py` | 3 senaryo | ⚠️ latch sonrası bayat (T-25) |

### 6.3 `ci.bat` Akışı (6 Adım)

1. Rust testleri → ✅ (T-16 onarımı sayesinde).
2. C++ unit tests → ✅.
3. **Connector smoke (MQTT + Zapier)** → yeni; `CAELUS_SKIP_CONNECTOR_SMOKE=1` ile atlanır.
4. Binary boyut (<50MB) → dist exe ile.
5. Determinizm (CDET SHA-256 × 2) → dist exe ile.
6. SIG-CI (negatif imza) → dist exe ile.

> Not: BS-EXEC golden runner (`run_bs_exec_golden.py`) ci.bat dışında ayrıca koşulur ve T-25 nedeniyle latched motorla **uyumsuz** beklentiler taşır; yenilenene kadar latched outage doğrulaması için referans alınmamalıdır.

---

## 7. Sıradaki Yol Haritası

Öncelik: **P0** kritik/itibar · **P1** yüksek · **P2** orta. Efor: S/M/L.

| Kod | İş paketi | Öncelik | Efor | Kapattığı |
|---|---|---|---|---|
| LOADER-WIRE | **DynamicPluginLoader'ı motora bağla** (`--plugin <path>` CLI + örnekleme + registry bootstrap; imza gate hazır) | **P1** | S–M | T-17 |
| GOLDEN-REFRESH | **Golden'ı latched outage'a göre yeniden üret** (`tests/golden/*` snapshot/hash + `run_bs_exec_golden.py` beklentileri + bayat notlar) | **P1** | S–M | T-25 |
| KEYMGMT-WIRE | **Kimlik yolunu KEYMGMT ABI kancasına bağla** (opsiyonel eklenti; DPAPI zaten Rust tarafında) | P1 | S | T-23 |
| BUILD-MATRIX-CI | **Her iki toolchain'de fiili CI koşumu** (MSVC + MinGW; <50MB + det + SIG-CI + smoke + e2e signed) | P2 | M | T-22 kalıntı |
| SIGNED-GOLDEN | BS senaryolarını gerçek imzalı hâle getir (CLI ile) + CI'da dev bypass'sız çalıştır | P2 | S | T-24 |

**Önceki yol haritasından kapananlar:** BUILD-FIX ✅ (T-16), SIGNER ✅ (T-9), PLUGIN-SIG ✅ (T-18), KEYMGMT (DPAPI) ✅ (T-19), **OUTAGE-SEM ✅ (T-20, latching)**, **CONN-IT ✅ (T-21, smoke)**, **BUILD-MATRIX (script) ✅ (T-22)**.

**Önerilen faz sıralaması:**
- **Faz L (fonksiyonel tamamlama — P1):** LOADER-WIRE + GOLDEN-REFRESH. "Yazıldı ama bağlanmadı" ve "motor düzeldi ama golden bayat" borçlarını temizler.
- **Faz M (güvenlik wiring — P1):** KEYMGMT-WIRE.
- **Faz N (kalite/üretim — P2):** BUILD-MATRIX-CI + SIGNED-GOLDEN.

---

## 8. v4 → v5 Değişiklikleri (Kısa Liste)

- T-16: `mesh_auth.rs:148` `&bytes` → derleme yeşil, 23 test, release lib.
- T-9/T-17: `caelus_sign_scenario_payload` FFI (lib.rs) + `caelus_sign_scenario` CLI bin (Cargo [[bin]], tam kanonik parser + signer + --generate-key --write) + unit + e2e; C++ `scenario_pack.h` ile uyumlu.
- T-18: `caelus_plugin_registry.h::DynamicPluginLoader` içine `set_signature_verifier` + `verify_plugin_signature` + `CAELUS_PLUGIN_ALLOW_UNVERIFIED=1` dev bypass + strict-fail default.
- T-19 KEYMGMT: Windows DPAPI + `CAELUSKEY1\0WIN-DPAPI\0` magic + u32 len + blob + migrate; POSIX plaintext yasak + yalnız `CAELUS_IDENTITY_KEY_HEX`; tests güncellendi; build.bat/CMakeLists crypt32.
- **T-20: `causal_engine.h` outage latching state machine** (`latch_outage`/`clear_outage_recovery`; check_hysteresis/check_deadlines yalnız latch; recovery lever temizler; build_snapshot yansıtır). v4'teki "atama siler" tutarsızlığı giderildi.
- **T-21: `tests/connector_smoke.py`** (C++ harness + mini MQTT broker + loopback Zapier POST; pull_intel→inject_intel doğrulama) + `ci.bat` Adım 3/6 (CAELUS_SKIP_CONNECTOR_SMOKE).
- **T-22: `build.bat` toolchain matrisi** (CAELUS_CXX seçimi, MSVC fallback, GNU target preflight, CAELUS_SKIP_CMAKE/CAELUS_DOCKER) + CMakeLists MinGW/MSVC RUST_LIB_PATH + crypt32.
- Cargo.toml: `[[bin]]`; build.bat: `-lcrypt32`.
- **Yeni izlenen kalan iş:** T-25 (golden latched outage yenilemesi), T-23 (KEYMGMT wiring), T-22 kalıntı (çoklu-toolchain fiili koşum), T-17 (loader wiring).
- Doğrulamalar: ReadLints temiz; CLI e2e regex PASS; g++ syntax PASS; 23/23 test; T-20/21/22 disk üzerinden yeniden okunarak teyit.

---

## 9. Ek: v1 → v2 → v3 → v4 → v5 İzlenebilirlik Matrisi

| Öneri / Borç | v1 | v2 | v3 | v4 (teyit) | v5 (teyit) | Kanıt |
|---|---|---|---|---|---|---|
| R1 Causal Engine v2 | öneri | ✅ | ✅ | ✅ (+ logger) | ✅ (+ outage latching) | `causal_engine.h`, `caelus_logger.h` |
| R2 Senaryo Paketi | öneri | ✅ | ✅ (imza) | ✅ (+ payload) | ✅ (+ signer FFI/CLI) | `scenario_pack.h`, `src/bin/...` |
| R3 UI canlı köprü | öneri | ✅ | ✅ | ✅ | ✅ | `ws_emitter.h`, `ui/*` |
| R4 Eklenti SDK | öneri | ✅ (stub) | ◑ | ◑ (ABI+KEYMGMT+loader) | ◑ (loader + sig gate; wiring yok) | `include/plugin/*` |
| R5 Determinizm | öneri | ✅ | ✅ | ✅ (+ session_id=0) | ✅ | `det_rng.h`, `core_engine.cpp` |
| R6 Denetim günlüğü | öneri | ✅ | ✅ | ✅ | ✅ | `audit_log.rs`, `verify_audit_log.py` |
| R7 C++ test + CI | öneri | ◑ | ✅ | ✅ (+ SIG-CI) | ✅ (+ connector smoke) | `tests/*`, `ci.bat` |
| R8 Connector'lar | öneri | ✗ | ◑ | ✅ (Mqtt/Zapier) | ✅ (smoke testli — T-21) | `caelus_connector.h`, `connector_smoke.py` |
| R9 CLI REPL | öneri | ✗ | ✅ | ✅ (+ json/golden) | ✅ | `core_engine.cpp`, `tests/golden/*` |
| R10 Güvenlik sertleştirme | öneri | ✗ | ◑ | ◑ (KEYMGMT ABI) | ✅ (DPAPI + signer + plugin-sig) | `mesh_auth.rs`, signer, registry |
| T-8 cout log | — | — | açık | ✅ kapandı | ✅ | `caelus_logger.h` |
| T-9 signer | — | — | açık | ❌ açık | ✅ **kapandı** | `src/lib.rs` + `src/bin/...` + e2e |
| T-10 CDET session_id | — | — | açık→kapandı | ✅ | ✅ | `core_engine.cpp` |
| T-11 canonical JSON | — | — | açık | ◑ atıl | ◑ (signer ile aktif) | `scenario_pack.h` + CLI |
| T-12 connector 256 | — | — | açık | ✅ | ✅ | `caelus_connector.h` |
| T-13 WS 8-istemci | — | — | açık | ✅ | ✅ | `ws_emitter.h` |
| T-14 verifier blake3 | — | — | açık | ◑ | ◑ | `verify_audit_log.py` |
| T-15 REPL determinizm | — | — | açık | ◑ | ◑ | golden |
| **T-16 derleme kırık** | — | — | — | 🔴 yeni/açık | ✅ **kapandı** | `mesh_auth.rs` + cargo test 23/23 |
| **T-17 loader bağlanmadı** | — | — | — | açık | ◑ (gate var; wiring yok) | `caelus_plugin_registry.h`, `core_engine.cpp` |
| **T-18 plugin imza** | — | — | — | açık | ✅ **kapandı** | DynamicPluginLoader verify |
| **T-19 KEYMGMT (DPAPI)** | — | — | — | açık | ✅ **kapandı** | `mesh_auth.rs` + magic + tests |
| **T-20 outage↔histerezis** | — | — | — | açık | ✅ **kapandı** (latching) | `causal_engine.h` latch_outage/clear_outage_recovery |
| **T-21 connector gerçek test** | — | — | — | açık | ✅ **kapandı** | `tests/connector_smoke.py`, `ci.bat` |
| **T-22 binary/toolchain** | — | — | — | açık | ✅ **kapandı (script)** | `build.bat` CAELUS_CXX/MSVC, `CMakeLists.txt` crypt32 |
| **T-23 KEYMGMT wiring** | — | — | — | — | ❌ açık | registry ↔ `mesh_auth.rs` |
| **T-24 signed golden** | — | — | — | — | ◑ açık (düşük) | `scenarios/BS-*.json` |
| **T-25 golden latch refresh** | — | — | — | — | ❌ açık | `tests/golden/*`, `run_bs_exec_golden.py` |

---

*Bu rapor, mevcut kaynak ağacındaki gerçek dosya ve sembollere dayanır ve mümkün olan yerlerde çalıştırılarak (`cargo check` exit 0; `cargo test` 23/23 PASS; `cargo build --release` lib üretimi; CLI signer e2e regex PASS; g++ fsyntax-only exit 0; ReadLints temiz) ve son üç onarım için disk üzerinden yeniden okunarak (causal_engine.h latched outage; connector_smoke.py + ci.bat; build.bat + CMakeLists toolchain) teyit edilmiştir. "✅ Kapandı" işaretli her madde için kanıt dosyası/komut çıktısı verilmiştir; "◑/❌" işaretli maddeler Bölüm 5 ve 7'de kalan iş olarak izlenir. En kritik kazanımlar: (1) ağaç derleniyor ve 23 test yeşil; (2) T-9 signer FFI+CLI üretildi, kanonik C++ ile uyumlu, e2e doğrulandı; (3) T-19 KEYMGMT Windows'ta gerçek DPAPI + magic blob + migrate, POSIX'te plaintext yasak; (4) T-18 plugin imza gate (strict + dev bypass); (5) T-20 outage artık latched (perishable deadline / non-reversible flip yalnız latch eder, yalnız başarılı recovery lever temizler); (6) T-21 connector smoke testi (kendi C++ harness); (7) T-22 toolchain matrisi build.bat/CMakeLists'te. Kalan en büyük boşluklar: loader'ın motora bağlanması (T-17), latched outage'a göre golden yenilemesi (T-25), KEYMGMT↔mesh wiring (T-23) ve çoklu-toolchain fiili CI koşumu (T-22 kalıntısı).*
