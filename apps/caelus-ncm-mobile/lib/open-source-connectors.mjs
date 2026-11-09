const MAX_QUERY_LENGTH = 240;
const MAX_SOURCE_TEXT = 400_000;
const MAX_SOURCE_BYTES = 5_000_000;
const QUERY_STOP_WORDS = new Set([
  "acaba", "ama", "bir", "bu", "da", "de", "etki", "etkilenir", "icin", "ile", "mi", "nasil", "nedir",
  "ne", "olur", "olursa", "sonuc", "ve", "veya", "what", "how", "if", "the", "with", "would",
]);
const TRANSLATION_RULES = [
  [/^ferib|^ferry$/, "ferry"], [/^firt|^storm$/, "storm"], [/^liman|^port$/, "port"], [/^sefer|^service$/, "service"],
  [/^iptal|^cancel/, "cancellation"], [/^durdur|^durursa|^askiya|^suspend/, "suspension"], [/^yolcu|^passenger/, "passenger"],
  [/^yangin|^fire$/, "fire"], [/^deprem|^earthquake$/, "earthquake"], [/^sel$|^flood$/, "flood"], [/^kesinti|^outage$/, "outage"],
  [/^enerji|^sebeke|^energy$|^grid$/, "energy"], [/^siber|^cyber$/, "cyber"], [/^saldiri|^attack$/, "attack"], [/^saglik|^klinik|^clinical$|^medical$/, "clinical"],
];
const OPERATIONAL_TOKEN = /^(?:ferib|ferry$|ferries$|firt|storm$|storms$|liman|port$|ports$|sefer|service$|services$|iptal|cancel|durdur|durursa|suspend|kesinti|outage$|outages$|kuyruk|queue$|queues$|stok$|stock$|bugun$|today$|yarin$|tomorrow$|current$)/;
const MEDICAL_TOKEN = /^(?:klinik|hasta|ates|spo2|ilac|tani|hastalik|medical$|clinical$|patient$|patients$|disease$|diseases$|medicine$|medicines$|biology$|health$)/;
const TOPIC_TERMS = ["ferry", "port", "service", "energy", "cyber", "clinical", "passenger"];
const EVENT_TERMS = ["storm", "cancellation", "suspension", "fire", "earthquake", "flood", "outage", "attack"];

function fold(value) {
  return String(value || "")
    .replace(/İ/g, "I").replace(/ı/g, "i")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value) return false;
    const key = fold(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planOpenSourceQuery(value) {
  const source = String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  const folded = fold(source);
  const tokens = folded.split(" ").filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token) && !/^\d+$/.test(token));
  const names = (source.match(/\b[A-ZÇĞİÖŞÜ][A-Za-zÀ-žÇĞİÖŞÜçğıöşü-]{2,}/gu) || [])
    .filter((token) => {
      const normalized = fold(token);
      return !QUERY_STOP_WORDS.has(normalized)
        && !TRANSLATION_RULES.some(([pattern]) => pattern.test(normalized))
        && !/^(Saat|Etkilenen|Planlı|Nasıl)$/i.test(token);
    });
  const domainTokens = [];
  const translated = [];
  for (const token of tokens) {
    const rule = TRANSLATION_RULES.find(([pattern]) => pattern.test(token));
    if (rule) {
      domainTokens.push(token);
      translated.push(rule[1]);
    }
  }
  const fallback = tokens.filter((token) => !domainTokens.includes(token)).slice(0, 5);
  const entities = unique(names).slice(0, 3);
  const primaryEntity = entities.at(-1) || null;
  const topic = TOPIC_TERMS.find((term) => translated.includes(term)) || translated[0] || domainTokens[0] || fallback[0] || null;
  const event = EVENT_TERMS.find((term) => translated.includes(term)) || translated.find((term) => term !== topic) || null;
  const operational = tokens.some((token) => OPERATIONAL_TOKEN.test(token));
  const medical = tokens.some((token) => MEDICAL_TOKEN.test(token));
  const broad = unique([...entities, ...translated, ...fallback]).slice(0, 8).join(" ") || source;
  const entity = primaryEntity || unique([...domainTokens.slice(0, 1), ...fallback.slice(0, 2)]).slice(0, 3).join(" ") || source;
  const knowledgeTr = operational && entities.length
    ? entities.join(" ")
    : unique([...entities, ...domainTokens.slice(0, 2), ...fallback]).slice(0, 6).join(" ") || source;
  const global = operational
    ? unique([primaryEntity, topic, ...(primaryEntity ? [] : [event, ...fallback.slice(0, 1)])]).slice(0, 3).join(" ") || source
    : broad;
  const news = operational
    ? unique([primaryEntity, topic, event]).slice(0, 4).join(" ") || global
    : broad;
  const scholarly = medical || !operational;
  return { original: source, entity, knowledgeTr, global, news, scholarly: scholarly ? broad : null, medical: medical ? broad : null };
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

export function textFromMarkup(value) {
  return decodeEntities(String(value || "")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[^]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function plainText(value) {
  return textFromMarkup(value).slice(0, MAX_SOURCE_TEXT);
}

function isoOrNull(value) {
  if (!value) return null;
  const source = String(value);
  const compact = source.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : source;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function makeHit(source, item, retrievedAt) {
  const uri = String(item.uri || "");
  const title = plainText(item.title || source.label || "Açık kaynak kaydı").slice(0, 240);
  const content = plainText(item.content || title);
  if (!content) return null;
  return {
    id: `OPEN-${hash32(`${source.id}|${uri}|${title}|${content}`)}`,
    sourceId: source.id,
    sourceName: source.label,
    sourceClass: "public_source",
    publisher: item.publisher || source.publisher,
    independenceGroup: item.independenceGroup || source.independenceGroup,
    uri,
    title,
    content,
    retrievedAt,
    publishedAt: isoOrNull(item.publishedAt),
    license: item.license || source.license,
    trustTier: source.trustTier,
    promotionEligible: item.promotionEligible ?? source.promotionEligible ?? true,
    locator: item.locator || "record",
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Açık kaynak taraması iptal edildi.");
  error.name = "AbortError";
  throw error;
}

async function readResponseTextLimited(response, maxTextChars = MAX_SOURCE_TEXT) {
  const declaredSize = Number(response.headers?.get?.("content-length") || 0);
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error("Kaynak 5 MB sınırını aşıyor.");
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("Kaynak akışı güvenli boyut denetimini desteklemiyor; dosya olarak yükleyin.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > MAX_SOURCE_BYTES) {
        await reader.cancel("source too large").catch(() => undefined);
        throw new Error("Kaynak 5 MB sınırını aşıyor.");
      }
      const decoded = decoder.decode(value, { stream: true });
      if (text.length < maxTextChars) text += decoded.slice(0, maxTextChars - text.length);
    }
    if (text.length < maxTextChars) text += decoder.decode().slice(0, maxTextChars - text.length);
    return text;
  } finally {
    reader.releaseLock?.();
  }
}

async function requestJson(url, { fetchImpl, signal, timeoutMs }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("source timeout")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await readResponseTextLimited(response, MAX_SOURCE_BYTES);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Kaynak geçerli ve sınırlar içinde JSON döndürmedi.");
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function wikipediaAdapter(language) {
  return {
    id: `wikipedia_${language}`,
    label: `Wikipedia ${language.toUpperCase()}`,
    publisher: "Wikimedia Foundation",
    independenceGroup: "wikimedia",
    license: "CC BY-SA",
    trustTier: "secondary",
    queryKind: language === "tr" ? "knowledgeTr" : "global",
    buildUrl(query, limit) {
      const params = new URLSearchParams({
        action: "query", generator: "search", gsrsearch: query, gsrnamespace: "0",
        gsrlimit: String(limit), prop: "extracts|info", exintro: "1", explaintext: "1",
        inprop: "url", format: "json", origin: "*",
      });
      return `https://${language}.wikipedia.org/w/api.php?${params}`;
    },
    parse(data) {
      return Object.values(data?.query?.pages || {}).sort((left, right) =>
        (Number(left.index) || Number.MAX_SAFE_INTEGER) - (Number(right.index) || Number.MAX_SAFE_INTEGER))
      .map((page) => ({
        uri: page.fullurl || `https://${language}.wikipedia.org/?curid=${page.pageid}`,
        title: page.title,
        content: page.extract || page.title,
        // `touched` is an encyclopedia edit timestamp, not the publication
        // time of the real-world event described by the article.
        publishedAt: null,
        locator: `page:${page.pageid}`,
      }));
    },
  };
}

const ADAPTERS = [
  wikipediaAdapter("tr"),
  wikipediaAdapter("en"),
  {
    id: "wikidata",
    label: "Wikidata",
    publisher: "Wikimedia Foundation",
    independenceGroup: "wikimedia",
    license: "CC0",
    trustTier: "knowledge_graph",
    queryKind: "entity",
    buildUrl(query, limit) {
      const params = new URLSearchParams({
        action: "wbsearchentities", search: query, language: "tr", uselang: "tr",
        type: "item", limit: String(limit), format: "json", origin: "*",
      });
      return `https://www.wikidata.org/w/api.php?${params}`;
    },
    parse(data) {
      return (data?.search || []).map((item) => ({
        uri: item.concepturi || `https://www.wikidata.org/wiki/${item.id}`,
        title: item.label || item.id,
        content: [item.label, item.description, ...(item.aliases || [])].filter(Boolean).join(" — "),
        locator: item.id,
      }));
    },
  },
  {
    id: "crossref",
    label: "Crossref",
    publisher: "Crossref",
    independenceGroup: "crossref",
    license: "Crossref public metadata",
    trustTier: "scholarly_metadata",
    queryKind: "scholarly",
    buildUrl(query, limit) {
      const params = new URLSearchParams({ query, rows: String(limit), select: "DOI,title,abstract,published,URL,publisher" });
      return `https://api.crossref.org/works?${params}`;
    },
    parse(data) {
      return (data?.message?.items || []).map((item) => ({
        uri: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
        title: Array.isArray(item.title) ? item.title[0] : item.title,
        content: [Array.isArray(item.title) ? item.title[0] : item.title, item.abstract, item.publisher].filter(Boolean).join(" — "),
        publishedAt: item.published?.["date-parts"]?.[0]?.join("-") || null,
        locator: item.DOI ? `doi:${item.DOI}` : "work",
      }));
    },
  },
  {
    id: "europe_pmc",
    label: "Europe PMC",
    publisher: "Europe PMC",
    independenceGroup: "europe_pmc",
    license: "Europe PMC open metadata",
    trustTier: "scholarly_metadata",
    queryKind: "medical",
    buildUrl(query, limit) {
      const params = new URLSearchParams({ query, format: "json", pageSize: String(limit), resultType: "core" });
      return `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`;
    },
    parse(data) {
      return (data?.resultList?.result || []).map((item) => ({
        uri: item.doi ? `https://doi.org/${item.doi}` : item.pmcid ? `https://europepmc.org/article/PMC/${item.pmcid}` : "https://europepmc.org/",
        title: item.title,
        content: [item.title, item.abstractText, item.authorString, item.journalTitle].filter(Boolean).join(" — "),
        publishedAt: item.firstPublicationDate || item.electronicPublicationDate || item.pubYear,
        locator: item.pmcid || item.pmid || item.id || "work",
      }));
    },
  },
  {
    id: "gdelt_news",
    label: "GDELT Açık Haber Ağı",
    publisher: "GDELT Project",
    independenceGroup: "gdelt",
    license: "GDELT open metadata; article licenses vary",
    trustTier: "discovery_index",
    queryKind: "news",
    promotionEligible: false,
    buildUrl(query, limit) {
      const params = new URLSearchParams({
        query,
        mode: "artlist",
        maxrecords: String(Math.max(10, limit)),
        format: "json",
        sort: "datedesc",
        timespan: "3months",
      });
      return `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
    },
    parse(data) {
      return (data?.articles || []).map((item) => ({
        uri: item.url,
        title: item.title,
        content: [item.title, item.domain, item.sourcecountry, item.language].filter(Boolean).join(" — "),
        publishedAt: item.seendate,
        locator: item.domain ? `publisher:${item.domain}` : "article",
        publisher: item.domain || "GDELT Project",
        independenceGroup: item.domain || "gdelt",
        promotionEligible: false,
        // Each publisher is preserved in the content/URL; GDELT remains a
        // discovery index, not an independent fact witness.
      }));
    },
  },
];

export const OPEN_SOURCE_ADAPTERS = Object.freeze(ADAPTERS.map((item) => ({
  id: item.id,
  label: item.label,
  publisher: item.publisher,
  independenceGroup: item.independenceGroup,
  license: item.license,
  trustTier: item.trustTier,
  queryKind: item.queryKind,
  promotionEligible: item.promotionEligible !== false,
})));

export async function searchOpenSources(query, options = {}) {
  const normalizedQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (normalizedQuery.length < 3) throw new Error("Açık kaynak araması için en az 3 karakter gerekir.");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Bu cihazda ağ erişimi kullanılamıyor.");
  const limit = Math.max(1, Math.min(5, Number(options.limit) || 3));
  const timeoutMs = Math.max(2_000, Math.min(30_000, Number(options.timeoutMs) || 12_000));
  const retrievedAt = options.retrievedAt || new Date().toISOString();
  const plan = planOpenSourceQuery(normalizedQuery);
  throwIfAborted(options.signal);

  const settled = await Promise.allSettled(ADAPTERS.map(async (adapter) => {
    const plannedQuery = plan[adapter.queryKind];
    if (!plannedQuery) return { sourceId: adapter.id, sourceName: adapter.label, ok: true, skipped: true, count: 0, hits: [], queryUsed: null };
    const url = adapter.buildUrl(plannedQuery, limit);
    const data = await requestJson(url, { fetchImpl, signal: options.signal, timeoutMs });
    const hits = adapter.parse(data).slice(0, limit).map((item) => makeHit(adapter, item, retrievedAt)).filter(Boolean);
    return { sourceId: adapter.id, sourceName: adapter.label, ok: true, skipped: false, count: hits.length, hits, queryUsed: plannedQuery };
  }));
  throwIfAborted(options.signal);

  const reports = settled.map((result, index) => result.status === "fulfilled"
    ? { sourceId: result.value.sourceId, sourceName: result.value.sourceName, ok: true, skipped: result.value.skipped, count: result.value.count, queryUsed: result.value.queryUsed, error: null }
    : { sourceId: ADAPTERS[index].id, sourceName: ADAPTERS[index].label, ok: false, skipped: false, count: 0, queryUsed: plan[ADAPTERS[index].queryKind] || null, error: result.reason instanceof Error ? result.reason.message : "Kaynak okunamadı" });
  const hits = settled.flatMap((result) => result.status === "fulfilled" ? result.value.hits : []);

  return {
    query: normalizedQuery,
    plan,
    retrievedAt,
    hits,
    reports,
    attemptedSources: reports.filter((item) => !item.skipped).length,
    successfulSources: reports.filter((item) => item.ok && !item.skipped).length,
    failedSources: reports.filter((item) => !item.ok).length,
    skippedSources: reports.filter((item) => item.skipped).length,
  };
}

function flattenJson(value, path = "$", output = [], depth = 0) {
  if (output.length >= 2_000 || depth > 12) return output;
  if (value === null || typeof value !== "object") {
    output.push(`${path}: ${String(value)}`);
    return output;
  }
  for (const [key, child] of Object.entries(value)) flattenJson(child, `${path}.${key}`, output, depth + 1);
  return output;
}

export async function importOpenUrl(value, options = {}) {
  const url = new URL(String(value || "").trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Yalnız HTTP veya HTTPS kaynağı eklenebilir.");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Bu cihazda ağ erişimi kullanılamıyor.");
  const timeoutMs = Math.max(2_000, Math.min(30_000, Number(options.timeoutMs) || 12_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.href, {
      method: "GET", mode: "cors", credentials: "omit", redirect: "follow",
      headers: { accept: "text/html,application/json,application/xml,text/xml,text/plain;q=0.9" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Kaynak HTTP ${response.status} döndürdü.`);
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    const raw = await readResponseTextLimited(response);
    let content;
    if (/json/.test(contentType) || /^\s*[\[{]/.test(raw)) {
      try { content = flattenJson(JSON.parse(raw)).join("\n"); } catch { content = raw; }
    } else {
      content = textFromMarkup(raw);
    }
    if (!content.trim()) throw new Error("Kaynak okunabilir metin içermiyor.");
    const finalUrl = new URL(response.url || url.href);
    if (!/^https?:$/.test(finalUrl.protocol)) throw new Error("Kaynak güvenli bir HTTP(S) adresine yönlenmedi.");
    const finalHost = finalUrl.hostname.toLowerCase().replace(/^www\./, "");
    const source = {
      id: `url_${fold(finalHost).replace(/\s+/g, "_") || "public"}`,
      label: finalHost,
      publisher: finalHost,
      independenceGroup: finalHost,
      license: "Kaynak lisansı doğrulanmalı",
      trustTier: "unrated",
    };
    return makeHit(source, {
      uri: finalUrl.href,
      title: options.title || finalHost,
      content,
      locator: /json/.test(contentType) ? "json:$" : "document",
    }, options.retrievedAt || new Date().toISOString());
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Kaynak iPhone tarayıcısının CORS erişimine izin vermiyor; dosya olarak yükleyin.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
