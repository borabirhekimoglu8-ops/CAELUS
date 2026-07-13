import { ENTITY_PHRASES, EVENT_PATTERNS, ROLE_CUES } from "./ontology.mjs";

const FUNCTION_WORDS = new Set([
  "acaba", "ama", "ancak", "artik", "bana", "ben", "bence", "bile", "bir", "biri", "biz", "bu", "buna", "bunu",
  "cok", "daha", "de", "da", "diye", "en", "fakat", "gibi", "icin", "ile", "ise", "ki", "mi", "mu", "nasil",
  "neden", "ne", "olarak", "olan", "oldu", "olur", "olursa", "sonra", "su", "ve", "veya", "ya", "yani", "yalnizca",
  "the", "a", "an", "and", "or", "but", "for", "from", "in", "into", "of", "on", "to", "with", "what", "when",
  "where", "why", "how", "is", "are", "be", "will", "would", "should", "could", "this", "that", "scenario", "senaryo",
  "nedeniyle", "yuzunden", "sonucu", "durumunda", "etkilenir", "etki", "saat", "saatte", "dakika", "gun", "gunde", "hafta", "haftada", "ay", "ayda", "ayni", "anda",
  "operasyon", "operasyonu", "planli", "bakim", "salt", "okunur", "yok", "merkezinde", "yazilimina", "yazilimi", "nedir", "uzerinde",
  "disi", "ederken", "devam", "saglam", "onaylanmis", "planini", "fabrikasinin", "hastanelerin", "hastanede", "sunucularini",
]);

const VERB_PREFIXES = [
  "dur", "kapan", "kes", "iptal", "etkile", "degis", "art", "azal", "dus", "cok", "yuksel", "kaybol", "siz",
  "kal", "gir", "uygula", "koru", "sifrele", "daral", "gecik", "bozul", "ol", "yap", "ilerle", "devre", "basla",
];

const INFERRED_NODES = {
  MARITIME: [
    ["Yolcu kuyruğu", "DEMAND"], ["Terminal kapasitesi", "CAPACITY"], ["Bağlantı ve konaklama", "DEADLINE"],
  ],
  AVIATION: [
    ["Slot kuyruğu", "DEMAND"], ["Filo kapasitesi", "CAPACITY"], ["Bağlantılı uçuşlar", "DEADLINE"],
  ],
  SUPPLY: [
    ["Sipariş kuyruğu", "DEMAND"], ["Stok tamponu", "CAPACITY"], ["Üretim vardiyası", "DEADLINE"],
  ],
  FINANCE: [
    ["İşlem talebi", "DEMAND"], ["Likidite tamponu", "CAPACITY"], ["Vade yükümlülüğü", "DEADLINE"],
  ],
  CYBER: [
    ["Olay kuyruğu", "DEMAND"], ["Yedek kapasite", "CAPACITY"], ["Kritik veri ve servis", "DEADLINE"],
  ],
  HEALTH: [
    ["Hasta ve triyaj kuyruğu", "DEMAND"], ["Yatak ve malzeme kapasitesi", "CAPACITY"], ["Kritik vaka", "DEADLINE"],
  ],
  ENERGY: [
    ["Kritik yük talebi", "DEMAND"], ["Rezerv marjı", "CAPACITY"], ["Kritik altyapı", "DEADLINE"],
  ],
  SPACE: [
    ["Komut kuyruğu", "DEMAND"], ["Enerji ve itki bütçesi", "CAPACITY"], ["Görev penceresi", "DEADLINE"],
  ],
  SECURITY: [
    ["Operasyonel baskı", "DEMAND"], ["Kurumsal kapasite", "CAPACITY"], ["İnsani karar penceresi", "DEADLINE"],
  ],
  BUSINESS: [
    ["Müşteri ve iş kuyruğu", "DEMAND"], ["Kaynak kapasitesi", "CAPACITY"], ["Kritik taahhüt", "DEADLINE"],
  ],
  UNIVERSAL: [
    ["Talep ve baskı", "DEMAND"], ["Tampon kapasite", "CAPACITY"], ["Zaman kritik sonuç", "DEADLINE"],
  ],
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function titleCase(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1) : text;
}

function tokenMatches(token, anchor) {
  return token === anchor || (anchor.length >= 4 && token.startsWith(anchor)) || (token.length >= 5 && anchor.startsWith(token));
}

function durationHours(normalized) {
  const match = normalized.match(/(\d{1,4}(?:[.,]\d+)?)\s*(dakika|saat|gun|hafta|ay|minute|hour|day|week|month)/);
  if (!match) return 72;
  const amount = Number(match[1].replace(",", "."));
  const unit = match[2];
  if (unit === "dakika" || unit === "minute") return Math.max(1 / 60, amount / 60);
  if (unit === "gun" || unit === "day") return amount * 24;
  if (unit === "hafta" || unit === "week") return amount * 168;
  if (unit === "ay" || unit === "month") return amount * 720;
  return amount;
}

function negatesEvent(clause, eventType) {
  if (/devreye girmez|calismaz|basarisiz/.test(clause) && eventType === "PROTECT") return true;
  if (/saldiri yok|tehdit yok|hack yok/.test(clause) && eventType === "ATTACK") return true;
  if (/veri(?:ler)?(?:i)? (?:kaybolmayacak|sizmayacak)|veri kaybi yok/.test(clause) && eventType === "LEAK") return true;
  if (/kapanmayacak|durmayacak|iptal edilmeyecek|kesilmeyecek/.test(clause) && eventType === "STOP") return true;
  if (/artmayacak|yukselmeyecek/.test(clause) && eventType === "INCREASE") return true;
  return false;
}

function classifyConcept(key) {
  for (const cue of ROLE_CUES) {
    if (cue.terms.some((term) => key.includes(term) || term.includes(key))) return cue;
  }
  return ROLE_CUES[ROLE_CUES.length - 1];
}

function conceptDomain(key, domainLexicon, primarySector) {
  let selected = primarySector;
  let best = 0;
  for (const [sector, anchors] of Object.entries(domainLexicon)) {
    const hits = anchors.reduce((total, anchor) => total + (key.split(" ").some((token) => tokenMatches(token, anchor)) ? 1 : 0), 0);
    if (hits > best) {
      selected = sector;
      best = hits;
    }
  }
  return selected;
}

function extractConcepts(sourceText, normalized, domainLexicon, primarySector, fold) {
  const concepts = [];
  const seen = new Set();
  const suppressAttackTerms = /saldiri yok|tehdit yok|hack yok/.test(normalized);

  for (const [phrase, label, forcedType] of ENTITY_PHRASES) {
    if (!normalized.includes(phrase) || seen.has(phrase)) continue;
    const cue = ROLE_CUES.find((item) => item.semanticType === forcedType) || classifyConcept(phrase);
    seen.add(phrase);
    concepts.push({
      key: phrase, label, domain: conceptDomain(phrase, domainLexicon, primarySector),
      role: cue.role, kind: cue.kind, semanticType: cue.semanticType,
      explicit: true, score: 12, evidence: [{ source: "input", text: label }],
    });
  }

  const words = String(sourceText).match(/[A-Za-z0-9À-žĞğÜüŞşİıÖöÇç]+/g) || [];
  const candidates = [];
  words.forEach((word, index) => {
    const key = fold(word);
    if (key.length < 3 || /^\d+$/.test(key) || FUNCTION_WORDS.has(key) || VERB_PREFIXES.some((prefix) => key.startsWith(prefix))) return;
    if (suppressAttackTerms && ["siber", "saldiri", "hack", "tehdit"].some((term) => key.startsWith(term))) return;
    if (concepts.some((concept) => concept.key.split(" ").some((part) => tokenMatches(key, part)))) return;
    const domain = conceptDomain(key, domainLexicon, primarySector);
    const anchor = (domainLexicon[domain] || []).some((term) => tokenMatches(key, term));
    const proper = word[0] === word[0]?.toLocaleUpperCase("tr-TR") && word[0] !== word[0]?.toLocaleLowerCase("tr-TR");
    const cue = classifyConcept(key);
    candidates.push({
      key, label: titleCase(word), domain, role: cue.role, kind: cue.kind, semanticType: cue.semanticType,
      explicit: true, score: (anchor ? 6 : 0) + (proper ? 4 : 0) + Math.min(3, key.length / 4) + index / 100,
      evidence: [{ source: "input", text: word }],
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  const diversityOrder = ["DEADLINE", "ACTOR", "DEMAND", "CAPACITY", "GATE", "SERVICE"];
  for (const semanticType of diversityOrder) {
    const candidate = candidates.find((item) => item.semanticType === semanticType && !seen.has(item.key));
    if (!candidate || concepts.length >= 6 || concepts.some((item) => item.semanticType === semanticType)) continue;
    seen.add(candidate.key);
    concepts.push(candidate);
  }
  for (const candidate of candidates) {
    if (concepts.length >= 6 || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    concepts.push(candidate);
  }

  const inferred = INFERRED_NODES[primarySector] || INFERRED_NODES.UNIVERSAL;
  for (const [label, semanticType] of inferred) {
    if (concepts.length >= 6) break;
    const key = fold(label);
    if (seen.has(key)) continue;
    const cue = ROLE_CUES.find((item) => item.semanticType === semanticType) || ROLE_CUES[ROLE_CUES.length - 1];
    seen.add(key);
    concepts.push({
      key, label, domain: primarySector, role: cue.role, kind: cue.kind, semanticType,
      explicit: false, score: 2,
      evidence: [{ source: "ontology", text: label, ruleId: `NCM2-${primarySector}-${semanticType}` }],
    });
  }
  return concepts.slice(0, 6);
}

function eventMagnitude(clause, event) {
  const percent = clause.match(/%\s*(\d{1,3})|(\d{1,3})\s*%/);
  const percentage = percent ? Number(percent[1] || percent[2]) / 100 : 0;
  const count = clause.match(/\b(iki|uc|dort|bes|\d+)\b/);
  const countBoost = count ? 0.08 : 0;
  return clamp(Math.abs(event.pressure) + percentage * 0.34 + countBoost, 0.12, 0.98);
}

export function parseSituation(sourceText, options) {
  const { fold, hash32, semanticLexicon, neuralProbabilities, neuralSeverity } = options;
  const normalized = fold(sourceText);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const domainRows = Object.entries(semanticLexicon).map(([sector, anchors]) => {
    const hits = tokens.reduce((sum, token) => sum + (anchors.some((anchor) => tokenMatches(token, anchor)) ? 1 : 0), 0);
    return { sector, hits, neural: Number(neuralProbabilities[sector] || 0) };
  });
  const maxHits = Math.max(1, ...domainRows.map((row) => row.hits));
  domainRows.forEach((row) => {
    const specificity = row.sector === "UNIVERSAL" ? 0.62 : 1;
    row.score = (row.neural * 0.32 + (row.hits / maxHits) * 0.68) * specificity;
  });
  domainRows.sort((a, b) => b.score - a.score || b.hits - a.hits);
  const primarySector = domainRows[0]?.sector || "UNIVERSAL";
  const activeDomains = domainRows.filter((row, index) => index === 0 || (row.hits > 0 && row.score >= 0.28)).slice(0, 3);

  const clauses = normalized.split(/[.;!?]+|\b(?:fakat|ancak|ama|while|but)\b/).map((item) => item.trim()).filter(Boolean);
  const frames = [];
  clauses.forEach((clause, clauseIndex) => {
    EVENT_PATTERNS.forEach((pattern) => {
      const term = pattern.terms.find((candidate) => clause.includes(candidate));
      if (!term) return;
      const negated = negatesEvent(clause, pattern.type);
      frames.push({
        id: `EV-${clauseIndex + 1}-${pattern.type}-${frames.length + 1}`,
        clauseId: `C-${clauseIndex + 1}`,
        event: pattern.type,
        objectId: "UNRESOLVED",
        startTick: 0,
        durationTicks: null,
        magnitudeFp: Math.round(eventMagnitude(clause, pattern) * 1_000_000),
        direction: pattern.pressure < 0 ? -1 : 1,
        negated,
        conditional: /olursa|kalirsa|girse|girmezse|if|when/.test(clause),
        evidence: [{ source: "input", text: clause, ruleId: `EVENT-${pattern.type}-${term}` }],
      });
    });
  });

  const hours = durationHours(normalized);
  const activeFrames = frames.filter((frame) => !frame.negated);
  const positive = activeFrames.filter((frame) => frame.direction > 0);
  const protective = activeFrames.filter((frame) => frame.direction < 0);
  const failedMitigation = /(?:yedek|jenerator|gecis plan)[^.;!?]{0,45}(?:devreye girmez|calismaz|yok|uygulanmaz)/.test(normalized);
  const activeMitigation = /(?:yedek|jenerator|gecis plan)[^.;!?]{0,45}(?:saglam|devreye gir|uygula|hazir)|seferler devam|veri(?:ler)? kaybolmayacak/.test(normalized);
  const plannedLowImpact = /planli bakim|salt okunur|read only/.test(normalized);
  const averagePressure = positive.length
    ? positive.reduce((sum, frame) => sum + frame.magnitudeFp / 1_000_000, 0) / positive.length
    : Math.min(0.45, neuralSeverity * 0.45);
  const durationPressure = clamp(Math.log1p(hours) / Math.log1p(504), 0.03, 1);
  const percentage = normalized.match(/%\s*(\d{1,3})|(\d{1,3})\s*%/);
  const quantitativePressure = percentage ? Math.min(0.18, Number(percentage[1] || percentage[2]) / 400) : 0;
  let severity = 0.12 + averagePressure * 0.34 + durationPressure * 0.36 + quantitativePressure;
  severity += Math.min(0.14, Math.max(0, positive.length - 1) * 0.05);
  severity += failedMitigation ? 0.20 : 0;
  severity -= activeMitigation ? 0.20 : 0;
  severity -= protective.length * 0.05;
  severity -= plannedLowImpact ? 0.12 : 0;
  if (positive.length === 0 && frames.some((frame) => frame.negated)) severity = Math.min(severity, 0.24);
  severity = clamp(severity, 0.08, 0.96);

  const concepts = extractConcepts(sourceText, normalized, semanticLexicon, primarySector, fold);
  const explicitCount = concepts.filter((concept) => concept.explicit).length;
  const contentTokens = tokens.filter((token) => token.length >= 3 && !FUNCTION_WORDS.has(token) && !VERB_PREFIXES.some((prefix) => token.startsWith(prefix)));
  const covered = new Set(concepts.flatMap((concept) => concept.key.split(" ")));
  const coverage = contentTokens.length ? contentTokens.filter((token) => covered.has(token) || [...covered].some((key) => tokenMatches(token, key))).length / contentTokens.length : 0;
  const margin = clamp((domainRows[0]?.score || 0) - (domainRows[1]?.score || 0), 0, 1);
  const confidence = clamp(0.44 + coverage * 0.34 + margin * 0.20 - (activeDomains.length > 1 ? 0.06 : 0), 0.42, activeDomains.length > 1 ? 0.88 : 0.94);

  return {
    sourceText,
    normalized,
    sourceHash: hash32(`NCM2:${normalized}`).toString(16).toUpperCase().padStart(8, "0"),
    primarySector,
    activeDomains,
    domainRows,
    frames,
    concepts,
    durationHours: hours,
    severity,
    confidence,
    coverage,
    explicitCount,
    activeMitigation,
    failedMitigation,
    plannedLowImpact,
    negatedEvents: frames.filter((frame) => frame.negated).map((frame) => frame.event),
    quantitativeFacts: [
      ...(percentage ? [`%${percentage[1] || percentage[2]} değişim`] : []),
      ...(hours !== 72 || /\d/.test(normalized) ? [`${Number(hours.toFixed(2))} saat pencere`] : []),
    ],
  };
}
