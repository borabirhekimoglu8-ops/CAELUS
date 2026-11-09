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

## 3. Görsel Referans Araştırması (`GORSEL_REFERANSLAR.md`)
| Referans Kaynak | Çıkarılan Tasarım İlkesi | CAELUS'taki Somut Karşılığı |
| :--- | :--- | :--- |
| **Gitmos** (`behance.net/gallery/250076343`) | Veri ağında seçili düğümün 1-adım komşuluğunu öne çıkarıp uzak düğümleri sakinleştirme | `Keşfet → İlişki Ağı` (Cytoscape.js) içinde düğüme tıklandığında 1-adım komşuluk vurgusu ve çakışmasız eliptik dizilim |
| **Interstellar Arc 01–03** (`behance.net/gallery/252282555`) | Koyu uzay zemininde ince speküler altın/buz mavisi ışık kenarları ve hacimli hologram hissi | Onaylı `01_Onayli_Holografik_Atmosfer.png` katmanı ve yarı saydam füme-indigo yüzeylerde `#E6C387` / `#88D4FF` üst ışık çizgisi |
| **NASA's Eyes** (`science.nasa.gov/eyes/`) | Dünya ve Güneş Sistemi'ni tam ekran sahne olarak sunup bilgi kartlarını kenarda kompakt tutma | `Dünyam` ve `Kozmos` ekranlarında sahnenin merkezde tam nefes alması, sağda tek bir bağlamsal inceleme kartı |
| **Cosmoscope** (`cosmoscope.space`) | Ölçekler arası gezinmede neyin gerçek gözlem neyin hesaplanmış model olduğunu dürüstçe ayırma | `Dünyam` (İnsan Sistemleri ve Bölgesel Gözlem) ile `Kozmos` (J2000.0 Analitik Kepler Efemerisi) arasında nedensel sınırların açıkça korunması |
| **A24 UI & Thread of Memory** (`behance.net/gallery/239608999`, `215325513`) | Sakin tipografik ritim; zaman akışında tekrarlayan kayıtları gruplayarak gürültüyü önleme | `Hafıza` ekranında yakın zamanlı tekrarlayan kaynak alımlarının `(×N Kayıt Grubu)` altında toplanması ve `"Tek tek incele"` seçeneği |
| **ORION Strategy Dashboard** (`behance.net/gallery/243460507`) | Karar senaryolarında "Mevcut Gidişat" ile "Müdahale Sonucu"nu yan yana net metriklerle kıyaslama | `Senaryolar` ekranında adım odaklı akış ve **"Hiçbir şey yapılmazsa"** ile **"Bu adım uygulanırsa"** kartlarının yan yana karşılaştırması |
| **IAU100 & Spaceflux** (`behance.net/gallery/78641137`, `183406451`) | İnce vektör kıyı ve yörünge çizgileriyle sahne-navigasyon dengesi | `Dünyam` 3B küresinde ve `Keşfet → Bölgesel Harita`da keskin buz mavisi kıyı vektörleri ve koridor yayları |
| **Microsoft Writing Style Guide** (`learn.microsoft.com/style-guide/`) | Kullanıcıya sistemin iç yapısını (`tick`, `seed`, `FFI`, `snapshot`, `epistemik`) değil, doğal ve net eylemleri söyleme | Tüm ekranlarda sade kullanıcı dili (`Bu olayın verilerini kullan`, `Hiçbir şey yapılmazsa`, `Bu adım uygulanırsa`, `İlişki Sınırı`); teknik verilerin `"Nasıl hesaplandı?"` ve `"Teknik Ayrıntı"` çekmecelerinde korunması |

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

