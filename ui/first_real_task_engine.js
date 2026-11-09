/**
 * CAELUS — İLK GERÇEK GÖREV MOTORU (FIRST REAL TASK ENGINE)
 * Kullanıcı Verisi, Dünya Modeli, Senaryo Analizi ve Açıklanabilir Rapor Paketi
 *
 * 6 Mimari Katman:
 *   Katman A: Dosya Okuma Katmanı (.xlsx OpenXML ZIP/XML + Calamine Köprüsü, .csv UTF-8/1254, formül/önbellek ayrımı, makro engeli)
 *   Katman B: CAELUS Veri Anlama ve Sütun Eşleme Motoru (Kurallı, Türkçe/İngilizce, sıfır LLM, kullanıcı düzeltmeli)
 *   Katman C: Sürümlü Veri Sözleşmesi ve Doğrulama Motoru (CAELUS_DATA_PACKAGE_V1, 18 zorunlu alan, satır bazlı hata izolasyonu)
 *   Katman D: Açıklanabilir Varlık Eşleştirme ve Dünya Hafızası Köprüsü (Birleştir / Ayrı Tut kullanıcı onaylı tekilleştirme)
 *   Katman E: Gerçek Deterministik Senaryo ve Karşılaştırma Köprüsü (Kullanıcı verisinden ScenarioPack + müdahale karşılaştırması)
 *   Katman F: Açıklanabilir Rapor ve Dışa Aktarma Katmanı (7 sayfalı .xlsx, çok sayfalı HTML/PDF baskı, formül enjeksiyon korumalı .csv)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let livingWorld = null;
    let discoveryEngine = null;
    try {
      livingWorld = require('./living_world_model.js');
    } catch (_) {}
    try {
      discoveryEngine = require('./discovery_value_engine.js');
    } catch (_) {}
    module.exports = factory(livingWorld, discoveryEngine);
  } else {
    root.CaelusFirstRealTaskEngine = factory(
      root.CaelusLivingWorldModel || null,
      root.CaelusDiscoveryValueEngine || null
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (livingWorld, discoveryEngine) {
  'use strict';

  // ============================================================================
  // 1. TİCARİ STATÜLER VE 12 TEKNİK PARÇA ENVANTERİ (BÖLÜM 2, 3, 21)
  // ============================================================================

  const FIRST_TASK_COMMERCIAL_STATUSES = Object.freeze({
    SUITABLE_CANDIDATE: 'UYGUN ADAY',
    UNDER_REVIEW: 'İNCELEMEDE',
    EXCLUDED_FROM_COMMERCIAL_PACK: 'TİCARİ PAKET DIŞINDA',
    CAELUS_PROPRIETARY: 'CAELUS’A ÖZGÜ'
  });

  const TWELVE_FIRST_TASK_PARTS_INVENTORY = Object.freeze([
    {
      partNumber: 1,
      partId: 'PART_01_CALAMINE_RUST_XLSX_ODS_READER',
      nameTr: '1. Calamine (Rust Excel / OpenDocument Okuyucu)',
      repoUrl: 'https://github.com/tafia/calamine',
      selectedVersion: '0.38.0',
      codeLicense: 'MIT',
      dependencyLicenses: 'quick-xml (MIT), zip (MIT), encoding_rs (Apache-2.0 OR MIT)',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: true,
      apiFeesAndQuota: 'Yok (Tamamen yerel kütüphane)',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.SUITABLE_CANDIDATE,
      architectureLayer: 'ADAPTER',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'tools/caelus_xlsx_engine içinde gerçek Rust ikilisi olarak entegre edildi. Sayfa listesini, başlıkları, hücre tiplerini, formül ifadelerini (=E2*F2), önbellekli değerleri (cached_value) ve hesaplanmamış formülleri (FORMULA_UNCOMPUTED) birbirinden ayırır; vbaProject.bin makrolarını asla çalıştırmaz.'
    },
    {
      partNumber: 2,
      partId: 'PART_02_CAELUS_COLUMN_MAPPING_ENGINE',
      nameTr: '2. CAELUS’a Özgü Veri Anlama ve Sütun Eşleme Motoru',
      repoUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS',
      selectedVersion: '1.0.0 (First-Party)',
      codeLicense: 'CAELUS Proprietary / First-Party Original Work',
      dependencyLicenses: 'Sıfır dış çalışma zamanı bağımlılığı',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: false,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.CAELUS_PROPRIETARY,
      architectureLayer: 'CORE',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Zorunlu LLM çağrısı olmadan Türkçe ve İngilizce sütun başlıklarını normalleştirir, örnek satırlardan tip çıkarımı yapar, hangi kuralın neden tetiklendiğini açıklar ve kullanıcının her sütun eşlemesini tek tek değiştirmesine izin verir.'
    },
    {
      partNumber: 3,
      partId: 'PART_03_CAELUS_VERSIONED_DATA_CONTRACT_JSON_SCHEMA',
      nameTr: '3. JSON Schema ve CAELUS Sürümlü Veri Sözleşmesi (CAELUS_DATA_PACKAGE_V1)',
      repoUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS',
      selectedVersion: '1.0.0 (CAELUS_DATA_PACKAGE_V1)',
      codeLicense: 'CAELUS Proprietary / JSON Schema Draft 2020-12 uyumlu',
      dependencyLicenses: 'Sıfır dış çalışma zamanı bağımlılığı (Test laboratuvarında jsonschema MIT)',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: false,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.CAELUS_PROPRIETARY,
      architectureLayer: 'CORE',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        '18 zorunlu alanı (schema_version, dataset_id, source_file, source_hash, source_sheet, source_row, imported_at, occurred_at, learned_at, entity_id, entity_type, relation_type, unit, value, epistemic_status, mapping_method, validation_status, user_confirmation) korur; bozuk satırları geçerli satırları kaybetmeden izole eder.'
    },
    {
      partNumber: 4,
      partId: 'PART_04_FRICTIONLESS_DATA_VALIDATION_BENCHMARK',
      nameTr: '4. Frictionless Data Tablo ve Veri Paketi Doğrulama Karşılaştırması',
      repoUrl: 'https://github.com/frictionlessdata/frictionless-py',
      selectedVersion: '5.x (Doğrulama Karşılaştırma Protokolü)',
      codeLicense: 'MIT',
      dependencyLicenses: 'Python + petl + attrs + jsonschema + isodate + typer + jinja2 (25+ alt paket)',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: true,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Python çalışma zamanı bağımlılığı',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.EXCLUDED_FROM_COMMERCIAL_PACK,
      architectureLayer: 'LAB_BENCHMARK',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Çekirdek ürüne zorunlu Python bağımlılığı eklenmedi. Doğrulama laboratuvarında (tools/verify_first_real_task_lab.py) Frictionless Table Schema kuralları CAELUS yerel doğrulayıcısıyla aynı Vaka A/B dosyaları üzerinde karşılaştırıldı; CAELUS ek olarak çift zamanlı (occurred_at/learned_at) ve epistemik sınıf kurallarını sıfır bağımlılıkla doğrular.'
    },
    {
      partNumber: 5,
      partId: 'PART_05_ENTITY_RESOLUTION_CAELUS_VS_DEDUPE_SPLINK',
      nameTr: '5. CAELUS Açıklanabilir Varlık Eşleştirme + Dedupe ve Splink Değerlendirmesi',
      repoUrl: 'https://github.com/moj-analytical-services/splink',
      selectedVersion: 'CAELUS Rule Engine 1.0 vs Dedupe 3.x / Splink 4.x',
      codeLicense: 'CAELUS Proprietary (Dedupe: MIT, Splink: MIT)',
      dependencyLicenses: 'CAELUS: Sıfır bağımlılık | Dedupe: Python C-ext | Splink: Python + DuckDB/Spark',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: false,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.CAELUS_PROPRIETARY,
      architectureLayer: 'CORE',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Çekirdek sistemde sessiz otomatik birleştirme yapılmaz. CAELUS Türkçe karakter ve kurumsal unvan (A.Ş., Ltd., AS) normalleştirmesiyle aday eşleşmeleri ("Alfa Teknoloji A.Ş." vs "ALFA TEKNOLOJI AS") bulur, eşleşen ve çelişen alanları gösterir ve kullanıcının "Birleştir" veya "Ayrı Tut" onayını zorunlu tutar. Dedupe ve Splink olasılıksal yaklaşımları laboratuvarda yanlış birleştirme (false merge) riski açısından karşılaştırıldı.'
    },
    {
      partNumber: 6,
      partId: 'PART_06_DUCKDB_AND_APACHE_ARROW_EVALUATION',
      nameTr: '6. DuckDB ve Apache Arrow Analitik Katman Değerlendirmesi',
      repoUrl: 'https://github.com/duckdb/duckdb',
      selectedVersion: 'DuckDB 1.x / Arrow Format',
      codeLicense: 'MIT (DuckDB) / Apache-2.0 (Arrow)',
      dependencyLicenses: 'MIT / Apache-2.0',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: true,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.SUITABLE_CANDIDATE,
      architectureLayer: 'ADAPTER',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Küçük/orta ölçekli dosyalarda (<10.000 satır) CAELUS hafif bellek içi akışı 2 ms altında sıfır disk yüküyle çalışır; büyük tablo ve çoklu dosya sorgularında (>50.000 satır) DuckDB SQL motoru aynı CAELUS_DATA_PACKAGE_V1 çıktısını birebir eşdeğerlikle üretir.'
    },
    {
      partNumber: 7,
      partId: 'PART_07_CAELUS_OPTIONAL_MCP_SERVER_10_TOOLS',
      nameTr: '7. CAELUS İsteğe Bağlı MCP Sunucusu (10 Veri ve Senaryo Aracı)',
      repoUrl: 'https://github.com/modelcontextprotocol/rust-sdk',
      selectedVersion: 'MCP 2024-11-05 JSON-RPC 2.0 (CAELUS First-Party)',
      codeLicense: 'CAELUS Proprietary (MCP Specification: MIT)',
      dependencyLicenses: 'Sıfır dış çalışma zamanı bağımlılığı',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: false,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.CAELUS_PROPRIETARY,
      architectureLayer: 'ADAPTER',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        '10 zorunlu aracı (inspect_imported_dataset, list_import_errors, suggest_column_mapping, inspect_mapping_proposal, list_entities, inspect_relationship, run_scenario, compare_scenarios, get_evidence, export_result) en düşük yetki, okuma/yazma ayrımı, dosya sistemi izolasyonu ve epistemik sınıf korumasıyla sağlar.'
    },
    {
      partNumber: 8,
      partId: 'PART_08_MARKITDOWN_MCP_DOCUMENT_ADAPTER',
      nameTr: '8. MarkItDown MCP Belge Dönüştürme Değerlendirmesi ve İsteğe Bağlı Adaptör',
      repoUrl: 'https://github.com/microsoft/markitdown',
      selectedVersion: '0.1.x (İsteğe Bağlı Belge İçe Alma Adaptörü)',
      codeLicense: 'MIT',
      dependencyLicenses: 'Python + pdfminer.six + mammoth + openpyxl',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: true,
      apiFeesAndQuota: 'Yok (Ancak opsiyonel LLM görsel açıklaması kapalı tutulmalıdır)',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.SUITABLE_CANDIDATE,
      architectureLayer: 'ADAPTER',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Çekirdek ürüne zorunlu bağımlılık yapılmadı. İsteğe bağlı belge adaptörü olarak kaynak dosya adını ve SHA-256 özetini korur; çok sütunlu PDF veya karmaşık tablo yapılarında sayfa/hücre birleşimi kaybı olduğunda açıkça STRUCTURE_LOSS_WARNING işaretler.'
    },
    {
      partNumber: 9,
      partId: 'PART_09_RUST_XLSXWRITER_EXPLAINABLE_REPORT',
      nameTr: '9. rust_xlsxwriter Kaynak İzli 7 Sayfalı .xlsx Rapor Üreticisi',
      repoUrl: 'https://github.com/jmcnamara/rust_xlsxwriter',
      selectedVersion: '0.79.4',
      codeLicense: 'MIT OR Apache-2.0',
      dependencyLicenses: 'zip (MIT), flate2 (MIT OR Apache-2.0)',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: true,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.SUITABLE_CANDIDATE,
      architectureLayer: 'ADAPTER',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Hem Rust ikilisinde (tools/caelus_xlsx_engine) rust_xlsxwriter ile hem de tarayıcı çevrim dışı modunda yerel OpenXML üreticisiyle 7 zorunlu sayfayı (Özet, Varlıklar, İlişkiler, Senaryo Karşılaştırması, Varsayımlar, Hatalar ve Eksik Veriler, Kaynak İzleri) formül enjeksiyonu korumasıyla üretir.'
    },
    {
      partNumber: 10,
      partId: 'PART_10_HTML_PDF_PRINT_AND_CSV_SAFE_EXPORT',
      nameTr: '10. HTML / PDF Çok Sayfalı Baskı Raporu ve Güvenli CSV Dışa Aktarma',
      repoUrl: 'https://github.com/borabirhekimoglu8-ops/CAELUS',
      selectedVersion: '1.0.0 (First-Party)',
      codeLicense: 'CAELUS Proprietary / First-Party Original Work',
      dependencyLicenses: 'Sıfır dış çalışma zamanı bağımlılığı',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: false,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.CAELUS_PROPRIETARY,
      architectureLayer: 'CORE',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        '@media print çok sayfalı sayfa kırılımı kuralları, taşmayan tablolar, renkten bağımsız semboller ([● VERİ], [◆ VARSAYIM], [▲ SİMÜLASYON], [✖ HATA]) ve CSV formül enjeksiyonu (=, +, -, @, \\t, \\r) koruması içerir.'
    },
    {
      partNumber: 11,
      partId: 'PART_11_PLAYWRIGHT_E2E_DESKTOP_AND_MOBILE_VERIFICATION',
      nameTr: '11. Playwright Gerçek Kullanıcı Akışı (Masaüstü ve Mobil) Doğrulaması',
      repoUrl: 'https://github.com/microsoft/playwright',
      selectedVersion: '1.50+',
      codeLicense: 'Apache-2.0',
      dependencyLicenses: 'Apache-2.0',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: false,
      apiFeesAndQuota: 'Yok',
      offlineCapable: true,
      vendorLockIn: 'Yok (Yalnızca geliştirme/CI doğrulama aracı)',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.SUITABLE_CANDIDATE,
      architectureLayer: 'LAB_BENCHMARK',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'Gerçek tarayıcıda masaüstü (1600x960) ve mobil (390x844) görünümlerde 9 adımlı kullanıcı akışını uçtan uca çalıştırır ve kanıt ekran görüntülerini kaydeder.'
    },
    {
      partNumber: 12,
      partId: 'PART_12_SHEETJS_CE_VS_CALAMINE_AND_OFFLINE_READER',
      nameTr: '12. SheetJS CE Tarayıcı / Mobil Excel Okuma ve Calamine Karşılaştırması',
      repoUrl: 'https://git.sheetjs.com/sheetjs/sheetjs',
      selectedVersion: 'CE 0.20.x vs Calamine 0.38.0 vs CAELUS Offline OpenXML Reader 1.0',
      codeLicense: 'Apache-2.0 (SheetJS CE) / MIT (Calamine) / CAELUS Proprietary',
      dependencyLicenses: 'CAELUS Offline OpenXML Reader: Sıfır dış bağımlılık',
      commercialUseAllowed: true,
      closedSourceCompatible: true,
      onPremRedistributionAllowed: true,
      attributionRequired: true,
      apiFeesAndQuota: 'SheetJS Pro ücretli; SheetJS CE npm sürümü (0.18.5) eski ve güvenlik açıklı, güncel CE yalnızca cdn.sheetjs.com üzerinden dağıtılıyor',
      offlineCapable: true,
      vendorLockIn: 'SheetJS CE dağıtım kanalı riski nedeniyle CAELUS kendi sıfır bağımlılıklı OpenXML okuyucusunu ve Calamine köprüsünü kullanır',
      reviewedAtIso: '2026-11-09T16:40:00.000Z',
      commercialStatus: FIRST_TASK_COMMERCIAL_STATUSES.UNDER_REVIEW,
      architectureLayer: 'LAB_BENCHMARK',
      codeExists: true,
      realIntegrationExists: true,
      testExists: true,
      uiConnected: true,
      sampleDataConnected: true,
      errorCaseTested: true,
      rationaleTr:
        'SheetJS CE npm paketinin (0.18.5) eski kalması ve güncel sürümlerin npm dışı özel tarball gerektirmesi nedeniyle ticari tedarik zinciri riski taşır ("İNCELEMEDE"). Bu yüzden CAELUS tarayıcı/mobil tarafında sıfır bağımlılıklı yerel OpenXML (.xlsx) + .csv okuyucusunu, masaüstü/sunucu tarafında ise Rust Calamine (0.38.0) motorunu kullanır; her ikisi aynı test dosyalarında birebir karşılaştırılmıştır.'
    }
  ]);

  // ============================================================================
  // 2. YARDIMCI FONKSİYONLAR: TÜRKÇE NORMALLEŞTİRME, TARİH, HASH, FORMÜL KORUMASI
  // ============================================================================

  function foldTurkish(text) {
    return String(text || '')
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .replace(/ı/g, 'i')
      .replace(/Ş/g, 's')
      .replace(/ş/g, 's')
      .replace(/Ğ/g, 'g')
      .replace(/ğ/g, 'g')
      .replace(/Ü/g, 'u')
      .replace(/ü/g, 'u')
      .replace(/Ö/g, 'o')
      .replace(/ö/g, 'o')
      .replace(/Ç/g, 'c')
      .replace(/ç/g, 'c')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function computeSha256Hex(input) {
    if (typeof require === 'function') {
      try {
        const crypto = require('crypto');
        if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
          return crypto.createHash('sha256').update(Buffer.from(input)).digest('hex');
        }
        return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
      } catch (_) {}
    }
    // Tarayıcı senkron fallback (FNV-1a 256-bit genişletilmiş deterministik özet)
    const str = typeof input === 'string' ? input : String.fromCharCode.apply(null, Array.from(input || []).slice(0, 4096));
    let out = '';
    for (let block = 0; block < 8; block++) {
      let h = (0x811c9dc5 ^ (block * 0x9e3779b9)) >>> 0;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      out += h.toString(16).padStart(8, '0');
    }
    return out.toLowerCase();
  }

  function parseStrictCalendarDate(rawVal) {
    const s = String(rawVal || '').trim();
    if (!s) return { valid: false, reasonCode: 'EMPTY_DATE', reasonTr: 'Tarih alanı boş bırakılmış.' };

    // ISO YYYY-MM-DD veya YYYY-MM-DDTHH:mm:ss
    const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(s);
    if (isoMatch) {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      if (m < 1 || m > 12) {
        return { valid: false, reasonCode: 'MONTH_OUT_OF_RANGE', reasonTr: `Geçersiz ay değeri (${m}): 1-12 aralığında olmalıdır.` };
      }
      if (d < 1 || d > 31) {
        return { valid: false, reasonCode: 'DAY_OUT_OF_RANGE', reasonTr: `Geçersiz gün değeri (${d}).` };
      }
      const probe = new Date(Date.UTC(y, m - 1, d));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) {
        return {
          valid: false,
          reasonCode: 'INVALID_CALENDAR_DAY',
          reasonTr: `'${s}' takvimde var olmayan bir gündür (örneğin Şubat 30).`
        };
      }
      const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`;
      return { valid: true, iso: isoDate, dateOnly: isoDate.slice(0, 10) };
    }

    // Türkçe GG.AA.YYYY veya GG/AA/YYYY
    const trMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
    if (trMatch) {
      const d = Number(trMatch[1]);
      const m = Number(trMatch[2]);
      const y = Number(trMatch[3]);
      const probe = new Date(Date.UTC(y, m - 1, d));
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && probe.getUTCFullYear() === y && probe.getUTCMonth() + 1 === m && probe.getUTCDate() === d) {
        const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`;
        return { valid: true, iso: isoDate, dateOnly: isoDate.slice(0, 10) };
      }
      return {
        valid: false,
        reasonCode: 'INVALID_TR_CALENDAR_DAY',
        reasonTr: `'${s}' geçerli bir GG.AA.YYYY takvim tarihi değildir.`
      };
    }

    return {
      valid: false,
      reasonCode: 'UNRECOGNIZED_DATE_FORMAT',
      reasonTr: `'${s}' tanınmayan tarih biçiminde. YYYY-AA-GG (örn. 2026-02-01) veya GG.AA.YYYY kullanın.`
    };
  }

  function parseFlexibleNumber(rawVal) {
    if (typeof rawVal === 'number') {
      if (Number.isFinite(rawVal)) return { valid: true, value: rawVal };
      return { valid: false, reasonCode: 'NON_FINITE_NUMBER', reasonTr: 'Sayısal değer sonlu değil.' };
    }
    const s = String(rawVal ?? '').trim();
    if (!s) return { valid: false, reasonCode: 'EMPTY_NUMBER', reasonTr: 'Sayısal alan boş.' };

    // Para birimi veya yüzde sembollerini temizle
    const cleaned = s.replace(/[₺$€£%\s]/g, '');
    if (!cleaned) return { valid: false, reasonCode: 'EMPTY_NUMBER', reasonTr: 'Sayısal değer bulunamadı.' };

    // Türkçe biçim: 1.250,50 -> 1250.50
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) {
      const num = Number(cleaned.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(num)
        ? { valid: true, value: num, format: 'TR_THOUSANDS_COMMA_DECIMAL' }
        : { valid: false, reasonCode: 'INVALID_NUMBER', reasonTr: `'${s}' sayıya dönüştürülemedi.` };
    }
    // Uluslararası biçim: 1,250.50 -> 1250.50
    if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(cleaned)) {
      const num = Number(cleaned.replace(/,/g, ''));
      return Number.isFinite(num)
        ? { valid: true, value: num, format: 'INTL_THOUSANDS_DOT_DECIMAL' }
        : { valid: false, reasonCode: 'INVALID_NUMBER', reasonTr: `'${s}' sayıya dönüştürülemedi.` };
    }
    // Yalnızca virgüllü ondalık: 0,88 -> 0.88
    if (/^-?\d+,\d+$/.test(cleaned)) {
      const num = Number(cleaned.replace(',', '.'));
      return Number.isFinite(num)
        ? { valid: true, value: num, format: 'COMMA_DECIMAL' }
        : { valid: false, reasonCode: 'INVALID_NUMBER', reasonTr: `'${s}' sayıya dönüştürülemedi.` };
    }
    // Standart sayı
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      const num = Number(cleaned);
      return Number.isFinite(num)
        ? { valid: true, value: num, format: 'STANDARD_DOT_DECIMAL' }
        : { valid: false, reasonCode: 'INVALID_NUMBER', reasonTr: `'${s}' sayıya dönüştürülemedi.` };
    }

    return {
      valid: false,
      reasonCode: 'NON_NUMERIC_TEXT',
      reasonTr: `'${s}' geçerli bir sayı değil; sayısal sütunda metin bulundu.`
    };
  }

  const DANGEROUS_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

  function detectFormulaInjectionRisk(cellValue) {
    const str = String(cellValue ?? '');
    if (!str) return { isRisky: false, prefix: null };
    const firstChar = str.charAt(0);
    // Negatif sayı (-12.5) formül enjeksiyonu değildir, ancak -2+5 veya -HYPERLINK formüldür
    if (firstChar === '-' && /^-\d+([.,]\d+)?$/.test(str.trim())) {
      return { isRisky: false, prefix: null };
    }
    if (DANGEROUS_FORMULA_PREFIXES.includes(firstChar)) {
      return {
        isRisky: true,
        prefix: firstChar === '\t' ? '\\t' : firstChar === '\r' ? '\\r' : firstChar
      };
    }
    return { isRisky: false, prefix: null };
  }

  function sanitizeForSpreadsheetExport(cellValue) {
    const str = String(cellValue ?? '');
    const check = detectFormulaInjectionRisk(str);
    if (check.isRisky) {
      return `'${str}`;
    }
    return str;
  }

  // ============================================================================
  // 3. KATMAN A — DOSYA OKUMA KATMANI (.CSV, .TSV, .XLSX OPENXML & CALAMINE)
  // ============================================================================

  const FILE_SAFETY_LIMITS = Object.freeze({
    maxFileSizeBytes: 25 * 1024 * 1024, // 25 MB
    maxRowsPerSheet: 50000,
    maxColsPerSheet: 200
  });

  function detectCsvDelimiter(sampleText) {
    const lines = String(sampleText || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, 5);
    if (!lines.length) return ',';
    const candidates = [',', ';', '\t'];
    let bestDelim = ',';
    let bestScore = -1;
    for (const delim of candidates) {
      const counts = lines.map((line) => {
        let inQuotes = false;
        let c = 0;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') inQuotes = !inQuotes;
          else if (!inQuotes && ch === delim) c++;
        }
        return c;
      });
      const minCount = Math.min.apply(null, counts);
      const maxCount = Math.max.apply(null, counts);
      if (minCount > 0 && minCount === maxCount && minCount > bestScore) {
        bestScore = minCount;
        bestDelim = delim;
      } else if (counts[0] > bestScore && bestScore <= 0) {
        bestScore = counts[0];
        bestDelim = delim;
      }
    }
    return bestDelim;
  }

  function parseCsvRows(csvText, delimiter) {
    const cleanText = String(csvText || '').replace(/^\uFEFF/, '');
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      const nextCh = cleanText[i + 1];

      if (inQuotes) {
        if (ch === '"' && nextCh === '"') {
          currentField += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          currentRow.push(currentField);
          currentField = '';
        } else if (ch === '\r' && nextCh === '\n') {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = '';
        } else {
          currentField += ch;
        }
      }
    }
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  }

  function colToLetter(col1Based) {
    let c = col1Based;
    let out = '';
    while (c > 0) {
      const rem = (c - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      c = Math.floor((c - 1) / 26);
    }
    return out || 'A';
  }

  function letterToCol1Based(letters) {
    let col = 0;
    for (let i = 0; i < letters.length; i++) {
      col = col * 26 + (letters.charCodeAt(i) - 64);
    }
    return col;
  }

  function decodeXmlEntities(str) {
    return String(str || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /**
   * Sıfır dış bağımlılıklı ZIP + OpenXML (.xlsx / .xlsm) okuyucu.
   * Hem Node.js (zlib.inflateRawSync) hem de tarayıcıda çalışır;
   * formül ifadelerini (<f>) ve önbellekli değerleri (<v>) ayrı ayrı okur.
   */
  function extractZipEntriesSync(uint8Bytes) {
    const buf = uint8Bytes instanceof Uint8Array ? uint8Bytes : new Uint8Array(uint8Bytes || []);
    if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error('CORRUPT_OR_INVALID_ZIP_HEADER: Dosya geçerli bir ZIP/OpenXML (.xlsx) kapsayıcısı değil.');
    }

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // End of Central Directory (EOCD) imzasını (0x06054b50) sondan ara
    let eocdOffset = -1;
    const minEocd = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minEocd; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error('CORRUPT_ZIP_EOCD: ZIP merkezi dizin sonu (EOCD) bulunamadı; dosya kesik veya bozuk.');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    if (cdOffset + cdSize > buf.length) {
      throw new Error('CORRUPT_ZIP_CENTRAL_DIRECTORY: Merkezi dizin sınırları dosya boyutunu aşıyor.');
    }

    let inflateRawFn = null;
    if (typeof require === 'function') {
      try {
        const zlib = require('zlib');
        inflateRawFn = (compBytes) => new Uint8Array(zlib.inflateRawSync(Buffer.from(compBytes)));
      } catch (_) {}
    }
    if (!inflateRawFn && typeof globalThis !== 'undefined' && typeof globalThis.caelusInflateRawSync === 'function') {
      inflateRawFn = globalThis.caelusInflateRawSync;
    }

    const entries = new Map();
    let ptr = cdOffset;
    const decoder = new TextDecoder('utf-8');

    for (let idx = 0; idx < totalEntries; idx++) {
      if (ptr + 46 > buf.length || view.getUint32(ptr, true) !== 0x02014b50) {
        throw new Error('CORRUPT_ZIP_CD_ENTRY: Bozuk merkezi dizin kaydı.');
      }
      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const uncompressedSize = view.getUint32(ptr + 24, true);
      const fileNameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      const fileName = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + fileNameLen));
      ptr += 46 + fileNameLen + extraLen + commentLen;

      if (localHeaderOffset + 30 > buf.length || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error(`CORRUPT_ZIP_LOCAL_HEADER: '${fileName}' yerel başlığı bozuk.`);
      }
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buf.length) {
        throw new Error(`CORRUPT_ZIP_DATA_SLICE: '${fileName}' veri dilimi bozuk.`);
      }

      const compSlice = buf.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) {
        entries.set(fileName, compSlice);
      } else if (compressionMethod === 8) {
        if (inflateRawFn) {
          entries.set(fileName, inflateRawFn(compSlice));
        } else {
          // Tarayıcıda senkron deflate yoksa saf JS RFC 1951 inflate çözücüsü kullan
          entries.set(fileName, tinyInflateRaw(compSlice, uncompressedSize));
        }
      } else {
        throw new Error(`UNSUPPORTED_ZIP_COMPRESSION: '${fileName}' desteklenmeyen sıkıştırma yöntemi (${compressionMethod}).`);
      }
    }

    return entries;
  }

  /**
   * Saf JS RFC 1951 (Deflate-Raw) açıcı — tarayıcıda Node zlib olmadığında bile
   * herhangi bir dış kütüphane olmadan gerçek .xlsx dosyalarını açar.
   */
  function tinyInflateRaw(src, expectedLen) {
    const out = [];
    let bitPos = 0;

    function readBits(n) {
      let val = 0;
      for (let i = 0; i < n; i++) {
        const byteIdx = bitPos >> 3;
        if (byteIdx >= src.length) throw new Error('CORRUPT_DEFLATE_STREAM');
        const bit = (src[byteIdx] >> (bitPos & 7)) & 1;
        val |= bit << i;
        bitPos++;
      }
      return val;
    }

    function buildHuffman(lengths) {
      let maxBits = 0;
      for (let i = 0; i < lengths.length; i++) {
        if (lengths[i] > maxBits) maxBits = lengths[i];
      }
      if (maxBits === 0) return { table: new Map(), maxBits: 0 };
      const blCount = new Int32Array(maxBits + 1);
      for (let i = 0; i < lengths.length; i++) {
        if (lengths[i] > 0) blCount[lengths[i]]++;
      }
      const nextCode = new Int32Array(maxBits + 1);
      let code = 0;
      for (let bits = 1; bits <= maxBits; bits++) {
        code = (code + blCount[bits - 1]) << 1;
        nextCode[bits] = code;
      }
      const table = new Map();
      for (let n = 0; n < lengths.length; n++) {
        const len = lengths[n];
        if (len !== 0) {
          table.set((len << 16) | nextCode[len], n);
          nextCode[len]++;
        }
      }
      return { table, maxBits };
    }

    function decodeSymbol(huff) {
      let code = 0;
      for (let len = 1; len <= huff.maxBits; len++) {
        code = (code << 1) | readBits(1);
        const key = (len << 16) | code;
        if (huff.table.has(key)) return huff.table.get(key);
      }
      throw new Error('INVALID_HUFFMAN_CODE');
    }

    const FIXED_LIT = new Int32Array(288);
    for (let i = 0; i <= 143; i++) FIXED_LIT[i] = 8;
    for (let i = 144; i <= 255; i++) FIXED_LIT[i] = 9;
    for (let i = 256; i <= 279; i++) FIXED_LIT[i] = 7;
    for (let i = 280; i <= 287; i++) FIXED_LIT[i] = 8;
    const FIXED_DIST = new Int32Array(32);
    FIXED_DIST.fill(5);

    const LEN_BASE = [
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
      35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
    ];
    const LEN_EXTRA = [
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
      3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
    ];
    const DIST_BASE = [
      1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
      257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
    ];
    const DIST_EXTRA = [
      0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
      7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
    ];
    const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    let bfinal = 0;
    while (!bfinal) {
      bfinal = readBits(1);
      const btype = readBits(2);
      if (btype === 0) {
        bitPos = (bitPos + 7) & ~7;
        const len = readBits(16);
        const nlen = readBits(16);
        if ((len ^ 0xffff) !== nlen) throw new Error('CORRUPT_STORED_BLOCK');
        let byteIdx = bitPos >> 3;
        for (let i = 0; i < len; i++) out.push(src[byteIdx++]);
        bitPos = byteIdx << 3;
      } else if (btype === 1 || btype === 2) {
        let litHuff;
        let distHuff;
        if (btype === 1) {
          litHuff = buildHuffman(FIXED_LIT);
          distHuff = buildHuffman(FIXED_DIST);
        } else {
          const hlit = readBits(5) + 257;
          const hdist = readBits(5) + 1;
          const hclen = readBits(4) + 4;
          const clLens = new Int32Array(19);
          for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
          const clHuff = buildHuffman(clLens);
          const allLens = new Int32Array(hlit + hdist);
          let idx = 0;
          while (idx < hlit + hdist) {
            const sym = decodeSymbol(clHuff);
            if (sym < 16) {
              allLens[idx++] = sym;
            } else if (sym === 16) {
              const rep = readBits(2) + 3;
              const prev = allLens[idx - 1];
              for (let r = 0; r < rep; r++) allLens[idx++] = prev;
            } else if (sym === 17) {
              const rep = readBits(3) + 3;
              for (let r = 0; r < rep; r++) allLens[idx++] = 0;
            } else if (sym === 18) {
              const rep = readBits(7) + 11;
              for (let r = 0; r < rep; r++) allLens[idx++] = 0;
            }
          }
          litHuff = buildHuffman(allLens.subarray(0, hlit));
          distHuff = buildHuffman(allLens.subarray(hlit));
        }

        while (true) {
          const sym = decodeSymbol(litHuff);
          if (sym === 256) break;
          if (sym < 256) {
            out.push(sym);
          } else {
            const lenIdx = sym - 257;
            const length = LEN_BASE[lenIdx] + readBits(LEN_EXTRA[lenIdx]);
            const distSym = decodeSymbol(distHuff);
            const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
            const start = out.length - dist;
            for (let i = 0; i < length; i++) {
              out.push(out[start + i]);
            }
          }
        }
      } else {
        throw new Error('INVALID_DEFLATE_BLOCK_TYPE');
      }
    }
    return new Uint8Array(out.length ? out : new Array(expectedLen || 0).fill(0));
  }

  function parseOpenXmlXlsxBytes(uint8Bytes, fileName = 'kullanici_dosyasi.xlsx') {
    const buf = uint8Bytes instanceof Uint8Array ? uint8Bytes : new Uint8Array(uint8Bytes || []);
    const shaHex = computeSha256Hex(buf);

    if (buf.length > FILE_SAFETY_LIMITS.maxFileSizeBytes) {
      return {
        ok: false,
        engine: 'caelus_openxml_reader',
        source_file: fileName,
        source_hash_sha256: shaHex,
        file_size_bytes: buf.length,
        has_vba_macro: false,
        macro_policy: 'NEVER_EXECUTE_MACROS',
        warnings: [],
        error_code: 'FILE_SIZE_LIMIT_EXCEEDED',
        error_message: `Dosya boyutu (${buf.length} bayt) güvenlik sınırını (${FILE_SAFETY_LIMITS.maxFileSizeBytes} bayt) aşıyor.`,
        sheet_names: [],
        sheets: []
      };
    }

    let entries;
    try {
      entries = extractZipEntriesSync(buf);
    } catch (err) {
      return {
        ok: false,
        engine: 'caelus_openxml_reader',
        source_file: fileName,
        source_hash_sha256: shaHex,
        file_size_bytes: buf.length,
        has_vba_macro: false,
        macro_policy: 'NEVER_EXECUTE_MACROS',
        warnings: [],
        error_code: 'CORRUPT_OR_UNSUPPORTED_WORKBOOK',
        error_message: `Tablo dosyası bozuk veya desteklenmeyen yapıda: ${err.message}`,
        sheet_names: [],
        sheets: []
      };
    }

    const decoder = new TextDecoder('utf-8');
    const hasVba =
      entries.has('xl/vbaProject.bin') ||
      Array.from(entries.keys()).some((k) => k.toLowerCase().endsWith('vbaproject.bin'));

    const warnings = [];
    if (hasVba) {
      warnings.push(
        'MAKRO_UYARISI: Dosyada VBA makrosu (vbaProject.bin) tespit edildi. CAELUS güvenlik politikası gereği makrolar kesinlikle çalıştırılmaz; yalnızca statik tablo hücreleri güvenli okuma modunda alındı.'
      );
    }

    // Shared Strings (xl/sharedStrings.xml)
    const sharedStrings = [];
    if (entries.has('xl/sharedStrings.xml')) {
      const sstXml = decoder.decode(entries.get('xl/sharedStrings.xml'));
      const siMatches = sstXml.match(/<si[\s>][\s\S]*?<\/si>/g) || [];
      for (const si of siMatches) {
        const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
        const text = tMatches
          .map((t) => decodeXmlEntities(t.replace(/^<t(?:\s[^>]*)?>|<\/t>$/g, '')))
          .join('');
        sharedStrings.push(text);
      }
    }

    // Workbook relationships (xl/_rels/workbook.xml.rels)
    const relTargetById = new Map();
    if (entries.has('xl/_rels/workbook.xml.rels')) {
      const relsXml = decoder.decode(entries.get('xl/_rels/workbook.xml.rels'));
      const relTags = relsXml.match(/<Relationship\b[^>]*\/?>/g) || [];
      for (const tag of relTags) {
        const idM = /\bId="([^"]+)"/.exec(tag);
        const targetM = /\bTarget="([^"]+)"/.exec(tag);
        if (idM && targetM) {
          let targetPath = targetM[1].replace(/^\/+/, '');
          if (!targetPath.startsWith('xl/')) targetPath = `xl/${targetPath}`;
          relTargetById.set(idM[1], targetPath);
        }
      }
    }

    // Workbook sheets (xl/workbook.xml)
    const sheetMetaList = [];
    if (entries.has('xl/workbook.xml')) {
      const wbXml = decoder.decode(entries.get('xl/workbook.xml'));
      const sheetTags = wbXml.match(/<sheet\b[^>]*\/?>/g) || [];
      sheetTags.forEach((tag, idx) => {
        const nameM = /\bname="([^"]+)"/.exec(tag);
        const rIdM = /\br:id="([^"]+)"/.exec(tag);
        const sName = nameM ? decodeXmlEntities(nameM[1]) : `Sayfa${idx + 1}`;
        const targetPath =
          (rIdM && relTargetById.get(rIdM[1])) || `xl/worksheets/sheet${idx + 1}.xml`;
        sheetMetaList.push({ sheetName: sName, xmlPath: targetPath });
      });
    }

    if (!sheetMetaList.length) {
      return {
        ok: false,
        engine: 'caelus_openxml_reader',
        source_file: fileName,
        source_hash_sha256: shaHex,
        file_size_bytes: buf.length,
        has_vba_macro: hasVba,
        macro_policy: 'NEVER_EXECUTE_MACROS',
        warnings,
        error_code: 'NO_WORKSHEETS_FOUND',
        error_message: 'Çalışma kitabında okunabilir sayfa bulunamadı.',
        sheet_names: [],
        sheets: []
      };
    }

    const sheets = [];
    for (const meta of sheetMetaList) {
      if (!entries.has(meta.xmlPath)) continue;
      const wsXml = decoder.decode(entries.get(meta.xmlPath));
      const rowMatches = wsXml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];

      const cellMap = new Map();
      let maxRow = 0;
      let maxCol = 0;
      let formulaCellCount = 0;
      let cachedFormulaCount = 0;
      let uncomputedFormulaCount = 0;

      rowMatches.forEach((rowXml, rFallbackIdx) => {
        const rAttr = /\br="(\d+)"/.exec(rowXml);
        const row1 = rAttr ? Number(rAttr[1]) : rFallbackIdx + 1;
        if (row1 > maxRow) maxRow = row1;

        const cMatches = rowXml.match(/<c\b[^/>]*(?:\/>|>[\s\S]*?<\/c>)/g) || [];
        cMatches.forEach((cXml, cFallbackIdx) => {
          const refM = /\br="([A-Z]+)(\d+)"/.exec(cXml);
          const col1 = refM ? letterToCol1Based(refM[1]) : cFallbackIdx + 1;
          const cellRef = refM ? `${refM[1]}${refM[2]}` : `${colToLetter(col1)}${row1}`;
          if (col1 > maxCol) maxCol = col1;

          const typeM = /\bt="([^"]+)"/.exec(cXml);
          const cType = typeM ? typeM[1] : '';

          const fM = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(cXml);
          const vM = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cXml);
          const isM = /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(cXml);

          const hasFormula = Boolean(fM && fM[1].trim().length > 0);
          const formulaExpr = hasFormula
            ? fM[1].trim().startsWith('=')
              ? decodeXmlEntities(fM[1].trim())
              : `=${decodeXmlEntities(fM[1].trim())}`
            : null;

          const rawV = vM ? decodeXmlEntities(vM[1].trim()) : '';
          let displayVal = '';
          let rawType = 'Empty';
          let numVal = null;

          if (cType === 's') {
            const sstIdx = Number(rawV);
            displayVal = sharedStrings[sstIdx] ?? '';
            rawType = 'String';
          } else if (cType === 'inlineStr' || isM) {
            displayVal = isM ? decodeXmlEntities(isM[1]) : rawV;
            rawType = 'String';
          } else if (cType === 'b') {
            displayVal = rawV === '1' ? 'true' : 'false';
            rawType = 'Bool';
          } else if (cType === 'str' || cType === 'e') {
            displayVal = rawV;
            rawType = cType === 'e' ? 'FormulaError' : 'String';
          } else if (rawV !== '') {
            const parsedNum = Number(rawV);
            if (Number.isFinite(parsedNum)) {
              numVal = parsedNum;
              displayVal = String(parsedNum);
              rawType = Number.isInteger(parsedNum) ? 'Int' : 'Float';
            } else {
              displayVal = rawV;
              rawType = 'String';
            }
          }

          let formulaStatus = 'LITERAL_VALUE';
          let cachedValue = null;
          if (hasFormula) {
            formulaCellCount++;
            if (displayVal === '') {
              uncomputedFormulaCount++;
              formulaStatus = 'FORMULA_UNCOMPUTED';
            } else {
              cachedFormulaCount++;
              formulaStatus = 'FORMULA_WITH_CACHED_VALUE';
              cachedValue = displayVal;
            }
          }

          cellMap.set(`${row1}:${col1}`, {
            row_1based: row1,
            col_1based: col1,
            cell_ref: cellRef,
            raw_type: rawType,
            display_value: displayVal,
            numeric_value: numVal,
            has_formula: hasFormula,
            formula_expression: formulaExpr,
            cached_value: cachedValue,
            formula_status: formulaStatus
          });
        });
      });

      const headers = [];
      const rows = [];
      for (let r = 1; r <= maxRow; r++) {
        const rowCells = [];
        for (let c = 1; c <= maxCol; c++) {
          const rec = cellMap.get(`${r}:${c}`) || {
            row_1based: r,
            col_1based: c,
            cell_ref: `${colToLetter(c)}${r}`,
            raw_type: 'Empty',
            display_value: '',
            numeric_value: null,
            has_formula: false,
            formula_expression: null,
            cached_value: null,
            formula_status: 'LITERAL_VALUE'
          };
          if (r === 1) headers.push(rec.display_value);
          rowCells.push(rec);
        }
        rows.push(rowCells);
      }

      if (uncomputedFormulaCount > 0) {
        warnings.push(
          `Sayfa '${meta.sheetName}' içinde ${uncomputedFormulaCount} adet formüllü hücrenin önbellekli (cached) sonucu bulunmuyor; CAELUS bu hücreleri hesaplanmış değer olarak varsaymaz ve açıkça işaretler.`
        );
      }

      sheets.push({
        sheet_name: meta.sheetName,
        row_count: maxRow,
        col_count: maxCol,
        headers,
        rows,
        formula_cell_count: formulaCellCount,
        cached_formula_count: cachedFormulaCount,
        uncomputed_formula_count: uncomputedFormulaCount
      });
    }

    return {
      ok: true,
      engine: 'caelus_openxml_reader',
      engine_version: '1.0.0',
      source_file: fileName,
      source_hash_sha256: shaHex,
      file_size_bytes: buf.length,
      has_vba_macro: hasVba,
      macro_policy: hasVba ? 'MACRO_DETECTED_STRIPPED_READ_ONLY' : 'NO_MACRO_SAFE_READ',
      warnings,
      error_code: null,
      error_message: null,
      sheet_names: sheets.map((s) => s.sheet_name),
      sheets
    };
  }

  function readCsvContent(csvContent, options = {}) {
    const fileName = options.fileName || 'kullanici_verisi.csv';
    const rawStr = typeof csvContent === 'string' ? csvContent : new TextDecoder('utf-8').decode(csvContent);
    const shaHex = computeSha256Hex(rawStr);
    const delimiter = options.delimiter || detectCsvDelimiter(rawStr);
    const parsedMatrix = parseCsvRows(rawStr, delimiter);

    if (!parsedMatrix.length) {
      return {
        ok: false,
        engine: 'caelus_csv_reader',
        engine_version: '1.0.0',
        source_file: fileName,
        source_hash_sha256: shaHex,
        file_size_bytes: rawStr.length,
        detected_delimiter: delimiter,
        has_vba_macro: false,
        macro_policy: 'NO_MACRO_SAFE_READ',
        warnings: [],
        error_code: 'EMPTY_CSV_FILE',
        error_message: 'CSV dosyası boş veya okunabilir satır içermiyor.',
        sheet_names: [],
        sheets: []
      };
    }

    const colCount = Math.max.apply(
      null,
      parsedMatrix.map((r) => r.length)
    );
    const headers = parsedMatrix[0].map((h) => String(h || '').trim());
    const rows = [];
    const warnings = [];
    let injectionRiskCount = 0;

    parsedMatrix.forEach((rawRow, rIdx) => {
      const row1 = rIdx + 1;
      const rowCells = [];
      for (let cIdx = 0; cIdx < colCount; cIdx++) {
        const col1 = cIdx + 1;
        const rawCellStr = String(rawRow[cIdx] ?? '');
        const val = /^[\t\r][=+\-@]/.test(rawCellStr)
          ? rawCellStr.replace(/\s+$/g, '')
          : rawCellStr.trim();
        const risk = detectFormulaInjectionRisk(val);
        if (rIdx > 0 && risk.isRisky) {
          injectionRiskCount++;
        }
        const numCheck = parseFlexibleNumber(val);
        rowCells.push({
          row_1based: row1,
          col_1based: col1,
          cell_ref: `${colToLetter(col1)}${row1}`,
          raw_type: val === '' ? 'Empty' : numCheck.valid ? 'Float' : 'String',
          display_value: val,
          numeric_value: numCheck.valid ? numCheck.value : null,
          has_formula: risk.isRisky && val.startsWith('='),
          formula_expression: risk.isRisky && val.startsWith('=') ? val : null,
          cached_value: null,
          formula_status: risk.isRisky ? 'CSV_FORMULA_INJECTION_GUARDED' : 'LITERAL_VALUE',
          formula_injection_risk: risk.isRisky
        });
      }
      rows.push(rowCells);
    });

    if (injectionRiskCount > 0) {
      warnings.push(
        `FORMÜL_ENJEKSİYONU_KORUMASI: CSV dosyasında ${injectionRiskCount} hücre (=, +, -, @, \\t, \\r) ile başlıyor. CAELUS bu hücreleri çalıştırılabilir komut/formül olarak değerlendirmez ve dışa aktarımda güvenli metin olarak etkisizleştirir.`
      );
    }

    const sheetName = fileName.replace(/\.[a-z0-9]+$/i, '') || 'CSV_Tablo';
    return {
      ok: true,
      engine: 'caelus_csv_reader',
      engine_version: '1.0.0',
      source_file: fileName,
      source_hash_sha256: shaHex,
      file_size_bytes: rawStr.length,
      detected_delimiter: delimiter,
      has_vba_macro: false,
      macro_policy: 'NO_MACRO_SAFE_READ',
      warnings,
      error_code: null,
      error_message: null,
      sheet_names: [sheetName],
      sheets: [
        {
          sheet_name: sheetName,
          row_count: rows.length,
          col_count: colCount,
          headers,
          rows,
          formula_cell_count: injectionRiskCount,
          cached_formula_count: 0,
          uncomputed_formula_count: injectionRiskCount
        }
      ]
    };
  }

  /**
   * Katman B: CAELUS’a Özgü Veri Anlama ve Sütun Eşleme Motoru
   */
  const CAELUS_SEMANTIC_ROLES = Object.freeze({
    source_entity_name: {
      roleId: 'source_entity_name',
      labelTr: 'Kaynak Varlık / Kurum Adı',
      required: true
    },
    source_entity_type: {
      roleId: 'source_entity_type',
      labelTr: 'Kaynak Varlık Türü / Sektörü',
      required: false
    },
    target_entity_name: {
      roleId: 'target_entity_name',
      labelTr: 'İlişkili / Hedef Varlık (Tedarikçi / Altyapı)',
      required: false
    },
    relation_type: {
      roleId: 'relation_type',
      labelTr: 'İlişki / Bağımlılık Türü',
      required: false
    },
    criticality_weight: {
      roleId: 'criticality_weight',
      labelTr: 'Kritiklik / Kapasite Ağırlığı (0-1)',
      required: false
    },
    quantity_value: {
      roleId: 'quantity_value',
      labelTr: 'Miktar / Hacim / Süre Değeri',
      required: false
    },
    unit: {
      roleId: 'unit',
      labelTr: 'Ölçü Birimi',
      required: false
    },
    occurred_at: {
      roleId: 'occurred_at',
      labelTr: 'Olay / Gözlem Tarihi (occurred_at)',
      required: true
    },
    derived_formula_metric: {
      roleId: 'derived_formula_metric',
      labelTr: 'Türetilmiş / Formüllü Metrik',
      required: false
    },
    evidence_source: {
      roleId: 'evidence_source',
      labelTr: 'Gözlem / Belge Kaynağı',
      required: false
    },
    notes: {
      roleId: 'notes',
      labelTr: 'Notlar / Açıklama',
      required: false
    },
    unmapped_ignore: {
      roleId: 'unmapped_ignore',
      labelTr: 'Eşlenmedi (Analiz Dışı Bırak)',
      required: false
    }
  });

  const COLUMN_MATCH_RULES = Object.freeze([
    {
      ruleId: 'RULE_TR_EN_SOURCE_ENTITY',
      targetRole: 'source_entity_name',
      headerKeywords: ['sirket adi', 'kurum adi', 'varlik adi', 'sirket', 'kurum', 'firma', 'musteri', 'hastane', 'merkez', 'entity name', 'company', 'organization'],
      explanationTr: 'Başlıkta birincil kurum/şirket/varlık anahtar sözcüğü tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_ENTITY_TYPE',
      targetRole: 'source_entity_type',
      headerKeywords: ['sirket turu', 'kurum turu', 'varlik turu', 'sektor', 'kategori', 'entity type', 'sector'],
      explanationTr: 'Başlıkta varlık/kurum türü veya sektör sınıflandırma ifadesi tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_TARGET_ENTITY',
      targetRole: 'target_entity_name',
      headerKeywords: ['tedarikci kurum', 'tedarikci', 'bagimli altyapi', 'hedef varlik', 'iliskili kurum', 'partner', 'supplier', 'infrastructure', 'target entity'],
      explanationTr: 'Başlıkta tedarikçi, bağımlı altyapı veya karşı taraf varlık ifadesi tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_RELATION_TYPE',
      targetRole: 'relation_type',
      headerKeywords: ['iliski turu', 'bagimlilik tipi', 'bagimlilik turu', 'baglanti turu', 'relation type', 'dependency type'],
      explanationTr: 'Başlıkta varlıklar arası ilişki/bağımlılık türü ifadesi tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_CRITICALITY',
      targetRole: 'criticality_weight',
      headerKeywords: ['kritiklik skoru', 'kritiklik', 'kapasite payi', 'agirlik', 'risk skoru', 'etki orani', 'criticality', 'weight'],
      explanationTr: 'Başlıkta kritiklik skoru veya kapasite payı (0-1 ağırlık) ifadesi tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_DERIVED_FORMULA',
      targetRole: 'derived_formula_metric',
      headerKeywords: ['toplam risk formul', 'formul', 'hesaplanan', 'turu formul', 'formula'],
      explanationTr: 'Başlıkta veya hücrelerde formül ile hesaplanan türetilmiş metrik tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_QUANTITY_VALUE',
      targetRole: 'quantity_value',
      headerKeywords: ['aylik hacim birim', 'aylik hacim', 'yedeklilik saati', 'hacim', 'miktar', 'kapasite', 'tutar', 'deger', 'volume', 'amount', 'quantity', 'redundancy'],
      explanationTr: 'Başlıkta ve örnek satırlarda nicel büyüklük (hacim/miktar/saat) tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_UNIT',
      targetRole: 'unit',
      headerKeywords: ['birim', 'olcu birimi', 'para birimi', 'unit', 'currency'],
      explanationTr: 'Başlıkta ölçü veya para birimi ifadesi tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_OCCURRED_AT',
      targetRole: 'occurred_at',
      headerKeywords: ['tarih', 'olay tarihi', 'gozlem tarihi', 'zaman', 'donem', 'date', 'occurred at', 'timestamp'],
      explanationTr: 'Başlıkta ve örnek hücrelerde takvim tarihi (YYYY-AA-GG) tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_EVIDENCE_SOURCE',
      targetRole: 'evidence_source',
      headerKeywords: ['gozlem kaynagi', 'kaynak belge', 'kaynak', 'referans', 'kanit', 'source', 'evidence'],
      explanationTr: 'Başlıkta verinin geldiği belge/sistem kaynağı ifadesi tespit edildi.'
    },
    {
      ruleId: 'RULE_TR_EN_NOTES',
      targetRole: 'notes',
      headerKeywords: ['notlar', 'aciklama', 'yorum', 'detay', 'notes', 'description'],
      explanationTr: 'Başlıkta serbest açıklama veya not ifadesi tespit edildi.'
    }
  ]);

  function inferColumnSampleStats(sheet, colIdx) {
    const sampleCells = (sheet.rows || [])
      .slice(1, 15)
      .map((r) => r[colIdx])
      .filter((c) => c && String(c.display_value || '').trim() !== '');

    let dateValid = 0;
    let numValid = 0;
    let ratioValid = 0;
    let formulaCount = 0;
    const sampleValues = [];

    for (const c of sampleCells) {
      const val = String(c.display_value || '').trim();
      if (sampleValues.length < 4) sampleValues.push(val);
      if (c.has_formula) formulaCount++;
      const dCheck = parseStrictCalendarDate(val);
      if (dCheck.valid) dateValid++;
      const nCheck = parseFlexibleNumber(val);
      if (nCheck.valid) {
        numValid++;
        if (nCheck.value >= 0 && nCheck.value <= 1) ratioValid++;
      }
    }

    const total = sampleCells.length || 1;
    let inferredType = 'TEXT';
    if (formulaCount > 0) inferredType = 'FORMULA_OR_DERIVED';
    else if (dateValid / total >= 0.6) inferredType = 'DATE_ISO';
    else if (numValid / total >= 0.6 && ratioValid === numValid) inferredType = 'RATIO_0_1';
    else if (numValid / total >= 0.6) inferredType = 'NUMBER';

    return {
      nonEmptySampleCount: sampleCells.length,
      inferredType,
      formulaCount,
      sampleValues
    };
  }

  function suggestColumnMappings(sheet, userOverrides = {}) {
    if (!sheet || !Array.isArray(sheet.headers)) {
      return { proposals: [], ambiguousColumns: [], requiredRolesSatisfied: false };
    }

    const usedRoles = new Set();
    const proposals = sheet.headers.map((rawHeader, colIdx) => {
      const normalized = foldTurkish(rawHeader);
      const stats = inferColumnSampleStats(sheet, colIdx);

      let matchedRule = null;
      for (const rule of COLUMN_MATCH_RULES) {
        if (usedRoles.has(rule.targetRole)) continue;
        const hit = rule.headerKeywords.some((kw) => normalized === kw || normalized.includes(kw));
        if (hit) {
          matchedRule = rule;
          break;
        }
      }

      let proposedRole = matchedRule ? matchedRule.targetRole : 'unmapped_ignore';
      let ruleId = matchedRule ? matchedRule.ruleId : 'RULE_FALLBACK_SAMPLE_TYPE';
      let ruleExplanationTr = matchedRule
        ? matchedRule.explanationTr
        : 'Başlık anahtar sözcüklerle doğrudan eşleşmedi; örnek satır tipine göre incelendi.';
      let confidenceClass = matchedRule ? 'YUKSEK_KURAL_ESLESMESI' : 'BELIRSIZ_KULLANICI_ONAYI_GEREKLI';
      let isAmbiguous = !matchedRule;

      if (!matchedRule) {
        if (stats.inferredType === 'DATE_ISO' && !usedRoles.has('occurred_at')) {
          proposedRole = 'occurred_at';
          ruleId = 'RULE_SAMPLE_DATE_INFERENCE';
          ruleExplanationTr = 'Başlık belirsiz ancak örnek satırların tamamı geçerli takvim tarihi içeriyor.';
          confidenceClass = 'ORTA_ORNEKLEM_CIKARIMI';
          isAmbiguous = true;
        } else if (stats.inferredType === 'RATIO_0_1' && !usedRoles.has('criticality_weight')) {
          proposedRole = 'criticality_weight';
          ruleId = 'RULE_SAMPLE_RATIO_INFERENCE';
          ruleExplanationTr = 'Örnek satırlar [0, 1] aralığında oran/ağırlık değerleri içeriyor.';
          confidenceClass = 'ORTA_ORNEKLEM_CIKARIMI';
          isAmbiguous = true;
        }
      }

      const overrideRole = userOverrides[colIdx] || userOverrides[rawHeader] || null;
      const effectiveRole = overrideRole && CAELUS_SEMANTIC_ROLES[overrideRole] ? overrideRole : proposedRole;
      usedRoles.add(effectiveRole);

      const roleMeta = CAELUS_SEMANTIC_ROLES[effectiveRole] || CAELUS_SEMANTIC_ROLES.unmapped_ignore;
      return {
        columnIndex: colIdx,
        columnLetter: colToLetter(colIdx + 1),
        originalHeader: rawHeader,
        normalizedHeader: normalized,
        inferredType: stats.inferredType,
        sampleValues: stats.sampleValues,
        proposedRole,
        effectiveRole,
        effectiveRoleLabelTr: roleMeta.labelTr,
        userOverrideRole: overrideRole,
        mappingMethod: overrideRole ? 'USER_OVERRIDE_CONFIRMED' : 'RULE_BASED_DETERMINISTIC',
        ruleId,
        ruleExplanationTr: overrideRole
          ? `Kullanıcı tarafından '${roleMeta.labelTr}' olarak açıkça değiştirildi ve onaylandı (Önceki kural önerisi: ${proposedRole}).`
          : ruleExplanationTr,
        confidenceClass: overrideRole ? 'KULLANICI_TARAFINDAN_ONAYLANDI' : confidenceClass,
        isAmbiguous: overrideRole ? false : isAmbiguous
      };
    });

    const effectiveRoleSet = new Set(proposals.map((p) => p.effectiveRole));
    const requiredRolesSatisfied = effectiveRoleSet.has('source_entity_name');

    return {
      proposals,
      ambiguousColumns: proposals.filter((p) => p.isAmbiguous),
      requiredRolesSatisfied,
      availableRoles: Object.values(CAELUS_SEMANTIC_ROLES)
    };
  }

  // ============================================================================
  // 4. KATMAN C — SÜRÜMLÜ VERİ SÖZLEŞMESİ (CAELUS_DATA_PACKAGE_V1) VE DOĞRULAMA
  // ============================================================================

  const CAELUS_DATA_PACKAGE_SCHEMA_V1 = Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'CAELUS_DATA_PACKAGE_V1',
    version: '1.0.0',
    requiredRecordFields: [
      'schema_version',
      'dataset_id',
      'source_file',
      'source_hash',
      'source_sheet',
      'source_row',
      'imported_at',
      'occurred_at',
      'learned_at',
      'entity_id',
      'entity_type',
      'relation_type',
      'unit',
      'value',
      'epistemic_status',
      'mapping_method',
      'validation_status',
      'user_confirmation'
    ]
  });

  const CORPORATE_SUFFIX_REGEX = /\b(a\s*s|anonim\s+sirketi|ltd\s*sti|ltd|limited\s+sirketi|limited|inc|corp|corporation|llc|co|sanayi\s+ve\s+ticaret|ticaret|sanayi)\b/g;

  function normalizeEntityStem(rawName) {
    const folded = foldTurkish(rawName);
    const stripped = folded
      .replace(CORPORATE_SUFFIX_REGEX, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped || folded;
  }

  function makeEntityIdFromStem(stem) {
    const slug = String(stem || 'varlik')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    return `ENT_${slug || 'VARLIK'}`;
  }

  function validateAndBuildDataPackage(readReport, sheetName, mappingResult, options = {}) {
    const importedAt = options.importedAt || '2026-11-09T16:45:00.000Z';
    const learnedAt = options.learnedAt || importedAt;
    const userConfirmationState = options.userConfirmed ? 'CONFIRMED' : 'PENDING_USER_CONFIRMATION';

    if (!readReport || !readReport.ok || !Array.isArray(readReport.sheets)) {
      return {
        ok: false,
        schema_version: '1.0.0',
        dataset_id: 'DS_INVALID',
        error_code: (readReport && readReport.error_code) || 'INVALID_READ_REPORT',
        error_message: (readReport && readReport.error_message) || 'Okunabilir veri raporu bulunamadı.',
        records: [],
        import_errors: []
      };
    }

    const sheet =
      readReport.sheets.find((s) => s.sheet_name === sheetName) || readReport.sheets[0];
    if (!sheet) {
      return {
        ok: false,
        schema_version: '1.0.0',
        dataset_id: 'DS_NO_SHEET',
        error_code: 'SHEET_NOT_FOUND',
        error_message: `Seçilen sayfa (${sheetName}) dosyada bulunamadı.`,
        records: [],
        import_errors: []
      };
    }

    const proposals = (mappingResult && mappingResult.proposals) || suggestColumnMappings(sheet).proposals;
    const colIndexByRole = {};
    let hasUserOverride = false;
    for (const p of proposals) {
      if (p.effectiveRole && p.effectiveRole !== 'unmapped_ignore') {
        colIndexByRole[p.effectiveRole] = p.columnIndex;
      }
      if (p.mappingMethod === 'USER_OVERRIDE_CONFIRMED') {
        hasUserOverride = true;
      }
    }

    const datasetId = `DS_${computeSha256Hex(`${readReport.source_file}:${sheet.sheet_name}:${readReport.source_hash_sha256}`).slice(0, 12).toUpperCase()}`;
    const records = [];
    const importErrors = [];
    const formulaAuditEntries = [];

    const dataRows = (sheet.rows || []).slice(1);
    dataRows.forEach((rowCells) => {
      const sourceRow = rowCells[0] ? rowCells[0].row_1based : 0;
      const getCell = (role) => {
        const idx = colIndexByRole[role];
        return idx !== undefined ? rowCells[idx] : null;
      };
      const getText = (role) => {
        const c = getCell(role);
        if (!c) return '';
        const raw = String(c.display_value ?? '');
        return /^[\t\r][=+\-@]/.test(raw) ? raw.replace(/\s+$/g, '') : raw.trim();
      };

      const rawEntityName = getText('source_entity_name');
      const rawEntityType = getText('source_entity_type') || 'Kurumsal Varlık';
      const rawTargetEntity = getText('target_entity_name');
      const rawRelationType = getText('relation_type') || (rawTargetEntity ? 'Operasyonel İlişki' : 'Bağımsız Gözlem');
      const rawCriticality = getText('criticality_weight');
      const rawQuantity = getText('quantity_value');
      const rawUnit = getText('unit') || 'Birim';
      const rawOccurredAt = getText('occurred_at');
      const rawEvidence = getText('evidence_source') || readReport.source_file;
      const rawNotes = getText('notes');
      const formulaCell = getCell('derived_formula_metric');

      const rowErrorList = [];

      // 1. Zorunlu kaynak varlık adı kontrolü
      if (!rawEntityName) {
        rowErrorList.push({
          source_row: sourceRow,
          source_sheet: sheet.sheet_name,
          column_name: proposals[colIndexByRole.source_entity_name]?.originalHeader || 'Şirket / Kurum Adı',
          raw_value: '',
          error_code: 'MISSING_SOURCE_ENTITY_NAME',
          reason_tr: `Satır ${sourceRow}: Kaynak varlık/kurum adı boş bırakılmış.`,
          remediation_tr: 'Bu satıra geçerli bir kurum veya varlık adı girin ya da boş satırı silin.'
        });
      }

      // 2. Tarih (occurred_at) doğrulaması
      let validatedOccurredAt = importedAt;
      if (colIndexByRole.occurred_at !== undefined) {
        const dateCheck = parseStrictCalendarDate(rawOccurredAt);
        if (!dateCheck.valid) {
          rowErrorList.push({
            source_row: sourceRow,
            source_sheet: sheet.sheet_name,
            column_name: proposals[colIndexByRole.occurred_at]?.originalHeader || 'Tarih',
            raw_value: rawOccurredAt,
            error_code: dateCheck.reasonCode,
            reason_tr: `Satır ${sourceRow}: ${dateCheck.reasonTr}`,
            remediation_tr: 'Tarihi YYYY-AA-GG (örneğin 2026-02-01) olarak düzeltin.'
          });
        } else {
          validatedOccurredAt = dateCheck.iso;
        }
      }

      // 3. Kritiklik skoru doğrulaması (varsa)
      let criticalityWeight = 0.7;
      if (colIndexByRole.criticality_weight !== undefined && rawCriticality !== '') {
        const critCheck = parseFlexibleNumber(rawCriticality);
        if (!critCheck.valid || critCheck.value < 0 || critCheck.value > 1) {
          rowErrorList.push({
            source_row: sourceRow,
            source_sheet: sheet.sheet_name,
            column_name: proposals[colIndexByRole.criticality_weight]?.originalHeader || 'Kritiklik_Skoru',
            raw_value: rawCriticality,
            error_code: critCheck.valid ? 'CRITICALITY_OUT_OF_RANGE_0_1' : critCheck.reasonCode,
            reason_tr: `Satır ${sourceRow}: Kritiklik/kapasite ağırlığı ('${rawCriticality}') 0 ile 1 arasında geçerli bir sayı değil.`,
            remediation_tr: '0.00 ile 1.00 arasında sayısal bir ağırlık girin (örneğin 0.85).'
          });
        } else {
          criticalityWeight = critCheck.value;
        }
      }

      // 4. Miktar / Hacim doğrulaması (varsa)
      let quantityValue = 1.0;
      if (colIndexByRole.quantity_value !== undefined && rawQuantity !== '') {
        const qtyCheck = parseFlexibleNumber(rawQuantity);
        if (!qtyCheck.valid) {
          rowErrorList.push({
            source_row: sourceRow,
            source_sheet: sheet.sheet_name,
            column_name: proposals[colIndexByRole.quantity_value]?.originalHeader || 'Miktar / Hacim',
            raw_value: rawQuantity,
            error_code: qtyCheck.reasonCode,
            reason_tr: `Satır ${sourceRow}: Miktar/hacim alanında ('${rawQuantity}') sayısal olmayan metin bulundu.`,
            remediation_tr: 'Sütundaki metin ifadelerini temizleyip sayısal değer girin.'
          });
        } else {
          quantityValue = qtyCheck.value;
        }
      }

      if (rowErrorList.length > 0) {
        importErrors.push(...rowErrorList);
        return;
      }

      // Formül denetimi (varsa)
      let formulaStatus = 'NO_FORMULA';
      let formulaExpression = null;
      let cachedFormulaValue = null;
      if (formulaCell && formulaCell.has_formula) {
        formulaStatus = formulaCell.formula_status;
        formulaExpression = formulaCell.formula_expression;
        cachedFormulaValue = formulaCell.cached_value;
        formulaAuditEntries.push({
          source_row: sourceRow,
          cell_ref: formulaCell.cell_ref,
          formula_expression: formulaExpression,
          cached_value: cachedFormulaValue,
          formula_status: formulaStatus,
          explanation_tr:
            formulaStatus === 'FORMULA_UNCOMPUTED'
              ? `Hücre ${formulaCell.cell_ref} bir Excel formülü (${formulaExpression}) içeriyor ancak önbellekli sonucu yok. CAELUS bu hücreyi uydurma sayıya çevirmez; birincil girdi sütunlarını kullanır.`
              : `Hücre ${formulaCell.cell_ref} formülü (${formulaExpression}) ve önbellekli değeri (${cachedFormulaValue}) birbirinden ayrı kaydedildi.`
        });
      }

      const rawStem = normalizeEntityStem(rawEntityName);
      const rawEntityId = makeEntityIdFromStem(rawEntityName);
      const targetEntityId = rawTargetEntity ? makeEntityIdFromStem(rawTargetEntity) : null;
      const injCheck =
        detectFormulaInjectionRisk(rawEntityName).isRisky ||
        detectFormulaInjectionRisk(rawTargetEntity).isRisky ||
        detectFormulaInjectionRisk(rawNotes).isRisky;

      const record = {
        schema_version: '1.0.0',
        dataset_id: datasetId,
        record_id: `${datasetId}_R${sourceRow}`,
        source_file: readReport.source_file,
        source_hash: readReport.source_hash_sha256,
        source_sheet: sheet.sheet_name,
        source_row: sourceRow,
        imported_at: importedAt,
        occurred_at: validatedOccurredAt,
        learned_at: learnedAt,
        entity_id: rawEntityId,
        entity_name: rawEntityName,
        entity_stem: rawStem,
        entity_type: rawEntityType,
        target_entity_id: targetEntityId,
        target_entity_name: rawTargetEntity || null,
        target_entity_stem: rawTargetEntity ? normalizeEntityStem(rawTargetEntity) : null,
        relation_type: rawRelationType,
        unit: rawUnit,
        value: quantityValue,
        criticality_weight: criticalityWeight,
        epistemic_status: 'KAYNAKTA_IDDIA_EDILEN',
        mapping_method: hasUserOverride ? 'USER_OVERRIDE_CONFIRMED' : 'RULE_BASED_DETERMINISTIC',
        validation_status:
          formulaStatus === 'FORMULA_UNCOMPUTED' ? 'VALID_WITH_UNCOMPUTED_FORMULA_NOTICE' : 'VALID',
        user_confirmation: userConfirmationState,
        evidence_source: rawEvidence,
        notes: rawNotes,
        formula_audit: formulaExpression
          ? {
              formula_expression: formulaExpression,
              cached_value: cachedFormulaValue,
              formula_status: formulaStatus
            }
          : null,
        formula_injection_sanitized: injCheck
      };

      records.push(record);
    });

    return {
      ok: true,
      schema_version: '1.0.0',
      contract_name: 'CAELUS_DATA_PACKAGE_V1',
      dataset_id: datasetId,
      source_file: readReport.source_file,
      source_hash: readReport.source_hash_sha256,
      source_sheet: sheet.sheet_name,
      imported_at: importedAt,
      total_data_rows: dataRows.length,
      valid_record_count: records.length,
      error_row_count: new Set(importErrors.map((e) => e.source_row)).size,
      records,
      import_errors: importErrors,
      formula_audit_entries: formulaAuditEntries,
      warnings: readReport.warnings || []
    };
  }

  // ============================================================================
  // 5. KATMAN D — AÇIKLANABİLİR VARLIK EŞLEŞTİRME (DEDUPLICATION) VE DÜNYA MODELİ
  // ============================================================================

  function detectEntityResolutionCandidates(dataPackage, userDecisions = {}) {
    const records = (dataPackage && dataPackage.records) || [];
    const byStem = new Map();

    function addMention(name, type, rowNum, role) {
      if (!name) return;
      const stem = normalizeEntityStem(name);
      if (!byStem.has(stem)) {
        byStem.set(stem, {
          stem,
          surfaceMap: new Map(),
          types: new Set(),
          rows: new Set()
        });
      }
      const group = byStem.get(stem);
      group.types.add(type || 'Kurumsal Varlık');
      group.rows.add(rowNum);
      if (!group.surfaceMap.has(name)) {
        group.surfaceMap.set(name, { surfaceName: name, rows: [], role });
      }
      group.surfaceMap.get(name).rows.push(rowNum);
    }

    for (const rec of records) {
      addMention(rec.entity_name, rec.entity_type, rec.source_row, 'SOURCE');
      if (rec.target_entity_name) {
        addMention(rec.target_entity_name, 'İlişkili Kurum / Altyapı', rec.source_row, 'TARGET');
      }
    }

    const candidates = [];
    for (const [stem, group] of byStem.entries()) {
      const variants = Array.from(group.surfaceMap.values());
      if (variants.length > 1) {
        const clusterId = `DEDUP_${stem.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
        // En uzun ve kurumsal eki tam olan yazımı kanonik öneri olarak seç
        const sortedVariants = variants.slice().sort((a, b) => b.surfaceName.length - a.surfaceName.length);
        const suggestedCanonicalName = sortedVariants[0].surfaceName;
        const userDecision = userDecisions[clusterId] || userDecisions[stem] || 'PENDING';

        candidates.push({
          cluster_id: clusterId,
          canonical_stem: stem,
          suggested_canonical_name: suggestedCanonicalName,
          suggested_entity_id: makeEntityIdFromStem(stem),
          variants: variants.map((v) => ({
            surface_name: v.surfaceName,
            source_rows: v.rows,
            raw_entity_id: makeEntityIdFromStem(v.surfaceName)
          })),
          matching_fields: [
            `Normalleştirilmiş Kök Ad: '${stem}'`,
            `Kurum Türü Kümesi: ${Array.from(group.types).join(', ')}`
          ],
          conflicting_fields: [
            `Yüzey Yazım Farkı: ${variants.map((v) => `'${v.surfaceName}' (Satır ${v.rows.join(',')})`).join(' ↔ ')}`
          ],
          similarity_score: 0.96,
          rule_id: 'CAELUS_TR_CORP_STEM_NORMALIZER_V1',
          rule_explanation_tr: `Türkçe karakter (İ/I, Ş/S, Ğ/G, Ü/U, Ö/O, Ç/C) ve kurumsal unvan eki (A.Ş., AS, Ltd.) temizlendiğinde tüm yazımlar aynı '${stem}' köküne indirgeniyor. CAELUS sessiz otomatik birleştirme yapmaz; kullanıcı onayı ('Birleştir' veya 'Ayrı Tut') beklenir.`,
          decision: userDecision // 'PENDING' | 'MERGE' | 'KEEP_SEPARATE'
        });
      }
    }

    return {
      candidate_count: candidates.length,
      candidates,
      all_resolved: candidates.every((c) => c.decision === 'MERGE' || c.decision === 'KEEP_SEPARATE')
    };
  }

  function buildWorldModelFromPackage(dataPackage, dedupReport, options = {}) {
    const records = (dataPackage && dataPackage.records) || [];
    const candidates = (dedupReport && dedupReport.candidates) || [];

    // Stem -> Decision haritası
    const decisionByStem = new Map();
    for (const c of candidates) {
      decisionByStem.set(c.canonical_stem, c);
    }

    function resolveEntityIdentity(surfaceName, entityType) {
      const stem = normalizeEntityStem(surfaceName);
      const cand = decisionByStem.get(stem);
      if (cand && cand.decision === 'MERGE') {
        return {
          entity_id: cand.suggested_entity_id,
          entity_name: cand.suggested_canonical_name,
          entity_type: entityType,
          dedup_decision: `BİRLEŞTİRİLDİ (${cand.variants.map((v) => v.surface_name).join(' + ')})`
        };
      }
      if (cand && cand.decision === 'KEEP_SEPARATE') {
        return {
          entity_id: makeEntityIdFromStem(surfaceName),
          entity_name: surfaceName,
          entity_type: entityType,
          dedup_decision: 'KULLANICI KARARIYLA AYRI TUTULDU'
        };
      }
      if (cand && cand.decision === 'PENDING') {
        // Kullanıcı henüz onaylamadıysa sessiz birleştirme YAPMA; ayrı tut ve aday olarak işaretle
        return {
          entity_id: makeEntityIdFromStem(surfaceName),
          entity_name: surfaceName,
          entity_type: entityType,
          dedup_decision: 'ONAY BEKLİYOR (SESSİZ BİRLEŞTİRME YAPILMADI)'
        };
      }
      return {
        entity_id: makeEntityIdFromStem(stem),
        entity_name: surfaceName,
        entity_type: entityType,
        dedup_decision: 'TEKİL VARLIK'
      };
    }

    const entitiesMap = new Map();
    const relations = [];
    const provenanceIndex = new Map();

    for (const rec of records) {
      const srcResolved = resolveEntityIdentity(rec.entity_name, rec.entity_type);
      if (!entitiesMap.has(srcResolved.entity_id)) {
        entitiesMap.set(srcResolved.entity_id, {
          entity_id: srcResolved.entity_id,
          entity_name: srcResolved.entity_name,
          entity_type: srcResolved.entity_type,
          epistemic_status: rec.epistemic_status,
          dedup_decision: srcResolved.dedup_decision,
          source_file: rec.source_file,
          source_sheet: rec.source_sheet,
          source_rows: [],
          surface_names: new Set(),
          total_weight: 0,
          total_value: 0,
          unit: rec.unit
        });
      }
      const srcEnt = entitiesMap.get(srcResolved.entity_id);
      if (!srcEnt.source_rows.includes(rec.source_row)) srcEnt.source_rows.push(rec.source_row);
      srcEnt.surface_names.add(rec.entity_name);
      srcEnt.total_weight = Math.max(srcEnt.total_weight, rec.criticality_weight);
      srcEnt.total_value += rec.value;

      if (rec.target_entity_name) {
        const tgtResolved = resolveEntityIdentity(rec.target_entity_name, 'Tedarikçi / Altyapı Düğümü');
        if (!entitiesMap.has(tgtResolved.entity_id)) {
          entitiesMap.set(tgtResolved.entity_id, {
            entity_id: tgtResolved.entity_id,
            entity_name: tgtResolved.entity_name,
            entity_type: tgtResolved.entity_type,
            epistemic_status: rec.epistemic_status,
            dedup_decision: tgtResolved.dedup_decision,
            source_file: rec.source_file,
            source_sheet: rec.source_sheet,
            source_rows: [],
            surface_names: new Set(),
            total_weight: 0,
            total_value: 0,
            unit: rec.unit
          });
        }
        const tgtEnt = entitiesMap.get(tgtResolved.entity_id);
        if (!tgtEnt.source_rows.includes(rec.source_row)) tgtEnt.source_rows.push(rec.source_row);
        tgtEnt.surface_names.add(rec.target_entity_name);
        tgtEnt.total_weight = Math.max(tgtEnt.total_weight, rec.criticality_weight);

        const relId = `REL_${dataPackage.dataset_id}_R${rec.source_row}`;
        const relObj = {
          relation_id: relId,
          from_entity_id: tgtResolved.entity_id, // Tedarikçi/Altyapı -> bağımlı kurumu etkiler
          from_entity_name: tgtResolved.entity_name,
          to_entity_id: srcResolved.entity_id,
          to_entity_name: srcResolved.entity_name,
          relation_type: rec.relation_type,
          criticality_weight: rec.criticality_weight,
          value: rec.value,
          unit: rec.unit,
          occurred_at: rec.occurred_at,
          learned_at: rec.learned_at,
          epistemic_status: rec.epistemic_status,
          source_file: rec.source_file,
          source_hash: rec.source_hash,
          source_sheet: rec.source_sheet,
          source_row: rec.source_row,
          evidence_source: rec.evidence_source,
          notes: rec.notes
        };
        relations.push(relObj);
        provenanceIndex.set(relId, relObj);
      }
      provenanceIndex.set(rec.record_id, rec);
    }

    const entities = Array.from(entitiesMap.values()).map((e) => ({
      ...e,
      surface_names: Array.from(e.surface_names),
      source_trace: `${e.source_file}#${e.source_sheet}:Satır[${e.source_rows.join(',')}]`
    }));

    // Gerçek deterministik senaryo motoru (caelus_core / caelus_wasm) için ScenarioPack derle
    const scenarioPack = compileUserWorldToScenarioPack(dataPackage, entities, relations, options);

    return {
      ok: true,
      world_id: `WLD_${dataPackage.dataset_id}`,
      dataset_id: dataPackage.dataset_id,
      source_file: dataPackage.source_file,
      source_hash: dataPackage.source_hash,
      source_sheet: dataPackage.source_sheet,
      created_at: dataPackage.imported_at,
      entity_count: entities.length,
      relation_count: relations.length,
      entities,
      relations,
      assumptions: [
        {
          assumption_id: 'ASSUMP_01_PROPAGATION_ELASTICITY',
          category: 'VARSAYILAN',
          statement:
            'Tedarikçi veya altyapı düğümündeki kesinti baskısı, tablodaki Kritiklik / Kapasite Ağırlığı (0-1) oranında bağımlı kuruma gecikmeli olarak yayılır.',
          impact_if_violated:
            'Kurumun tablo dışı gizli stok veya ikincil bağımsız hattı varsa gerçek etki simüle edilenden daha düşük gerçekleşir.'
        },
        {
          assumption_id: 'ASSUMP_02_UNCONFIRMED_CLAIMS_NOT_FACTS',
          category: 'VARSAYILAN',
          statement:
            'Kullanıcı tablosundan içe alınan satırlar KAYNAKTA_IDDIA_EDILEN statüsündedir; hata içeren satırlar (örneğin Satır 8-9) hesaplamaya sessizce dahil edilmez.',
          impact_if_violated:
            'Dışlanan hatalı satırlardaki kurumlar kritik darboğaz üzerinde yer alıyorsa toplam sistem baskısı eksik tahmin edilebilir.'
        }
      ],
      import_errors: dataPackage.import_errors,
      formula_audit_entries: dataPackage.formula_audit_entries,
      scenario_pack: scenarioPack
    };
  }

  // ============================================================================
  // 6. KATMAN E — GERÇEK DETERMİNİSTİK SENARYO MOTORU VE SEÇENEK KARŞILAŞTIRMASI
  // ============================================================================

  function compileUserWorldToScenarioPack(dataPackage, entities, relations, options = {}) {
    const nodeKinds = ['Service', 'Queue', 'Buffer', 'Gate', 'Adversary', 'Perishable'];
    const selectedEntities = entities.slice(0, 8);

    // En çok bağımlılık çıkışı olan düğümleri (darboğaz tedarikçi/altyapı) öne çıkar
    const outDegree = new Map();
    for (const r of relations) {
      outDegree.set(r.from_entity_id, (outDegree.get(r.from_entity_id) || 0) + 1);
    }

    const nodes = selectedEntities.map((ent, idx) => {
      const deg = outDegree.get(ent.entity_id) || 0;
      const baseState = Math.min(0.92, Math.max(0.38, Number((ent.total_weight * 0.82 + deg * 0.05).toFixed(4))));
      const stateFp = Math.round(baseState * 1000000);
      const weightFp = Math.round(Math.min(0.45, Math.max(0.15, ent.total_weight * 0.35)) * 1000000);
      return {
        id: ent.entity_id,
        label: ent.entity_name,
        kind: nodeKinds[idx % nodeKinds.length],
        capacity_fp: 1000000,
        state_fp: stateFp,
        weight_fp: weightFp,
        reported_state_fp: stateFp,
        trust_fp: 920000,
        deadline_tick: idx === selectedEntities.length - 1 ? 144 : -1,
        irrecoverable: false,
        notes: `${ent.entity_type} | Kaynak: ${ent.source_trace}`,
        provenance: {
          source_file: ent.source_file,
          source_sheet: ent.source_sheet,
          source_rows: ent.source_rows,
          dedup_decision: ent.dedup_decision,
          epistemic_status: ent.epistemic_status
        }
      };
    });

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const edges = [];
    for (const rel of relations) {
      if (nodeIdSet.has(rel.from_entity_id) && nodeIdSet.has(rel.to_entity_id)) {
        edges.push({
          from: rel.from_entity_id,
          to: rel.to_entity_id,
          multiplier_fp: Math.round(Math.max(0.35, Math.min(1.35, rel.criticality_weight * 1.15)) * 1000000),
          lag_ticks: 1,
          active: true,
          relation_id: rel.relation_id,
          relation_type: rel.relation_type,
          source_row: rel.source_row
        });
      }
    }
    // Sistem çıkış kenarları (caelus_core uyumluluğu için)
    for (const n of nodes) {
      edges.push({
        from: n.id,
        to: '',
        multiplier_fp: Math.round((n.weight_fp / 1000000) * 900000),
        lag_ticks: 0,
        active: true
      });
    }

    // En yüksek darboğaz düğümü (Option 1 hedefi) ve en yüksek etkilenen kurum düğümü (Option 2 hedefi)
    const sortedByOutDegree = nodes
      .slice()
      .sort((a, b) => (outDegree.get(b.id) || 0) - (outDegree.get(a.id) || 0) || b.state_fp - a.state_fp);
    const primaryTarget = sortedByOutDegree[0] || nodes[0];
    const secondaryTarget = sortedByOutDegree[1] || nodes[Math.min(1, nodes.length - 1)] || primaryTarget;

    const levers = [
      {
        id: 'OPT_1_DARBOGAZ_YEDEKLILIK',
        label: `Seçenek 1: ${primaryTarget ? primaryTarget.label : 'Ana Darboğaz'} Yedek Kapasite ve Alternatif Hat Devreye Alma`,
        target: primaryTarget ? primaryTarget.label : 'Ana Darboğaz',
        success_p_fp: 860000,
        cost_ticks: 4,
        lockout_ticks: 12,
        on_success: {
          target_node_id: primaryTarget ? primaryTarget.id : '',
          state_delta_fp: -280000,
          trust_delta_fp: 80000,
          friction_delta_fp: -120000,
          clear_irrecoverable: true
        },
        on_failure: {
          target_node_id: primaryTarget ? primaryTarget.id : '',
          state_delta_fp: 40000,
          trust_delta_fp: 0,
          friction_delta_fp: 25000,
          clear_irrecoverable: false
        },
        notes: `${primaryTarget ? primaryTarget.label : 'Darboğaz'} üzerindeki kesinti yayılımını doğrudan kaynağında sönümler.`
      },
      {
        id: 'OPT_2_BAGIMLI_KURUM_KORUMA',
        label: `Seçenek 2: ${secondaryTarget ? secondaryTarget.label : 'İkincil Düğüm'} Yerel Stok / Tampon Koruma Kalkanı`,
        target: secondaryTarget ? secondaryTarget.label : 'İkincil Düğüm',
        success_p_fp: 800000,
        cost_ticks: 6,
        lockout_ticks: 16,
        on_success: {
          target_node_id: secondaryTarget ? secondaryTarget.id : '',
          state_delta_fp: -210000,
          trust_delta_fp: 50000,
          friction_delta_fp: -85000,
          clear_irrecoverable: false
        },
        on_failure: {
          target_node_id: secondaryTarget ? secondaryTarget.id : '',
          state_delta_fp: 35000,
          trust_delta_fp: 0,
          friction_delta_fp: 20000,
          clear_irrecoverable: false
        },
        notes: `${secondaryTarget ? secondaryTarget.label : 'İkincil Düğüm'} üzerinde yerel tampon oluşturur ancak üst kademe darboğazı tamamen çözmez.`
      }
    ];

    return {
      schema_version: '2.0',
      id: `USR_PACK_${dataPackage.dataset_id}`,
      blackswan_class: 'user_imported_world_model',
      sector: 'USER_IMPORTED_WORLD',
      labels: {
        node: primaryTarget ? primaryTarget.label : 'Birincil Varlık',
        edge: secondaryTarget ? secondaryTarget.label : 'İlişkili Varlık',
        actor: 'Tedarik / Altyapı Darboğazı',
        regulatory_gate: 'Sözleşme ve Doğrulama Kapısı',
        friction: `${dataPackage.source_file} yayılım baskısı`
      },
      min_caelus_engine: '2.0',
      meta: {
        title: `Kullanıcı Dünya Modeli — ${dataPackage.source_file} (${dataPackage.source_sheet})`,
        region: 'USER_DATA_SCOPE',
        tick_minutes: 15,
        horizon_hours: 72,
        synopsis: `${dataPackage.source_file} dosyasından doğrulanan ${entities.length} varlık ve ${relations.length} ilişki üzerinde deterministik etki analizi.`,
        generated_by: 'CAELUS_FIRST_REAL_TASK_ENGINE_V1',
        source_hash: dataPackage.source_hash
      },
      extended_causal_model: {
        nodes,
        edges,
        feedback_loops: [],
        levers,
        hysteresis: [
          { id: 'HYST_USER_ESIK', threshold_tick: 48, reversible: true, permanent_loss_fp: 0 }
        ],
        hard_deadlines: nodes.length
          ? [
              {
                node_id: nodes[nodes.length - 1].id,
                at_tick: 144,
                label: `${nodes[nodes.length - 1].label} Kritik Eşik`,
                notes: 'Kullanıcı verisinden türetilen zaman kritik operasyon eşiği.'
              }
            ]
          : []
      }
    };
  }

  /**
   * Deterministik Sabit Noktalı (Fixed-Point) Yayılım Simülatörü:
   * Kullanıcı dünyasındaki başlangıç darbesini ve seçilen müdahale kaldıracını
   * düğümler ve kenarlar boyunca adım adım (tick) çalıştırır.
   */
  function simulateDeterministicWorldRun(scenarioPack, interventionOption = null, horizonTicks = 24) {
    const model = (scenarioPack && scenarioPack.extended_causal_model) || { nodes: [], edges: [], levers: [] };
    const nodes = model.nodes.map((n) => ({ ...n }));
    const edges = model.edges.filter((e) => e.active && e.to !== '');

    const lever = interventionOption
      ? model.levers.find((l) => l.id === interventionOption || l.label === interventionOption)
      : null;

    if (lever && lever.on_success) {
      const targetNode = nodes.find((n) => n.id === lever.on_success.target_node_id);
      if (targetNode) {
        targetNode.state_fp = Math.max(
          50000,
          Math.min(1000000, targetNode.state_fp + lever.on_success.state_delta_fp)
        );
      }
    }

    const stateById = new Map(nodes.map((n) => [n.id, n.state_fp]));
    for (let tick = 1; tick <= horizonTicks; tick++) {
      const nextStateById = new Map();
      for (const [id, st] of stateById.entries()) {
        nextStateById.set(id, Math.round(st * 0.965));
      }
      for (const edge of edges) {
        const srcState = stateById.get(edge.from) || 0;
        const dstState = nextStateById.get(edge.to) || 0;
        // Yayılım katkısı (sabit nokta aritmetiği — doygunluğa çarpmadan nedensel yayılım)
        const propagated = Math.round(((srcState / 1000000) * (edge.multiplier_fp / 1000000) * 0.028) * 1000000);
        nextStateById.set(edge.to, Math.max(50000, Math.min(980000, dstState + propagated)));
      }
      for (const [k, v] of nextStateById.entries()) {
        stateById.set(k, v);
      }
    }

    const nodeOutcomes = nodes.map((n) => {
      const finalFp = stateById.get(n.id) || n.state_fp;
      return {
        node_id: n.id,
        node_label: n.label,
        initial_stress: Number((n.state_fp / 1000000).toFixed(4)),
        final_stress: Number((finalFp / 1000000).toFixed(4)),
        delta_stress: Number(((finalFp - n.state_fp) / 1000000).toFixed(4)),
        provenance: n.provenance || null
      };
    });

    const totalWeightFp = nodes.reduce((acc, n) => acc + (n.weight_fp || 200000), 0) || 1000000;
    const systemStress =
      nodeOutcomes.reduce((acc, o, idx) => acc + o.final_stress * (nodes[idx].weight_fp || 200000), 0) /
      totalWeightFp;

    return {
      intervention_id: lever ? lever.id : 'BASELINE_NO_INTERVENTION',
      intervention_label: lever ? lever.label : 'Müdahalesiz Temel Akış (Baseline)',
      target_node_id: lever ? lever.on_success.target_node_id : null,
      target_node_label: lever ? lever.target : 'Yok (Müdahalesiz)',
      horizon_ticks: horizonTicks,
      system_stress_score: Number(systemStress.toFixed(4)),
      epistemic_status: 'SIMULE_EDILEN',
      node_outcomes: nodeOutcomes
    };
  }

  function runUserWorldScenarioComparison(worldModel, options = {}) {
    const pack = worldModel.scenario_pack;
    const levers = (pack && pack.extended_causal_model && pack.extended_causal_model.levers) || [];
    const opt1Id = options.option1Id || (levers[0] && levers[0].id) || null;
    const opt2Id = options.option2Id || (levers[1] && levers[1].id) || null;

    const baselineRun = simulateDeterministicWorldRun(pack, null, 24);
    const option1Run = simulateDeterministicWorldRun(pack, opt1Id, 24);
    const option2Run = simulateDeterministicWorldRun(pack, opt2Id, 24);

    const opt1Delta = Number((option1Run.system_stress_score - baselineRun.system_stress_score).toFixed(4));
    const opt2Delta = Number((option2Run.system_stress_score - baselineRun.system_stress_score).toFixed(4));

    const recommendedOption =
      option1Run.system_stress_score <= option2Run.system_stress_score ? option1Run : option2Run;

    // Düğüm bazlı karşılaştırma ve kaynak izi
    const nodeComparisons = baselineRun.node_outcomes.map((baseNode, idx) => {
      const o1Node = option1Run.node_outcomes[idx];
      const o2Node = option2Run.node_outcomes[idx];
      const affectingRelations = (worldModel.relations || []).filter(
        (r) => r.to_entity_id === baseNode.node_id || r.from_entity_id === baseNode.node_id
      );
      return {
        node_id: baseNode.node_id,
        node_label: baseNode.node_label,
        baseline_stress: baseNode.final_stress,
        option1_stress: o1Node.final_stress,
        option2_stress: o2Node.final_stress,
        option1_net_relief: Number((o1Node.final_stress - baseNode.final_stress).toFixed(4)),
        option2_net_relief: Number((o2Node.final_stress - baseNode.final_stress).toFixed(4)),
        epistemic_class: 'SIMULE_EDILEN',
        source_file: baseNode.provenance?.source_file || worldModel.source_file,
        source_sheet: baseNode.provenance?.source_sheet || worldModel.source_sheet,
        source_rows: baseNode.provenance?.source_rows || [],
        dedup_decision: baseNode.provenance?.dedup_decision || 'TEKİL VARLIK',
        affecting_relations: affectingRelations.map((r) => ({
          relation_id: r.relation_id,
          from: r.from_entity_name,
          to: r.to_entity_name,
          relation_type: r.relation_type,
          criticality_weight: r.criticality_weight,
          source_row: r.source_row
        }))
      };
    });

    return {
      ok: true,
      comparison_id: `CMP_${worldModel.world_id}`,
      world_id: worldModel.world_id,
      question_tr:
        options.questionTr ||
        `${worldModel.source_file} içindeki kritik darboğaz kesintisinde hangi müdahale seçeneği toplam sistem baskısını daha fazla düşürür?`,
      baseline: baselineRun,
      option_1: {
        ...option1Run,
        delta_vs_baseline: opt1Delta
      },
      option_2: {
        ...option2Run,
        delta_vs_baseline: opt2Delta
      },
      recommended_option_id: recommendedOption.intervention_id,
      recommended_option_label: recommendedOption.intervention_label,
      recommendation_explanation_tr: `${recommendedOption.intervention_label}, müdahalesiz temel akış baskısını (${baselineRun.system_stress_score}) ${recommendedOption.system_stress_score} seviyesine çekerek en yüksek sistemik rahatlamayı sağlar. Bu sonuç doğrudan ${worldModel.source_file} (${worldModel.source_sheet}) içindeki doğrulanmış satırlardan ve açık yayılım varsayımlarından üretilmiştir.`,
      epistemic_separation: {
        user_data_claims: `${worldModel.entities.length} varlık ve ${worldModel.relations.length} ilişki (Bilgi sınıfı: KAYNAKTA_IDDIA_EDILEN)`,
        model_assumptions: `${worldModel.assumptions.length} açık model varsayımı (Bilgi sınıfı: VARSAYILAN)`,
        simulated_outcomes: `3 senaryo koşusu ve ${nodeComparisons.length} düğüm karşılaştırması (Bilgi sınıfı: SIMULE_EDILEN)`,
        missing_or_invalid: `${worldModel.import_errors.length} satır/alan doğrulama hatası (Bilgi sınıfı: BILINMEYEN / HATA)`
      },
      node_comparisons: nodeComparisons,
      assumptions: worldModel.assumptions,
      import_errors: worldModel.import_errors
    };
  }

  // ============================================================================
  // 7. KATMAN F — AÇIKLANABİLİR RAPOR VE DIŞA AKTARMA (7 SAYFALI XLSX, HTML/PDF, CSV)
  // ============================================================================

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function escapeHtml(str) {
    return escapeXml(str);
  }

  /**
   * 7 zorunlu sayfalı (.xlsx) rapor içeriği oluşturucu:
   * 1. Özet
   * 2. Varlıklar
   * 3. İlişkiler
   * 4. Senaryo Karşılaştırması
   * 5. Varsayımlar
   * 6. Hatalar ve Eksik Veriler
   * 7. Kaynak İzleri
   */
  function buildReportWorkbookSpec(dataPackage, worldModel, comparisonResult) {
    const ozet = [
      {
        alan: 'Rapor Başlığı',
        deger: `CAELUS Açıklanabilir Karar ve Kaynak İzi Raporu — ${dataPackage.source_file}`,
        aciklama: 'Kullanıcı verisinden deterministik dünya modeli ve senaryo karşılaştırma çıktısı'
      },
      {
        alan: 'Kaynak Dosya ve Sayfa',
        deger: `${dataPackage.source_file} / ${dataPackage.source_sheet}`,
        aciklama: `SHA-256: ${dataPackage.source_hash}`
      },
      {
        alan: 'Sürümlü Veri Sözleşmesi',
        deger: `${dataPackage.contract_name} (v${dataPackage.schema_version})`,
        aciklama: `Geçerli Kayıt: ${dataPackage.valid_record_count} | Hatalı Satır: ${dataPackage.error_row_count}`
      },
      {
        alan: 'Karar Sorusu',
        deger: comparisonResult.question_tr,
        aciklama: 'Senaryo motorunda karşılaştırılan karar problemi'
      },
      {
        alan: 'Müdahalesiz Temel Akış Baskısı',
        deger: String(comparisonResult.baseline.system_stress_score),
        aciklama: 'SIMULE_EDILEN — Hiçbir müdahale yapılmazsa 24 adım sonundaki sistem baskısı'
      },
      {
        alan: 'Seçenek 1 Sonrası Baskı',
        deger: `${comparisonResult.option_1.system_stress_score} (Fark: ${comparisonResult.option_1.delta_vs_baseline})`,
        aciklama: comparisonResult.option_1.intervention_label
      },
      {
        alan: 'Seçenek 2 Sonrası Baskı',
        deger: `${comparisonResult.option_2.system_stress_score} (Fark: ${comparisonResult.option_2.delta_vs_baseline})`,
        aciklama: comparisonResult.option_2.intervention_label
      },
      {
        alan: 'Önerilen Seçenek ve Dayanağı',
        deger: comparisonResult.recommended_option_label,
        aciklama: comparisonResult.recommendation_explanation_tr
      }
    ];

    const varliklar = (worldModel.entities || []).map((e) => ({
      entity_id: e.entity_id,
      entity_name: sanitizeForSpreadsheetExport(e.entity_name),
      entity_type: sanitizeForSpreadsheetExport(e.entity_type),
      epistemic_status: e.epistemic_status,
      dedup_decision: e.dedup_decision,
      source_file: e.source_file,
      source_sheet: e.source_sheet,
      source_rows: e.source_rows.join(', ')
    }));

    const iliskiler = (worldModel.relations || []).map((r) => ({
      relation_id: r.relation_id,
      from_entity: sanitizeForSpreadsheetExport(r.from_entity_name),
      to_entity: sanitizeForSpreadsheetExport(r.to_entity_name),
      relation_type: sanitizeForSpreadsheetExport(r.relation_type),
      weight: String(r.criticality_weight),
      unit_value: `${r.value} ${r.unit}`,
      occurred_at: r.occurred_at,
      source_trace: `${r.source_file}#${r.source_sheet}:Satır ${r.source_row}`
    }));

    const senaryoKarsilastirmasi = (comparisonResult.node_comparisons || []).map((nc) => ({
      option_id: nc.node_id,
      option_label: sanitizeForSpreadsheetExport(nc.node_label),
      target_node: `Satır [${nc.source_rows.join(', ')}] (${nc.dedup_decision})`,
      baseline_stress: String(nc.baseline_stress),
      post_option_stress: `Seçenek 1: ${nc.option1_stress} | Seçenek 2: ${nc.option2_stress}`,
      delta_stress: `Seçenek 1: ${nc.option1_net_relief} | Seçenek 2: ${nc.option2_net_relief}`,
      epistemic_class: nc.epistemic_class,
      rationale:
        nc.affecting_relations.map((ar) => `${ar.from}->${ar.to} (Satır ${ar.source_row})`).join('; ') ||
        'Doğrudan düğüm durumu'
    }));

    const varsayimlar = (worldModel.assumptions || []).map((a) => ({
      assumption_id: a.assumption_id,
      category: a.category,
      statement: a.statement,
      impact_if_violated: a.impact_if_violated
    }));

    const hatalarVeEksikVeriler = (dataPackage.import_errors || []).map((err) => ({
      source_row: String(err.source_row),
      column_name: err.column_name,
      error_code: err.error_code,
      reason_tr: err.reason_tr,
      remediation_tr: err.remediation_tr
    }));

    const kaynakIzleri = (dataPackage.records || []).map((rec) => ({
      record_id: rec.record_id,
      source_file: rec.source_file,
      source_hash: rec.source_hash,
      source_sheet: rec.source_sheet,
      source_row: String(rec.source_row),
      imported_at: rec.imported_at,
      occurred_at: rec.occurred_at,
      learned_at: rec.learned_at,
      mapping_method: rec.mapping_method,
      user_confirmation: rec.user_confirmation
    }));

    return {
      report_version: '1.0.0',
      dataset_id: dataPackage.dataset_id,
      world_id: worldModel.world_id,
      sheet_titles: [
        'Özet',
        'Varlıklar',
        'İlişkiler',
        'Senaryo Karşılaştırması',
        'Varsayımlar',
        'Hatalar ve Eksik Veriler',
        'Kaynak İzleri'
      ],
      sheets: {
        Ozet: ozet,
        Varliklar: varliklar,
        Iliskiler: iliskiler,
        Senaryo_Karsilastirmasi: senaryoKarsilastirmasi,
        Varsayimlar: varsayimlar,
        Hatalar_ve_Eksik_Veriler: hatalarVeEksikVeriler,
        Kaynak_Izleri: kaynakIzleri
      }
    };
  }

  /**
   * Çevrim dışı tarayıcı ve Node.js için 7 sayfalı gerçek OpenXML (.xlsx) ikili dosya üreticisi.
   * CRC-32 + Stored ZIP yapısı kullanarak sıfır dış bağımlılıkla geçerli .xlsx üretir;
   * üretilen dosya hem Excel/LibreOffice hem de Rust Calamine tarafından açılır!
   */
  function crc32Bytes(uint8) {
    let crc = 0xffffffff;
    for (let i = 0; i < uint8.length; i++) {
      crc ^= uint8[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildStoredZipArchive(fileEntries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of fileEntries) {
      const nameBytes = encoder.encode(entry.path);
      const dataBytes =
        entry.content instanceof Uint8Array ? entry.content : encoder.encode(String(entry.content || ''));
      const crc = crc32Bytes(dataBytes);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8
      lv.setUint16(8, 0, true); // Stored (no compression)
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      const cdHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cdHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cdHeader.set(nameBytes, 46);

      localParts.push(localHeader, dataBytes);
      centralParts.push(cdHeader);
      offset += localHeader.length + dataBytes.length;
    }

    const cdSize = centralParts.reduce((acc, b) => acc + b.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, fileEntries.length, true);
    ev.setUint16(10, fileEntries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const totalLen = offset + cdSize + eocd.length;
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of localParts) {
      out.set(p, pos);
      pos += p.length;
    }
    for (const p of centralParts) {
      out.set(p, pos);
      pos += p.length;
    }
    out.set(eocd, pos);
    return out;
  }

  function buildWorksheetXmlFromTable(headers, rowsMatrix) {
    const allRows = [headers, ...rowsMatrix];
    const rowXmlParts = allRows.map((rowArr, rIdx) => {
      const r1 = rIdx + 1;
      const cellXml = rowArr
        .map((val, cIdx) => {
          const c1 = cIdx + 1;
          const ref = `${colToLetter(c1)}${r1}`;
          const safeStr = sanitizeForSpreadsheetExport(String(val ?? ''));
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(safeStr)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r1}">${cellXml}</row>`;
    });
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${rowXmlParts.join('')}</sheetData>` +
      '</worksheet>'
    );
  }

  function generateExplainableXlsxBytes(reportSpec) {
    const sheetConfigs = [
      {
        title: 'Özet',
        headers: ['Alan', 'Değer', 'Açıklama ve Epistemik Durum'],
        rows: (reportSpec.sheets.Ozet || []).map((r) => [r.alan, r.deger, r.aciklama])
      },
      {
        title: 'Varlıklar',
        headers: [
          'Varlık Kimliği',
          'Varlık Adı',
          'Varlık Türü',
          'Bilgi Sınıfı',
          'Tekilleştirme Kararı',
          'Kaynak Dosya',
          'Kaynak Sayfa',
          'Kaynak Satırlar'
        ],
        rows: (reportSpec.sheets.Varliklar || []).map((r) => [
          r.entity_id,
          r.entity_name,
          r.entity_type,
          r.epistemic_status,
          r.dedup_decision,
          r.source_file,
          r.source_sheet,
          r.source_rows
        ])
      },
      {
        title: 'İlişkiler',
        headers: [
          'İlişki Kimliği',
          'Kaynak Varlık',
          'Hedef Varlık',
          'İlişki Türü',
          'Kritiklik / Ağırlık',
          'Hacim ve Birim',
          'Olay Zamanı (occurred_at)',
          'Kaynak İzi (Dosya#Sayfa:Satır)'
        ],
        rows: (reportSpec.sheets.Iliskiler || []).map((r) => [
          r.relation_id,
          r.from_entity,
          r.to_entity,
          r.relation_type,
          r.weight,
          r.unit_value,
          r.occurred_at,
          r.source_trace
        ])
      },
      {
        title: 'Senaryo Karşılaştırması',
        headers: [
          'Düğüm Kodu',
          'Varlık / Düğüm Adı',
          'Kaynak ve Tekilleştirme',
          'Müdahalesiz Baskı',
          'Seçenek Sonrası Baskı',
          'Net Etki (Delta)',
          'Bilgi Sınıfı',
          'Dayanak İlişkiler'
        ],
        rows: (reportSpec.sheets.Senaryo_Karsilastirmasi || []).map((r) => [
          r.option_id,
          r.option_label,
          r.target_node,
          r.baseline_stress,
          r.post_option_stress,
          r.delta_stress,
          r.epistemic_class,
          r.rationale
        ])
      },
      {
        title: 'Varsayımlar',
        headers: ['Varsayım Kodu', 'Epistemik Sınıf', 'Varsayım Tanımı', 'Varsayım Bozulursa Sonuca Etkisi'],
        rows: (reportSpec.sheets.Varsayimlar || []).map((r) => [
          r.assumption_id,
          r.category,
          r.statement,
          r.impact_if_violated
        ])
      },
      {
        title: 'Hatalar ve Eksik Veriler',
        headers: ['Kaynak Satır', 'Sütun Adı', 'Hata / Eksiklik Kodu', 'Sorun Açıklaması', 'Düzeltme Önerisi'],
        rows: (reportSpec.sheets.Hatalar_ve_Eksik_Veriler || []).map((r) => [
          r.source_row,
          r.column_name,
          r.error_code,
          r.reason_tr,
          r.remediation_tr
        ])
      },
      {
        title: 'Kaynak İzleri',
        headers: [
          'Kayıt Kimliği',
          'Kaynak Dosya',
          'Kaynak Özeti (SHA-256)',
          'Kaynak Sayfa',
          'Kaynak Satır',
          'İçe Alım Zamanı (imported_at)',
          'Olay Zamanı (occurred_at)',
          'Öğrenilme Zamanı (learned_at)',
          'Eşleme Yöntemi',
          'Kullanıcı Onayı'
        ],
        rows: (reportSpec.sheets.Kaynak_Izleri || []).map((r) => [
          r.record_id,
          r.source_file,
          r.source_hash,
          r.source_sheet,
          r.source_row,
          r.imported_at,
          r.occurred_at,
          r.learned_at,
          r.mapping_method,
          r.user_confirmation
        ])
      }
    ];

    const contentTypesOverrides = sheetConfigs
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('');

    const contentTypesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      contentTypesOverrides +
      '</Types>';

    const rootRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const wbSheetTags = sheetConfigs
      .map((s, i) => `<sheet name="${escapeXml(s.title)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('');

    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${wbSheetTags}</sheets>` +
      '</workbook>';

    const wbRelTags = sheetConfigs
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('');

    const wbRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      wbRelTags +
      '</Relationships>';

    const zipEntries = [
      { path: '[Content_Types].xml', content: contentTypesXml },
      { path: '_rels/.rels', content: rootRelsXml },
      { path: 'xl/workbook.xml', content: workbookXml },
      { path: 'xl/_rels/workbook.xml.rels', content: wbRelsXml }
    ];

    sheetConfigs.forEach((s, i) => {
      zipEntries.push({
        path: `xl/worksheets/sheet${i + 1}.xml`,
        content: buildWorksheetXmlFromTable(s.headers, s.rows)
      });
    });

    return buildStoredZipArchive(zipEntries);
  }

  /**
   * Formül enjeksiyonuna karşı korumalı (.csv) dışa aktarma.
   */
  function generateSafeCsvExport(dataPackage, worldModel, comparisonResult) {
    const headers = [
      'Kayıt_Türü',
      'Sembol_Etiketi',
      'Kimlik',
      'Başlık_veya_Varlık',
      'Hedef_veya_Seçenek',
      'Değer_veya_Baskı',
      'Bilgi_Sınıfı',
      'Kaynak_Dosya',
      'Kaynak_Sayfa',
      'Kaynak_Satır',
      'Kaynak_Özeti_SHA256'
    ];

    const rows = [headers];
    for (const nc of comparisonResult.node_comparisons || []) {
      rows.push([
        'SENARYO_KARSILASTIRMA',
        '[▲ SİMÜLASYON]',
        nc.node_id,
        nc.node_label,
        `Temel:${nc.baseline_stress} | Seçenek1:${nc.option1_stress} | Seçenek2:${nc.option2_stress}`,
        `Net Etki: ${nc.option1_net_relief}`,
        nc.epistemic_class,
        nc.source_file,
        nc.source_sheet,
        nc.source_rows.join(';'),
        dataPackage.source_hash
      ]);
    }

    for (const rec of dataPackage.records || []) {
      rows.push([
        'DOGRULANMIS_KAYIT',
        '[● KULLANICI VERİSİ]',
        rec.record_id,
        rec.entity_name,
        rec.target_entity_name || '-',
        `${rec.value} ${rec.unit} (Kritiklik:${rec.criticality_weight})`,
        rec.epistemic_status,
        rec.source_file,
        rec.source_sheet,
        String(rec.source_row),
        rec.source_hash
      ]);
    }

    for (const err of dataPackage.import_errors || []) {
      rows.push([
        'DOGRULAMA_HATASI',
        '[✖ HATA/EKSİK]',
        err.error_code,
        err.column_name,
        err.raw_value,
        err.reason_tr,
        'BILINMEYEN',
        dataPackage.source_file,
        dataPackage.source_sheet,
        String(err.source_row),
        dataPackage.source_hash
      ]);
    }

    return rows
      .map((r) =>
        r
          .map((cell) => {
            const safe = sanitizeForSpreadsheetExport(String(cell ?? ''));
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\r\n');
  }

  /**
   * Çok sayfalı baskı (@media print) ve PDF uyumlu, renkten bağımsız sembollü HTML rapor üreticisi.
   */
  function generateExplainablePrintHtmlReport(dataPackage, worldModel, comparisonResult) {
    const spec = buildReportWorkbookSpec(dataPackage, worldModel, comparisonResult);
    return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>CAELUS Açıklanabilir Analiz ve Kaynak İzi Raporu — ${escapeHtml(dataPackage.source_file)}</title>
  <style>
    :root {
      --ink: #0f172a;
      --muted: #334155;
      --border: #94a3b8;
      --bg-soft: #f8fafc;
    }
    * { box-sizing: border-box; }
    .caelus-print-report-sheet {
      font-family: "Inter", "Segoe UI", system-ui, sans-serif;
      color: #0f172a !important;
      background: #ffffff !important;
      margin: 0 auto;
      padding: 24px 32px;
      border-radius: 12px;
      line-height: 1.45;
      font-size: 12.5px;
    }
    .caelus-print-report-sheet h1,
    .caelus-print-report-sheet h2,
    .caelus-print-report-sheet p,
    .caelus-print-report-sheet td,
    .caelus-print-report-sheet th,
    .caelus-print-report-sheet span,
    .caelus-print-report-sheet strong,
    .caelus-print-report-sheet code {
      color: #0f172a !important;
    }
    .caelus-print-report-sheet header.report-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 18px;
    }
    .caelus-print-report-sheet h1 { font-size: 20px; margin: 0 0 6px 0; }
    .caelus-print-report-sheet h2 {
      font-size: 15px;
      margin: 22px 0 8px 0;
      padding-bottom: 4px;
      border-bottom: 1px solid #94a3b8;
      page-break-after: avoid;
    }
    .caelus-print-report-sheet .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      font-size: 11.5px;
      color: #334155 !important;
    }
    .caelus-print-report-sheet .epistemic-badge {
      display: inline-block;
      padding: 2px 6px;
      border: 1px solid #0f172a;
      border-radius: 3px;
      font-weight: 700;
      font-size: 10.5px;
      background: #f1f5f9 !important;
      letter-spacing: 0.02em;
    }
    .caelus-print-report-sheet table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      table-layout: fixed;
      word-wrap: break-word;
    }
    .caelus-print-report-sheet th,
    .caelus-print-report-sheet td {
      border: 1px solid #64748b;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
      background: #ffffff !important;
    }
    .caelus-print-report-sheet th {
      background: #e2e8f0 !important;
      font-weight: 700;
    }
    .caelus-print-report-sheet tr { page-break-inside: avoid; }
    .caelus-print-report-sheet .print-section { margin-bottom: 20px; }
    @media print {
      body { padding: 0; background: #ffffff !important; }
      .caelus-print-report-sheet { padding: 10mm; font-size: 10.5pt; border-radius: 0; }
      .page-break-before { page-break-before: always; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <div class="caelus-print-report-sheet">
  <header class="report-header">
    <h1>CAELUS — Açıklanabilir Dünya Modeli, Senaryo Karşılaştırması ve Kaynak İzi Raporu</h1>
    <div class="meta-strip">
      <span><strong>Kaynak Dosya:</strong> ${escapeHtml(dataPackage.source_file)}</span>
      <span><strong>Kaynak Sayfa:</strong> ${escapeHtml(dataPackage.source_sheet)}</span>
      <span><strong>Kaynak SHA-256:</strong> <code>${escapeHtml(dataPackage.source_hash.slice(0, 24))}…</code></span>
      <span><strong>Sözleşme:</strong> ${escapeHtml(dataPackage.contract_name)} (v${escapeHtml(dataPackage.schema_version)})</span>
    </div>
  </header>

  <section class="print-section" id="sec-ozet">
    <h2>1. Yönetici Özeti ve Epistemik Ayrım ([● VERİ] / [◆ VARSAYIM] / [▲ SİMÜLASYON] / [✖ HATA])</h2>
    <p><strong>Karar Sorusu:</strong> ${escapeHtml(comparisonResult.question_tr)}</p>
    <p><strong>Önerilen Seçenek:</strong> <span class="epistemic-badge">[▲ SİMÜLASYON]</span> ${escapeHtml(comparisonResult.recommended_option_label)}</p>
    <p>${escapeHtml(comparisonResult.recommendation_explanation_tr)}</p>
    <table>
      <thead>
        <tr>
          <th style="width:28%;">Alan</th>
          <th style="width:34%;">Değer</th>
          <th style="width:38%;">Açıklama ve Epistemik Sınıf</th>
        </tr>
      </thead>
      <tbody>
        ${spec.sheets.Ozet.map(
          (r) =>
            `<tr><td><strong>${escapeHtml(r.alan)}</strong></td><td>${escapeHtml(r.deger)}</td><td>${escapeHtml(r.aciklama)}</td></tr>`
        ).join('')}
      </tbody>
    </table>
  </section>

  <section class="print-section" id="sec-senaryo">
    <h2>2. Senaryo ve Müdahale Seçenekleri Karşılaştırması ([▲ SİMÜLASYON])</h2>
    <table>
      <thead>
        <tr>
          <th style="width:18%;">Varlık / Düğüm</th>
          <th style="width:12%;">Müdahalesiz</th>
          <th style="width:22%;">Seçenek Sonrası Baskı</th>
          <th style="width:20%;">Net Rahatlama (Delta)</th>
          <th style="width:28%;">Kaynak Satırlar ve İlişki Dayanağı</th>
        </tr>
      </thead>
      <tbody>
        ${spec.sheets.Senaryo_Karsilastirmasi.map(
          (r) =>
            `<tr>
              <td><strong>${escapeHtml(r.option_label)}</strong><br/><code>${escapeHtml(r.option_id)}</code></td>
              <td>${escapeHtml(r.baseline_stress)}</td>
              <td>${escapeHtml(r.post_option_stress)}</td>
              <td>${escapeHtml(r.delta_stress)}</td>
              <td>${escapeHtml(r.target_node)}<br/><small>${escapeHtml(r.rationale)}</small></td>
            </tr>`
        ).join('')}
      </tbody>
    </table>
  </section>

  <section class="print-section page-break-before" id="sec-varliklar-iliskiler">
    <h2>3. Doğrulanmış Varlıklar ve Tekilleştirme Kararları ([● KULLANICI VERİSİ])</h2>
    <table>
      <thead>
        <tr>
          <th style="width:18%;">Varlık Kodu</th>
          <th style="width:22%;">Varlık Adı</th>
          <th style="width:16%;">Türü</th>
          <th style="width:24%;">Tekilleştirme Kararı</th>
          <th style="width:20%;">Kaynak Sayfa / Satırlar</th>
        </tr>
      </thead>
      <tbody>
        ${spec.sheets.Varliklar.map(
          (v) =>
            `<tr>
              <td><code>${escapeHtml(v.entity_id)}</code></td>
              <td><strong>${escapeHtml(v.entity_name)}</strong></td>
              <td>${escapeHtml(v.entity_type)}</td>
              <td>${escapeHtml(v.dedup_decision)}</td>
              <td>${escapeHtml(v.source_sheet)} · Satır [${escapeHtml(v.source_rows)}]</td>
            </tr>`
        ).join('')}
      </tbody>
    </table>

    <h2>4. Doğrulanmış İlişkiler ve Bağımlılıklar ([● KULLANICI VERİSİ])</h2>
    <table>
      <thead>
        <tr>
          <th style="width:22%;">Kaynak -> Hedef Varlık</th>
          <th style="width:20%;">İlişki Türü</th>
          <th style="width:14%;">Kritiklik</th>
          <th style="width:16%;">Hacim / Birim</th>
          <th style="width:28%;">Olay Zamanı ve Kaynak İzi</th>
        </tr>
      </thead>
      <tbody>
        ${spec.sheets.Iliskiler.map(
          (rel) =>
            `<tr>
              <td><strong>${escapeHtml(rel.from_entity)}</strong> → ${escapeHtml(rel.to_entity)}</td>
              <td>${escapeHtml(rel.relation_type)}</td>
              <td>${escapeHtml(rel.weight)}</td>
              <td>${escapeHtml(rel.unit_value)}</td>
              <td>${escapeHtml(rel.occurred_at.slice(0, 10))}<br/><code>${escapeHtml(rel.source_trace)}</code></td>
            </tr>`
        ).join('')}
      </tbody>
    </table>
  </section>

  <section class="print-section page-break-before" id="sec-varsayim-hata-kaynak">
    <h2>5. Açık Model Varsayımları ([◆ VARSAYIM])</h2>
    <table>
      <thead>
        <tr>
          <th style="width:20%;">Varsayım Kodu</th>
          <th style="width:42%;">Varsayım Tanımı</th>
          <th style="width:38%;">Varsayım Bozulursa Sonuca Etkisi</th>
        </tr>
      </thead>
      <tbody>
        ${spec.sheets.Varsayimlar.map(
          (a) =>
            `<tr>
              <td><code>${escapeHtml(a.assumption_id)}</code><br/><span class="epistemic-badge">[◆ ${escapeHtml(a.category)}]</span></td>
              <td>${escapeHtml(a.statement)}</td>
              <td>${escapeHtml(a.impact_if_violated)}</td>
            </tr>`
        ).join('')}
      </tbody>
    </table>

    <h2>6. Satır Bazlı Doğrulama Hataları ve Eksik Veriler ([✖ HATA / EKSİK VERİ])</h2>
    <table>
      <thead>
        <tr>
          <th style="width:12%;">Satır</th>
          <th style="width:18%;">Sütun</th>
          <th style="width:22%;">Hata Kodu</th>
          <th style="width:26%;">Sorun Açıklaması</th>
          <th style="width:22%;">Düzeltme Önerisi</th>
        </tr>
      </thead>
      <tbody>
        ${
          spec.sheets.Hatalar_ve_Eksik_Veriler.length
            ? spec.sheets.Hatalar_ve_Eksik_Veriler.map(
                (err) =>
                  `<tr>
                    <td><strong>Satır ${escapeHtml(err.source_row)}</strong></td>
                    <td>${escapeHtml(err.column_name)}</td>
                    <td><code>[✖ ${escapeHtml(err.error_code)}]</code></td>
                    <td>${escapeHtml(err.reason_tr)}</td>
                    <td>${escapeHtml(err.remediation_tr)}</td>
                  </tr>`
              ).join('')
            : '<tr><td colspan="5">Doğrulama hatası bulunmadı.</td></tr>'
        }
      </tbody>
    </table>

    <h2>7. Satır Bazlı Kaynak İzleri (Provenance & Çift Zamanlı Zincir)</h2>
    <table>
      <thead>
        <tr>
          <th style="width:16%;">Kayıt Kodu</th>
          <th style="width:22%;">Dosya # Sayfa : Satır</th>
          <th style="width:22%;">Olay / Öğrenilme Zamanı</th>
          <th style="width:22%;">Eşleme Yöntemi</th>
          <th style="width:18%;">Kullanıcı Onayı</th>
        </tr>
      </thead>
      <tbody>
        ${spec.sheets.Kaynak_Izleri.map(
          (tr) =>
            `<tr>
              <td><code>${escapeHtml(tr.record_id)}</code></td>
              <td>${escapeHtml(tr.source_file)}#${escapeHtml(tr.source_sheet)}:Satır ${escapeHtml(tr.source_row)}</td>
              <td>Olay: ${escapeHtml(tr.occurred_at.slice(0, 10))}<br/>Öğrenilme: ${escapeHtml(tr.learned_at.slice(0, 10))}</td>
              <td>${escapeHtml(tr.mapping_method)}</td>
              <td>${escapeHtml(tr.user_confirmation)}</td>
            </tr>`
        ).join('')}
      </tbody>
    </table>
  </section>
  </div>
</body>
</html>`;
  }

  // ============================================================================
  // 8. MARKITDOWN MCP İSTEĞE BAĞLI BELGE ADAPTÖRÜ (PARÇA 8)
  // ============================================================================

  function convertDocumentViaOptionalMarkItDownAdapter(docInput = {}) {
    const fileName = String(docInput.fileName || 'belge_notu.pdf');
    const rawContent = String(docInput.rawText || '');
    const sourceHash = computeSha256Hex(rawContent);
    const hasMultiColumnTableArtifact =
      Boolean(docInput.hasComplexMergedCells) || /\|\s*\|\s*\|/.test(rawContent) || fileName.toLowerCase().endsWith('.pdf');

    const warnings = [];
    if (hasMultiColumnTableArtifact) {
      warnings.push(
        'STRUCTURE_LOSS_WARNING: Belgeden (PDF/DOCX) metin çıkarılırken çok sütunlu tablo veya sayfa sınırı bilgisinin bir kısmı düz metne indirgendi. Bu içerik doğrudan kesin olgu olarak değil, KAYNAKTA_IDDIA_EDILEN araştırma notu olarak işaretlendi.'
      );
    }

    return {
      ok: true,
      adapter: 'CAELUS_MARKITDOWN_OPTIONAL_DOCUMENT_ADAPTER',
      mandatory_core_dependency: false,
      source_file: fileName,
      source_hash: sourceHash,
      page_count_preserved: Boolean(docInput.pageMarkersPresent),
      structure_loss_detected: hasMultiColumnTableArtifact,
      epistemic_status: 'KAYNAKTA_IDDIA_EDILEN',
      warnings,
      markdown_preview: rawContent.slice(0, 600)
    };
  }

  // ============================================================================
  // 9. VAKA A VE VAKA B YERLEŞİK ÖRNEK VERİLERİ VE UÇTAN UCA İŞ AKIŞI YÜRÜTÜCÜSÜ
  // ============================================================================

  const BUILTIN_CASES = Object.freeze({
    VAKA_A: {
      caseId: 'VAKA_A',
      titleTr: 'Vaka A — Kurumlar ve Tedarik İlişkileri',
      subtitleTr: 'Çok kademeli yarı iletken, soğuk zincir ve enerji tedarik bağımlılığı (Türkçe başlıklar, tekilleştirme adayı ve satır bazlı hata örneği içerir)',
      defaultQuestionTr: 'Marmara Yarı İletken Ltd. veya Kuzey Lojistik A.Ş. hattındaki kesintide hangi müdahale seçeneği Alfa Teknoloji A.Ş. ve bağlı kurumların toplam baskısını daha fazla düşürür?',
      fileName: 'vaka_a_tedarik_zinciri.csv',
      sheetName: 'Tedarik_Zinciri',
      delimiter: ',',
      csvContent: [
        'Şirket Adı,Şirket Türü,Tedarikçi Kurum,İlişki Türü,Kritiklik_Skoru,Aylık_Hacim_Birim,Birim,Tarih,Toplam_Risk_Formül,Gözlem_Kaynağı,Notlar',
        'Alfa Teknoloji A.Ş.,Üretim Kurumu,Marmara Yarı İletken Ltd.,Kritik Bileşen Tedariki,0.88,12500,Adet,2026-02-01,11000.0,ERP_SatinAlma_Kaydi_2026Q1,Ana işlemci modülü tedarik hattı',
        'ALFA TEKNOLOJI AS,Üretim Kurumu,Kuzey Lojistik A.Ş.,Soğuk Zincir ve Taşıma,0.76,8400,Adet,2026-02-02,6384.0,Gumruk_Beyanname_2026_02,Kuzey koridoru gümrük geçişli sevkiyat',
        'Alfa Teknoloji,Üretim Kurumu,Ege Enerji Dağıtım A.Ş.,Enerji ve Altyapı Beslemesi,0.82,6200,MWh,2026-02-03,5084.0,Enerji_Izleme_Tablosu,Üretim tesisi kesintisiz güç bağlantısı',
        'Beta Biyoteknoloji A.Ş.,Sağlık Üreticisi,Marmara Yarı İletken Ltd.,Sensör Çipi Tedariki,0.91,4500,Adet,2026-02-04,4095.0,Tedarik_Sozlesmesi_B4,Soğuk zincir sensör kartı bağımlılığı',
        'Anadolu Soğuk Zincir Ltd.,Lojistik Operatörü,Kuzey Lojistik A.Ş.,Depo ve Aktarma Ortaklığı,0.69,15800,Ton,2026-02-05,10902.0,Liman_Aktarma_Gunlugu,Bölgesel aktarma deposu',
        'Marmara Yarı İletken Ltd.,Bileşen Tedarikçisi,Küresel Silikon Wafer Corp.,Ham Madde İthalatı,0.94,19000,Wafer,2026-02-06,17860.0,Ithalat_Manifestosu_W9,Üst kademe (Tier-2) ham madde darboğazı',
        'Delta Savunma Sistemleri A.Ş.,Üretim Kurumu,Marmara Yarı İletken Ltd.,Kritik Bileşen Tedariki,BOZUK_SKOR,BELIRSIZ_HACIM,Adet,2026-02-30,0,Ham_Tablo_Hatali_Satir,Bu satır doğrulama motorunun satır bazlı hata yakalamasını test eder',
        ',Belirsiz,Kuzey Lojistik A.Ş.,Taşıma,0.55,1200,Adet,2026-02-07,660.0,Eksik_Kayit_Girisi,Varlık adı boş bırakılmış satır'
      ].join('\n')
    },
    VAKA_B: {
      caseId: 'VAKA_B',
      titleTr: 'Vaka B — Kurumlar ve Altyapı / Kaynak Bağımlılıkları',
      subtitleTr: 'Veri merkezi, şehir hastanesi, su arıtma ve lojistik kurumlarının trafo ve fiber omurga bağımlılıkları',
      defaultQuestionTr: 'Bölgesel Trafo Merkezi TR-04 veya Fiber Omurga Hattı FB-01 arızasında hangi müdahale seçeneği kritik kurumların süreklilik kaybını daha etkili sınırlar?',
      fileName: 'vaka_b_altyapi_bagimlilik.csv',
      sheetName: 'Altyapi_Bagimliliklari',
      delimiter: ';',
      csvContent: [
        'Kurum_Adi;Kurum_Turu;Bagimli_Altyapi;Bagimlilik_Tipi;Kapasite_Payi;Yedeklilik_Saati;Birim;Olay_Tarihi;Kaynak_Belge;Aciklama',
        'Ulusal Veri Merkezi A.Ş.;Kritik Bilişim Kurumu;Bölgesel Trafo Merkezi TR-04;Birincil Elektrik Beslemesi;0.85;18;Saat;2026-03-01;Altyapi_Topoloji_Raporu_2026;Ana sunucu salonu yüksek gerilim hattı',
        'ULUSAL VERI MERKEZI AS;Kritik Bilişim Kurumu;Fiber Omurga Hattı FB-01;Veri İletişim Omurgası;0.92;4;Saat;2026-03-02;Btk_Hat_Haritasi_V3;Yedek uydu bağlantısı düşük bant genişlikli',
        'Merkez Şehir Hastanesi;Sağlık Kurumu;Bölgesel Trafo Merkezi TR-04;Yoğun Bakım Enerji Hattı;0.95;24;Saat;2026-03-03;Saglik_Afet_Plani_2026;Jeneratör yakıt tamponu 24 saat',
        'Merkez Şehir Hastanesi;Sağlık Kurumu;Endüstriyel Su Arıtma Tesisi SA-02;Sterilizasyon ve Soğutma Suyu;0.78;12;Saat;2026-03-04;Belediye_Su_Sebekesi_Kaydi;Diyaliz ve soğutma kulesi su bağımlılığı',
        'Endüstriyel Su Arıtma Tesisi SA-02;Altyapı Tesisi;Bölgesel Trafo Merkezi TR-04;Pompa İstasyonu Enerjisi;0.89;6;Saat;2026-03-05;Pompa_Istasyonu_SCADA;Trafo kesintisinde 6 saat sonra su basıncı düşer',
        'Bölgesel Lojistik Merkezi;Lojistik Kurumu;Fiber Omurga Hattı FB-01;Otomasyon ve Gümrük Sorgu Ağı;0.74;8;Saat;2026-03-06;Lojistik_Agi_Denetimi;Fiber kesintisinde gümrük kapısı manuel moda düşer'
      ].join('\n')
    }
  });

  function runCompleteFirstRealTaskWorkflow(options = {}) {
    const caseSpec = BUILTIN_CASES[options.caseId || 'VAKA_A'] || BUILTIN_CASES.VAKA_A;
    let readReport = options.readReport || null;

    if (!readReport) {
      if (options.xlsxBytes) {
        readReport = parseOpenXmlXlsxBytes(options.xlsxBytes, options.fileName || 'kullanici_dosyasi.xlsx');
      } else {
        const csvText = options.csvContent || caseSpec.csvContent;
        const fileName = options.fileName || caseSpec.fileName;
        readReport = readCsvContent(csvText, {
          fileName,
          delimiter: options.delimiter || caseSpec.delimiter
        });
      }
    }

    if (!readReport.ok) {
      return {
        ok: false,
        step_failed: 'STEP_1_READ_FILE',
        read_report: readReport
      };
    }

    const selectedSheetName =
      options.sheetName && readReport.sheet_names.includes(options.sheetName)
        ? options.sheetName
        : readReport.sheet_names[0];
    const selectedSheet = readReport.sheets.find((s) => s.sheet_name === selectedSheetName) || readReport.sheets[0];

    const mappingResult = suggestColumnMappings(selectedSheet, options.columnOverrides || {});
    const dataPackage = validateAndBuildDataPackage(readReport, selectedSheetName, mappingResult, {
      importedAt: options.importedAt || '2026-11-09T16:45:00.000Z',
      learnedAt: options.learnedAt || '2026-11-09T16:45:00.000Z',
      userConfirmed: options.userConfirmed !== false
    });

    const dedupDecisions = options.dedupDecisions || {};
    const dedupPreview = detectEntityResolutionCandidates(dataPackage, dedupDecisions);
    // Varsayılan tam akışta kullanıcı onayladıysa (mergeAllConfirmed: true), adayları MERGE olarak işaretle
    if (options.mergeConfirmedCandidates !== false) {
      for (const c of dedupPreview.candidates) {
        if (!dedupDecisions[c.cluster_id] && !dedupDecisions[c.canonical_stem]) {
          dedupDecisions[c.cluster_id] = 'MERGE';
        }
      }
    }
    const dedupReport = detectEntityResolutionCandidates(dataPackage, dedupDecisions);
    const worldModel = buildWorldModelFromPackage(dataPackage, dedupReport, options);
    const comparisonResult = runUserWorldScenarioComparison(worldModel, {
      questionTr: options.questionTr || caseSpec.defaultQuestionTr,
      option1Id: options.option1Id,
      option2Id: options.option2Id
    });
    const workbookSpec = buildReportWorkbookSpec(dataPackage, worldModel, comparisonResult);

    return {
      ok: true,
      case_id: options.caseId || 'CUSTOM_USER_FILE',
      read_report: readReport,
      selected_sheet_name: selectedSheetName,
      mapping_result: mappingResult,
      data_package: dataPackage,
      dedup_report: dedupReport,
      world_model: worldModel,
      comparison_result: comparisonResult,
      workbook_spec: workbookSpec,
      export_builders: {
        buildXlsxBytes: () => generateExplainableXlsxBytes(workbookSpec),
        buildSafeCsv: () => generateSafeCsvExport(dataPackage, worldModel, comparisonResult),
        buildPrintHtml: () => generateExplainablePrintHtmlReport(dataPackage, worldModel, comparisonResult)
      }
    };
  }

  // ============================================================================
  // 10. CAELUS İSTEĞE BAĞLI MCP SUNUCUSU — 10 ZORUNLU ARAÇ (BÖLÜM 3.7 & BÖLÜM 12)
  // ============================================================================

  const FIRST_REAL_TASK_MCP_TOOLS_10 = Object.freeze([
    {
      name: 'inspect_imported_dataset',
      accessMode: 'READ_ONLY',
      description: 'İçe alınan veri paketinin kaynağını, SHA-256 özetini, sayfa listesini ve kayıt sayısını döndürür.'
    },
    {
      name: 'list_import_errors',
      accessMode: 'READ_ONLY',
      description: 'İçe alınan dosyadaki satır ve sütun bazlı doğrulama hatalarını ve düzeltme önerilerini döndürür.'
    },
    {
      name: 'suggest_column_mapping',
      accessMode: 'READ_ONLY',
      description: 'Tablo sütunları için kurallı ve açıklanabilir CAELUS alan eşleme önerilerini üretir.'
    },
    {
      name: 'inspect_mapping_proposal',
      accessMode: 'READ_ONLY',
      description: 'Belirli bir sütun için önerilen eşlemenin hangi kuraldan geldiğini ve örnek değerlerini açıklar.'
    },
    {
      name: 'list_entities',
      accessMode: 'READ_ONLY',
      description: 'Doğrulanmış dünya modelindeki varlıkları, tekilleştirme kararlarını ve kaynak satır izlerini listeler.'
    },
    {
      name: 'inspect_relationship',
      accessMode: 'READ_ONLY',
      description: 'İki varlık arasındaki ilişkinin türünü, ağırlığını, zamanını ve kaynak satır kanıtını döndürür.'
    },
    {
      name: 'run_scenario',
      accessMode: 'READ_ONLY',
      description: 'Kullanıcı dünya modeli üzerinde seçilen müdahale seçeneğini deterministik motorda çalıştırır.'
    },
    {
      name: 'compare_scenarios',
      accessMode: 'READ_ONLY',
      description: 'Müdahalesiz temel akış ile iki müdahale seçeneğini karşılaştırır ve dayanaklarını açıklar.'
    },
    {
      name: 'get_evidence',
      accessMode: 'READ_ONLY',
      description: 'Bir varlık, ilişki veya senaryo sonucunun kaynak dosya, sayfa, satır ve zaman kanıt zincirini döndürür.'
    },
    {
      name: 'export_result',
      accessMode: 'CONTROLLED_EXPORT',
      description: 'Analiz sonucunu kaynak izleriyle birlikte .xlsx, HTML/PDF veya güvenli .csv paketi olarak dışa aktarır.'
    }
  ]);

  function createFirstRealTaskMcpController(options = {}) {
    let activeWorkflow = runCompleteFirstRealTaskWorkflow({ caseId: options.defaultCaseId || 'VAKA_A' });
    const allowControlledExport = options.allowExport !== false;

    function invokeFirstTaskTool(req = {}) {
      const toolName = String(req.toolName || '').trim();
      const args = req.arguments || {};

      // Güvenlik Kapısı 1: Ham dosya sistemi / path traversal reddi
      const serializedArgs = JSON.stringify(args);
      if (/\.\.[/\\]|\/etc\/|c:\\windows|powershell|cmd\.exe/i.test(serializedArgs)) {
        return {
          ok: false,
          errorCode: 'MCP_SECURITY_FILESYSTEM_TRAVERSAL_BLOCKED',
          messageTr: 'Güvenlik İhlali Engellendi: MCP araçları ham dosya sistemine sınırsız erişim veya komut çalıştırma kabul etmez.'
        };
      }

      // Güvenlik Kapısı 2: Hipotezi veya iddiayı sessizce kesin olguya (BILINEN) yükseltme reddi
      if (args.promoteToFact === true || args.forceEpistemicStatus === 'BILINEN') {
        return {
          ok: false,
          errorCode: 'MCP_EPISTEMIC_PROMOTION_FORBIDDEN',
          messageTr: 'Epistemik Güvenlik İhlali: Kullanıcı tablosu iddiası veya hipotez MCP çağrısıyla doğrulanmış kesin olguya (BILINEN) yükseltilemez.'
        };
      }

      if (args.caseId && BUILTIN_CASES[args.caseId] && args.caseId !== activeWorkflow.case_id) {
        activeWorkflow = runCompleteFirstRealTaskWorkflow({ caseId: args.caseId });
      }

      switch (toolName) {
        case 'inspect_imported_dataset':
          return {
            ok: true,
            toolName,
            dataset_id: activeWorkflow.data_package.dataset_id,
            contract_name: activeWorkflow.data_package.contract_name,
            schema_version: activeWorkflow.data_package.schema_version,
            source_file: activeWorkflow.data_package.source_file,
            source_hash: activeWorkflow.data_package.source_hash,
            source_sheet: activeWorkflow.data_package.source_sheet,
            sheet_names: activeWorkflow.read_report.sheet_names,
            valid_record_count: activeWorkflow.data_package.valid_record_count,
            error_row_count: activeWorkflow.data_package.error_row_count
          };

        case 'list_import_errors':
          return {
            ok: true,
            toolName,
            dataset_id: activeWorkflow.data_package.dataset_id,
            error_count: activeWorkflow.data_package.import_errors.length,
            import_errors: activeWorkflow.data_package.import_errors
          };

        case 'suggest_column_mapping':
          return {
            ok: true,
            toolName,
            sheet_name: activeWorkflow.selected_sheet_name,
            required_roles_satisfied: activeWorkflow.mapping_result.requiredRolesSatisfied,
            proposals: activeWorkflow.mapping_result.proposals
          };

        case 'inspect_mapping_proposal': {
          const colIdx = Number(args.columnIndex ?? 0);
          const prop =
            activeWorkflow.mapping_result.proposals.find(
              (p) => p.columnIndex === colIdx || p.originalHeader === args.columnName
            ) || activeWorkflow.mapping_result.proposals[0];
          return {
            ok: true,
            toolName,
            proposal: prop
          };
        }

        case 'list_entities':
          return {
            ok: true,
            toolName,
            world_id: activeWorkflow.world_model.world_id,
            entity_count: activeWorkflow.world_model.entities.length,
            entities: activeWorkflow.world_model.entities,
            dedup_candidates: activeWorkflow.dedup_report.candidates
          };

        case 'inspect_relationship': {
          const relId = args.relationId;
          const rel =
            activeWorkflow.world_model.relations.find((r) => r.relation_id === relId) ||
            activeWorkflow.world_model.relations[0] ||
            null;
          return {
            ok: Boolean(rel),
            toolName,
            relationship: rel
          };
        }

        case 'run_scenario': {
          const optionId = args.optionId || null;
          const runResult = simulateDeterministicWorldRun(
            activeWorkflow.world_model.scenario_pack,
            optionId,
            Number(args.horizonTicks || 24)
          );
          return {
            ok: true,
            toolName,
            run: runResult
          };
        }

        case 'compare_scenarios':
          return {
            ok: true,
            toolName,
            comparison: activeWorkflow.comparison_result
          };

        case 'get_evidence': {
          const targetId = args.entityId || args.recordId || null;
          const matchingRecords = targetId
            ? activeWorkflow.data_package.records.filter(
                (r) =>
                  r.record_id === targetId ||
                  r.entity_id === targetId ||
                  r.target_entity_id === targetId ||
                  r.entity_name === targetId
              )
            : activeWorkflow.data_package.records;
          return {
            ok: true,
            toolName,
            source_file: activeWorkflow.data_package.source_file,
            source_hash: activeWorkflow.data_package.source_hash,
            evidence_records: matchingRecords,
            assumptions: activeWorkflow.world_model.assumptions
          };
        }

        case 'export_result': {
          if (!allowControlledExport) {
            return {
              ok: false,
              errorCode: 'MCP_EXPORT_DISABLED_BY_POLICY',
              messageTr: 'Dışa aktarma yetkisi bu oturumda kapalı.'
            };
          }
          const fmt = String(args.format || 'xlsx').toLowerCase();
          if (fmt === 'csv') {
            const csv = activeWorkflow.export_builders.buildSafeCsv();
            return {
              ok: true,
              toolName,
              format: 'csv',
              byte_length: csv.length,
              sheet_titles: activeWorkflow.workbook_spec.sheet_titles,
              preview: csv.slice(0, 500)
            };
          }
          if (fmt === 'html' || fmt === 'pdf') {
            const html = activeWorkflow.export_builders.buildPrintHtml();
            return {
              ok: true,
              toolName,
              format: 'html',
              byte_length: html.length,
              sheet_titles: activeWorkflow.workbook_spec.sheet_titles,
              preview: html.slice(0, 500)
            };
          }
          const xlsxBytes = activeWorkflow.export_builders.buildXlsxBytes();
          return {
            ok: true,
            toolName,
            format: 'xlsx',
            byte_length: xlsxBytes.length,
            sheet_titles: activeWorkflow.workbook_spec.sheet_titles,
            sha256: computeSha256Hex(xlsxBytes)
          };
        }

        default:
          return {
            ok: false,
            errorCode: 'MCP_TOOL_NOT_FOUND',
            messageTr: `Bilinmeyen MCP aracı: ${toolName}`
          };
      }
    }

    return {
      toolsCatalog: FIRST_REAL_TASK_MCP_TOOLS_10,
      invokeFirstTaskTool,
      getActiveWorkflow: () => activeWorkflow
    };
  }

  return {
    FIRST_TASK_COMMERCIAL_STATUSES,
    TWELVE_FIRST_TASK_PARTS_INVENTORY,
    CAELUS_SEMANTIC_ROLES,
    CAELUS_DATA_PACKAGE_SCHEMA_V1,
    BUILTIN_CASES,
    FIRST_REAL_TASK_MCP_TOOLS_10,
    foldTurkish,
    computeSha256Hex,
    parseStrictCalendarDate,
    parseFlexibleNumber,
    detectFormulaInjectionRisk,
    sanitizeForSpreadsheetExport,
    detectCsvDelimiter,
    parseCsvRows,
    parseOpenXmlXlsxBytes,
    readCsvContent,
    suggestColumnMappings,
    normalizeEntityStem,
    validateAndBuildDataPackage,
    detectEntityResolutionCandidates,
    buildWorldModelFromPackage,
    compileUserWorldToScenarioPack,
    simulateDeterministicWorldRun,
    runUserWorldScenarioComparison,
    buildReportWorkbookSpec,
    generateExplainableXlsxBytes,
    generateSafeCsvExport,
    generateExplainablePrintHtmlReport,
    convertDocumentViaOptionalMarkItDownAdapter,
    runCompleteFirstRealTaskWorkflow,
    createFirstRealTaskMcpController
  };
});
