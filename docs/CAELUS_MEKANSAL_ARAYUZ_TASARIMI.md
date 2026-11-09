# CAELUS — Görsel Evrim ve Mekânsal Arayüz Tasarımı

## 1. Yönetici Özeti ve Tasarım Vizyonu

CAELUS; olayları, varlıkları, kurumları, coğrafyaları, zaman kesitlerini, etki ağlarını ve alternatif gelecekleri aynı araştırma ortamında inceleyen evrensel bir dünya analizi ve karar destek platformudur. Bu çalışma kapsamında CAELUS’un masaüstü (`ui/index.html`, `dist/index.html`) ve mobil/hibrit (`apps/caelus-ncm-mobile`) arayüzleri klasik "sabit üst bar + sabit alt sekme barı + çok sayıda eşzamanlı kart" düzeninden çıkarılmış; **başlıksız, sahne merkezli, bağlamsal ve kademeli bilgi açılımına (progressive disclosure) dayalı** özgün bir mekânsal deneyime dönüştürülmüştür.

> **Temel Tasarım İlkesi:** CAELUS’un yaşayan dünyası ana sahnedir (`100dvh`); arayüz bileşenleri sahneyi çerçevelemez, kullanıcı ihtiyaç duyduğu anda ve ihtiyaç duyduğu yerde bağlamsal olarak belirir ve işi bittiğinde sahneye geri çekilir.

---

## 2. Mevcut Arayüzün Görsel ve Yapısal Teşhisi (Önceki Durum)

Değişiklik öncesinde çalışan uygulama (`1600×960`, `1366×768` ve `390×844` çözünürlüklerde) incelenmiş ve aşağıdaki somut görsel/etkileşimsel sorunlar tespit edilerek giderilmiştir:

| # | Tespit Edilen Sorun (Önceki Durum) | Kök Neden (Dosya / Satır) | Uygulanan Mekânsal Çözüm |
|---|---|---|---|
| 1 | **Sabit Üst Navigasyon Barı (`.top-header`)**: Masaüstünde 7 sekme, 4 durum rozeti, dil seçici ve rapor düğmesi üstte sabit bir yönetim paneli şeridi oluşturuyordu. | `ui/index.html` (`.top-header`) ve `apps/caelus-ncm-mobile/app/page.tsx` (`.app-header`, `.trust-strip`) | Sabit üst bar tamamen kaldırıldı. Yerine sol üst köşede tek bir kompakt **CAELUS Açık Sarmal Mekânsal Pusulası (`#caelus-spatial-compass`)** ve sağ üstte kompakt **Zaman Merceği / Performans / Dayanak Kapsülü (`#caelus-stage-top-right-pod`)** yerleştirildi. |
| 2 | **Sabit Alt Sekme Barı (`#caelus-mobile-bottom-nav` ve `.bottom-nav`)**: Mobil görünümde ekranın alt kısmını kalıcı olarak kaplayan 5/4 sekmeli sabit alt dock bulunuyordu. | `ui/index.html` (`#caelus-mobile-bottom-nav`) ve `apps/caelus-ncm-mobile/app/components/BottomNav.tsx` | Sabit alt sekme barı hem ana sahnede hem mobil NCM uygulamasında tamamen kaldırıldı; gezinme sol üstteki açılır/kapanır mekânsal pusula içinde birleştirildi. |
| 3 | **Seçili Konum Kartının İlk Açılışta 3B Kürenin Tam Ortasını Kapatması**: Uygulama ilk açıldığında `#dunyam-stage-callout-card` açık başlıyor ve CSS özgüllük çakışması nedeniyle 3B Dünya küresinin tam merkezinde duruyordu. | `ui/index.html` satır 5211’de `body:not([data-theme="light"]) .dunyam-stage-callout { position: relative; }` kuralının `position: absolute; right: 24px;` kuralını ezmesi ve kartın `is-collapsed` olmadan başlaması. | `.dunyam-stage-callout` konumlandırması `position: absolute !important; top: 68px !important; right: 18px !important;` (mobilde alt çekmece `position: fixed !important; bottom: 12px !important;`) olarak sabitlendi; kart ilk açılışta `is-collapsed` (kapalı) başlar ve yalnızca kullanıcı kürede/listede bir öğe seçtiğinde açılır. |
| 4 | **Mobilde Okunaksız `7px–8px` Mikro Etiketler**: Mobil NCM uygulamasında `.eyebrow`, `.status-orb`, `.trust-strip`, `.metric-ring span`, `.graph-node__label` gibi öğelerde `6px–8px` yazı boyutları kullanılıyordu. | `apps/caelus-ncm-mobile/app/globals.css` | Tüm `6px–8px` mikro etiketler kaldırıldı; en küçük yardımcı/rozet metni `11px`, gövde metni `13px–16px` ölçeğine yükseltildi ve en az `44×44 px` dokunma hedefleri sağlandı. |

---

## 3. Sekiz Referans Sistemden CAELUS’a Uyarlanan Tasarım İlkeleri

Bölüm 2’de belirtilen 8 referans sistem incelenmiş ve hiçbirinin logosu, marka adı veya birebir sayfa düzeni kopyalanmadan yalnızca aşağıdaki yapısal ilkeler CAELUS’a uyarlanmıştır:

1. **SpaceEngine (`https://spaceengine.org/`)**:
   - *Alınan İlke:* Sahnenin ekranın tamamını (`100dvh`) kaplaması; kozmostan gezegene ve bölgesel koridora kesintisiz ölçek geçişi (`Kozmos → Güneş Sistemi → Dünya → Bölge → Kullanıcının Dünyası`).
2. **OpenSpace (`https://www.openspaceproject.com/`)**:
   - *Alınan İlke:* Bilimsel/coğrafi gözlem verisi ile bağlamsal açıklamanın aynı sahne üzerinde sakin tipografiyle sunulması; NASA GIBS uydu katmanı ve JPL Horizons efemeris verisinin sahneyle bütünleşmesi.
3. **Earth / Nullschool (`https://earth.nullschool.net/`)**:
   - *Alınan İlke:* Minimalist köşe tetikleyicisi (`earth` sol alt menü prensibi). CAELUS’ta bu prensip, sol üst köşedeki **Açık Sarmal Mekânsal Pusula (`#caelus-spatial-compass`)** olarak yorumlanmıştır: tek bir sarmal kapsül tıklandığında 5 çalışma alanını açar, seçim yapıldığında otomatik kapanır.
4. **Cosmoscope (`https://cosmoscope.zone/`)**:
   - *Alınan İlke:* Çok ölçekli sistem düşüncesi ve ölçekler arası yön duygusu (`#dunyam-cosmoscope-scale-strip`).
5. **Under the Surface (`https://underthesurface.org/`)**:
   - *Alınan İlke:* Kademeli bilgi açılımı (progressive disclosure). Sağ bağlamsal inceleme paneli (`#dunyam-stage-callout-card`) seçilen bir olay veya varlığı 6 kademede açar: **1. Olay/Varlık Odağı → 2. İlgili Varlıklar → 3. Doğrudan ve Dolaylı Etki Yolları → 4. Kaynak ve Kanıt → 5. Alternatif Açıklamalar → 6. Gelecek Senaryoları**.
6. **Bloomberg — Networks in Focus (`https://www.bloomberg.com/graphics/`)**:
   - *Alınan İlke:* Karmaşık ağlarda görsel gürültüyü önleyen komşuluk odaklama. `İlişkiler ve Keşfet` görünümündeki `#kesfet-cy-hop-bar` ile kullanıcı **1. Derece (Doğrudan)**, **2. Derece (Dolaylı Yayılım)** ve **3. Derece (Tam Ağ)** komşuluk derinliğini seçer; seçilmeyen uzak dallar geri çekilir (`dimmed`).
7. **NASA Eyes (`https://eyes.nasa.gov/`)**:
   - *Alınan İlke:* Canlı/gerçek açık veri (USGS sismik, NASA EONET doğal olaylar, NASA GIBS uydu, Open-Meteo) ile zaman kontrolünün sahne üzerinde sezgisel kullanımı.
8. **Apple VisionOS Spatial UI Guidelines (`https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos`)**:
   - *Alınan İlke:* Yarı saydam obsidyen cam yüzeyler (`backdrop-filter: blur(22px)`), ince speküler kenarlıklar (`rgba(136, 212, 255, 0.28)`), yüksek okunabilirlik kontrastı ve sahnenin derinliğini bozmayan yüzen (floating) yardımcı katmanlar.

---

## 4. CAELUS Özgün Görsel Kimliği ve Epistemik Renk Sistemi

CAELUS ne kaba bir siberpunk neon teması ne de sıradan beyaz bir kurumsal tablo ekranıdır. Görsel kimlik **"Derin Uzay Obsidyeni + Kırılma Mavisi + Şampanya Altını"** üçlüsü üzerine kurulmuştur:

### 4.1 Renk ve Epistemik Durum Tokenları
- **Sahne Arka Planları:** `--caelus-bg-void: #040812`, `--caelus-bg-deep: #07101F`
- **Yüzen Cam Yüzeyler:** `--caelus-surface-glass: rgba(10, 19, 36, 0.78)`, `--caelus-surface-elevated: rgba(14, 26, 48, 0.88)`
- **Metin Hiyerarşisi:** Birincil `#F3F6FA`, İkincil `#B7C5D9`, Yardımcı `#7E90AA`
- **Odak ve Vurgu:** Buz Mavisi (`#88D4FF`), Şampanya Altını (`#E6C387`)
- **Epistemik Ayrım (Yalnızca Renkle Değil; Etiket + Sembol + Çizgi Stiliyle):**
  - `●` **Doğrudan Gözlem (`#4ADE80`)** — Düz çizgi (Solid)
  - `◆` **Kaynak İddiası (`#60A5FA`)** — Elmas işaretçi
  - `---` **Hipotez / Aday İlişki (`#C084FC`)** — Kesikli çizgi (Dashed)
  - `▲` **Eksik Veri / Belirsizlik (`#FBBF24`)** — Noktalı çizgi (Dotted)
  - `◈` **Deterministik Simülasyon Çıktısı (`#38BDF8`)** — Çift halka işaretçi
  - `!` **Kritik Darboğaz / Eşik Aşımı (`#F87171`)** — Vurgulu uyarı rozeti

### 4.2 Açık Sarmal Marka Sembolü (`#caelus-compass-trigger`)
Sol üstteki mekânsal pusula tetikleyicisi, CAELUS’un açık konturlu iç içe sarmal (open-spiral) vektör sembolünü taşır. Sembol dışarıdan gelen gözlemlerin merkeze doğru süzülerek karar çekirdeğinde birleşmesini ve alternatif gelecek dallarına açılmasını temsil eder.

---

## 5. Beş Temel Mekânsal Çalışma Alanı ve Etkileşim Mimarisi

1. **1. Dünyam (`#dunyam-overview-hub`)**:
   - Başlıksız `100dvh` 3B Dünya Küresi (CesiumJS 1.114 + çevrimdışı Natural Earth II + isteğe bağlı NASA GIBS WMTS + Open-Meteo 6×6 Ege rüzgâr katmanı).
   - Sol üstte daraltılabilir dünya özeti (`#dunyam-hero-whisper-box`), sağda yalnızca seçim yapıldığında açılan 6 katmanlı bağlamsal varlık inceleyici (`#dunyam-stage-callout-card`).
2. **2. İlişkiler ve Keşfet (`#kesfet-clean-workspace`)**:
   - Odaklanabilir etki ağı (`#kesfet-cytoscape-panel`), 1–2–3 derece komşuluk derinliği seçicisi (`#kesfet-cy-hop-bar`), sağ inceleyicide **"Neden gösteriliyor?"**, alternatif açıklamalar ve en yüksek bilgi değeri (`VoI`) kutusu (`#cy-insp-why-shown-box`).
   - Mobil ve dar ekranlar için sıkışık graf yerine 4 adımlı okunabilir nedensel yol listesi (`#kesfet-mobile-step-path-list`: `1. Olay → 2. İlgili Varlık → 3. Olası Etki → 4. Seçili Bağlam & Karar`).
3. **3. Zaman ve Hafıza (`#caelus-time-lens-popover` & `#hafiza-clean-workspace`)**:
   - Sağ üstten her an açılabilen yüzen **Çift Zamanlı (Bitemporal) Zaman Merceği (`#caelus-time-lens-popover`)** ile `19 Şub 2021 (v1)`, `17 Mar 2021 (v2)` ve `30 Eki 2020 (Ege t_karar)` kesitleri arasında geçiş yapılır.
   - `t_alım ≤ T_kesit` kuralıyla o tarihte bilinenler ile daha sonra öğrenilenler `0` zamansal sızıntıyla ayrılır; `v1` ve `v2` değerlendirmeleri arasındaki hipotez değişimi (`HYP-ERCOT-ONLY → HYP-CLEANROOM-REQUAL`) açıklanır.
4. **4. Gelecekler ve Senaryolar (`#senaryolar-guided-workspace`)**:
   - 6 temel karar sorusu (`#senaryolar-six-questions-grid`) ve 3 rakip gelecek dalının (**1. Baz Durum**, **2. Müdahale Senaryosu**, **3. Birleşik Stres Senaryosu**) yan yana (mobilde `#senaryolar-mobile-future-tabs` sekme seçicisiyle) karşılaştırılması (`#senaryolar-three-futures-deck`).
5. **5. Kaynaklar ve Dayanak (`#caelus-provenance-drawer` & `#baglantilar-clean-workspace`)**:
   - Sağ üstteki `⚖ Dayanak` kapsülünden veya varlık inceleyicisinden açılan bağlamsal çekmece (`#caelus-provenance-drawer`), incelenen bilginin kaynağını, `t_olay` / `t_alım` zamanlarını, epistemik sınıfını, kullanılan deterministik motoru, karşıt kanıtları, eksik verileri ve ticari lisans uygunluğunu tek bakışta sunar.
