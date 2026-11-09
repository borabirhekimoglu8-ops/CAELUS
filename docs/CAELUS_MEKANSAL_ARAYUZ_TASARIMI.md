# CAELUS — Görsel Evrim ve Mekânsal Arayüz Tasarımı

## 1. Yönetici Özeti ve Tasarım Vizyonu

CAELUS; olayları, varlıkları, kurumları, coğrafyaları, zaman kesitlerini, etki ağlarını ve alternatif gelecekleri aynı araştırma ortamında inceleyen evrensel bir dünya analizi ve karar destek platformudur. Bu çalışma kapsamında CAELUS’un masaüstü (`ui/index.html`, `ui/spatial_experience.js`, `dist/index.html`) ve mobil/hibrit (`apps/caelus-ncm-mobile`) arayüzleri klasik "sabit üst bar + sabit alt sekme barı + çok sayıda eşzamanlı kart" düzeninden çıkarılmış; **başlıksız, sahne merkezli, bağlamsal ve kademeli bilgi açılımına (progressive disclosure) dayalı** özgün bir mekânsal deneyime dönüştürülmüştür.

> **Temel Tasarım İlkesi:** CAELUS’un yaşayan dünyası ana sahnedir (`100dvh`); arayüz bileşenleri sahneyi çerçevelemez, kullanıcı ihtiyaç duyduğu anda ve ihtiyaç duyduğu yerde bağlamsal olarak belirir ve işi bittiğinde sahneye geri çekilir.

---

## 2. Mevcut Arayüzün Görsel ve Yapısal Teşhisi (Önceki Durum)

Değişiklik öncesinde çalışan uygulama (`1600×960`, `1366×768` ve `390×844` çözünürlüklerde) incelenmiş ve aşağıdaki somut görsel/etkileşimsel sorunlar tespit edilerek giderilmiştir:

| # | Tespit Edilen Sorun (Önceki Durum) | Kök Neden (Dosya / Satır) | Uygulanan Mekânsal Çözüm |
|---|---|---|---|
| 1 | **Sabit Üst Navigasyon Barı (`.top-header`)**: Masaüstünde 7 sekme, 4 durum rozeti, dil seçici ve rapor düğmesi üstte sabit bir yönetim paneli şeridi oluşturuyordu. | `ui/index.html` (`.top-header`) ve `apps/caelus-ncm-mobile/app/page.tsx` (`.app-header`, `.trust-strip`) | Sabit üst bar tamamen kaldırıldı. Yerine sol üst köşede tek bir kompakt **CAELUS Açık Sarmal Mekânsal Pusulası (`#caelus-spatial-compass`)** ve sağ üstte kompakt **Zaman Merceği / Veri Portresi / Sahne & Ölçek / Dayanak Kapsülü (`#caelus-stage-top-right-pod`)** yerleştirildi. |
| 2 | **Sabit Alt Sekme Barı ve Çoklu Alt Şerit Yoğunluğu**: İlk açılışta sahnenin alt kenarında 3 ayrı şerit (`#dunyam-stage-quick-layers`, `.dunyam-stage-bottom-bar`, `#dunyam-ondemand-bar` — toplam 18 düğme) ve üst ortada `.dunyam-cosmoscope-strip` sürekli açık durarak 3B küreyi çerçeveliyordu. | `ui/index.html` (`.dunyam-cosmoscope-strip`, `.dunyam-stage-quick-layers`, `.dunyam-stage-bottom-bar`, `.dunyam-ondemand-bar`) ve `apps/caelus-ncm-mobile/app/components/BottomNav.tsx` | Sabit alt sekme barı kaldırıldı. Ana sahnede (`body.caelus-spatial-clean-stage`) çoklu alt şeritler ve üst ölçek şeridi varsayılan olarak gizlendi; alt ortada yalnızca tek bir sakin **Mekânsal Odak Tetikleyicisi (`#caelus-spatial-focus-pill`: `✦ Olaylar, Katmanlar & Ölçek`)** bırakıldı. Kullanıcı tıkladığında katman/ölçek çekmecesi açılır, işi bittiğinde kapanır. |
| 3 | **Diğer Modlara Geçildiğinde Yaşayan 3B Dünya Sahnesinin Kaybolması ve İkincil Sekme Barları**: `2. İlişkiler ve Keşfet` veya `4. Gelecekler ve Senaryolar` moduna geçildiğinde `#dunyam-overview-hub` (`display: none`) kapanıyor, üstte `.caelus-view-hero-top`, `.kesfet-view-mode-bar` ve `.caelus-scenario-stepper` gibi klasik alt-sekme şeritleri açılıyordu. | `ui/index.html` ve `ui/app.js` (`switchMainTab`) | `#dunyam-overview-hub` tüm modlarda tam ekran yaşayan arka plan sahnesi (`position: fixed; inset: 0; z-index: 1; display: block !important`) olarak korunur. Diğer modlar sahnenin üzerinde yarı saydam obsidyen cam katmanlar olarak açılır; ikincil üst başlık ve sekme barları gizlenerek yalnızca isteğe bağlı `⊞ Gelişmiş Analiz Araçları` çekmecesine alınmıştır. |
| 4 | **Seçili Konum Kartının İlk Açılışta 3B Kürenin Tam Ortasını Kapatması**: Uygulama ilk açıldığında `#dunyam-stage-callout-card` açık başlıyor ve CSS özgüllük çakışması nedeniyle 3B Dünya küresinin tam merkezinde duruyordu. | `ui/index.html` satır 5211’de `body:not([data-theme="light"]) .dunyam-stage-callout { position: relative; }` kuralının `position: absolute; right: 24px;` kuralını ezmesi ve kartın `is-collapsed` olmadan başlaması. | `.dunyam-stage-callout` konumlandırması `position: absolute !important; top: 68px !important; right: 18px !important;` (mobilde alt çekmece `position: fixed !important; bottom: 12px !important;`) olarak sabitlendi; kart ilk açılışta `is-collapsed` (kapalı) başlar ve yalnızca kullanıcı kürede/listede bir öğe seçtiğinde açılır. |
| 5 | **Mobilde Okunaksız `7px–10px` Mikro Etiketler**: Mobil NCM uygulamasında `.eyebrow`, `.status-orb`, `.trust-strip`, `.metric-ring span`, `.graph-node__label`, `.evidence-sources` gibi öğelerde `6px–10px` yazı boyutları kullanılıyordu. | `apps/caelus-ncm-mobile/app/globals.css` | Tüm `<11px` mikro etiketler kaldırıldı; en küçük yardımcı/rozet metni `11px`, gövde metni `13px–16px` ölçeğine yükseltildi ve en az `44×44 px` dokunma hedefleri sağlandı. |

---

## 3. Sekiz Zorunlu Referans Sistemden CAELUS’a Uyarlanan Tasarım İlkeleri (`ui/spatial_experience.js`)

Görev kapsamında belirtilen **8 zorunlu tasarım referansı** incelenmiş; hiçbirinin logosu, marka adı, telifli görseli veya birebir sayfa düzeni kopyalanmadan, her birinden alınan yapısal ilkeler ve bilinçli olarak reddedilen yönler [`ui/spatial_experience.js`](../ui/spatial_experience.js) içindeki `DESIGN_REFERENCES_MATRIX` yapısında kodlanmış ve arayüze uygulanmıştır:

| # | Referans | URL | CAELUS’un Öğrendiği ve Uyguladığı İlke | Bilinçli Olarak Kaçınılan / Reddedilen Yön | CAELUS’taki Somut Karşılığı |
|---|---|---|---|---|---|
| **2.1** | **FIELD.IO — Seeing in Gamma** | `https://www.field.io/project/seeing-in-gamma` | Karanlık boşlukta yüksek kontrastlı spektral veri ışınları, enerji yoğunluğu hissi ve çok katmanlı derinlik. | Okunabilirliği düşüren aşırı parlak bloom/parlama ve açıklamasız soyut ışık efektleri. | Derin uzay obsidyen sahnesi (`#040812`), sismik/koridor enerji halkaları ve spektral odak vurgu katmanları. |
| **2.2** | **FIELD.IO — IBM watsonx** | `https://www.field.io/project/ibm-watsonx` | Karmaşık hesaplama ve yapay zekâ süreçlerini sakin, güven veren, kurumsal düzeyde berrak geometrik akışlarla temsil etme. | Soğuk kurumsal pazarlama şablonları ve bağlamsız dekoratif 3B şekiller. | Kırılma mavisi (`#88D4FF`) ve şampanya altını (`#E6C387`) odak çiftiyle deterministik çekirdek ve hipotez durumlarının sakin cam yüzeylerde gösterimi. |
| **2.3** | **FIELD.IO — Under the Surface** | `https://www.field.io/project/under-the-surface` | Yüzeydeki tekil bir gözlemden alt katmanlardaki kök nedenlere ve kanıtlara **kademeli bilgi açılımı (progressive disclosure)** ile inme. | Tüm veri katmanlarını aynı anda ekrana yığan kalabalık bilgi panelleri. | Sağ bağlamsal inceleme panelinin (`#dunyam-stage-callout-card`) seçilen olayı 6 kademede açması (`1. Odak → 2. İlgili Varlıklar → 3. Doğrudan/Dolaylı Yollar → 4. Kaynak/Kanıt → 5. Alternatif Açıklamalar → 6. Gelecek Senaryoları`). |
| **2.4** | **FIELD.IO — Networks in Focus** | `https://www.field.io/project/networks-in-focus` | Çok düğümlü ağlarda görsel gürültüyü önleyen **1–2–3 derece komşuluk odaklama** ve seçilmeyen dalları geri çekme (`dimmed`). | Yüzlerce düğümü aynı anda tam parlaklıkta gösteren okunaksız "saç yumağı (hairball)" ağlar. | `İlişkiler ve Keşfet` görünümündeki `#kesfet-cy-hop-bar` (`1. Derece Doğrudan`, `2. Derece Dolaylı`, `3. Derece Tam Ağ`) ve sağdaki `#cy-insp-why-shown-box` ("Neden gösteriliyor?" + VoI). |
| **2.5** | **Territory Studio — Foundation** | `https://territorystudio.com/project/foundation/` | Anıtsal uzay/zaman ölçeği, yörünge geometrisi ve altın-kehribar/buz-mavisi speküler çizgilerle kurulan sakin kozmik ciddiyet. | S화면i kaplayan sahte bilimkurgu HUD çerçeveleri, anlamsız koordinat sayaçları ve okunmayan mikro yazılar. | Açık sarmal marka sembolü (`#caelus-compass-trigger`), çift zamanlı Zaman Merceği (`#caelus-time-lens-popover`) ve 3 rakip gelecek dalının (`#senaryolar-three-futures-deck`) yörünge berraklığıyla karşılaştırılması. |
| **2.6** | **Territory Studio — Ex Machina** | `https://territorystudio.com/project/ex-machina/` | Cerrahi tipografik disiplin, ince speküler kenarlıklar (`1px solid rgba(136, 212, 255, 0.24)`) ve her pikselin gerçek bir veri/nedensellik işlevi taşıması. | Dekoratif sahte kod akışları ve kullanıcıyı yoran aşırı teknik mühendislik kısaltmaları. | `Plus Jakarta Sans` + `JetBrains Mono` tipografik hiyerarşisi, en az `11px` yardımcı metin alt sınırı ve cam çekmecelerde net epistemik rozetler. |
| **2.7** | **Refik Anadol — MRI of the Earth** | `https://refikanadol.com/works/mri-of-the-earth/` | Dünya verisini yaşayan, nefes alan organik bir topoğrafya ve **Veri Portresi** olarak deneyimleme; kullanıcının bir yönetim paneline değil yaşayan bir gezegen hafızasına girmesi. | **Sanatsal veri temsilinin gerçek ölçüm grafiğiyle karıştırılması.** (Prompt 4 Bölüm 2.7 uyarısı gereği kesin sınır çizilmiştir.) | Sağ üstteki `🎨 Veri Portresi` (`#btn-stage-toggle-portrait`) düğmesiyle açılan isteğe bağlı `#caelus-data-portrait-canvas` modu ve üzerindeki açık **`SANATSAL VERİ TEMSİLİ · ÖLÇÜM GRAFİĞİ DEĞİLDİR`** (`#caelus-data-portrait-badge`) etiketi. |
| **2.8** | **Pentagram — Deloitte Insights** | `https://www.pentagram.com/work/deloitte-insights` | Karmaşık çok disiplinli analizleri ve senaryo karşılaştırmalarını editoryal okunabilirlik, net başlık hiyerarşisi ve karar odaklı özetlerle sunma. | Klasik kurumsal dergi/blog sayfası düzeni veya beyaz arka planlı statik makale şablonu. | Kullanıcının kendi verisiyle kurduğu dünyayı incelediği `#dunyam-first-task-drawer` akışı, 6 temel karar sorusu (`#senaryolar-six-questions-grid`) ve kaynakları açıklanmış karar raporu çıktısı. |

---

## 4. CAELUS Özgün Görsel Kimliği ve Epistemik Renk Sistemi

CAELUS ne kaba bir siberpunk neon teması ne de sıradan beyaz bir kurumsal tablo ekranıdır. Görsel kimlik **"Derin Uzay Obsidyeni + Kırılma Mavisi + Şampanya Altını"** üçlüsü üzerine kurulmuştur:

### 4.1 Renk ve Epistemik Durum Tokenları (`SPATIAL_DESIGN_TOKENS`)
- **Sahne Arka Planları:** `--caelus-bg-void: #040812`, `--caelus-bg-deep: #07101F`
- **Yüzen Cam Yüzeyler:** `--caelus-surface-glass: rgba(10, 19, 36, 0.78)`, `--caelus-surface-elevated: rgba(14, 26, 48, 0.88)`
- **Metin Hiyerarşisi:** Birincil `#F3F6FA`, İkincil `#B7C5D9`, Yardımcı `#7E90AA`
- **Odak ve Vurgu:** Buz Mavisi (`#88D4FF`), Şampanya Altını (`#E6C387`)
- **Epistemik Ayrım (Yalnızca Renkle Değil; Etiket + Sembol + Çizgi Stiliyle):**
  - `●` **Doğrudan Gözlem (`#4ADE80`)** — Düz çizgi (`solid`)
  - `◆` **Kaynak İddiası (`#60A5FA`)** — Elmas işaretçi (`dashed-fine`)
  - `---` **Hipotez / Aday İlişki (`#C084FC`)** — Kesikli çizgi (`dashed`)
  - `▲` **Eksik Veri / Belirsizlik (`#FBBF24`)** — Noktalı çizgi (`dotted`)
  - `◈` **Deterministik Simülasyon Çıktısı (`#38BDF8`)** — Çift halka işaretçi (`double`)
  - `!` **Kritik Darboğaz / Eşik Aşımı (`#F87171`)** — Vurgulu uyarı rozeti (`solid-heavy`)

### 4.2 Açık Sarmal Marka Sembolü (`#caelus-compass-trigger`)
Sol üstteki mekânsal pusula tetikleyicisi, CAELUS’un açık konturlu iç içe sarmal (open-spiral) vektör sembolünü taşır. Sembol dışarıdan gelen gözlemlerin merkeze doğru süzülerek karar çekirdeğinde birleşmesini ve alternatif gelecek dallarına açılmasını temsil eder.

### 4.3 İsteğe Bağlı Veri Portresi Modu (`Refik Anadol — MRI of the Earth` İlkesi)
[`ui/spatial_experience.js`](../ui/spatial_experience.js) içindeki `toggleDataPortraitMode()` ve `renderDataPortraitFrame()` fonksiyonları, aktif dünya modelindeki gerçek varlık, nedensel bağ, olay ve kanıt metriklerinden (`computeWorldPortraitSeedMetrics()`) beslenen organik bir spektral akış alanı üretir.
- **Kesin Epistemik Sınır:** Veri Portresi açıldığında ekranın üst ortasında `#caelus-data-portrait-badge` belirir ve kullanıcıya şu bilgiyi açıkça verir:
  > **`SANATSAL VERİ TEMSİLİ · ÖLÇÜM GRAFİĞİ DEĞİLDİR`** — *Refik Anadol — MRI of the Earth ilhamlı bu katman, aktif dünya modelindeki varlık, olay ve nedensel akış yoğunluğunu estetik olarak görselleştirir. Kesin sayısal ölçümler için sağdaki Varlık İnceleyicisini veya ⚖ Dayanak çekmecesini kullanın.*
- `prefers-reduced-motion: reduce` veya `Düşük Güç` performans modunda animasyon döngüsü otomatik olarak durdurulur ve tek bir sakin statik kare çizilir.

---

## 5. Beş Temel Mekânsal Çalışma Alanı ve Etkileşim Mimarisi

1. **1. Dünyam (`#dunyam-overview-hub`)**:
   - Başlıksız `100dvh` 3B Dünya Küresi (CesiumJS 1.114 + çevrimdışı Natural Earth II + isteğe bağlı NASA GIBS WMTS + Open-Meteo 6×6 Ege rüzgâr katmanı).
   - İlk açılışta sahnede yalnızca sol üstte `#caelus-spatial-compass` + daraltılmış dünya özeti kapsülü (`#dunyam-hero-whisper-box.is-whisper-collapsed`), sağ üstte `#caelus-stage-top-right-pod` ve alt ortada tek bir sakin **`✦ Olaylar, Katmanlar & Ölçek` (`#caelus-spatial-focus-pill`)** tetikleyicisi bulunur.
   - Sağdaki 6 katmanlı bağlamsal varlık inceleyici (`#dunyam-stage-callout-card`) yalnızca kullanıcı kürede/listede bir varlık seçtiğinde açılır.
2. **2. İlişkiler ve Keşfet (`#kesfet-clean-workspace`)**:
   - Yaşayan 3B Dünya sahnesi arka planda kalmaya devam eder; üzerinde yarı saydam obsidyen cam katman olarak odaklanabilir etki ağı (`#kesfet-cytoscape-panel`), 1–2–3 derece komşuluk derinliği seçicisi (`#kesfet-cy-hop-bar`) ve sağ inceleyicide **"Neden gösteriliyor?"**, alternatif açıklamalar ve en yüksek bilgi değeri (`VoI`) kutusu (`#cy-insp-why-shown-box`) açılır.
   - Mobil ve dar ekranlar için sıkışık graf yerine 4 adımlı okunabilir nedensel yol listesi (`#kesfet-mobile-step-path-list`: `1. Olay → 2. İlgili Varlık → 3. Olası Etki → 4. Seçili Bağlam & Karar`) gösterilir.
3. **3. Zaman ve Hafıza (`#caelus-time-lens-popover` & `#hafiza-clean-workspace`)**:
   - Sağ üstten her an açılabilen yüzen **Çift Zamanlı (Bitemporal) Zaman Merceği (`#caelus-time-lens-popover`)** ile `19 Şub 2021 (v1)`, `17 Mar 2021 (v2)` ve `30 Eki 2020 (Ege t_karar)` kesitleri arasında geçiş yapılır.
   - `t_alım ≤ T_kesit` kuralıyla o tarihte bilinenler ile daha sonra öğrenilenler `0` zamansal sızıntıyla ayrılır; `v1` ve `v2` değerlendirmeleri arasındaki hipotez değişimi (`HYP-ERCOT-ONLY → HYP-CLEANROOM-REQUAL`) açıklanır.
4. **4. Gelecekler ve Senaryolar (`#senaryolar-guided-workspace`)**:
   - Yaşayan dünya sahnesi üzerinde 6 temel karar sorusu (`#senaryolar-six-questions-grid`) ve 3 rakip gelecek dalının (**1. Baz Durum**, **2. Müdahale Senaryosu**, **3. Birleşik Stres Senaryosu**) yan yana (mobilde `#senaryolar-mobile-future-tabs` sekme seçicisiyle) karşılaştırılması (`#senaryolar-three-futures-deck`).
5. **5. Kaynaklar ve Dayanak (`#caelus-provenance-drawer` & `#baglantilar-clean-workspace`)**:
   - Sağ üstteki `⚖ Dayanak` kapsülünden veya varlık inceleyicisinden açılan bağlamsal çekmece (`#caelus-provenance-drawer`), incelenen bilginin kaynağını, `t_olay` / `t_alım` zamanlarını, epistemik sınıfını, kullanılan deterministik motoru, karşıt kanıtları, eksik verileri ve ticari lisans uygunluğunu tek bakışta sunar.
