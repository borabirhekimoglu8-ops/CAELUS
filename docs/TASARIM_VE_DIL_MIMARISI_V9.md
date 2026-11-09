# CAELUS v9.0 — Görsel Kimlik, Ürün Deneyimi ve Çok Dilli (i18n) Mimari Belgesi

> **Bağlayıcı Kaynak Paket:** `CAELUS_Gorsel_Dil_Tam_Prompt_Paketi` (`CAELUS_TEK_ANA_PROMPT.md` + `GORSEL_REFERANSLAR.md` + `GORSELLER/01_Onayli_Holografik_Atmosfer.png` + `GORSELLER/02_Sembol_Form_Referansi.png`)
> **Durum:** Kodlama Öncesi Tasarım Notu, Görsel Referans Değerlendirmesi, Metin Envanteri ve Dil Mimarisi Kararı

---

## 1. Kodlama Öncesi Tasarım Notu (Pre-Coding Design Note)

### 1.1 Kullanıcının Amacı
Kullanıcı CAELUS'u açtığında bir mühendislik konsolu, veri tabanı yönetim ekranı veya iç içe kutular/tablolar yığını görmek istememektedir. Kullanıcının temel amacı:
1. **Dünyasını ve çevresindeki gerçek olayları sakin, derinlikli bir 3B/holografik sahnede görmek** (`Dünyam`),
2. **Bölgesel coğrafyayı, varlıklar arası ilişkileri ve gözlem kayıtlarını okunaklı biçimde keşfetmek** (`Keşfet`),
3. **Gezegen ve yörünge ölçeğini dürüst bilimsel sınırlarla incelemek** (`Kozmos`),
4. **Karmaşık form yığınları arasında kaybolmadan 4 odaklı adımda (`Durumu seç` → `Değişikliği seç` → `Karşılaştır` → `Sonucu ve dayanağını incele`) karar seçeneklerini karşılaştırmak** (`Senaryolar`),
5. **Zaman içindeki gerçek gözlemleri, tahminleri ve kayıtlı senaryoları tekrarlayan gürültü olmadan izlemek** (`Hafıza`),
6. **Veri kaynaklarının gerçek bağlantı durumunu, kapsamını ve zaman damgalarını net biçimde kontrol etmek** (`Bağlantılar`),
7. **Tema, sahne yoğunluğu, marka izi, hareket azaltma ve dil tercihlerini tek yerden yönetmek ve arka plan taşması olmadan temiz PDF/HTML/JSON karar raporu almak** (`Ayarlar` & `Rapor`).

### 1.2 Sayfa Bazlı Ana Nesne, Birincil Eylem ve Yerleşim Planı

| Sayfa | Ana Nesne (Hero / Primary Object) | Birincil Eylem (Primary Action) | Masaüstü Yerleşimi (`1600×960` / `1366×768`) | Mobil Yerleşimi (`390×844`) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Dünyam** | Tam ekran etkileşimli 3B Dünya küresi (`CesiumJS` / `OpenAtlas` / `3DTiles`) ve üzerinde kümelenmiş, çakışmayan gerçek/örnek konum işaretleri | Kürede bir olaya/konuma tıklayıp özetini görmek ve **"Bu olayın verilerini kullan"** ile Senaryolar'a geçmek | Üstte ince cam gezinme çubuğu (`56px`); merkezde tam sahne 3B küre; sol altta kompakt durum özeti; sağda seçili olay/konum inceleme kartı (`320px`, daraltılabilir); altta isteğe bağlı açılan 4 ince çekmece | Üstte sade başlık, merkezde 3B sahne (`min 360px`), seçili olay ayrıntısı alt çekmece (bottom sheet) olarak açılır; altta sabit 6 sekmeli mobil gezinme çubuğu; yatay taşma `0px` |
| **2. Keşfet** | 3 odaklı keşif görünümü: (A) Süreç Sahnesi, (B) Bölgesel Harita (`MapLibre` + çevrimdışı vektör kıyı/koridor katmanı), (C) İlişki Ağı (`Cytoscape.js` çakışmasız yerleşim) + Gözlem Tablosu (`Perspective`) | Bir varlığı, bölgesel olayı veya ilişki kenarını seçip **ölçüm / varsayım / hipotez** ayrımını incelemek | Üstte görünüm seçici sekme şeridi ve arama/filtre; merkezde seçili keşif sahnesi (`%68` genişlik) + sağda seçili öğe inceleyicisi (`%32`); teknik SQL ve şema ayrıntıları kapalı `<details>` içinde | Tek sütun dikey akış: üstte görünüm seçici, ortada harita/ağ sahnesi, altta seçili öğe kartı |
| **3. Kozmos** | `Spacekit` 3B / `J2000.0` Güneş Sistemi yörünge sahnesi ve gezegen odak şeridi | Gezegen veya tarih seçip Güneş uzaklığını (`AU`), ekliptik boylamı ve ölçek/kaynak bilgisini incelemek | Tam genişlikte derin uzay sahnesi; sol üstte açık ölçek/efemeris künyesi (`1800–2050 UTC`, logaritmik/şematik görsel ölçek beyanı); sağda seçili gök cismi kartı | Tam genişlikte sahne, yatay kaydırılabilir gezegen kapsülleri, altta seçili gök cismi bilgi kartı |
| **4. Senaryolar** | **4 Adımlı Odaklı Karşılaştırma Akışı**: `1. Durumu seç` → `2. Değişikliği seç` → `3. Karşılaştır` → `4. Sonucu ve dayanağını incele` | **"Seçenekleri Karşılaştır"** düğmesiyle `"Hiçbir şey yapılmazsa"` ve `"Bu adım uygulanırsa"` sonuçlarını yan yana görmek | Üstte etkileşimli 4 adımlı ilerleme çubuğu (aktif adım odakta, önceki adımlara tek tıkla dönüş); merkezde yan yana karşılaştırma kartları ve grafik; `"Nasıl hesaplandı?"` çekmecesinde `snapshot`, `seed`, `hash` | 4 adımlı odak çubuğu üstte; aktif adım tam genişlikte; karşılaştırma kartları alt alta temiz yığınlanır |
| **5. Hafıza** | Görsel zaman ekseni (`vis-timeline` + Zaman Tekeri) ve **tekrarlayan yakın zamanlı kaynak kayıtlarını (`×N`) gruplayan** olay akışı | Kayıtları türe göre filtrelemek (`Gerçek gözlem`, `Tahmin`, `Simülasyon olayı`, `Kullanıcı işlemi`, `Kayıtlı senaryo`) ve tekil kaydı incelemek | Üstte zaman ekseni ve filtre kapsülleri; altta sol (`%55`) gruplanmış zaman akışı listesi + sağ (`%45`) seçili kayıt inceleyicisi | Üstte filtreler ve özet zaman çizgisi; altta gruplanmış kayıt listesi ve seçili kayıt kartı |
| **6. Bağlantılar** | Doğrulanmış veri kaynakları listesi ve sağda seçili kaynağın **Ölçüm Zamanı vs. Son Alım Zamanı**, coğrafi kapsamı ve gerçek bağlantı durumu | Kaynağı kontrol etmek / veriyi yenilemek veya çevrimdışı durumu doğrulamak (`10 Repo`, `13 Teknoloji`, `38 Modül` katalogları kapalı teknik ayrıntıda) | Sol (`%55`) temiz kaynak satırları (`Aktif`, `Planlanan`, `Kesik`, `Eski`, `Örnek veri`) + sağ (`%45`) kaynak künyesi; teknik mühendislik katalogları en altta kapalı `<details>` içinde | Tek sütun kaynak kartları ve seçili kaynak künyesi |
| **7. Ayarlar & Rapor** | Görünüm, sahne yoğunluğu, marka sembolü izi, hareket azaltma ve **BCP 47 çok dilli arama/seçim merkezi** + Temiz Yazdırılabilir Rapor | Dil/tema/yoğunluk tercihini kalıcı değiştirmek; **Raporu yalnızca rapor içeriğiyle (arka plan taşması olmadan) PDF/HTML/JSON olarak dışa aktarmak** | 2 sütunlu sakin tercih kartları; Rapor açıldığında tam ekran okunaklı belge görünümü, `@media print` altında arka plan tamamen gizlenir | Tek sütun tercih kartları; rapor tam genişlikte temiz belge |

### 1.3 Tipografi, Renk, Boşluk ve Hareket Kararları (`01_Onayli_Holografik_Atmosfer.png` & `02_Sembol_Form_Referansi.png` Uyumlu)
- **Renk Paleti (`01_Onayli_Holografik_Atmosfer.png` Referanslı):**
  - Arka Plan Derin Uzay Boşluğu (`--bg-0`): `#040812`
  - Dumanlı İndigo / Antrasit Cam Yüzey (`--bg-1` / `--surface-1`): `rgba(10, 19, 36, 0.78)` (`backdrop-filter: blur(16px)`)
  - İkincil Cam Katmanı (`--surface-2`): `rgba(15, 28, 52, 0.68)`
  - Birincil Holografik Buz Mavisi Vurgu (`--accent`): `#88D4FF` (hover/aktif: `#BAE6FD`)
  - Kontrollü Sıcak Altın / Kehribar Işık (`--gold-accent` / `--warn`): `#E6C387` / `#F0B45A` (yalnızca odak halkası, merkez ışık vurgusu ve dikkat gerektiren durumlarda ölçülü kullanılır)
  - Metin Hiyerarşisi: Birincil `#F3F6FA`, İkincil `#B4C4D8`, Üçüncül `#7E93AE` (WCAG AA `4.5:1` üstü kontrast)
- **Tipografi:**
  - Gövde ve Arayüz: `'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif` (Türkçe `ğ, ü, ş, ı, i, ö, ç, İ` tam destekli)
  - Sayısal / Zaman Damgası / Koordinat: `'JetBrains Mono', 'Cascadia Mono', Consolas, monospace` + `font-variant-numeric: tabular-nums`
  - Boyut Tabanı: Gövde metni `14px–15px` (`0.88rem–0.94rem`), ikincil etiketler en az `12px` (`0.75rem`), bölüm başlıkları `18px–24px`.
- **Boşluk ve Yoğunluk Kuralları:**
  - Bir satırda en fazla 3–4 kart; bir kartta en fazla 3 veri noktası.
  - Kart iç boşluğu `16px–20px`, kartlar arası boşluk `14px–16px`, kenar çizgisi `1px solid rgba(136, 212, 255, 0.14)`.
- **Hareket ve Animasyon (`animate`, `animation-performance`, `review-animations` İlkeleri):**
  - Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
  - Süre: Arayüz geçişleri `160ms–240ms` (`300ms` altı); yalnızca `transform` ve `opacity` anime edilir (`top`/`left`/`width`/`height` animasyonu yasaktır).
  - `prefers-reduced-motion: reduce` ve `Ayarlar -> Hareket Azaltma` aktifken tüm kamera uçuşları, rüzgâr parçacıkları ve arka plan shader hareketleri anında durdurulur.

---

## 2. Görsel Referans Değerlendirme Tablosu (`GORSEL_REFERANSLAR.md`)

Aşağıdaki tabloda paketteki yerel görseller ve dış referans bağlantıları tek tek değerlendirilmiştir. Ağ doğrulaması sırasında erişilemeyen bağlantılar (`behance.net` anti-bot `HTTP 403`) dürüstçe raporlanmış, hiçbir zaman incelenmiş gibi uydurulmamıştır:

| # | Referans Kaynağı | Erişim Durumu | CAELUS'a Alınan Tasarım İlkesi | CAELUS'a Alınmayan (Reddedilen) Özellik |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `GORSELLER/01_Onayli_Holografik_Atmosfer.png` (Birincil Sanat Yönetimi) | **YEREL DOSYA — İNCELENDİ** (`1024×559` PNG) | Açık uçlu iç içe spiral katmanlar, merkezde sakin boşluk, buz mavisi (`#88D4FF`), dumanlı lacivert/antrasit (`#040812`–`#0B1324`) ve kontrollü sıcak altın ışık (`#E6C387`) dengesi | Görselin kendisini sahte bir "canlı 3B motor çıktısı" gibi sunmak; veri veya harita üstünü kapatan yoğun arka plan kullanımı |
| 2 | `GORSELLER/02_Sembol_Form_Referansi.png` (Marka Sembolü Form Referansı) | **YEREL DOSYA — İNCELENDİ** (`1024×548` PNG) | Açık uçlu, iç içe kıvrılan, merkezi boşluklu çağdaş vektörel spiral amblem (`ui/assets/caelus-symbol.svg` ve `ui/assets/caelus-logo.png`); üst barda ve isteğe bağlı düşük opaklıklı arka plan izinde kullanım | Sembolü dini amblem veya tarihsel rekonstrüksiyon olarak sunmak; eski yıldızlı/antik TV logosu estetiği; Sirius/Orion takımyıldızı zorunluluğu |
| 3 | `https://science.nasa.gov/eyes/` (NASA Eyes) | **HTTP 200 — İNCELENDİ** | Tam ekran 3B uzay/küre sahnesi, sahneyi kapatmayan ince yüzen bilgi kartları, gerçek zaman/efemeris kontrol şeridi | Aşırı teknik telemetri kısaltmaları |
| 4 | `https://cosmoscope.space/` (Cosmoscope) | **HTTP 200 — İNCELENDİ** | Kozmos → Güneş Sistemi → Dünya → Bölge → Kullanıcı Dünyası arasında sakin ölçek geçişi ve temiz tipografik hiyerarşi | Veri kaynağını gizleyen salt sanatsal soyutlama |
| 5 | `GORSEL_REFERANSLAR.md` içindeki 9 Behance bağlantısı (`behance.net/gallery/...`) | **HTTP 403 Forbidden (Anti-Bot Engeli — Açılmadı)** | `GORSEL_REFERANSLAR.md` metninde özetlenen ilkeler uygulandı: koyu uzay/cam dengesi (`FUI/HUD`), derinlikli sahne, Zaman Tekeri (`Wheel Timeline`), sadeleştirilmiş veri kartları (` Data Viz`) | Sahte gelecek teknolojisi / sahte telemetri kadranları, okunmayan mikro yazılar, neon oyun/kripto estetiği |

---

## 3. Çok Dilli (i18n) Mimari Değerlendirmesi ve Karar Gerekçesi

`CAELUS_TEK_ANA_PROMPT.md` uyarınca açık kaynaklı i18n çözümleri mevcut CAELUS mimarisi (çevrimdışı-ilk, sıfır dış çalışma zamanı bağımlılığı, tek dosyalı Windows `dist/caelus_os.exe` ve `include/ui_payload.h` gömülü yapısı) açısından değerlendirilmiştir:

| Çözüm / Depo | Sürüm & Lisans | Mimari Uyumu & Boyut | Değerlendirme ve Karar |
| :--- | :--- | :--- | :--- |
| **`i18next/i18next`** | `v27.0.1` · `MIT` | Tarayıcı uyumlu, zengin ekosistem; ancak ek çalışma zamanı paketi ve eklenti zinciri gerektirir | **Sözleşme ve Anahtar Yapısı Uyumlu Referans:** CAELUS içinde halihazırda bulunan sıfır bağımlılıklı yerel `CaelusI18n` motoru (`ui/scenario_compiler.js`), `i18next` ad alanı/anahtar (`namespace.key`), çoğul/değişken (`{{count}}`) ve deterministik yedekleme (`fallbackLng: ['en-US', 'tr-TR']`) sözleşmesiyle birebir uyumlu olacak şekilde genişletilmiştir. |
| **`i18next/i18next-cli`** | `v1.87.0` · `MIT` | Node `>=22` gerektiren geliştirici CLI aracı | **Yerel Denetim Karşılığı:** Ağ veya harici npm kurulumu gerektirmeden `CaelusI18n.scanUntranslatedKeys()`, `CaelusI18n.auditDomTranslations()` ve `tests/universal_scenario_compiler.test.mjs` içindeki otomatik anahtar tarayıcısı ile her derlemede eksik anahtar ve ham anahtar sızıntısı (`rawKeyLeaks`) denetlenmektedir. |
| **`formatjs/formatjs`** | Monorepo · `MIT` | Standart ICU / `Intl` biçimlendirme | **Doğrudan Standart API Kullanımı:** Harici polyfill yüklemek yerine tarayıcı ve Node.js yerleşik `Intl.DateTimeFormat`, `Intl.NumberFormat` ve `Intl.PluralRules` standartları `CaelusI18n` içinde doğrudan kullanılmaktadır. |
| **`WeblateOrg/weblate`** | `GPL-3.0+` | Python/Django tabanlı sunucu/bulut çeviri yönetim sistemi | **Ürüne Gömülmez (Lisans ve Mimari Sınırı):** `GPL-3.0+` lisansı ve sunucu gereksinimi nedeniyle tek dosyalı yerel `caelus_os.exe` içine gömülmez; çeviri katalogları yerel JSON sözlükleri olarak tutulur ve dışa/içe aktarılabilir yapıda sunulur. |

### 3.1 Dil Kataloğu, Kapsam Dürüstlüğü ve Dinamik İçerik Çevirisi Ayrımı
1. **BCP 47 Dil Kataloğu ve Arama:**
   - **Tam Desteklenen ve İnsan Gözden Geçirmeli Diller (`%100` Anahtar Kapsamı · `%100` Gözden Geçirme):**
     - `tr-TR` — Türkçe (`Türkçe`, LTR)
     - `en-US` — İngilizce (`English (US)`, LTR)
     - `he-IL` — İbranice (`עברית`, RTL tam doğrulama paketi)
   - **RTL ve Kısmi / Yedeklemeli Doğrulama Dilleri (Dürüst Kapsam Gösterimi):**
     - `ar-SA` — Arapça (`العربية`, RTL, `%98` anahtar kapsamı; eksik anahtarlar açıkça `[en-US]` / `[tr-TR]` yedeğiyle işaretlenir, asla sahte `%100 insan gözden geçirmeli` denmez).
   - **Katalogda Kayıtlı Ek Dünya Dilleri (BCP 47 + Kendi Dillerindeki Adları + Dürüst Durum Etiketi):**
     - `de-DE` (`Deutsch`), `fr-FR` (`Français`), `es-ES` (`Español`), `ru-RU` (`Русский`), `zh-CN` (`简体中文`), `ja-JP` (`日本語`), `ko-KR` (`한국어`), `pt-BR` (`Português (Brasil)`), `it-IT` (`Italiano`), `nl-NL` (`Nederlands`), `pl-PL` (`Polski`), `uk-UA` (`Українська`), `el-GR` (`Ελληνικά`), `fa-IR` (`فارسی` · RTL), `ur-PK` (`اردو` · RTL), `hi-IN` (`हिन्दी`), `id-ID` (`Bahasa Indonesia`), `vi-VN` (`Tiếng Việt`), `sv-SE` (`Svenska`), `az-AZ` (`Azərbaycan dili`).
     - Bu ek diller için **Anahtar Kapsamı (%)** ve **İnsan Gözden Geçirme Durumu (%)** ayrı ayrı raporlanır; çevrilmemiş anahtarlar deterministik olarak seçilen yedek dilden (`en-US` / `tr-TR`) gösterilir.
2. **Arayüz Çevirisi (Static UI i18n) vs. Dinamik Veri/Rapor Çevirisi Ayrımı:**
   - **Sabit Arayüz Metinleri:** Menü, sekme, düğme, başlık, boş/hata durumu ve ayar etiketleri yerel sözlükten anında çevrilir.
   - **Dinamik Veri / Olay / Rapor İçeriği:** Kullanıcının kendi girdiği varlık adları, USGS/Open-Meteo/EONET ham kaynak başlıkları, protokol kimlikleri (`BS-01_SAHTE_UFUK`, `us7000c7y0`), koordinatlar, tarihler, sayılar ve kriptografik özetler **asla sessizce değiştirilmez veya üçüncü taraf bir servise gönderilmez**. Dinamik içerik çevirisi varsayılan olarak **Kapalı (Yerel Özgün Metin Korunur)** durumdadır; kullanıcı isterse yerel sözlük eşleştirmesini açabilir ve her zaman özgün kaynak metni görebilir.

---

## 4. CAELUS Ses Tonu ve Terim Sözlüğü (Microsoft Writing Style Guide Uyumlu)

| Mühendislik / Eski İfade | Yeni İnsan Odaklı Türkçe (`tr-TR`) | Yeni İnsan Odaklı İngilizce (`en-US`) | Kullanım Yeri / Kural |
| :--- | :--- | :--- | :--- |
| `Gerçek gözlem snapshot aktarımı` | **Bu olayın verilerini kullan** | **Use this event's data** | `Dünyam` seçili olay kartı birincil eylem düğmesi |
| `Müdahalesiz koşum (Dal A)` | **Hiçbir şey yapılmazsa** | **If nothing is done** | `Senaryolar` ve `Rapor` karşılaştırma başlığı |
| `Müdahaleli koşum (Dal B)` | **Bu adım uygulanırsa** | **If this step is applied** | `Senaryolar` ve `Rapor` karşılaştırma başlığı |
| `Deterministik C++17 sabit nokta 1e6 motoru` | **Hesaplama motoru** | **Calculation engine** | Ana ekranda sade; `1e6`, `seed`, `hash` yalnızca `"Nasıl hesaplandı?"` içinde |
| `Epistemik rozet / Veri soykütüğü` | **Bilginin türü ve kaynağı** | **Information type & source** | Tüm kartlarda açık kaynak/durum etiketi |
| `Look-ahead gate / t > t_karar` | **Seçilen tarihte bu bilgi henüz mevcut değildi** | **This information was not yet available on the selected date** | Zaman çizgisi ve geçmiş olay incelemesi |
| `Stale / Heartbeat timeout` | **Bağlantı yok · Son bilinen veri gösteriliyor** | **Disconnected · Showing last known data** | `Bağlantılar` ve üst durum çubuğu |
| `Histerezis / Kalıcı kayıp kilidi` | **Gecikme eşiği aşıldığında oluşan kalıcı kapasite kaybı** | **Permanent capacity loss after delay threshold** | `Senaryolar` açıklama metni (teknik terim parantez/detay içinde) |

---

## 5. Kullanıcıya Görünen Metin Envanteri (User-Visible String Inventory)

| Envanter Grubu | Kaynak Dosya / Bileşen | Anahtar Örnekleri (`data-i18n` / JS) | Doğrulama Yöntemi |
| :--- | :--- | :--- | :--- |
| **1. Üst Gezinme, Mobil Gezinme ve Ölçek Çubuğu** | `ui/index.html` (`.top-header`, `#caelus-mobile-bottom-nav`, `#dunyam-scale-nav-bar`) | `nav.dunyam`, `nav.kesfet`, `nav.kozmos`, `nav.senaryolar`, `nav.hafiza`, `nav.baglantilar`, `nav.ayarlar`, `scale.cosmos`, `scale.solar_system`, `scale.earth`, `scale.region`, `scale.user_world` | DOM `[data-i18n]` taraması + TR/EN/AR/HE ekran görüntüsü |
| **2. Dünyam 3B Sahne, Seçili Olay Kartı ve Çekmeceler** | `ui/index.html` (`#dunyam-overview-hub`), `ui/app.js` (`renderDunyamOverview`, `selectCesiumGlobeMarkerById`) | `dunyam.use_event_data`, `dunyam.selected_event_title`, `dunyam.what_happened`, `dunyam.where`, `dunyam.when`, `dunyam.source`, `dunyam.status`, `dunyam.empty_title`, `dunyam.empty_desc` | CDP `Runtime.evaluate` + `1600×960` ve `390×844` doğrulaması |
| **3. Keşfet (Süreç, Bölgesel Harita, İlişki Ağı, Tablo)** | `ui/index.html` (`#kesfet-clean-workspace`), `ui/app.js` (`mountKesfetMapLibreView`, `mountKesfetCytoscapeGraph`, `renderKesfetPerspectiveAndDuckDbWorkspace`) | `kesfet.tab_system`, `kesfet.tab_map`, `kesfet.tab_graph`, `kesfet.tab_table`, `kesfet.causality_notice`, `kesfet.map_offline_notice`, `kesfet.fit_graph` | Harita/Ağ/Tablo alt görünüm testleri |
| **4. Kozmos (3B Güneş Sistemi ve Efemeris)** | `ui/index.html` (`#living-universe-section`), `ui/app.js` (`mountKozmosSpacekitScene`, `renderLivingUniversePanel`) | `kozmos.scale_notice`, `kozmos.valid_epoch_notice`, `kozmos.out_of_range_warning`, `kozmos.source_jpl` | Geçerli (`2026`) ve aralık dışı (`2100`) tarih testi |
| **5. Senaryolar (4 Adımlı Akış ve Nasıl Hesaplandı?)** | `ui/index.html` (`#senaryolar-guided-workspace`), `ui/app.js` (`renderSenaryolarGuidedWorkspace`) | `scen.step1_title`, `scen.step2_title`, `scen.step3_title`, `scen.step4_title`, `scen.if_nothing_done`, `scen.if_step_applied`, `scen.how_calculated` | 4 adımlı sihirbaz geçişi ve A/B motor koşumu testi |
| **6. Hafıza (Zaman Çizgisi, ×N Gruplama, Filtreler)** | `ui/index.html` (`#hafiza-clean-workspace`), `ui/app.js` (`renderHafizaStreamWorkspace`) | `hafiza.filter_all`, `hafiza.filter_real`, `hafiza.filter_forecast`, `hafiza.filter_sim`, `hafiza.filter_user`, `hafiza.filter_saved`, `hafiza.grouped_count_badge` | Tekrarlayan kayıtların `×N` gruplanması ve tekil açılması testi |
| **7. Bağlantılar (Veri Kaynakları ve Teknik Kataloglar)** | `ui/index.html` (`#baglantilar-clean-workspace`), `ui/app.js` (`renderBaglantilarCleanWorkspace`) | `conn.status_active`, `conn.status_planned`, `conn.status_disconnected`, `conn.status_stale`, `conn.status_sample`, `conn.tech_catalogs_toggle` | Canlı ve çevrimdışı kesinti testi |
| **8. Ayarlar, Komut Paleti ve Rapor (PDF/HTML/JSON)** | `ui/index.html` (`#quiet-settings-section`, `#dossier-modal`), `ui/app.js` (`openDossierModal`, `buildOfficialDossierHtml`) | `settings.theme`, `settings.density`, `settings.brand_mark`, `settings.reduced_motion`, `settings.language_search`, `report.title`, `report.print_btn` | TR/EN dil değişimi, yeniden yükleme kalıcılığı ve çok sayfalı PDF yazdırma testi |

