/**
 * CAELUS Evidence Vault
 *
 * Deterministic, local-only evidence ingestion and retrieval. This module does
 * not fetch URLs, call a model, read browser state, or infer missing facts.
 */

export const EVIDENCE_VAULT_VERSION = "EV-1.0.0";

export const SOURCE_TIERS = Object.freeze({
  1: Object.freeze({ label: "primary", baseScore: 850 }),
  2: Object.freeze({ label: "institutional", baseScore: 650 }),
  3: Object.freeze({ label: "community", baseScore: 450 }),
  4: Object.freeze({ label: "unknown", baseScore: 250 }),
});

const MAX_INPUT_CHARS = 5_000_000;
const MAX_RECORD_CHARS = 12_000;
const MAX_RECORDS_PER_PARSE = 10_000;
const MAX_GLOBAL_CONTRADICTION_RECORDS = 200;
const SUPPORTED_FORMATS = new Set(["txt", "md", "csv", "tsv", "json", "jsonl"]);
const NEGATION_WORDS = new Set([
  "degil", "değil", "hayir", "hic", "never", "no", "none", "not", "without", "yok",
]);
const ASSERTION_FILLERS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "bir", "bu", "da", "de", "dir",
  "dır", "dur", "dür", "for", "from", "icin", "ile", "in", "is", "it", "mi", "mu", "mı", "mü",
  "of", "on", "olan", "olarak", "oldu", "the", "to", "ve", "var", "was", "were",
]);
const UNIT_TOKENS = new Set([
  "%", "adet", "amp", "c", "cm", "dakika", "day", "days", "dk", "eur", "gb", "g", "gun", "h",
  "hour", "hours", "kg", "km", "kw", "kwh", "l", "litre", "liter", "m", "mb", "min", "minute",
  "minutes", "mm", "mw", "mwh", "s", "saat", "second", "seconds", "sn", "tl", "ton", "try", "usd",
]);

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function cleanText(value, limit = MAX_RECORD_CHARS) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim()
    .slice(0, limit);
}

export function spreadsheetRowsToJson(rows) {
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) {
    throw new Error("XLSX çalışma sayfası geçerli bir satır dizisi değil.");
  }
  if (!rows.length) return "[]";
  if (rows.length > 10_001) throw new Error("XLSX dosyası 10.000 veri satırı sınırını aşıyor.");
  const width = Math.max(...rows.map((row) => row.length));
  if (width > 200) throw new Error("XLSX dosyası 200 sütun sınırını aşıyor.");
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, index) => {
    const base = String(rows[0]?.[index] ?? "").trim() || `column_${index + 1}`;
    const key = fold(base);
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1 ? base : `${base}_${count}`;
  });
  const values = rows.slice(1)
    .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => {
      const value = row[index];
      return [header, value instanceof Date ? value.toISOString() : value ?? ""];
    })));
  return JSON.stringify(values);
}

export function spreadsheetSheetsToJson(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) {
    throw new Error("XLSX dosyasında okunabilir çalışma sayfası bulunamadı.");
  }
  const values = [];
  for (const [index, sheet] of sheets.entries()) {
    if (!sheet || typeof sheet !== "object" || typeof sheet.sheet !== "string" || !Array.isArray(sheet.data)) {
      throw new Error(`XLSX çalışma sayfası ${index + 1} geçersiz.`);
    }
    const rows = JSON.parse(spreadsheetRowsToJson(sheet.data));
    for (const row of rows) {
      values.push({ ...row, __caelus_sheet: cleanText(sheet.sheet, 200) || `Sheet ${index + 1}` });
      if (values.length > MAX_RECORDS_PER_PARSE) {
        throw new Error("XLSX dosyası toplam 10.000 veri satırı sınırını aşıyor.");
      }
    }
  }
  return JSON.stringify(values);
}

function fold(value) {
  return cleanText(value)
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

// 64-bit FNV-1a implemented with BigInt so IDs do not depend on Node crypto or browser APIs.
function stableHash(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(String(value));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const millis = Date.parse(text);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString();
}

function normalizeTier(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 4) return numeric;
  const key = fold(value).replace(/\s/g, "");
  if (["primary", "official", "resmi", "birincil", "authority"].includes(key)) return 1;
  if (["institutional", "reputable", "kurumsal", "academic", "akademik", "secondary"].includes(key)) return 2;
  if (["community", "topluluk", "tertiary", "editorial"].includes(key)) return 3;
  return 4;
}

function recencyScore(publishedAt, referenceDate) {
  const published = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  const reference = referenceDate ? Date.parse(referenceDate) : Number.NaN;
  if (!Number.isFinite(published) || !Number.isFinite(reference) || published > reference) return 0;
  const ageDays = Math.floor((reference - published) / 86_400_000);
  if (ageDays <= 7) return 150;
  if (ageDays <= 30) return 130;
  if (ageDays <= 90) return 110;
  if (ageDays <= 365) return 80;
  if (ageDays <= 1_095) return 40;
  return 10;
}

function normalizeSource(source = {}, fallbackName = "local-evidence") {
  const tier = normalizeTier(source.tier);
  const publishedAt = normalizeIsoDate(source.publishedAt);
  const retrievedAt = normalizeIsoDate(source.retrievedAt);
  const normalized = {
    name: cleanText(source.name || fallbackName, 300) || "local-evidence",
    kind: source.kind === "user_file" ? "user_file" : source.kind === "public_source" ? "public_source" : null,
    uri: cleanText(source.uri, 2_000) || null,
    publisher: cleanText(source.publisher, 300) || null,
    tier,
    tierLabel: SOURCE_TIERS[tier].label,
    publishedAt,
    retrievedAt,
    license: cleanText(source.license, 200) || null,
    promotionEligible: source.promotionEligible !== false,
  };
  const identity = {
    name: normalized.name,
    kind: normalized.kind,
    uri: normalized.uri,
    publisher: normalized.publisher,
    tier: normalized.tier,
    promotionEligible: normalized.promotionEligible,
  };
  return {
    // Retrieval time and publication metadata may change without turning the
    // same publisher/document into an independent witness.
    id: `src_${stableHash(stableStringify(identity))}`,
    ...normalized,
  };
}

function sourceIndependenceKey(source) {
  const publisher = fold(source?.publisher);
  if (publisher) return `publisher:${publisher}`;
  try {
    const host = new URL(source?.uri || "").hostname.toLowerCase().replace(/^www\./, "");
    if (host) return `host:${host}`;
  } catch {
    // A local file or opaque source ID has no URL host.
  }
  return `source:${source?.id || "unknown"}`;
}

export function scoreEvidenceSource(source = {}, options = {}) {
  const normalized = normalizeSource(source, source.name);
  const referenceDate = normalizeIsoDate(options.referenceDate) || normalized.retrievedAt;
  const tier = SOURCE_TIERS[normalized.tier].baseScore;
  const recency = recencyScore(normalized.publishedAt, referenceDate);
  return Object.freeze({ tier, recency, total: clampInteger(tier + recency, 0, 1_000) });
}

function parseLocalizedNumber(raw) {
  let text = String(raw).replace(/\s/g, "");
  if (!text) return Number.NaN;
  if (text.includes(",")) {
    text = text.includes(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  return Number(text);
}

function canonicalUnit(value) {
  const unit = fold(value);
  const aliases = {
    day: "day", days: "day", gun: "day",
    dakika: "minute", dk: "minute", min: "minute", minute: "minute", minutes: "minute",
    h: "hour", hour: "hour", hours: "hour", saat: "hour",
    litre: "l", liter: "l",
    tl: "try",
  };
  return aliases[unit] || unit;
}

function extractNumbers(text) {
  const results = [];
  const pattern = /(-?\d+(?:[.,]\d+)?)\s*(%|[\p{L}]{1,12})?/gu;
  const withoutDates = String(text).replace(/\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/gu, " ");
  for (const match of withoutDates.matchAll(pattern)) {
    const value = parseLocalizedNumber(match[1]);
    if (!Number.isFinite(value)) continue;
    results.push({
      raw: match[0].trim(),
      value,
      unit: match[2] ? canonicalUnit(match[2]) : null,
    });
  }
  return results;
}

function detectPolarity(text) {
  const normalized = fold(text);
  const tokens = normalized.split(" ").filter(Boolean);
  const explicit = tokens.some((token) => NEGATION_WORDS.has(token) || /^degil/.test(token));
  const suffix = tokens.some((token) =>
    /(?:miyor|miyor|muyor|muyor|madi|medi|mamis|memis|mayacak|meyecek|maz|mez)$/.test(token));
  return explicit || suffix ? "negative" : "positive";
}

function stemAssertionToken(token) {
  return token
    .replace(/(?:miyor|miyor|muyor|muyor)$/, "")
    .replace(/(?:iyor|iyor|uyor|uyor)$/, "")
    .replace(/(?:madi|medi|mamis|memis|mayacak|meyecek)$/, "")
    .replace(/(?:ildi|ildi|uldu|uldu)$/, "il")
    .replace(/(?:dir|tir|dur|tur)$/, "")
    .replace(/(?:di|ti)$/, "");
}

function tokenize(value, { assertion = false } = {}) {
  const raw = fold(value).split(" ").filter((token) => token.length >= 2 || /^\d+$/.test(token) || token === "%");
  if (!assertion) return [...new Set(raw.filter((token) => !ASSERTION_FILLERS.has(token)))];
  return [...new Set(raw
    .filter((token) => !ASSERTION_FILLERS.has(token) && !NEGATION_WORDS.has(token) && !/^degil/.test(token))
    .filter((token) => !/^\d+(?:[.,]\d+)?$/.test(token) && !UNIT_TOKENS.has(token))
    .map(stemAssertionToken)
    .filter((token) => token.length >= 2))];
}

function makeSignals(text) {
  return {
    polarity: detectPolarity(text),
    numbers: extractNumbers(text),
    assertionTokens: tokenize(text, { assertion: true }).sort(),
  };
}

function makeRecord({ text, format, locator, fields, source, referenceDate }) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  const normalizedText = fold(cleaned);
  if (!normalizedText) return null;
  const fingerprint = stableHash(normalizedText);
  const scores = scoreEvidenceSource(source, { referenceDate });
  return {
    id: `ev_${fingerprint}`,
    fingerprint,
    text: cleaned,
    normalizedText,
    format,
    locator,
    fields: fields || null,
    source,
    scores,
    signals: makeSignals(cleaned),
    provenance: [source],
    duplicateCount: 0,
    corroboration: {
      independentSourceCount: 1,
      supportingRecordIds: [`ev_${fingerprint}`],
      corroborated: false,
    },
  };
}

function inferFormat(options) {
  const explicit = fold(options.format).replace(/^\./, "");
  if (SUPPORTED_FORMATS.has(explicit)) return explicit;
  const extension = String(options.fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (SUPPORTED_FORMATS.has(extension)) return extension;
  const mime = String(options.mimeType || "").toLowerCase();
  if (mime.includes("jsonl") || mime.includes("ndjson")) return "jsonl";
  if (mime.includes("json")) return "json";
  if (mime.includes("csv")) return "csv";
  if (mime.includes("tab-separated")) return "tsv";
  if (mime.includes("markdown")) return "md";
  if (mime.startsWith("text/")) return "txt";
  return null;
}

function stripMarkdown(text) {
  return cleanText(text, MAX_INPUT_CHARS)
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/u, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1 ($2)")
    .replace(/(?:\*\*|__)(.+?)(?:\*\*|__)/gu, "$1")
    .replace(/(?:\*|_)(.+?)(?:\*|_)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^>\s*/u, "")
    .trim();
}

function chunkRecordText(value) {
  const chunks = [];
  let rest = cleanText(value, MAX_INPUT_CHARS);
  while (rest.length > MAX_RECORD_CHARS) {
    const slice = rest.slice(0, MAX_RECORD_CHARS);
    const boundary = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const end = boundary > MAX_RECORD_CHARS * 0.6 ? boundary : MAX_RECORD_CHARS;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function parseTextBlocks(input, format, fileName, source, referenceDate) {
  const records = [];
  const lines = String(input).replace(/\r\n?/g, "\n").split("\n");
  let buffer = [];
  let startLine = 1;
  const flush = () => {
    if (!buffer.length) return;
    const raw = buffer.join("\n");
    const text = format === "md" ? stripMarkdown(raw) : cleanText(raw, MAX_INPUT_CHARS);
    for (const chunk of chunkRecordText(text)) {
      if (records.length >= MAX_RECORDS_PER_PARSE) break;
      const record = makeRecord({
        text: chunk,
        format,
        locator: { fileName, line: startLine },
        fields: null,
        source,
        referenceDate,
      });
      if (record) records.push(record);
    }
    buffer = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const markdownBoundary = format === "md" && /^\s*(?:#{1,6}\s+|[-*+] |\d+[.)] |>\s*)/u.test(line);
    if (!line.trim()) {
      flush();
    } else {
      if (markdownBoundary && buffer.length) flush();
      if (!buffer.length) startLine = index + 1;
      buffer.push(line);
      if (markdownBoundary) flush();
    }
  }
  flush();
  return records;
}

function parseDelimitedRows(input, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      if (rows.length > MAX_RECORDS_PER_PARSE) return { rows, unclosedQuote: quoted, truncated: true };
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0].trim() || !rows.length) rows.push(row);
  return { rows, unclosedQuote: quoted, truncated: false };
}

function uniqueHeaders(row) {
  const seen = new Map();
  return row.map((header, index) => {
    const base = cleanText(header, 200) || `column_${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function parseDelimited(input, format, fileName, source, referenceDate) {
  const errors = [];
  const { rows, unclosedQuote, truncated } = parseDelimitedRows(input, format === "tsv" ? "\t" : ",");
  if (unclosedQuote) errors.push({ code: "UNCLOSED_QUOTE", message: "Quoted field is not closed.", locator: { fileName } });
  if (truncated) errors.push({ code: "RECORD_LIMIT", message: `Only the first ${MAX_RECORDS_PER_PARSE} data records are accepted. Split the file to preserve scope.`, locator: { fileName } });
  if (!rows.length || rows[0].every((value) => !value.trim())) {
    return { records: [], errors: [{ code: "MISSING_HEADER", message: "Delimited input has no header row.", locator: { fileName } }] };
  }
  const headers = uniqueHeaders(rows[0]);
  const records = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every((value) => !value.trim())) continue;
    if (row.length !== headers.length) {
      errors.push({
        code: "COLUMN_COUNT_MISMATCH",
        message: `Row ${index + 1} has ${row.length} fields; expected ${headers.length}.`,
        locator: { fileName, row: index + 1 },
      });
      continue;
    }
    if (row.some((value) => value.length > MAX_RECORD_CHARS)) {
      errors.push({ code: "RECORD_TOO_LARGE", message: `Row ${index + 1} exceeds the per-record text limit.`, locator: { fileName, row: index + 1 } });
      continue;
    }
    const fields = Object.fromEntries(headers.map((header, column) => [header, cleanText(row[column])]));
    const text = headers.map((header) => `${header}: ${fields[header]}`).join("; ");
    const record = makeRecord({
      text,
      format,
      locator: { fileName, row: index + 1 },
      fields,
      source,
      referenceDate,
    });
    if (record) records.push(record);
  }
  return { records, errors };
}

function flattenJson(value, prefix = "", result = {}, depth = 0) {
  if (depth > 8) {
    result[prefix || "value"] = "[depth-limit]";
    return result;
  }
  if (value === null || typeof value !== "object") {
    result[prefix || "value"] = value;
    return result;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== "object")) {
      result[prefix || "value"] = value.join(", ");
      return result;
    }
    value.forEach((item, index) => flattenJson(item, `${prefix}[${index}]`, result, depth + 1));
    return result;
  }
  for (const key of Object.keys(value).sort()) {
    flattenJson(value[key], prefix ? `${prefix}.${key}` : key, result, depth + 1);
  }
  return result;
}

function jsonItemText(item) {
  if (item === null) return "value: null";
  if (typeof item !== "object") return `value: ${String(item)}`;
  const fields = flattenJson(item);
  return Object.keys(fields).sort().map((key) => `${key}: ${String(fields[key])}`).join("; ");
}

function extractJsonItems(value) {
  if (Array.isArray(value)) return { items: value, basePath: "$" };
  if (value && typeof value === "object") {
    for (const key of ["records", "items", "data", "results"]) {
      if (Array.isArray(value[key])) return { items: value[key], basePath: `$.${key}` };
    }
  }
  return { items: [value], basePath: "$" };
}

function parseJson(input, format, fileName, source, referenceDate) {
  const records = [];
  const errors = [];
  const append = (item, jsonPath, line) => {
    const fields = item && typeof item === "object" && !Array.isArray(item) ? flattenJson(item) : { value: item };
    const text = jsonItemText(item);
    if (text.length > MAX_RECORD_CHARS) {
      errors.push({ code: "RECORD_TOO_LARGE", message: `${jsonPath} exceeds the per-record text limit.`, locator: { fileName, ...(line ? { line } : {}), jsonPath } });
      return;
    }
    const record = makeRecord({
      text,
      format,
      locator: { fileName, ...(line ? { line } : {}), jsonPath },
      fields,
      source,
      referenceDate,
    });
    if (record) records.push(record);
  };
  if (format === "jsonl") {
    const lines = String(input).replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      if (records.length >= MAX_RECORDS_PER_PARSE) {
        errors.push({ code: "RECORD_LIMIT", message: `Only the first ${MAX_RECORDS_PER_PARSE} data records are accepted. Split the file to preserve scope.`, locator: { fileName, line: index + 1 } });
        break;
      }
      try {
        append(JSON.parse(line), `$[${index}]`, index + 1);
      } catch {
        errors.push({ code: "INVALID_JSONL", message: `Line ${index + 1} is not valid JSON.`, locator: { fileName, line: index + 1 } });
      }
    }
    return { records, errors };
  }
  try {
    const parsed = JSON.parse(input);
    const { items, basePath } = extractJsonItems(parsed);
    const isCollection = Array.isArray(parsed) || basePath !== "$";
    if (items.length > MAX_RECORDS_PER_PARSE) {
      errors.push({ code: "RECORD_LIMIT", message: `Only the first ${MAX_RECORDS_PER_PARSE} data records are accepted. Split the file to preserve scope.`, locator: { fileName } });
    }
    items.slice(0, MAX_RECORDS_PER_PARSE).forEach((item, index) => append(item, isCollection ? `${basePath}[${index}]` : "$"));
  } catch {
    errors.push({ code: "INVALID_JSON", message: "Input is not valid JSON.", locator: { fileName } });
  }
  return { records, errors };
}

function mergeRecordArrays(inputs) {
  const flat = inputs.flatMap((input) => {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    return Array.isArray(input.records) ? input.records : [];
  });
  const groups = new Map();
  for (const record of flat) {
    if (!record?.fingerprint || !record?.source?.id) continue;
    const list = groups.get(record.fingerprint) || [];
    list.push(record);
    groups.set(record.fingerprint, list);
  }
  const records = [];
  let duplicates = 0;
  for (const group of groups.values()) {
    group.sort((left, right) => right.scores.total - left.scores.total || left.source.id.localeCompare(right.source.id));
    const best = group[0];
    const provenanceMap = new Map();
    let occurrenceCount = 0;
    for (const item of group) {
      occurrenceCount += 1 + (Number(item.duplicateCount) || 0);
      for (const source of item.provenance || [item.source]) provenanceMap.set(source.id, source);
    }
    const provenance = [...provenanceMap.values()].sort((left, right) => left.id.localeCompare(right.id));
    const independentSourceCount = new Set(
      provenance.filter((source) => source.promotionEligible !== false).map(sourceIndependenceKey),
    ).size;
    const duplicateCount = Math.max(0, occurrenceCount - 1);
    duplicates += duplicateCount;
    records.push({
      ...best,
      provenance,
      duplicateCount,
      corroboration: {
        independentSourceCount,
        supportingRecordIds: group.map((item) => item.id).sort(),
        corroborated: independentSourceCount >= 2,
      },
    });
  }
  return { records, duplicates, inputCount: flat.length };
}

function jaccard(left, right) {
  if (!left.length || !right.length) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function comparableNumbers(left, right) {
  const conflicts = [];
  for (const a of left) {
    for (const b of right) {
      if ((a.unit || null) !== (b.unit || null)) continue;
      if (a.value !== b.value) conflicts.push({ left: a, right: b });
    }
  }
  return conflicts;
}

function structuredScope(record) {
  if (!record?.fields || typeof record.fields !== "object") return null;
  const scope = new Map();
  for (const [key, value] of Object.entries(record.fields)) {
    const normalizedKey = fold(key);
    if (!/(?:^|\s|\.)(?:id|date|tarih|timestamp|time|zaman|entity|varlik|liman|port|location|konum|site|station|istasyon|sensor|device|name|ad)(?:$|\s|\.)/.test(normalizedKey.replace(/_/g, " "))) continue;
    const normalizedValue = fold(value);
    if (normalizedValue) scope.set(normalizedKey, normalizedValue);
  }
  return scope.size ? scope : null;
}

function sameStructuredScope(left, right) {
  const a = structuredScope(left);
  const b = structuredScope(right);
  if (!a || !b) return true;
  let overlap = false;
  for (const [key, value] of a) {
    if (!b.has(key)) continue;
    overlap = true;
    if (b.get(key) !== value) return false;
  }
  return overlap;
}

function detectContradictions(records) {
  const contradictions = [];
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      if (!sameStructuredScope(left, right)) continue;
      const similarity = jaccard(left.signals.assertionTokens, right.signals.assertionTokens);
      const minimumShared = left.signals.assertionTokens.length <= 2 || right.signals.assertionTokens.length <= 2 ? 1 : 2;
      const shared = left.signals.assertionTokens.filter((token) => right.signals.assertionTokens.includes(token)).length;
      if (shared < minimumShared || similarity < 0.55) continue;
      if (left.signals.polarity !== right.signals.polarity) {
        const recordIds = [left.id, right.id].sort();
        contradictions.push({
          id: `cx_${stableHash(`negation:${recordIds.join(":")}`)}`,
          type: "EXPLICIT_NEGATION",
          recordIds,
          similarity: Math.round(similarity * 1_000),
          detail: "Semantically overlapping claims have opposite polarity.",
        });
      }
      const numericConflicts = comparableNumbers(left.signals.numbers, right.signals.numbers);
      if (numericConflicts.length) {
        const recordIds = [left.id, right.id].sort();
        contradictions.push({
          id: `cx_${stableHash(`numeric:${recordIds.join(":")}:${stableStringify(numericConflicts)}`)}`,
          type: "NUMERIC_CONFLICT",
          recordIds,
          similarity: Math.round(similarity * 1_000),
          values: numericConflicts,
          detail: "Semantically overlapping claims report different values for the same unit.",
        });
      }
    }
  }
  return contradictions.sort((left, right) => left.id.localeCompare(right.id));
}

export function mergeEvidenceRecords(...inputs) {
  const merged = mergeRecordArrays(inputs);
  const contradictionScanComplete = merged.records.length <= MAX_GLOBAL_CONTRADICTION_RECORDS;
  const contradictions = contradictionScanComplete ? detectContradictions(merged.records) : [];
  return {
    records: merged.records,
    duplicates: merged.duplicates,
    audit: {
      inputCount: merged.inputCount,
      outputCount: merged.records.length,
      duplicateCount: merged.duplicates,
      uniqueSourceCount: new Set(merged.records.flatMap((record) => record.provenance.map((source) => source.id))).size,
      contradictionCount: contradictions.length,
      contradictionScanComplete,
      corroboratedCount: merged.records.filter((record) => record.corroboration.corroborated).length,
    },
  };
}

export function analyzeEvidence(records) {
  const merged = mergeRecordArrays([records]);
  const contradictionScanComplete = merged.records.length <= MAX_GLOBAL_CONTRADICTION_RECORDS;
  const contradictions = contradictionScanComplete ? detectContradictions(merged.records) : [];
  const contradictedIds = new Set(contradictions.flatMap((item) => item.recordIds));
  return {
    records: merged.records.map((record) => ({ ...record, contradicted: contradictedIds.has(record.id) })),
    contradictions,
    corroboration: merged.records.map((record) => ({ recordId: record.id, ...record.corroboration })),
    audit: {
      recordCount: merged.records.length,
      uniqueSourceCount: new Set(merged.records.flatMap((record) => record.provenance.map((source) => source.id))).size,
      contradictionCount: contradictions.length,
      contradictionScanComplete,
      corroboratedCount: merged.records.filter((record) => record.corroboration.corroborated).length,
      weakSingleSourceCount: merged.records.filter((record) => record.source.tier >= 3 && record.corroboration.independentSourceCount < 2).length,
    },
  };
}

export function retrieveEvidence(query, records, options = {}) {
  return retrieveEvidenceScope(query, records, options).records;
}

function detectContradictionsAgainst(selected, candidates) {
  const contradictions = new Map();
  const seenPairs = new Set();
  for (const left of selected) {
    for (const right of candidates) {
      if (left.id === right.id) continue;
      const pair = [left.id, right.id].sort().join(":");
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      for (const contradiction of detectContradictions([left, right])) contradictions.set(contradiction.id, contradiction);
    }
  }
  return [...contradictions.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function retrieveEvidenceScope(query, records, options = {}) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return { records: [], candidates: [], contradictions: [] };
  const limit = clampInteger(options.limit ?? 6, 1, 50);
  const minScore = clampInteger(options.minScore ?? 1, 0, 10_000);
  const merged = mergeRecordArrays([records]);
  const candidates = merged.records
    .map((record) => {
      const recordTokens = tokenize(record.normalizedText);
      const matchedTokens = queryTokens.filter((token) => recordTokens.includes(token));
      const coverage = Math.round((matchedTokens.length / queryTokens.length) * 1_000);
      const precision = Math.round((matchedTokens.length / Math.max(recordTokens.length, 1)) * 1_000);
      const phrase = record.normalizedText.includes(fold(query)) ? 300 : 0;
      const source = Math.floor(record.scores.total / 10);
      const corroboration = Math.min(200, Math.max(0, record.corroboration.independentSourceCount - 1) * 100);
      const score = matchedTokens.length
        ? matchedTokens.length * 120 + Math.floor(coverage / 5) + Math.floor(precision / 10) + phrase + source + corroboration
        : 0;
      return {
        ...record,
        retrieval: {
          score: Math.max(0, score),
          matchedTokens: [...new Set(matchedTokens)].sort(),
          queryCoverage: coverage,
        },
        contradicted: false,
      };
    })
    .filter((record) => record.retrieval.score > 0)
    .sort((left, right) => right.retrieval.score - left.retrieval.score || left.id.localeCompare(right.id));
  const selected = candidates.filter((record) => record.retrieval.score >= minScore).slice(0, limit);
  const contradictions = detectContradictionsAgainst(selected, candidates);
  const contradictionIds = new Set(contradictions.flatMap((item) => item.recordIds));
  const markedCandidates = candidates.map((record) => ({
      ...record,
      contradicted: contradictionIds.has(record.id),
      retrieval: {
        ...record.retrieval,
        score: Math.max(0, record.retrieval.score - (contradictionIds.has(record.id) ? 100 : 0)),
      },
    }));
  const markedById = new Map(markedCandidates.map((record) => [record.id, record]));
  return {
    records: selected.map((record) => markedById.get(record.id)),
    candidates: markedCandidates,
    contradictions,
  };
}

function conciseSnippet(text, maxChars) {
  const cleaned = cleanText(text).replace(/\n/g, " ");
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, Math.max(1, maxChars - 1));
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > maxChars * 0.6 ? boundary : slice.length).trimEnd()}…`;
}

export function buildEvidenceContext(query, records, options = {}) {
  const queryText = cleanText(query, 1_000);
  const limit = clampInteger(options.limit ?? 6, 1, 20);
  const maxSnippetChars = clampInteger(options.maxSnippetChars ?? 280, 80, 1_000);
  const retrieval = retrieveEvidenceScope(queryText, records, { limit, minScore: options.minScore ?? 1 });
  const initiallySelected = retrieval.records;
  const initialIds = new Set(initiallySelected.map((record) => record.id));
  const contradictions = retrieval.contradictions.filter((item) => item.recordIds.some((id) => initialIds.has(id)));
  const contradictedIds = new Set(contradictions.flatMap((item) => item.recordIds));
  const selectedWithContradictions = initiallySelected.map((record) => ({ ...record, contradicted: record.contradicted || contradictedIds.has(record.id) }));
  const selectedIds = new Set(selectedWithContradictions.map((record) => record.id));
  for (const candidate of retrieval.candidates) {
    if (selectedWithContradictions.length >= limit + 4) break;
    if (!contradictedIds.has(candidate.id) || selectedIds.has(candidate.id)) continue;
    selectedWithContradictions.push({ ...candidate, contradicted: true });
    selectedIds.add(candidate.id);
  }
  const uniqueSources = new Set(selectedWithContradictions.flatMap((record) => record.provenance.map((source) => source.id)));
  const weakSingles = selectedWithContradictions.filter((record) => record.source.tier >= 3 && record.corroboration.independentSourceCount < 2);
  const grounded = selectedWithContradictions.some((record) => record.source.tier <= 2 || record.corroboration.independentSourceCount >= 2);
  const status = !selectedWithContradictions.length || !grounded ? "insufficient" : contradictions.length || selectedWithContradictions.some((record) => record.contradicted) ? "contested" : "grounded";
  const citations = selectedWithContradictions.map((record, index) => ({
    id: `E${index + 1}`,
    recordId: record.id,
    sourceIds: record.provenance.map((source) => source.id),
    sourceName: record.source.name,
    uri: record.source.uri,
    publisher: record.source.publisher,
    publishedAt: record.source.publishedAt,
    tier: record.source.tier,
    locator: record.locator,
    score: record.retrieval.score,
    corroborationCount: record.corroboration.independentSourceCount,
    contradicted: record.contradicted,
  }));
  const context = selectedWithContradictions.map((record, index) => `[E${index + 1}] ${conciseSnippet(record.text, maxSnippetChars)}`).join("\n");
  return {
    query: queryText,
    status,
    context,
    citations,
    records: selectedWithContradictions,
    contradictions,
    audit: {
      candidateCount: Array.isArray(records) ? records.length : 0,
      selectedCount: selectedWithContradictions.length,
      uniqueSourceCount: uniqueSources.size,
      contradictionCount: contradictions.length,
      corroboratedCount: selectedWithContradictions.filter((record) => record.corroboration.corroborated).length,
      weakSingleSourceCount: weakSingles.length,
      factPromotionAllowed: status === "grounded",
    },
  };
}

export function parseEvidenceFileText(input, options = {}) {
  const format = inferFormat(options);
  const fileName = cleanText(options.fileName || `evidence.${format || "txt"}`, 500);
  const source = normalizeSource(options.source || {}, fileName);
  const referenceDate = normalizeIsoDate(options.referenceDate) || source.retrievedAt;
  if (!format) {
    return {
      records: [],
      errors: [{ code: "UNSUPPORTED_FORMAT", message: "Use txt, md, csv, tsv, json, or jsonl.", locator: { fileName } }],
      audit: { version: EVIDENCE_VAULT_VERSION, format: null, parsedCount: 0, errorCount: 1, sourceId: source.id },
    };
  }
  if (typeof input !== "string") {
    return {
      records: [],
      errors: [{ code: "INVALID_INPUT", message: "Evidence input must be a string.", locator: { fileName } }],
      audit: { version: EVIDENCE_VAULT_VERSION, format, parsedCount: 0, errorCount: 1, sourceId: source.id },
    };
  }
  if (!input.trim()) {
    return {
      records: [],
      errors: [{ code: "EMPTY_INPUT", message: "Evidence input is empty.", locator: { fileName } }],
      audit: { version: EVIDENCE_VAULT_VERSION, format, parsedCount: 0, errorCount: 1, sourceId: source.id },
    };
  }
  if (input.length > MAX_INPUT_CHARS) {
    return {
      records: [],
      errors: [{ code: "INPUT_TOO_LARGE", message: `Evidence input exceeds ${MAX_INPUT_CHARS} characters.`, locator: { fileName } }],
      audit: { version: EVIDENCE_VAULT_VERSION, format, parsedCount: 0, errorCount: 1, sourceId: source.id },
    };
  }
  let parsed;
  if (format === "txt" || format === "md") {
    const records = parseTextBlocks(input, format, fileName, source, referenceDate);
    parsed = {
      records,
      errors: records.length >= MAX_RECORDS_PER_PARSE
        ? [{ code: "RECORD_LIMIT", message: `Only the first ${MAX_RECORDS_PER_PARSE} data records are accepted. Split the file to preserve scope.`, locator: { fileName } }]
        : [],
    };
  } else if (format === "csv" || format === "tsv") {
    parsed = parseDelimited(input, format, fileName, source, referenceDate);
  } else {
    parsed = parseJson(input, format, fileName, source, referenceDate);
  }
  const merged = mergeRecordArrays([parsed.records]);
  return {
    records: merged.records,
    errors: parsed.errors,
    audit: {
      version: EVIDENCE_VAULT_VERSION,
      format,
      parsedCount: merged.records.length,
      duplicateCount: merged.duplicates,
      errorCount: parsed.errors.length,
      sourceId: source.id,
      deterministic: true,
      externalCalls: false,
    },
  };
}
