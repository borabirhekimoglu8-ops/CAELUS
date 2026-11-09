# CAELUS — Tasarım Notu, Görsel Dil ve Mimari Karar Kaydı

Bu belge, `CAELUS_TEK_ANA_PROMPT.md` (Bölüm: *Bağlayıcı Tasarım Yönetmeliği — Madde 1*) ve `GORSEL_REFERANSLAR.md` kapsamında kodlama öncesinde ve uygulama sırasında alınan görsel kimlik, bilgi mimarisi, tipografi, renk, hareket ve çok dillilik kararlarını kayıt altına alır.

---

## 1. Marka ve Görsel Kimlik Kararı (`01_Onayli_Holografik_Atmosfer` & `02_Sembol_Form_Referansi`)
- **Ana Sanat Yönü (`GORSELLER/01_Onayli_Holografik_Atmosfer.png`):** Açık konturlu, iç içe katmanlı ve merkezi boşluklu spiral ışık atmosferi. Koyu füme-indigo uzay zemini üzerinde kontrollü buz mavisi (`#88D4FF`) ve ölçülü şampanya altını (`#E6C387`) ışık yansımaları.
- **Sembol Formu (`GORSELLER/02_Sembol_Form_Referansi.png`):** Ain Sof'un sınırsızlık fikrinden esinlenen, merkezi boşluklu, kesintisiz açık konturlu iç içe spiral form. Dini bir sembol, tarihsel rekonstrüksiyon veya gerçek 3B astronomik model olarak sunulmaz; yalnızca CAELUS'un özgün görsel kimliğidir.
- **Dürüstlük İlkesi:** Konsept PNG görselleri gerçek 3B model veya vektör çizim motoru olarak etiketlenmez. Arka plan atmosferi **Ayarlar → Marka İzi: Açık / Kapalı** düğmesiyle kullanıcı tarafından istenildiğinde tamamen kapatılabilir; harita ve veri katmanlarının üzerini örtmez.

---

## 2. Kurulu Tasarım Becerileri (Skills) ve Somut Uygulama Etkileri
Proje ortamında bulunan `.agents/skills/` altındaki 6 tasarım ve mühendislik becerisi incelenmiş ve doğrudan uygulanmıştır:
1. **`frontend-design` (`.agents/skills/frontend-design/SKILL.md`):**
   - *İlke:* Her ekranda konuya özgü tek bir güçlü odak bırakmak; tüm ekranları birbirinin aynı SaaS kart kutularına bölmemek; gereksiz BÜYÜK HARF üst etiketleri (eyebrow) ve yapay numaralandırmaları kaldırmak; sistem dili yerine son kullanıcının anladığı sade eylem dilini kullanmak.
   - *CAELUS Uygulaması:* 7 ekranın her birine kendi doğasına uygun farklı bir yerleşim mimarisi verildi (`Dünyam` mekânsal, `Keşfet` ilişki ve çoklu mercek odaklı, `Kozmos` yörünge odaklı, `Senaryolar` adım odaklı karşılaştırma, `Hafıza` zamansal akış, `Bağlantılar` kaynak güven merkezi, `Ayarlar` doğrusal tercih listesi).
2. **`impeccable` & `craft-floor.md` (`.agents/skills/impeccable/SKILL.md`):**
   - *İlke:* Kontrast tabanı (WCAG AA ≥ 4.5:1), iç içe gereksiz kart kutularından kaçınma, tarayıcı yüzeylerini (kaydırma çubuğu, metin seçimi, odak halkası, `tabular-nums` sayısal hizalama) paletle uyumlu hale getirme.
   - *CAELUS Uygulaması:* Tüm sayısal metriklerde `font-variant-numeric: tabular-nums` zorunlu kılındı; özel kaydırma çubukları, `::selection` rengi ve `:focus-visible` buz mavisi/altın odak halkaları eklendi.
3. **`emil-design-eng` (`.agents/skills/emil-design-eng/SKILL.md`):**
   - *İlke:* `transition: all` yasağı; butonlarda `:active` basılma hissi (`transform: scale(0.97)`); güçlü özel ivme eğrileri (`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`).
   - *CAELUS Uygulaması:* Tüm etkileşimli düğmelere `transform: scale(0.97)` basılma geri bildirimi ve yalnızca `transform`/`opacity`/`border-color` üzerinde çalışan özel `cubic-bezier(0.23, 1, 0.32, 1)` geçişleri uygulandı.
4. **`animate` & `animation-performance` (`.agents/skills/animate/SKILL.md`, `.agents/skills/animation-performance/SKILL.md`):**
   - *İlke:* Sık tekrarlanan klavye/sekme geçişlerinde hantal animasyonlardan kaçınma; `width`/`height`/`margin` yerine yalnızca GPU-composite (`transform`, `opacity`) özelliklerini hareketlendirme; `backdrop-filter: blur()` maliyetini <20px (`14px–16px`) altında tutarak Intel UHD 620 entegre GPU'da kare bütçesini (16.7ms) koruma.
   - *CAELUS Uygulaması:* Cam panellerde `blur(16px)` sınırı ve `prefers-reduced-motion: reduce` / **Hareket: Kapalı** tam desteği uygulandı.
5. **`web-design-guidelines` (`.agents/skills/web-design-guidelines/SKILL.md`):**
   - *İlke:* Klavye erişilebilirliği, anlamlı `aria-label` / `aria-selected` / `role="region"` semantiği, taşma önleme (`text-overflow` yerine tam okunabilir esnek yerleşim).

---

## 3. Görsel Referans Araştırması (`GORSEL_REFERANSLAR.md` — 12 Dış Referans + 2 Yerel Görsel)
`GORSEL_REFERANSLAR.md` içindeki 12 dış bağlantının ve `GORSELLER/` klasöründeki 2 yerel PNG dosyasının erişim durumu ve CAELUS ekranlarındaki birebir karşılığı aşağıda dürüstçe kayıt altına alınmıştır:

| # | Referans Kaynak | Erişim / İnceleme Durumu | Çıkarılan Tasarım İlkesi | CAELUS'taki Somut Karşılığı (DOM / CSS / Canvas) |
| :--- | :--- | :--- | :--- | :--- |
| **G1** | `GORSELLER/01_Onayli_Holografik_Atmosfer.png` | Yerel PNG (`1408×768`) — Doğrudan incelendi ve `ui/assets/caelus-holographic-atmosphere.png` olarak gömüldü | Koyu füme-indigo uzay boşluğunda diyagonal şampanya altını (`#E6C387`) ve buz mavisi (`#88D4FF`) açık spiral ışık katmanları | `.workbench-shell::before` katmanında tam ekran atmosfer; tüm kartlar (`0.36–0.48` alfa + `backdrop-filter: blur(14px)`), `#holo-canvas`, `#univ-solar-canvas` ve Cesium 3B sahnesi (`skyBox.show = false`) yarı saydam yapılarak tüm 7 ekranda görünür kılındı |
| **G2** | `GORSELLER/02_Sembol_Form_Referansi.png` | Yerel PNG (`1024×1024`) — Doğrudan incelendi; 3 açık hilal/spiral kontur (`PATH_1`, `PATH_2`, `PATH_3`) piksel koordinatlarından vektörize edildi | Ain Sof'un sınırsızlık fikrinden esinlenen, merkezi boşluklu, kesintisiz açık konturlu 3 şeritli iç içe spiral form | Sol üst `#hdr-logo-home-btn` içinde kırpılmamış 3 şeritli açık spiral (`caelus-logo.png`) + aralıklı `C A E L U S` wordmark; sağ üst `#caelus-constellation-watermark` SVG'sinde birebir 3 vektör şerit (`PATH_1..3`) |
| **1** | **Gitmos** (`behance.net/gallery/250076343/Gitmos`) | Doğrudan HTTP isteği Adobe/Behance bot filtresi nedeniyle zaman aşımına uğradı (`Timeout`); proje başlığı ve galeri meta verisi web aramasıyla incelendi | Kozmik veri ağında seçili düğümün merkezde odak halkasıyla parlaması, 1-adım komşuların bağlarla öne çıkıp uzak düğümlerin sakinleşmesi | `Keşfet → İlişki Ağı` (`#kesfet-cytoscape-container`) arka planında çift eşmerkezli yörünge halkası ve radyal odak halesi; düğüm seçildiğinde 1-adım komşuluk vurgusu |
| **2** | **Interstellar Arc Parts 02–03** (`behance.net/gallery/252282555`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; `Interstellar Arc` serisi web aramasıyla incelendi | Koyu uzay zemininde ince speküler altın/buz mavisi ışık kenarları, yarı saydam holografik katmanlar ve yörünge yayları | Tüm 7 ekranda `.caelus-view-hero`, `.step-section`, `.ab-card`, `.holo-stage-card` ve `.entity-inspector-card` üzerinde üst speküler altın/buz mavisi ışık çizgisi ve şeffaf cam derinliği |
| **3** | **Interstellar Arc Part 01** (`behance.net/gallery/246148791`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; seri meta verisi web aramasıyla incelendi | Uzay-zaman sahnesinde hassas köşe vizör (reticle) işaretleri ve telemetri odak çerçeveleri | `.caelus-view-hero`, `.dunyam-hero-identity`, `.dunyam-stage-callout` ve `.ab-card` köşelerinde `12px` altın (`#E6C387`) ve buz mavisi (`#88D4FF`) vizör braketleri (`linear-gradient` corner ticks) |
| **4** | **NASA's Eyes** (`science.nasa.gov/eyes/`) | Doğrudan HTTP `200 OK` ile erişildi ve incelendi | Dünya ve Güneş Sistemi'ni tam ekran 3B sahne olarak sunup bilgi kartlarını kenarda kompakt ve yarı saydam tutma | `Dünyam` (CesiumJS 3B Küre) ve `Kozmos` (Spacekit / J2000.0 Güneş Sistemi) ekranlarında tam sahne yerleşimi ve yüzen bağlamsal bilgi kartı |
| **5** | **Cosmoscope** (`cosmoscope.space/`) | Doğrudan HTTP `200 OK` ile erişildi ve incelendi | Çok ölçekli (Kozmos → Güneş Sistemi → Dünya → Bölge → İnsan Sistemi) kesintisiz gezinme şeridi ve ölçekler arası dürüst sınır | `Dünyam` sahnesi üst-ortasında her zaman görünür `#dunyam-cosmoscope-scale-strip` (`ÖLÇEK: Kozmos → Güneş Sistemi → ◉ Dünya → Bölge → Kullanıcının Dünyası`) |
| **6** | **A24 UI** (`behance.net/gallery/239608999/A24-UI`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; editoryal tipografi ilkeleri web aramasıyla incelendi | Yüksek kontrastlı editoryal başlık hiyerarşisi (`clamp(1.22rem, 1.9vw, 1.62rem)`), ince yatay cetvel çizgileri ve sakin boşluk ritmi | Tüm ekran başlıklarında (`h2`) editoryal tipografik ölçek, `tabular-nums` sayısal hizalama ve `Ayarlar` / `Bağlantılar` ekranlarında ince cetvelli doğrusal satır mimarisi |
| **7** | **ORION Strategy Dashboard** (`behance.net/gallery/243460507`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; strateji paneli ilkeleri web aramasıyla incelendi | Karar senaryolarında "Mevcut Gidişat" ile "Müdahale Sonucu"nu yan yana dairesel/radyal kapasite halkalarıyla (`MetricRing`) kıyaslama | `Senaryolar` ekranında `buildOrionMetricRingSvg()` ile **"Hiçbir şey yapılmazsa"** ve **"Bu adım uygulanırsa"** kartlarında Dönem Sonu Kapasite ve Hedef Yük için SVG radyal halkalar |
| **8** | **Thread of Memory** (`behance.net/gallery/215325513`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; zaman ipliği metaforu web aramasıyla incelendi | Zaman akışını birbirine dolanan altın ve buz mavisi ışık ipliği üzerinde parlayan kronolojik düğümler olarak görselleştirme; tekrarları gruplama | `Hafıza` ekranında varsayılan olarak açık `#hafiza-wheel-canvas` (`drawHafizaWheelTimeline`) üzerinde çift sarmallı altın (`#E6C387`) ve buz mavisi (`#88D4FF`) zaman ipliği + `(×N Kayıt Grubu)` gruplaması |
| **9** | **IAU100** (`behance.net/gallery/78641137/IAU100`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; IAU 100. yıl astronomik harita dili web aramasıyla incelendi | İnce altın ve buz mavisi usturlap derece halkaları, ekliptik kuşağı ve açısal verniye işaretleri | `Dünyam` 3B küresi üzerinde `#dunyam-iau-astrolabe-svg` (360° derece çemberi, eğik ekliptik yörünge ve `270° W · ORB` / `090° E · EGE` işaretleri) + sağ üst `#caelus-constellation-watermark` |
| **10** | **Ghost in the Shell** (`behance.net/gallery/50265763`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; FUI/HUD hassas telemetri ilkeleri web aramasıyla incelendi | Kaba kutular yerine ince FUI köşe braketleri, mikro durum rozetleri ve katmanlı derinlik | Sahne kartlarında FUI köşe braketleri, `tabular-nums` telemetri sayaçları ve aşırı kalabalık yapmayan mikro durum etiketleri |
| **11** | **Spaceflux** (`behance.net/gallery/183406451/Spaceflux`) | Doğrudan HTTP isteği Behance bot filtresi nedeniyle zaman aşımına uğradı; uzay-durum farkındalığı arayüzü web aramasıyla incelendi | Yörünge/kıyı vektör çizgileri ve temiz karanlık uzay-durum farkındalığı (SSA) katmanları | `Dünyam` 3B küresinde ve `Keşfet → Bölgesel Harita`da keskin buz mavisi kıyı vektörleri, koridor yayları ve `Kozmos` J2000.0 ekliptik halkaları |
| **12** | **Microsoft Writing Style Guide** (`learn.microsoft.com/en-us/style-guide/welcome/`) | Doğrudan HTTP `200 OK` ile erişildi ve incelendi | Kullanıcıya sistemin iç yapısını (`tick`, `seed`, `FFI`, `snapshot`, `epistemik`) değil, doğal ve net eylemleri söyleme | Tüm ekranlarda sade kullanıcı dili (`Bu olayın verilerini kullan`, `Hiçbir şey yapılmazsa`, `Bu adım uygulanırsa`, `İlişki Sınırı`); teknik verilerin `"Nasıl hesaplandı?"` çekmecelerinde korunması |

---

## 4. Merkezi Tasarım Değişkenleri (Token Sistemi) ve Sayfa Mimarisi

### Renk Paleti (4–6 Ana Hex)
- `--bg-void: #040915` (Derin Füme-İndigo Uzay Zemini)
- `--bg-glass: rgba(9, 19, 38, 0.72)` (Yarı Saydam Holografik Cam Yüzey)
- `--accent-ice: #88D4FF` (Birincil Buz Mavisi Işık ve Odak)
- `--accent-gold: #E6C387` (Ölçülü Şampanya Altını Vurgu ve Seçili Kenar)
- `--status-ok: #5EC69D` (Doğrulanmış / Dengeli Zümrüt)
- `--status-warn: #F0B45A` / `--status-crit: #F27D72` (İzlenen Kehribar / Kritik Mercan)

### Sayfa Bazlı Yerleşim Planı (Tek Şablon Kopyalamadan Özgün Mimari)
```
[ÜST ÇUBUK] Sol: CAELUS Açık Spiral Logo | Orta: 7 Ana Sekme | Sağ: Motor Durumu · Dil (TR/EN/AR/HE) · Rapor

1. DÜNYAM (Mekânsal):
   +-----------------------------------------------------------------------+
   | [Sol Üst: Dünya Başlığı & 3 Eylem]   [Üst: Görünüm Pills]  [Sağ: Seçili|
   |                                      (MERKEZ 3B DÜNYA)     Konum/Varlık|
   | [Alt Sol: Konum/Olay Kapsülleri]                           Alt: 4 Çekmece|
   +-----------------------------------------------------------------------+

2. KEŞFET (İlişki ve Çoklu Mercek):
   +-----------------------------------------------------------------------+
   | [Kompakt Keşif Çubuğu: Dünya Seç · Ara · 4 Görünüm Merceği · Senaryo] |
   | [Sol (%64): 3B Sistem / Bölgesel Harita / İlişki Ağı] | [Sağ (%36):   |
   |  veya Tam Genişlik Sadeleştirilmiş Gözlem Tablosu     |  Varlık/Konum |
   |                                                       |  İnceleyici]  |
   +-----------------------------------------------------------------------+

3. KOZMOS (Yörünge ve Efemeris):
   +-----------------------------------------------------------------------+
   | [Gök Cismi Seçici (Güneş..Neptün) + Tarih Kontrolleri (1800–2050)]    |
   | [Merkez: 3B/2B Güneş Sistemi Yörünge Sahnesi + Seçili Gezegen Merceği]|
   | [Alt: Açılır/Kapanır NASA JPL Horizons Teknik Efemeris Doğrulaması]   |
   +-----------------------------------------------------------------------+

4. SENARYOLAR (Adım Odaklı Karşılaştırma Laboratuvarı):
   +-----------------------------------------------------------------------+
   | [4 Adımlı İlerleme Çubuğu: 1.Durum -> 2.Değişiklik -> 3.Karşılaştır -> 4.Dayanak]
   | [Aktif Seçim Özeti Şeridi: Dünya · Hedef Varlık · Seçili Müdahale]    |
   | [Odaklı Adım Alanı: Yan Yana "Hiçbir Şey Yapılmazsa" vs "Bu Adım"]    |
   | [Alt: ECharts Kapasite/Yük Grafikleri + Açılır "Nasıl Hesaplandı?"]   |
   +-----------------------------------------------------------------------+

5. HAFIZA (Zamansal Akış):
   +-----------------------------------------------------------------------+
   | [Üst: Etkileşimli Zaman Çizelgesi + Tür Filtreleri + Doğal Dil Sorgu] |
   | [Sol (%60): Gruplanmış (×N) Tam Başlıklı Olay Akışı] | [Sağ (%40):    |
   |                                                      |  Kayıt Detayı] |
   +-----------------------------------------------------------------------+

6. BAĞLANTILAR (Kaynak Güven Merkezi):
   +-----------------------------------------------------------------------+
   | [Üst: Kategori Filtreleri + Hızlı Güncelleme / Kesinti Testi]         |
   | [Sol (%58): Doğrulanmış Kaynak Kartları] | [Sağ (%42): Kapsam, Zaman  |
   |                                          |  ve Veri Dürüstlüğü Özeti] |
   +-----------------------------------------------------------------------+
```

---

## 5. Çok Dillilik (i18n) Mimari Değerlendirmesi (`i18next`, `FormatJS`, `Weblate` vs `CaelusI18n`)
- **Değerlendirme:** `i18next` (MIT), `i18next-cli` (MIT), `FormatJS` (MIT) ve `Weblate` (GPL-3.0+ sunucu tabanlı TMS) mevcut mimari, çevrimdışı tek-dosya (`dist/caelus_os.exe` <50 MB ve `dist/caelus_standalone.html`) kısıtları ve Windows derleme zinciri açısından incelenmiştir:
  1. **Weblate:** Bulut/sunucu tabanlı (Python/Django, GPL-3.0) bir çeviri yönetim sistemidir; air-gapped / çevrimdışı çalışan C++/Rust/JS masaüstü paketine çalışma zamanı bağımlılığı olarak eklenmesi uygun değildir.
  2. **i18next / FormatJS:** CAELUS halihazırda sıfır dış ağ bağımlılıklı, deterministik `CaelusI18n` (`ui/scenario_compiler.js`) + `Intl.DateTimeFormat` / `Intl.NumberFormat` + BCP 47 dünya dili kataloğu ve RTL (`ar-SA`, `he-IL`) desteğine sahiptir. `i18next-cli` yalnızca standart JS çağrılarını tarayabildiği, ancak CAELUS'taki HTML, 3B Canvas etiketleri ve dinamik DOM üreticilerini doğrudan kapsamadığı için mevcut `CaelusI18n` motorunun **Tam DOM ve Dinamik Çalışma Alanı Çeviri Katmanı (`applyFullDomLocalization`)** ile genişletilmesi tercih edilmiştir.
  3. **Kapsam ve Dürüstlük:** `tr-TR` ve `en-US` tam kapsamlıdır (%100 anahtar + %100 inceleme); `ar-SA` ve `he-IL` RTL düzen ve anahtar doğrulaması içerir; katalogdaki diğer diller için anahtar kapsamı ve insan incelemesi yüzdesi ayrı ayrı raporlanır ve eksik anahtarlarda `en-US → tr-TR` geri dönüşü (fallback) açıkça gösterilir.

