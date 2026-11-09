# CAELUS Dünya Etki Motoru ve 12 Yetenek Mimarisi — Bağımsız Denetim ve Doğrulama Raporu

## A. Mevcut Durum ve Eski Bulguların Yeniden Doğrulaması (AŞAMA 0)

Bu denetim, `origin/main` dalının güncel durumu (`8070a8b` — PR #11 birleşimi sonrası) üzerinde doğrudan kaynak kod ve çalışan test çıktıları incelenerek gerçekleştirilmiştir.

### A.1. 10 Tarihsel Bulgunun `main` (`8070a8b`) Üzerinde Yeniden Doğrulanması ve Bu Dalda Yapılan Düzeltmeler

| # | İncelenen Bulgu | `main` (`8070a8b`) Başlangıç Durumu | Bu Daldaki (`feat/caelus-world-impact-engine`) Son Durum | Doğrulayan Kanıt / Test |
|---|---|---|---|---|
| **1** | **Eğitilebilir model katmanı:** Yerel doğrusal/AR1 model var; derin sinir ağı / Transformer değil | **DÜZELTİLMİŞ** (Doğrusal sırt regresyonu + çok adımlı özyinelemeli + konformal aralık + basit referans karşılaştırması mevcut ve dürüstçe etiketli) | **KORUNDU VE GENİŞLETİLDİ** (`evaluateSimpleForecastingBaselines` ile 4 referans yöntem yan yana raporlanıyor) | `tests/universal_scenario_compiler.test.mjs` (Test 25–34, Test 52, Test 60) |
| **2** | **Nedensel keşif:** Yönlü gecikmeli korelasyon ve doğrusal artıklandırma var; tam PC / FCI / PCMCI / NOTEARS değil | **DÜZELTİLMİŞ** (`runCausalDiscoveryAndImpactAnalysis` çıktıları `MODEL_HYPOTHESIS` / `CONDITIONAL_CAUSAL_CONCLUSION` olarak işaretli; kısmi-$R^2$ duyarlılık sınırı var; doğrudan çekirdeğe nedensel gerçek olarak yazılmıyor) | **KORUNDU VE ETKİ AĞINA BAĞLANDI** (`exploreMultiLayerImpactPaths` içinde `ARAŞTIRILACAK HİPOTEZ` rozetiyle gösteriliyor) | `tests/universal_scenario_compiler.test.mjs` (Test 53, Test 60, Test 61) |
| **3** | **Ajan sistemi:** Tek süreçli deterministik fonksiyon; rol izinleri sadece sözlükte tanımlı | **HÂLÂ GEÇERLİ** (`main` üzerinde `CAELUS_AGENT_SPECIFICATIONS` tanımlıydı ancak `promoteToCoreScenarioPackWithAgentGate` içinde `targetZone` verilmediğinde yetkisiz ajan kontrolü ve `addTemporalMemoryRecord` doğrudan çağrı engeli eksikti) | **DÜZELTİLDİ** (`writeMemoryRecordWithAgentGate`, `invokeExternalNetworkWithAgentGate`, `promoteToCoreScenarioPackWithAgentGate` ve `addTemporalMemoryRecord` gerçek sınır fonksiyonları olarak sertleştirildi) | `tests/universal_scenario_compiler.test.mjs` (Test 59, Test 62) |
| **4** | **Bitemporal tarih kontrolü:** Geçersiz tarih girdilerinde (`NaN`) karşılaştırma sessizce `false` dönüp kaydı geçiriyor | **KISMEN GEÇERLİ** (`classifyAndValidateKnowledgeRecord` içinde sıkı ISO-8601 kontrolü vardı ancak `evaluateTemporalGraphLinkPrediction` ve `runNeuroSymbolicVerificationPipeline` içinde hâlâ `Date.parse` kullanılıyordu ve yayın saati belirsizliği üst sınır kontrolü eksikti) | **DÜZELTİLDİ** (`parseStrictIsoTimestamp` tüm kapılarda zorunlu kılındı; `publicationTimestampUncertainty` muhafazakâr üst sınır kontrolü eklendi) | `tests/universal_scenario_compiler.test.mjs` (Test 57, Test 61, Test 62) & `apps/caelus-ncm-mobile/tests/ncm2-quality.test.mjs` (Test 10) |
| **5** | **UI denetim izi (`AUD-...`):** 32-bit FNV-1a özetidir; kriptografik imza değildir | **DÜZELTİLMİŞ** (`executeCaelusAgentWorkflow` içinde `hashAlgorithm: 'FNV1A_32_NON_CRYPTOGRAPHIC_TRACE'`, `isCryptographicEd25519Seal: false` etiketleri ve paralel 256-bit `finalSha256ChainHead` mevcut) | **KORUNDU** (Kriptografik mühür için Rust `src/audit_log.rs` Blake3 + Ed25519 sınır ayrımı açıkça korundu) | `tests/universal_scenario_compiler.test.mjs` (Test 59) |
| **6** | **Çok modelli belirsizlik:** Önceden tanımlı veya kullanıcı ağırlıklı birleştirme var; tam MCMC / HMC / VI değil | **DÜZELTİLMİŞ** (`evaluateBayesianModelEnsemble` dürüstçe deterministik analitik birleştirme olduğunu ve tam MCMC/HMC olmadığını beyan ediyor) | **KORUNDU** | `tests/universal_scenario_compiler.test.mjs` (Test 54) |
| **7** | **Çok aktörlü simülasyon:** Deterministik kural tabanlı tepki döngüsü; tam oyun-teorik denge çözücüsü değil | **DÜZELTİLMİŞ** (`runMultiActorDomainSimulation` sabit nokta `int64 × 1e6` kural tabanlı çok aktörlü sektör simülasyonu olarak etiketli) | **KORUNDU VE SENARYO MOTORUNA BAĞLANDI** (`actorBehaviorPolicy` varsayımı ile 3 senaryo dalında çalışıyor) | `tests/universal_scenario_compiler.test.mjs` (Test 54, Test 60, Test 61) |
| **8** | **Gizli durum (JEPA benzeri) modülü:** Deterministik öznitelik projeksiyonu; eğitilmiş derin temsil modeli değil | **DÜZELTİLMİŞ** (`runJepaLatentStatePrototype` açıkça deterministik doğrusal projeksiyon ve EMA hedef kodlayıcı prototipi olarak etiketli) | **KORUNDU** | `tests/universal_scenario_compiler.test.mjs` (Test 53) |
| **9** | **Donanım hızlandırma:** SIMD / GPU bayrakları meta-veri düzeyinde; gerçek CUDA / AVX-512 çekirdeği yok | **DÜZELTİLMİŞ** (`createAcceleratedResearchJobManifest` açıkça CPU deterministik tarama olduğunu ve GPU/SIMD çekirdeğinin aktif olmadığını raporluyor) | **KORUNDU** | `tests/universal_scenario_compiler.test.mjs` (Test 55) |
| **10** | **12 yetenek uçtan uca akışı ve gerçek tarihsel vaka testi:** Ana War Room arayüzünde (`#caelus-world-impact-engine-workspace`) gerçek tarihsel olay (`REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO`) ve kesim sonrası gerçekleşen sonuçlarla karşılaştırma kartı (`#wie-card-reality-comparison`) | **KISMEN GEÇERLİ** (Örnek vitrin problemi mevcuttu ancak Şubat 2021 ERCOT → Austin Yarı İletken → Otomotiv gerçek tarihsel vakası ve kesim sonrası karşılaştırma aşaması eksikti) | **DÜZELTİLDİ** (`REAL_CASE_2021_ERCOT_AUSTIN_SEMICONDUCTOR_AUTO` ve `evaluatePostCutoffRealityComparison` hem `ui/scenario_compiler.js` hem `ui/index.html` + `ui/app.js` akışına bağlandı) | `tests/universal_scenario_compiler.test.mjs` (Test 60, Test 61, Test 62) & `node tools/run_e2e_world_analysis_demo.mjs` |

---

### A.2. Mevcut Bileşen Envanteri Tablosu

| Bileşen | Dosya | Gerçek Davranış | Test / Kanıt | Eksik / Sınır |
|---|---|---|---|---|
| **C++17 Deterministik Nedensel Çekirdek** | `include/causal_engine.h`, `src/main.cpp` | Sabit nokta (`int64_t × 1,000,000`) aritmetiği, DAG yayılımı, histerezis kilitleri, karşı-olgusal Dal A / Dal B ayrımı, `CDET:` deterministik özet bloğu | `tests/test_causal_engine.cpp` (68/68), `ci.bat` | Doğrusal olmayan sürekli PDE çözücüsü içermez; ayrık tick tabanlıdır |
| **Rust `no_std` Deterministik Çekirdek** | `caelus_core/src/lib.rs`, `caelus_core/verify/*.rs` | C++17 motoruyla bit-özdeş anlık görüntü özeti üreten `no_std` Rust çekirdeği ve Verus/Z3 biçimsel doğrulama kontratları | `cargo test --manifest-path caelus_core/Cargo.toml` (28/28), `tests/run_bs_exec_golden.py` (3/3) | Yalnızca çekirdek durum makinesini kapsar |
| **Rust Ağ, Senaryo İmzası ve Kriptografik Denetim Kaydı** | `src/lib.rs`, `src/audit_log.rs`, `src/bin/caelus_sign_scenario.rs` | Blake3 + Ed25519 senaryo ve eklenti doğrulaması, zincirleme mühürlü (`SEAL`) denetim günlüğü | `cargo test` (29/29), `tools/verify_audit_log.py`, `tests/test_pure_blake3.py` | Tarayıcı içi JS izi (`AUD-...`) bu yerel Rust mühürüyle karıştırılmamalıdır |
| **Rust → WASM Tarayıcı Çekirdeği** | `caelus_wasm/src/lib.rs`, `ui/pkg/caelus_wasm_bg.wasm` | Tarayıcı içinde C++17 / `caelus_core` ile bit-özdeş deterministik hesaplama | `tests/universal_wasm_scenario.test.mjs` (1/1) | Dış ağ erişimi yoktur (tamamen çevrimdışı) |
| **Birleşik Gerçek Dünya Veri Defteri ve Zamansal Dünya Hafızası** | `ui/scenario_compiler.js` (`CaelusUnifiedRealWorldLedger`, `createTemporalWorldMemory`, `syncLedgerWithTemporalWorldMemory`) | 13 kavram tipi, 12 zorunlu kaynak/zaman/epistemik/bütünlük alanı, iki katmanlı bitemporal tarih kapısı, SHA-256 içerik bütünlüğü ile kaynak doğruluğu ayrımı | `tests/universal_scenario_compiler.test.mjs` (Test 48, 51, 52, 57, 58) | Kalıcı depolama yerel JSON/IndexedDB tabanlıdır; dağıtık küme veritabanı değildir |
| **CAELUS Dünya Etki Motoru (World Impact Engine)** | `ui/scenario_compiler.js` (`runWorldImpactEngineWorkflow`, `exploreMultiLayerImpactPaths`, `deduplicateCorroboratingSources`) | 7 ilişki kategorisi, kaynak tekilleştirme, ölçek bütçesi, 4 ajan yetki kapısı, 6 varsayım üzerinden 3 karşılaştırmalı senaryo, yetersiz veride dürüst duruş (`BELİRLENEMİYOR`) | `tests/universal_scenario_compiler.test.mjs` (Test 58, 59, 60), `tools/run_e2e_world_analysis_demo.mjs` | İlişki yolları nedensellik kanıtı değil, kaynaklı/varsayımsal/hipotez etki yollarıdır |
| **Ana Savaş Odası Arayüzü (War Room UI)** | `ui/index.html`, `ui/app.js`, `dist/index.html` | Kademeli açıklama (progressive disclosure) ile **CAELUS Dünya Etki Motoru** çalışma alanı (`#caelus-world-impact-engine-workspace`), 7 sade Türkçe rozet | `node --check ui/app.js`, `tests/universal_scenario_compiler.test.mjs` (Test 60) | — |
| **NCM-2 Mobil / Web İstemcisi** | `apps/caelus-ncm-mobile/lib/neurocausal.mjs` | Sıkı ISO-8601 bitemporal tarih kapısı (`parseStrictIsoDate`), gelecek tarihli sızıntı engeli ve yerel çıkarım | `apps/caelus-ncm-mobile/tests/ncm2-quality.test.mjs` (10/10) | — |

---

## B. CAELUS Dünya Etki Motoru Mimarisi

```
GERÇEK VEYA AÇIKÇA ETİKETLENMİŞ ÖRNEK VERİ
  (PROB_ENERGY_TECH_FIN_TRADE / PROB_AEGEAN_SEISMIC_PORT_COLDCHAIN / PROB_INSUFFICIENT_DATA_HONEST_STOP)
    │
    ▼
[Katman A & B Bitemporal Tarih Kapısı: parseStrictIsoTimestamp + classifyAndValidateKnowledgeRecord + admitRecordToWorldMemoryAndCoreGate]
    │  (Geçersiz tarih, takvim taşması 2026-02-30, gelecekteki occurredAt/learnedAt -> FAIL-CLOSED)
    ▼
KAYNAKLI VE ZAMANSAL DÜNYA HAFIZASI (13 Kavram, 12 Zorunlu Alan, SHA-256 Bütünlük != Kaynak Doğruluğu)
  (createTemporalWorldMemory <──syncLedgerWithTemporalWorldMemory──> CaelusUnifiedRealWorldLedger)
    │
    ▼
OLAY VE AKTÖR İLİŞKİLERİ + TEKİLLEŞTİRİLMİŞ KAYNAK ZİNCİRİ
  (7 İlişki Kategorisi + deduplicateCorroboratingSources: aynı birincil veri kümesini tekrarlayan ikincil haberler tekilleştirilir)
    │
    ▼
OLASI DOLAYLI ETKİ YOLLARI VE ÖLÇEK BÜTÇESİ
  (exploreMultiLayerImpactPaths: maxNodes, maxEdges, maxHops, maxCandidatePaths, timeoutMs + döngü koruması)
    │
    ▼
KARŞIT KANIT, ALTERNATİF AÇIKLAMALAR VE YETERSİZ VERİ KAPISI
  (Çelişkili kayıtlar silinmez; kritik veri eksikse motor uydurma sayı üretmez -> BELİRLENEMİYOR / YETERSİZ VERİ)
    │
    ▼
4 AJAN YETKİ KAPISI (Ajan A: Kaynak/İddia, Ajan B: Zamansal Hafıza, Ajan C: Karşıt Kanıt/Senaryo, Ajan D: Doğrulayıcı Kapı)
  (writeMemoryRecordWithAgentGate, invokeExternalNetworkWithAgentGate, promoteToCoreScenarioPackWithAgentGate)
    │
    ▼
BİRDEN FAZLA SENARYO (Aynı Başlangıç Durumundan 6 Varsayım Üzerinden 3 Karşılaştırmalı Dal)
  1. Baz Senaryo (Mevcut Eğilim)
  2. Müdahale / Azaltım Senaryosu (Tampon + Yönlendirme)
  3. Kötümser / Birleşik Şok Senaryosu (Uzun Kesinti + İkincil Darboğaz)
    │
    ▼
MEVCUT CAELUS HESAPLAMA MOTORU (int64 × 1,000,000 Sabit Nokta + C++17 / Rust WASM Çekirdek)
    │
    ▼
SONUÇ, DAYANAK, BELİRSİZLİK, REFERANS KARŞILAŞTIRMASI VE DENETİM KAYDI
  (7 Sade Türkçe Rozet + FNV-1a/SHA-256/Ed25519 Dürüst Denetim İzi + Deterministik Yeniden Oynatma Özeti)
```

---

## C. Bağımlılık ve Lisans Envanteri (AŞAMA 1 — Bölüm 6.3)

| Bileşen / Paket | Katman | Lisans | Çevrimdışı Çalışma | Deterministik Çekirdek İlişkisi | Ticari Dağıtım ve Tedarik Zinciri Durumu |
|---|---|---|---|---|---|
| **C++17 Standart Kütüphanesi (STL)** | Yerel Çekirdek (`src/`, `include/`) | Derleyici çalışma zamanı istisnası (GCC Runtime Library Exception / MSVC) | Tamamen çevrimdışı | Doğrudan çekirdek (`int64_t × 1e6`) | Üretime ve ticari dağıtıma uygun |
| **`ed25519-dalek` (2.x), `blake3` (1.x), `rand_core`, `zeroize`** | Rust Güvenlik ve Denetim (`Cargo.toml`) | BSD-3-Clause / CC0-1.0 / Apache-2.0 / MIT | Tamamen çevrimdışı | Senaryo/eklenti imzası ve mühürlü denetim zinciri | Açık kaynak ve ticari dağıtıma uygun |
| **`caelus_core` (`no_std`)** | Rust Deterministik Çekirdek (`caelus_core/Cargo.toml`) | Proje içi özgün kod (`serde` isteğe bağlı `std` modunda MIT/Apache-2.0) | Tamamen çevrimdışı | C++17 motoruyla bit-özdeş ikinci çekirdek | Üretime ve ticari dağıtıma uygun |
| **`caelus_wasm` (`wasm-bindgen`)** | Tarayıcı WASM Köprüsü (`caelus_wasm/Cargo.toml`) | MIT / Apache-2.0 | Tamamen çevrimdışı (`ui/pkg/` içinde yerel) | Tarayıcı içi deterministik çekirdek | Üretime ve ticari dağıtıma uygun |
| **Yerel Tarayıcı Görselleştirme Paketleri (`three`, `cytoscape`, `deck.gl`, `maplibre-gl`, `chart.js`)** | Arayüz (`ui/vendor/`) | MIT / Apache-2.0 / BSD-3-Clause | Tamamen çevrimdışı (`ui/vendor/` altında yerel paketli) | Çekirdek hesaplamaya karışmaz; yalnızca görselleştirme | Ticari dağıtıma uygun |
| **Açık Veri Kaynakları (USGS, Open-Meteo, World Bank, ECB, NASA EONET/GIBS/JPL)** | Çevrimiçi Veri Bağlayıcıları (`ui/scenario_compiler.js`) | Kamu Malı (USGS/NASA) / CC-BY 4.0 (Open-Meteo, World Bank, ECB) | Çevrimiçi ortamda opt-in izin kapısıyla çalışır; çekirdek çevrimdışıdır | Çekirdeğe yalnızca sürümlü ve bitemporal kapıdan geçmiş paket olarak girer | Ticari kullanımda kaynak atfı (CC-BY 4.0) korunmalıdır; Open-Meteo ücretsiz uç noktası ticari olmayan kullanım içindir, ticari dağıtımda kendi anahtarı/kurumsal uç noktası kullanılmalıdır |
| **Referans / Karşılaştırma Modelleri (GraphCast, Chronos, TimesFM, Lag-Llama, Tigramite)** | Yalnızca Katalog ve Mimari Referans (`UNIVERSAL_REPOSITORY_CATALOG`) | Apache-2.0 / GPL-3.0 (Tigramite) | Depoya ağırlık veya GPL kodu **dahil edilmemiştir** | Çekirdeğe bağlı değildir (`REFERENCE_ONLY` / `ISOLATED_EXTERNAL`) | GPL-3.0 olan Tigramite depoya eklenmemiştir; çekirdek lisansını kirletmez |

---

## D. 12 Yetenek Durum Matrisi (Bölüm 14)

| # | Yetenek | CAELUS İçindeki Somut Karşılığı | Dosya / Modül | Test | Dünya Etki Motoru Akışındaki Rolü | Kod & Kanıt Durumu |
|---|---|---|---|---|---|---|
| **1** | **Zamansal Dünya Hafızası (Temporal World Memory)** | 14 kavram tipi (`TEMPORAL_WORLD_MEMORY_CONCEPTS` + `EXTENDED_WORLD_MEMORY_CONCEPTS`) ve bitemporal (`validFromIso` + `recordedAtIso` + `availableAtSourceTimeIso`) hafıza, `syncLedgerWithTemporalWorldMemory` ve `reconstructWorldStateAt(cutoff)` | `ui/scenario_compiler.js` (`createTemporalWorldMemory`, `addTemporalMemoryRecord`, `admitRecordToWorldMemoryAndCoreGate`, `reconstructWorldStateAt`, `syncLedgerWithTemporalWorldMemory`, `retractOrSupersedeMemoryRecord`) | Test 51, 52, 57, 58, 60, 61, 62 | Analiz kesim zamanında bilinen dünya durumunu sızıntısız yeniden kurar | **Çalışan uygulama · Gerçek dünya karşılaştırması yapılmış** |
| **2** | **Zamansal Grafik Öğrenme (Temporal Graph Learning)** | Yarı-ömür (`0.5^(age/halfLife)`) güncellik ağırlıklı yönlü 2-adımlı Adamic-Adar üçgensel kapanış ve alan geçiş sıklığı (`evaluateTemporalGraphLinkPrediction`) — derin sinir ağı (TGN/TGAT) değildir | `ui/scenario_compiler.js` (`evaluateTemporalGraphLinkPrediction`, `evaluateSimpleForecastingBaselines`) | Test 52, 60, 61, 62 | Kronolojik kesim öncesi etkileşimlerden aday bağlantıları `MODEL_HYPOTHESIS` olarak sıralar ve 2 basit referansla karşılaştırır | **Çalışan uygulama · Teknik olarak tekrar üretilebilir** |
| **3** | **Nedensel Keşif ve Duyarlılık Analizi** | Gecikmeli Pearson korelasyonu, gözlenen karıştırıcılar için Frisch-Waugh-Lovell doğrusal artıklandırması ve kısmi-$R^2$ sağlamlık sınırı (`runCausalDiscoveryAndImpactAnalysis`) — tam PC/FCI/PCMCI/NOTEARS değildir | `ui/scenario_compiler.js` (`runCausalDiscoveryAndImpactAnalysis`, `exploreMultiLayerImpactPaths`) | Test 53, 58, 60, 61 | Gözlenen ilişkileri `ARAŞTIRILACAK HİPOTEZ` olarak işaretler ve gözlenmeyen karıştırıcı duyarlılığını hesaplar | **Çalışan uygulama · Gerçek dünya karşılaştırması yapılmış** |
| **4** | **Çok Adımlı Rollout ve Dağılım Dışı (OOD) Tespiti** | Özyinelemeli doğrusal sırt regresyonu (`trainLearnedWorldModel`) + çok adımlı projeksiyon ve $z$-skoru ($\max |z| > 3.0\sigma$) OOD uyarısı (`evaluateWorldModelMultiStepRolloutAndOod`) | `ui/scenario_compiler.js` (`CaelusLearnedWorldModel.trainLearnedWorldModel`, `evaluateWorldModelMultiStepRolloutAndOod`) | Test 25–34, 53, 56 | Uzun ufuklu senaryolarda belirsizlik bandının genişlemesini ve eğitim bölgesi dışına çıkışı raporlar | **Çalışan uygulama · Teknik olarak tekrar üretilebilir** |
| **5** | **Gizli Durum / JEPA Benzeri Temsil** | Deterministik özet tabanlı doğrusal projeksiyon matrisi (`W_ctx`), skaler `emaMomentum` hedef ölçeklemesi ve gizli uzay sırt regresyonu (`runJepaLatentStatePrototype`) — eğitilmiş derin sinir ağı değildir | `ui/scenario_compiler.js` (`runJepaLatentStatePrototype`) | Test 53 | Çok boyutlu durum vektörlerini düşük boyutlu deterministik özette karşılaştırır | **Çalışan uygulama (Araştırma Prototipi) · Teknik olarak tekrar üretilebilir** |
| **6** | **Çok Aktörlü Alan Simülasyonu** | 4 davranış politikası (`COOPERATIVE_SHARING`, `DEFENSIVE_BUFFERING`, `OPPORTUNISTIC_HOARDING`, `ESCALATORY_RETALIATION`) ile sabit nokta (`int64 × 1e6`) `ScenarioPack` derlemesi ve Dal A/B karşı-olgusal koşumu (`runMultiActorDomainSimulation`) — oyun teorisi Nash denge çözücüsü değildir | `ui/scenario_compiler.js` (`runMultiActorDomainSimulation`, `simulateScenarioPackCounterfactualInFp`), `include/causal_engine.h`, `caelus_core/src/engine.rs` | Test 36, 54, 60, 61, 62 | 3 senaryo dalında aktör davranış politikalarının (`actorBehaviorPolicy`) sistem akışına ve tepe strese etkisini simüle eder | **Çalışan uygulama · Gerçek dünya karşılaştırması yapılmış** |
| **7** | **Çok Modelli Belirsizlik Birleştirme** | Öncül/ters-varyans ağırlıklı analitik birleştirme ve modeller arası uyuşmazlık varyansı ayrıştırması (`evaluateBayesianModelEnsemble`) — MCMC/HMC/VI değildir | `ui/scenario_compiler.js` (`evaluateBayesianModelEnsemble`) | Test 54, 56, 60, 61 | 3 senaryo dalının beklenen akışını ve modeller arası uyuşmazlık belirsizliğini birleştirir | **Çalışan uygulama · Gerçek dünya karşılaştırması yapılmış** |
| **8** | **Müdahale ve Politika Arama (Bayesian Optimization)** | 81 noktalı ayrık aday havuzunda RBF çekirdekli Gauss Süreci (GP) vekil modeli ve GP-UCB edinim fonksiyonu (`runBayesianPolicyOptimization`) | `ui/scenario_compiler.js` (`runBayesianPolicyOptimization`) | Test 54 | Müdahale kaldıracı ve kaynak tahsisi kombinasyonlarını kısıtlar altında deterministik rastgele aramayla karşılaştırır | **Çalışan uygulama · Teknik olarak tekrar üretilebilir** |
| **9** | **Biçimsel Doğrulama ve Değişmez (Invariant) Kontratları** | 4 Verus/Z3 ispat dosyası (`caelus_core/verify/*.rs`), `caelus_core` birim/proptest/daraltılmış model testleri ve `evaluateFormalVerificationSuite` çalışma zamanı değişmez denetimi | `caelus_core/verify/fp_proofs.rs`, `mul_div_safety.rs`, `latch_machine.rs`, `trust_and_hysteresis_proofs.rs`, `ui/scenario_compiler.js` (`evaluateFormalVerificationSuite`) | Test 33, 38, 55, `caelus_core` (28/28) | Sabit nokta $[0, 10^6]$ sınırlarını, taşmasız çarpma/bölmeyi, kilitli kesinti durum makinesini ve P-8 sembolik yükseltme kapısını doğrular | **Çalışan uygulama · Teknik olarak tekrar üretilebilir** |
| **10** | **Parametre Tarama ve Hızlandırma Katmanı** | Deterministik CPU döngüsü ve iş manifestosu (`createAcceleratedResearchJobManifest`) — aktif GPU/CUDA/SIMD çekirdeği yoktur | `ui/scenario_compiler.js` (`createAcceleratedResearchJobManifest`) | Test 55 | Çoklu varsayım kombinasyonlarını deterministik CPU döngüsünde tarar ve çekirdekle sınır ayrımını korur | **İskelet / CPU Prototipi · Teknik olarak tekrar üretilebilir** |
| **11** | **Sürümlü Çok Modlu Veri ve Anlık Görüntü Deposu** | Kanonik JSON + SHA-256 içerik adresli sürüm deposu (`createVersionedMultimodalStore`, `commitMultimodalBatch`, `exportOfflineTransferBundle`, `verifyAndImportOfflineTransferBundle`, `rollbackMultimodalStoreToVersion`) ve 13 zorunlu alanlı `buildVerifiedCoreDataPackage` | `ui/scenario_compiler.js` (`createVersionedMultimodalStore`, `buildVerifiedCoreDataPackage`, `verifyCoreDataPackageIntegrity`) | Test 48, 55, 60, 61, 62 | Dünya Etki Motoru koşumunun veri paketini SHA-256 ile mühürler ve değiştirilmiş paketleri reddeder | **Çalışan uygulama · Gerçek dünya karşılaştırması yapılmış** |
| **12** | **Sembolik Doğrulayıcı ve Ajan Yetki Sınırları** | 6 adımlı hibrit sembolik doğrulama (`runNeuroSymbolicVerificationPipeline`) ve 4 ajan gerçek yetki kapısı (`writeMemoryRecordWithAgentGate`, `invokeExternalNetworkWithAgentGate`, `promoteToCoreScenarioPackWithAgentGate`, `addTemporalMemoryRecord`) | `ui/scenario_compiler.js` (`runNeuroSymbolicVerificationPipeline`, `executeCaelusAgentWorkflow`), `src/audit_log.rs` | Test 51, 55, 59, 60, 61, 62 | İddiaların, hipotezlerin, takvim taşmalı tarihlerin ve yetkisiz ajanların doğrulanmış gerçek alanına sızmasını engeller | **Çalışan uygulama · Gerçek dünya karşılaştırması yapılmış** |

