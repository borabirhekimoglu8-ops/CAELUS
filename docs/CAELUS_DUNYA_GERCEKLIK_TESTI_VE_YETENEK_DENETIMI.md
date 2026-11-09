# CAELUS Dünya Etki Motoru — Gerçeklik Testi, 12 Yetenek Denetimi ve Güvenilir Veri Mimarisi Raporu

- **Depo:** `https://github.com/borabirhekimoglu8-ops/CAELUS`
- **Baz Alınan `origin/main` Commit:** `51d8515bf7b64c125ac4d6d1ed58cb4537c2d7c2` (`2026-04-11T09:50:19+03:00`, PR #15)
- **Çalışma Dalı:** `feat/caelus-world-reality-validation`
- **Kullanıcı Verisi Koruma (`caelus_world_store.json` SHA-256):**
  - Çalışma Öncesi: `4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1`
  - Çalışma Sonrası: `4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1` (**Değiştirilmedi**)

---

## 1. Yönetici Özeti

Bu mühendislik denetimi ve doğrulama çalışmasında CAELUS Dünya Etki Motoru (`CAELUS World Impact Engine`) dört bütünleşik iş paketinde incelenmiş, güçlendirilmiş ve uçtan uca test edilmiştir:

1. **`main` Dalı ve iPhone War Room Yayın Doğrulaması (Aşama 1):**
   - `origin/main` (`51d8515`) üzerindeki ana CI iş akışı (`CI — Build, Test & Verify`, Run ID `24277199911` / Job `42602370824`) **PASS** durumundadır (`ubuntu-latest` ve `windows-latest` derleme, test ve çapraz işletim sistemi determinizm karşılaştırması başarılı).
   - Aynı commit üzerinde çalışan `Deploy iPhone War Room` (`pages.yml`, Run ID `24277199907` / Job `42603014938`) iş akışı ise `Validate universal scenario compiler` adımında **FAIL** olmuştur (`pass 52, fail 2`).
   - **Kök Neden:** `pages.yml` iş akışı yalnızca tarayıcı `wasm32-unknown-unknown` ikilisini (`caelus_wasm.wasm`) derlemekte, yerel Linux `dist/caelus_os` C++17 yürütülebilir dosyasını derlememektedir. Buna karşılık `tests/universal_scenario_compiler.test.mjs` içindeki `Test 36` ve `Test 37` doğrudan yerel `dist/caelus_os` ikilisini zorunlu tutmaktaydı.
   - **Uygulanan Düzeltme:** Testler sessizce devre dışı bırakılmadan; ana CI (`ci.yml`) ortamında `CAELUS_REQUIRE_NATIVE_BIN=1` ile yerel `dist/caelus_os` ikilisi zorunluluğu korundu; yalnızca WASM derleyen `pages.yml` ortamında ise `CAELUS_WASM_ONLY: "1"` tanımlanarak `Test 36`’nın derlenen gerçek `caelus_wasm.wasm` ikilisi (`runWasmCounterfactualEquivalence`) üzerinden deterministik A/B karşılaştırmasını doğrulaması sağlandı, yerel dosya sistemi REPL kesinti testi olan `Test 37` ise açık gerekçeli `t.skip(...)` mesajıyla işaretlendi.

2. **12 Yeteneğin Kod, Test, Veri, Arayüz ve Kanıt Denetimi (Aşama 2):**
   - `ui/scenario_compiler.js`, `caelus_core/src/lib.rs`, `caelus_wasm/src/lib.rs`, `src/causal_engine.hpp` ve `ui/app.js` içindeki 12 yetenek tek tek incelenmiştir.
   - Her yeteneğin gerçekte hangi matematiksel/algoritmik yöntemi uyguladığı (ör. `learnTemporalGraphInteractions` içinde Ridge-düzenlileştirilmiş AR(1) en küçük kareler; `discoverLagAwareCausalGraph` içinde gecikmeli kısmi korelasyon taraması ve doğrusal SEM; `runJepaStyleLatentPredictor` içinde deterministik doğrusal enkoder-tahminci prototipi) abartısız olarak belgelenmiştir.

3. **Dış Veri Katmanı ile Çevrim Dışı Deterministik Çekirdeğin Açık Ayrımı (Aşama 3):**
   - **Katman A (`ingestFromExternalDataLayer`, `EXTERNAL_DATA_INGESTION_LAYER_CATALOG`):** Ağ erişimi ve dış veri normalizasyonu yalnızca bu katmanda açık izinle çalışır.
   - **Katman B (`buildVerifiedCoreDataPackage`, `verifyCoreDataPackageIntegrity`):** Her kayıt için 13 zorunlu alanı (`sourceId`, `sourceType`, `licenseAndUsagePolicy`, `eventTimeIso`, `availableAtSourceTimeIso`, `ingestedAtSystemTimeIso`, `normalizationRulesApplied`, `unitAndScale`, `knowledgeCategory`, `confidenceScoreAndJustification`, `conflictStatus`, `rawPayloadSha256`, `normalizedRecordSha256`), çift zamanlı kesim sızıntısını ve paket bütünlük özetini (`packageIntegritySha256`) denetler.
   - **Katman C (`runOfflineDeterministicCoreWithPackage`):** Dış ağ API’lerini (`fetch`, `XMLHttpRequest`, `WebSocket`, `http`, `https`) çalışma süresince mühürler, bütünlük özeti bozulmuş (`PACKAGE_INTEGRITY_HASH_MISMATCH`) veya geçerli kaydı olmayan paketleri fail-closed reddeder ve sabit tohumlu (`seed`) tekrar çalıştırmada bit-özdeş çıktı üretir.

4. **Gerçek Tarihsel Olay Üzerinde Uçtan Uca Dünya Etki Motoru Gerçeklik Testi (Aşama 4–9):**
   - **Vaka:** **15–19 Şubat 2021 Teksas (ERCOT) Kış Fırtınası Uri Elektrik Şebekesi Çöküşü → Austin Yarı İletken Fabrikaları (Samsung Austin S2, NXP Oak Hill/ATMC, Infineon Austin) → Küresel Otomotiv Mikrodenetleyici (MCU) Tedarik Zinciri ve Şirket Finansmanı** (`REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO`).
   - **Karar Kesim Zamanı (`cutoffTimeIso`):** `2021-02-17T18:00:00.000Z`.
   - Kesim öncesi birincil kaynaklar kabul edilmiş; kesim sonrası yayınlanan kaynaklar (`2021-03-17` NXP resmi gelir etkisi açıklaması ve `2021-11-16` FERC/NERC nihai geriye dönük kök neden raporu) çift zamanlı kapı tarafından otomatik olarak dışlanmıştır (`excludedPostCutoffCount = 2`).
   - 3 senaryo (`S1` Müdahalesiz Bireysel Stokçuluk, `S2` Koordineli Korumalı Mikro-Şebeke + Otomotiv MCU Önceliklendirmesi, `S3` Artçı Soğuk Hava Dalgası + Trafo Arızası) aynı deterministik motorla çalıştırılmış, kesim sonrası gerçekleşen gerçek dünya sonuçları (`evaluatePostCutoffRealityComparison`) ve 4 basit referans yöntem (`evaluateSimpleForecastingBaselines`) ile yan yana karşılaştırılmıştır.

---

## 2. Başlangıç Envanteri (Aşama 0)

| Envanter Kalemi | Tespit Edilen Gerçek Durum |
|---|---|
| **Aktif Git Dalı (Başlangıç -> Çalışma)** | Başlangıçta `main` -> `origin/main` üzerinden `feat/caelus-world-reality-validation` oluşturuldu |
| **Çalışma Ağacı Durumu (Başlangıç)** | Temiz (`git status --short` boş) |
| **`origin/main` Güncel Commit ve Tarihi** | `51d8515bf7b64c125ac4d6d1ed58cb4537c2d7c2` (`2026-04-11 09:50:19 +0300`) |
| **Son Birleştirilen PR’lar** | PR #15 (`51d8515`, Dünya Etki Motoru ve İkiz Katmanlı Bitemporal Kapı), PR #13 (`d82c775`), PR #11 (`84c65fb`), PR #10 (`04f478d`), PR #9 (`876e179`), PR #8 (`2cf4109`) |
| **Açık PR’lar (Başlangıç)** | Yok (`0` açık PR) |
| **Kullanıcı Verisi / Durum Dosyaları** | `caelus_world_store.json` (SHA-256: `4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1`) |
| **İşletim Sistemi** | Windows 10.0.19045 (`win32 x64`, PowerShell) |
| **Araç Zinciri Sürümleri** | Node.js `v24.13.0`, Rust `rustc 1.93.1 (01f6ddf75 2026-02-11)`, Cargo `1.93.1`, C++ `g++ 13.2.0` (MinGW-W64), Python `3.11.9` |
| **Mevcut Derleme Yöntemleri** | `ci.bat`, `Makefile`, `cargo build --manifest-path caelus_core/Cargo.toml`, `cargo build --target wasm32-unknown-unknown --manifest-path caelus_wasm/Cargo.toml`, `python tools/build_standalone.py` |
| **CI ve Yayın İş Akışları** | `.github/workflows/ci.yml` (Linux + Windows + Determinism Gate) ve `.github/workflows/pages.yml` (iPhone War Room GitHub Pages) |
| **Çevrim Dışı Çalışma Sınırları** | `caelus_core` (`#![no_std]`), C++17 `src/causal_engine.hpp` ve `caelus_wasm` tamamen çevrim dışıdır; `CAELUS_OFFLINE_ONLY=1` ortam değişkeni dış ağ testlerini kapatır |

---

## 3. Main Dalı ve GitHub Actions Durumu (Aşama 1.1)

Güncel `origin/main` commit’i (`51d8515bf7b64c125ac4d6d1ed58cb4537c2d7c2`) için GitHub Actions API üzerinden doğrulanan gerçek iş akışı durumları:

| İş Akışı / Hat | Commit | Run / Job Bağlantısı | Çalışma Zamanı (UTC) | Durum | Ayrıntı / Hata Analizi |
|---|---|---|---|---|---|
| **Linux Test ve Derleme Hattı (`CI (ubuntu-latest)`)** | `51d8515` | `https://github.com/borabirhekimoglu8-ops/CAELUS/actions/runs/24277199911/job/42602370824` | `2026-04-11T06:50:28Z` – `06:51:50Z` (82 sn) | **SUCCESS (`pass`)** | C++17 birim testleri, Rust `caelus_core` birim + proptest, WASM derleme, 60 senaryo derleyici testi ve golden vektörler geçti. |
| **Windows / MSVC Test ve Derleme Hattı (`CI (windows-latest)`)** | `51d8515` | `https://github.com/borabirhekimoglu8-ops/CAELUS/actions/runs/24277199911` | `2026-04-11T06:50:28Z` – `06:53:46Z` | **SUCCESS (`pass`)** | `ci.bat` üzerinden MSVC/MinGW derlemesi, Rust ve Node.js testleri geçti. |
| **Linux ile Windows Deterministik Çıktı Karşılaştırması (`Cross-OS Determinism Gate`)** | `51d8515` | `https://github.com/borabirhekimoglu8-ops/CAELUS/actions/runs/24277199911` | `2026-04-11T06:53:47Z` – `06:54:01Z` | **SUCCESS (`pass`)** | `signature_ubuntu-latest.txt` ile `signature_windows-latest.txt` bit-özdeş doğrulandı. |
| **WASM Derleme ve Test Hattı** | `51d8515` | `https://github.com/borabirhekimoglu8-ops/CAELUS/actions/runs/24277199911` | `2026-04-11T06:50:28Z` | **SUCCESS (`pass`)** | `caelus_wasm.wasm` derlendi ve `tests/universal_wasm_scenario.test.mjs` geçti. |
| **iPhone War Room / GitHub Pages Yayın Hattı (`Deploy iPhone War Room`)** | `51d8515` | `https://github.com/borabirhekimoglu8-ops/CAELUS/actions/runs/24277199907/job/42603014938` | `2026-04-11T06:50:28Z` – `06:51:20Z` (52 sn) | **FAILURE (`fail`)** | `Validate universal scenario compiler` adımında `Test 36` ve `Test 37` yerel `dist/caelus_os` ikilisini bulamadığı için başarısız oldu (`deploy` işi `skipped` kaldı). |

---

## 4. iPhone War Room Yayın Denetimi ve Düzeltmeler (Aşama 1.2)

### 4.1. Kök Neden Tespiti
- [`.github/workflows/pages.yml`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/.github/workflows/pages.yml#L34-L53) yalnızca tarayıcıda çalışan `caelus_wasm.wasm` ikilisini derlemekte (`cargo build --release --locked --target wasm32-unknown-unknown --manifest-path caelus_wasm/Cargo.toml`) ve `python tools/build_standalone.py` ile tek dosyalık/statik GitHub Pages paketini üretmektedir.
- [`tests/universal_scenario_compiler.test.mjs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/tests/universal_scenario_compiler.test.mjs#L2762-L2902) içindeki:
  - **Test 36 (`Planner Default JS CausalEngine Mirror vs Real Native dist/caelus_os.exe Counterfactual Equivalence`):** Yerel `dist/caelus_os` ikilisi yoksa `assert.fail(...)` fırlatmaktaydı.
  - **Test 37 (`Executable dist/caelus_os.exe Save Safety Across All 4 Interruption Stages`):** Yerel C++17 REPL sürecini (`spawnSync`) başlatıp dosya sistemine `save_world`/`load_world` yazmaktaydı.

### 4.2. Uygulanan Mühendislik Düzeltmesi
1. [`tests/universal_scenario_compiler.test.mjs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/tests/universal_scenario_compiler.test.mjs#L42-L148):
   - `hasNativeCaelusBinary()` ve `runWasmCounterfactualEquivalence(scenarioPack, interventionId)` yardımcı fonksiyonları eklendi.
   - `CAELUS_REQUIRE_NATIVE_BIN=1` (Ana CI `ci.yml` ortamı) aktifken yerel `dist/caelus_os` ikilisi zorunluluğu **hiçbir zayıflatma olmadan** korundu.
   - `CAELUS_WASM_ONLY=1` (`pages.yml` WASM yayın ortamı) aktifken ve yerel C++17 ikilisi derlenmemişken:
     - **Test 36:** Yerel ikili yerine derlenen gerçek `caelus_wasm/target/wasm32-unknown-unknown/release/caelus_wasm.wasm` ikilisini yükleyerek JS `CausalEngine` aynası ile Rust/WASM çekirdeğinin deterministik A/B karşı-olgusal eşdeğerliğini doğrular.
     - **Test 37:** Tarayıcı WASM kum havuzunda yerel işletim sistemi süreç kesintisi (`SIGINT`/dosya sistemi `save_world`) bulunmadığını açıkça belirterek `t.skip(...)` ile raporlar; aynı test `ci.yml` üzerinde hem Linux hem Windows’ta `CAELUS_REQUIRE_NATIVE_BIN=1` ile zorunlu olarak çalışır.
2. [`.github/workflows/pages.yml`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/.github/workflows/pages.yml#L50-L96):
   - `Validate universal scenario compiler` adımına `CAELUS_WASM_ONLY: "1"` eklendi.
   - `Validate deploy artifact` adımına `caelus-world-impact-engine-workspace` ve `REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO` varlık kontrolleri eklendi.

---

## 5. 12 Yetenek Denetim Tablosu (Aşama 2 — Özet Matris)

Aşağıdaki tablo CAELUS’ta yer alan 12 yeteneğin güncel kod, test, veri, arayüz ve kanıt durumunu özetlemektedir:

| # | Yetenek Adı | KOD DURUMU | TEST DURUMU | VERİ DURUMU | ARAYÜZ DURUMU | KANIT DURUMU | Birincil Dosya, Fonksiyon ve Test Referansları |
|---|---|---|---|---|---|---|---|
| **1** | **Zamansal Dünya Hafızası (Bitemporal World Memory)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Gerçek dünya karşılaştırması yapılmış | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13083-L13345) (`createTemporalWorldMemoryStore`, `addTemporalMemoryRecord`, `reconstructWorldStateAt`); [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L646-L796); Testler: `Test 51`, `Test 52`, `Test 57`, `Test 58`, `Test 61`, `Test 62` |
| **2** | **Zamansal Grafik Öğrenme (Temporal Graph Learning)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13351-L13542) (`learnTemporalGraphInteractions`, `evaluateTemporalGraphLinkPrediction`, `evaluateSimpleForecastingBaselines`); [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L735-L760); Testler: `Test 52`, `Test 60`, `Test 61`, `Test 62` |
| **3** | **Nedensel Keşif ve Duyarlılık Analizi (Causal Discovery & Sensitivity)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13547-L13684) (`discoverLagAwareCausalGraph`, `estimateCounterfactualTreatmentEffect`); Testler: `Test 53`, `Test 60`, `Test 61` |
| **4** | **Çok Adımlı Projeksiyon ve Dağılım Dışı Durum Tespiti (Rollout & OOD)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Gerçek dünya karşılaştırması yapılmış | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13689-L13815) (`runMultiStepWorldRollout`), [`src/causal_engine.hpp`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/src/causal_engine.hpp#L628-L804), [`caelus_core/src/lib.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/src/lib.rs#L1140-L1280); Testler: `Test 53`, `Test 60`, `Test 61` |
| **5** | **Gizli Durum / JEPA Benzeri Temsil (Latent State Prototype)** | İskelet (Deterministik Doğrusal Prototip) | Birim ve entegrasyon testi var | Gerçek veri ile çalıştırılmış | Kısmi bağlantı (İş akışı içinde çalışır) | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13821-L13936) (`runJepaStyleLatentPredictor`); Testler: `Test 53`, `Test 56` |
| **6** | **Çok Aktörlü Simülasyon (Multi-Actor Domain Simulation)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Gerçek dünya karşılaştırması yapılmış | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13942-L14084) (`runMultiActorDomainSimulation`); [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L714-L744); Testler: `Test 54`, `Test 60`, `Test 61` |
| **7** | **Çok Modelli Belirsizlik Birleştirme (Multi-Model Uncertainty Fusion)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14090-L14205) (`combineMultiModelEnsembleWithCalibration`); Testler: `Test 54`, `Test 60`, `Test 61` |
| **8** | **Müdahale ve Politika Arama (Intervention & Policy Search)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Gerçek dünya karşılaştırması yapılmış | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14211-L14338) (`searchOptimalInterventionPolicies`); [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L714-L734); Testler: `Test 54`, `Test 60`, `Test 61` |
| **9** | **Biçimsel Doğrulama ve Değişmezler (Formal Verification & Invariants)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14344-L14474) (`verifyWorldModelFormalInvariants`), [`caelus_core/tests/invariant_sweep.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/tests/invariant_sweep.rs#L1-L120), [`caelus_core/tests/proptest_invariants.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/tests/proptest_invariants.rs#L1-L150); Testler: `Test 55`, `Test 61` |
| **10** | **Parametre Tarama ve Hızlandırma (Parameter Sweep & Research Layer)** | Çalışan uygulama (Tek İş Parçacıklı CPU Döngüsü) | Entegrasyon testi var | Gerçek veri ile çalıştırılmış | Kısmi bağlantı (İş akışı ve ölçek bütçe kapısı) | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14480-L14585) (`runAcceleratedParameterSweep`, `checkWorldGraphScaleBudget`); Testler: `Test 55`, `Test 58`, `Test 62` |
| **11** | **Sürümlü Veri ve Anlık Görüntü Deposu (Versioned Snapshot Store)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14591-L14699) (`createVersionedMultimodalStore`, `commitDatasetVersionSnapshot`, `verifyAndReplayVersionSnapshot`); Testler: `Test 55`, `Test 60`, `Test 61`, `Test 62` |
| **12** | **Sembolik Doğrulayıcı ve Ajan Yetki Sınırları (Symbolic Verifier & Agent Gate)** | Çalışan uygulama | Uçtan uca test var | Gerçek veri ile çalıştırılmış | Kullanıcı akışında çalışıyor | Teknik olarak tekrar üretilebilir | [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L12945-L13077) ve [`#L14705-L14830`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14705-L14830) (`executeAgentBoundaryAction`, `promoteToCoreScenarioPackWithAgentGate`, `runNeuroSymbolicVerificationPipeline`); Testler: `Test 51`, `Test 55`, `Test 59`, `Test 61`, `Test 62` |

---

## 6. 12 Yetenek Ayrıntılı Teknik İncelemesi (Aşama 2)

### Yetenek 1 — Zamansal Dünya Hafızası (`Temporal World Memory`)
- **Uygulanan Gerçek Algoritma:** 3 zaman eksenli (`validFromIso`/`validToIso`, `availableAtSourceTimeIso`, `learnedTimeIso`) çift zamanlı (bitemporal) kayıt defteri, 13 kavram tipi (`Entity`, `StateVariable`, `Event`, `Observation`, `Claim`, `Relation`, `MechanismHypothesis`, `Intervention`, `Constraint`, `ScenarioBranch`, `OutcomeMetric`, `EvidenceLink`, `UncertaintyRecord`), `parseStrictIsoTimestamp` ile takvim taşması (`2026-02-30`) reddi, kaynak tekilleştirme ve çelişki kümeleme (`conflictRegistry`).
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L12665-L13345) (`parseStrictIsoTimestamp`, `classifyAndValidateKnowledgeRecord`, `createTemporalWorldMemoryStore`, `addTemporalMemoryRecord`, `reconstructWorldStateAt`).
- **Veri Durumu:** Hem sentetik senaryolar hem de 30 Ekim 2020 Ege Depremi ve 15–19 Şubat 2021 Teksas ERCOT → Austin Yarı İletken → Otomotiv gerçek tarihsel vakalarıyla çalıştırılmıştır.
- **Arayüz ve Çekirdek Bağlantısı:** `#caelus-world-impact-engine-workspace` içinde `#wie-cutoff-input` ve `#wie-card-knowledge` kartına doğrudan bağlıdır; kabul edilen durum vektörleri C++17/Rust/WASM çekirdeğine aktarılır.
- **Mevcut Testler ve Kanıt:** `Test 51`, `Test 52`, `Test 57`, `Test 58`, `Test 61`, `Test 62`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Hafıza deposu bellek içi (in-memory) JSON yapıdadır; milyonlarca kayıt için disk tabanlı LSM/B-Tree indeksleme yoktur (`checkWorldGraphScaleBudget` 2.500 düğüm / 10.000 kenar üzerinde açık uyarı verir).
- **Sonraki Geliştirme:** SQLite/DuckDB tabanlı kalıcı çift zamanlı indeks katmanı.

### Yetenek 2 — Zamansal Grafik Öğrenme (`Temporal Graph Learning`)
- **Uygulanan Gerçek Algoritma:** Derin öğrenme / Transformer **değildir**. Düğümler arası gecikmeli etkileşim matrisini öğrenmek için Ridge-düzenlileştirilmiş (`l2Penalty`) birinci dereceden otoregresif doğrusal en küçük kareler (`AR(1) Ridge OLS`) ve zaman sıralı eğitim/doğrulama/test bölünmesi uygular. Ayrıca 4 basit referans yöntemle (`LAST_KNOWN_VALUE`, `SIMPLE_LINEAR_TREND`, `MOVING_AVERAGE`, `SIMPLE_GRAPH_THRESHOLD_RULE`) yan yana MAE/RMSE karşılaştırması yapar.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13351-L13542) (`learnTemporalGraphInteractions`, `evaluateTemporalGraphLinkPrediction`, `evaluateSimpleForecastingBaselines`).
- **Veri ve Arayüz Durumu:** Gerçek tarihsel kesit serileri üzerinde çalışır; `#wie-card-scenarios` altında referans yöntem karşılaştırma tablosu olarak kullanıcıya gösterilir.
- **Mevcut Testler:** `Test 52`, `Test 60`, `Test 61`, `Test 62`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Doğrusal olmayan yüksek dereceli rejim geçişlerini yakalayamaz; örneklem sayısı az olduğunda basit referans yöntemler (`LAST_KNOWN_VALUE` veya `MOVING_AVERAGE`) daha düşük hata verebilir ve sistem bunu gizlemeden raporlar (`honestAssessmentTr`).
- **Sonraki Geliştirme:** Parçalı doğrusal (piecewise-linear) eşik regresyonu ve çevrim dışı doğrulanmış ağırlık şeması.

### Yetenek 3 — Nedensel Keşif ve Duyarlılık Analizi (`Causal Discovery & Sensitivity`)
- **Uygulanan Gerçek Algoritma:** Kesin nedensellik kanıtlayıcısı **değildir**. Zaman gecikmeli (`lag`) çapraz korelasyon ve üçüncü değişken koşullu kısmi korelasyon elemesi (`discoverLagAwareCausalGraph`) ile aday yönlü kenarları (`CANDIDATE_CAUSAL_HYPOTHESIS`) çıkarır; doğrusal yapısal denklem modeli (SEM) üzerinde analitik `do(X = x)` müdahale farkı ve gözlenmeyen karıştırıcı duyarlılık sınırı (`Rosenbaum-style sensitivity bound`) hesaplar (`estimateCounterfactualTreatmentEffect`).
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13547-L13684).
- **Veri ve Arayüz Durumu:** Gerçek vaka serileriyle çalıştırılmıştır; tüm çıktılar `CANDIDATE_CAUSAL_HYPOTHESIS` ve `requiresDomainValidation: true` etiketi taşır.
- **Mevcut Testler:** `Test 53`, `Test 60`, `Test 61`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Gözlemsel zaman serisinden tam nedensel özdeşleştirme (identifiability) yalnızca güçlü varsayımlar altında mümkündür; bu nedenle korelasyon asla kanıtlanmış nedensellik olarak sunulmaz.
- **Sonraki Geliştirme:** Enstrümantal değişken (IV) ve farkların farkı (DiD) tahmincilerinin eklenmesi.

### Yetenek 4 — Çok Adımlı Projeksiyon ve Dağılım Dışı Durum Tespiti (`Multi-Step Rollout & OOD`)
- **Uygulanan Gerçek Algoritma:** Sabit nokta/deterministik nedensel yayılım motoru (`src/causal_engine.hpp` C++17, `caelus_core/src/lib.rs` Rust `#![no_std]` ve JS `runMultiStepWorldRollout`) ile çok adımlı durum projeksiyonu yapar; her adımda eğitim dağılımına göre Mahalanobis/Z-skoru mesafesini (`oodScore`) hesaplar ve ufuk uzadıkça belirsizlik bandını genişletir.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13689-L13815), [`src/causal_engine.hpp`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/src/causal_engine.hpp#L628-L804), [`caelus_core/src/lib.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/src/lib.rs#L1140-L1280).
- **Veri ve Arayüz Durumu:** Gerçek tarihsel vakada 3 senaryonun çok adımlı projeksiyonunu üretir ve `#wie-card-direct-indirect` ile `#wie-card-scenarios` kartlarında gösterilir. JS, WASM ve yerel C++17 motorları aynı senaryo paketinde aynı yönlü karar sıralamasını üretir (`Test 36`, `Test 62`).
- **Mevcut Testler:** `Test 36`, `Test 53`, `Test 60`, `Test 61`, `Test 62`.
- **Eksik/Prototip Özellik ve Teknik Risk:** OOD tespiti tek değişkenli/köşegen kovaryans Z-skoru yaklaşımı kullanır; tam kovaryans tersi tekil matrislerde düzenlileştirme gerektirir.
- **Sonraki Geliştirme:** Konformal tahmin (conformal prediction) tabanlı dağılımdan bağımsız kapsama aralıkları.

### Yetenek 5 — Gizli Durum / JEPA Benzeri Temsil (`Latent State / JEPA Prototype`)
- **Uygulanan Gerçek Algoritma:** Büyük ölçekli eğitilmiş derin JEPA ağ ağırlıkları **içermez**. Gözlenen çok boyutlu durum vektörünü sabit tohumlu ortogonal/doğrusal izdüşüm matrisiyle düşük boyutlu gizli uzaya (`latentDim`) gömen ve gizli uzayda Ridge doğrusal geçiş matrisi öğrenen deterministik bir prototiptir (`PROTOTYPE_DETERMINISTIC_LINEAR_JEPA`).
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13821-L13936) (`runJepaStyleLatentPredictor`).
- **Veri ve Arayüz Durumu:** Çok alanlı demo ve senaryo iş akışında çalışır; çıktısında `isTrainedDeepNetwork: false` ve `modelClass: 'PROTOTYPE_DETERMINISTIC_LINEAR_JEPA'` açıkça belirtilir.
- **Mevcut Testler:** `Test 53`, `Test 56`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Doğrusal izdüşüm karmaşık multimodal temsilleri öğrenemez.
- **Sonraki Geliştirme:** Çevrim dışı doğrulanmış ONNX/GGUF sabit nokta enkoder ağırlıklarının isteğe bağlı yüklenmesi.

### Yetenek 6 — Çok Aktörlü Simülasyon (`Multi-Actor Domain Simulation`)
- **Uygulanan Gerçek Algoritma:** Genel Nash dengesi çözücüsü **değildir**. Kısıtlı rasyonel (bounded-rational) kural ve fayda ağırlıklı tepki fonksiyonlarıyla çalışan, aktörlerin (`GRID_DISPATCH_OPERATOR`, `FAB_FACILITIES_DIRECTOR`, `AUTO_SUPPLY_ALLOCATOR` vb.) işbirlikçi (`COOPERATIVE_STABILIZATION`) veya bencil stokçu (` COMPETITIVE_HOARDING`) stratejilerini adım adım simüle eden deterministik çok aktörlü etki motorudur.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13942-L14084) (`runMultiActorDomainSimulation`).
- **Veri ve Arayüz Durumu:** Gerçek Şubat 2021 Teksas ERCOT → Austin Yarı İletken → Otomotiv vakasında bencil stokçuluk ile korumalı mikro-şebeke/MCU paylaşımı arasındaki farkı (`+64` puan akış kazancı) simüle eder ve `#wie-card-scenarios` kartında gösterir.
- **Mevcut Testler:** `Test 54`, `Test 60`, `Test 61`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Aktör tepki katsayıları alan şablonlarından gelir; tam oyun teorik sabit nokta garantisi iddiası taşımaz (`equilibriumClaim: 'BOUNDED_RATIONAL_HEURISTIC_SIMULATION_NOT_NASH_PROOF'`).
- **Sonraki Geliştirme:** İki oyunculu sıfır toplamlı olmayan matris oyunları için Lemke-Howson çözücüsü.

### Yetenek 7 — Çok Modelli Belirsizlik Birleştirme (`Multi-Model Uncertainty Fusion`)
- **Uygulanan Gerçek Algoritma:** Birden fazla model ailesinin (`DETERMINISTIC_CAUSAL_ENGINE`, `TEMPORAL_GRAPH_AR1`, `MULTI_ACTOR_SIMULATION`) tahminlerini geçmiş doğrulama hatasına (inverse-variance / log-loss) göre ağırlıklandırır, modeller arası uyuşmazlık varyansını (`epistemicDisagreement`) ve kalibrasyon hatasını (`ECE` / Brier skoru) hesaplar; kalibre edilmemiş skorları `UNCALIBRATED_MODEL_SCORE` olarak işaretler.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14090-L14205) (`combineMultiModelEnsembleWithCalibration`).
- **Veri ve Arayüz Durumu:** Gerçek vaka iş akışında çalışır; `#wie-card-confidence` kartında belirsizlik kaynaklarını açıklar.
- **Mevcut Testler:** `Test 54`, `Test 60`, `Test 61`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Küçük doğrulama kümelerinde ECE tahmini gürültülü olabilir.
- **Sonraki Geliştirme:** İzotonik regresyon ile kesim öncesi doğrulama kümesi üzerinde otomatik kalibrasyon.

### Yetenek 8 — Müdahale ve Politika Arama (`Intervention & Policy Search`)
- **Uygulanan Gerçek Algoritma:** Aday müdahale kaldıraçları (`interventionPortfolio`) üzerinde kısıtlı bütçe ve yan etki cezası altında Gauss Süreci vekil modeli (Gaussian Process surrogate) ve Beklenen İyileşme / Üst Güven Sınırı (`UCB` / `Expected Improvement`) edinim fonksiyonu ile Pareto-baskın politikaları sıralar.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14211-L14338) (`searchOptimalInterventionPolicies`).
- **Veri ve Arayüz Durumu:** Gerçek vaka senaryolarında müdahale portföylerini değerlendirir ve `#wie-card-scenarios` içinde beklenen fayda, maliyet ve yan etki riskini gösterir.
- **Mevcut Testler:** `Test 54`, `Test 60`, `Test 61`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Sürekli yüksek boyutlu eylem uzayları yerine ayrık/küçük portföy ızgarası üzerinde çalışır.
- **Sonraki Geliştirme:** Çok amaçlı NSGA-II / Pareto cephesi çözücüsü.

### Yetenek 9 — Biçimsel Doğrulama ve Değişmezler (`Formal Verification & Invariants`)
- **Uygulanan Gerçek Algoritma:** Durum yörüngeleri üzerinde kütle/kapasite korunumu, olasılık/oran sınırları (`[0, 100]`), zaman monotonluğu, nedensel grafik döngüsüzlüğü (DAG kontrolü) ve sabit nokta taşma sınırlarını (`int64_t` / `Number.MAX_SAFE_INTEGER`) denetler; sınır aşımında karşı-örnek (`counterexample`) üretir. Rust çekirdeğinde ise `proptest` ve `invariant_sweep` ile doğrulanır.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14344-L14474) (`verifyWorldModelFormalInvariants`), [`caelus_core/tests/invariant_sweep.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/tests/invariant_sweep.rs#L1-L120), [`caelus_core/tests/proptest_invariants.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/tests/proptest_invariants.rs#L1-L150).
- **Veri ve Arayüz Durumu:** Gerçek vaka iş akışında her senaryo koşumu sonrasında çalışır; ihlal varsa `#wie-card-confidence` ve sembolik kapıda raporlanır.
- **Mevcut Testler:** `Test 38`, `Test 55`, `Test 61`, `cargo test --manifest-path caelus_core/Cargo.toml --features std`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Tam Z3 SMT çözücüsü yerine deterministik sonlu iz (bounded trace) ve aralık aritmetiği denetleyicisi kullanır (`verifierClass: 'BOUNDED_TRACE_AND_INTERVAL_INVARIANT_CHECKER'`).
- **Sonraki Geliştirme:** Doğrusal aritmetik kısıtlar için tam Fourier-Motzkin / Simplex uygunluk çözücüsü.

### Yetenek 10 — Parametre Tarama ve Hızlandırma (`Parameter Sweep & Research Layer`)
- **Uygulanan Gerçek Algoritma:** GPU veya SIMD donanım hızlandırması **değildir** (`executionBackend: 'SINGLE_THREAD_DETERMINISTIC_CPU_LOOP'`). Deterministik tohumlu (`SplitMix64`/`Mulberry32`) Latin Hiperküp / ızgara taramasını tek iş parçacıklı CPU döngüsünde çalıştırır ve grafik ölçeği bütçesini (`checkWorldGraphScaleBudget`: >2.500 düğüm veya >10.000 kenar) denetler.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14480-L14585) (`runAcceleratedParameterSweep`, `checkWorldGraphScaleBudget`).
- **Veri ve Arayüz Durumu:** Gerçek vaka iş akışında parametre duyarlılığı ve ölçek bütçesi kontrolünde çalışır.
- **Mevcut Testler:** `Test 55`, `Test 58`, `Test 62`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Çok büyük ızgaralarda tek iş parçacıklı CPU süresi doğrusal artar.
- **Sonraki Geliştirme:** Web Workers / Rust `rayon` üzerinden deterministik indirgeme (deterministic reduction) ile çok çekirdekli tarama.

### Yetenek 11 — Sürümlü Veri ve Anlık Görüntü Deposu (`Versioned Multimodal Store`)
- **Uygulanan Gerçek Algoritma:** Kanonik JSON serileştirme, gerçek SHA-256 içerik adresleme (`snapshotSha256`) ve hızlı ön kontrol FNV-1a (`fastCheckFnv1a32`) özetlerini birbirinden açıkça ayırarak değişmez (immutable) veri/senaryo anlık görüntüleri oluşturur; bozulmuş (`tampered`) anlık görüntüleri reddeder ve sabit tohumla bit-özdeş tekrar oynatım (`verifyAndReplayVersionSnapshot`) sağlar.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14591-L14699) (`createVersionedMultimodalStore`, `commitDatasetVersionSnapshot`, `verifyAndReplayVersionSnapshot`).
- **Veri ve Arayüz Durumu:** Gerçek vaka iş akışında çalışır; `#wie-card-confidence` altında anlık görüntü SHA-256 özeti ve bit-özdeş tekrar oynatım kanıtı gösterilir.
- **Mevcut Testler:** `Test 55`, `Test 59`, `Test 60`, `Test 61`, `Test 62`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Asimetrik kriptografik imza (`Ed25519`) yalnızca anahtar sağlandığında kullanılır; aksi halde sistem bunun bir içerik bütünlüğü özeti (`SHA-256`) olduğunu açıkça belirtir.
- **Sonraki Geliştirme:** İçerik adresli blokların sıkıştırılmış yerel paket (`tar.zst`) olarak dışa/içe aktarımı.

### Yetenek 12 — Sembolik Doğrulayıcı ve Ajan Yetki Sınırları (`Symbolic Verifier & Agent Boundary Gate`)
- **Uygulanan Gerçek Algoritma:**
  1. **Ajan Yetki Kapısı (`executeAgentBoundaryAction`, `promoteToCoreScenarioPackWithAgentGate`):** 4 ajan rolünü (`AGENT_A_SOURCE_HUNTER`, `AGENT_B_CAUSAL_DISCOVERY`, `AGENT_C_SCENARIO_PLANNER`, `AGENT_D_AUDIT_AND_LEDGER`) yalnızca sözlük tanımı olarak bırakmaz; çalışma zamanında yetkisiz kavram yazımlarını (`AGENT_CONCEPT_WRITE_FORBIDDEN`), izin verilmeyen eylemleri (`AGENT_ACTION_FORBIDDEN`) ve çekirdek `ScenarioPack` dalına yetkisiz terfileri (`CORE_SCENARIO_PROMOTION_RESTRICTED_TO_AUDIT_AGENT`) fail-closed reddeder. Ayrıca `addTemporalMemoryRecord` doğrudan çağrılsa bile ajan kimliği kontrol edilir.
  2. **Sembolik Doğrulayıcı (`runNeuroSymbolicVerificationPipeline`):** Her öneriyi 5 ardışık kapıdan geçirir: (1) Şema/Takvim doğrulaması (`parseStrictIsoTimestamp`), (2) Çift zamanlı sızıntı kapısı, (3) Birim ve boyut uyumluluğu, (4) Biçimsel değişmezler, (5) Kanıt zinciri doğrulaması.
- **Dosya ve Fonksiyonlar:** [`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L12945-L13077) ve [`#L14705-L14830`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L14705-L14830).
- **Mevcut Testler:** `Test 51`, `Test 55`, `Test 59`, `Test 61`, `Test 62`.
- **Eksik/Prototip Özellik ve Teknik Risk:** Aynı JavaScript bellek uzayında çalışan kod, nesne referanslarını doğrudan değiştirmeye çalışırsa (`Object.freeze` dışı alanlar) işletim sistemi süreç izolasyonu yoktur.
- **Sonraki Geliştirme:** Ajanların ayrı Worker / süreç kum havuzlarında (`MessageChannel`) izole çalıştırılması.

---

## 7. Dış Veri Katmanı ile Çevrim Dışı Deterministik Çekirdek Ayrımı (Aşama 3)

[`ui/scenario_compiler.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L15620-L15985) içinde üç katmanlı veri ve yürütme mimarisi açık ve doğrulanabilir biçimde ayrılmıştır:

```
+---------------------------------------------------------------------------------------------------+
| KATMAN A — DIŞ VERİ KATMANI (ingestFromExternalDataLayer / EXTERNAL_DATA_INGESTION_LAYER_CATALOG)  |
| - Yalnızca açıkça etkinleştirildiğinde dış kaynaklardan / kullanıcı dosyalarından veri alır.      |
| - Kullanılan servisler, HTTPS uç noktaları, lisanslar ve zaman damgaları katalogda belgelenir.    |
| - Ham yükün SHA-256 özeti (rawPayloadSha256) ve sistem alım zamanı (ingestedAtSystemTimeIso)      |
|   kaydedilir.                                                                                     |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
| KATMAN B — DOĞRULAMA VE İÇERİ ALMA KAPISI (buildVerifiedCoreDataPackage / verifyCoreDataPackage)  |
| - Her kayıt için 13 zorunlu alanı denetler:                                                       |
|   1. sourceId                        8. unitAndScale                                              |
|   2. sourceType                      9. knowledgeCategory                                         |
|   3. licenseAndUsagePolicy          10. confidenceScoreAndJustification                           |
|   4. eventTimeIso                   11. conflictStatus                                            |
|   5. availableAtSourceTimeIso       12. rawPayloadSha256                                          |
|   6. ingestedAtSystemTimeIso        13. normalizedRecordSha256                                    |
|   7. normalizationRulesApplied                                                                    |
| - Çift zamanlı kesim kontrolü (cutoffTimeIso) ve takvim doğrulaması (parseStrictIsoTimestamp)     |
|   uygular; kesim sonrası veya belirsiz saatli kayıtları eler (excludedRecords).                   |
| - Paket bütünlük özeti (packageIntegritySha256) ile mühürlenmiş VerifiedCoreDataPackage üretir.   |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
| KATMAN C — ÇEVRİM DIŞI DETERMİNİSTİK ÇEKİRDEK (runOfflineDeterministicCoreWithPackage)            |
| - Dış ağ çağrısı YAPMAZ (globalThis.fetch, XMLHttpRequest, WebSocket çalışma anında engellenir).  |
| - verifyCoreDataPackageIntegrity ile SHA-256 bütünlüğünü doğrular; değiştirilmiş paketi reddeder. |
| - Aynı VerifiedCoreDataPackage + aynı seed -> bit-özdeş deterministicOutputSha256 üretir.         |
+---------------------------------------------------------------------------------------------------+
```

---

## 8. Seçilen Gerçek Tarihsel Olay ve Kesim Zamanı (Aşama 4)

- **Vaka Kimliği:** `REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO`
- **Olay Başlığı:** **15–19 Şubat 2021 Teksas (ERCOT) Kış Fırtınası Uri Elektrik Şebekesi Çöküşü → Austin Yarı İletken Fabrikaları (Samsung Austin S2, NXP Oak Hill/ATMC, Infineon Austin) → Küresel Otomotiv Mikrodenetleyici (MCU) Tedarik Zinciri ve Şirket Finansmanı**
- **Karar / Analiz Kesim Zamanı (`cutoffTimeIso`):** `2021-02-17T18:00:00.000Z` (17 Şubat 2021 saat 18:00 UTC — Austin Energy’nin endüstriyel yarı iletken tesislerine zorunlu yük atma talimatını sürdürdüğü, ancak tesislerin ne zaman yeniden tam kapasiteye döneceğinin ve toplam çeyreklik gelir/araç üretim kaybının henüz bilinmediği karar anı).
- **Etkilenen 6 Sektör / Alan:**
  1. **Enerji ve Elektrik Şebekesi (`ENERGY_GRID`):** ERCOT şebekesinde ~20.000 MW zorunlu yük atma ve ~48,6 GW üretim devre dışı kalması; Austin Energy endüstriyel kesintisi.
  2. **Yarı İletken Üretimi (`SEMICONDUCTOR_MANUFACTURING`):** Samsung Austin Line S2 (14nm/28nm RF/kontrolcü), NXP Semiconductors Austin (Oak Hill & ATMC otomotiv MCU) ve Infineon Austin fabrikalarında temiz oda enerji kesintisi ve süreç içi wafer (WIP) hurda riski.
  3. **Temiz Oda Su ve Gaz Altyapısı (`MUNICIPAL_INFRASTRUCTURE`):** Austin ultra-saf su (UPW) basınç düşüşü ve azot/özel gaz ikmal darboğazı.
  4. **Küresel Otomotiv Üretimi (`AUTOMOTIVE_MANUFACTURING`):** Otomotiv Tier-1 (Continental, Bosch, Denso) ve OEM (GM, Ford, Toyota, Volkswagen) montaj hatlarında fren/motor kontrol MCU darboğazı.
  5. **Lojistik ve Hava Kargo (`LOGISTICS_TRANSPORT`):** Dondurucu buzlanma nedeniyle Austin-Bergstrom ve bölgesel karayolu yarı iletken sevkiyat duruşu.
  6. **Kurumsal Finans ve Sigorta (`CORPORATE_FINANCE`):** Wafer yeniden başlatma maliyeti, iş kesintisi (business interruption) hasarı ve çeyreklik gelir kaybı.

---

## 9. Kullanılan Kaynaklar, Lisanslar ve Zaman Damgaları Tablosu (Aşama 4.2)

| Kaynak Kimliği (`sourceId`) | Kurum / Kaynak Türü | Lisans ve Kullanım Politikası | Olay Zamanı (`eventTimeIso`) | Kaynakta Yayın Zamanı (`availableAtSourceTimeIso`) | Sistem Alım Zamanı (`ingestedAtSystemTimeIso`) | Kesim (`2021-02-17T18:00Z`) Durumu | Bilgi Kategorisi |
|---|---|---|---|---|---|---|---|
| `ERCOT-EEA3-20210215-0125` | ERCOT Acil Durum Operasyon Bildirimi (`OFFICIAL_GRID_OPERATOR_NOTICE`) | Public Regulatory Notice (ERCOT Public Domain / Fair Use) | `2021-02-15T07:25:00.000Z` | `2021-02-15T08:00:00.000Z` | `2021-02-17T12:00:00.000Z` | **KABUL EDİLDİ (Kesim Öncesi)** | `DIRECT_OBSERVATION` |
| `AUSTIN-ENERGY-CURTAIL-20210216` | Austin Energy Endüstriyel Yük Atma Bildirimi (`MUNICIPAL_UTILITY_NOTICE`) | City of Austin Public Utility Notice | `2021-02-16T09:00:00.000Z` | `2021-02-16T11:30:00.000Z` | `2021-02-17T12:05:00.000Z` | **KABUL EDİLDİ (Kesim Öncesi)** | `DIRECT_OBSERVATION` |
| `NXP-AUSTIN-SHUTDOWN-20210217` | NXP Semiconductors Operasyonel Durum Bildirimi (`CORPORATE_OPERATIONAL_NOTICE`) | Public Investor & Customer Advisory | `2021-02-16T12:00:00.000Z` | `2021-02-17T14:00:00.000Z` | `2021-02-17T15:00:00.000Z` | **KABUL EDİLDİ (Kesim Öncesi)** | `SOURCE_REPORTED_CLAIM` |
| `AUTO-TIER1-MCU-BUFFER-20210217` | Otomotiv Tier-1 Tedarik Zinciri Envanter Saha Raporu (`SECTOR_FIELD_REPORT`) | Industry Supply Chain Telemetry Summary | `2021-02-17T10:00:00.000Z` | `2021-02-17T15:30:00.000Z` | `2021-02-17T16:00:00.000Z` | **KABUL EDİLDİ (Kesim Öncesi)** | `DERIVED_METRIC` |
| `EARLY-MEDIA-RESTART-CLAIM-20210217A` | Erken Yerel Medya Haberi (`MEDIA_REPORT`) | Fair Use Metadata Citation | `2021-02-17T12:00:00.000Z` | `2021-02-17T16:00:00.000Z` | `2021-02-17T16:30:00.000Z` | **KABUL EDİLDİ (Çelişkili İddia #1: 48 saatte tam yeniden başlatma)** | `SOURCE_REPORTED_CLAIM` |
| `SEMI-PROCESS-ENG-ASSESSMENT-20210217B` | Yarı İletken Süreç Mühendisliği Değerlendirmesi (`TECHNICAL_ENGINEERING_NOTE`) | Engineering Domain Model | `2021-02-17T12:00:00.000Z` | `2021-02-17T16:45:00.000Z` | `2021-02-17T17:00:00.000Z` | **KABUL EDİLDİ (Çelişkili İddia #2: 4–6 hafta vakum/UPW kalibrasyonu)** | `SOURCE_REPORTED_CLAIM` |
| `POST-CUTOFF-NXP-20210317-FILING` | NXP 17 Mart 2021 Resmi Gelir Etkisi (~100 Milyon USD) Açıklaması (`SEC_PRESS_RELEASE`) | Public Regulatory Filing | `2021-02-16T09:00:00.000Z` | `2021-03-17T13:00:00.000Z` | `2021-03-17T14:00:00.000Z` | **REDDEDİLDİ (Kesim Sonrası Kaynak Sızıntısı)** | `DIRECT_OBSERVATION` (Sadece Kesim Sonrası Karşılaştırmada Kullanıldı) |
| `POST-CUTOFF-FERC-NERC-20211116-REPORT` | FERC / NERC / Bölgesel Kurum Ortak Kış Fırtınası Uri Nihai Raporu (`RETROSPECTIVE_OFFICIAL_REPORT`) | US Government Public Domain Report | `2021-02-15T07:25:00.000Z` | `2021-11-16T15:00:00.000Z` | `2021-11-17T09:00:00.000Z` | **REDDEDİLDİ (Kesim Sonrası Geriye Dönük Analiz)** | `DIRECT_OBSERVATION` (Sadece Kesim Sonrası Karşılaştırmada Kullanıldı) |

---

## 10. Çift Zamanlı Sızıntı Kontrolü Sonuçları (Aşama 4.3)

Kesim zamanı `cutoffTimeIso = 2021-02-17T18:00:00.000Z` olarak ayarlandığında iki katmanlı çift zamanlı kapının (`classifyAndValidateKnowledgeRecord` + `reconstructWorldStateAt`) gerçek çıktı sonuçları:

- **Toplam İncelenen Kayıt:** `8`
- **Kesim Öncesi Kabul Edilen Kayıt (`acceptedPreCutoffCount`):** `6`
- **Kesim Sonrası Elenen Kayıt (`excludedPostCutoffCount`):** `2`
  1. `POST-CUTOFF-NXP-20210317-FILING`: Olay zamanı `2021-02-16` olmasına rağmen kaynak yayın zamanı `2021-03-17T13:00:00.000Z > 2021-02-17T18:00:00.000Z` olduğu için **reddedildi** (`SOURCE_PUBLISHED_AFTER_DECISION_CUTOFF` / `LEARNED_TIME_AFTER_DECISION_CUTOFF`).
  2. `POST-CUTOFF-FERC-NERC-20211116-REPORT`: Olay zamanı `2021-02-15` olmasına rağmen `isRetrospectiveReanalysis: true` ve yayın zamanı `2021-11-16T15:00:00.000Z` olduğu için **reddedildi** (`RETROSPECTIVE_REANALYSIS_RELEASED_AFTER_DECISION_CUTOFF`).
- **Ek Sınır Kontrolleri (`Test 62`):**
  - Yayın saati belirsiz (`publicationTimestampUncertainty: 'DATE_ONLY_NO_HOUR'`, `2021-02-17T00:00:00.000Z` gün sonu üst sınırı `2021-02-17T23:59:59.999Z > 18:00:00.000Z`) olan kayıt **reddedildi** (`UNCERTAIN_PUBLICATION_HOUR_EXCEEDS_CUTOFF`).
  - Geçersiz takvim tarihi (`2026-02-30T10:00:00.000Z`) hem hafıza kapısında hem zamansal grafik öğrenmede hem de sembolik doğrulayıcıda **reddedildi** (`INVALID_EVENT_TIMESTAMP`).

---

## 11. Bilgi Durumu ve Çelişki Analizi (Aşama 5)

CAELUS Dünya Etki Motoru tüm bilgileri 7 açık epistemik kategoride sınıflandırmıştır:

1. **Doğrudan Gözlem (`DIRECT_OBSERVATION`):** ERCOT EEA3 ~20 GW yük atma ve Austin Energy endüstriyel kesintisi.
2. **Kaynağın İddiası (`SOURCE_REPORTED_CLAIM`):** NXP’nin Austin fabrikalarının durduğuna dair ilk kurumsal bildirimi ve yerel medyanın "elektrik gelince 48 saatte tam kapasiteye dönülür" iddiası.
3. **Türetilmiş Ölçüm (`DERIVED_METRIC`):** Otomotiv Tier-1 MCU tampon envanterinin 2–3 haftalık çalışma süresine karşılık gelmesi ve temiz oda yeniden başlatma gecikme indeksi.
4. **Varsayım (`EXPLICIT_ASSUMPTION`):** Kesinti süresi (`48` saat), alternatif enerji/UPW yedek kapasitesi (`%68`) ve aktör işbirliği modu.
5. **Aday Nedensel Hipotez (`CANDIDATE_CAUSAL_HYPOTHESIS`):** Austin temiz oda duruş süresinin 3–5 hafta gecikmeyle küresel otomotiv montaj hatlarında darboğaz yaratacağı hipotezi (`requiresDomainValidation: true`).
6. **Model Tahmini (`UNCALIBRATED_MODEL_SCORE`):** 3 senaryo için üretilen kapasite akışı (`throughputPct`) ve stres (`peakStressPct`) skorları (kalibre edilmiş olasılık değildir).
7. **Eksik veya Çelişkili Bilgi (`CONFLICTING_EVIDENCE` / `INSUFFICIENT_DATA`):**
   - **Çelişki (`CONFLICT-AUSTIN-FAB-RESTART-TIME`):** `EARLY-MEDIA-RESTART-CLAIM-20210217A` (elektrik verildikten sonra 48 saat içinde tam üretime dönüş) ile `SEMI-PROCESS-ENG-ASSESSMENT-20210217B` (vakum pompaları, ultra-saf su (UPW) boru hattı sterilizasyonu ve litografi kalibrasyonu nedeniyle 4–6 hafta gecikme) yan yana korunmuş, tek bir ortalama değere indirgenmemiştir.
   - **Bilgi Boşluğu (`GAP-FAB-WIP-WAFER-SCRAP-RATIO`):** 17 Şubat 2021 saat 18:00 UTC itibarıyla Samsung S2 ve NXP Oak Hill temiz odalarındaki süreç içi wafer (WIP) hurda oranı kamuya açık olmadığından belirsizlik bandı genişletilmiştir (`+14` puan).

---

## 12. Doğrudan ve Dolaylı Etki Zincirleri (Aşama 6)

Motor tarafından hesaplanan 1., 2. ve 3. derece etki yayılımı (`stage5_DirectAndIndirectImpactChains`):

| Etki Derecesi | Kaynak Düğüm | Hedef Düğüm | Gecikme (`lagSteps`) | Etki Türü ve Mekanizma | Kanıt ve Sınır Durumu |
|---|---|---|---|---|---|
| **1. Derece (Doğrudan)** | `ercot_grid_load_shed` (ERCOT Şebeke Çöküşü) | `austin_fab_cleanroom_power` (Austin Fabrika Temiz Oda Gücü) | `1` adım (Saatler) | Zorunlu endüstriyel yük atma nedeniyle Samsung S2, NXP ve Infineon temiz odalarında doğrudan enerji ve UPW kesintisi. | `DIRECT_OBSERVATION` (`ERCOT-EEA3-20210215-0125`, `AUSTIN-ENERGY-CURTAIL-20210216`) |
| **2. Derece (Dolaylı)** | `austin_fab_cleanroom_power` | `automotive_mcu_supply_flow` (Otomotiv MCU Tedarik Akışı) | `2` adım (2–5 Hafta) | Temiz oda vakum/UPW yeniden kalibrasyon gecikmesi ve süreç içi wafer kaybı nedeniyle otomotiv mikrodenetleyici (MCU) sevkiyatlarının durması. | `CANDIDATE_CAUSAL_HYPOTHESIS` (`NXP-AUSTIN-SHUTDOWN-20210217`, `SEMI-PROCESS-ENG-ASSESSMENT-20210217B`) |
| **3. Derece (Dolaylı)** | `automotive_mcu_supply_flow` | `global_auto_oem_assembly_finance` (Küresel Otomotiv OEM Montajı & Finans) | `3` adım (4–10 Hafta) | Tier-1 fren/motor ECU tampon stoklarının tükenmesiyle Kuzey Amerika, Avrupa ve Asya’daki OEM montaj hatlarında vardiya iptalleri ve çeyreklik gelir kaybı. | `CANDIDATE_CAUSAL_HYPOTHESIS` + `UNCALIBRATED_MODEL_SCORE` |

---

## 13. 3 Senaryo Karşılaştırma Tablosu (Aşama 7)

Aynı deterministik motor (`seed = 20260410`, `cutoffTimeIso = 2021-02-17T18:00:00.000Z`, `eventDurationHours = 48`, `capacityOrResourceAmountPct = 68`) ile çalıştırılan 3 senaryonun karşılaştırması:

| Senaryo Kimliği ve Başlığı | Müdahale / Varsayım Özeti | Kapasite Akışı (`throughputPct`) | Tepe Stres (`peakStressPct`) | Kesinti Durumu (`outageActive`) | S1’e Göre Akış Farkı | Maliyet ve Yan Etki Riski | Hangi Koşulda Başarısız Olur? (`failureConditionTr`) |
|---|---|---|---|---|---|---|---|
| **Senaryo 1 (`SCENARIO_1_BASELINE_NO_INTERVENTION`)** — Müdahalesiz / Bireysel Stokçuluk Baz Senaryosu | Fabrika mikro-şebeke/UPW koruması yok; Tier-1 alıcılar panik siparişi ve bencil stokçuluk (`COMPETITIVE_HOARDING`) yapıyor. | **`0%`** | **`100%`** | **`true` (Kesinti Var)** | Baz (`0` puan) | Müdahale maliyeti: `0` birim; Yan etki: Süreç içi wafer hurdası ve OEM montaj duruşu maksimum. | Elektrik kesintisi 12 saatten uzun sürdüğünde temiz oda pozitif basıncı ve UPW hattı çöker; doğrudan sistemik kesinti oluşur. |
| **Senaryo 2 (`SCENARIO_2_COOPERATIVE_TARGETED_INTERVENTION`)** — Koordineli Korumalı Mikro-Şebeke + Otomotiv MCU Önceliklendirmesi | Kritik temiz oda vakum/UPW hatları için korumalı mikro-şebeke + kritik otomotiv güvenlik MCU’ları için şeffaf tahsis (`COOPERATIVE_STABILIZATION`). | **`64%`** | **`100%`** | **`false` (Kesinti Önlenir)** | **`+64` puan** | Tahmini müdahale maliyeti: `38` birim; Yan etki: Tüketici elektroniği standart çip teslimatlarında `%15–25` gecikme. | Doğalgaz/su altyapısı 96 saatten uzun süre tamamen kesilirse yerel mikro-şebeke yakıt ve UPW tankları tükenir. |
| **Senaryo 3 (`SCENARIO_3_COMPOUND_STRESS_FAILURE`)** — Birleşik Stres: Artçı Soğuk Hava Dalgası + UPW Boru Çatlaması + Panik Stokçuluk | İkinci dondurucu dalga ve UPW boru hattı hasarı altında müdahalenin stres testi. | **`0%`** | **`100%`** | **`true` (Kesinti Var)** | **`0` puan** | Müdahale maliyeti: `55` birim; Yan etki: Fiziksel boru hasarı nedeniyle müdahale kapasitesi aşılır. | UPW ultra-saf su tesisatında fiziksel donma/çatlama gerçekleştiğinde yazılımsal tahsis politikaları tek başına üretimi koruyamaz. |

---

## 14. Kesim Zamanı Sonrası Gerçekleşen Sonuçlarla Karşılaştırma (Aşama 8.1)

Kesim zamanı (`2021-02-17T18:00:00.000Z`) sırasında **hiçbir şekilde modele sokulmayan**, yalnızca koşum tamamlandıktan sonra [`evaluatePostCutoffRealityComparison`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L15010-L15115) içinde doğrulama amacıyla karşılaştırılan gerçek dünya sonuçları:

| Kesim Sonrası Gerçekleşen Gösterge | Gerçekleşen Tarihsel Değer (Kesim Sonrası Kaynak) | CAELUS Kesim Öncesi Model Çıktısı | Durum (`DIRECTIONALLY_CONSISTENT` / `PARTIALLY_CONSISTENT` / `MISSED`) | Teknik Açıklama |
|---|---|---|---|---|
| **Austin Yarı İletken Fabrikalarının Tam Üretime Dönüş Süresi** | NXP Austin fabrikalarında yaklaşık **1 aylık (4 hafta) üretim kaybı** ve ~100 Milyon USD 1. çeyrek gelir etkisi (`POST-CUTOFF-NXP-20210317-FILING`); Samsung S2’de Mart sonuna uzanan yeniden başlatma. | Çelişki kaydında süreç mühendisliği iddiasını (`4–6 hafta`) korudu ve S1 baz senaryoda `outageActive = true`, `throughputPct = 0%` ile uzun süreli darboğaz öngördü. | **`DIRECTIONALLY_CONSISTENT` (Yön Olarak Tutarlı)** | Erken medya haberindeki "48 saatte tam kapasiteye dönüş" iddiasının aşırı iyimser olduğu, süreç mühendisliği kısıtının belirleyici olduğu doğrulandı. |
| **Küresel Otomotiv OEM Montaj Hatlarına Gecikmeli Yayılım** | Mart–Mayıs 2021 döneminde GM, Ford, Toyota ve diğer OEM’lerde mikrodenetleyici (MCU) eksikliği nedeniyle Kuzey Amerika ve küresel fabrikalarda çok haftalık vardiya duruşları yaşandı. | 2. ve 3. derece etki zincirinde `austin_fab_cleanroom_power -> automotive_mcu_supply_flow -> global_auto_oem_assembly_finance` üzerinden çok haftalık gecikmeli darboğaz öngörüldü. | **`DIRECTIONALLY_CONSISTENT` (Yön Olarak Tutarlı)** | 2–3 haftalık Tier-1 tampon stokları tükendikten sonra şokun enerji sektöründen otomotiv montaj hatlarına sıçradığı doğrulandı. |
| **Kesin Dolar Bazlı Gelir Kaybı ve Tam Wafer Hurda Adedi** | NXP ~100 Milyon USD, Samsung Austin ~268–350 Milyon USD (300–400 Milyar KRW) hasar bildirdi (`POST-CUTOFF-NXP-20210317-FILING`). | Kesim anında (`2021-02-17`) fabrika içi WIP wafer hurda oranı bilinmediği için (`GAP-FAB-WIP-WAFER-SCRAP-RATIO`) kesin dolar tahmini üretilmedi; normalize stres ve akış skoru (`0%` vs `64%`) üretildi. | **`PARTIALLY_CONSISTENT` (Kısmen Tutarlı — Mutlak Dolar Tutarı Tahmin Edilmedi)** | Sistem kesim anında mevcut olmayan gizli fabrika içi envanter verisini uydurmamış, eksik veri uyarısı vererek yalnızca normalize kapasite akışını raporlamıştır. |

---

## 15. Basit Referans Yöntemlerle Karşılaştırma (Aşama 8.2)

[`evaluateSimpleForecastingBaselines`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/scenario_compiler.js#L13465-L13542) fonksiyonu, öğrenilen zamansal grafik modelini (`LEARNED_AR1_MODEL`) 4 basit referans yöntemle aynı kesim öncesi seri üzerinde karşılaştırmaktadır (`REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO` çıktısı):

| Yöntem Kimliği | Yöntem Açıklaması | Ortalama Mutlak Hata (`MAE`) | Kök Ortalama Kare Hata (`RMSE`) | Sonuç ve Dürüst Değerlendirme |
|---|---|---|---|---|
| `LAST_KNOWN_VALUE` | Son bilinen değeri koruma (Persistence / Naive) | `12.6667` | `15.1144` | Ani rejim kırılmasında (şebeke çöküşü) bir adım önceki değere takılı kalır. |
| `SIMPLE_LINEAR_TREND` | Son iki nokta arasındaki basit doğrusal eğilim | `10.1111` | `12.4601` | Düşüş yönünü yakalar ancak doğrusal aşım (overshoot) yapar. |
| `MOVING_AVERAGE` | 3 adımlı basit hareketli ortalama | `18.1481` | `20.9161` | Kırılma anında geçmiş yüksek değerlerin ortalamasını aldığı için gecikir. |
| `SIMPLE_GRAPH_THRESHOLD_RULE` | Üst akış şebeke stresi `%70`’i aştığında alt akışı sabit oranla düşüren basit eşik kuralı | `7.8889` | `9.2916` | Şebeke -> Fabrika eşik geçişini basit kuralla yakalar; güçlü ve şeffaf bir referanstır. |
| `LEARNED_AR1_MODEL` | CAELUS Ridge-düzenlileştirilmiş (`L2`) Zamansal Grafik AR(1) Modeli | **`6.4124`** | **`7.6842`** | Bu vakada gecikmeli düğüm ağırlıklarını kullandığı için en düşük MAE değerini üretmiştir; ancak kısa serilerde basit eşik kuralına (`SIMPLE_GRAPH_THRESHOLD_RULE`) yakın performans gösterir ve hiçbir zaman "kesin gelecek tahmini" olarak sunulmaz. |

---

## 16. Arayüz ve Kullanıcı Akışı Doğrulaması (Aşama 9)

[`ui/index.html`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/index.html#L413-L578) ve [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L646-L815) üzerindeki `#caelus-world-impact-engine-workspace` çalışma alanı incelenmiş ve güçlendirilmiştir:

1. **Vaka Seçimi (`#wie-problem-select`):** Varsayılan ilk seçenek olarak `REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO` (Şubat 2021 Teksas ERCOT → Austin Yarı İletken → Otomotiv & Finans) eklendi. Vaka değiştirildiğinde `#wie-cutoff-input` otomatik olarak ilgili vakanın tarihsel kesim zamanına (`2021-02-17T18:00`) güncellenir.
2. **Kesim Zamanı ve Varsayım Kontrolleri:** `#wie-cutoff-input`, `#wie-duration-input`, `#wie-capacity-input`, `#wie-actor-select`, `#wie-confidence-select` ve `#wie-insufficient-toggle` doğrudan `runWorldImpactEngineWorkflow` motorunu tetikler.
3. **6 Aşamalı Kademeli Açıklama (Progressive Disclosure) Kartları:**
   - **Kart 1 (`#wie-card-summary`):** Olay Özeti, Kesim Zamanı ve Etkilenen 6 Sektör.
   - **Kart 2 (`#wie-card-direct-indirect`):** 1., 2. ve 3. Derece Doğrudan/Dolaylı Etki Zincirleri.
   - **Kart 3 (`#wie-card-scenarios`):** 3 Senaryo Karşılaştırması + 4 Basit Referans Yöntem Tablosu.
   - **Kart 4 (`#wie-card-knowledge`):** 7 Sade Bilgi Rozeti (`Doğrudan Gözlem`, `Kaynağın İddiası`, `Türetilmiş Ölçüm`, `Varsayım`, `Aday Nedensel Hipotez`, `Model Tahmini`, `Eksik veya Çelişkili Bilgi`) + Kesim Sonrası Elenen Kayıtlar + Çelişki Kaydı.
   - **Kart 5 (`#wie-card-confidence`):** Neden Güveniyoruz / Neden Şüpheliyiz + SHA-256 Anlık Görüntü ve Bit-Özdeş Tekrar Oynatım Kanıtı.
   - **Kart 6 (`#wie-card-reality-comparison`):** Kesim Zamanı Sonrası Gerçekleşen Tarihsel Sonuçlarla Karşılaştırma (`DIRECTIONALLY_CONSISTENT`, `PARTIALLY_CONSISTENT`).
4. **Tek Dosyalık Yayın Paketi (`dist/index.html`):** `python tools/build_standalone.py` çalıştırılarak `dist/index.html` (`3,611,592` bayt) ve gömülü `caelus_wasm.wasm` (`131,524` base64 karakter) güncellenmiş ve doğrulanmıştır.

---

## 17. Güvenlik, Yetki ve Bütünlük Denetimi (Aşama 10 — 15 Zorunlu Kontrol)

[`tests/universal_scenario_compiler.test.mjs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/tests/universal_scenario_compiler.test.mjs#L4860-L5110) içindeki **`Test 62`** ile 15 sınır ve güvenlik senaryosunun tamamı otomatik test altına alınmış ve doğrulanmıştır:

| # | Güvenlik / Doğruluk Senaryosu | Beklenen Davranış | Gerçekleşen Test Sonucu |
|---|---|---|---|
| **1** | Kesim zamanından sonra yayınlanan haber (`availableAtSourceTimeIso > cutoffTimeIso`) | Reddedilmeli (`SOURCE_PUBLISHED_AFTER_DECISION_CUTOFF`) | **DOĞRULANDI (`PASS`)** |
| **2** | Olay zamanı kesim öncesi (`2021-02-15`), yayın zamanı kesim sonrası (`2021-11-16`) geriye dönük rapor | Reddedilmeli (`RETROSPECTIVE_REANALYSIS_RELEASED_AFTER_DECISION_CUTOFF`) | **DOĞRULANDI (`PASS`)** |
| **3** | Yayın saati belirsiz (`DATE_ONLY_NO_HOUR`) ve gün sonu kesim zamanını aşan kaynak | Reddedilmeli (`UNCERTAIN_PUBLICATION_HOUR_EXCEEDS_CUTOFF`) | **DOĞRULANDI (`PASS`)** |
| **4** | Geçersiz takvim tarihi (`2026-02-30T10:00:00.000Z`) | Tüm katmanlarda (Hafıza, Grafik Öğrenme, Sembolik Kapı) reddedilmeli | **DOĞRULANDI (`PASS`)** |
| **5** | Aynı kaynağın kopya/sendikasyon haberi (`duplicateOfObservationId`) | Tekilleştirilmeli; bağımsız kanıt sayısını (`independentSourceCount`) şişirmemeli | **DOĞRULANDI (`PASS`)** |
| **6** | Birbiriyle çelişen iki kaynak (`25` vs `85`) | Her iki değer `conflictRegistry` içinde korunmalı, sessizce ezilmemeli | **DOĞRULANDI (`PASS`)** |
| **7** | Birim uyumsuzluğu (`MW` vs `USD`) | Sembolik doğrulayıcı (`step3UnitDimensionalityCheck`) tarafından reddedilmeli | **DOĞRULANDI (`PASS`)** |
| **8** | Yetkisiz ajan (`AGENT_A_SOURCE_HUNTER` / `AGENT_C_SCENARIO_PLANNER`) çekirdek `ScenarioPack` yazımı | Hem `executeAgentBoundaryAction` hem `promoteToCoreScenarioPackWithAgentGate` hem de `addTemporalMemoryRecord` tarafından reddedilmeli | **DOĞRULANDI (`PASS`)** |
| **9** | Değiştirilmiş (tampered) veri paketi veya anlık görüntü (`snapshotSha256` / `packageIntegritySha256` uyuşmazlığı) | `verifyAndReplayVersionSnapshot` ve `runOfflineDeterministicCoreWithPackage` tarafından reddedilmeli | **DOĞRULANDI (`PASS`)** |
| **10** | Yetersiz veri (`insufficientCriticalDataToggle = true` veya boş paket) | Uydurma sayı üretmeden `INSUFFICIENT_DATA_STOP` ile durmalı ve eksik veriyi listelemeli | **DOĞRULANDI (`PASS`)** |
| **11** | Aynı veri ve aynı `seed` ile tekrar çalıştırma | Bit-özdeş çıktı ve aynı SHA-256 özeti (`deterministicOutputSha256`) üretmeli | **DOĞRULANDI (`PASS`)** |
| **12** | Çevrim dışı çekirdek çalışırken dış ağ çağrısı (`fetch`) | `runOfflineDeterministicCoreWithPackage` içinde ağ API’leri mühürlü; `networkCallsAttempted === 0` | **DOĞRULANDI (`PASS`)** |
| **13** | Ölçek sınırı aşımı (`3.000` düğüm > `2.500` bütçe veya `15.000` kenar > `10.000` bütçe) | `checkWorldGraphScaleBudget` açık uyarı (`SCALE_BUDGET_WARNING`) üretmeli | **DOĞRULANDI (`PASS`)** |
| **14** | Kalibre edilmemiş skorun olasılık gibi sunulması girişimi | `isCalibratedProbability === false` ve `UNCALIBRATED_MODEL_SCORE` etiketi zorunlu | **DOĞRULANDI (`PASS`)** |
| **15** | JS, WASM (`caelus_wasm.wasm`) ve yerel C++17 (`dist/caelus_os.exe`) motor tutarlılığı | Aynı senaryo paketinde üç motor da müdahalenin kapasiteyi koruduğunu (`throughputB >= throughputA`) tutarlı biçimde doğrulamalı | **DOĞRULANDI (`PASS`)** |

---

## 18. Çalıştırılan Testler ve Çıktı Kanıtları (Aşama 11)

Yerel ortamda çalıştırılan tüm derleme ve test komutlarının gerçek sonuçları:

| Komut | Kapsam | Sonuç | Kanıt Özeti |
|---|---|---|---|
| `cargo test --locked` | Workspace Rust testleri (`caelus_core` + `caelus_wasm`) | **PASS (0 hata)** | 22 birim + 5 ikili + 2 proptest = **29/29 geçti** |
| `cargo test --locked --manifest-path caelus_core/Cargo.toml --features std` | `caelus_core` tam özellikli testler | **PASS (0 hata)** | 15 birim + 2 `invariant_sweep` + 4 `narrowed_model` + 7 `proptest` = **28/28 geçti** |
| `cargo build --release --locked --target wasm32-unknown-unknown --manifest-path caelus_wasm/Cargo.toml` | Tarayıcı WASM çekirdeği derlemesi | **PASS (0 hata)** | `caelus_wasm.wasm` başarıyla üretildi |
| `g++ -std=c++17 -O2 -DCAELUS_CPP_UNIT_TEST=1 ... tests/test_causal_engine.cpp` | C++17 nedensel motor birim testleri | **PASS (0 hata)** | **21/21 test vakası, 146 doğrulama (assertion), 0 hata** |
| `python tests/run_bs_exec_golden.py --binary caelus_core/target/release/caelus_core_repl.exe` | Rust çekirdek golden vektör doğrulaması | **PASS (0 hata)** | **3/3 golden senaryo bit-özdeş geçti** |
| `python tests/test_pure_blake3.py` | Saf Python/Rust BLAKE3 vektör testi | **PASS (0 hata)** | Resmi test vektörleri doğrulandı |
| `python tests/connector_smoke.py` | C++17 derleyici ve bağlayıcı duman testi | **PASS (0 hata)** | Tüm bağlayıcı testleri geçti |
| `node --test tests/universal_wasm_scenario.test.mjs` | Evrensel WASM senaryo yürütme testi | **PASS (0 hata)** | **1/1 geçti** |
| `node --test apps/caelus-ncm-mobile/tests/ncm2-quality.test.mjs` | Mobil NCM kalite testleri | **PASS (0 hata)** | **10/10 geçti** |
| `CAELUS_OFFLINE_ONLY=1 CAELUS_REQUIRE_NATIVE_BIN=1 node --test tests/universal_scenario_compiler.test.mjs` | Evrensel senaryo derleyicisi + 12 yetenek + gerçeklik testi + 15 güvenlik testi (Tam CI modu) | **PASS (0 hata)** | **52 geçti, 0 başarısız, 4 canlı HTTPS testi `CAELUS_OFFLINE_ONLY=1` ile açıkça atlandı** |
| `CAELUS_OFFLINE_ONLY=1 CAELUS_WASM_ONLY=1 node --test tests/universal_scenario_compiler.test.mjs` | GitHub Pages / iPhone War Room WASM-only yayın modu | **PASS (0 hata)** | **`Test 36` WASM üzerinden geçti, `Test 37` açık gerekçeyle atlandı, 0 başarısız** |
| `node tools/run_e2e_world_analysis_demo.mjs` | Uçtan uca Şubat 2021 Teksas ERCOT → Austin Yarı İletken → Otomotiv gerçeklik testi + yerel `dist/caelus_os.exe` doğrulaması | **PASS (0 hata)** | S1 `%0` vs S2 `%64` (`+64` puan), bit-özdeş tekrar oynatım `dc62fc7bf93b0348...`, yerel C++17 motor doğrulaması geçti |
| `python tools/build_standalone.py` | Tek dosyalık `dist/index.html` ve `dist/caelus_standalone.html` üretimi | **PASS (0 hata)** | `3,611,592` bayt standalone paket üretildi |

---

## 19. `caelus_world_store.json` Koruma Kanıtı

Temel Çalışma Kuralı 6 uyarınca kullanıcı verisi barındıran [`caelus_world_store.json`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_world_store.json) dosyası çalışma boyunca hiçbir şekilde değiştirilmemiştir:

- **Çalışma Öncesi SHA-256:** `4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1`
- **Çalışma Sonrası SHA-256:** `4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1`
- **`git diff caelus_world_store.json`:** Boş (`0` satır fark).

---

## 20. Bilinen Sınırlar ve Yanlış İddia Önleme Notları

1. **Korelasyon ≠ Nedensellik:** `discoverLagAwareCausalGraph` zaman gecikmeli kısmi korelasyon ve doğrusal SEM kullanır; tüm çıktıları `CANDIDATE_CAUSAL_HYPOTHESIS` olarak etiketlenir ve uzman doğrulaması (`requiresDomainValidation: true`) gerektirir.
2. **Kalibre Edilmemiş Skor ≠ Gerçek Olasılık:** Senaryo akış (`throughputPct`), stres (`peakStressPct`) ve bileşik güven skorları normalize model indeksleridir; kalibre edilmiş gerçekleşme olasılığı değildir (`isCalibratedProbability: false`).
3. **SHA-256 Bütünlük Özeti ≠ İddianın Doğruluğu:** `rawPayloadSha256`, `normalizedRecordSha256` ve `snapshotSha256` yalnızca verinin değiştirilmediğini (veri bütünlüğünü) kanıtlar; kaynağın iddiasının gerçek dünyada doğru olduğunu kanıtlamaz (`provesSourceTruth: false`).
4. **JEPA ve Çok Aktörlü Simülasyon Sınırları:** `runJepaStyleLatentPredictor` eğitilmiş derin sinir ağı değil deterministik doğrusal gizli izdüşüm prototipidir; `runMultiActorDomainSimulation` ise genel Nash dengesi çözücüsü değil kısıtlı rasyonel kural tabanlı çok aktörlü simülasyondur.
5. **CPU Parametre Taraması:** `runAcceleratedParameterSweep` GPU veya SIMD kullanmaz; tek iş parçacıklı deterministik CPU döngüsü üzerinde çalışır.

---

## 21. Önceliklendirilmiş Sonraki Mühendislik Adımları

1. **Çok Çekirdekli Deterministik Tarama (Yetenek 10):** `caelus_core` ve Web Worker katmanında sabit sıralı indirgeme (deterministic tree reduction) ile çok iş parçacıklı parametre taraması.
2. **Kalıcı Çift Zamanlı İndeks (Yetenek 1 & 11):** Bellek içi `TemporalWorldMemoryStore` yapısının 100.000+ kayıt için SQLite/DuckDB tabanlı içerik adresli yerel dosya deposuna bağlanması.
3. **Dağılımdan Bağımsız Konformal Kalibrasyon (Yetenek 4 & 7):** Kesim öncesi kayan pencere (rolling window) kalibrasyon kümesi üzerinde konformal tahmin aralıklarının (`conformal prediction intervals`) hesaplanması.
4. **Süreç İzolasyonlu Ajan Kum Havuzu (Yetenek 12):** 4 ajan rolünün (`AGENT_A`–`AGENT_D`) ayrı Worker/süreç bellek alanlarında çalıştırılarak bellek içi nesne referansı paylaşımının tamamen kaldırılması.
