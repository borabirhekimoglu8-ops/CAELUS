# CAELUS — Yaşayan Dijital Evren ve Evrensel Karar Platformu: Son Durum ve V9 Görsel Dil & Çok Dilli Mimari Raporu

**Tarih:** 9 Kasım 2026  
**Hedef Donanım Doğrulaması:** Windows 11 · Intel Core i7-8550U · Intel UHD Graphics 620 (`DPR 1.0`) · 16 GB RAM  
**Bağımsız Çalıştırılabilir İkili (Tek Dosya Blackbox Binary):** [`dist/caelus_os.exe`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/dist/caelus_os.exe) (`< 50 MB` hedefi içinde, gömülü HTML/JS/CSS ve onaylı holografik sarmal marka varlıkları dahil) ve [`dist/caelus_standalone.html`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/dist/caelus_standalone.html)  
**Tasarım, Görsel Referans ve i18n Mimari Belgesi:** [`docs/TASARIM_VE_DIL_MIMARISI_V9.md`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/TASARIM_VE_DIL_MIMARISI_V9.md)

---

## 1. Yönetici Özeti

**CAELUS**, farklı sektörlerdeki sistemlerin, varlıkların, süreçlerin ve karar senaryolarının geçmişten günümüze ve geleceğe farklı ölçeklerde (**1. Kozmos → 2. Güneş Sistemi → 3. Dünya → 4. İnsan Sistemleri → 5. Alternatif Senaryo Dalları**) modellendiği, gerçek dünyadan veya yerel kaynaklardan gelen verilerle güncellendiği, C++17 / Rust deterministik hesaplama motorunda karşı-olgusal (**A/B `compare_lever` / Seçenekleri karşılaştır**) kararların test edildiği ve onaylı **"Holografik Atmosfer" (Buz Mavisi `#88D4FF`, Koyu İndigo `#040812`–`#0B1324` ve Sıcak Altın Işık `#E6C387`)** tasarım diliyle sunulan **yerel, çevrimdışı öncelikli (`offline-first`) yaşayan bir dijital evren platformudur**.

Bu sürümde (`V9`) `CAELUS_Gorsel_Dil_Tam_Prompt_Paketi` kapsamındaki tüm görsel kimlik, ekran bazlı arayüz/UX iyileştirmeleri, kritik PDF yazdırma düzeltmesi ve çok dilli (`CaelusI18n`) mimari gereksinimleri eksiksiz uygulanmış ve öncesi/sonrası (`before` / `after`) ekran görüntüleri + PDF çıktılarıyla doğrulanmıştır.

---

## 2. V9 Görsel Dil, Ekran İyileştirmeleri, PDF Düzeltmesi ve Çok Dilli Mimari Özeti

### 2.1 Onaylı Holografik Atmosfer ve Marka Sembolü Üretimi
- **Ana Görsel Atmosfer Referansı (`01_Onayli_Holografik_Atmosfer.png`) ve Sembol Form Referansı (`02_Sembol_Form_Referansi.png`):**
  - Açık uçlu, iç içe sarmal katmanlar, merkezde nefes alan boşluk, buz mavisi (`#88D4FF`), dumanlı arduvaz/koyu indigo (`#040812`–`#0B1324`) ve kontrollü sıcak altın ışık yansıması (`#E6C387`) esas alınarak yerel vektör ve raster marka varlıkları üretilmiştir:
    - [`ui/assets/caelus-symbol.svg`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/assets/caelus-symbol.svg) (vektör sembol)
    - [`ui/assets/caelus-logo.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/assets/caelus-logo.png) (`1024×1024` RGBA yüksek çözünürlüklü PNG)
    - [`include/caelus_logo_asset.h`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/include/caelus_logo_asset.h) (`CAELUS_LOGO_PNG[]` gömülü C++ başlığı)
  - Sembol dini bir işaret veya tarihsel rekonstrüksiyon olarak sunulmamış; eski Sirius/Orion `#caelus-constellation-watermark` SVG'si kaldırılarak yerine harita ve veri katmanlarını hiçbir zaman örtmeyen, `Ayarlar` ekranından tek tıkla kapatılabilen (`Marka İzi: Açık / Kapalı`) düşük yoğunluklu açık konturlu sarmal marka izi yerleştirilmiştir.

### 2.2 Ekran Bazlı Görsel ve Etkileşimsel Düzeltmeler
1. **Dünyam (`01_dunyam`):**
   - 3B Dünya küresi tam ekran ana sahne olarak korunmuş; Ege/İzmir koridorundaki (`İzmir Limanı`, `Aliağa`, `Çeşme Boğazı`, `Güney Ege`, `Kuzey Ege`, `Batı Ege / Pire`) ve USGS sismik noktalarındaki etiket çakışmalarını önlemek üzere radyal `pixelOffset` ve mesafe ölçekleme kuralları (`syncCesiumSceneWithCaelusState`) uygulanmıştır.
   - Sağdaki seçili olay/varlık kartındaki teknik `"📸 Veriyi Senaryoda Kullan (Snapshot)"` düğmesi sadeleştirilerek **`"Bu olayın verilerini kullan"`** (`#btn-dunyam-callout-snapshot`) olarak güncellenmiştir.
2. **Keşfet (`02_kesfet_system`, `03_kesfet_maplibre`, `04_kesfet_cytoscape`, `05_kesfet_perspective`):**
   - **Bölgesel Harita (`MapLibre GL JS + deck.gl`):** Düşük çözünürlüklü (`maxzoom: 2`) raster altlığın bölgesel yakınlaştırmada (`zoom: 6.4`) bulanık görünmesi sorunu giderilmiş; yüksek kontrastlı çevrimdışı vektör Ege/Batı Anadolu/Yunanistan/Adalar kıyı konturları, `1°×1°` coğrafi ızgara (`graticule`), okunaklı DOM işaretçi rozetleri ve tek tıkla açılan **`📋 Olay Listesi`** (`#kesfet-maplibre-fallback-list`) eklenmiştir.
   - **İlişki Ağı (`Cytoscape.js`):** Merkezde üst üste binen kenar etiketleri (`Model Varsayımı` vb.) kaldırılmış; düğümler geniş aralıklı tek elips (`rx=265, ry=124`) üzerine dışa dönük etiketlerle yerleştirilmiş, seçili düğümün 1-adım komşuluğu (`.active-focus`, `.active-neighbor`, `.active-edge`, `.dimmed`) vurgulanmış, klavye (`ArrowLeft`/`ArrowRight`/`Escape`) ve **`↺ Sıfırla`** (`#btn-cytoscape-reset`) desteği eklenmiş, sağ inceleyicide ölçüm, varsayım ve hipotez ayrımı (`Korelasyon ≠ Nedensellik`, `causalProof: false`) açıkça gösterilmiştir.
   - **Gözlem Tablosu (`Perspective + DuckDB`):** Ana tabloda kaynak, olay zamanı, alım zamanı, değer/birim ve güncellik sade biçimde sunulurken; ham DuckDB SQL sorgusu ve iç şema bilgileri açılır/kapanır **`Teknik Sorgu ve Şema Ayrıntıları`** (`<details>`) alanına alınmıştır.
3. **Kozmos (`06_kozmos`):**
   - NASA JPL J2000.0 analitik Kepler efemerisi (`1800–2050 UTC`) ve Spacekit 3B sahnesinde görsel ölçek (`Log-Ölçekli Görsel Yörünge` vs gerçek `AU` mesafesi), zaman kapsamı (`1800–2050 UTC`) ve kapsam dışı tarih (`>2050` / `<1800`) uyarıları dürüstçe etiketlenmiştir.
4. **Senaryolar (`07_senaryolar`):**
   - 4 adımlı akış (**`1. Durumu seç` → `2. Değişikliği seç` → `3. Karşılaştır` → `4. Sonucu ve dayanağını incele`**) tıklanabilir odak sekmeleri (`data-scen-step-target="1..4"`) ve **`Tüm Adımlar Görünümü`** (`#btn-scen-step-focus-toggle`) ile etkileşimli hale getirilmiştir.
   - Yan yana karşılaştırma kartları ve rapor tabloları **`"Hiçbir şey yapılmazsa"`** ve **`"Bu adım uygulanırsa"`** başlıklarıyla sadeleştirilmiş; `Snapshot`, `seed`, `hash` ve motor parametreleri **`"Nasıl hesaplandı?"`** açılır/kapanır teknik ayrıntı kutusuna yerleştirilmiştir.
5. **Hafıza (`08_hafiza`):**
   - `vis-timeline` ve Zaman Tekeri üzerinde kronolojik sıralama korunurken, aynı dış kaynaktan (ör. ardışık USGS deprem kayıtları) gelen yakın zamanlı kayıtlar **`(×N Kayıt Grubu)`** rozetiyle gruplanmış ve seçili kayıtta **`"Tek tek incele (×N)"`** (`data-hafiza-toggle-expand`) düğmesiyle tekil inceleme imkânı sağlanmıştır.
6. **Bağlantılar (`09_baglantilar`):**
   - Kaynak adı, sağladığı bilgi, coğrafi kapsam, ölçüm zamanı (`t_olay`), son başarılı alım zamanı (`t_kayıt`) ve gerçek bağlantı durumu sade kartlarda sunulmuş; `10 UI/3B Depo Matrisi`, `13 Gerçek Dünya Teknolojisi` ve `38 Modül Standart Denetçisi` varsayılan olarak kapalı **`Gelişmiş Mimari Kataloglar`** (`#baglantilar-tech-catalogs-details`) altına alınmıştır.
7. **Ayarlar ve Kritik PDF Rapor Düzeltmesi (`10_ayarlar`, `CAELUS_Rapor_after.pdf`):**
   - **Ayarlar:** `Koyu (Holografik Atmosfer)` teması, `Marka İzi: Açık / Kapalı` anahtarı, aranabilir 24 dilli **BCP 47 Dünya Dilleri Kataloğu** (`#inp-settings-lang-search` + `#sel-settings-world-lang-catalog`), **Anahtar Kapsam Yüzdesi vs İnsan İncelemesi Yüzdesi** ayrımı ve varsayılan olarak kapalı **Dinamik İçerik Çevirisi Sınırı** (`#chk-dynamic-translation-gate`) eklenmiştir.
   - **Kritik PDF Yazdırma Düzeltmesi (`@media print`):** Önceki sürümde rapor modalı açıkken yazdırma alındığında arka plandaki koyu uygulama kabuğunun görünmesi ve raporun tek sayfada kırpılması hatası tamamen giderilmiştir. `@media print` altında `.workbench-shell`, `.top-header`, `.status-footer` ve modal aksiyon düğmeleri gizlenmiş; `#dossier-modal`, `#dossier-modal .modal-dialog` ve `#dossier-content` `position: static !important; width: 100% !important; height: auto !important; overflow: visible !important; background: #ffffff !important; color: #0f172a !important;` olarak sıfırlanmış ve tüm tablo hücreleri beyaz zemin üzerinde koyu mürekkep (`#0f172a`) kontrastıyla 3 tam sayfa olarak (`docs/evidence_v9/after/CAELUS_Rapor_after.pdf`) doğrulanmıştır.

---

## 3. Dış Referans ve Bağlantı Doğrulama Özeti

- **Çevrimiçi Erişilen ve İncelenen Referanslar (`HTTP 200`):** `cesium.com`, `visgl.github.io/deck.gl`, `maplibre.org`, `js.cytoscape.org`, `perspective-dev.github.io`, `duckdb.org`, `visjs.github.io/vis-timeline`, `typpo.github.io/spacekit`, `theatrejs.com`, `echarts.apache.org`, `d3js.org`, `threejs.org`, `gsap.com`, `linear.app`, `stripe.com`, `raycast.com`, `vercel.com/geist`.
- **Anti-Bot / Erişim Kısıtı Nedeniyle Açılmayan Bağlantılar (`HTTP 403 Forbidden`):** `behance.net` üzerindeki 9 galeri bağlantısı (`HTTP 403`) güvenlik ve dürüstlük kuralı gereği zorlanmamış ve incelenmiş gibi gösterilmemiştir; tüm görsel kararlar paket içindeki yerel `GORSELLER/01_Onayli_Holografik_Atmosfer.png` ve `GORSELLER/02_Sembol_Form_Referansi.png` dosyalarından alınmıştır.

---

## 4. Öncesi / Sonrası (`Before` / `After`) Görsel Kanıt ve PDF Doğrulama Tablosu

Tüm ekranların değişiklik öncesi (`before`) ve değişiklik sonrası (`after`) `1600×960`, `1366×768` ve `390×844` ekran görüntüleri ile PDF çıktıları aşağıdaki dizinlerde üretilmiş ve görsel olarak denetlenmiştir:

- **Öncesi (`Before` — 31 PNG + 1 PDF):** [`docs/evidence_v9/before/`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before)
- **Sonrası (`After` — 30 PNG + 1 PDF):** [`docs/evidence_v9/after/`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after)

| Ekran / Kanıt | Öncesi (`Before`) | Sonrası (`After`) | Doğrulanan İyileştirme |
| :--- | :--- | :--- | :--- |
| **1. Dünyam (`1600×960` / `390×844`)** | [`01_dunyam_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/01_dunyam_1600x960.png) | [`01_dunyam_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/01_dunyam_1600x960.png) | Açık sarmal marka sembolü, çakışmayan Ege koridor etiketleri, `"Bu olayın verilerini kullan"` eylem düğmesi, `390×844` mobilde sıfır yatay taşma. |
| **2. Keşfet — Bölgesel Harita (`MapLibre + deck.gl`)** | [`03_kesfet_maplibre_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/03_kesfet_maplibre_1600x960.png) | [`03_kesfet_maplibre_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/03_kesfet_maplibre_1600x960.png) | Bulanık raster yerine net çevrimdışı Ege/Anadolu/Yunanistan/Adalar kıyı vektörleri, `1°×1°` coğrafi ızgara, okunaklı DOM liman etiketleri ve `📋 Olay Listesi`. |
| **3. Keşfet — İlişki Ağı (`Cytoscape.js`)** | [`04_kesfet_cytoscape_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/04_kesfet_cytoscape_1600x960.png) | [`04_kesfet_cytoscape_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/04_kesfet_cytoscape_1600x960.png) | Merkezdeki üst üste binen kenar yazıları temizlendi; tek elips üzerinde ferah düğüm yerleşimi, 1-adım komşuluk vurgusu ve `Korelasyon ≠ Nedensellik` inceleyicisi. |
| **4. Keşfet — Gözlem Tablosu (`Perspective + DuckDB`)** | [`05_kesfet_perspective_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/05_kesfet_perspective_1600x960.png) | [`05_kesfet_perspective_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/05_kesfet_perspective_1600x960.png) | Sade gözlem özeti üstte; ham DuckDB SQL sorgusu ve iç şema detayları açılır/kapanır teknik ayrıntı alanında. |
| **5. Kozmos (`Spacekit + JPL Horizons`)** | [`06_kozmos_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/06_kozmos_1600x960.png) | [`06_kozmos_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/06_kozmos_1600x960.png) | `1800–2050 UTC` J2000.0 Kepler efemerisi, görsel ölçek ve birim (`AU`, `°`) beyanı. |
| **6. Senaryolar (`4 Adımlı Karar Akışı`)** | [`07_senaryolar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/07_senaryolar_1600x960.png) | [`07_senaryolar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/07_senaryolar_1600x960.png) | Tıklanabilir 4 adım (`1. Durumu seç` → `4. Sonucu ve dayanağını incele`), `"Hiçbir şey yapılmazsa"` vs `"Bu adım uygulanırsa"` ve `"Nasıl hesaplandı?"` kutusu. |
| **7. Hafıza (`vis-timeline + Zaman Tekeri`)** | [`08_hafiza_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/08_hafiza_1600x960.png) | [`08_hafiza_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/08_hafiza_1600x960.png) | Tekrarlı dış kaynak kayıtları için `(×11 Kayıt Grubu)` rozeti ve `"Tek tek incele"` açma/daraltma kontrolü. |
| **8. Bağlantılar (`Açık Veri Kaynakları`)** | [`09_baglantilar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/09_baglantilar_1600x960.png) | [`09_baglantilar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/09_baglantilar_1600x960.png) | Sade kaynak kartları; iç depo/modül matrisleri daraltılmış `Gelişmiş Mimari Kataloglar` altında. |
| **9. Ayarlar (`Holografik Atmosfer & BCP 47 Dil`)** | [`10_ayarlar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/10_ayarlar_1600x960.png) | [`10_ayarlar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/10_ayarlar_1600x960.png) | `Koyu (Holografik Atmosfer)`, `Marka İzi: Açık / Kapalı`, aranabilir 24 dilli BCP 47 kataloğu, anahtar kapsamı vs insan incelemesi oranı ve dinamik çeviri kapısı. |
| **10. Resmi Karar Raporu PDF (`@media print`)** | [`CAELUS_Rapor_before.pdf`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/CAELUS_Rapor_before.pdf) | [`CAELUS_Rapor_after.pdf`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/CAELUS_Rapor_after.pdf) | Modal örtüşmesi ve kırpılma tamamen giderildi; 3 tam sayfa beyaz kağıt üzerinde koyu mürekkep (`#0f172a`) tablo ve metinlerle eksiksiz PDF çıktısı. |

---

## 5. Zorunlu 8 Kabul ve Teslim Kriteri Durum Tablosu (`GEÇTİ / KISMEN / YAPILAMADI`)

| # | Kabul Kriteri (`CAELUS_TEK_ANA_PROMPT.md` Bölüm 16) | Durum | Kanıt ve Doğrulama Özeti |
| :--- | :--- | :---: | :--- |
| **1** | **Görsel Kimlik ve Sembol:** Açık konturlu sarmal atmosfer ve marka varlıkları (`caelus-symbol.svg`, `caelus-logo.png`, `caelus_logo_asset.h`) üretildi ve tutarlı biçimde uygulandı. | **GEÇTİ** | [`ui/assets/caelus-symbol.svg`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/assets/caelus-symbol.svg), [`ui/assets/caelus-logo.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/assets/caelus-logo.png) (`243.228 bayt`), [`include/caelus_logo_asset.h`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/include/caelus_logo_asset.h) ve `Test 50` ile doğrulandı. |
| **2** | **Keşfet Haritası ve İlişki Ağı:** `Keşfet` haritasındaki bulanıklık ve `Cytoscape` merkez yazı çakışmaları giderildi. | **GEÇTİ** | [`03_kesfet_maplibre_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/03_kesfet_maplibre_1600x960.png) ve [`04_kesfet_cytoscape_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/04_kesfet_cytoscape_1600x960.png) üzerinde görsel olarak doğrulandı. |
| **3** | **Sade Karar ve Hafıza Akışı:** `Senaryolar`, `Hafıza` ve `Bağlantılar` ekranları teknik iç terimlerden arındırıldı; anlaşılır 4 adımlı karar akışı ve `(×N)` kayıt gruplaması kuruldu. | **GEÇTİ** | [`07_senaryolar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/07_senaryolar_1600x960.png), [`08_hafiza_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/08_hafiza_1600x960.png) ve [`09_baglantilar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/09_baglantilar_1600x960.png) ile doğrulandı. |
| **4** | **Rapor / PDF Yazdırma Düzeltmesi:** Rapor / PDF yazdırma hatası düzeltildi ve gerçek PDF çıktısıyla (`CAELUS_Rapor_after.pdf`) kanıtlandı. | **GEÇTİ** | [`CAELUS_Rapor_before.pdf`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/before/CAELUS_Rapor_before.pdf) (1 sayfada kırpılmış modal) vs [`CAELUS_Rapor_after.pdf`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/CAELUS_Rapor_after.pdf) (3 tam sayfa, okunaklı tablo ve metinler). |
| **5** | **Çok Dilli (`i18n`) Mimari:** Türkçe (`tr-TR`) ve İngilizce (`en-US`) tam kapsam (`%100` anahtar kapsamı, `%100` insan incelemesi), RTL (`ar-SA`, `he-IL`) düzeni, aranabilir 24 dilli BCP 47 kataloğu ve yerel biçimlendirme (`Intl`) çalışır durumda. | **GEÇTİ** | `CaelusI18n` (`ui/scenario_compiler.js`), [`10_ayarlar_1600x960.png`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/evidence_v9/after/10_ayarlar_1600x960.png) ve `Test 16`, `Test 39`, `Test 50` ile doğrulandı. |
| **6** | **Geriye Dönük Uyumluluk ve Otomatik Testler:** Mevcut C++17 / Rust deterministik motor ve birim testleri (`44 / 44`) kırılmadı. | **GEÇTİ** | `node --test tests/universal_scenario_compiler.test.mjs` → **44 / 44 PASS (`0 fail`)**; `BS-01_SAHTE_UFUK` ve `EX-01_LIMAN_SOGUK_ZINCIR` deterministik çıktıları birebir korundu. |
| **7** | **Görsel Kanıt Paketi:** Tüm ekranların öncesi (`before`) ve sonrası (`after`) `1600×960`, `1366×768`, `390×844` ekran görüntüleri ve PDF kanıtları alındı ve incelendi. | **GEÇTİ** | `docs/evidence_v9/before/` ve `docs/evidence_v9/after/` altında toplam 61 PNG ekran görüntüsü ve 2 PDF dosyası üretildi ve incelendi. |
| **8** | **Kullanıcı Verisi Korunumu:** Kullanıcı verisi (`caelus_world_store.json`) korundu. | **GEÇTİ** | `caelus_world_store.json` SHA-256 özeti (`4C69F99FBB19D459309183A319D344A9236BDAF8A792F6D6C796A0B845896FD1`) yedek dosyayla bayt-bayt aynıdır. |
