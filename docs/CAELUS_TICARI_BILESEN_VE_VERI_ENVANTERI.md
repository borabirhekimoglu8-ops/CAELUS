# CAELUS — Ticari Bileşen, Lisans, Model Ağırlığı ve Veri Envanteri

- **İnceleme Tarihi:** `2026-11-09`
- **Makine Tarafından Okunabilir Envanter:** [`data/caelus_commercial_inventory.json`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/data/caelus_commercial_inventory.json)
- **Otomatik Denetim Fonksiyonu:** [`auditCommercialComponentInventory`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/living_world_model.js#L265-L345) (`ui/living_world_model.js`)
- **Hedef Dağıtım Biçimleri:**
  - `A.` Ücretli kapalı kaynak yazılım
  - `B.` Müşteri bilgisayarına yerel kurulum
  - `C.` Müşteri tesisine / özel sunucusuna (on-prem) kurulum
  - `D.` Çevrim dışı veya hava boşluklu (air-gapped) çalışma
  - `E.` İleride isteğe bağlı yönetilen bulut hizmeti
  - `F.` Müşteriye lisanslama veya şirket / varlık satışı

> **Önemli Not:** Bu envanter ve otomatik denetim kuralları mühendislik ve mimari düzeyde kırmızı çizgileri (GPL/AGPL yayılımı, Commons Clause kısıtları, ticari olmayan ücretsiz API katmanları ve doğrulanmamış model ağırlıkları) kontrol eder; "sıfır hukuki risk" iddiası taşımaz ve nihai hukuki inceleme yerine geçmez.

---

## 1. Ticari Durum Etiketleri Özeti

| Ticari Durum Etiketi | Tanım | Envanterdeki Bileşen Sayısı | Otomatik Paket Onayı |
|---|---|---|---|
| **`CAELUS’A ÖZGÜ`** | Projede geliştirilen birinci taraf bileşenler (`caelus_core`, C++17 motoru, Yaşayan Dünya Modeli, Senaryo Derleyicisi) | `3` | `Evet (autoApproved: true)` |
| **`ONAYLI ADAY`** | Seçilen sürüm ve planlanan kapalı kaynak / müşteri tesisi kurulumu için izin verici koşulları (MIT, Apache-2.0, BSD-3, ISC, Zlib, Public Domain) belgelenmiş bileşenler | `5` | `Evet (autoApproved: true)` (Atıf/NOTICE bildirimleri korunarak) |
| **`İNCELEMEDE`** | Bazı hakları, görsel atıf zinciri veya ticari API abonelik koşulları ayrıca doğrulama/sözleşme gerektiren bileşenler | `2` | **`Hayır (autoApproved: false)`** |
| **`TİCARİ PAKETİN DIŞINDA`** | Commons Clause, GPL-3.0, doğrulanmamış araştırma ağırlıkları veya kapalı dış servis olması nedeniyle ticari pakete dahil edilmeyen bileşenler | `4` | **`Hayır (autoApproved: false)`** |

---

## 2. 13 Soruluk Tam Ticari Bileşen, Kütüphane, Model, Görsel ve Veri Tablosu

| Bileşen Kimliği ve Adı | Kategori | Kaynak ve Sürüm | Lisans / Hizmet Sözleşmesi | Ticari Kullanım | Kapalı Kaynak Uyumu | Müşteri Tesisine (On-Prem) Yeniden Dağıtım | Kod Açma / Copyleft Yükümlülüğü | Atıf / Bildirim (NOTICE) Zorunluluğu | Model Ağırlığı Ayrı Koşulu | Çevrim Dışı Çalışma | Ücret / Kota / Sağlayıcı Bağımlılığı | Doğrudan Kaynak Bağlantısı | Ticari Durum Etiketi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **`caelus_core_rust_no_std`** — CAELUS Rust `#![no_std]` Nedensel Çekirdek | Çekirdek Kod | `caelus_core/src/lib.rs` (`v0.1.0`) | CAELUS Özgün Mülkiyeti | Evet | Evet | Evet | Yok | Hayır | Yok (Derin ağ ağırlığı içermez) | Evet | Yok | `caelus_core/Cargo.toml` | **`CAELUS’A ÖZGÜ`** |
| **`caelus_cpp17_causal_engine`** — C++17 Nedensel Motor & REPL | Çekirdek Kod | `src/causal_engine.hpp`, `src/main.cpp` (`v9.0`) | CAELUS Özgün Mülkiyeti | Evet | Evet | Evet | Yok (GCC Runtime Library Exception v3.1 / MSVC) | Hayır | Yok | Evet | Yok | `src/causal_engine.hpp` | **`CAELUS’A ÖZGÜ`** |
| **`caelus_living_world_model_js`** — Yaşayan Dünya Modeli, Hipotez Defteri & Senaryo Derleyici | Çekirdek Kod | `ui/living_world_model.js`, `ui/scenario_compiler.js`, `ui/app.js` (`v1.0.0`) | CAELUS Özgün Mülkiyeti | Evet | Evet | Evet | Yok | Hayır | Yok | Evet | Yok | `ui/living_world_model.js` | **`CAELUS’A ÖZGÜ`** |
| **`rust_crypto_dalek_blake3_stack`** — Rust Kriptografi Yığını | Üçüncü Taraf Kütüphane | `ed25519-dalek@2.1`, `x25519-dalek@2.0`, `blake3@1.5`, `rand@0.8`, `subtle@2.5`, `zeroize@1.7` | BSD-3-Clause, MIT, Apache-2.0, CC0-1.0 | Evet | Evet | Evet | Yok | Evet (Telif ve BSD/MIT/Apache metinleri) | Yok | Evet | Yok | `https://github.com/dalek-cryptography/curve25519-dalek` | **`ONAYLI ADAY`** |
| **`cesium_js_1_114_0`** — CesiumJS 3B Küre + `NaturalEarthII` Karo Seti | Üçüncü Taraf Kütüphane & Harita | `ui/vendor/cesium/` (`1.114.0`) | Apache License 2.0 + Natural Earth II (Public Domain) | Evet | Evet | Evet | Yok (`LICENSE.md` ve `NOTICE` korunmalı) | Evet | Yok | Evet | Yok (Cesium Ion bulut anahtarı kullanılmaz) | `https://github.com/CesiumGS/cesium/blob/1.114/LICENSE.md` | **`ONAYLI ADAY`** |
| **`ui_permissive_vendor_bundle`** — MapLibre GL `5.2.0`, ECharts `5.5.1`, Carbon Charts `1.27.27`, Cytoscape `3.34.4`, deck.gl `9.4.1`, vis-timeline `7.7.3`, Perspective `3.8.0`, Three.js `0.187.0` + 3DTilesRenderer `0.5.4`, Motion `11.11.17`, Lucide `1.70.0` | Üçüncü Taraf UI Kütüphaneleri | `ui/vendor/` sabitlenmiş yerel paketler | MIT, BSD-3-Clause,Apache-2.0, ISC, Zlib | Evet | Evet | Evet | Yok (Ücretli Motion+ ve Web Awesome Pro hariç tutulmuştur) | Evet (`ui/vendor/THIRD_PARTY_LICENSES.md`) | Yok | Evet | Yok (IBM Carbon telemetrisi kapalı) | `ui/vendor/THIRD_PARTY_LICENSES.md` | **`ONAYLI ADAY`** |
| **`public_domain_us_gov_datasets`** — USGS Deprem GeoJSON, NASA GIBS/EONET/JPL Horizons, FERC/NERC 2021 Raporu | Veri Kümeleri ve Açık Servisler | USGS FDSNWS v1, NASA EONET v3, JPL Horizons v1.2, FERC/NERC Nov 2021 | ABD Kamu Malı (`17 U.S.C. § 105`) / NASA Open Data Policy | Evet | Evet | Evet | Yok | Evet (Kaynak atfı; resmi kurum onayı izlenimi verilmemeli) | Yok | Evet (Örnek vaka paketleri yereldir) | Canlı sorgularda adil kullanım hız sınırı vardır | `https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits` | **`ONAYLI ADAY`** |
| **`dowhy_pyg_research_candidates`** — PyTorch Geometric (`PyG`) & `DoWhy` | Araştırma Kütüphaneleri | `PyG >= 2.5`, `DoWhy >= 0.11` | MIT License | Evet | Evet | Evet | Yok (Alt bağımlılık ağacı ayrıca denetlenmeli) | Evet | Kütüphane kodu MIT; dışarıdan indirilecek ağırlıklar ayrıca incelenmeli | Evet | Yok (CAELUS çalışma zamanı çekirdeği bunlara bağımlı değildir) | `https://github.com/pyg-team/pytorch_geometric/blob/master/LICENSE` | **`ONAYLI ADAY`** |
| **`spacekit_eso_skybox_assets`** — Spacekit.js içindeki `eso_milkyway.jpg` ve `eso_lite.png` görselleri | Görsel Varlık | `ui/vendor/spacekit/assets/skybox/` (`0.1.1`) | Spacekit kodu MIT; ancak `eso_*` görselleri ESO CC BY 4.0 koşullarına tabidir ve `README.md` içinde yalnızca `nasa_tycho.jpg` (Public Domain) belgelenmiştir | Koşullu (Atıf ile) | Evet | **Doğrulama Bekliyor** | CC BY 4.0 tam görüntü kimliği ve ESO telif bildirimi doğrulanmalı | Evet | Yok | Evet | Yok | `https://www.eso.org/public/copyright/` | **`İNCELEMEDE`** |
| **`open_meteo_public_api`** — Open-Meteo Hava ve Deniz Tahmin API’si | Dış Servis | `https://api.open-meteo.com/v1/forecast` | Veri: CC BY 4.0; **Ücretsiz Barındırılan API: Yalnızca Ticari Olmayan (Non-Commercial) kullanım içindir** | **Hayır (Ücretsiz API katmanında)** | Evet | **Hayır (Bulut API)** | Ticari dağıtımda ücretli Open-Meteo Ticari API aboneliği veya kendi sunucunda (self-hosted) çalıştırma gerekir | Evet (`Weather data by Open-Meteo.com`) | Yok | Hayır (Canlı API) | Ticari kullanımda ücretli abonelik gerekir | `https://open-meteo.com/en/terms` | **`İNCELEMEDE`** |
| **`davidhdev_react_bits`** — React Bits | Üçüncü Taraf Kütüphane | Harici aday (`ui/vendor/react-bits-audit/AUDIT_NOTICE.md`) | `MIT + Commons Clause License Condition v1.0` | **Hayır (Paket/Port satışı yasak)** | **Hayır** | **Hayır** | Commons Clause v1.0 bileşenlerin paket içinde veya port edilmiş sürüm olarak satışını yasaklar | Evet | Yok | Evet | Yeniden dağıtım yasağı | `https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md` | **`TİCARİ PAKETİN DIŞINDA`** |
| **`gpl_isolated_engines_neo4j_openfoam`** — Neo4j Community (GPLv3) & OpenFOAM (GPLv3) | Harici Motorlar | Harici süreç adaptörleri (Depoda GPL kodu yoktur) | `GPL-3.0` | Evet (Ayrı süreçte) | **Hayır (Gömülü ikili olarak)** | **Hayır (Paket içinde)** | Kapalı kaynaklı ikiliyle birlikte dağıtılması durumunda GPL-3.0 kaynak kodu açma yükümlülüğü doğurur | Evet | Yok | Evet | Yok | `https://www.gnu.org/licenses/gpl-3.0.html` | **`TİCARİ PAKETİN DIŞINDA`** |
| **`vjepa2_visual_world_model_weights`** — Meta FAIR V-JEPA 2 / V-JEPA 2.1 Ağırlıkları | Model Ağırlıkları | Meta FAIR V-JEPA 2 | Kod izin verici olsa da önceden eğitilmiş ağırlıklar ve eğitim veri kümeleri (Ego4D/HowTo100M) ayrı araştırma koşullarına tabidir | **Doğrulanmadı / Hayır** | **Hayır** | **Hayır** | Model ağırlığı ve eğitim verisi ticari yeniden dağıtım hakları doğrulanmamıştır | Evet | **Evet — Ağırlıklar ayrı koşullara tabidir** | Hayır (Yüksek VRAM GPU gerekir) | Donanım ve ağırlık lisansı kısıtı | `https://github.com/facebookresearch/vjepa2` | **`TİCARİ PAKETİN DIŞINDA`** |
| **`genie_closed_world_service`** — Google DeepMind Genie / Genie 2 | Kapalı Dış Servis | Proprietary Research Preview | Kapalı kaynak / Ticari yeniden dağıtım ve müşteri tesisine kurulum hakkı yoktur | **Hayır** | **Hayır** | **Hayır** | Müşteri tesisine kurulamaz, çevrim dışı çalışamaz | Evet | Ağırlıklar kapalıdır | Hayır | Tam dış sağlayıcı bağımlılığı | `https://deepmind.google/discover/blog/genie-2-a-large-scale-foundation-world-model/` | **`TİCARİ PAKETİN DIŞINDA`** |

---

## 3. Teknik ve Hukuki Değerlendirme Gerektiren Açık Sorular

1. **Open-Meteo Ticari Dağıtım Kararı:** CAELUS ücretli kapalı kaynak ürün olarak müşteriye satıldığında canlı hava/deniz bağlantısı etkinleştirilecekse, ya Open-Meteo Commercial API lisansı alınmalı ya da müşteri tesisinde doğrudan NOAA GFS / ECMWF açık GRIB2 veri çekme hattı yapılandırılmalıdır. (Çevrim dışı deterministik çekirdek Open-Meteo’ya bağımlı değildir.)
2. **Spacekit Skybox Görsel Temizliği:** `ui/vendor/spacekit/assets/skybox/` dizinindeki `eso_milkyway.jpg` ve `eso_lite.png` dosyaları ticari kapalı kaynak kurulum paketinden çıkarılarak yalnızca NASA SVS Public Domain olan `nasa_tycho.jpg` bırakılmalı veya ürünün "Hakkında / Lisanslar" ekranına ESO CC BY 4.0 atıf metni eklenmelidir.
3. **Müşteri Tarafında Yerel Dil Modeli (Ollama / Qwen2.5):** Kullanıcı kendi bilgisayarında yerel Ollama çalıştırdığında `qwen2.5:1.5b` ve `qwen2.5:7b` Apache-2.0 lisanslıdır; ancak `qwen2.5:3b` sürümü Qwen Research License koşullarına tabidir. Bu nedenle ticari kurulum kılavuzunda yalnızca Apache-2.0 lisanslı ağırlıklar (`qwen2.5:1.5b` / `7b`) önerilmelidir.
