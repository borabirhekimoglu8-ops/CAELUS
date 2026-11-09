# CAELUS — Gerçek Saha Pilotu Hazırlık Paketi (Bölüm 19)

> **Dürüstlük ve Kapsam Beyanı:** Bu belge, CAELUS platformunun liman, kıyı lojistiği ve afet hazırlığı senaryolarında gerçek bir saha pilotuna çıkabilmesi için hazırlanmış **teknik ve operasyonel hazırlık paketidir**. Gerçekleşmemiş hiçbir kurumsal müşteri, liman idaresi veya saha testi yapılmış gibi sunulmamıştır; tüm saha doğrulamaları katılımcı kurumun açık izni ve veri sözleşmesiyle yürütülür.

---

## 1. Örnek Liman Senaryosu (İzmir Alsancak / Ege Kıyı Koridoru)

- **Senaryo Kimliği:** `PILOT-IZMIR-PORT-01`
- **Tetikleyici Olay:** Ege Denizi açıklarında gerçekleşen `Mw >= 4.5` büyüklüğünde bir deprem (USGS GeoJSON canlı/kayıtlı akışı) ve eşzamanlı kuvvetli rüzgâr/fırtına uyarısı (Open-Meteo + NASA EONET v3).
- **Operasyonel Soru:** *"Deprem ve rüzgâr darbesi sonrasında rıhtım vinçlerinin (STS/RTG) operasyonel kapasitesi, enerji yedekliliği ve konteyner tahliye darboğazı ilk 72 saatte nasıl değişir; yedek enerji + vinç koruma protokolü (B Seçeneği) mevcut duruma (A Seçeneği) göre hangi farkı üretir?"*
- **Hesaplama Motoru Sınırı:**
  - Gerçek olay verisi (USGS / Open-Meteo / EONET) **otomatik olarak** simülasyon başlatmaz.
  - Operatör olayı inceler, **"Veriyi Senaryoda Kullan (Snapshot Oluştur)"** adımıyla değişmez (immutable) bir veri anlık görüntüsü (`snapshot_id` + `SHA-256`) üretir ve C++17 deterministik motorunda (`core_engine.cpp`) A/B karşılaştırmasını çalıştırır.

---

## 2. Kullanıcı Görevleri (Operatör / Planlama Uzmanı Görev Akışı)

| Görev Kodu | Görev Başlığı | Beklenen Eylem | Doğrulama Çıktısı |
| :--- | :--- | :--- | :--- |
| **G-01** | Bölgesel Olay Tespiti | `Dünyam` sahnesinde İzmir/Ege bölgesine odaklan, USGS deprem ve NASA EONET olay işaretçilerini incele. | Olay kaynağının (`source_id`, `observed_at`, `fetched_at`, `CRS: EPSG:4326`) yan panelde görüntülenmesi. |
| **G-02** | Uydu ve Katman Doğrulaması | NASA GIBS katmanında (`VIIRS_SNPP_CorrectedReflectance_TrueColor`) gözlem tarihini seç; veri olmayan tarihlerde açık uyarıyı doğrula. | Katman künyesi ve tarih geçerlilik durumunun ekranda belirmesi. |
| **G-03** | İlişki Ağı ve Veri İnceleme | `Keşfet` ekranında **Cytoscape.js** ilişki ağında düğüm/bağlantı türlerini (`Ölçüm`, `Uzman Girişi`, `Model Bağıntısı`, `Hipotez`) ve **Perspective / DuckDB** tablosunda olay kayıtlarını filtrele. | `"Bağlantı ≠ kanıtlanmış nedensellik"` ayrımının ve kaynak kayıt bağlantısının görülmesi. |
| **G-04** | Değişmez Snapshot ve A/B Senaryo Koşumu | Seçilen gerçek olayı kullanıcı onayıyla Snapshot'a dönüştür; `Senaryolar` ekranında A/B karşılaştırmasını C++17 motoruyla çalıştır. | Deterministik `snapshot_hash`, sabit nokta ölçeği (`1e6`), A/B fark tablosu ve varsayım listesi. |
| **G-05** | Dijital İkiz ve Denetim İzi | `Hafıza` zaman çizgisinde (`vis-timeline`) olayı, senaryo koşumunu ve **Eclipse Ditto** örnek cihaz revizyonunu incele; raporu dışa aktar. | Tarih/saat damgalı, kaynak künyeli HTML/Markdown/OpenUSD (`.usda`) çıktısı. |

---

## 3. Veri Sözlüğü (Normalize Gözlem Şeması — 15 Zorunlu Alan)

CAELUS'a giren her dış gözlem ve kurumsal kayıt aşağıdaki ortak şemaya normalize edilir:

| Alan Adı | Veri Tipi | Zorunluluk / Kural | Açıklama |
| :--- | :--- | :--- | :--- |
| `source_id` | `string` | Zorunlu | Kaynak tanımlayıcısı (`usgs_eq_feed`, `nasa_eonet_v3`, `open_meteo_weather`, `eclipse_ditto_twin`, `jpl_horizons_ephemeris`). |
| `source_url` | `string (URL)` | Zorunlu | Verinin alındığı tam uç nokta veya resmi kaynak adresi. |
| `attribution` | `string` | Zorunlu | Kurumsal kaynak ve telif/atıf metni. |
| `source_event_id` | `string` | Zorunlu | Kaynağın kendi benzersiz olay/varlık kimliği (mükerrer kayıt önleme anahtarı). |
| `observed_at` | `ISO-8601 UTC` | Zorunlu | Olayın gerçek dünyada gerçekleştiği veya ölçüldüğü zaman. |
| `published_at` | `ISO-8601 UTC \| null` | Bilinmiyorsa `null` | Kaynağın veriyi yayımladığı/güncellediği zaman (tahmin edilmez). |
| `fetched_at` | `ISO-8601 UTC` | Zorunlu | CAELUS'un veriyi kaynaktan çektiği zaman. |
| `event_time` | `ISO-8601 UTC` | Zorunlu | Zaman çizgisi ve sıralama için kanonik olay zamanı. |
| `coordinates` | `{lat, lon, depthKm?}` | Zorunlu (Konumsal ise) | `[-90..90]` enlem, `[-180..180]` boylam doğrulamalı koordinat nesnesi. |
| `crs` | `string` | Zorunlu (`EPSG:4326` / `ICRF`) | Koordinat referans sistemi. |
| `value` | `number \| object` | Zorunlu | Ölçüm veya olay büyüklüğü (uydurma değer üretilmez). |
| `unit` | `string \| null` | Bilinmiyorsa `null` | Ölçüm birimi (`Mw`, `km/h`, `°C`, `AU`, `%`). |
| `revision` | `integer >= 1` | Zorunlu | Aynı `source_event_id` güncellendiğinde artan revizyon numarası. |
| `license_terms_pointer` | `string` | Zorunlu | Verinin kullanım/lisans koşullarına işaret eden bağlantı veya etiket. |
| `data_kind` | `enum` | Zorunlu | `MEASUREMENT` (Ölçüm), `OBSERVATION` (Gözlem), `CALCULATED_EPHEMERIS` (Hesaplanmış Konum), `SIMULATION` (Simülasyon), `SAMPLE_FIXTURE` (Test/Örnek). |

---

## 4. Açık Kaynak Veri ile Kurumsal Veri Ayrımı

| Veri Katmanı | Kaynak Türü | Erişim ve Gizlilik | Saha Pilotundaki Rolü |
| :--- | :--- | :--- | :--- |
| **Açık Kamusal Veriler** | USGS GeoJSON, NASA EONET v3, NASA GIBS, Open-Meteo, JPL Horizons | Ücretsiz, açık lisanslı, API anahtarsız | Sıfır maliyetli ilk saha demosunun temel gerçek dünya katmanı. |
| **İsteğe Bağlı Ücretli / Anahtarlı Servisler** | Google Photorealistic 3D Tiles | Varsayılan **KAPALI**; kurumun kendi API anahtarı ve maliyet onayı gerekir | Yalnızca kurum talep ederse ve kendi anahtarını sağlarsa açılır. |
| **Kurumsal İç Veriler (Saha Pilotu)** | Liman TOS/SCADA özetleri, Eclipse Ditto cihaz ikizleri, vinç/enerji telemetrisi | Yalnızca yerel ağda (on-premise), kurum dışına çıkmaz | Başlangıçta anonimleştirilmiş CSV/JSON veya yerel Eclipse Ditto adaptörüyle salt-okunur bağlanır. |

---

## 5. Başarı Ölçütleri (Pilot Kabul Kriterleri)

1. **Veri Künyesi Tamlığı:** Ekranda gösterilen tüm gerçek olayların %100'ünde kaynak, gözlem zamanı, çekilme zamanı ve koordinat sistemi (`EPSG:4326`) açıkça görünmelidir.
2. **Deterministik Tekrarlanabilirlik:** Aynı `snapshot_id` ve aynı `model_version` ile çalıştırılan senaryolar bit-bazında aynı `snapshot_hash` ve aynı A/B sayısal çıktısını üretmelidir.
3. **Çevrimdışı Dayanıklılık:** İnternet bağlantısı kesildiğinde uygulama çökmemeli; son geçerli önbellek veya açıkça `TEST/ÖRNEK (FIXTURE)` etiketli yerel veriyle çalışmaya devam etmelidir.
4. **Epistemik Şeffaflık:** Operatör bir grafik veya ilişki ağı gördüğünde neyin gerçek ölçüm, neyin model varsayımı ve neyin hipotez olduğunu tek bakışta ayırt edebilmelidir.

---

## 6. Güvenlik, Gizlilik ve Sıfır Maliyetli İlk Demo Kapsamı

- **Sıfır Maliyetli İlk Demo Kapsamı:**
  - Tek çalıştırılabilir yerel dosya (`caelus_os_v9.exe`) + gömülü Web arayüzü.
  - Hiçbir bulut aboneliği, ücretli harita anahtarı veya harici veritabanı sunucusu gerektirmez.
  - USGS, NASA EONET v3, NASA GIBS, Open-Meteo ve yerel C++17 motoru ile uçtan uca çalışır.
- **Güvenlik ve Gizlilik Soruları (Kurum IT İncelemesi İçin):**
  1. *Veriler nereye kaydediliyor?* Yalnızca yerel makinedeki `caelus_world_store.json` ve yerel önbellek dosyalarına.
  2. *Yerel LLM veriyi dışarı gönderir mi?* Hayır; LLM köprüsü yalnızca `localhost` (`127.0.0.1:11434`) üzerindeki yerel Ollama servisine bağlanır.
  3. *Harici ağ istekleri nasıl sınırlandırılır?* Yalnızca HTTPS izin listesindeki (`allowlist`) bilimsel/kamusal veri uç noktalarına zaman aşımı ve boyut sınırıyla (`maxBytes`) salt-okunur `GET` isteği yapılır.

---

## 7. Katılımcı İzin ve Onay Kontrol Listesi

- [ ] Katılımcı kuruma gösterilen açık kaynak verilerin (USGS, NASA, Open-Meteo) operasyonel resmi alarm sistemi yerine geçmediği, karar destek ve senaryo analizi amaçlı olduğu yazılı olarak bildirildi.
- [ ] Kurum kendi iç verisini (ör. örnek vinç/enerji tablosu veya Eclipse Ditto cihaz durumu) bağlayacaksa kişisel veri (KVKK/GDPR) içermeyen anonimleştirilmiş veri seti kullanıldığı doğrulandı.
- [ ] İsteğe bağlı ücretli servislerin (Google Photorealistic 3D Tiles vb.) varsayılan olarak kapalı olduğu ve kurum onayı olmadan hiçbir ücretli API çağrısı yapılmadığı teyit edildi.
- [ ] Pilot oturumu sonunda üretilen Snapshot ve Senaryo Raporlarının kurumun kendi yerel diskinde saklandığı doğrulandı.
