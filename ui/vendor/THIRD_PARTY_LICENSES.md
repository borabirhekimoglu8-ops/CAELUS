# CAELUS — Üçüncü Taraf Açık Kaynak Kütüphaneleri ve Açık Veri Servis Koşulları

Bu dosya, CAELUS uygulamasına entegre edilen açık kaynak kütüphanelerin sabitlenmiş sürümlerini, lisanslarını, ücretsiz açık kaynak ile ücretli bileşen ayrımlarını ve kullanılan açık veri/görüntü servislerinin erişim ve atıf koşullarını içerir.

---

## 1. Gömülü / Yerel Açık Kaynak Kütüphaneleri (`ui/vendor/`)

### 1.1 CesiumJS (`cesium@1.114.0`) — Ana 3B Dünya Motoru
- **Kaynak Depo:** https://github.com/CesiumGS/cesium
- **Yerel Konum:** `ui/vendor/cesium/` (`Cesium.js`, `Widgets/`, `Workers/`, `Assets/`, `ThirdParty/`)
- **Sabitlenmiş Sürüm:** `1.114.0`
- **Lisans:** Apache License 2.0 (`ui/vendor/cesium/LICENSE.md`)
- **Telif:** Copyright 2011–2024 Cesium GS, Inc. and Contributors.
- **Not:** Çevrimdışı taban haritası olarak Cesium paketi içindeki `Assets/Textures/NaturalEarthII` (Natural Earth II — Public Domain, `naturalearthdata.com`) kullanılmaktadır; Cesium Ion bulut anahtarı (`Ion.defaultAccessToken`) kullanılmaz ve dış ücretli servise bağımlılık yoktur.

### 1.2 vis-timeline (`vis-timeline@7.7.3` & `vis-data@7.1.9`) — Hafıza Zaman Çizgisi
- **Kaynak Depo:** https://github.com/visjs/vis-timeline
- **Yerel Konum:** `ui/vendor/vis-timeline/vis-timeline-graph2d.min.js`, `ui/vendor/vis-timeline/vis-timeline-graph2d.min.css`
- **Sabitlenmiş Sürüm:** `7.7.3`
- **Lisans:** Çift Lisans — Apache License 2.0 veya MIT License
- **Telif:** Copyright Almende B.V. and Contributors.

### 1.3 Open Props (`open-props@1.7.6`) — Tasarım Token Sistemi
- **Kaynak Depo:** https://github.com/argyleink/open-props
- **Yerel Konum:** `ui/vendor/open-props/open-props.caelus.min.css`, `ui/vendor/open-props/LICENSE`
- **Sabitlenmiş Sürüm:** `1.7.6`
- **Lisans:** MIT License (Copyright (c) 2021 Adam Argyle)
- **Kullanım Biçimi:** Yalnızca CAELUS için gereken sade alt küme (`sizes`, `fonts`, `borders`, `easings`, `shadows`, `zindex` + CAELUS koyu/açık tema yüzey köprüsü) yerel olarak gömülmüştür; gereksiz tüm Open Props dosyaları yüklenmemiştir.

### 1.4 Floating UI (`@floating-ui/core@1.6.8` & `@floating-ui/dom@1.6.12`) — Akıllı Açılır Kart ve Bilgi Kutusu Konumlandırma
- **Kaynak Depo:** https://github.com/floating-ui/floating-ui
- **Yerel Konum:** `ui/vendor/floating-ui/floating-ui.core.umd.min.js`, `ui/vendor/floating-ui/floating-ui.dom.umd.min.js`, `ui/vendor/floating-ui/LICENSE`
- **Sabitlenmiş Sürüm:** `@floating-ui/core@1.6.8`, `@floating-ui/dom@1.6.12`
- **Lisans:** MIT License (Copyright (c) 2021 Floating UI contributors)
- **Kullanım Biçimi:** `Dünyam` sahnesindeki seçili olay/varlık kartının (`#dunyam-stage-callout-card`), katman/zaman açılır kutusunun (`#dunyam-layers-popover`) ve `Kozmos` gök cismi denetçisinin (`computePosition`, `offset`, `flip`, `shift`) masaüstü ve mobil ekran dışına taşmasını önlemek için kullanılır.

### 1.5 Apache ECharts (`echarts@5.5.1`) — Senaryo ve Sonuç Karşılaştırma Grafikleri
- **Kaynak Depo:** https://github.com/apache/echarts
- **Yerel Konum:** `ui/vendor/echarts/echarts.min.js`, `ui/vendor/echarts/LICENSE`
- **Sabitlenmiş Sürüm:** `5.5.1` (`echarts.common.min.js` UMD paketi)
- **Lisans:** Apache License 2.0 (Copyright 2017–2024 The Apache Software Foundation)
- **Kullanım Biçimi:** Yalnızca `Senaryolar` ekranındaki gerçek C++17 / WASM motor çıktısına bağlı `Değişiklik Yapılmazsa` ve `Değişiklik Yapılırsa` düğüm kapasite karşılaştırması ile adım adım zaman içi kapasite/sürtünme eğrisi için kullanılır. Henüz senaryo çalıştırılmamışken sahte grafik üretilmez.

### 1.6 Motion (`motion@11.11.17`) — Ölçülü Arayüz ve Panel Geçişleri
- **Kaynak Depo:** https://github.com/motiondivision/motion
- **Yerel Konum:** `ui/vendor/motion/motion.min.js`, `ui/vendor/motion/LICENSE`
- **Sabitlenmiş Sürüm:** `11.11.17`
- **Lisans:** MIT License (Copyright (c) 2018 Framer B.V. / Motion Division)
- **Ücretsiz / Ücretli Ayrımı:** Yalnızca ücretsiz ve açık kaynak MIT lisanslı çekirdek (`window.Motion.animate`) kullanılmıştır; ücretli **Motion+** bileşenleri kesinlikle kullanılmamıştır. `prefers-reduced-motion: reduce` ve CAELUS `Hareket Azaltma` (`animLevel === 'off'`) ayarlarına tam uyumludur.

### 1.7 Web Awesome / Shoelace (`@shoelace-style/shoelace@2.19.1`) — Temel UI Bileşen ve Mobil Navigasyon Desenleri
- **Kaynak Depo:** https://github.com/shoelace-style/webawesome
- **Yerel Konum:** `ui/vendor/webawesome/caelus-webawesome.css`, `ui/vendor/webawesome/LICENSE`
- **Sabitlenmiş Sürüm:** `2.19.1` (Açık Kaynak Çekirdek)
- **Lisans:** MIT License (Copyright (c) 2020 A Beautiful Site, LLC)
- **Ücretsiz / Ücretli Ayrımı:** Yalnızca MIT lisanslı açık kaynak tasarım token'ları, buton/form/alert/drawer desenleri ve mobil alt navigasyon çubuğu uygulanmıştır; ücretli **Web Awesome Pro** bileşenleri kesinlikle kullanılmamıştır.

### 1.8 Earth, Moon & Solar System (`ethanplusai/earth-moon-solar`) — Kozmos ve Güneş Sistemi Sahne Referansı
- **Kaynak Depo:** https://github.com/ethanplusai/earth-moon-solar
- **Lisans:** MIT License (Copyright (c) ethanplusai)
- **Kullanım Biçimi:** Harici çerçeve olarak kopyalanmamış; `Kozmos / Güneş Sistemi` ekranındaki (`#living-universe-section` / `#univ-solar-system-panel` / `#univ-solar-canvas`) Dünya–Ay–Güneş ve gezegen yörünge sahnesi, gök cismi seçim barı, yumuşak kamera odaklama/yakınlaştırma (`flyToSolarBody`) ve sahne içi bilgi kartı için görsel ve etkileşimsel referans olarak uygulanmıştır.

### 1.9 Astro Sci-Fi UI (`jonnysmillie/astro-sci-fi-ui`) — İnce Kozmik Çizgi ve Vurgu Referansı
- **Kaynak Depo:** https://github.com/jonnysmillie/astro-sci-fi-ui
- **Lisans:** MIT License (Copyright (c) Jonny Smillie)
- **Kullanım Biçimi:** CAELUS Astro veya React'e taşınmamıştır; yalnızca ince kozmik ayırıcı çizgiler (`.caelus-cosmic-hairline`) ve ölçülü kart köşe vurguları için tasarım referansı olarak kullanılmıştır. Gürültülü oyun HUD'u ve sahte telemetri öğeleri alınmamıştır.

### 1.10 Earth / Nullschool Rüzgâr Alanı Yöntemi (`cambecc/earth` Referansı)
- **Kaynak Depo:** https://github.com/cambecc/earth
- **Lisans:** MIT License (Copyright (c) 2014 Cameron Beccario)
- **Kullanım Biçimi:** `cambecc/earth` projesindeki 2B düzenli `(lat, lon)` ızgarası üzerinde bilineer vektör alanı enterpolasyonu (`bilinearInterpolateVector`) ve parçacık akış izi (streamline particle advection) matematiği CAELUS'un `ui/app.js` rüzgâr katmanı motoruna özgü olarak uygulanmıştır.

### 1.11 Globe.GL (`globe.gl@2.32.1` — Yalnızca Karşılaştırmalı Değerlendirme)
- **Kaynak Depo:** https://github.com/vasturiano/globe.gl
- **Sabitlenmiş Sürüm:** `2.32.1` (MIT License)
- **Durum:** Karşılaştırmalı değerlendirmede incelenmiş; çok çözünürlüklü WMTS uydu katmanları (NASA GIBS), çevrimdışı TMS karo piramidi (`NaturalEarthII`), atmosfer/ışıklandırma ve kamera uçuşu yetenekleri nedeniyle ana 3B Dünya motoru olarak **CesiumJS 1.114.0** korunmuştur (aynı anda iki 3B Dünya motoru çalıştırılmaz).

---

## 2. Harita, Uydu Görüntüsü ve Açık Veri Servislerinin Kullanım Koşulları

Kütüphane lisanslarından bağımsız olarak, çalışma zamanında bağlanılan açık veri servislerinin kullanım koşulları, kısıtları ve atıf kuralları aşağıdadır:

### 2.1 NASA EOSDIS GIBS (Global Imagery Browse Services)
- **Servis Uç Noktası:** `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/...`
- **GIBS Web Örnekleri Referansı:** https://github.com/nasa-gibs/gibs-web-examples
- **API Anahtarı / Hesap Gereksinimi:** Yok (Açık kamu erişimi — NASA Earthdata Open Data Policy).
- **Atıf (Citation):** *"We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Observing System Data and Information System (EOSDIS)."*
- **Kapsam ve Sınırlamalar:**
  - Görüntüler canlı video akışı değildir; günlük uydu geçişlerinden oluşturulan mozaikler (`VIIRS_SNPP_CorrectedReflectance_TrueColor`, `MODIS_Terra_CorrectedReflectance_TrueColor`) veya statik referans kompozitlerdir (`BlueMarble_NextGeneration` 2004-08-01, `VIIRS_CityLights_2012` 2012-03-14).
  - Henüz uydu geçişi tamamlanmamış veya arşivde bulunmayan gelecek/eksik tarihler için sahte görüntü üretilmez; HTTP durumu kontrol edilerek kullanıcıya açıkça bildirilir.

### 2.2 Open-Meteo Weather & Marine API
- **Servis Uç Noktası:** `https://api.open-meteo.com/v1/forecast` ve `https://marine-api.open-meteo.com/v1/marine`
- **API Anahtarı Gereksinimi:** Yok (Ticari olmayan açık kullanım için ücretsiz).
- **Lisans ve Atıf:** Creative Commons Attribution 4.0 International (CC BY 4.0) — *"Weather data by Open-Meteo.com"*.
- **Kapsam ve Sınırlamalar:**
  - Rüzgâr katmanı (`10m wind_speed_10m` ve `wind_direction_10m`), sayısal hava tahmin modelinden (NWP model grid) alınan **bölgesel 6×6 ızgara (`34.5°K–41.5°K, 22.5°D–30.5°D`)** verisine dayanır.
  - Doğrudan tekil istasyon anemometre ölçümü değildir ve tüm Dünya'yı kapsayan küresel rüzgâr alanı olarak sunulmaz.

### 2.3 USGS Earthquake Hazards Program (GeoJSON API)
- **Servis Uç Noktası:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson` ve `https://earthquake.usgs.gov/fdsnws/event/1/query`
- **API Anahtarı Gereksinimi:** Yok (ABD Kamu Malı — U.S. Public Domain).
- **Atıf:** *"U.S. Geological Survey (USGS) Earthquake Hazards Program"*.
- **Kapsam ve Sınırlamalar:**
  - Deprem olaylarının gerçekleşme zamanı (`properties.time` -> `Olay Zamanı`) ile CAELUS'un veriyi çektiği zaman (`Son Alım Zamanı`) birbirinden ayrı tutulur.

---

## 3. 10 Depolu CAELUS UI Entegrasyon Paketi (`CAELUS_UI_10_Repo_Tam_Paket`)

Bu bölümde, 10 Depolu CAELUS UI ve 3B Sahne Entegrasyon Paketi kapsamında incelenen ve entegre edilen 10 açık kaynak deponun sürüm, lisans, telif ve varlık (asset) doğrulama kayıtları yer almaktadır:

### 3.1 OpenAtlas Globe (`lowjieseng1810/openatlas-globe@0.1.0`) — Alternatif 3B Atmosferik Küre Gölgelendiricisi
- **Kaynak Depo:** https://github.com/lowjieseng1810/openatlas-globe
- **Yerel Konum:** `ui/vendor/three-stack/caelus-three-stack.min.js` (`window.CAELUS_OpenAtlasGlobe`), `ui/vendor/three-stack/LICENSE`
- **Sabitlenmiş Sürüm:** `0.1.0` (`package.json`)
- **Kod Lisansı:** MIT License — `Copyright (c) 2026 Low Jie Seng`
- **Varlık (Texture) Denetimi (`ATTRIBUTIONS.md`):** Kaynak deponun `ATTRIBUTIONS.md` dosyası, `public/textures/earth/` altındaki yüksek çözünürlüklü dokuların (`earth_day_8k.jpg`, `earth_night_4k.jpg` vb.) belgelendirilmiş bir yeniden dağıtım lisansına sahip olmadığını açıkça belirtir. Bu nedenle o dokular **kesinlikle kopyalanmamıştır**. Bunun yerine OpenAtlas'ın MIT lisanslı atmosfer/gece-gündüz GLSL gölgelendiricisi (`earth-globe.js`), küresel koordinat dönüşümü (`latLonToLocal`) ve dönüş fiziği (`earthSpinDelta`, `shouldAutoRotateEarth`), CAELUS'un yerel Public Domain **Natural Earth II** (`ui/vendor/cesium/Assets/Textures/NaturalEarthII/`) dokularıyla çalıştırılmaktadır.
- **Durum:** `GERÇEK ENTEGRE / KONTROLLÜ VERİYLE`

### 3.2 NASA-AMMOS 3DTilesRendererJS (`3d-tiles-renderer@0.5.4`) — 3D Tiles 1.0 Yükleyici ve Sahne Motoru
- **Kaynak Depo:** https://github.com/NASA-AMMOS/3DTilesRendererJS
- **Yerel Konum:** `ui/vendor/three-stack/caelus-three-stack.min.js` (`window.CAELUS_TilesRenderer`), `ui/assets/tilesets/izmir_port_sample/tileset.json` (+ 4 adet ikili glTF 2.0 `.glb` sektör modeli)
- **Sabitlenmiş Sürüm:** `0.5.4` (Three.js `0.187.0` ile)
- **Lisans:** Apache License 2.0 — California Institute of Technology (Caltech) / NASA Jet Propulsion Laboratory (JPL)
- **Veri Kaynağı Denetimi:** Ücretli veya ticari anahtar gerektiren Google Photorealistic 3D Tiles / Cesium Ion 3D Tiles servisleri kullanılmaz. Sahne içinde `ÖRNEK 3D TILES VERİ SETİ (YEREL DOĞRULANMIŞ GEOMETRİ — TİCARİ ŞEHİR VERİSİ DEĞİLDİR)` rozetiyle yerel OGC 3D Tiles 1.0 veri seti (`tileset.json` + `sector_trafo.glb`, `sector_reefer.glb`, `sector_gumruk.glb`, `sector_vinc.glb`) yüklenir ve tıklanan sektör CAELUS varlık denetçisine bağlanır.
- **Durum:** `GERÇEK ENTEGRE / KONTROLLÜ VERİYLE`

### 3.3 Spacekit (`spacekit.js@0.1.1`) — 3B Güneş Sistemi ve Uzay Görselleştirme Motoru
- **Kaynak Depo:** https://github.com/typpo/spacekit
- **Yerel Konum:** `ui/vendor/spacekit/spacekit.js`, `ui/vendor/spacekit/assets/`, `ui/vendor/spacekit/data/`, `ui/vendor/spacekit/LICENSE`
- **Sabitlenmiş Sürüm:** `0.1.1`
- **Lisans:** MIT License — `Copyright (c) 2019 Ian Webster`
- **Gömülü Açık Veri ve Görseller:** NASA SVS Tycho yıldız haritası (`nasa_tycho.jpg` — Public Domain), Yale Bright Star Catalog (`bsc5-short.json`) ve NASA JPL doğal uydu yörünge parametreleri (`natural-satellites.json`).
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

### 3.4 Paper Shaders (`@paper-design/shaders@0.0.82`) — Dekoratif Kozmik Marka Arka Plan Gölgelendiricisi
- **Kaynak Depo:** https://github.com/paper-design/shaders
- **Yerel Konum:** `ui/vendor/paper-shaders/paper-shaders.min.js`, `ui/vendor/paper-shaders/LICENSE`
- **Sabitlenmiş Sürüm:** `0.0.82`
- **Lisans:** Apache License 2.0 — `Copyright Paper Design, Inc.`
- **Kullanım Biçimi:** Yalnızca saf WebGL `ShaderMount` çekirdeği (`meshGradientFragmentShader`, `dotOrbitFragmentShader`, `smokeRingFragmentShader`) gömülmüştür; React sarmalayıcısı (`@paper-design/shaders-react`) kullanılmamıştır. Arayüzde `DEKORATİF MARKA IŞIĞI — VERİ VEYA FİZİKSEL SİMÜLASYON DEĞİLDİR` bildirimiyle sunulur; `Açık / Düşük / Kapalı` kontrolü ve `prefers-reduced-motion` desteği vardır.
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

### 3.5 Theatre.js (`@theatre/core@0.7.2`) — Kamera ve Sahne Geçiş Orkestrasyonu
- **Kaynak Depo:** https://github.com/theatre-js/theatre
- **Yerel Konum:** `ui/vendor/theatre/theatre-core.min.js`, `ui/vendor/theatre/LICENSE`
- **Sabitlenmiş Sürüm:** `0.7.2`
- **Lisans:** Apache License 2.0 — `Copyright (c) 2021 Theatre.js contributors`
- **Kullanım Biçimi:** Yalnızca çalışma zamanı orkestrasyon çekirdeği (`@theatre/core`: `getProject`, `sheet`, `sheet.object`, `sequence.play`, `onChange`) yüklenmiştir; geliştirici düzenleyicisi (`@theatre/studio`) üretim arayüzüne **kesinlikle dahil edilmemiştir** (`studioLoaded: false`). Kullanıcı tekerlek/fare/Escape ile dokunduğunda sekans anında durdurulur.
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

### 3.6 pmndrs/postprocessing (`postprocessing@6.39.6`) — Kontrollü Three.js Sahne Son İşleme Hattı
- **Kaynak Depo:** https://github.com/pmndrs/postprocessing
- **Yerel Konum:** `ui/vendor/three-stack/caelus-three-stack.min.js` (`window.CAELUS_PostProcessing`), `ui/vendor/three-stack/LICENSE`
- **Sabitlenmiş Sürüm:** `6.39.6`
- **Lisans:** Zlib License — `Copyright (c) 2015 Raoul van Rüschen`
- **Kullanım Biçimi:** Three.js tabanlı `OpenAtlas 3B Küre` ve `3D Tiles Sahnesi` modlarında `EffectComposer`, `RenderPass`, `EffectPass`, `BloomEffect` ve `VignetteEffect` hattını çalıştırır. `Kapalı / Düşük / Normal` kalite seçiciye, canlı `ms/frame` + `framebuffer` ölçümüne ve entegre GPU (`Intel UHD Graphics 620`) koruma moduna sahiptir.
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

### 3.7 MapLibre GL JS (`maplibre-gl@5.2.0`) — Bölgesel Coğrafi Keşif Haritası
- **Kaynak Depo:** https://github.com/maplibre/maplibre-gl-js
- **Yerel Konum:** `ui/vendor/maplibre-gl/maplibre-gl.js`, `ui/vendor/maplibre-gl/maplibre-gl.css`, `ui/vendor/maplibre-gl/LICENSE.txt`
- **Sabitlenmiş Sürüm:** `5.2.0`
- **Lisans:** BSD-3-Clause License — `Copyright (c) 2020 MapLibre contributors`
- **Kullanım Biçimi:** `Keşfet` ekranında seçilebilir **Bölgesel Harita (MapLibre GL JS)** görünümü olarak çalışır. Ücretli/anahtarlı dış harita servisine ihtiyaç duymadan yerel `NaturalEarthII` karo katmanı + CAELUS varlıkları, USGS depremleri ve Open-Meteo istasyonlarını GeoJSON katmanları olarak çizer ve sağ inceleme paneliyle senkronize çalışır.
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

### 3.8 React Bits (`DavidHDev/react-bits`) — Lisans Denetimi Sonucu Hariç Tutulan Depo
- **Kaynak Depo:** https://github.com/DavidHDev/react-bits
- **Denetim Kaydı:** `ui/vendor/react-bits-audit/AUDIT_NOTICE.md`
- **Lisans:** `MIT + Commons Clause License Condition v1.0` (`LICENSE.md`)
- **Somut Engel:** Deponun `LICENSE.md` dosyası standart MIT lisansı üzerine **Commons Clause v1.0** kısıtlaması eklemekte ve bileşenlerin tek başına, paket içinde veya **port edilmiş (Vanilla JS'e çevrilmiş) sürüm olarak** ticari/yeniden dağıtım kapsamını kısıtlamaktadır. Ayrıca depo React 19 bağımlıdır.
- **Uygulanan Çözüm:** Talimatın (`01_Talimat/ANA_PROMPT.txt` Madde C.8) *"Önce deponun lisansı, Commons Clause ve seçilen varlığın ek bildirimlerini ve ticari kullanım şartlarını doğrula. Lisansla çelişiyorsa kodu dahil etme, somut engel ve kullanılabilir özgün karşılığı bildir"* kuralı gereğince React Bits kodu veya portu projeye **dahil edilmemiştir** (`ENGELLİ`). Karşılık olarak `Ayarlar` ekranında CAELUS'un kendi sıfırdan yazılmış MIT uyumlu özgün Vanilla JS mikro-etkileşim seçicisi (`CaelusOriginalSpotlightPrefs`) sunulmuştur.
- **Durum:** `ENGELLİ` (Lisans Kısıtı: `MIT + Commons Clause v1.0` + React Bağımlılığı)

### 3.9 Carbon Charts (`@carbon/charts@1.27.27`) — Kurumsal Senaryo Karşılaştırma Grafikleri
- **Kaynak Depo:** https://github.com/carbon-design-system/carbon-charts
- **Yerel Konum:** `ui/vendor/carbon-charts/carbon-charts.min.js`, `ui/vendor/carbon-charts/styles.min.css`, `ui/vendor/carbon-charts/LICENSE`
- **Sabitlenmiş Sürüm:** `1.27.27`
- **Lisans:** Apache License 2.0 — `Copyright (c) IBM Corp. 2018, 2025`
- **Kullanım Biçimi:** `@carbon/charts` Vanilla JS paketi (IBM telemetrisi devre dışı bırakılarak) yerel olarak paketlenmiştir. `Senaryolar` ekranında Apache ECharts'ın yanında gerçek C++17 / WASM motor çıktısına bağlı kurumsal `GroupedBarChart` (`Başlangıç Yükü (%)`, `1. Hedef (Standart) (%)`, `2. Hedef (Kontrollü Plan) (%)`) ve ekran okuyucu uyumlu erişilebilir HTML veri tablosu (`#caelus-carbon-chart-a11y-table`) üretir.
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

### 3.10 Lucide (`lucide@1.70.0`) — Tutarlı Çizgisel İkon Sistemi
- **Kaynak Depo:** https://github.com/lucide-icons/lucide
- **Yerel Konum:** `ui/vendor/lucide/lucide.min.js`, `ui/vendor/lucide/LICENSE`
- **Sabitlenmiş Sürüm:** `1.70.0`
- **Lisans:** ISC License — `Copyright (c) 2020, Lucide Contributors`
- **Kullanım Biçimi:** Üst navigasyon sekmeleri, sahne mod anahtarları (`Dünyam`, `Keşfet`, `Kozmos`, `Senaryolar`, `Hafıza`, `Bağlantılar`, `Ayarlar`), mobil alt çubuk ve durum kartlarında tutarlı `1.75px` vuruş kalınlığıyla kullanılır. Tüm dekoratif `<svg>` öğelerinde `aria-hidden="true"` tanımlıdır ve metin/erişilebilir ad (`aria-label`) korunur.
- **Durum:** `GERÇEK ENTEGRE / TEST EDİLDİ`

---

## 4. Gerçek Dünya Veri Katmanı ve 13 Teknoloji Entegrasyon Paketi (`CAELUS_Gercek_Dunya_Entegrasyon_Paketi`)

### 4.1 Cytoscape.js (`cytoscape@3.34.4`) — Etkileşimli İlişki ve Epistemik Bağ Ağı
- **Kaynak Depo:** https://github.com/cytoscape/cytoscape.js
- **Yerel Konum:** `ui/vendor/cytoscape/cytoscape.min.js`
- **Sabitlenmiş Sürüm:** `3.34.4`
- **Lisans:** MIT License — `Copyright (c) 2016–2025, The Cytoscape Consortium`
- **Kullanım Biçimi:** `Keşfet` ekranında seçili dünyanın düğüm ve ilişkilerini etkileşimli ağ olarak çizer. Tuvalde yalnızca sade okunabilir adlar gösterilir; kimlik, kaynak ve birim yan denetçide yer alır. Kenarlar `Ölçüm / Gözlem`, `Uzman Girişi`, `Model Bağıntısı` ve `Hipotez (Kanıtlanmış Nedensellik Değildir)` olarak ayrıştırılır.

### 4.2 deck.gl (`deck.gl@9.4.1`) — Etkileşimli Olay Kümesi ve Koridor Katmanı
- **Kaynak Depo:** https://github.com/visgl/deck.gl
- **Yerel Konum:** `ui/vendor/deckgl/deckgl.min.js`
- **Sabitlenmiş Sürüm:** `9.4.1`
- **Lisans:** MIT License — `Copyright (c) OpenJS Foundation and Contributors`
- **Kullanım Biçimi:** `Keşfet` ekranındaki `MapLibre GL JS` bölgesel haritası üzerinde aynı anda ikinci bir ağır 3B Dünya motoru çalıştırmadan `ScatterplotLayer` ve `ArcLayer` olay kümesi/koridor katmanı sağlar; tıklanan öğe normalize kayıt denetçisini açar.

### 4.3 FINOS Perspective (`@finos/perspective@3.8.0` Uyumlu CAELUS Tablo/Pivot Motoru) — Verileri İncele Çalışma Alanı
- **Kaynak Depo:** https://github.com/perspective-dev/perspective
- **Yerel Konum:** `ui/vendor/perspective/caelus-perspective.min.js`
- **Sabitlenmiş Sürüm:** `3.8.0-caelus-embedded`
- **Lisans:** Apache License 2.0
- **Kullanım Biçimi:** `Keşfet` ekranındaki düşük yoğunluklu `"Verileri İncele"` çalışma alanında normalize gözlemleri kaynak, birim, güncellik ve olay zamanına göre filtreler, sıralar ve kaynak kayda bağlar.

### 4.4 DuckDB (`duckdb@2.0.0`) — Yerel Analitik Snapshot Sorgu Katmanı
- **Kaynak Depo:** https://github.com/duckdb/duckdb
- **Sabitlenmiş Sürüm:** `2.0.0` (Python `duckdb` + JS `runDuckDbSnapshotQueryWithProvenance`)
- **Lisans:** MIT License — `Copyright 2018-2026 Stichting DuckDB Foundation`
- **Kullanım Biçimi:** Kullanıcının mevcut `caelus_world_store.json` dosyasını değiştirmeden, izole veri anlık görüntüleri (immutable snapshots) üzerinde zaman ve kaynağa göre salt-okunur analitik gruplama yapar; boş sonuç kümesi ile bilinmeyen (`null`) alanı açıkça ayırır.

### 4.5 NASA EONET v3 & NASA JPL Horizons API
- **NASA EONET v3:** `https://eonet.gsfc.nasa.gov/api/v3/events` — NASA Open Data Policy (Public Domain).
- **NASA JPL Horizons:** `https://ssd.jpl.nasa.gov/api/horizons.api` — NASA / Caltech JPL Solar System Dynamics (`UTC/TDB` zaman ölçeği, `ICRF/J2000.0` referans çerçevesi, `1800–2050` geçerlilik aralığı).

### 4.6 Eclipse Ditto (`eclipse-ditto`) & OpenUSD (`OpenUSD .usda 1.0`) & Google Photorealistic 3D Tiles Kapısı
- **Eclipse Ditto:** EPL-2.0 (`https://github.com/eclipse-ditto/ditto`) — Cihaz/varlık durumu ve `_revision` okuyucu; yerel simülatör açıkça `TEST/ÖRNEK CİHAZ SİMÜLATÖRÜ` olarak etiketlidir, dış cihazlara otonom komut göndermez.
- **OpenUSD (`.usda 1.0`) / NVIDIA Omniverse:** OpenUSD ASCII sahne dışa/içe aktarımı (`exportWorldToOpenUsdaStage`, `parseAndValidateOpenUsdaStage`) tam çalışır; NVIDIA RTX gerektiren canlı Omniverse akışı Intel UHD Graphics 620 donanım sınırı nedeniyle dürüstçe `ENGELLİ` olarak işaretlenmiştir.
- **Google Photorealistic 3D Tiles:** Varsayılan olarak **KAPALIDIR** (`evaluateGooglePhotorealistic3DTilesGate`); kullanıcı kendi API anahtarını ve maliyet onayını vermeden hiçbir ağ isteği yapılmaz.


