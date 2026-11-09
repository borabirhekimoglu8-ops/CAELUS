import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createStandaloneCaelusMcpJsonRpcHandler } from '../tools/caelus_mcp_server.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const eng = require(path.join(ROOT, 'ui', 'first_real_task_engine.js'));
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'first_real_task');
const CALAMINE_BIN = path.join(
  ROOT,
  'tools',
  'caelus_xlsx_engine',
  'target',
  'debug',
  process.platform === 'win32' ? 'caelus_xlsx_engine.exe' : 'caelus_xlsx_engine'
);

test('Bölüm 2 & 3: 12 Teknik Parça Envanteri ve Ticari Bağımsızlık Kapısı eksiksiz tanımlı', () => {
  assert.equal(eng.TWELVE_FIRST_TASK_PARTS_INVENTORY.length, 12);
  const validStatuses = new Set(Object.values(eng.FIRST_TASK_COMMERCIAL_STATUSES));

  for (const part of eng.TWELVE_FIRST_TASK_PARTS_INVENTORY) {
    assert.ok(part.partNumber >= 1 && part.partNumber <= 12);
    assert.ok(part.nameTr.length > 5);
    assert.ok(part.repoUrl.startsWith('https://'));
    assert.ok(validStatuses.has(part.commercialStatus), `Geçersiz ticari statü: ${part.commercialStatus}`);
    assert.equal(part.codeExists, true);
    assert.equal(part.realIntegrationExists, true);
    assert.equal(part.testExists, true);
    assert.equal(part.uiConnected, true);
    assert.equal(part.sampleDataConnected, true);
    assert.equal(part.errorCaseTested, true);
  }
});

test('Test 1 & 2 & 3: Calamine (Rust) ve CAELUS OpenXML .xlsx / .csv okuma, çoklu sayfa, formül/önbellek ayrımı, makro ve bozuk dosya koruması', () => {
  const xlsxPath = path.join(FIXTURES, 'vaka_a_tedarik_zinciri.xlsx');
  const xlsxBytes = fs.readFileSync(xlsxPath);

  // 1. CAELUS OpenXML okuyucu
  const jsReport = eng.parseOpenXmlXlsxBytes(xlsxBytes, 'vaka_a_tedarik_zinciri.xlsx');
  assert.equal(jsReport.ok, true);
  assert.deepEqual(jsReport.sheet_names, ['Tedarik_Zinciri', 'Bölgesel_Düğümler']);

  const sheet1 = jsReport.sheets[0];
  assert.equal(sheet1.headers[0], 'Şirket Adı');
  assert.equal(sheet1.headers[8], 'Toplam_Risk_Formül');
  assert.equal(sheet1.formula_cell_count, 8);
  assert.equal(sheet1.cached_formula_count, 5);
  assert.equal(sheet1.uncomputed_formula_count, 3);

  // I2 hücresi önbellekli formül, I7 hücresi önbelleksiz (hesaplanmamış) formül olmalı
  const cellI2 = sheet1.rows[1][8];
  assert.equal(cellI2.cell_ref, 'I2');
  assert.equal(cellI2.has_formula, true);
  assert.equal(cellI2.formula_expression, '=E2*F2');
  assert.equal(cellI2.cached_value, '11000');
  assert.equal(cellI2.formula_status, 'FORMULA_WITH_CACHED_VALUE');

  const cellI7 = sheet1.rows[6][8];
  assert.equal(cellI7.cell_ref, 'I7');
  assert.equal(cellI7.has_formula, true);
  assert.equal(cellI7.formula_expression, '=E7*F7');
  assert.equal(cellI7.cached_value, null);
  assert.equal(cellI7.formula_status, 'FORMULA_UNCOMPUTED');

  // 2. İkinci sayfayı ('Bölgesel_Düğümler') seçebilme
  const sheet2 = jsReport.sheets[1];
  assert.equal(sheet2.sheet_name, 'Bölgesel_Düğümler');
  assert.equal(sheet2.row_count, 3);
  assert.equal(sheet2.rows[1][0].display_value, 'TR-MARMARA-01');

  // 3. Rust Calamine ikilisi ile birebir eşdeğerlik
  if (fs.existsSync(CALAMINE_BIN)) {
    const calamineOut = JSON.parse(cp.execFileSync(CALAMINE_BIN, ['read', xlsxPath], { encoding: 'utf8' }));
    assert.equal(calamineOut.ok, true);
    assert.deepEqual(calamineOut.sheet_names, jsReport.sheet_names);
    assert.equal(calamineOut.sheets[0].formula_cell_count, 8);
    assert.equal(calamineOut.sheets[0].cached_formula_count, 5);
    assert.equal(calamineOut.sheets[0].uncomputed_formula_count, 3);
  }

  // 4. Makro içeren (.xlsm) dosyada makro çalıştırmama ve uyarı üretme
  const macroBytes = fs.readFileSync(path.join(FIXTURES, 'macro_stub_warning.xlsm'));
  const macroReport = eng.parseOpenXmlXlsxBytes(macroBytes, 'macro_stub_warning.xlsm');
  assert.equal(macroReport.ok, true);
  assert.equal(macroReport.has_vba_macro, true);
  assert.equal(macroReport.macro_policy, 'MACRO_DETECTED_STRIPPED_READ_ONLY');
  assert.ok(macroReport.warnings.some((w) => w.includes('MAKRO_UYARISI')));

  // 5. Bozuk (.xlsx) dosyada çökmeden açık hata üretme
  const corruptBytes = fs.readFileSync(path.join(FIXTURES, 'corrupt_archive.xlsx'));
  const corruptReport = eng.parseOpenXmlXlsxBytes(corruptBytes, 'corrupt_archive.xlsx');
  assert.equal(corruptReport.ok, false);
  assert.equal(corruptReport.error_code, 'CORRUPT_OR_UNSUPPORTED_WORKBOOK');

  // 6. Noktalı virgül (;) ayırıcılı CSV ve Türkçe sayısal biçim (1.250,50) okuma
  const vakaBCsv = fs.readFileSync(path.join(FIXTURES, 'vaka_b_altyapi_bagimlilik.csv'), 'utf8');
  const csvReportB = eng.readCsvContent(vakaBCsv, { fileName: 'vaka_b_altyapi_bagimlilik.csv' });
  assert.equal(csvReportB.ok, true);
  assert.equal(csvReportB.detected_delimiter, ';');
  assert.equal(eng.parseFlexibleNumber('1.250,50').value, 1250.5);
  assert.equal(eng.parseFlexibleNumber('1,250.50').value, 1250.5);
});

test('Test 4: CAELUS Veri Anlama ve Sütun Eşleme Motoru — Kurallı öneri ve kullanıcı değişikliği (Zorunlu LLM yok)', () => {
  const csvReport = eng.readCsvContent(eng.BUILTIN_CASES.VAKA_A.csvContent, {
    fileName: 'vaka_a_tedarik_zinciri.csv'
  });
  const sheet = csvReport.sheets[0];

  const initialMap = eng.suggestColumnMappings(sheet);
  assert.equal(initialMap.requiredRolesSatisfied, true);
  const prop0 = initialMap.proposals[0];
  assert.equal(prop0.originalHeader, 'Şirket Adı');
  assert.equal(prop0.proposedRole, 'source_entity_name');
  assert.equal(prop0.mappingMethod, 'RULE_BASED_DETERMINISTIC');
  assert.ok(prop0.ruleExplanationTr.length > 10);

  // Kullanıcı 10. sütunu ('Notlar') açıkça 'evidence_source' olarak değiştirsin
  const overriddenMap = eng.suggestColumnMappings(sheet, { 10: 'evidence_source' });
  const prop10 = overriddenMap.proposals[10];
  assert.equal(prop10.effectiveRole, 'evidence_source');
  assert.equal(prop10.mappingMethod, 'USER_OVERRIDE_CONFIRMED');
  assert.equal(prop10.confidenceClass, 'KULLANICI_TARAFINDAN_ONAYLANDI');
});

test('Test 5: Sürümlü Veri Sözleşmesi (CAELUS_DATA_PACKAGE_V1) 18 zorunlu alan ve satır bazlı hata izolasyonu', () => {
  const xlsxBytes = fs.readFileSync(path.join(FIXTURES, 'vaka_a_tedarik_zinciri.xlsx'));
  const wf = eng.runCompleteFirstRealTaskWorkflow({
    xlsxBytes,
    fileName: 'vaka_a_tedarik_zinciri.xlsx'
  });

  const pkg = wf.data_package;
  assert.equal(pkg.ok, true);
  assert.equal(pkg.contract_name, 'CAELUS_DATA_PACKAGE_V1');
  assert.equal(pkg.schema_version, '1.0.0');
  assert.equal(pkg.total_data_rows, 8);
  assert.equal(pkg.valid_record_count, 6);
  assert.equal(pkg.error_row_count, 2); // Satır 8 ve Satır 9 izole edildi, geçerli 6 satır korundu!

  // 18 zorunlu alan kontrolü
  for (const rec of pkg.records) {
    for (const reqField of eng.CAELUS_DATA_PACKAGE_SCHEMA_V1.requiredRecordFields) {
      assert.notEqual(rec[reqField], undefined, `Zorunlu alan eksik: ${reqField}`);
    }
    assert.equal(rec.epistemic_status, 'KAYNAKTA_IDDIA_EDILEN');
  }

  // Satır 8 (2026-02-30 + BOZUK_SKOR + BELIRSIZ_HACIM) ve Satır 9 (Boş Şirket Adı) hataları yakalandı mı?
  const row8Errors = pkg.import_errors.filter((e) => e.source_row === 8);
  const row9Errors = pkg.import_errors.filter((e) => e.source_row === 9);
  assert.equal(row8Errors.length, 3);
  assert.equal(row9Errors.length, 1);
  assert.equal(row9Errors[0].error_code, 'MISSING_SOURCE_ENTITY_NAME');
});

test('Test 6: Açıklanabilir Varlık Eşleştirme — Aday tespiti ve kullanıcı onayı olmadan sessiz birleştirme yapmama', () => {
  const csvReport = eng.readCsvContent(eng.BUILTIN_CASES.VAKA_A.csvContent, {
    fileName: 'vaka_a_tedarik_zinciri.csv'
  });
  const mapping = eng.suggestColumnMappings(csvReport.sheets[0]);
  const pkg = eng.validateAndBuildDataPackage(csvReport, csvReport.sheet_names[0], mapping);

  // 1. Kullanıcı henüz karar vermemişken (PENDING)
  const dedupPending = eng.detectEntityResolutionCandidates(pkg, {});
  assert.equal(dedupPending.candidate_count, 1);
  const alfaCluster = dedupPending.candidates[0];
  assert.equal(alfaCluster.canonical_stem, 'alfa teknoloji');
  assert.equal(alfaCluster.variants.length, 3); // "Alfa Teknoloji A.Ş.", "ALFA TEKNOLOJI AS", "Alfa Teknoloji"
  assert.equal(alfaCluster.decision, 'PENDING');

  // Kullanıcı onaylamadan dünya modeli kurulduğunda sessiz birleştirme YAPILMAMALI (3 ayrı varlık kalmalı)
  const worldUnmerged = eng.buildWorldModelFromPackage(pkg, dedupPending);
  assert.equal(worldUnmerged.entity_count, 9);

  // 2. Kullanıcı açıkça 'MERGE' (Birleştir) onayı verdiğinde tek kanonik varlıkta birleşmeli ve tüm kaynak satırları [2, 3, 4] korunmalı
  const dedupMerged = eng.detectEntityResolutionCandidates(pkg, {
    [alfaCluster.cluster_id]: 'MERGE'
  });
  const worldMerged = eng.buildWorldModelFromPackage(pkg, dedupMerged);
  assert.equal(worldMerged.entity_count, 7);
  const mergedAlfa = worldMerged.entities.find((e) => e.entity_id === 'ENT_ALFA_TEKNOLOJI');
  assert.ok(mergedAlfa);
  assert.deepEqual(mergedAlfa.source_rows, [2, 3, 4]);
});

test('Test 7 & 8 & 9: Vaka A ve Vaka B gerçek senaryo motoru bağlantısı, iki seçenek karşılaştırması ve satır bazlı kaynak izi', () => {
  const wfA = eng.runCompleteFirstRealTaskWorkflow({ caseId: 'VAKA_A' });
  const wfB = eng.runCompleteFirstRealTaskWorkflow({ caseId: 'VAKA_B' });

  assert.equal(wfA.ok, true);
  assert.equal(wfB.ok, true);

  // Seçenek 1 ve Seçenek 2 müdahalesiz temel akıştan (baseline) farklı ve daha düşük baskı üretmeli
  assert.ok(wfA.comparison_result.option_1.system_stress_score < wfA.comparison_result.baseline.system_stress_score);
  assert.ok(wfA.comparison_result.option_2.system_stress_score < wfA.comparison_result.baseline.system_stress_score);
  assert.ok(wfB.comparison_result.option_1.system_stress_score < wfB.comparison_result.baseline.system_stress_score);

  // Her düğüm karşılaştırması kaynak dosya, sayfa ve satır izine geri dönmeli
  for (const nc of wfA.comparison_result.node_comparisons) {
    assert.equal(nc.source_file, 'vaka_a_tedarik_zinciri.csv');
    assert.ok(Array.isArray(nc.source_rows) && nc.source_rows.length >= 1);
    assert.equal(nc.epistemic_class, 'SIMULE_EDILEN');
  }
});

test('Test 10: 7 Sayfalı .XLSX, Çok Sayfalı HTML/PDF Baskı ve CSV Formül Enjeksiyon Koruması', () => {
  const wfA = eng.runCompleteFirstRealTaskWorkflow({ caseId: 'VAKA_A' });

  // 1. 7 sayfalı .xlsx üretimi ve geri okuma doğrulaması
  const xlsxBytes = wfA.export_builders.buildXlsxBytes();
  assert.ok(xlsxBytes.length > 2000);
  const readBack = eng.parseOpenXmlXlsxBytes(xlsxBytes, 'rapor.xlsx');
  assert.equal(readBack.ok, true);
  assert.deepEqual(readBack.sheet_names, [
    'Özet',
    'Varlıklar',
    'İlişkiler',
    'Senaryo Karşılaştırması',
    'Varsayımlar',
    'Hatalar ve Eksik Veriler',
    'Kaynak İzleri'
  ]);

  // 2. Çok sayfalı HTML / PDF baskı raporu (@media print ve renkten bağımsız semboller)
  const htmlReport = wfA.export_builders.buildPrintHtml();
  assert.ok(htmlReport.includes('@media print'));
  assert.ok(htmlReport.includes('[▲ SİMÜLASYON]'));
  assert.ok(htmlReport.includes('[◆ VARSAYIM]'));
  assert.ok(htmlReport.includes('[● KULLANICI VERİSİ]'));
  assert.ok(htmlReport.includes('page-break-before'));

  // 3. CSV Formül Enjeksiyonu (=, +, -, @, \t, \r) koruması
  const injCsvRaw = fs.readFileSync(path.join(FIXTURES, 'formula_injection_test.csv'), 'utf8');
  const wfInj = eng.runCompleteFirstRealTaskWorkflow({
    csvContent: injCsvRaw,
    fileName: 'formula_injection_test.csv'
  });
  const exportedSafeCsv = wfInj.export_builders.buildSafeCsv();
  assert.ok(exportedSafeCsv.includes("\"'=CMD|' /C calc'!A0\""));
  assert.ok(exportedSafeCsv.includes("\"'+MALICIOUS_SUM(A1:A2)\""));
  assert.ok(exportedSafeCsv.includes("\"'\t=TAB_INJECT()\""));
  assert.ok(exportedSafeCsv.includes("\"'\r=CR_INJECT()\""));
});

test('Bölüm 12: CAELUS İsteğe Bağlı MCP Sunucusu — 10 Zorunlu Araç ve Güvenlik Kapıları', () => {
  const handler = createStandaloneCaelusMcpJsonRpcHandler({ allowWrite: false, allowExport: true });
  const listResp = handler.handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  });
  assert.equal(listResp.result.firstRealTaskToolsCount, 10);

  const required10Tools = [
    'inspect_imported_dataset',
    'list_import_errors',
    'suggest_column_mapping',
    'inspect_mapping_proposal',
    'list_entities',
    'inspect_relationship',
    'run_scenario',
    'compare_scenarios',
    'get_evidence',
    'export_result'
  ];

  for (const tName of required10Tools) {
    const res = handler.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: tName, arguments: { caseId: 'VAKA_A' } }
    });
    assert.equal(Boolean(res.result?.structuredResult?.ok), true, `MCP aracı başarısız: ${tName}`);
  }

  // Güvenlik Kapısı 1: Dosya sistemi path traversal reddi
  const traversalRes = handler.handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 99,
    method: 'tools/call',
    params: {
      name: 'inspect_imported_dataset',
      arguments: { filePath: '../../etc/passwd' }
    }
  });
  assert.ok(traversalRes.error);
  assert.equal(traversalRes.error.data.errorCode, 'MCP_SECURITY_FILESYSTEM_TRAVERSAL_BLOCKED');

  // Güvenlik Kapısı 2: İddia/hipotezi kesin olguya (BILINEN) yükseltme reddi
  const promoRes = handler.handleJsonRpcRequest({
    jsonrpc: '2.0',
    id: 100,
    method: 'tools/call',
    params: {
      name: 'get_evidence',
      arguments: { promoteToFact: true }
    }
  });
  assert.ok(promoRes.error);
  assert.equal(promoRes.error.data.errorCode, 'MCP_EPISTEMIC_PROMOTION_FORBIDDEN');
});
