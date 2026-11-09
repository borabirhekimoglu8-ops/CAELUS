# CAELUS — Arayüz, Harita, İkon, Font ve Veri Kaynağı Ticari Varlık Envanteri

Bu envanter, **CAELUS Görsel Evrim ve Mekânsal Arayüz Programı** kapsamında masaüstü (`ui/`, `dist/`) ve mobil (`apps/caelus-ncm-mobile/`) arayüzlerde kullanılan tüm görsel kütüphanelerin, 3B/2B motorların, harita karolarının, ikonların, yazı tiplerinin ve açık veri kaynaklarının ticari ürün, kapalı kaynak dağıtım ve müşteri tesisine (on-prem / air-gapped) kurulum uygunluğunu kayıt altına alır.

---

## 1. Üretimde Serbest (Ticari Kapalı Kaynak ve On-Prem Dağıtıma Uygun) UI Varlıkları

| # | Varlık / Kütüphane / Kaynak | Sürüm / Konum | Lisans | Ticari Kullanım | Kapalı Kaynak Uyumu | Müşteri Tesisi / Çevrim Dışı | Gerekli Atıf / Bildirim | Durum Sınıfı |
|---|---|---|---|---|---|---|---|---|
| 1 | **CAELUS Açık Sarmal Marka Sembolü & Mekânsal Pusula UI** | `1.0.0` (`ui/index.html`, `apps/caelus-ncm-mobile`) | CAELUS Özgün Mülkiyeti | Evet | Evet | %100 Yerel SVG / CSS | CAELUS telif bildirimi | **ÜRETİMDE SERBEST** |
| 2 | **CesiumJS 3B Küre Motoru** | `1.114` (`ui/vendor/cesium/`) | Apache-2.0 | Evet | Evet | Evet (Yerel `vendor/` paketiyle çevrim dışı çalışır; Cesium Ion zorunlu değildir) | `Apache-2.0` bildirim dosyası | **ÜRETİMDE SERBEST** |
| 3 | **Natural Earth II Çevrim Dışı Yerküre Dokusu** | `1.0` (`ui/vendor/cesium/Assets/Textures/NaturalEarthII/`) | Public Domain (CC0) | Evet | Evet | %100 Çevrim Dışı | Atıf zorunlu değildir (`Natural Earth` kaynak notu korunur) | **ÜRETİMDE SERBEST** |
| 4 | **Three.js 3B Sahne Çekirdeği** | `0.160.0` (`ui/vendor/three/`) | MIT | Evet | Evet | %100 Çevrim Dışı | `MIT` telif satırı | **ÜRETİMDE SERBEST** |
| 5 | **MapLibre GL JS 2B/Bölgesel Harita** | `4.7.1` (`ui/vendor/maplibre-gl/`) | BSD-3-Clause | Evet | Evet | %100 Çevrim Dışı | `BSD-3-Clause` telif satırı | **ÜRETİMDE SERBEST** |
| 6 | **deck.gl Coğrafi Katman Motoru** | `9.0.36` (`ui/vendor/deckgl/`) | MIT | Evet | Evet | %100 Çevrim Dışı | `MIT` telif satırı | **ÜRETİMDE SERBEST** |
| 7 | **Cytoscape.js Odaklanabilir Ağ Motoru** | `3.30.2` (`ui/vendor/cytoscape/`) | MIT | Evet | Evet | %100 Çevrim Dışı | `MIT` telif satırı | **ÜRETİMDE SERBEST** |
| 8 | **Apache ECharts Karşılaştırma Grafikleri** | `5.5.1` (`ui/vendor/echarts/`) | Apache-2.0 | Evet | Evet | %100 Çevrim Dışı | `Apache-2.0` telif satırı | **ÜRETİMDE SERBEST** |
| 9 | **vis-timeline Zamansal Akış Çizgisi** | `7.7.3` (`ui/vendor/vis-timeline/`) | Apache-2.0 / MIT (Çift Lisans) | Evet | Evet | %100 Çevrim Dışı | `MIT / Apache-2.0` telif satırı | **ÜRETİMDE SERBEST** |
| 10 | **Floating UI Akıllı Konumlandırma** | `1.6.12` (`ui/vendor/floating-ui/`) | MIT | Evet | Evet | %100 Çevrim Dışı | `MIT` telif satırı | **ÜRETİMDE SERBEST** |
| 11 | **Motion (Framer Motion MIT Çekirdeği)** | `11.11.17` (`ui/vendor/motion/`) | MIT | Evet | Evet | %100 Çevrim Dışı | `MIT` telif satırı | **ÜRETİMDE SERBEST** |
| 12 | **Lucide Icons Vektör İkon Seti** | `0.454.0` (`ui/vendor/lucide/`) | ISC | Evet | Evet | %100 Çevrim Dışı | `ISC` telif satırı | **ÜRETİMDE SERBEST** |
| 13 | **Open Props Tasarım Tokenları** | `1.7.6` (`ui/vendor/open-props/`) | MIT | Evet | Evet | %100 Çevrim Dışı | `MIT` telif satırı | **ÜRETİMDE SERBEST** |
| 14 | **Sistem Yazı Tipleri (`Segoe UI`, `Inter`, `JetBrains Mono`, `Geist`)** | Yerel sistem font yığını | OFL-1.1 / Sistem Lisansı | Evet | Evet | %100 Çevrim Dışı (Harici Google Fonts CDN çağrısı yapılmaz) | OFL-1.1 bildirimi | **ÜRETİMDE SERBEST** |
| 15 | **USGS Earthquake Hazards GeoJSON & NASA GIBS / EONET / JPL Horizons** | Kamu Açık Veri API + Yerel Sabit Özet (`Snapshot`) | US Public Domain (17 U.S.C. § 105) | Evet | Evet | Çevrim dışı modda yerel `caelus_world_store.json` ve sabitlenmiş arşivle çalışır | Kaynak adı (`USGS`, `NASA EOSDIS GIBS`, `JPL`) arayüzde açıkça gösterilir | **ÜRETİMDE SERBEST** |

---

## 2. Koşullu / Ticari İnceleme Gerektiren veya Üretim Paketinin Dışında Tutulan Varlıklar

| # | Varlık / Bileşen | Lisans / Koşul | Neden Üretim Çekirdeğinde Varsayılan Değil? | CAELUS’taki Güvenli Karşılığı | Durum Sınıfı |
|---|---|---|---|---|---|
| 1 | **Open-Meteo Weather & Marine API** | CC BY 4.0 (Ücretsiz API uç noktası ticari olmayan kullanım içindir; ticari kullanımda ücretli API aboneliği gerekir) | Ücretsiz genel API uç noktası doğrudan ticari üründe kota/lisans kısıtına tabidir. | Çevrim dışı çekirdekte kayıtlı `ERA5` / `Snapshot` verisi kullanılır; kurumsal müşteride müşteri anahtarlı ticari Open-Meteo veya yerel meteoroloji adaptörü kullanılır. | **TİCARİ API ANAHTARI GEREKTİRİR** |
| 2 | **Google Photorealistic 3D Tiles API** | Google Maps Platform Terms | Ücretli bulut anahtarı gerektirir ve çevrim dışı / on-prem dağıtımla uyumsuzdur. | `evaluateGooglePhotorealistic3DTilesGate()` tarafından varsayılan olarak **KAPALI** tutulur (`0` ağ isteği); yerine Apache-2.0 CesiumJS + Natural Earth II kullanılır. | **TİCARİ PAKET DIŞI (VARSAYILAN KAPALI)** |
| 3 | **Theatre.js Studio (`@theatre/studio`)** | AGPL-3.0 (`@theatre/studio` düzenleyici paketi) | `@theatre/studio` AGPL-3.0 copyleft lisanslıdır; kapalı kaynak ticari ürüne gömülemez. | Üretim paketinde yalnızca **MIT lisanslı `@theatre/core` çalışma zamanı** kullanılır; AGPL `@theatre/studio` paketi depoda ve üretimde yer almaz. | **AGPL STUDIO DIŞLANDI · MIT CORE SERBEST** |
| 4 | **Firecrawl Web Crawler** | AGPL-3.0 | AGPL-3.0 copyleft lisansı kapalı kaynak dağıtımla uyumsuzdur. | Üretim paketinin dışındadır; yerine CAELUS’un kendi izin verici (MIT/Apache-2.0) yerel belge ve açık veri adaptörleri kullanılır. | **TİCARİ PAKET DIŞI** |

---

## 3. Referans Sistemlerle Telif ve Marka Ayrımı Doğrulaması

Bölüm 2’de incelenen 8 referans sistemin (`SpaceEngine`, `OpenSpace`, `Earth / Nullschool`, `Cosmoscope`, `Under the Surface`, `Bloomberg`, `NASA Eyes`, `Apple VisionOS`) hiçbirinden logo, marka adı, telifli görsel, kaplama veya özel kaynak kodu kopyalanmamıştır. Tüm arayüz bileşenleri, açık sarmal sembolü, CSS katmanları ve etkileşim mantığı CAELUS’a özgü olarak geliştirilmiştir.
