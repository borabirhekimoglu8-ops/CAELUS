# CAELUS — 10 GitHub UI / 3B Depo Entegrasyonu Teslim Raporu

**Genel durum:** TAMAMLANDI (`7 GERÇEK ENTEGRE / TEST EDİLDİ` + `2 GERÇEK ENTEGRE / KONTROLLÜ VERİYLE` + `1 ENGELLİ [Commons Clause v1.0 nedeniyle dışlandı, özgün MIT karşılığı uygulandı]`)  
**Tarih ve test ortamı:** 2026-11-08 · Windows 10/11 x64 (`win32 10.0.26200`), Node.js `v24.14.0`, MinGW-w64 `g++ 15.2.0` (`-std=c++17 -O3 -flto`), Rust `cargo 1.94.0`, Python `3.12.10`, Microsoft Edge Headless WebGL2 (`--enable-webgl --ignore-gpu-blocklist`, CDP port `9382`).  
**İncelenen proje ve sürümü:** `c:\Users\Lenovo\Desktop\CAELUS-main` — CAELUS OS v9 (`dist/caelus_os_v9.exe`, `5.426.688 bayt`, SHA-256: `A41521F7D9E94F6AB706A53610098C859F857D53E5EB43858FC91093D1E68EBB`).

---

## 1. Yapılan Değişiklikler

| Görünüm | Değişiklik | Uygulamadaki Yol | Kanıt / Ekran Görüntüsü |
|---|---|---|---|
| **Dünyam** | Ana **CesiumJS 1.114** 3B Küre sahnesine ek olarak tek aktif WebGL motoru kuralıyla seçilebilir **OpenAtlas v0.1.0 GLSL 3B Küre** (`#btn-engine-openatlas`), **NASA-AMMOS 3DTilesRendererJS v0.5.4** yerel OGC 3D Tiles 1.0 liman sektörleri sahnesi (`#btn-engine-3dtiles`), **pmndrs/postprocessing v6.39.6** kontrollü Bloom hattı (`#dunyam-three-postfx-line`), **Theatre.js `@theatre/core` v0.7.2** kullanıcı tetiklemeli/kesilebilir sinematik kamera geçişi (`#btn-dunyam-theatre-focus`), **Paper Shaders v0.0.82** dekoratif üst marka ışığı (`#caelus-brand-shader-canvas`) ve **Lucide v1.70.0** yerel SVG ikonları eklendi. | `ui/index.html` (`#dunyam-3d-engine-switcher`, `#dunyam-three-stage-container`, `#dunyam-active-layer-telemetry`), `ui/app.js` (`mountThreeStageForMode`, `switchDunyam3DEngine`, `runCaelusTheatreCameraTransition`, `mountCaelusPaperShaderAura`), `core_engine.cpp` (`/vendor/*`, `/assets/tilesets/*` statik sunucusu) | `repo10_01_dunyam_cesium_lucide_theatre_1440x900.png`, `repo10_02_dunyam_openatlas_postfx_1440x900.png`, `repo10_03_dunyam_3dtiles_izmir_port_1440x900.png`, `repo10_12_dunyam_1366x768.png`, `repo10_14a_mobil_dunyam_390x844.png` |
| **Keşfet / Uzay (Kozmos)** | **Keşfet** görünümüne çevrimdışı yerel `NaturalEarthII` TMS + CAELUS GeoJSON varlık, deniz koridoru, USGS deprem ve Open-Meteo noktalarını gösteren **MapLibre GL JS v5.2.0** 2B/2.5B bölgesel harita (`#kesfet-maplibre-panel`) eklendi. **Kozmos** görünümüne **Spacekit v0.1.1** 3B WebGL Güneş Sistemi ve J2000.0 Kepler yörünge sahnesi (`#kozmos-spacekit-container`) entegre edildi. | `ui/index.html` (`#kesfet-maplibre-panel`, `#kozmos-spacekit-container`), `ui/app.js` (`mountKesfetMapLibreView`, `buildKesfetMapLibreGeoJson`, `mountKozmosSpacekitScene`, `switchKozmosRenderEngine`) | `repo10_04_kesfet_maplibre_regional_1440x900.png`, `repo10_05_kozmos_spacekit_3d_orbits_1440x900.png`, `repo10_14b_mobil_kesfet_maplibre_390x844.png`, `repo10_14c_mobil_kozmos_spacekit_390x844.png` |
| **Senaryolar** | C++17 nedensel motorunun (`compare_lever`) A/B karşılaştırma çıktısını (`Başlangıç Yükü (t=0)`, `Müdahalesiz Koşum (Dal A)`, `Müdahaleli / Kontrollü Plan (Dal B)`) kurumsal **Carbon Charts `@carbon/charts` v1.27.27** `GroupedBarChart` bileşeniyle ve ekran okuyucu / klavye uyumlu HTML veri tablosuyla (`#caelus-carbon-chart-a11y-tbody`) gösteren karşılaştırma paneli eklendi. | `ui/index.html` (`#cf-carbon-charts-box`, `#caelus-carbon-chart-holder`, `#caelus-carbon-chart-a11y-tbody`), `ui/scenario_compiler.js` (`buildCarbonChartsScenarioComparisonData`), `ui/app.js` (`renderCaelusCarbonScenarioChart`) | `repo10_06_senaryolar_carbon_charts_echarts_1440x900.png`, `repo10_10_rapor_ve_modal_1440x900.png`, `repo10_13_senaryolar_1366x768.png`, `repo10_14d_mobil_senaryolar_carbon_390x844.png` |
| **Hafıza** | **vis-timeline v7.7.3** ve kronolojik Zaman Tekeri (`#hafiza-wheel-canvas`) üzerinde gerçek olaylar (`REAL_EVENT`), veri kaynakları (`DATA_SOURCE`), kaydedilmiş senaryolar (`SAVED_SCENARIO`) ve kullanıcı işlemleri (`USER_ACTION`) birbirine karıştırılmadan çift zaman damgasıyla (`t_olay`, `t_kayıt`) korundu. | `ui/index.html` (`#hafiza-clean-workspace`, `#hafiza-vis-timeline-container`), `ui/app.js` (`renderHafizaStreamWorkspace`) | `repo10_07_hafiza_vis_timeline_1440x900.png`, `repo10_14e_mobil_hafiza_390x844.png` |
| **Bağlantılar** | İzinli açık veri kaynaklarına ek olarak 10 GitHub deposunun sürüm, lisans, varlık denetimi, somut dosya yolu ve canlı sahne doğrulama kısayollarını içeren **10 Depolu UI ve 3B Sahne Entegrasyon Matrisi** (`#ten-repo-integration-hub-panel`) eklendi. | `ui/index.html` (`#ten-repo-integration-hub-panel`, `#ten-repo-cards-grid`), `ui/scenario_compiler.js` (`CaelusTenRepoRegistry`), `ui/app.js` (`renderTenRepoIntegrationHubUI`) | `repo10_08_baglantilar_10_repo_kabul_matrisi_1440x900.png` |
| **Ayarlar ve diğerleri** | **Paper Shaders v0.0.82** (`MESH` / `ORBIT` / `OFF`) kontrolü, `DEKORATİF MARKA IŞIĞI · VERİ DEĞİLDİR` rozeti, **React Bits** `Commons Clause v1.0` lisans denetim bildirimi (`#react-bits-audit-badge`) ve CAELUS'un %100 MIT uyumlu özgün Vanilla JS mikro-etkileşim seçicisi (`CaelusOriginalSpotlightPrefs` / `#caelus-original-spotlight-prefs`) eklendi. | `ui/index.html` (`#quiet-10repo-shader-spotlight-card`, `#caelus-original-spotlight-prefs`), `ui/app.js` (`initCaelusOriginalSpotlightPrefs`, `setCaelusPaperShaderMode`), `ui/vendor/react-bits-audit/AUDIT_NOTICE.md` | `repo10_09_ayarlar_paper_shaders_spotlight_1440x900.png`, `repo10_11_acik_tema_ve_cevrimdisi_1440x900.png` |

---

## 2. On Depo Durum ve Kanıt Tablosu

| Depo | Durum | Sürüm / Lisans | Üründeki Kullanım ve Kod Yolu | Test, Kanıt veya Somut Engel |
|---|---|---|---|---|
| **1. OpenAtlas Globe** (`OpenAtlasProject/OpenAtlas`) | `GERÇEK ENTEGRE / KONTROLLÜ VERİYLE` | `v0.1.0` · MIT License (Kod). Doku: CAELUS yerel CC0 `NaturalEarthII` (`OpenAtlas` `public/textures/earth` dokuları `ATTRIBUTIONS.md` uyarınca belgesiz olduğu için dışlandı). | `ui/vendor/three-stack/caelus-three-stack.min.js` (`CAELUS_OpenAtlasGlobe`), `ui/app.js` (`mountThreeStageForMode('OPENATLAS')`), `ui/scenario_compiler.js` (`verifyOpenAtlasGlobeMath`). `Dünyam` → `OpenAtlas 3B Küre (GLSL)` modu. | Test 47 (`norm = 1.0`, `isUnitSphereConsistent = true`, `spinStepHalfSecRad = 0.02244`), canlı WebGL2 (`1.0 ms/kare`), `repo10_02_dunyam_openatlas_postfx_1440x900.png`. |
| **2. NASA-AMMOS 3DTilesRendererJS** (`NASA-AMMOS/3DTilesRendererJS`) | `GERÇEK ENTEGRE / KONTROLLÜ VERİYLE` | `v0.5.4` (`3d-tiles-renderer`) · Apache License 2.0 | `ui/vendor/three-stack/caelus-three-stack.min.js` (`CAELUS_3DTilesRenderer`), `ui/assets/tilesets/izmir_port_sample/tileset.json` + 4 `.glb` dosyası, `ui/app.js` (`mountThreeStageForMode('3DTILES')`). `Dünyam` → `3D Tiles Sahnesi (NASA-AMMOS)` modu. | Test 47 (OGC 3D Tiles 1.0 `tileset.json` + 4 adet `.glb` ikili glTF 2.0 `magic=0x46546C67` doğrulaması), canlı sahne (`tilesLoadedCount = 4`, `1.5 ms/kare`), `repo10_03_dunyam_3dtiles_izmir_port_1440x900.png`. |
| **3. Spacekit** (`typpo/spacekit`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v0.1.1` (`spacekit.js`) · MIT License (NASA SVS Tycho Public Domain + Yale BSC5) | `ui/vendor/spacekit/spacekit.js`, `ui/vendor/spacekit/assets/`, `ui/app.js` (`mountKozmosSpacekitScene`, `switchKozmosRenderEngine`), `ui/index.html` (`#kozmos-spacekit-container`). `Kozmos` → `3B Spacekit Sahnesi`. | Test 47, canlı tarayıcı (`mounted = true`, `planetCount = 8`, `canvasPresent = true`), `repo10_05_kozmos_spacekit_3d_orbits_1440x900.png`, `repo10_14c_mobil_kozmos_spacekit_390x844.png`. |
| **4. Paper Shaders** (`paper-design/shaders`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v0.0.82` (`@paper-design/shaders`) · MIT License | `ui/vendor/paper-shaders/paper-shaders.min.js`, `ui/app.js` (`mountCaelusPaperShaderAura`, `setCaelusPaperShaderMode`), `ui/index.html` (`#caelus-brand-shader-canvas`). Üst marka başlığı dekoratif kozmik ışık katmanı. | Test 47, canlı WebGL2 (`paperShaderMounted = true`, `mode = "MESH"`, `DEKORATİF MARKA IŞIĞI · VERİ DEĞİLDİR`), `repo10_01`, `repo10_09_ayarlar_paper_shaders_spotlight_1440x900.png`. |
| **5. Theatre.js** (`theatre-js/theatre`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v0.7.2` (`@theatre/core`) · Apache License 2.0 (`@theatre/studio` üretim paketine dahil edilmedi) | `ui/vendor/theatre/theatre-core.min.js`, `ui/app.js` (`ensureCaelusTheatreProject`, `runCaelusTheatreCameraTransition`, `cancelCaelusTheatreCameraTransition`), `ui/index.html` (`#btn-dunyam-theatre-focus`). | Test 47, canlı geçiş (`AEGEAN_PORT`, `USGS_EPICENTER`, `GLOBAL_OVERVIEW`), `0` konsol/sayfa hatası, `repo10_01_dunyam_cesium_lucide_theatre_1440x900.png`. |
| **6. pmndrs/postprocessing** (`pmndrs/postprocessing`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v6.39.6` (`postprocessing`) · Zlib / MIT License | `ui/vendor/three-stack/caelus-three-stack.min.js` (`CAELUS_PostProcessing`), `ui/app.js` (`configureThreeStagePostProcessing`, `setThreeStagePostFxMode`). Three.js sahnelerinde isteğe bağlı Bloom hattı. | Test 47, canlı kare süresi ölçümü (`PostFX (pmndrs 6.39.6): Normal Bloom · 1.0–1.5 ms/kare · 1432×846 FB`), `repo10_02`, `repo10_03`. |
| **7. MapLibre GL JS** (`maplibre/maplibre-gl-js`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v5.2.0` (`maplibre-gl`) · BSD-3-Clause License | `ui/vendor/maplibre-gl/maplibre-gl.js`, `ui/vendor/maplibre-gl/maplibre-gl.css`, `ui/app.js` (`mountKesfetMapLibreView`), `ui/index.html` (`#kesfet-maplibre-panel`). `Keşfet` → `Bölgesel Harita (MapLibre GL JS)`. | Test 47, canlı WebGL harita kanvası (`mounted = true`, `canvasPresent = true`), yerel `NaturalEarthII` TMS + GeoJSON katmanı, `repo10_04`, `repo10_14b`. |
| **8. React Bits** (`DavidHDev/react-bits`) | `ENGELLİ` | `MIT + Commons Clause License Condition v1.0` (Kısıtlayıcı) + React 19 bağımlılığı | `ui/vendor/react-bits-audit/AUDIT_NOTICE.md`, `ui/app.js` (`initCaelusOriginalSpotlightPrefs`), `ui/index.html` (`#react-bits-audit-badge`, `#caelus-original-spotlight-prefs`). | **Somut Engel:** Kaynak deponun `LICENSE.md` dosyasında `Commons Clause v1.0` ticari/yeniden dağıtım kısıtı tespit edildi. Harici kod dahil edilmedi; yerine %100 MIT uyumlu özgün Vanilla JS `CaelusOriginalSpotlightPrefs` yazıldı (`repo10_08`, `repo10_09`, Test 47). |
| **9. Carbon Charts** (`carbon-design-system/carbon-charts`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v1.27.27` (`@carbon/charts`) · Apache License 2.0 | `ui/vendor/carbon-charts/carbon-charts.min.js`, `ui/vendor/carbon-charts/styles.min.css`, `ui/scenario_compiler.js` (`buildCarbonChartsScenarioComparisonData`), `ui/app.js` (`renderCaelusCarbonScenarioChart`). | Test 47 (`15` karşılaştırma satırı, `5` varlık/sektör), canlı SVG grafik + erişilebilir HTML tablo (`#caelus-carbon-chart-a11y-tbody`), `repo10_06`, `repo10_14d`. |
| **10. Lucide** (`lucide-icons/lucide`) | `GERÇEK ENTEGRE / TEST EDİLDİ` | `v1.70.0` (`lucide`) · ISC License | `ui/vendor/lucide/lucide.min.js`, `ui/app.js` (`refreshCaelusLucideIcons`), `ui/index.html` (`[data-lucide]`). | Test 47, canlı DOM'da 13 SVG ikon (`lucideCount = 13`, `svgCount = 13`, `aria-hidden="true"`), `repo10_01`–`repo10_14e`. |

---

## 3. Gerçek Veri, Doğruluk ve Lisanslar

| Özellik / Kaynak | Gözlem, Hesap, Örnek veya Kurgu | Tarih / Güncellik | Kaynak ve Lisans / Atıf | Sınır ve Bağlantı Kesilince Davranış |
|---|---|---|---|---|
| **CesiumJS / OpenAtlas / MapLibre Taban Haritası (`NaturalEarthII`)** | Doğrulanmış yerel coğrafi taban haritası | Statik yerel TMS piramidi (`z=0..2`) | Natural Earth II (`ui/vendor/cesium/Assets/Textures/NaturalEarthII`) · **Public Domain (CC0)** | Tamamen çevrimdışı çalışır; internet kesildiğinde de yerel C++ sunucusundan (`http://127.0.0.1:47809/vendor/...`) sunulur. |
| **İzmir Limanı 3D Tiles Sektör Kümesi (`izmir_port_sample`)** | Kontrollü yerel yapı/sektör modeli (`GERÇEK ENTEGRE / KONTROLLÜ VERİYLE`) | Yerel deterministik üretim (`tileset.json` + 4 `.glb`) | CAELUS Özgün OGC 3D Tiles 1.0 Veri Kümesi · **CC0-1.0 / MIT** | Ücretli Google Photorealistic 3D Tiles veya Cesium Ion token'ı gerektirmez; gerçek CAD/BIM taraması değil, 4 liman sektörünün (`PORT_TRAFO_BESLEME`, `SOGUK_ZINCIR_REEFER`, `GUMRUK_KAPI_KORIDORU`, `VINC_OPERASYON_HATTI`) ölçekli glTF 2.0 kutu geometrisidir. |
| **Kozmos Güneş Sistemi Yörüngeleri (Spacekit + J2000.0)** | Analitik yörünge hesabı (`HESAPLANMIŞ DEĞER` / `REFERANS EFEMERİS`) | `1800-01-01` – `2050-12-31 UTC` | NASA JPL Standish (1992) J2000.0 Tablo 1 + NASA SVS Tycho (`Public Domain`) + Yale Bright Star Catalog (`BSC5`) | Canlı uzay aracı telemetrisi değildir; `1800–2050` dışındaki tarihlerde (örn. `2120-06-15`) açık kapsam dışı uyarısı (`#univ-epoch-warning-banner`) verir. |
| **USGS Deprem Kayıtları & Open-Meteo Hava/Deniz** | USGS: `GERÇEK GÖZLEM` · Open-Meteo: `HAVA MODELİ / TAHMİN` | Çift zaman damgası: `t_olay` (ölçüm zamanı) ve `t_kayıt` (son alım zamanı) | USGS Earthquake Hazards Program (**Public Domain**) · Open-Meteo / DWD ICON (**CC BY 4.0**) | Bağlantı kesildiğinde son bilinen yerel kayıt tarih ve saatiyle korunur; asla "canlı" gibi etiketlenmez ve tek nokta rüzgâr verisi tüm Dünya rüzgâr katmanı gibi genellenmez. |
| **Paper Shaders Üst Marka Işığı** | `DEKORATİF MARKA IŞIĞI · VERİ DEĞİLDİR` | Yalnızca görsel tema katmanı | `@paper-design/shaders` v0.0.82 · **MIT License** | Gerçek veri veya fiziksel simülasyon değildir; `Ayarlar` ekranından veya `prefers-reduced-motion` ile tamamen kapatılabilir (`0 GPU yükü`). |

- **3B motorlar, görünümler ve eşzamanlı çalışma:** `Dünyam` görünümünde aynı anda yalnızca **tek bir** 3B motor (`CESIUM`, `OPENATLAS` veya `3DTILES`) çalışır. `switchDunyam3DEngine` çağrıldığında önceki Three.js `WebGLRenderer`, `EffectComposer`, geometriler ve dokular `disposeActiveThreeStage()` ile GPU belleğinden temizlenir; sekme gizlendiğinde (`document.hidden`) veya başka sayfaya geçildiğinde `requestAnimationFrame` döngüsü durdurulur.
- **Rüzgâr, olaylar ve yörüngelerin gerçek kaynak kontrolü:** USGS sismik olayları (`usgs_earthquake_feed`), Open-Meteo atmosfer/deniz tahminleri (`open_meteo_ marine/weather`) ve J2000.0 gezegen konumları birbirinden ayrı veri sınıflarıyla etiketlenir.
- **Gerçek motor A/B akışı ve bağlantı kesintisi:** `Senaryolar` görünümünde `İki durumu karşılaştır` (`#btn-run-compare-lever`) tıklandığında C++17 motoru (`dist/caelus_os_v9.exe`) `compare_lever` komutunu çalıştırır ve sonuçlar hem ECharts hem de **Carbon Charts** (`#caelus-carbon-chart-holder`) + erişilebilir HTML tablosuna (`#caelus-carbon-chart-a11y-tbody`) aktarılır. Motor bağlantısı kesildiğinde (`repo10_11`) `#engine-offline-banner` açılır ve sahte JS simülasyonu çalıştırılmaz.

---

## 4. Testler ve Performans

| Komut / Test | Ortam | Sonuç ve Kanıt | Atlanan veya Başarısız İşler |
|---|---|---|---|
| `node --test tests/universal_scenario_compiler.test.mjs` | Node.js `v24.14.0` (Windows x64) | **41 / 41 test bloğu (Test 1–47) GEÇTİ (`0 fail`)**. Test 47, 10 deponun tamamının kayıtlarını, OpenAtlas küre matematiğini, 3D Tiles `.glb` ikili başlıklarını, Carbon Charts veri dönüşümünü ve React Bits `ENGELLİ` denetimini doğrular. | Yok (`0` başarısız, `0` atlanan). |
| `node verify_and_capture_10repo.mjs` (`dist/caelus_os_v9.exe` + Headless Edge CDP) | `dist/caelus_os_v9.exe` (`port 47815`) + Microsoft Edge WebGL2 (`1440×900`, `1366×768`, `390×844`) | **12/12 statik varlık `HTTP 200 OK`**, **18/18 ekran görüntüsü yakalandı**, **`consoleErrors: []` (`0` hata)**, **`pageErrors: []` (`0` hata)**. | Yok. |
| `python tests/verify_universal_python_stack.py` | Python `3.12.10` (`numpy`, `scipy`, ` networkx`, `simpy`, `dowhy`, `pyomo`, `h3`, `pandapower`, `WNTR`) | **`[VERIFY-PYTHON-STACK] OK`** (`9415.45 ms`) — `tests/universal_python_stack_report.json` güncellendi. | Yok. |

- **Masaüstü ve mobil görsel inceleme dosyaları:**
  - `repo10_01_dunyam_cesium_lucide_theatre_1440x900.png` (928 KB)
  - `repo10_02_dunyam_openatlas_postfx_1440x900.png` (531 KB)
  - `repo10_03_dunyam_3dtiles_izmir_port_1440x900.png` (247 KB)
  - `repo10_04_kesfet_maplibre_regional_1440x900.png` (378 KB)
  - `repo10_05_kozmos_spacekit_3d_orbits_1440x900.png` (442 KB)
  - `repo10_06_senaryolar_carbon_charts_echarts_1440x900.png` (170 KB)
  - `repo10_07_hafiza_vis_timeline_1440x900.png` (366 KB)
  - `repo10_08_baglantilar_10_repo_kabul_matrisi_1440x900.png` (348 KB)
  - `repo10_09_ayarlar_paper_shaders_spotlight_1440x900.png` (342 KB)
  - `repo10_10_rapor_ve_modal_1440x900.png` (290 KB)
  - `repo10_11_acik_tema_ve_cevrimdisi_1440x900.png` (1.27 MB)
  - `repo10_12_dunyam_1366x768.png` (1.03 MB)
  - `repo10_13_senaryolar_1366x768.png` (261 KB)
  - `repo10_14a_mobil_dunyam_390x844.png` (274 KB)
  - `repo10_14b_mobil_kesfet_maplibre_390x844.png` (111 KB)
  - `repo10_14c_mobil_kozmos_spacekit_390x844.png` (130 KB)
  - `repo10_14d_mobil_senaryolar_carbon_390x844.png` (80 KB)
  - `repo10_14e_mobil_hafiza_390x844.png` (140 KB)
- **Erişilebilirlik / dil / hareket azaltma:** `tr-TR` ve `en-US` tam çeviri + `ar-SA` / `he-IL` RTL düzeni (`83/83` anahtar), `prefers-reduced-motion` altında Paper Shaders'ın durdurulması ve Theatre.js kamera geçişlerinin `INSTANT_REDUCED_MOTION` modunda anında tamamlanması, Carbon Charts altında ekran okuyucu uyumlu HTML karşılaştırma tablosu (`#caelus-carbon-chart-a11y-tbody`) doğrulandı.
- **Intel UHD 620 gerçek ölçümü veya ölçülmedi açıklaması:** Bu geliştirme makinesinde fiziksel Intel UHD Graphics 620 donanımı bulunmadığından gerçek UHD 620 donanım ölçümü yapılmamıştır (ölçülmediği açıkça raporlanmıştır). Bunun yerine düşük GPU profili (`devicePixelRatio` üst sınırı `1.25–1.5`, tek aktif WebGL sahnesi, PostFX `Kapalı / Düşük / Normal` seçicisi) uygulanmış ve bu makinedeki Headless Edge WebGL2 ortamında OpenAtlas + PostFX `1.0 ms/kare`, 3DTiles + PostFX `1.5 ms/kare` olarak ölçülmüştür.
- **Gerçek Windows EXE çalıştırması:** `dist/caelus_os_v9.exe` doğrudan Windows süreç olarak (`spawn(EXE_PATH, ['--scenario', 'BS-01_SAHTE_UFUK', '--repl'])`) başlatılmış, gömülü UI ve `/vendor/*` + `/assets/tilesets/*` uç noktalarının tamamı (`HTTP 200 OK`) ve WebSocket nedensel motoru gerçek tarayıcı oturumuyla doğrulanmıştır.

---

## 5. Paket ve Veri Korunması

- **Derlenen EXE yolu, SHA-256 ve paketlenmiş varlıklar:**
  - **Yol:** `c:\Users\Lenovo\Desktop\CAELUS-main\dist\caelus_os_v9.exe`
  - **Boyut:** `5.426.688 bayt` (`5,17 MB` — `< 50 MB` statik ikili sınırının çok altında)
  - **SHA-256:** `A41521F7D9E94F6AB706A53610098C859F857D53E5EB43858FC91093D1E68EBB`
  - **Gömülü UI Başlığı:** `c:\Users\Lenovo\Desktop\CAELUS-main\include\ui_payload.h` (`16.184.836 bayt`)
  - **Yerel Paketlenen Varlıklar (`ui/vendor/` ve `ui/assets/`):**
    - `ui/vendor/three-stack/caelus-three-stack.min.js` (Three.js `0.167.1` + OpenAtlas Globe `0.1.0` + NASA-AMMOS `3d-tiles-renderer` `0.5.4` + `postprocessing` `6.39.6`)
    - `ui/vendor/spacekit/spacekit.js` + `ui/vendor/spacekit/assets/` (`spacekit.js` `0.1.1`)
    - `ui/vendor/paper-shaders/paper-shaders.min.js` (`@paper-design/shaders` `0.0.82`)
    - `ui/vendor/theatre/theatre-core.min.js` (`@theatre/core` `0.7.2`)
    - `ui/vendor/maplibre-gl/maplibre-gl.js` + `maplibre-gl.css` (`maplibre-gl` `5.2.0`)
    - `ui/vendor/carbon-charts/carbon-charts.min.js` + `styles.min.css` (`@carbon/charts` `1.27.27`)
    - `ui/vendor/lucide/lucide.min.js` (`lucide` `1.70.0`)
    - `ui/assets/tilesets/izmir_port_sample/tileset.json` + 4 adet `.glb` (`sector_trafo.glb`, `sector_reefer.glb`, `sector_customs.glb`, `sector_crane.glb`)
    - `ui/vendor/react-bits-audit/AUDIT_NOTICE.md`
- **Korunan eski özellikler ve gerileme kontrolleri:** CesiumJS 1.114 küresi, NASA GIBS uydu katmanı, Earth/Nullschool yerel rüzgâr çizgileri, USGS deprem ve Open-Meteo veri bağlayıcıları, `vis-timeline` Hafıza zaman ekseni, CPU ARX-Ridge öğrenen dünya modeli ve 38 modüllü evrensel depo kataloğu hiçbir gerileme olmadan (Test 1–47: `41/41 PASS`) korunmuştur.
- **Kullanıcı verilerini koruma, yedek ve yalıtılmış test yöntemi:**
  - Kullanıcının mevcut `c:\Users\Lenovo\Desktop\CAELUS-main\caelus_world_store.json` dosyası hiç değiştirilmemiştir (`SHA-256: 4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1` — test öncesi ve sonrası birebir aynı).
  - Tüm EXE ve tarayıcı testleri `os.tmpdir()` altındaki yalıtılmış geçici çalışma dizinlerinde (`CAELUS_WORLD_STORE_PATH` yalıtımıyla) koşturulmuştur.

---

## 6. Açık Kalanlar

- **Engeller ve nedenleri:**
  1. **React Bits (`DavidHDev/react-bits`) — `ENGELLİ`:** Kaynak deponun `LICENSE.md` dosyasında `MIT + Commons Clause License Condition v1.0` ("whether alone, in a bundle, or as a ported version") kısıtlaması ve React 19 bağımlılığı tespit edildiği için harici kod/port ürüne dahil edilmemiştir. Yerine CAELUS'un kendi %100 MIT uyumlu Vanilla JS `CaelusOriginalSpotlightPrefs` bileşeni uygulanmıştır.
  2. **OpenAtlas Globe (`OpenAtlasProject/OpenAtlas`) Dokuları — `KONTROLLÜ VERİYLE`:** Kaynak deponun `ATTRIBUTIONS.md` dosyası `public/textures/earth/` altındaki dokuların kaynağının belgesiz olduğunu açıkça bildirdiği için o dokular hariç tutulmuş, CAELUS'un yerel Public Domain `NaturalEarthII` dokusu kullanılmıştır.
- **Kullanıcının göreceği sınırlamalar:**
  - `Dünyam` → `3D Tiles Sahnesi (NASA-AMMOS)` modundaki 4 yapı, İzmir Limanı sektörlerini temsil eden yerel kontrollü OGC 3D Tiles 1.0 `.glb` örnek kümesidir; ücretli şehir fotogrametrisi değildir.
  - `Paper Shaders` arka planı yalnızca dekoratif marka ışığıdır; veri veya simülasyon değildir.
- **Somut sonraki adımlar:**
  - İstenirse yerel OGC 3D Tiles 1.0 veri kümesine (`ui/assets/tilesets/`) açık lisanslı gerçek LiDAR/fotogrametri `.b3dm` / `.glb` şehir veya liman modelleri eklenebilir.
  - Fiziksel Intel UHD Graphics 620 donanımlı bir uç cihazda `Ayarlar` → `Görsel Kalite` profillerinin uzun süreli termal/FPS telemetrisi kaydedilebilir.
