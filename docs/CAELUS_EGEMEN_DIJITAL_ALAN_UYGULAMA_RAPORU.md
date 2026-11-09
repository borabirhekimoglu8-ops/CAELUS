# CAELUS — Egemen Dijital Alan, Güvenilir Asistan, Kişisel Ajanlar ve Gerçek Dünya Entegrasyonu Uygulama Raporu

- **İncelenen Depo:** `https://github.com/borabirhekimoglu8-ops/CAELUS`
- **Varsayılan Dal:** `main`
- **Başlangıç Commit'i:** `3db004b` (`3db004b Merge pull request: CAELUS Living World V2, Non-LLM Conversational Advisor, Personal Agent Studio & 12-Language UI`)
- **Bitiş Commit'i:** `HEAD` (`main` üzerinde `3db004b` üzerine uygulanan egemen dijital alan ve gerçek dünya entegrasyonu commit'i)
- **Rapor Tarihi (UTC):** `2026-11-10`

---

## KATMAN A — KULLANICI İÇİN AÇIK TÜRKÇE ÖZET
### ("Ne değişti, şimdi ne yapabiliyorum, ne henüz hazır değil?")

### 1. Ne Değişti?
1. **İlk açılışta sahte "canlı veri" gösterimi kaldırıldı:**
   - Daha önce danışman ve ajan stüdyosu açıldığında TSMC, Apple, SEC EDGAR, Wikidata ve OpenAlex adlarını taşıyan kod içine gömülü örnek kayıtlar ve önceden doldurulmuş kullanıcı tercihleri otomatik yükleniyordu.
   - Artık normal kullanımda (üretim modunda) sistem **0 sahte olgu** ve **boş kullanıcı tercihi** ile açılır. Henüz kaynak seçilmemiş veya dosya yüklenmemişse açıkça şu mesaj gösterilir:
     > *"Henüz gerçek dünya verisi alınmadı. Bir kaynak seçebilir veya dosya ekleyebilirsin."*
2. **Örnek / Eğitim Verisi gerçek dünya hafızasından tamamen ayrıldı:**
   - Örnek kayıtlar yalnızca siz üst çubuktaki **"Örnek veri (Eğitim Alanı)"** kutusunu açıkça işaretlediğinizde görünür, ekranda **"Örnek veri"** rozeti taşır ve gerçek dünya hafızasına (`C_SOURCED_WORLD_MEMORY`) asla kopyalanmaz.
3. **Dünya Verileri Kapısı (`CaelusWorldDataGate`) eklendi:**
   - Kişisel dosyalarınız ve notlarınız (**Alan A**) ile dış kaynaklardan alınan veriler (**Alan B**) birbirinden ayrıldı.
   - Dış kaynaklara sorgu göndermeden önce hangi alanların paylaşılacağını ekranda görebilirsiniz; özel dosyalarınız ve konuşma geçmişiniz dış kaynaklara gönderilmez.
4. **Kişisel Ajan İzinleri Varsayılan Olarak Kapalı ve Kalıcı Hale Getirildi:**
   - Yeni ajan oluştururken ağ erişimi (`network_access`), yerel dosya okuma (`local_file_read`) ve bildirim (`notifications`) izinleri varsayılan olarak **kapalıdır**.
   - Oluşturduğunuz ajanlar ve çalışma geçmişleri cihazınızın yerel hafızasında (`localStorage`) saklanır; sayfayı yenilediğinizde kaybolmaz.

### 2. Şimdi Ne Yapabiliyorum?
- **Bilgilerimin nerede olduğunu ve bağlantı durumunu tek bakışta görebilirim:**
  - `Yaşayan Dünya & Ajanlar` çekmecesinin en üstündeki **Egemen Dijital Alan Kontrol Çubuğu** üzerinden çalışma kipini **1. Çevrim Dışı**, **2. İzinli Bağlantı** veya **3. Ayrı Cihazdan Aktarım** olarak seçebilirsiniz.
- **Gerçek açık veri kaynaklarını (Wikidata, World Bank, SEC EDGAR, OpenAlex) izin vererek sorgulayabilirim:**
  - Örneğin `Wikidata` kaynağını seçip `TSMC` veya `Q713418` yazarak ya da `World Bank` kaynağını seçip `TUR` yazarak gerçek HTTPS yanıtlarını SHA-256 içerik özeti ve 5 ayrı zaman damgasıyla (`olay zamanı`, `yayın zamanı`, `alım zamanı`, `kontrol zamanı`, `geçerlilik aralığı`) çekebilirsiniz.
- **Kendi `.csv` / `.tsv` / `.xlsx` dosyamı yükleyip satır kanıtlı sorular sorabilirim:**
  - Kendi tablonuzu yüklediğinizde LLM dışı konuşan danışman, yanıtlarında hangi dosyanın hangi satırına (`Satır N`) dayandığını ve bozuk/eksik satırları açıkça gösterir.
- **Her cevabın dayanağını (7 Zorunlu Cevap Bileşeni + Cevap Pasaportu) inceleyebilirim:**
  - Danışman her yanıtta: (1) kısa yanıtı, (2) dayandığı kaynakları veya dosya satırlarını, (3) veri ve olay tarihlerini, (4) uygulanan hesap/kuralı, (5) varsayımları, (6) bilinmeyenleri ve (7) önerilen bir sonraki adımı ayrı ayrı listeler.
- **Kişisel ajanlarımı oluşturabilir, çalıştırabilir, durdurabilir, yetkisini geri alabilir ve verilerimi dışa aktarıp silebilirim.**

### 3. Ne Henüz Hazır Değil veya Sınırlı?
- **Uygulama kapalıyken 7/24 arka plan çalışması yoktur:** Tarayıcı ve iPhone/iOS PWA kısıtları nedeniyle ajanlar ve kaynak zamanlayıcıları **yalnızca uygulama/sekme açıkken (`APP_OPEN`)** veya **siz elle çalıştırdığınızda (`MANUAL`)** çalışır. Uygulama kapalıyken kaçırılan zamanlı çalışmalar bir sonraki açılışta dürüstçe raporlanır.
- **Çok dilli derin dilbilimsel çözümleme:** Arayüz 12 dili destekler; ancak ek/kök soyma ve zamir çözümleme **Türkçe (`tr-TR`)** için tam kapsamlı, **İngilizce (`en-US`)** için temel kural düzeyindedir. Diğer 10 dilde yalnızca arayüz ve boş durum çevirisi bulunur.
- **Ajan çalışma zamanı izolasyonu:** Ajanlar şu anda uygulama içi politika kapısı (Cedar tarzı `permit`/`forbid`) ve bellek içi klonlama ile izole edilir; işletim sistemi düzeyinde tam Wasmtime/WASI kum havuzu (sandbox) henüz haricî koşul/yol haritası aşamasındadır.
- **Yerel ses modelleri (`whisper.cpp`, `Piper`):** Gizli model indirilmemesi kuralı gereği ses modelleri pakete gömülmemiştir; varsayılan deneyim yazılı konuşmadır.

---

## KATMAN B — TEKNİK DENETİM KATMANI

### 1. İncelenen Dal, Başlangıç ve Bitiş Durumu
- **Varsayılan Dal:** `main`
- **Başlangıç Commit'i:** `3db004b` (`Merge pull request: CAELUS Living World V2, Non-LLM Conversational Advisor, Personal Agent Studio & 12-Language UI`)
- **Açık Pull Request Durumu:** Denetim başlangıcında açık PR bulunmamaktadır (`git status` temiz).

### 2. Zorunlu Başlangıç Denetimi Bulguları (Bölüm 1)
Kod değişikliği öncesinde yapılan sistematik taramada tespit edilen durumlar:

| Bileşen / Dosya | Başlangıç Durumu | Dosya ve Satır Referansı | Tespit Edilen Risk ve Uygulanan Çözüm |
|---|---|---|---|
| `buildDefaultAdvisorWorldRecords` içinde kodlanmış TSMC, Apple, SEC EDGAR, Wikidata, OpenAlex kayıtları | `YANILTICI VEYA GÜVENSİZ` | [`ui/personal_agent_and_advisor.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/personal_agent_and_advisor.js#L951-L1085) | Üretim modunda `C_SOURCED_WORLD_MEMORY` içine otomatik yükleniyordu ve `OBSERVED_FACT` olarak etiketleniyordu. **Çözüm:** Üretim modunda ilk açılışta `C_SOURCED_WORLD_MEMORY: []` yapıldı; örnek kayıtlar `isSampleFixture: true` ile yalnızca kullanıcı `enableTrainingSampleMode` açtığında izole `F_TRAINING_SAMPLE_MEMORY` alanında tutulur. |
| `createConversationalAdvisorSession` içindeki varsayılan kullanıcı tercihleri (`interestAreas`, `followedEntities`) | `YANILTICI VEYA GÜVENSİZ` | [`ui/personal_agent_and_advisor.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/personal_agent_and_advisor.js#L2258-L2274) | Kullanıcı hiç tercih girmemişken `['yarı iletken tedariki', 'enerji maliyeti']` ve `['TSMC', 'Apple Inc.']` varsayılan yükleniyordu. **Çözüm:** Varsayılan tercih dizileri boş (`[]`) başlatıldı. |
| `createPersonalAgentStudio` içindeki sabit `tedarik_secenekleri_2026.csv` ve başlangıç ajanları | `YANILTICI VEYA GÜVENSİZ` | [`ui/personal_agent_and_advisor.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/personal_agent_and_advisor.js#L4188-L4235), [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L27073-L27113) | İlk açılışta sahte CSV ve 3 ajan otomatik oluşturuluyordu. **Çözüm:** Üretim modunda boş başlatıldı; örnek şablonlar yalnızca kullanıcı `📋 3 Örnek Ajan Şablonunu Yükle` düğmesine bastığında veya eğitim modunda yüklenir. |
| `ui/app.js` içindeki kaynak kataloğu ve varlık çözümleme alan adı uyumsuzluğu | `PROTOTİP / KISMİ` | [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js#L27138-L27215) | `c.sourceId`/`c.displayName` ve `entRes.candidates` okunuyordu; `livingScheduler.syncSourceNow` tanımsızdı. **Çözüm:** `c.source_id`, `c.name`, `c.data_license`, `c.commercial_usage_status`, `entRes.candidateMatches` ve `syncSourceNow` tam uyumlu hale getirildi. |
| Deterministik Çekirdek (`caelus_core` Rust, `caelus_wasm`, `dist/caelus_os.exe` C++17) | `GERÇEK KULLANICI AKIŞINDA ÇALIŞIYOR` | [`caelus_core/src/lib.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/caelus_core/src/lib.rs), [`src/causal_engine.hpp`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/src/causal_engine.hpp) | Sabit noktalı (`1e6`) deterministik çekirdek ve bit-özdeş tekrar oynatma korundu. |
| İlk Gerçek Görev Motoru (`.xlsx`/`.csv` Calamine + OpenXML, Vaka A/B) | `GERÇEK KULLANICI AKIŞINDA ÇALIŞIYOR` | [`ui/first_real_task_engine.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/first_real_task_engine.js), [`tools/caelus_xlsx_engine/src/lib.rs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/tools/caelus_xlsx_engine/src/lib.rs) | Korundu ve danışman/ajan özel dosya alanıyla (`Alan A`) birleştirildi. |

### 3. Değiştirilen ve Eklenen Dosyalar
1. [`ui/personal_agent_and_advisor.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/personal_agent_and_advisor.js) — Gerçek veri vs örnek veri ayrımı (Bölüm 2), `CaelusWorldDataGate` ve 5 mantıksal veri alanı (Bölüm 3 & 4), 12 bilgi durumu ve 7 zorunlu cevap bileşeni (Bölüm 5), yerel CSV/tablo satır kanıtlı sorgulama, çelişki tespiti, kapsam dışı soru sınırı, varsayılan kapalı ajan izinleri, `localStorage` kalıcılığı, çalışma zamanı sınırları, kaçırılan zamanlı çalışma tespiti (Bölüm 6) ve Cedar / Soufflé Datalog / ProvSQL Semiring / Z3 kısıt tutarlılığı prototipleri (Bölüm 7 & 8).
2. [`ui/living_world_model.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/living_world_model.js) — Wikidata serbest metin araması (`wbsearchentities` → `wbgetentities` çözümlemesi), World Bank çoklu ülke kodu (`TUR;WLD`) güvenli URL kodlaması, kaynak kimliği takma adları ve zamanlayıcı `syncSourceNow` metodu.
3. [`ui/index.html`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/index.html) — `#caelus-living-advisor-agent-drawer` içinde Egemen Dijital Alan Kontrol Çubuğu (`#laa-sovereign-control-bar`), çalışma kipi seçici (`#sel-laa-gate-mode`), eğitim alanı anahtarı (`#chk-laa-training-sample-mode`), dış sorgu paylaşım önizlemesi (`#laa-outbound-query-preview`), yerel dosya yükleyici (`#inp-laa-local-user-file`), paket içe aktarıcı, veri dışa aktarma/silme ve varsayılan kapalı ajan izin kutuları.
4. [`ui/app.js`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/ui/app.js) — `initCaelusLivingAdvisorAndAgentStudio` fonksiyonunun `CaelusWorldDataGate`, `CaelusConversationalAdvisor` ve `CaelusPersonalAgentStudio` ile uçtan uca bağlanması.
5. [`tests/personal_agent_and_advisor.test.mjs`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/tests/personal_agent_and_advisor.test.mjs) — P0, P1, P2, P3 ve UI entegrasyonunu doğrulayan 13 kapsamlı test paketi.
6. [`data/caelus_commercial_inventory.json`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/data/caelus_commercial_inventory.json) — Piper TTS (`rhasspy/piper` MIT vs `OHF-Voice/piper1-gpl` GPL-3.0 + ses modeli veri kümesi lisansları), `whisper.cpp` ve Bölüm 7 teknolojilerinin ticari envanter kayıtları.
7. [`.github/workflows/pages.yml`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/.github/workflows/pages.yml) — `ui/personal_agent_and_advisor.js` sözdizimi kontrolü, `tests/personal_agent_and_advisor.test.mjs` koşumu ve `dist/index.html` içinde `CaelusWorldDataGate` / `CaelusConversationalAdvisor` / `CaelusPersonalAgentStudio` doğrulaması.
8. [`dist/index.html`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/dist/index.html) & [`dist/caelus_standalone.html`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/dist/caelus_standalone.html) — `python tools/build_standalone.py` ile yeniden üretilen tek dosya çevrim dışı paketler.
9. [`docs/CAELUS_EGEMEN_DIJITAL_ALAN_UYGULAMA_RAPORU.md`](file:///c:/Users/Lenovo/Desktop/CAELUS-main/docs/CAELUS_EGEMEN_DIJITAL_ALAN_UYGULAMA_RAPORU.md) — Bu iki katmanlı uygulama ve teknik denetim raporu.

### 4. Gerçek Kullanıcı Akışında Adım Adım Çalışan Özellikler
1. **Adım 1 — İlk Açılış ve Egemen Alan Kontrolü:** Kullanıcı sağ üstten `🌐 Yaşayan Dünya & Ajanlar` çekmecesini açar. Üretim modunda sahte veri yoktur; `"Henüz gerçek dünya verisi alınmadı. Bir kaynak seçebilir veya dosya ekleyebilirsin."` mesajı ve `📍 Bilgilerim Nerede: Yerel Cihaz / Tarayıcı Hafızası` rozeti görünür.
2. **Adım 2 — Dış Kaynak Sorgu Önizlemesi ve Canlı Veri Çekme:** Kullanıcı `Kaynak Seç` menüsünden `Wikidata` veya `World Bank` seçer, `TSMC` veya `TUR` yazar. `#laa-outbound-query-preview` kutusunda dışarıya yalnızca hangi parametrelerin gideceği gösterilir. `🔍 Kaynağa İzin Ver & Şimdi Sorgula` düğmesine basıldığında gerçek HTTPS yanıtı alınır, SHA-256 özeti hesaplanır ve `Alan B` (`B_EXTERNAL_SOURCE_RECORDS`) içine kaydedilir.
3. **Adım 3 — Kişisel Yerel Dosya Yükleme:** Kullanıcı `📂 Kendi Dosyam (.csv / .tsv)` seçicisiyle yerel dosyasını yükler. Dosya `Alan A` (`A_USER_PRIVATE_SPACE`) içinde kalır, dış bağlayıcılarla paylaşılmaz, sütun ve satır numaralarıyla (`Satır N`) ayrıştırılır.
4. **Adım 4 — LLM Dışı Konuşan Danışman Sorgusu:** Kullanıcı `2. Konuşan Danışman` sekmesine geçip `"TSMC hakkında son dönemde ne değişti?"`, `"Bu değişiklik hangi kurumlarla ilişkili?"`, `"Peki bu benim ilgilendiğim alanı etkiler mi?"` veya `"Yüklediğim CSV dosyamda hangi satırlar var?"` diye sorar. Danışman haricî LLM kullanmadan 7 zorunlu cevap bileşenini, 12 durumlu Cevap Pasaportunu ve ProvSQL soykütük polinomunu (`\mathbb{N}[X]`) üretir.
5. **Adım 5 — Kişisel Ajan Oluşturma, Çalıştırma, Yetki Geri Alma ve Silme:** Kullanıcı `3. Kişisel Ajan Stüdyosu` sekmesinde doğal dil hedefi yazar, açık izin kutularını (`network_access`, `local_file_read`) seçer, ajanı çalıştırır (`▶ Çalıştır`), kanıt kartını inceler, isterse `🔒 Yetkiyi Geri Al` ile izinleri kapatır veya `🗑 Sil` ile etki önizlemesini görerek siler.

### 5. Gerçek Veri, Kontrollü Test Verisi ve Prototip Ayrımı
- **Gerçek Veriyle Çalışanlar:**
  - `Wikidata` (`wbsearchentities` + `wbgetentities` API) ve `World Bank Indicators v2` (`api.worldbank.org/v2/country/...`) bağlayıcıları gerçek HTTPS yanıtlarıyla uçtan uca test edilmiştir.
  - `SEC EDGAR Submissions`, `OpenAlex Works` ve `GDELT DOC 2.0` ayrıştırıcıları gerçek şema sözleşmeleriyle çalışır.
  - Yerel `.xlsx` / `.csv` okuyucu (`Calamine` Rust + `CAELUS OpenXML` JS) gerçek kullanıcı dosyalarıyla çalışır.
- **Kontrollü Test Verisiyle Çalışanlar:**
  - `tests/personal_agent_and_advisor.test.mjs`, `tests/living_world_model.test.mjs` ve `tests/first_real_task.test.mjs` içindeki birim testleri ve kullanıcı tarafından açıkça açılan `"Örnek veri (Eğitim Alanı)"` kipi.
- **Prototip Kalanlar:**
  - Bölüm 7 kapsamındaki `evaluateCedarStylePolicy` (Cedar), `runStratifiedDatalogLineageEngine` (Soufflé/Datalog), `computeProvenanceSemiringPolynomial` (ProvSQL $\mathbb{N}[X]$) ve `verifyConstraintConsistencyBounds` (Z3 SAT/UNSAT) fonksiyonları tarayıcıda sıfır bağımlılıkla çalışan **JS eşdeğer prototipleridir**; ilgili C++/Rust yerel ikililerinin doğrudan gömülü sürümü değildir.

### 6. Güvenlik ve Ağ Sınırı Testlerinin Kapsamı ve Sınırları
- **Test Edilenler:**
  - Çevrim dışı kipte (`OFFLINE`) `fetch` çağrısı sayısının `0` olduğunun kanıtlanması (`networkRequestSent: false`).
  - Özel dosya içeriğinin (`privateFiles`) veya gizli anahtar kalıplarının (`api_key`, `secret`, `bearer`) dış sorgu parametrelerine sızmasının `previewOutboundSourceQuery` tarafından engellenmesi ve günlüklerde `[REDACTED_SECRET]` ile maskelenmesi.
  - `validateExternalSourceRequestSafety` ile yalnızca `https:` protokolüne ve onaylı 5 açık veri alan adına izin verilmesi; `http:`, `localhost`, `127.0.0.1`, `169.254.169.254`, `10.x`, `192.168.x`, `.local` ve `.internal` adreslerinin (SSRF) engellenmesi.
  - Yanıt boyutu (`maxResponseBytes`), URL uzunluğu (`maxUrlLength`) ve zaman aşımı (`timeoutMs`) sınırları.
  - Dış kaynak metinlerindeki komut enjeksiyonu (`Prompt/Instruction Injection`) kalıplarının yetki kazanmaması.
- **Kapsam Dışı / Sınır:**
  - Tarayıcı eklentileri veya işletim sistemi çekirdeği düzeyindeki ağ trafiği bu uygulama içi kapının kapsamı dışındadır.

### 7. Kişisel Ajanların Gerçek Yetki, Çalışma ve İzolasyon Sınırları
- **İzin Modeli:** `strictDefaultDeny: true` desteklenir; yeni ajan oluşturma arayüzünde `network_access`, `local_file_read`, `local_file_write`, `notifications` ve `external_action` varsayılan olarak kapalıdır.
- **Çalışma Sınırları:** Her ajan çalışmasında `max_steps`, `max_runtime_ms`, `max_requests_per_run`, `max_records_per_run`, `max_result_bytes`, `max_file_bytes` ve `max_file_rows` sınırları denetlenir; aşım durumunda ajan `STOPPED` durumuna geçer.
- **Zamanlama Dürüstlüğü:** Yalnızca `MANUAL` ve `APP_OPEN` desteklenir; `checkMissedScheduledRuns` uygulama kapalıyken geçen sürede arka planda çalışılmış gibi sahte kayıt üretmez (`backgroundExecutionClaimed: false`).
- **İzolasyon Sınırı:** Ajanlar arası hafıza (`isolatedMemoryByAgentId`) klonlanarak ayrılır ve bir ajan diğerinin özel dosya önbelleğini okuyamaz; ancak tüm ajanlar aynı JS/tarayıcı süreci içinde çalışır (işletim sistemi düzeyinde ayrı WASI süreci değildir).

### 8. Danışmanın Desteklediği ve Desteklemediği Soru Türleri
- **Desteklenen 12 Konuşma Eylemi (`SUPPORTED_SPEECH_ACTS_12`):**
  1. Varlık son değişiklik sorgusu (`ENTITY_RECENT_CHANGE`)
  2. İlişkili kurum ve bağlantı keşfi (`RELATION_EXPLORATION`)
  3. Kullanıcı ilgi alanı etki değerlendirmesi (`USER_DOMAIN_IMPACT`)
  4. Kaynak, kanıt ve zaman damgası sorgusu (`PROVENANCE_AND_EVIDENCE`)
  5. Çelişen kayıtlar sorgusu (`CONTRADICTION_QUERY`)
  6. Varsayım değiştirme (`ASSUMPTION_CHANGE`)
  7. Seçenek karşılaştırma (`OPTION_COMPARISON`)
  8. Yerel kullanıcı dosyası sorgusu (`USER_FILE_QUERY` — satır numaralı kanıt ile)
  9. Zamansal fark sorgusu (`TEMPORAL_DIFF_QUERY`)
  10. Genel dünya durumu sorgusu (`WORLD_STATUS_QUERY`)
  11. Selamlama ve kullanım rehberi (`GREETING_AND_GUIDE`)
  12. Belirsiz/eksik soruda netleştirme isteme (`AMBIGUOUS_OR_UNDERSPECIFIED`)
- **Desteklenmeyen Soru Türleri (`detectUnsupportedQuestionBoundary`):**
  - Serbest yaratıcı yazarlık (şiir, hikâye, roman, şarkı sözü, fıkra, fal).
  - Kullanıcının yerine kesin finansal alım-satım emri, kesin hukuki mütalaa veya tıbbi teşhis/reçete verme (`ABSTAIN_INSUFFICIENT_DATA` ile dürüstçe reddedilir).

### 9. Dil Kapsamı ve Platform Kapsamı
- **Dil Kapsamı:**
  - `tr-TR` (Türkçe): Tam NLU (ek soyma, iyelik/hal/çoğul ekleri, zamir/gönderim çözümleme, düzeltme, olumsuzluk) + tam arayüz.
  - `en-US` (İngilizce): Temel anahtar sözcük/varlık NLU + tam arayüz.
  - Diğer 10 dil (`de-DE`, `fr-FR`, `es-ES`, `it-IT`, `pt-BR`, `ru-RU`, `zh-CN`, `ja-JP`, `ko-KR`, `ar-SA`): Yalnızca arayüz ve boş durum çevirisi (`UI_AND_EMPTY_STATE_TRANSLATION_ONLY`); derin morfolojik NLU iddiası taşınmaz.
- **Platform Kapsamı:**
  - Masaüstü Tarayıcı ve Tek Dosya Çevrim Dışı Paket (`ui/index.html`, `dist/index.html`, `dist/caelus_standalone.html`): Tam destek.
  - Mobil Web / iPhone Safari PWA (`dist/manifest.webmanifest`, `dist/sw.js`, `apps/caelus-ncm-mobile/`): Duyarlı arayüz ve çevrim dışı önbellek çalışır; iOS işletim sistemi kısıtı nedeniyle uygulama kapalıyken arka plan zamanlayıcısı çalışmaz.

### 10. Kaynak, Araç ve Lisans Değerlendirmeleri (Bölüm 7 & 8)

| Teknoloji / Kaynak | Lisans | CAELUS İçindeki Durumu | Ticari ve Mimari Değerlendirme |
|---|---|---|---|
| **Wasmtime ve WASI** | `Apache-2.0 WITH LLVM-exception` | `YOL HARİTASI / SÖZLEŞME HAZIR` | Ticari kapalı kaynak dağıtıma uygundur. Mevcut tarayıcı/Node sürümünde ajanlar uygulama içi izin kapısıyla izole edilir; masaüstü ikilisinde WASI bileşen izolasyonu sonraki adımdır. |
| **Cedar Politika Dili** | `Apache-2.0` | `PROTOTİP (JS Eşdeğeri Çalışıyor)` | `evaluateCedarStylePolicy` ile `permit`/`forbid` ve `explicit forbid overrides permit` semantiği ajan izin kapısında (`enforceAgentRuntimePermission`) çalışmaktadır. |
| **Soufflé / Datalog** | `UPL-1.0` (Universal Permissive License) | `PROTOTİP (JS Eşdeğeri Çalışıyor)` | `runStratifiedDatalogLineageEngine` ile yarı-naif (semi-naive) tabakalı Datalog ileri zincirleme çıkarımı çalışmaktadır. |
| **Z3 Kısıt Çözümü** | `MIT` | `PROTOTİP (JS Eşdeğeri Çalışıyor)` | `verifyConstraintConsistencyBounds` ile bütçe/süre/risk eşitsizliklerinde `SAT`/`UNSAT` ve çelişen çekirdek (`unsatCore`) tespiti çalışmaktadır. |
| **DuckDB** | `MIT` | `ÇALIŞIYOR (Laboratuvar Benchmark + Hafif Akış)` | `tools/verify_first_real_task_lab.py` içinde 25.000 satırlık analitik sorgu karşılaştırması doğrulanmıştır; <10.000 satırda sıfır bağımlılıklı yerel akış kullanılır. |
| **ProvSQL / Kanıt İzi** | `MIT` | `PROTOTİP (JS Eşdeğeri Çalışıyor)` | `computeProvenanceSemiringPolynomial` ile her Cevap Pasaportu için değişmeli yarı-halka ($\mathbb{N}[X]$) soykütük polinomu üretilir. |
| **MCP (Model Context Protocol)** | `MIT` | `TAMAMLANDI VE TEST EDİLDİ` | `tools/caelus_mcp_server.mjs` içinde 30 araçlık yerel `stdio` JSON-RPC 2.0 sunucusu ve `READ_ONLY_CLIENT` / `OPERATOR` yetki ayrımı çalışmaktadır. |
| **Piper TTS** | `rhasspy/piper`: **MIT** (Arşivlenmiş) vs `OHF-Voice/piper1-gpl`: **GPL-3.0** | `HARİCÎ KOŞUL / İNCELEMEDE` | Arşivlenmiş `rhasspy/piper` (MIT) ile güncel `OHF-Voice/piper1-gpl` (GPL-3.0) açıkça ayrılmıştır. GPL-3.0 sürümü ve CC-BY-NC ses modeli ağırlıkları `TİCARİ PAKETİN DIŞINDA` tutulmuştur. Hiçbir ses modeli gizlice indirilmez. |
| **whisper.cpp** | `MIT` (Kod) + Ağırlık Lisansı Ayrı | `HARİCÎ KOŞUL / İSTEĞE BAĞLI` | Kod MIT lisanslıdır; model ağırlıkları ayrı değerlendirilir ve gizlice indirilmez. Bulunmadığında sistem otomatik olarak yazılı konuşmaya düşer. |

### 11. Çalıştırılan Test Komutları ve Sonuçları
- `node --check ui/personal_agent_and_advisor.js && node --check ui/living_world_model.js && node --check ui/app.js` → **Başarılı (Çıkış kodu 0)**
- `node --test tests/personal_agent_and_advisor.test.mjs` → **13 / 13 Test Geçti (0 Hata)**
- `node --test tests/living_world_model.test.mjs` → **11 / 11 Test Geçti (0 Hata)**
- `node --test tests/first_real_task.test.mjs` → **11 / 11 Test Geçti (0 Hata)**
- `node --test tests/discovery_value_engine.test.mjs` → **19 / 19 Test Geçti (0 Hata)**
- `node --test tests/universal_scenario_compiler.test.mjs` → **58 / 58 Test Geçti (0 Hata)**
- `node --test tests/universal_wasm_scenario.test.mjs` → **1 / 1 Test Geçti (0 Hata)**
- `node --test tests/spatial_interface.test.mjs` → **9 / 9 Test Geçti (0 Hata)**
- `node --test apps/caelus-ncm-mobile/tests/ncm2-quality.test.mjs` → **9 / 9 Test Geçti (0 Hata)**
- `node tools/caelus_mcp_server.mjs --self-test` → **`selfTestPassed: true`, `toolCount: 30`**
- `python tools/verify_first_real_task_lab.py` → **Calamine/OpenXML, Frictionless, Entity Resolution ve DuckDB 25k satır doğrulamaları geçti**
- `cargo test --manifest-path tools/caelus_xlsx_engine/Cargo.toml` → **2 / 2 Rust Calamine testi geçti**
- `python tools/build_standalone.py` → **`dist/index.html` (4.495.619 bayt) ve `dist/caelus_standalone.html` üretildi**

### 12. CI ve Pages İş Akışlarının (`.github/workflows/ci.yml` ve `.github/workflows/pages.yml`) Açıklaması
1. **`.github/workflows/ci.yml` (`CI`):**
   - **Job 1 (`linux-gcc` — `ubuntu-latest`):**
     - `Build release binary (build.sh)`: Yerel C++17 nedensel motoru (`dist/caelus_os`) derler.
     - `Run full CI pipeline (ci.sh)`: Deterministik C++17 motor testlerini ve denetim günlüğü (`CDET`) kontrollerini çalıştırır.
     - `Validate universal browser scenario compiler & NCM-2 against native Linux binary`: Rust `caelus_wasm` hedefini derler, tüm `ui/*.js` dosyalarını `node --check` ile denetler, `tests/*.test.mjs` paketlerini ve `tools/caelus_mcp_server.mjs --self-test` komutunu çalıştırır.
     - `Extract deterministic CDET block`: Linux `CDET` özetini (`cdet-linux`) artifact olarak yükler.
   - **Job 2 (`windows-msvc` — `windows-latest`):**
     - `Build release binary with MSVC (build.bat)`: Windows `dist/caelus_os.exe` ikilisini derler.
     - `Run full CI pipeline (ci.bat)`: Windows deterministik testlerini çalıştırır.
     - `Validate universal browser scenario compiler & NCM-2 against native Windows binary`: WASM derlemesi ve tüm Node.js / MCP testlerini Windows üzerinde çalıştırır.
     - `Extract deterministic CDET block`: Windows `CDET` özetini (`cdet-windows`) artifact olarak yükler.
   - **Job 3 (`cross-os-determinism` — `ubuntu-latest`):**
     - Linux ve Windows `CDET` çıktılarını `diff -u` ile karşılaştırarak işletim sistemleri arası bit-özdeş determinizmi doğrular.
2. **`.github/workflows/pages.yml` (`Deploy iPhone War Room`):**
   - **`workflow_run` Tetikleyicisi:** Yalnızca `CI` iş akışı `main` dalında başarıyla (`success`) tamamlandığında çalışır.
   - **Adımlar:**
     1. `Check out the CI-verified commit`: Doğrulanmış commit'i indirir.
     2. `Install WebAssembly target` & `Build deterministic browser engine`: `caelus_wasm` Rust motorunu `wasm32-unknown-unknown` hedefiyle derler.
     3. `Validate universal scenario compiler`: `ui/personal_agent_and_advisor.js`, `ui/living_world_model.js`, `ui/app.js` dahil tüm modülleri `node --check` ve `node --test` ile doğrular.
     4. `Assemble offline-first iPhone package`: `python3 tools/build_standalone.py` ile `dist/index.html`, `dist/caelus_standalone.html`, `dist/manifest.webmanifest` ve `dist/sw.js` dosyalarını üretir.
     5. `Validate deploy artifact`: `dist/index.html` içinde `CAELUS_WASM_B64`, `CaelusLivingWorldModel`, `CaelusConversationalAdvisor`, `CaelusPersonalAgentStudio`, `CaelusWorldDataGate` varlığını `grep -q` ile doğrular.
     6. `Upload offline-first standalone bundle artifact`: `caelus-pages-dist` paketini her çalışmada artifact olarak yükler.
     7. `Configure GitHub Pages` (`continue-on-error: true`) & `Deploy to GitHub Pages`: Depo ayarlarında GitHub Pages etkinse yayınlar; etkin değilse 403 hatasıyla işi kırmadan yöneticiye gerekli ayarı (`Settings -> Pages -> Source: GitHub Actions`) özet raporunda bildirir.

### 13. Bilinen Açık Riskler ve Bir Sonraki Teknik Öncelikler
1. **Gerçek Wasmtime/WASI İşletim Sistemi Düzeyinde Ajan Kum Havuzu:** Tarayıcı içi ajanlar şu anda JS bellek klonlaması ve Cedar tarzı izin kapısıyla izole edilmektedir; üçüncü taraf eklenti kodu çalıştırılacağı zaman masaüstü ikilisinde Wasmtime/WASI bileşen sınırı eklenmelidir.
2. **Üçüncü Taraf Haber ve Arama Kaynakları (GDELT / SEC EDGAR Hız Sınırı):** GDELT haber başlıkları yalnızca `SOURCE_CLAIM` (haber iddiası) olarak kabul edilir; tam metin telifi nedeniyle makale gövdesi çekilmez.
3. **Çok Dilli Morfolojik Derinlik:** Türkçe dışındaki dillerde ek/kök çözümleme yerine anahtar sözcük eşleşmesi kullanılmaktadır; öncelikli olarak İngilizce ve Almanca için morfolojik kök sözlüğü genişletilebilir.

---

### 14. Zorunlu Özellik ve Durum Tablosu

| Özellik | Durum | Kanıt / Test / Sınır |
|---|---|---|
| 1. Örnek veri ile gerçek veri ayrımı | `TAMAMLANDI VE TEST EDİLDİ` | `tests/personal_agent_and_advisor.test.mjs` (P0 testi): Üretim modunda `C_SOURCED_WORLD_MEMORY` boş (`0` sahte olgu) başlar; örnek veri yalnızca `setTrainingSampleMode(true)` ile `F_TRAINING_SAMPLE_MEMORY` içinde `"Örnek veri"` etiketiyle tutulur. |
| 2. Dünya verileri kapısı ve izin modeli | `TAMAMLANDI VE TEST EDİLDİ` | `CaelusWorldDataGate` (`ui/personal_agent_and_advisor.js`), 5 mantıksal alan (`Alan A–E`), 3 çalışma kipi (`OFFLINE`, `PERMITTED_CONNECTION`, `SEPARATE_DEVICE_IMPORT`), paylaşım önizlemesi ve SSRF/HTTPS güvenlik kapısı test edildi. |
| 3. Wikidata bağlayıcısı | `TAMAMLANDI VE TEST EDİLDİ` | `ui/living_world_model.js` (`fetchFromRealWorldSource` + `parseWikidataEntityResponse`) hem QID (`Q713418`) hem serbest metin (`TSMC`) sorgularını gerçek HTTPS yanıtı ve kontrollü test ile doğrular. |
| 4. World Bank bağlayıcısı | `TAMAMLANDI VE TEST EDİLDİ` | `ui/living_world_model.js` (`parseWorldBankIndicatorResponse`) ülke (`TUR`) ve gösterge (`NY.GDP.MKTP.KD.ZG`) serilerini 5 zaman damgası ve CC BY 4.0 lisansıyla çeker; gerçek HTTPS ve birim testiyle doğrulandı. |
| 5. Yerel dosya yükleme ve satır izi | `TAMAMLANDI VE TEST EDİLDİ` | `loadUserFileIntoAdvisor`, `parseUserTableContentWithRowProvenance` ve `ui/first_real_task_engine.js` ile `.csv`/`.xlsx` dosyaları `Satır N` kanıt iziyle yerel `Alan A` içinde sorgulanır; dış ağa sızmaz. |
| 6. Kanıtlı, LLM dışı danışman | `TAMAMLANDI VE TEST EDİLDİ` | 8 katmanlı deterministik mimari, 12 bilgi durumu (`EPISTEMIC_STATES_12`), 7 zorunlu cevap bileşeni (`mandatoryDisclosure7`), çelişki tespiti ve kapsam dışı soru sınırı 13 test paketiyle doğrulandı. |
| 7. Kişisel ajan stüdyosu | `TAMAMLANDI VE TEST EDİLDİ` | `CAELUS_AGENT_CONTRACT_V1`, doğal dil hedef ayrıştırıcı, desteklenmeyen kaynak reddi (`"Bütün sosyal medyayı izle"`), `localStorage` kalıcılığı ve çalışma zamanı sınırları test edildi. |
| 8. Ajan izin ve izolasyon sınırları | `TAMAMLANDI VE TEST EDİLDİ` | İzinler varsayılan kapalı (`strictDefaultDeny`), `revokeAgentPermission` ve Cedar tarzı `forbid > permit` politikası çalışır. Sınır: İzolasyon uygulama/JS belleği düzeyindedir, ayrı işletim sistemi süreci değildir. |
| 9. Çevrim dışı çalışma | `TAMAMLANDI VE TEST EDİLDİ` | `OFFLINE` kipte `0` dış ağ isteği (`networkRequestSent: false`), `dist/index.html` + `dist/caelus_standalone.html` tek dosya paketi ve `runOfflineCorePackageReplay` bit-özdeş tekrar oynatma doğrulandı. |
| 10. İsteğe bağlı yerel ses | `HARİCÎ KOŞUL BEKLİYOR` | `VOICE_TECHNOLOGY_CATALOG` içinde `whisper.cpp` (MIT) ve `rhasspy/piper` (MIT) vs `OHF-Voice/piper1-gpl` (GPL-3.0 — hariç) belgelenmiştir; gizli model indirilmez, yerel motor yoksa otomatik yazılı konuşmaya düşer. |
| 11. CI ve Pages doğrulaması | `TAMAMLANDI VE TEST EDİLDİ` | `.github/workflows/ci.yml` ve `.github/workflows/pages.yml` içinde tüm JS/WASM/Rust/Python kontrolleri tanımlıdır; yerel ortamda 130 Node testi, 30 MCP testi, Python lab ve Rust Calamine testleri eksiksiz geçti. |
| 12. Lisans ve ticari envanter | `TAMAMLANDI VE TEST EDİLDİ` | `data/caelus_commercial_inventory.json` ve `auditCommercialComponentInventory()` ile GPL-3.0 (`piper1-gpl`, `eSpeak NG`, `Neo4j`), AGPL (`Firecrawl`), Commons Clause (`React Bits`) ve CC-BY-NC ağırlıklar ticari paketin dışında tutulmuştur. |
