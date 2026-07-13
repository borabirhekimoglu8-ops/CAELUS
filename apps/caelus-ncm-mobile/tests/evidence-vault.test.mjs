import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_VAULT_VERSION,
  analyzeEvidence,
  buildEvidenceContext,
  mergeEvidenceRecords,
  parseEvidenceFileText,
  spreadsheetRowsToJson,
  spreadsheetSheetsToJson,
  retrieveEvidence,
  scoreEvidenceSource,
} from "../lib/evidence-vault.mjs";

const REFERENCE_DATE = "2026-07-13T00:00:00.000Z";

function parse(input, options = {}) {
  return parseEvidenceFileText(input, {
    fileName: options.fileName || `evidence.${options.format || "txt"}`,
    format: options.format || "txt",
    source: options.source || {
      name: "Test source",
      publisher: "Test publisher",
      tier: 2,
      publishedAt: "2026-07-10",
      retrievedAt: REFERENCE_DATE,
    },
    referenceDate: REFERENCE_DATE,
  });
}

test("TXT ve Markdown girdileri deterministik, konumlu kanıt kayıtlarına dönüşür", () => {
  const text = "Liman bugün açıktır.\n\nFeribot kapasitesi 450 yolcudur.";
  const first = parse(text, { format: "txt", fileName: "liman.txt" });
  const second = parse(text, { format: "txt", fileName: "liman.txt" });
  assert.equal(first.audit.version, EVIDENCE_VAULT_VERSION);
  assert.equal(first.audit.externalCalls, false);
  assert.deepEqual(first, second);
  assert.equal(first.records.length, 2);
  assert.deepEqual(first.records.map((record) => record.locator.line), [1, 3]);
  assert.match(first.records[0].id, /^ev_[a-f0-9]{16}$/);
  assert.equal(first.records[0].source.publisher, "Test publisher");
  assert.equal(first.records[0].source.tierLabel, "institutional");

  const markdown = parse("# Durum\n\n- Rıhtım 2 kapalıdır.\n- Rıhtım 3 açıktır.", { format: "md", fileName: "durum.md" });
  assert.deepEqual(markdown.records.map((record) => record.text), ["Durum", "Rıhtım 2 kapalıdır.", "Rıhtım 3 açıktır."]);
});

test("CSV ve TSV satırları alanları korur; bozuk satır kanıt olarak kabul edilmez", () => {
  const csv = parse('hat,durum,kapasite\n"Kuşadası, Samos",aktif,"450 yolcu"\nEksik,alan\n', {
    format: "csv",
    fileName: "sefer.csv",
  });
  assert.equal(csv.records.length, 1);
  assert.equal(csv.records[0].fields.hat, "Kuşadası, Samos");
  assert.equal(csv.records[0].fields.kapasite, "450 yolcu");
  assert.equal(csv.records[0].locator.row, 2);
  assert.equal(csv.errors[0].code, "COLUMN_COUNT_MISMATCH");

  const tsv = parse("ürün\tstok\nA\t25\nB\t30", { format: "tsv", fileName: "stok.tsv" });
  assert.deepEqual(tsv.records.map((record) => record.fields.stok), ["25", "30"]);
});

test("JSON ve JSONL nesneleri sabit anahtar sırasıyla ayrıştırılır; geçersiz JSON fail-closed kalır", () => {
  const left = parse('[{"b":2,"a":"x"}]', { format: "json" });
  const right = parse('[{"a":"x","b":2}]', { format: "json" });
  assert.equal(left.records[0].id, right.records[0].id);
  assert.equal(left.records[0].text, "a: x; b: 2");
  assert.equal(left.records[0].locator.jsonPath, "$[0]");

  const jsonl = parse('{"olay":"aktif"}\n{bozuk}\n{"olay":"kapalı"}', { format: "jsonl" });
  assert.equal(jsonl.records.length, 2);
  assert.equal(jsonl.errors.length, 1);
  assert.equal(jsonl.errors[0].code, "INVALID_JSONL");
  assert.equal(jsonl.errors[0].locator.line, 2);

  const invalid = parse("{not-json}", { format: "json" });
  assert.equal(invalid.records.length, 0);
  assert.equal(invalid.errors[0].code, "INVALID_JSON");
});

test("kaynak katmanı ve güncellik puanı yalnız açık tarihlerden sabit tamsayı üretir", () => {
  assert.deepEqual(
    scoreEvidenceSource(
      { name: "Official", tier: "official", publishedAt: "2026-07-10", retrievedAt: REFERENCE_DATE },
      { referenceDate: REFERENCE_DATE },
    ),
    { tier: 850, recency: 150, total: 1000 },
  );
  assert.deepEqual(
    scoreEvidenceSource({ name: "Unknown", tier: 4, publishedAt: "2010-01-01" }, { referenceDate: REFERENCE_DATE }),
    { tier: 250, recency: 10, total: 260 },
  );
  assert.deepEqual(
    scoreEvidenceSource({ name: "No dates", tier: 3 }),
    { tier: 450, recency: 0, total: 450 },
  );
});

test("aynı içerik sabit kimlikle tekilleşir, bağımsız kökenler teyit sayılır", () => {
  const statement = "Kuşadası-Samos hattı bugün açıktır.";
  const official = parse(statement, {
    source: { name: "Port authority", uri: "https://port.example/status", tier: 1, publishedAt: "2026-07-13" },
  });
  const operator = parse(statement, {
    source: { name: "Ferry operator", uri: "https://operator.example/status", tier: 2, publishedAt: "2026-07-13" },
  });
  const merged = mergeEvidenceRecords(official, operator, official.records);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.duplicates, 2);
  assert.equal(merged.records[0].provenance.length, 2);
  assert.equal(merged.records[0].corroboration.independentSourceCount, 2);
  assert.equal(merged.records[0].corroboration.corroborated, true);
  assert.equal(merged.audit.corroboratedCount, 1);
});

test("aynı yayıncının iki aynası bağımsız teyit sayılmaz", () => {
  const statement = "Liman bugün açıktır.";
  const first = parse(statement, {
    source: { name: "Mirror A", publisher: "Same Agency", uri: "https://a.example/status", tier: 2 },
  });
  const second = parse(statement, {
    source: { name: "Mirror B", publisher: "Same Agency", uri: "https://b.example/status", tier: 2 },
  });
  const merged = mergeEvidenceRecords(first, second);
  assert.equal(merged.records[0].provenance.length, 2);
  assert.equal(merged.records[0].corroboration.independentSourceCount, 1);
  assert.equal(merged.records[0].corroboration.corroborated, false);
});

test("farklı yayıncı beyanlı kullanıcı belgeleri bağımsız kökenlerini korur", () => {
  const statement = "Samos limanı bugün açıktır.";
  const first = parse(statement, {
    source: { name: "a.csv", kind: "user_file", publisher: "Kurum A", tier: "institutional" },
  });
  const second = parse(statement, {
    source: { name: "b.csv", kind: "user_file", publisher: "Kurum B", tier: "institutional" },
  });
  const merged = mergeEvidenceRecords(first, second);
  assert.equal(merged.records[0].source.kind, "user_file");
  assert.equal(merged.records[0].corroboration.independentSourceCount, 2);
  assert.equal(merged.records[0].corroboration.corroborated, true);
});

test("açık negasyon ve aynı birimdeki sayısal uyuşmazlıklar çelişki olarak işaretlenir", () => {
  const positive = parse("Kuşadası Samos feribot seferi iptal edildi.", { source: { name: "A", tier: 1 } });
  const negative = parse("Kuşadası Samos feribot seferi iptal edilmedi.", { source: { name: "B", tier: 1 } });
  const capacity100 = parse("Samos liman kapasitesi 100 ton.", { source: { name: "C", tier: 2 } });
  const capacity120 = parse("Samos liman kapasitesi 120 ton.", { source: { name: "D", tier: 2 } });
  const records = mergeEvidenceRecords(positive, negative, capacity100, capacity120).records;
  const analysis = analyzeEvidence(records);
  assert.ok(analysis.contradictions.some((item) => item.type === "EXPLICIT_NEGATION"));
  assert.ok(analysis.contradictions.some((item) => item.type === "NUMERIC_CONFLICT"));
  assert.equal(analysis.audit.contradictionCount, 2);
  assert.ok(analysis.records.filter((record) => record.contradicted).length >= 4);
});

test("token tabanlı yerel arama yalnız ilgili kanıtı sıralar ve alıntı üretir", () => {
  const maritime = parse("Kuşadası Samos feribot hattında seferler devam ediyor.", {
    source: { name: "Liman", tier: 1, uri: "https://port.example/ferry" },
  });
  const energy = parse("Güneş santralinin üretimi 80 kW olarak ölçüldü.", {
    source: { name: "Enerji", tier: 1, uri: "https://energy.example/output" },
  });
  const records = mergeEvidenceRecords(maritime, energy).records;
  const results = retrieveEvidence("Samos feribot seferi", records);
  assert.equal(results.length, 1);
  assert.match(results[0].text, /feribot/i);
  assert.ok(results[0].retrieval.matchedTokens.includes("samos"));

  const context = buildEvidenceContext("Samos feribot seferi", records);
  assert.equal(context.status, "grounded");
  assert.match(context.context, /^\[E1\]/);
  assert.equal(context.citations[0].uri, "https://port.example/ferry");
  assert.equal(context.audit.factPromotionAllowed, true);
});

test("tek zayıf kaynak fact seviyesine yükseltilmez; zıt güçlü kayıtlar contested kalır", () => {
  const weak = parse("Samos feribot seferi yarın başlayacak.", { source: { name: "Anonymous post", tier: 4 } });
  const weakContext = buildEvidenceContext("Samos feribot seferi", weak.records);
  assert.equal(weakContext.status, "insufficient");
  assert.equal(weakContext.audit.weakSingleSourceCount, 1);
  assert.equal(weakContext.audit.factPromotionAllowed, false);

  const yes = parse("Samos feribot seferi iptal edildi.", { source: { name: "Authority A", tier: 1 } });
  const no = parse("Samos feribot seferi iptal edilmedi.", { source: { name: "Authority B", tier: 1 } });
  const contested = buildEvidenceContext("Samos feribot seferi iptal", mergeEvidenceRecords(yes, no).records);
  assert.equal(contested.status, "contested");
  assert.equal(contested.audit.factPromotionAllowed, false);
  assert.equal(contested.contradictions[0].type, "EXPLICIT_NEGATION");
});

test("boş, türü belirsiz ve string olmayan girdiler kanıt üretmeden kapanır", () => {
  const empty = parseEvidenceFileText("", { format: "txt", fileName: "empty.txt" });
  assert.equal(empty.records.length, 0);
  assert.equal(empty.errors[0].code, "EMPTY_INPUT");

  const unsupported = parseEvidenceFileText("x", { fileName: "evidence.pdf" });
  assert.equal(unsupported.records.length, 0);
  assert.equal(unsupported.errors[0].code, "UNSUPPORTED_FORMAT");

  const invalid = parseEvidenceFileText(null, { format: "json", fileName: "x.json" });
  assert.equal(invalid.records.length, 0);
  assert.equal(invalid.errors[0].code, "INVALID_INPUT");
});

test("XLSX satırları başlıkları ve tarihleri koruyarak JSON kanıtına dönüşür", () => {
  const json = spreadsheetRowsToJson([
    ["Liman", "Liman", "Tarih"],
    ["Samos", 42, new Date("2026-07-13T10:30:00.000Z")],
    [null, "", null],
  ]);
  assert.deepEqual(JSON.parse(json), [{
    Liman: "Samos",
    Liman_2: 42,
    Tarih: "2026-07-13T10:30:00.000Z",
  }]);
  assert.throws(() => spreadsheetRowsToJson([{ sheet: "Sheet 1", data: [["x"]] }]), /satır dizisi/);
  assert.throws(() => spreadsheetRowsToJson([Array.from({ length: 201 })]), /200 sütun/);

  const sheets = JSON.parse(spreadsheetSheetsToJson([
    { sheet: "Seferler", data: [["hat"], ["Samos"]] },
    { sheet: "Limanlar", data: [["durum"], ["açık"]] },
  ]));
  assert.deepEqual(sheets, [
    { hat: "Samos", __caelus_sheet: "Seferler" },
    { durum: "açık", __caelus_sheet: "Limanlar" },
  ]);
});

test("keşif indeksinin kopyası bağımsız teyit sayısını artırmaz", () => {
  const statement = "Samos limanı bugün açıktır.";
  const witness = parse(statement, {
    source: { name: "Agency", publisher: "Agency", uri: "https://agency.example/status", tier: 2 },
  });
  const discovery = parse(statement, {
    source: { name: "Index", publisher: "news.example", uri: "https://news.example/item", tier: 3, promotionEligible: false },
  });
  const merged = mergeEvidenceRecords(witness, discovery);
  assert.equal(merged.records[0].provenance.length, 2);
  assert.equal(merged.records[0].corroboration.independentSourceCount, 1);
  assert.equal(merged.records[0].corroboration.corroborated, false);
});

test("bin kayıt sorgu öncesi karesel taranmaz; çelişki yalnız ilgili adaylarda aranır", () => {
  const rows = Array.from({ length: 1_000 }, (_, index) => ({
    id: index + 1,
    durum: index % 2 ? "Kuşadası operasyon kaydı" : "Samos liman kapasite kaydı",
    miktar: index + 10,
  }));
  const parsed = parse(JSON.stringify(rows), { format: "json", fileName: "large.json" });
  assert.equal(parsed.records.length, 1_000);
  const started = performance.now();
  const merged = mergeEvidenceRecords(parsed);
  const context = buildEvidenceContext("Samos liman kapasite", merged.records, { limit: 6 });
  const elapsed = performance.now() - started;
  assert.equal(merged.audit.contradictionScanComplete, false);
  assert.equal(context.records.length, 6);
  assert.ok(elapsed < 3_000, `indexed evidence path took ${Math.round(elapsed)}ms`);
});

test("düşük sıralı zıt kayıt kalabalıkta kaybolmaz", () => {
  const primary = parse("Samos limanı bugün açıktır.", { source: { name: "Primary", publisher: "Primary", tier: 1 } });
  const opposite = parse("Samos limanı bugün açık değildir.", { source: { name: "Weak", publisher: "Weak", tier: 4 } });
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
  const fillers = words.map((word) => parse(`Samos limanı bugün açık operasyon ${word}.`, {
    source: { name: word, publisher: word, tier: 2 },
  }));
  const context = buildEvidenceContext("Samos limanı bugün açık mı?", mergeEvidenceRecords(primary, opposite, ...fillers).records, { limit: 6 });
  assert.equal(context.status, "contested");
  assert.ok(context.contradictions.some((item) => item.type === "EXPLICIT_NEGATION"));
  assert.ok(context.records.some((record) => /açık değildir/i.test(record.text)));
  assert.ok(context.records.filter((record) => record.contradicted).length >= 2);
});

test("farklı tarih veya varlıktaki ölçümler çelişmez; aynı kapsamlı farklı değer çelişir", () => {
  const timeSeries = parse("tarih,liman,kapasite\n2026-07-12,Samos,100 ton\n2026-07-13,Samos,120 ton", { format: "csv" });
  const timeContext = buildEvidenceContext("Samos liman kapasite", timeSeries.records);
  assert.equal(timeContext.contradictions.length, 0);
  assert.ok(timeSeries.records.every((record) => record.signals.numbers.length === 1));

  const locations = parse("tarih,liman,kapasite\n2026-07-13,Samos,100 ton\n2026-07-13,Kuşadası,120 ton", { format: "csv" });
  assert.equal(buildEvidenceContext("liman kapasite", locations.records).contradictions.length, 0);

  const sameScope = parse("tarih,liman,kapasite\n2026-07-13,Samos,100 ton\n2026-07-13,Samos,120 ton", { format: "csv" });
  assert.ok(buildEvidenceContext("Samos liman kapasite", sameScope.records).contradictions.some((item) => item.type === "NUMERIC_CONFLICT"));

  const station = parse('[{"station":"A","metric":"power output","value":"10 kW"}]', { format: "json", source: { name: "Station feed", tier: 2 } });
  const sensor = parse('[{"sensor":"B","metric":"power output","value":"20 kW"}]', { format: "json", source: { name: "Sensor feed", tier: 2 } });
  assert.equal(buildEvidenceContext("power output", mergeEvidenceRecords(station, sensor).records).contradictions.length, 0);
});

test("uzun metin sessizce kesilmez, kayıt sınırı açık uyarıyla uygulanır", () => {
  const longText = `${"Samos feribot operasyonu sürüyor. ".repeat(800)}SON-İŞARET`;
  const text = parse(longText, { format: "txt", fileName: "uzun.txt" });
  assert.ok(text.records.length > 1);
  assert.match(text.records.at(-1).text, /SON-İŞARET$/);
  assert.equal(text.errors.length, 0);

  const rows = Array.from({ length: 10_001 }, (_, index) => ({ id: index + 1, durum: `kayıt ${index + 1}` }));
  const json = parse(JSON.stringify(rows), { format: "json", fileName: "sinir.json" });
  assert.equal(json.records.length, 10_000);
  assert.ok(json.errors.some((error) => error.code === "RECORD_LIMIT"));

  const csvInput = `id,durum\n${rows.map((row) => `${row.id},${row.durum}`).join("\n")}`;
  const csv = parse(csvInput, { format: "csv", fileName: "sinir.csv" });
  assert.equal(csv.records.length, 10_000);
  assert.ok(csv.errors.some((error) => error.code === "RECORD_LIMIT"));
});
