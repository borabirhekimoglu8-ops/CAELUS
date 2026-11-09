# CAELUS — Keşif ve Bilgi Değeri Motoru Deney ve Gerçeklik Testi Raporu (`CAELUS_KESIF_MOTORU_DENEY_RAPORU.md`)

## 1. Donanım ve Çalışma Ortamı Doğrulaması

Tüm deneyler yerel makine üzerinde harici GPU olmadan deterministik olarak çalıştırılmış ve `data/discovery_research_lab_results.json` içine kaydedilmiştir:
- **İşlemci:** `Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz` (4 Çekirdek / 8 Mantıksal İşlemci)
- **Grafik Birimi:** `Intel(R) UHD Graphics 620` (Entegre GPU; CUDA veya ayrık VRAM yok — `gpuAvailableForCompute: false`)
- **Python & Kurulu Kütüphaneler:** `Python 3.14.3`, `torch 2.11.0+cpu`, `dowhy 0.8`, `river 0.26.1`, `scipy 1.17.1`, `scikit-learn 1.9.1`, `duckdb 2.0.0`
- **Toplam Deney Süresi ve Bellek:** `15163.1 ms` (~15.2 sn, bunun ~14 sn’si DoWhy bootstrap karşı sınamaları), tepe Python heap belleği: `21284.4 KB` (~20.8 MB).

---

## 2. 14 Adımlı Uçtan Uca Çok Alanlı Gerçeklik Testi (Şubat–Mart 2021 Teksas ERCOT $\to$ Austin Yarı İletken $\to$ Otomotiv & Finansman)

`runDiscoveryValueEngineEndToEndWorkflow` (`ui/discovery_value_engine.js`) fonksiyonu 14 adımı uçtan uca deterministik olarak (`SHA-256: 0421b60648cf2663...`) çalıştırır:

1. **Çok Alanlı Soru:** *"Şubat 2021 Teksas şebeke çöküşü sonrasında Austin yarı iletken fabrikalarındaki üretim duruşunu, küresel otomotiv MCU darboğazını ve tesis koruma yatırım kararını açıklamada temiz oda enerji/ultra-saf su (UPW) yeniden kalibrasyon süresi mi (`H_ENERGY_CLEANROOM_DOMINANT`), yoksa işletme sermayesi ve finansman koşulları mı (`H_FINANCE_CAPITAL_DOMINANT`) daha belirleyicidir?"*
2. **İki Rakip Hipotez:**
   - `H_ENERGY_CLEANROOM_DOMINANT`: Fiziksel temiz oda vakum/UPW yeniden kalibrasyon süresi (4–6 hafta) baskın mekanizmadır.
   - `H_FINANCE_CAPITAL_DOMINANT`: Kısa vadeli işletme sermayesi ve kredi spreadi baskın mekanizmadır.
3. **Kesim Zamanı $T_1$ (`2021-02-17T18:00:00Z`) Bilinenler:** ERCOT 20.000 MW yük atma emri ve Austin Energy sanayi kesintisi biliniyor; ancak temiz odaların yeniden kalibrasyonunun kaç gün süreceği henüz bilinmiyor (başlangıç varsayımı: `10 gün`). Başlangıçta **Karar B (`DECISION_B_WAIT_FOR_GRID_AND_USE_CREDIT_LINE`, fayda = `75.80`)** 1. sıradadır.
4. **Tespit Edilen 4 Eksik/Bilinmeyen Değişken:**
   - `fab_cleanroom_requalification_days` (`[2..35]` gün, maliyet: `350 USD` — bilinen)
   - `industrial_electricity_spot_mwh_usd` (`[25..220]` USD/MWh, maliyet: `120 USD` — tahmin edilmiş)
   - `working_capital_bridge_rate_pct` (`[2.0..9.5]` %, maliyet: `BİLİNMİYOR`)
   - `office_cafeteria_lighting_pct` (`[0..100]` %, maliyet: `25 USD` — kararı hiç değiştirmeyen kontrol değişkeni)
5. **Duyarlılık Analizi (`runDecisionSensitivityAndInformationValueEngine`):**
   - `fab_cleanroom_requalification_days` değişkeni **`18.5 gün`** eşiğini aştığında en iyi karar `DECISION_B`’den **`DECISION_A_CLEANROOM_MICROGRID_AND_UPW_BUFFER`** seçeneğine dönmektedir (`decisionFlipped: true`, `maxPayoffSwing: 33.15`, `caelusPriorityScore: 19.5515`).
   - `office_cafeteria_lighting_pct` değişkeni `[0..100]` aralığında hiçbir kararın skorunu değiştirmez (`maxPayoffSwing: 0`, `caelusPriorityScore: 0`, `DUSUK_KARARI_ETKILEMEYEN_BILINMEYEN`).
6. **"Arandı Ancak Bulunamadı" Kaydı (`RJ-ATTEMPT-01-WAFER-SCRAP-NOT-FOUND`):**
   - 18 Şubat 2021’de fabrika içi lot bazlı tam wafer hurda adedi aranmış, ticari sır kapsamında olduğu için kamu bildirimlerinde bulunamamıştır (`outcomeStatus: "SEARCHED_NOT_FOUND"`, `foundValue: null`). Sistem veri uydurmamış ve $T_1$ değerlendirmesini (`v1`) korumuştur.
7. **Kontrollü Kaynaklardan Yeni Kanıt İçe Alma ($T_2 = \text{2021-03-17}$):**
   - OpenAlex CC0 bilimsel literatür adaptörü (`queryOpenAlexScientificAdapter`) ve yerel NXP Austin bülteni Markdown dönüşümü (`convertLocalDocumentToMarkdownAdapter`) ile temiz oda yeniden kalibrasyon süresinin **`29 gün`** olduğu doğrulanmıştır (`RJ-ATTEMPT-02-CLEANROOM-29DAYS-FOUND`).
8. **Karar ve Hipotez Güncellemesi ($v_1 \to v_2$):**
   - `29 gün > 18.5 gün` eşiği aşıldığı için önerilen karar **`DECISION_B`’den `DECISION_A`’ya** değişmiş (`decisionRankingChangedAfterResearch: true`), `H_ENERGY_CLEANROOM_DOMINANT` hipotezi güçlenmiş, önceki değerlendirme (`v1`) silinmeden `v2` oluşturulmuştur.

---

## 3. 4 Araştırma Önceliklendirme Yönteminin Karşılaştırması (Bölüm 5)

| Sıra | 1. Rastgele Sıralama (Tohumlu) | 2. Basit Kural (Aralık Genişliği / Maliyet) | 3. CAELUS Karar Duyarlılığı | 4. Olasılıksal Bilgi Kazanımı (Bayesçi EIG Hibrit) |
|---|---|---|---|---|
| **1. Öncelik** | `working_capital_bridge_rate_pct` | `industrial_electricity_spot_mwh_usd` (Skor: `93.78`) | **`fab_cleanroom_requalification_days`** (Skor: `19.55`) | **`fab_cleanroom_requalification_days`** (Skor: `21.49`) |
| **2. Öncelik** | `office_cafeteria_lighting_pct` | `office_cafeteria_lighting_pct` (Skor: `71.53` — **Yanlış Öncelik!**) | `industrial_electricity_spot_mwh_usd` (Skor: `12.56`) | `industrial_electricity_spot_mwh_usd` (Skor: `13.47`) |
| **3. Öncelik** | `fab_cleanroom_requalification_days` | `fab_cleanroom_requalification_days` (Skor: `12.97`) | `working_capital_bridge_rate_pct` (Skor: `1.24`) | `working_capital_bridge_rate_pct` (Skor: `1.23`) |
| **4. Öncelik** | `industrial_electricity_spot_mwh_usd` | `working_capital_bridge_rate_pct` (Skor: `3.75`) | **`office_cafeteria_lighting_pct`** (Skor: `0.00`) | **`office_cafeteria_lighting_pct`** (Skor: `0.0001`) |

**Temel Bulgu:** Basit aralık/maliyet kuralı, `[0..100]` gibi geniş bir aralığa ve düşük maliyete (`25 USD`) sahip olduğu için kararı hiç etkilemeyen `office_cafeteria_lighting_pct` gürültü değişkenini 2. sıraya taşırken; **CAELUS Karar Duyarlılığı** ve **Bayesçi EIG Hibrit** yöntemleri bu değişkenin karar fayda salınımının `0` olduğunu tespit ederek son sıraya indirir ve karar sıralamasını gerçekten değiştiren `fab_cleanroom_requalification_days` değişkenini 1. sıraya yerleştirir.

---

## 4. 5 Çalıştırılabilir Python Laboratuvar Deneyi (`tools/run_discovery_research_lab.py`)

### Deney 6 (`EXP-06`): PyTorch GP Vekil Modeli (BoTorch/GPyTorch Posterior Varyans Formülü) vs. CAELUS Karar Duyarlılığı
- **Kütüphane:** `torch 2.11.0+cpu` (RBF Çekirdekli Tam Gauss Süreci posterior varyans ve bilgi kazanımı $\frac{1}{2}\log(1 + \sigma^2/\sigma_n^2)$ hesabı).
- **Sonuç:** Saf GP bilgi kazanımı (entropi azaltımı), varyansı en yüksek olan `non_critical_lighting_pct` değişkenini (`3.1145 nat`) 1. sıraya koyarken; CAELUS karar duyarlılığı karar eşiğini kesen `fab_cleanroom_requal_days` değişkenini (`75.6`) 1. sıraya koymuştur.
- **Metodolojik Not:** Kalibre edilmemiş sentetik GP vekil modeli gerçek ekonomik değer kanıtı değildir; entropi azaltımı ile karar değeri birbirinden farklıdır.

### Deney 7 (`EXP-07`): DoWhy 0.8 Açık Nedensel Grafik, Backdoor Tanımlama ve Karşı Sınama (Refutation)
- **Kütüphane:** `dowhy 0.8` (`CausalModel`, `identify_effect`, `backdoor.linear_regression`, `random_common_cause`, `data_subset_refuter`).
- **Sonuç:** `storm_severity` ve `financing_stress` ortak karıştırıcıları (confounders) kontrol edildiğinde `curtailment_days -> mcu_delay_days` yapısal etkisi **`1.6741`** (gerçek yapısal parametre: `1.65`) olarak tahmin edilmiş; `random_common_cause` altında **`1.6737`**, `%80 data_subset_refuter` altında **`1.6785`** çıkarak kararlılık testini geçmiştir (`passedRefutationStability: true`).
- **Epistemik Sınır:** DoWhy tahmini yalnızca tanımlanan DAG varsayımları altında geçerlidir; tek başına mutlak nedensellik kanıtı değildir.

### Deney 8 (`EXP-08`): River 0.26.1 ADWIN Zaman Serisi Değişim Tespiti (Değişimli Seri vs. Durağan Kontrol Serisi)
- **Kütüphane:** `river 0.26.1` (`river.drift.ADWIN(delta=0.002, clock=1)`).
- **Sonuç:**
  - `t=50` adımında rejim kırılması olan seride (`28 USD/MWh -> 185 USD/MWh`) değişim **`indeks 55`**’te yakalanmıştır (`driftDetectedOnShiftedSeries: true`).
  - Değişim olmayan durağan kontrol serisinde yanlış alarm sayısı **`0`**’dır (`stationaryControlFalseAlarms: 0`, `zeroFalseAlarmOnStationaryControl: true`).
- **Epistemik Sınır:** Değişim tespiti dağılımın değiştiğini gösterir; değişimin kök nedenini tek başına kanıtlamaz (`provesRootCause: false`).

### Deney 9 (`EXP-09`): PyTorch Zamansal Grafik Mesaj Geçişi (PyG Sözleşmesi) vs. Basit Çok Adımlı Yol Araması
- **Kütüphane:** `torch 2.11.0+cpu` (Kronolojik bölünme: `t=0..7` eğitim, `t=8..9` doğrulama, `t=10..11` test; `futureLeakage: false`).
- **Sonuç:** Öğrenilen mesaj geçiş modeli test MAE = **`0.0702`**, basit çok adımlı analitik yol yayılımı test MAE = **`0.0593`**. Az örnekli doğrusal rejimde basit çok adımlı yol aramasının daha düşük hata verdiği dürüstçe raporlanmış ve önerilen bağlantıların `CANDIDATE_HYPOTHESIS_LINK_NOT_PROVEN_CAUSALITY` olduğu korunmuştur.

### Deney 10 (`EXP-10`): Olasılıksal Deney Tasarımı (Pyro OED / Beklenen Bilgi Kazanımı — EIG) vs. En Ucuz Kaynak Kuralı
- **Sonuç:** Başlangıç hipotez entropisi `0.9928 bit` iken, en ucuz araştırma kuralı (`RES-GENERAL-WEATHER-SUMMARY`, `50 USD`) yalnızca **`0.0004 bit`** bilgi kazanımı sağlar ve hipotezleri ayıramaz; Bayesçi EIG ise rakip hipotezleri en güçlü ayıran `RES-AUSTIN-UPW-LOG` araştırmasını (**`0.4887 bit`**) 1. sıraya yerleştirir.
