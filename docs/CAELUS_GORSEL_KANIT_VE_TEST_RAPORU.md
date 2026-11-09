# CAELUS — Görsel Kanıt, Çoklu Çözünürlük ve Fonksiyonel Test Raporu

## 1. Gerçek Ekran Görüntüsü Kanıtları (Önce / Sonra)

Tüm ekran görüntüleri çalışan yerel sunucu üzerinde **Playwright Chromium** ile üç zorunlu çözünürlükte (`1600×960` Masaüstü, `1366×768` Dizüstü, `390×844` Mobil DPR 2) gerçek tarayıcı render’ı alınarak `docs/screenshots/` dizinine kaydedilmiştir.

### 1.1 Değişiklik Öncesi (BEFORE) Ekran Görüntüleri
| Dosya | Çözünürlük | Tespit Edilen Görsel Sorunlar |
|---|---|---|
| `docs/screenshots/before_desktop_1600x960.png` | `1600×960` | Üstte sabit `.top-header` barı; `#dunyam-stage-callout-card` ilk açılışta açık ve `position: relative` çakışması nedeniyle 3B Dünya küresinin tam merkezini kapatıyor. |
| `docs/screenshots/before_laptop_1366x768.png` | `1366×768` | Sabit üst bar + merkezde açık başlayan konum kartı sahneyi daraltıyor. |
| `docs/screenshots/before_mobile_390x844.png` | `390×844` | Üstte sabit bar, altta 5 sekmeli sabit `#caelus-mobile-bottom-nav` dock’u ve sahne ortasında açık kart. |

### 1.2 Değişiklik Sonrası (AFTER) Ekran Görüntüleri
| Dosya | Çözünürlük | Doğrulanan Mekânsal Durum |
|---|---|---|
| `docs/screenshots/after_desktop_1600x960.png` | `1600×960` | **Başlıksız Ana Sahne:** Sabit üst bar ve sabit alt bar kaldırıldı (`display: none`). Sol üstte kompakt CAELUS Açık Sarmal Mekânsal Pusulası (`x=16, y=14`), üst ortada çakışmasız Ölçek Şeridi (`left=318px`), sağ üstte Zaman Merceği + 3 Performans Modu + Dayanak kapsülü. Seçim öncesi sağ inceleyici kapalı (`is-collapsed: true`), 3B Dünya küresi tam açık. |
| `docs/screenshots/after_desktop_compass_inspector_1600x960.png` | `1600×960` | **Açık Mekânsal Pusula + Sağ Bağlamsal İnceleyici:** Sol üstte açılan `#caelus-compass-popover` içinde 5 temel çalışma alanı (`Dünyam`, `Keşfet`, `Hafıza`, `Senaryolar`, `Bağlantılar` + `Kozmos`, `Ayarlar`); sağ bağlamsal rayda (`right: 18px`) seçilen konumun 6 kademeli inceleme kartı (`#dunyam-stage-callout-card`). |
| `docs/screenshots/after_desktop_timelens_provenance_1600x960.png` | `1600×960` | **Çift Zamanlı (Bitemporal) Zaman Merceği Açık:** Sağ üstte `#caelus-time-lens-popover` içinde `19 Şub 2021 (v1)` ve `17 Mar 2021 (v2)` kesitleri, `1. O Tarihe Kadar Bilinenler (8 Kayıt, t_alım ≤ 2021-02-19)`, `2. Daha Sonra Öğrenilen Bilgiler (5 Kayıt Gizlendi, 0 Sızıntı)` ve `3. v1 → v2 Değerlendirme Karşılaştırması`. |
| `docs/screenshots/after_desktop_network_1600x960.png` | `1600×960` | **Odaklanmış Etki Ağı (`İlişkiler ve Keşfet`):** `#kesfet-cytoscape-panel` içinde 1–2–3 derece komşuluk derinliği seçicisi (`#kesfet-cy-hop-bar`), renk + şekil/çizgi epistemik ayrımı, sağda `"Neden gösteriliyor?"` + alternatif açıklama + bilgi değeri (`VoI`) kutusu ve altta 4 adımlı nedensel yol kartları. |
| `docs/screenshots/after_desktop_scenarios_1600x960.png` | `1600×960` | **Gelecekler ve Senaryolar:** `#senaryolar-six-questions-grid` (6 temel karar sorusu) ve `#senaryolar-three-futures-deck` (**1. Baz Durum %42**, **2. Müdahale Senaryosu %84 (+%42 Net Fark)**, **3. Birleşik Stres Senaryosu %64**). |
| `docs/screenshots/after_laptop_1366x768.png` | `1366×768` | **Dizüstü Görünümü:** Başlıksız sahne, sol dünya özeti ve sağ bağlamsal inceleyici arasında sıfır çakışma; merkezdeki 3B Dünya küresi tamamen açık. |
| `docs/screenshots/after_mobile_390x844.png` | `390×844` | **Mobil Görünüm:** Sabit üst bar yok, sabit alt bar yok. En üstte tek satırda kompakt sarmal pusula (`1. Dünyam`), `⏱ 2021-03-17 (v2)` ve `⚖ Dayanak`; ortada 3B Dünya sahnesi; altta bağlamsal alt çekmece (Bottom Sheet) inceleyici. |

---

## 2. 17 Zorunlu Fonksiyonel Doğrulama Akışı (`tests/spatial_interface.test.mjs`)

Bölüm 17’de tanımlanan 17 kullanıcı akışının tamamı hem tarayıcıda hem otomatik test paketinde doğrulanmıştır:

| Akış # | Doğrulanan Akış | Durum | Kanıt / Bileşen |
|---|---|---|---|
| 1 | İlk açılışta üst bar ve alt bar olmadan başlıksız tam ekran sahne (`100dvh`) | **GEÇTİ** | `.top-header` kaldırıldı, `#caelus-mobile-bottom-nav` ve mobil `.bottom-nav` kaldırıldı |
| 2 | Kullanıcının menüyü/navigasyonu kolayca keşfedip açabilmesi | **GEÇTİ** | `#caelus-spatial-compass`, `#caelus-compass-trigger`, `#caelus-spatial-onboarding-hint` |
| 3 | Görünüm seçildiğinde menünün otomatik kapanması ve sahnenin açılması | **GEÇTİ** | `switchQuietView()` → `toggleSpatialCompassPopover(false)` |
| 4 | Klavye ile menüye erişim (`Alt+M`, `Tab`, `Enter`) ve `Escape` ile kapatma | **GEÇTİ** | `keydown` dinleyicisi (`Alt+M` ve `Escape`) + `:focus-visible` halkası |
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
| 15 | Performans modu seçicisinin (`Tam Sahne`, `Dengeli`, `Hafif / 2B`) çalışması | **GEÇTİ** | `#caelus-perf-mode-switcher`, `setCaelusSpatialPerfMode()` |
| 16 | Mobil görünümde alt çekmece, adım adım zincir ve `>=11px` okunabilir tipografinin çalışması | **GEÇTİ** | `#kesfet-mobile-step-path-list`, `#senaryolar-mobile-future-tabs`, `apps/caelus-ncm-mobile/app/globals.css` |
| 17 | Açık ve koyu temada kontrastın ve `prefers-reduced-motion` uyumunun korunması | **GEÇTİ** | `body.theme-light`, `body.contrast-high`, `isCaelusMotionReduced()` |

---

## 3. Otomatik Test Paketi Çalıştırma Sonuçları

| Test Paketi | Komut | Sonuç |
|---|---|---|
| Mekânsal Arayüz Doğrulama Paketi | `node --test tests/spatial_interface.test.mjs` | **8 / 8 GEÇTİ** (`fail 0`) |
| Evrensel Senaryo Derleyici ve 12 Yetenek Paketi | `node --test tests/universal_scenario_compiler.test.mjs` | **53 / 53 GEÇTİ** (`fail 0`) |
| Yaşayan Dünya Modeli (Bitemporal & Rakip Modeller) | `node --test tests/living_world_model.test.mjs` | **8 / 8 GEÇTİ** (`fail 0`) |
| Keşif ve Bilgi Değeri (VoI & MCP) Motoru | `node --test tests/discovery_value_engine.test.mjs` | **19 / 19 GEÇTİ** (`fail 0`) |
| Rust/WASM Deterministik Senaryo Paketi | `node --test tests/universal_wasm_scenario.test.mjs` | **4 / 4 GEÇTİ** (`fail 0`) |
| Mobil NCM-2 Kalite ve Epistemik Disiplin Paketi | `node --test apps/caelus-ncm-mobile/tests/ncm2-quality.test.mjs` | **10 / 10 GEÇTİ** (`fail 0`) |
| Tek Dosyalı Çevrimdışı PWA Paketi Üretimi | `python tools/build_standalone.py` | **BAŞARILI** (`dist/index.html`, `3.803.460 bayt`) |
