# CAELUS — Görsel Kanıt, Çoklu Çözünürlük ve Fonksiyonel Test Raporu

## 1. Gerçek Ekran Görüntüsü Kanıtları (Önce / Sonra)

Tüm ekran görüntüleri çalışan yerel sunucu üzerinde **Playwright Chromium** ile üç zorunlu çözünürlükte (`1600×960` Masaüstü, `1366×768` Dizüstü, `390×844` Mobil DPR 2) gerçek tarayıcı render’ı alınarak `docs/screenshots/` dizinine kaydedilmiştir.

### 1.1 Değişiklik Öncesi (BEFORE) Ekran Görüntüleri
| Dosya | Çözünürlük | Tespit Edilen Görsel Sorunlar |
|---|---|---|
| `docs/screenshots/before_desktop_1600x960.png` | `1600×960` | Üstte sabit `.top-header` barı; `#dunyam-stage-callout-card` ilk açılışta açık ve `position: relative` çakışması nedeniyle 3B Dünya küresinin tam merkezini kapatıyor; altta çoklu düğme şeritleri sahneyi çerçeveliyor. |
| `docs/screenshots/before_laptop_1366x768.png` | `1366×768` | Sabit üst bar + merkezde açık başlayan konum kartı sahneyi daraltıyor. |
| `docs/screenshots/before_mobile_390x844.png` | `390×844` | Üstte sabit bar, altta 5 sekmeli sabit `#caelus-mobile-bottom-nav` dock’u ve sahne ortasında açık kart. |

### 1.2 Değişiklik Sonrası (AFTER) Ekran Görüntüleri
| Dosya | Çözünürlük | Doğrulanan Mekânsal Durum |
|---|---|---|
| `docs/screenshots/after_desktop_1600x960.png` | `1600×960` | **Başlıksız ve Dock’suz Ana Sahne (`body.caelus-spatial-clean-stage`):** Sabit üst bar, sabit alt bar ve 3’lü alt şerit kalabalığı kaldırıldı. Sol üstte kompakt CAELUS Açık Sarmal Mekânsal Pusulası (`#caelus-spatial-compass`) ve daraltılmış fısıltı kapsülü (`#dunyam-hero-whisper-box.is-whisper-collapsed`), sağ üstte Zaman Merceği + Veri Portresi + Sahne & Ölçek + Dayanak kapsülü (`#caelus-stage-top-right-pod`), alt ortada yalnızca tek bir sakin **`✦ Olaylar, Katmanlar & Ölçek` (`#caelus-spatial-focus-pill`)** tetikleyicisi. Seçim öncesi sağ inceleyici kapalı (`is-collapsed: true`), 3B Dünya küresi tam açık. |
| `docs/screenshots/after_desktop_data_portrait_1600x960.png` | `1600×960` | **Refik Anadol — *MRI of the Earth* Veri Portresi Modu (`#caelus-data-portrait-canvas`):** Aktif dünyanın gerçek varlık, yük ve akış vektörlerinden türeyen açık sarmal harmonik veri portresi; üst ortada açık **`SANATSAL VERİ TEMSİLİ · ÖLÇÜM GRAFİĞİ DEĞİLDİR` (`#caelus-data-portrait-badge`)** epistemik sınır rozeti. |
| `docs/screenshots/after_desktop_compass_inspector_1600x960.png` | `1600×960` | **Açık Mekânsal Pusula + Sağ Bağlamsal İnceleyici:** Sol üstte açılan `#caelus-compass-popover` içinde 5 temel çalışma alanı (`1. Dünyam`, `2. İlişkiler ve Keşfet`, `3. Zaman ve Hafıza`, `4. Gelecekler ve Senaryolar`, `5. Kaynaklar ve Dayanak`); sağ bağlamsal rayda (`right: 18px`) seçilen konumun 6 kademeli inceleme kartı (`#dunyam-stage-callout-card`). |
| `docs/screenshots/after_desktop_timelens_provenance_1600x960.png` | `1600×960` | **Çift Zamanlı (Bitemporal) Zaman Merceği Açık:** Sağ üstte `#caelus-time-lens-popover` içinde `19 Şub 2021 (v1)` ve `17 Mar 2021 (v2)` kesitleri, `1. O Tarihe Kadar Bilinenler (8 Kayıt, t_alım ≤ 2021-02-19)`, `2. Daha Sonra Öğrenilen Bilgiler (5 Kayıt Gizlendi, 0 Sızıntı)` ve `3. v1 → v2 Değerlendirme Karşılaştırması`. |
| `docs/screenshots/after_desktop_network_1600x960.png` | `1600×960` | **Odaklanmış Etki Ağı (`2. İlişkiler ve Keşfet`):** Yaşayan 3B Dünya sahnesi arka planda kalmaya devam eder; ikincil üst sekme barları gizlidir. `#kesfet-cytoscape-panel` içinde 1–2–3 derece komşuluk derinliği seçicisi (`#kesfet-cy-hop-bar`), renk + şekil/çizgi epistemik ayrımı, sağda `"Neden gösteriliyor?"` + alternatif açıklama + bilgi değeri (`VoI`) kutusu ve altta 4 adımlı nedensel yol kartları. |
| `docs/screenshots/after_desktop_scenarios_1600x960.png` | `1600×960` | **Gelecekler ve Senaryolar (`4. Gelecekler ve Senaryolar`):** Yaşayan 3B Dünya sahnesi arka planda kalmaya devam eder; ikincil adım/sekme barları gizlidir. `#senaryolar-six-questions-grid` (6 temel karar sorusu) ve `#senaryolar-three-futures-deck` (**1. Baz Durum %42**, **2. Müdahale Senaryosu %84 (+%42 Net Fark)**, **3. Birleşik Stres Senaryosu %64**). |
| `docs/screenshots/after_laptop_1366x768.png` | `1366×768` | **Dizüstü Görünümü:** Başlıksız sahne, sol dünya özeti ve sağ bağlamsal inceleyici arasında sıfır çakışma; merkezdeki 3B Dünya küresi tamamen açık. |
| `docs/screenshots/after_mobile_390x844.png` | `390×844` | **Mobil Görünüm:** Sabit üst bar yok, sabit alt bar yok. En üstte tek satırda kompakt sarmal pusula (`1. Dünyam`), `⏱ 2021-03-17 (v2)` ve `⚖ Dayanak`; ortada 3B Dünya sahnesi; altta bağlamsal alt çekmece (Bottom Sheet) inceleyici. |

---

## 2. 17 Zorunlu Fonksiyonel Doğrulama Akışı ve 8 Tasarım Referansı Denetimi (`tests/spatial_interface.test.mjs`)

Bölüm 2’de tanımlanan **8 zorunlu tasarım referansı** (`FIELD.IO — Seeing in Gamma`, `FIELD.IO — IBM watsonx`, `FIELD.IO — Under the Surface`, `FIELD.IO — Networks in Focus`, `Territory Studio — Foundation`, `Territory Studio — Ex Machina`, `Refik Anadol — MRI of the Earth`, `Pentagram — Deloitte Insights`) ve Bölüm 17’de tanımlanan **17 kullanıcı akışının** tamamı hem tarayıcıda hem otomatik test paketinde doğrulanmıştır:

| Akış # | Doğrulanan Akış | Durum | Kanıt / Bileşen |
|---|---|---|---|
| 1 | İlk açılışta üst bar, alt bar ve çoklu alt şerit olmadan başlıksız tam ekran sahne (`100dvh`) | **GEÇTİ** | `.top-header` kaldırıldı, `#caelus-mobile-bottom-nav` kaldırıldı, `body.caelus-spatial-clean-stage` ile alt ortada tekil `#caelus-spatial-focus-pill` |
| 2 | Kullanıcının menüyü/navigasyonu kolayca keşfedip açabilmesi | **GEÇTİ** | `#caelus-spatial-compass`, `#caelus-compass-trigger`, `#caelus-spatial-onboarding-hint` |
| 3 | Görünüm seçildiğinde menünün otomatik kapanması ve sahnenin açılması | **GEÇTİ** | `switchQuietView()` → `toggleSpatialCompassPopover(false)` + `syncSpatialModeLayout()` |
| 4 | Klavye ile menüye erişim (`Alt+M`, `Alt+K`, `Tab`, `Enter`) ve `Escape` ile kapatma | **GEÇTİ** | `keydown` dinleyicisi (`Alt+M`, `Alt+K`, `Escape`) + `:focus-visible` halkası |
| 5 | Sahneye tek tıkla geri dönüş | **GEÇTİ** | `#hdr-logo-home-btn` (`← Sahneye Dön`) ve mobil `.spatial-return-pill` |
| 6 | Dünya sahnesinde bir olay veya varlık seçilmesi | **GEÇTİ** | `selectCesiumGlobeMarkerById()` + konum/olay şeridi |
| 7 | Sağ bağlamsal inceleme panelinin seçim öncesi kapalı olması, seçimle 6 katmanlı açılması ve kapatılması | **GEÇTİ** | `#dunyam-stage-callout-card.is-collapsed`, `#callout-progressive-layers-box`, `#btn-dunyam-callout-collapse` |
| 8 | İlişkiler ve Keşfet görünümünde odaklı etki zincirinin (1–2–3 derece) ve `"Neden gösteriliyor?"` kutusunun açılması | **GEÇTİ** | `#kesfet-cy-hop-bar`, `applyCytoscapeHopDepth()`, `#cy-insp-why-shown-box` |
| 9 | Zaman Merceği ile tarih kesiti seçilmesi (`19 Şub 2021 v1`, `17 Mar 2021 v2`, `30 Eki 2020`) | **GEÇTİ** | `#caelus-time-lens-popover`, `renderAndOpenTimeLensPopover()` |
| 10 | O tarihte bilinenler (`t_alım ≤ T_kesit`) ile sonradan öğrenilenlerin (`t_alım > T_kesit`) `0` sızıntıyla ayrılması | **GEÇTİ** | `CaelusLivingWorldModel.answerLivingWorldDualQuestionsAtDate()` (`Sızıntı: 0`) |
| 11 | Gelecekler ve Senaryolar görünümünde 6 karar sorusu ve 3 gelecek dalının karşılaştırılması | **GEÇTİ** | `#senaryolar-six-questions-grid`, `#senaryolar-three-futures-deck` |
| 12 | Kaynaklar ve Dayanak çekmecesinde seçili bilginin kaynak, zaman ve epistemik durumunun görülmesi | **GEÇTİ** | `#caelus-provenance-drawer`, `renderAndOpenProvenanceDrawer()` |
| 13 | Eksik veri veya erişilemeyen kaynak durumunda dürüst mesaj gösterilmesi | **GEÇTİ** | `GAP-TX-SUBMETERING-01`, `GAP-TX-CLEANROOM-REQUAL-02`, NASA GIBS / USGS çevrimdışı dürüst uyarıları |
| 14 | Çevrim dışı çekirdek modunun dış ağ olmadan çalışması ve kullanıcı verisini koruması | **GEÇTİ** | `caelus_world_store.json` (`SHA-256: 4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1`) |
| 15 | Performans modu seçicisinin (`Tam Sahne`, `Dengeli`, `Hafif / 2B`) ve Refik Anadol Veri Portresi modunun (`SANATSAL VERİ TEMSİLİ · ÖLÇÜM GRAFİĞİ DEĞİLDİR`) çalışması | **GEÇTİ** | `#caelus-perf-mode-switcher`, `#btn-stage-toggle-portrait`, `#caelus-data-portrait-canvas`, `#caelus-data-portrait-badge` |
| 16 | Mobil görünümde alt çekmece, adım adım zincir ve `>=11px` okunabilir tipografinin çalışması | **GEÇTİ** | `#kesfet-mobile-step-path-list`, `#senaryolar-mobile-future-tabs`, `apps/caelus-ncm-mobile/app/globals.css` (`0` adet `<11px` kuralı) |
| 17 | Açık ve koyu temada kontrastın ve `prefers-reduced-motion` uyumunun korunması | **GEÇTİ** | `body.theme-light`, `body.contrast-high`, `isCaelusMotionReduced()` |

---

## 3. Bölüm 18 — GitHub Actions, CI ve `Deploy iPhone War Room` Durumu

- **`CAELUS Core & War Room CI` (`.github/workflows/ci.yml`)**: `ui/spatial_experience.js`, `ui/first_real_task_engine.js`, `tests/spatial_interface.test.mjs`, `tests/first_real_task.test.mjs` ve `dist/index.html` doğrulamalarıyla güncellenmiştir ve tüm adımlar yerel ve CI ortamında `0` hatayla geçmektedir.
- **`Deploy iPhone War Room` (`.github/workflows/pages.yml`)**:
  - `Build & Verify Standalone War Room Bundle` işi (`Verify JS Syntax`, `Run 65-Assertion Universal Scenario & Wasm Gate`, `Verify Spatial Experience & First Real Task Bundle`, `Stage Pages Artifact`) **%100 başarılı** çalışmaktadır.
  - Ancak `main` dalındaki son çalışmada (`Run ID: 42633252161`) `Configure GitHub Pages` (`actions/configure-pages@v5`) adımı, GitHub deposunun ayarlarında (`Settings -> Pages -> Build and deployment -> Source`) GitHub Pages kaynağının depo sahibi tarafından henüz `GitHub Actions` olarak etkinleştirilmemiş olması nedeniyle (`HttpError: Not Found / Pages not enabled`) durmaktadır. Bu durum kod veya paketleme hatası olmayıp depo sahibinin GitHub arayüzünden tek tıkla etkinleştirmesi gereken bir izin ayarıdır; Bölüm 18 kuralı gereği gizlenmeden açıkça raporlanmıştır.

---

## 4. Otomatik Test Paketi Çalıştırma Sonuçları

| Test Paketi | Komut | Sonuç |
|---|---|---|
| Mekânsal Arayüz ve 8 Referans Doğrulama Paketi | `node --test tests/spatial_interface.test.mjs` | **10 / 10 GEÇTİ** (`fail 0`) |
| İlk Gerçek Görev (Kullanıcı Verisi → Dünya → Senaryo → Rapor) | `node --test tests/first_real_task.test.mjs` | **10 / 10 GEÇTİ** (`fail 0`) |
| Evrensel Senaryo Derleyici ve 12 Yetenek Paketi | `node --test tests/universal_scenario_compiler.test.mjs` | **53 / 53 GEÇTİ** (`fail 0`) |
| Yaşayan Dünya Modeli (Bitemporal & Rakip Modeller) | `node --test tests/living_world_model.test.mjs` | **8 / 8 GEÇTİ** (`fail 0`) |
| Keşif ve Bilgi Değeri (VoI & MCP) Motoru | `node --test tests/discovery_value_engine.test.mjs` | **19 / 19 GEÇTİ** (`fail 0`) |
| Rust/WASM Deterministik Senaryo Paketi | `node --test tests/universal_wasm_scenario.test.mjs` | **4 / 4 GEÇTİ** (`fail 0`) |
| Mobil NCM-3 Kalite, Kaynak Kasası ve Epistemik Disiplin Paketi | `node --test apps/caelus-ncm-mobile/tests/ncm2-quality.test.mjs` | **12 / 12 GEÇTİ** (`fail 0`) |
| Tek Dosyalı Çevrimdışı PWA Paketi Üretimi | `python tools/build_standalone.py` | **BAŞARILI** (`dist/index.html`, `4.020.515 bayt`) |
