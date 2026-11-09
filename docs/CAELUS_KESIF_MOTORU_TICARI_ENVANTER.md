# CAELUS — Keşif ve Bilgi Değeri Motoru Ticari Envanter ve Lisans Denetimi (`CAELUS_KESIF_MOTORU_TICARI_ENVANTER.md`)

> **Hukuki Uyarı:** Bu belge mühendislik ve ürün mimarisi düzeyinde yapılan teknik lisans, dağıtım ve veri hakları denetimidir; resmi hukuki görüş (legal advice) yerine geçmez.

## 1. Ticari Hedef ve Kırmızı Çizgiler

CAELUS’un hedef dağıtım modeli:
- **Ticari ürün** olarak satılabilir,
- **Kapalı kaynaklı (closed-source)** dağıtılabilir,
- **Müşteri tesisine (on-prem / air-gapped)** kurulabilir,
- **Çevrim dışı (offline-first)** deterministik çekirdeğe sahiptir ve hiçbir üçüncü taraf bulut API’sine zorunlu bağımlı değildir.

**Otomatik Onay Yasağı:** Lisansı veya veri kullanım hakkı belirsiz olan, ya da AGPL/GPL/SSPL/Commons Clause kısıtı taşıyan hiçbir bileşen (`İNCELEME GEREKTİRİR` veya `TİCARİ PAKET DIŞINDA`) kapalı kaynaklı dağıtım paketine otomatik onaylı olarak dahil edilmez (`blockedFromAutoCommercialApproval`).

---

## 2. 12 Parçanın 14 Zorunlu Alanlı Ticari ve Teknik Envanter Tablosu

| # | Bileşen / Kaynak Adı | Kategori | Kaynak ve Sürüm | Lisans / Kullanım Koşulu (SPDX) | Ticari Kullanım | Kapalı Kaynak Uyumu | On-Prem / Müşteri Tesisi Dağıtımı | Copyleft / Kod Açma Yükümlülüğü | Atıf / Bildirim Zorunluluğu | Model Ağırlığı / Veri Ayrı Koşulu | Veri Yeniden Dağıtım Hakkı | Çevrim Dışı Çalışma | Ücret / Kota / Sağlayıcı Kilitlenmesi | Sonuç Sınıfı |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **1** | **CAELUS Bilgi Değeri ve Duyarlılık Motoru** | CAELUS Özgün Çekirdek | `ui/discovery_value_engine.js` (`1.0.0`) | `CAELUS-Proprietary` | Evet | Evet | Evet | Yok | Yok | Yok | %100 CAELUS özgün | Evet | Yok | `CAELUS ÖZGÜN` |
| **2** | **CAELUS Hipotez ve Araştırma Günlüğü** | CAELUS Özgün Çekirdek | `ui/discovery_value_engine.js` (`1.0.0`) | `CAELUS-Proprietary` | Evet | Evet | Evet | Yok | Yok | Yok | %100 CAELUS özgün | Evet | Yok | `CAELUS ÖZGÜN` |
| **3** | **CAELUS Özel MCP Sunucusu (11 Araç)** | CAELUS Özgün Çekirdek | `tools/caelus_mcp_server.mjs` (`1.0.0`) | `CAELUS-Proprietary` | Evet | Evet | Evet | Yok | Yok | Yok | %100 CAELUS özgün | Evet | Yok | `CAELUS ÖZGÜN` |
| **4** | **OpenAlex Bilimsel Kaynak Adaptörü & MCP** | Açık Bilimsel Veri + Üçüncü Taraf | OpenAlex API (`CC0-1.0`) / Üçüncü taraf MCP sarmalayıcıları | Üstveri: `CC0-1.0` · Makale tam metinleri: Yayıncıya göre değişir | Üstveri: Evet | Üstveri: Evet | Üstveri: Evet | Yok | Önerilir | **Evet:** CC0 yalnızca bibliyografik üstveriyi kapsar; makale özet/tam metin telifi yayıncıya aittir | Üstveri yeniden dağıtılabilir; kapalı erişim tam metin dağıtılamaz | Sabitlenmiş (pinned) yerel önbellekle Evet | Ücretsiz havuz (100k/gün); kurumsal yüksek hacimde API anahtarı | `İNCELEME GEREKTİRİR` (Tam metin telif ayrımı nedeniyle) |
| **5** | **MarkItDown MCP & Yerel Belge Adaptörü** | Üçüncü Taraf Kütüphane + CAELUS Adaptörü | `microsoft/markitdown` (`MIT`) + `convertLocalDocumentToMarkdownAdapter` | `MIT` | Evet | Evet | Evet | Yok | Evet (`LICENSE` bildirimi) | Opsiyonel bulut LLM/OCR eklentileri devre dışı bırakılmalıdır | Müşterinin kendi yerel belgeleri | Evet (Yerel adaptör %100 çevrim dışı) | Yok | `UYGUN ADAY` |
| **6** | **BoTorch + GPyTorch & PyTorch GP Vekili** | Üçüncü Taraf Araştırma Kütüphanesi | `pytorch/botorch` (`MIT`), `cornellius-gp/gpytorch` (`MIT`), `torch 2.11.0+cpu` (`BSD-3-Clause`) | `MIT` & `BSD-3-Clause` | Evet | Evet | Evet | Yok | Evet (`LICENSE` bildirimi) | Yok | Yok | Evet (CPU üzerinde yerel) | Yok | `UYGUN ADAY` |
| **7** | **DoWhy Nedensel Çıkarım ve Karşı Sınama** | Üçüncü Taraf Kütüphane | `py-why/dowhy` (`0.8` kurulu) | `MIT` | Evet | Evet | Evet | Yok | Evet (`LICENSE` bildirimi) | Yok | Yok | Evet (`tools/run_discovery_research_lab.py`) | Yok | `UYGUN ADAY` |
| **8** | **River Akan Veri Değişim Tespiti (ADWIN)** | Üçüncü Taraf Kütüphane | `online-ml/river` (`0.26.1` kurulu) | `BSD-3-Clause` | Evet | Evet | Evet | Yok | Evet (`LICENSE` bildirimi) | Yok | Yok | Evet (`tools/run_discovery_research_lab.py`) | Yok | `UYGUN ADAY` |
| **9** | **PyTorch Geometric (PyG) & Zamansal Grafik MP** | Üçüncü Taraf Kütüphane | `pyg-team/pytorch_geometric` (`MIT`) + `torch 2.11.0+cpu` (`BSD-3-Clause`) | Çekirdek PyG: `MIT` (`pyg-lib` opsiyonel uzantıları ayrı incelenmeli) | Evet (Saf MIT çekirdek) | Evet | Evet | Yok (Saf MIT çekirdek) | Evet (`LICENSE` bildirimi) | İsteğe bağlı `pyg-lib` / `torch-scatter` derlemeleri ayrı lisans kontrolü gerektirir | Yok | Evet (CPU üzerinde yerel) | Yok | `UYGUN ADAY` |
| **10** | **Pyro Olasılıksal Programlama & Bayesçi OED/EIG** | Üçüncü Taraf Kütüphane | `pyro-ppl/pyro` (`Apache-2.0`) + PyTorch EIG Laboratuvarı | `Apache-2.0` | Evet | Evet | Evet | Yok | Evet (`LICENSE` ve `NOTICE`) | Yok | Yok | Evet (CPU üzerinde yerel) | Yok | `UYGUN ADAY` |
| **11** | **Playwright MCP & Tarayıcı Doğrulama Katmanı** | Üçüncü Taraf Test/Otomasyon Aracı | `microsoft/playwright-mcp` & `@playwright/test` (`1.59.1`) | `Apache-2.0` | Evet (Araç kodu) | Evet | Evet | Yok | Evet (`LICENSE` bildirimi) | **Evet:** Aracın Apache-2.0 olması, ziyaret edilen üçüncü taraf web sitelerinin ToS/telif haklarını serbest bırakmaz | Yalnızca yerel CAELUS UI ve açık izinli kaynaklar | Yerel arayüz testinde Evet | Yok | `İNCELEME GEREKTİRİR` (Dış site ToS sınırı nedeniyle) |
| **12** | **Firecrawl (`mendableai/firecrawl`)** | Üçüncü Taraf Web Kazıma Sunucusu | `firecrawl/firecrawl` (Ana Sunucu) & `firecrawl-mcp-server` | Ana Sunucu: **`GNU AGPL-3.0`** · Bulut: Ücretli API | **Kısıtlı (AGPL-3.0 / Ücretli API)** | **Hayır (AGPL-3.0 ağ copyleft)** | **Hayır (AGPL-3.0 kaynak açma yükümlülüğü)** | **Evet (`AGPL-3.0` tam kaynak kodu açma yükümlülüğü)** | Evet | Taranan web sitelerinin telif/ToS riski | Belirsiz | Bulut API çevrim dışı çalışmaz | Ücretli kredi/kota ve sağlayıcı kilitlenmesi | **`TİCARİ PAKET DIŞINDA`** |

---

## 3. Firecrawl Kararı ve Uygulanan Ticari Olarak Uygun Alternatif

1. **Neden `TİCARİ PAKET DIŞINDA`?**
   - `firecrawl-mcp-server` istemci sarmalayıcısı `MIT` lisanslı olsa da, gerçek dönüştürme işini yapan `firecrawl` arka uç sunucusu **`GNU AGPL-3.0`** lisanslıdır veya ücretli `api.firecrawl.dev` bulut aboneliği gerektirir.
   - Kapalı kaynaklı ve müşteri tesisine (on-prem) kurulabilir bir ticari üründe AGPL-3.0 arka uç paketlemek veya zorunlu ücretli bulut API’sine bağlanmak CAELUS’un ticari bağımsızlık kurallarına aykırıdır.
2. **Uygulanan Onaylı Alternatif (`evaluateFirecrawlAndRunApprovedAlternative`):**
   - **Yerel Belge Dönüşümü:** `convertLocalDocumentToMarkdownAdapter` (`CAELUS ÖZGÜN` / `MIT` MarkItDown mimarisi) ile yerel HTML/CSV/TXT/MD raporları hiçbir dış ağ çağrısı yapmadan sayfa ve tablo yapısını koruyarak Markdown’a dönüştürülür.
   - **Açık Lisanslı Bilimsel/Kamu Kaynakları:** `queryOpenAlexScientificAdapter` (`CC0-1.0` üstveri) ve USGS / Open-Meteo ERA5 açık veri adaptörleri kullanılır.
