# CAELUS — İLK GERÇEK GÖREV TEST VE DOĞRULAMA RAPORU

---

## 1. Doğrulama Kapsamı ve Çalıştırılan Test Paketleri

Bu çalışmada geliştirilen tüm katmanlar (Dosya Okuma, Sütun Eşleme, Sürümlü Veri Sözleşmesi, Varlık Tekilleştirme, Gerçek Senaryo Motoru, 7 Sayfalı `.xlsx` / HTML-PDF / Güvenli `.csv` Raporlama, 10 Araçlı MCP Sunucusu ve Mekânsal Arayüz) hem birim/entegrasyon testleriyle hem bağımsız Python karşılaştırma laboratuvarıyla hem de gerçek tarayıcı (Playwright) ile doğrulanmıştır.

| Test Paketi / Komut | Kapsam | Sonuç |
| :--- | :--- | :--- |
| `node --test tests/first_real_task.test.mjs` | Bölüm 20’deki 10 zorunlu doğrulama testi + 12 parça envanteri + 10 MCP aracı ve güvenlik kapıları | **8 / 8 Test Bloğu GEÇTİ** (`0` hata) |
| `python tools/verify_first_real_task_lab.py` | `Calamine` vs `CAELUS OpenXML` vs `SheetJS CE`, `JSON Schema` vs `Frictionless Data`, `CAELUS Entity Resolution` vs `Dedupe/Splink`, `DuckDB` vs Hafif Akış | **4 / 4 Karşılaştırma Deneyi GEÇTİ** |
| `node tools/caelus_mcp_server.mjs --self-test` | JSON-RPC 2.0 `initialize`, `tools/list` (`11 + 10 = 21` araç) ve `tools/call` | **GEÇTİ** (`selfTestPassed: true`) |
| `node tools/verify_first_real_task_playwright.mjs` | Masaüstü (`1600×960`) ve Mobil (`390×844`) gerçek tarayıcı uçtan uca akış ve ekran görüntüleri | **GEÇTİ** (4 kanıt ekran görüntüsü kaydedildi) |
| Mevcut Regresyon Test Paketleri (`spatial_interface`, `discovery_value_engine`, `living_world_model`, `universal_scenario_compiler`, `universal_wasm_scenario`) | Mevcut çalışan sistemin ve kullanıcı verilerinin regresyonsuz korunması | **92 / 92 Test GEÇTİ** (`0` hata) |

---

## 2. Bölüm 20 — 10 Zorunlu Doğrulama Testinin Kanıt Özeti

1. **Türkçe ve İngilizce Başlıklı `.xlsx` ve `.csv` Okuma Testi**:
   - `tests/fixtures/first_real_task/vaka_a_tedarik_zinciri.xlsx` (`Şirket Adı`, `İlişki Türü`, `Toplam_Risk_Formül`) ve noktalı virgül (`;`) ayırıcılı `vaka_b_altyapi_bagimlilik.csv` hem Rust `Calamine` (`0.38.0`) hem de `CAELUS OpenXML / CSV` okuyucu tarafından %100 başlık ve satır eşdeğerliğiyle okundu.
   - Türkçe sayısal biçim (`1.250,50 -> 1250.5`) ve uluslararası biçim (`1,250.50 -> 1250.5`) doğrulandı.
2. **Çok Sayfalı Excel Çalışma Kitabında Sayfa Seçme Testi**:
   - `vaka_a_tedarik_zinciri.xlsx` içindeki `Tedarik_Zinciri` (Sayfa 1) ve `Bölgesel_Düğümler` (Sayfa 2) sayfaları ayrı ayrı listelendi ve seçildi.
3. **Formüllü Hücre / Hesaplanmış Değer Ayrımı, Makro Engeli ve Bozuk Dosya Koruması**:
   - `I2..I6` hücreleri `FORMULA_WITH_CACHED_VALUE` (`=E2*F2`, önbellek `11000`), `I7` hücresi ise `FORMULA_UNCOMPUTED` (`=E7*F7`, önbellek `null`) olarak ayrıldı.
   - `macro_stub_warning.xlsm` içindeki `xl/vbaProject.bin` çalıştırılmadan `MACRO_DETECTED_STRIPPED_READ_ONLY` uyarısıyla yakalandı.
   - `corrupt_archive.xlsx` çökmeden `CORRUPT_OR_UNSUPPORTED_WORKBOOK` hatası döndürdü.
4. **Sütun Eşleme Önerisi ve Kullanıcı Tarafından Eşleme Değiştirme Testi**:
   - Zorunlu LLM çağrısı olmadan tüm sütunlar kurallı gerekçeleriyle eşlendi; kullanıcı `Notlar` sütununu `evidence_source` olarak değiştirdiğinde `mappingMethod: "USER_OVERRIDE_CONFIRMED"` olarak kaydedildi.
5. **Hatalı Tarih / Sayı / Eksik Zorunlu Alan Yakalama ve Geçerli Satırları Koruma Testi**:
   - `vaka_a_tedarik_zinciri.xlsx` içindeki **Satır 8** (`2026-02-30` geçersiz takvim günü + `BOZUK_SKOR` + `BELIRSIZ_HACIM`) ve **Satır 9** (boş `Şirket Adı`) izole edilerek `import_errors` listesine alındı; **Satır 2–7 arasındaki 6 geçerli kayıt** kayıpsız olarak `CAELUS_DATA_PACKAGE_V1` (18 zorunlu alan) sözleşmesine dönüştürüldü.
6. **Aday Aynı Varlıkların Tespiti ve Sessiz Otomatik Birleştirme Yasağı Testi**:
   - `"Alfa Teknoloji A.Ş."` (Satır 2), `"ALFA TEKNOLOJI AS"` (Satır 3) ve `"Alfa Teknoloji"` (Satır 4) aynı `'alfa teknoloji'` kökünde aday küme olarak yakalandı.
   - Kullanıcı onayı (`PENDING`) yokken 9 ayrı varlık korundu (sessiz birleştirme yapılmadı); kullanıcı `MERGE` onayı verdiğinde 7 varlığa indi ve `ENT_ALFA_TEKNOLOJI` altında `source_rows: [2, 3, 4]` izi korundu.
7. **Kullanıcı Verisinden Oluşturulan Dünya Modelinin Gerçek Senaryo Motoruna Bağlanması Testi (Vaka A & Vaka B)**:
   - Hem **Vaka A (Kurumlar ve Tedarik İlişkileri)** hem **Vaka B (Kurumlar ve Altyapı Bağımlılıkları)** `ScenarioPack` v2.0 olarak derlenip deterministik sabit noktalı motorda çalıştırıldı.
8. **İki Müdahale Seçeneğinin Karşılaştırılması ve Farkın Açıklanması Testi**:
   - Vaka A’da Müdahalesiz Temel Akış, Seçenek 1 ve Seçenek 2 karşılaştırıldı; her seçeneğin sistem baskısını neden ve ne kadar düşürdüğü `[● KULLANICI VERİSİ]`, `[◆ VARSAYIM]`, `[▲ SİMÜLASYON]` ayrımıyla açıklandı.
9. **Sonuçtan Kaynak Dosya / Sayfa / Satır İzine Geri Dönülebilmesi ve 10 MCP Aracı Testi**:
   - Her düğüm ve ilişki sonucundan `source_file`, `source_hash`, `source_sheet`, `source_row`, `occurred_at`, `learned_at` alanlarına geri dönüldü.
   - 10 MCP aracının tamamı ve güvenlik kapıları (`../../etc/passwd` engeli ve `promoteToFact` engeli) doğrulandı.
10. **7 Sayfalı `.xlsx`, Çok Sayfalı HTML/PDF Baskı ve CSV Formül Enjeksiyon Koruması Testi**:
    - Üretilen `.xlsx` raporunun 7 sayfası (`Özet`, `Varlıklar`, `İlişkiler`, `Senaryo Karşılaştırması`, `Varsayımlar`, `Hatalar ve Eksik Veriler`, `Kaynak İzleri`) tekrar `Calamine` ile açılarak doğrulandı.
    - `=CMD|' /C calc'!A0`, `+MALICIOUS_SUM`, `\t=TAB_INJECT()`, `\r=CR_INJECT()` hücrelerinin `'` önekiyle etkisizleştirildiği kanıtlandı.
