# CAELUS — İLK GERÇEK GÖREV TİCARİ BAĞIMSIZLIK VE LİSANS ENVANTERİ

---

## 1. Ticari Dağıtım Hedefleri ve Kapı Kuralları

CAELUS’un ticari dağıtım hedefleri şunlardır:
1. Kapalı kaynak ticari ürün olarak satılabilirlik.
2. Müşteri bilgisayarına veya müşteri tesisine (on-prem) kurulabilirlik.
3. Çevrim dışı / hava boşluklu (air-gapped) çalışabilirlik.
4. Üçüncü taraf ücretli API veya bulut servisine zorunlu bağımlılık olmaması.
5. `AGPL` / `GPL` / `SSPL` / `Commons Clause` / `Non-Commercial` kısıtlarının çekirdek pakete sızmaması.

---

## 2. 12 Teknik Parçanın Ticari ve Lisans Envanteri

| # | Bileşen / Parça | Resmi Kaynak / Depo | Seçilen Sürüm | Kod Lisansı ve Alt Bağımlılıklar | Kapalı Kaynak & On-Prem Uyumu | Çevrim Dışı Çalışma | Vendor Lock-in / API Maliyeti | Ticari Statü |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Calamine** | `https://github.com/tafia/calamine` | `0.38.0` | `MIT` (`quick-xml` MIT, `zip` MIT, `encoding_rs` Apache-2.0/MIT) | Evet (MIT telif bildirimi korunarak) | Evet (%100 yerel) | Yok | **UYGUN ADAY** |
| **2** | **CAELUS Veri Anlama ve Sütun Eşleme Motoru** | `CAELUS` (`ui/first_real_task_engine.js`) | `1.0.0` | CAELUS Özgün Mülkiyet (First-Party) | Evet | Evet | Yok (Zorunlu LLM yok) | **CAELUS’A ÖZGÜ** |
| **3** | **JSON Schema & CAELUS Sürümlü Veri Sözleşmesi (`CAELUS_DATA_PACKAGE_V1`)** | `CAELUS` (`ui/first_real_task_engine.js`) | `1.0.0` | CAELUS Özgün Mülkiyet (Test ortamında `jsonschema` MIT) | Evet | Evet | Yok | **CAELUS’A ÖZGÜ** |
| **4** | **Frictionless Data** | `https://github.com/frictionlessdata/frictionless-py` | `5.x` (Karşılaştırma) | `MIT` (25+ Python alt bağımlılığı) | Çekirdek ürüne dahil edilmedi (Yalnızca doğrulama laboratuvarında karşılaştırıldı) | Evet | Python çalışma zamanı yükü nedeniyle çekirdek dışı | **TİCARİ PAKET DIŞINDA** |
| **5** | **CAELUS Açıklanabilir Varlık Eşleştirme (+ `Dedupe` & `Splink` Değerlendirmesi)** | `CAELUS` + `dedupeio/dedupe` + `moj-analytical-services/splink` | `1.0.0` | CAELUS Özgün Mülkiyet (`Dedupe` MIT, `Splink` MIT — yalnızca laboratuvarda) | Evet (Çekirdekte yalnızca CAELUS deterministik motoru çalışır) | Evet | Yok | **CAELUS’A ÖZGÜ** |
| **6** | **DuckDB ve Apache Arrow** | `https://github.com/duckdb/duckdb` | `1.x` | `MIT` (DuckDB) / `Apache-2.0` (Arrow) | Evet (İsteğe bağlı büyük veri analitik adaptörü olarak) | Evet | Yok | **UYGUN ADAY** |
| **7** | **CAELUS İsteğe Bağlı MCP Sunucusu (10 Araç)** | `CAELUS` (`tools/caelus_mcp_server.mjs`) | `1.0.0` | CAELUS Özgün Mülkiyet (MCP JSON-RPC 2.0 `MIT`) | Evet | Evet | Yok | **CAELUS’A ÖZGÜ** |
| **8** | **MarkItDown MCP Belge Adaptörü** | `https://github.com/microsoft/markitdown` | `0.1.x` | `MIT` | İsteğe bağlı belge adaptörü (Çekirdeğe zorunlu bağımlılık yapılmadı; harici LLM görsel modu kapalı) | Evet | Yok | **UYGUN ADAY** |
| **9** | **rust_xlsxwriter** | `https://github.com/jmcnamara/rust_xlsxwriter` | `0.79.4` | `MIT OR Apache-2.0` | Evet | Evet | Yok | **UYGUN ADAY** |
| **10** | **HTML / PDF Baskı Raporu ve Güvenli CSV Dışa Aktarma** | `CAELUS` (`ui/first_real_task_engine.js`) | `1.0.0` | CAELUS Özgün Mülkiyet | Evet | Evet | Yok | **CAELUS’A ÖZGÜ** |
| **11** | **Playwright** | `https://github.com/microsoft/playwright` | `1.50+` | `Apache-2.0` | Evet (Yalnızca geliştirme/CI doğrulama aracı; müşteri paketine gömülmez) | Evet | Yok | **UYGUN ADAY** |
| **12** | **SheetJS CE** | `https://git.sheetjs.com/sheetjs/sheetjs` | `CE 0.20.x` | `Apache-2.0` (Ancak npm’deki `0.18.5` sürümü eski/güvenlik açıklı; güncel CE npm dışı özel tarball ile dağıtılıyor; Pro sürümü ücretli) | Tedarik zinciri ve dağıtım kanalı belirsizliği nedeniyle çekirdek pakete gömülmedi; CAELUS kendi sıfır bağımlılıklı OpenXML okuyucusunu ve `Calamine` köprüsünü kullanır | Evet | SheetJS Pro ticari lisans baskısı | **İNCELEMEDE** |

---

## 3. Kritik Ticari Kararlar ve Gerekçeleri

1. **Neden `SheetJS CE` yerine `Calamine` (Rust) + `CAELUS Offline OpenXML Reader` kullanıldı?**
   - `SheetJS CE` `Apache-2.0` lisanslı olmakla birlikte, genel `npm` kayıt defterindeki `xlsx@0.18.5` paketi güncellenmemekte ve bilinen güvenlik bildirimleri taşımaktadır; güncel `0.20.x` sürümleri yalnızca `cdn.sheetjs.com` üzerinden özel tarball olarak dağıtılmaktadır.
   - Kapalı kaynaklı ve kurumsal on-prem dağıtımlarda dış CDN veya belirsiz paket kanallarına bağımlı olmamak için:
     - Masaüstü / sunucu / CLI tarafında **Rust `Calamine` (`0.38.0`, `MIT`)**,
     - Tarayıcı / mobil çevrim dışı PWA tarafında ise **sıfır dış bağımlılıklı `CAELUS OpenXML (.xlsx) & CSV Okuyucu`** (`ui/first_real_task_engine.js`) kullanılmıştır.
2. **Neden `Frictionless Data`, `Dedupe` ve `Splink` çekirdek ürüne zorunlu bağımlılık yapılmadı?**
   - Üç kütüphane de `MIT` lisanslıdır ancak Python çalışma zamanı ve onlarca alt paket (`petl`, `scipy`, C-eklentileri) gerektirir.
   - Ayrıca `Dedupe` ve `Splink` olasılıksal eşleştirme yaptığı için insan onayı olmadan çalıştırıldığında yakın isimli farklı kurumları (`"Anadolu Enerji Dağıtım A.Ş."` ile `"Anadolu Enerji Üretim A.Ş."`) yanlış birleştirme riski taşır.
   - Bu nedenle çekirdek üründe sıfır bağımlılıklı **CAELUS Sürümlü Veri Sözleşmesi Doğrulayıcısı** ve **Kullanıcı Onaylı Deterministik Varlık Eşleştirme Motoru** kullanılmış; `Frictionless`, `Dedupe` ve `Splink` ise `tools/verify_first_real_task_lab.py` doğrulama laboratuvarında karşılaştırma referansı olarak tutulmuştur.
