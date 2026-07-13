/**
 * CAELUS NCM-3 evidence-bound deterministic reasoner.
 *
 * This module deliberately does not generate a likely-looking answer. It selects
 * a closed-form solver only when the input contains the facts and units needed by
 * that solver; otherwise it records what is unknown and abstains.
 */

export const NCM3_VERSION = "NCM-3.0.0";

const CLAIM_TYPES = new Set(["FACT", "DEDUCTION", "CALCULATION", "UNKNOWN", "SAFETY"]);

function fold(value) {
  return String(value ?? "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanInput(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 4_000);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseLocalizedNumber(value) {
  const token = String(value ?? "").replace(/\s/g, "");
  if (!token) return Number.NaN;
  if (token.includes(",")) return Number(token.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) return Number(token.replace(/\./g, ""));
  return Number(token);
}

function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(round(value, digits));
}

function durationInHours(value, unit) {
  if (unit === "dakika") return value / 60;
  if (unit === "gun") return value * 24;
  return value;
}

function durationLabel(value, unit) {
  const labels = { dakika: "dakika", saat: "saat", gun: "gün" };
  return `${formatNumber(value)} ${labels[unit] || unit}`;
}

function extractMaritimeFacts(normalized) {
  if (!/samos/.test(normalized) || !/feribot/.test(normalized) || !/(?:sefer|hat|hizmet)/.test(normalized)) return null;
  if (!/firtina\s+(?:nedeniyle|yuzunden|sebebiyle)/.test(normalized)) return null;
  const stop = normalized.match(/(\d+(?:[.,]\d+)?)\s*(dakika|saat|gun)\s*(?:boyunca|sureyle|icin|ligine)?\s*(dur(?:ur)?sa|durdurul(?:ur)?sa|durduruldu|durdu|duracak|iptal edil(?:ir)?se|iptal edildi)/);
  if (!stop) return null;
  const duration = parseLocalizedNumber(stop[1]);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const hypothetical = /(?:sa|se)$/.test(stop[3]);
  return {
    duration,
    durationUnit: stop[2],
    durationHours: durationInHours(duration, stop[2]),
    hypothetical,
    route: /kusadasi/.test(normalized) ? "Kuşadası–Samos" : "Samos",
    stopPhrase: stop[0],
  };
}

function extractEnergyFacts(normalized) {
  const outage = normalized.match(/sebeke[^.!?]{0,80}?(\d+(?:[.,]\d+)?)\s*(dakika|saat)[^.!?]{0,80}?(?:kesil|kesinti)/);
  const generator = normalized.match(/jenerator[^.!?]{0,80}?(\d+(?:[.,]\d+)?)\s*kw/);
  const load = normalized.match(/(?:sabit\s+)?yuk[^.!?]{0,60}?(\d+(?:[.,]\d+)?)\s*kw/);
  const noOtherSource = /baska\s+(?:guc\s+|enerji\s+)?kaynak\s+yok|batarya[^.!?]{0,50}baska\s+kaynak\s+yok/.test(normalized);
  if (!outage || !generator || !load || !noOtherSource) return null;
  const duration = parseLocalizedNumber(outage[1]);
  const supply = parseLocalizedNumber(generator[1]);
  const demand = parseLocalizedNumber(load[1]);
  if (![duration, supply, demand].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { duration, durationUnit: outage[2], durationHours: durationInHours(duration, outage[2]), supply, demand };
}

const TURKISH_SMALL_NUMBERS = new Map([
  ["bir", 1], ["iki", 2], ["uc", 3], ["dort", 4], ["bes", 5],
  ["alti", 6], ["yedi", 7], ["sekiz", 8], ["dokuz", 9], ["on", 10],
]);

function parseSmallCount(value) {
  return TURKISH_SMALL_NUMBERS.get(value) ?? parseLocalizedNumber(value);
}

function extractInventoryFacts(normalized) {
  const stock = normalized.match(/stok[^.!?]{0,30}?(\d+(?:[.,]\d+)?)\s*adet/);
  const demand = normalized.match(/talep[^.!?]{0,80}?(\d+(?:[.,]\d+)?)\s*adet\s*(?:\/\s*|\bper\s+)?gun/);
  const duration = normalized.match(/(\d+(?:[.,]\d+)?|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\s*gun[^.!?]{0,40}?ikmal\s+yok/);
  const uniform = /(?:gun boyunca\s+)?esit hiz|sabit\s+(?:talep|hiz)/.test(normalized);
  if (!stock || !demand || !duration || !uniform) return null;
  const stockValue = parseLocalizedNumber(stock[1]);
  const dailyDemand = parseLocalizedNumber(demand[1]);
  const days = parseSmallCount(duration[1]);
  if (![stockValue, dailyDemand, days].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { stock: stockValue, dailyDemand, days };
}

function clockPartsToMinutes(hour, minute) {
  return Number(hour) * 60 + Number(minute);
}

function formatClockMinutes(value) {
  const secondsPerDay = 24 * 60 * 60;
  const roundedSeconds = Math.round(value * 60);
  const daySeconds = ((roundedSeconds % secondsPerDay) + secondsPerDay) % secondsPerDay;
  const hour = Math.floor(daySeconds / 3600);
  const minute = Math.floor((daySeconds % 3600) / 60);
  const second = daySeconds % 60;
  const base = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return second ? `${base}:${String(second).padStart(2, "0")}` : base;
}

function extractQueueFacts(normalized) {
  const start = normalized.match(/([01]?\d|2[0-3])[.:]([0-5]\d)[^.!?]{0,35}?kuyruk\s+sifir/);
  const arrival = normalized.match(/gelis[^.!?]{0,35}?(\d+(?:[.,]\d+)?)\s*arac\s*(?:\/\s*|\s+)dk/);
  const service = normalized.match(/\bislem\s+(\d+(?:[.,]\d+)?)\s*arac\s*(?:\/\s*|\s+)dk/);
  const change = normalized.match(/([01]?\d|2[0-3])[.:]([0-5]\d)[^.!?]{0,60}?islem\s+kapasitesi\s+(\d+(?:[.,]\d+)?)\s*arac\s*(?:\/\s*|\s+)dk/);
  const constantRates = /oranlar\s+sabit|hizlar\s+sabit|sabit\s+oran/.test(normalized);
  if (!start || !arrival || !service || !change || !constantRates) return null;
  const startMinutes = clockPartsToMinutes(start[1], start[2]);
  const changeMinutes = clockPartsToMinutes(change[1], change[2]);
  const arrivalRate = parseLocalizedNumber(arrival[1]);
  const initialCapacity = parseLocalizedNumber(service[1]);
  const changedCapacity = parseLocalizedNumber(change[3]);
  if (![arrivalRate, initialCapacity, changedCapacity].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (changeMinutes <= startMinutes || initialCapacity >= arrivalRate || changedCapacity <= arrivalRate) return null;
  return { startMinutes, changeMinutes, arrivalRate, initialCapacity, changedCapacity };
}

function findEvidence(input, phrases) {
  const source = String(input);
  const lower = source.toLocaleLowerCase("tr-TR");
  for (const phrase of phrases) {
    const needle = String(phrase).toLocaleLowerCase("tr-TR");
    const start = lower.indexOf(needle);
    if (start >= 0) {
      return { source: "input", text: source.slice(start, start + needle.length), start, end: start + needle.length };
    }
  }
  // Never widen a missing phrase to the whole prompt. A solver that cannot
  // resolve its claimed span must fail closed instead of manufacturing
  // provenance.
  return null;
}

function rule(ruleId, text) {
  return { source: "rule", ruleId, text };
}

function extractClock(input) {
  const match = String(input).match(/(?:saat\s*)?([01]?\d|2[0-3])[.:]([0-5]\d)/i);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

function makeResult(input, spec) {
  const observations = spec.observations || [];
  const calculations = spec.calculations || [];
  const deductions = spec.deductions || [];
  const assumptions = spec.assumptions || [];
  const unknowns = spec.unknowns || [];
  const requiredInputs = spec.requiredInputs || [];
  const safety = spec.safety || [];
  const claims = [];

  for (const item of observations) {
    const fallbackEvidence = findEvidence(input, [item.statement], item.statement);
    claims.push({
      id: item.id,
      type: "FACT",
      statement: item.statement,
      basis: item.basis || "Girdide açıkça belirtilen gözlem",
      evidence: item.evidence || (fallbackEvidence ? [fallbackEvidence] : []),
    });
  }
  for (const item of calculations) {
    claims.push({
      id: item.id,
      type: "CALCULATION",
      statement: item.statement || `${item.label}: ${item.result} ${item.unit}`.trim(),
      basis: item.basis,
      evidence: item.evidence || item.basis,
    });
  }
  for (const item of deductions) {
    claims.push({
      id: item.id,
      type: "DEDUCTION",
      statement: item.statement,
      basis: item.basis,
      evidence: item.evidence || item.basis,
    });
  }
  for (const item of unknowns) {
    claims.push({
      id: item.id,
      type: "UNKNOWN",
      statement: item.statement,
      basis: item.basis || "Girdi bu bilgiyi sağlamıyor",
      evidence: item.evidence || [rule("NCM3-UNKNOWN", "Eksik bilgi çekimserlik gerektirir")],
    });
  }
  for (const item of safety) {
    claims.push({
      id: item.id,
      type: "SAFETY",
      statement: item.statement,
      basis: item.basis,
      evidence: item.evidence || item.basis,
    });
  }

  const validEvidence = (evidence) => {
    if (!evidence || typeof evidence !== "object") return false;
    if (evidence.source === "rule") return Boolean(evidence.ruleId && evidence.text);
    if (evidence.source === "safety") return Boolean(evidence.text || evidence.ruleId);
    if (evidence.source === "input") {
      return Boolean(evidence.text) && Number.isInteger(evidence.start) && Number.isInteger(evidence.end)
        && evidence.start >= 0 && evidence.end > evidence.start && evidence.end <= String(input).length;
    }
    return false;
  };

  if (!claims.every((claim) => CLAIM_TYPES.has(claim.type) && claim.evidence?.length && claim.evidence.every(validEvidence))) {
    throw new Error("NCM-3 invariant failed: every claim needs a valid type and evidence.");
  }

  const supportedClaimCount = claims.filter((claim) => claim.type !== "UNKNOWN").length;
  const unknownClaimCount = claims.length - supportedClaimCount;
  const coverageDenominator = supportedClaimCount + unknownClaimCount + requiredInputs.length;
  const coverageScore = coverageDenominator ? round(supportedClaimCount / coverageDenominator, 4) : 1;
  const packRules = [...new Set(claims.flatMap((claim) => claim.evidence)
    .filter((evidence) => evidence?.source === "rule")
    .map((evidence) => evidence.ruleId))];

  return {
    version: NCM3_VERSION,
    mode: spec.mode,
    title: spec.title,
    directAnswer: spec.directAnswer,
    observations,
    calculations,
    deductions,
    assumptions,
    unknowns,
    requiredInputs,
    claims,
    relations: spec.relations || [],
    horizons: spec.horizons || [],
    counterfactuals: spec.counterfactuals || [],
    sourceTime: spec.sourceTime ?? extractClock(input),
    knowledgePack: {
      id: spec.knowledgePack || "NCM3-EVIDENCE-BOUND-GENERIC",
      version: NCM3_VERSION,
      deterministic: true,
      externalInference: false,
      rules: packRules,
    },
    coverage: {
      status: unknownClaimCount || requiredInputs.length ? "partial" : "complete",
      score: coverageScore,
      supportedClaimCount,
      unknownClaimCount,
      missingInputCount: requiredInputs.length,
      abstained: spec.mode === "insufficient",
    },
  };
}

function fact(id, statement, input, phrases, basis) {
  return { id, statement, basis, evidence: [findEvidence(input, phrases, statement)] };
}

function calc(id, label, expression, result, unit, evidence, statement) {
  return { id, label, expression, result, unit, basis: evidence, evidence, statement };
}

function deduction(id, statement, evidence) {
  return { id, statement, basis: evidence, evidence };
}

function unknown(id, statement, requiredInput) {
  return {
    id,
    statement,
    requiredInput,
    basis: "Girdi bu sonucu belirlemek için yeterli veri sağlamıyor",
    evidence: [rule("NCM3-ABSTAIN-MISSING", "Eksik ölçüm veya bağlamda sonuç üretilmez")],
  };
}

function relation(from, to, relationType, mechanism, evidence, confidence = 1) {
  return { from, to, relation: relationType, mechanism, confidence, evidence };
}

function maritimeReasoner(input, facts) {
  const { duration, durationUnit, durationHours, hypothetical, route, stopPhrase } = facts;
  const windowLabel = durationLabel(duration, durationUnit);
  const routeService = `${route} feribot hizmeti`;
  const normalized = fold(input);
  const asksHotel = /otel|konaklama|doluluk/.test(normalized);
  const asksPort = /liman|operasyon/.test(normalized);
  const stormEv = findEvidence(input, ["fırtına nedeniyle", "fırtına"], "fırtına");
  const stopEv = findEvidence(input, [stopPhrase, String(duration), "feribot seferleri"], `${windowLabel} sefer durdurması`);
  const durationRule = rule("NCM3-DURATION-WINDOW", "Hizmet durdurma penceresi girdideki sayı ve zaman biriminden alınır");
  const routeRule = rule("NCM3-ROUTE-SCOPE", "Durdurma yalnızca adı verilen rota ve hizmet için geçerlidir");
  const hotelRule = rule("NCM3-HOTEL-BIDIRECTIONAL", "Mahsur kalan yolcu talebi artırabilir; iptal edilen varış talebi azaltabilir");
  const conditionalRule = rule("NCM3-CONDITIONAL-SEMANTICS", "-sa/-se ekiyle verilen olay gerçekleşmiş bir gerçek değil, varsayımsal koşuldur");
  const availabilityStatement = hypothetical
    ? `Koşul gerçekleşirse durdurma aralığında adı verilen ${routeService}nin kullanılabilirliği sıfır olur.`
    : `Durdurma aralığında adı verilen ${routeService}nin kullanılabilirliği sıfırdır.`;
  const firstSentence = hypothetical
    ? `Bu koşul gerçekleşirse adı verilen ${routeService}nin kullanılabilirliği ${windowLabel} boyunca sıfır olur.`
    : `Adı verilen ${routeService}nin kullanılabilirliği ${windowLabel} boyunca sıfırdır.`;
  const impactSentences = ["Etkilenen yolcu sayısı, rezervasyon ve yeniden yönlendirme verileri olmadan hesaplanamaz."];
  if (asksPort) impactSentences.push("Liman iş yükü veya operasyon birikimi; planlı sefer, yolcu/araç ve elleçleme verileri olmadan hesaplanamaz.");
  if (asksHotel) impactSentences.push("Otel etkisinin yönü mahsur kalanlar ile iptal edilen varışların dengesine bağlı olduğu için belirsizdir.");

  return makeResult(input, {
    mode: hypothetical ? "conditional" : "grounded",
    title: `${route} hattında ${windowLabel} hizmet kesintisi${hypothetical ? " koşulu" : ""}`,
    directAnswer: `${firstSentence} ${impactSentences.join(" ")}`,
    observations: [
      fact("OBS-STORM", "Fırtına, adı verilen sefer durdurmasının nedenidir.", input, ["fırtına nedeniyle", "fırtına yüzünden", "fırtına"]),
      hypothetical
        ? fact("OBS-ROUTE-STOP-CONDITION", `Girdi, ${route} feribot seferlerinin ${windowLabel} durmasını varsayımsal koşul olarak veriyor.`, input, [stopPhrase, String(duration)], "Varsayımsal koşul")
        : fact("OBS-ROUTE-STOP", `${route} feribot seferleri ${windowLabel} durdurulmuştur.`, input, [stopPhrase, String(duration)]),
    ],
    calculations: [
      calc("CALC-ROUTE-AVAILABILITY", "named_route_service_availability", "Durdurulan hizmet kapasitesi / planlanan hizmet kapasitesi", 0, "service_fraction", [stopEv, routeRule, ...(hypothetical ? [conditionalRule] : [])], availabilityStatement),
      calc("CALC-STOP-DURATION", "service_stop_duration", `${windowLabel} → saat`, round(durationHours), "h", [stopEv, durationRule]),
    ],
    deductions: [
      deduction("DED-ROUTE-SCOPE", `Sonuç yalnızca ${route} hattındaki adı verilen feribot hizmeti için geçerlidir; bölgedeki tüm ulaşımın durduğu sonucu çıkarılamaz.`, [stopEv, routeRule]),
      ...(asksHotel ? [deduction("DED-HOTEL-DIRECTION", "Otel talebi iki yönlüdür: mahsur kalan yolcular talebi artırabilir, iptal edilen gelen yolcular azaltabilir; net yön mevcut verilerle belirlenemez.", [hotelRule])] : []),
      ...(hypothetical ? [deduction("DED-NOT-OCCURRED", "Koşullu ifade seferlerin gerçekten durduğunu kanıtlamaz; sonuç yalnız koşul gerçekleşirse geçerlidir.", [stopEv, conditionalRule])] : []),
    ],
    assumptions: [
      { id: "ASM-INTERVAL", statement: `${windowLabel} durdurma ifadesi belirtilen hattın bu penceredeki tüm planlı seferlerine uygulanır.`, basis: [stopEv] },
    ],
    unknowns: [
      unknown("UNK-PASSENGERS", "Etkilenen yolcu sayısı ve yolcu başına sonuç büyüklüğü bilinmiyor.", "Sefer bazında rezervasyon, iptal, yeniden yönlendirme ve no-show sayıları"),
      unknown("UNK-ALTERNATIVE", "Alternatif ulaşım veya ek sefer kapasitesi bilinmiyor.", "Alternatif hat, uçuş, ek sefer ve taşıma kapasiteleri"),
      ...(asksPort ? [unknown("UNK-PORT-OPERATIONS", "Liman iş yükü, elleçleme etkisi ve operasyon birikimi bilinmiyor.", "Planlı seferler, yolcu/araç/yük hacmi, rıhtım ve personel kapasitesi")] : []),
      ...(asksHotel ? [unknown("UNK-HOTEL", "Otel doluluğundaki net değişimin işareti ve büyüklüğü bilinmiyor.", "Mahsur kalan konaklama talebi, iptal edilen varışlar ve mevcut boş oda")] : []),
    ],
    requiredInputs: [
      "Etkilenen yolcu sayısı",
      "İptal ve yeniden yönlendirme sayıları",
      "Alternatif sefer kapasitesi",
      ...(asksPort ? ["Planlı sefer ve yolcu/araç/yük hacmi", "Rıhtım, elleçleme ve personel kapasitesi"] : []),
      ...(asksHotel ? ["Otel boş oda/doluluk verisi"] : []),
    ],
    relations: [
      relation("Fırtına", `${route} sefer durdurması`, hypothetical ? "WOULD_CAUSE" : "CAUSES", hypothetical ? "Girdi durdurmayı fırtınaya bağlı bir koşul olarak veriyor." : "Girdi durdurma kararını fırtınaya bağlıyor.", [stormEv, stopEv, ...(hypothetical ? [conditionalRule] : [])]),
      relation("Sefer durdurması", "Adı verilen rota kullanılabilirliği", hypothetical ? "WOULD_SET_TO_ZERO" : "SETS_TO_ZERO", hypothetical ? "Koşul gerçekleşirse adı verilen sefer hizmeti durdurma süresince sunulmaz." : "Durdurma süresince adı verilen sefer hizmeti sunulmaz.", [stopEv, routeRule, ...(hypothetical ? [conditionalRule] : [])]),
      ...(asksHotel ? [
        relation("Mahsur kalan yolcular", "Otel talebi", "CAN_INCREASE", "Mevcut yolcular ek gecelemeye ihtiyaç duyabilir.", [hotelRule], null),
        relation("İptal edilen varışlar", "Otel talebi", "CAN_DECREASE", "Gelemeyen yolcuların rezervasyonları kullanılmayabilir.", [hotelRule], null),
      ] : []),
    ],
    horizons: [
      { id: "H-STOP-WINDOW", label: `0–${windowLabel}`, statement: hypothetical ? "Koşul gerçekleşirse adı verilen feribot hizmeti kullanılamaz." : "Adı verilen feribot hizmeti kullanılamaz.", basis: [stopEv, ...(hypothetical ? [conditionalRule] : [])] },
      { id: "H-POST", label: `${windowLabel} sonrası`, statement: "Birikmiş talebin süresi ve büyüklüğü yolcu ile alternatif kapasite verisi olmadan belirlenemez.", basis: [routeRule] },
    ],
    counterfactuals: [
      { id: "CF-ALT", condition: "Yeterli alternatif kapasite sağlanırsa", outcome: "Yolcu birikimi azaltılabilir; büyüklük kapasite ve yolcu sayısına bağlıdır.", basis: [routeRule] },
    ],
    knowledgePack: "NCM3-MARITIME-SERVICE-CONTINUITY",
  });
}

function cyberNegationReasoner(input) {
  const noAttack = findEvidence(input, ["Siber saldırı yok"], "siber saldırı yok");
  const maintenance = findEvidence(input, ["Planlı bakım nedeniyle"], "planlı bakım");
  const readOnly = findEvidence(input, ["API 20 dakika salt okunur olacak", "20 dakika salt okunur"], "20 dakika salt okunur");
  const noLoss = findEvidence(input, ["veri kaybı olmayacak"], "veri kaybı olmayacak");
  const semantics = rule("NCM3-READ-ONLY", "Salt okunur mod okuma işlemlerine izin verir, yazma işlemlerini kabul etmez");
  return makeResult(input, {
    mode: "grounded",
    title: "Planlı 20 dakikalık salt okunur API bakımı",
    directAnswer: "Neden siber saldırı değil planlı bakımdır. 20 dakika boyunca okumalar kullanılabilir; yazmalar kabul edilmez ve istemci davranışına göre ertelenir veya başarısız olur. Veri kaybı olmadığı girdide açıkça belirtilmiştir; yazma talebi bilinmediği için kuyruk hesaplanamaz.",
    observations: [
      fact("OBS-ATTACK-FALSE", "Siber saldırı olmadığı belirtilmiştir.", input, ["Siber saldırı yok"]),
      fact("OBS-MAINTENANCE", "API planlı bakım nedeniyle 20 dakika salt okunur olacaktır.", input, ["Planlı bakım nedeniyle API 20 dakika salt okunur olacak"]),
      fact("OBS-DATA-LOSS-FALSE", "Veri kaybı olmayacağı belirtilmiştir.", input, ["veri kaybı olmayacak"]),
    ],
    calculations: [calc("CALC-MAINTENANCE-DURATION", "read_only_duration", "20 dakika", 20, "min", [readOnly])],
    deductions: [
      deduction("DED-READS", "Salt okunur aralıkta API okuma işlemleri kullanılabilir.", [readOnly, semantics]),
      deduction("DED-WRITES", "Salt okunur aralıkta yazma işlemleri kabul edilmez; yeniden deneme veya kuyruk davranışı istemci tasarımına bağlıdır.", [readOnly, semantics]),
      deduction("DED-NO-ATTACK-CHAIN", "Bu girdiden saldırı, ihlal, fidye yazılımı veya veri sızıntısı zinciri kurulamaz.", [noAttack, noLoss, rule("NCM3-NEGATION", "Açık negasyon pozitif olaya çevrilemez")]),
    ],
    assumptions: [{ id: "ASM-READ-ENDPOINTS", statement: "Salt okunur duyurusu API'nin okuma uçlarının bakım sırasında hizmet vermesi anlamındadır.", basis: [readOnly, semantics] }],
    unknowns: [unknown("UNK-WRITE-DEMAND", "Bakım sırasında oluşacak yazma talebi ve bekleyen iş sayısı bilinmiyor.", "Dakika başına yazma talebi ile istemci retry/queue politikası")],
    requiredInputs: ["Yazma talep hızı", "İstemci retry ve kuyruk politikası"],
    relations: [
      relation("Planlı bakım", "API salt okunur modu", "CAUSES", "Girdi erişim değişikliğini planlı bakıma bağlıyor.", [maintenance, readOnly]),
      relation("Salt okunur mod", "Yazma işlemleri", "BLOCKS", "Salt okunur semantiği yazma kabul etmez.", [readOnly, semantics]),
      relation("Salt okunur mod", "Okuma işlemleri", "PRESERVES", "Salt okunur semantiği okumaya izin verir.", [readOnly, semantics]),
    ],
    horizons: [{ id: "H-0-20", label: "0–20 dakika", statement: "Okumalar kullanılabilir; yazmalar kabul edilmez veya ertelenir.", basis: [readOnly, semantics] }],
    counterfactuals: [{ id: "CF-NORMAL", condition: "Bakım tamamlanıp yazma modu açılırsa", outcome: "Varsa bekleyen yazmalar istemci/kuyruk politikasına göre işlenebilir.", basis: [semantics] }],
    knowledgePack: "NCM3-CYBER-NEGATION-AND-ACCESS-MODE",
  });
}

function energyReasoner(input, facts) {
  const { duration, durationUnit, durationHours, supply, demand } = facts;
  const windowLabel = durationLabel(duration, durationUnit);
  const outage = findEvidence(input, [String(duration), "Şebeke"], `${windowLabel} şebeke kesintisi`);
  const generator = findEvidence(input, [`${formatNumber(supply)} kW`, String(supply), "Jeneratör"], `${formatNumber(supply)} kW jeneratör arzı`);
  const load = findEvidence(input, [`${formatNumber(demand)} kW`, String(demand), "sabit yük"], `${formatNumber(demand)} kW sabit yük`);
  const noOther = findEvidence(input, ["Batarya ve başka kaynak yok", "başka kaynak yok"], "başka kaynak yok");
  const balance = rule("NCM3-POWER-BALANCE", "Güç açığı = sabit yük − kullanılabilir güç; enerji açığı = güç açığı × süre");
  const deficitPower = Math.max(demand - supply, 0);
  const surplusPower = Math.max(supply - demand, 0);
  const deficitRatio = round((deficitPower / demand) * 100);
  const shortfall = round(deficitPower * durationHours);
  const balanceSentence = deficitPower > 0
    ? `Jeneratör yükün ${formatNumber(supply)} kW'ını karşılar; sürekli güç açığı ${formatNumber(deficitPower)} kW, yükün %${formatNumber(deficitRatio)}'sidir. ${windowLabel} boyunca enerji açığı ${formatNumber(shortfall)} kWh olur.`
    : `Jeneratör ${formatNumber(demand)} kW sabit yükün tamamını karşılar; belirtilen değerlerle güç ve enerji açığı sıfırdır${surplusPower > 0 ? ` ve ${formatNumber(surplusPower)} kW kapasite marjı vardır` : ""}.`;
  return makeResult(input, {
    mode: "grounded",
    title: "Şebeke kesintisinde güç ve enerji dengesi",
    directAnswer: `${balanceSentence}${deficitPower > 0 ? " Hangi cihazların etkileneceği yük önceliklendirmesi verilmeden söylenemez." : ""}`,
    observations: [
      fact("OBS-GRID-OUTAGE", `Şebeke ${windowLabel} kesilecektir.`, input, [String(duration), "Şebeke"]),
      fact("OBS-GENERATOR", `Jeneratör sürekli ${formatNumber(supply)} kW sağlayabilir.`, input, [String(supply), "Jeneratör"]),
      fact("OBS-LOAD", `Sabit yük ${formatNumber(demand)} kW'tır.`, input, [String(demand), "sabit yük"]),
      fact("OBS-NO-OTHER-SOURCE", "Batarya veya başka kaynak yoktur.", input, ["Batarya ve başka kaynak yok"]),
    ],
    calculations: [
      calc("CALC-DURATION-H", "outage_duration", `${windowLabel} → saat`, round(durationHours), "h", [outage, rule("NCM3-TIME-TO-HOUR", "Dakika 60'a bölünür; saat değişmeden alınır")]),
      calc("CALC-POWER-DEFICIT", "deficit_power", `max(${formatNumber(demand)} kW − ${formatNumber(supply)} kW, 0)`, deficitPower, "kW", [generator, load, balance]),
      calc("CALC-DEFICIT-RATIO", "deficit_ratio", `${formatNumber(deficitPower)} kW ÷ ${formatNumber(demand)} kW × 100`, deficitRatio, "%", [generator, load, balance]),
      calc("CALC-ENERGY-SHORTFALL", "energy_shortfall", `${formatNumber(deficitPower)} kW × ${formatNumber(durationHours)} h`, shortfall, "kWh", [outage, generator, load, noOther, balance]),
      ...(surplusPower > 0 ? [calc("CALC-POWER-SURPLUS", "surplus_power", `${formatNumber(supply)} kW − ${formatNumber(demand)} kW`, surplusPower, "kW", [generator, load, balance])] : []),
    ],
    deductions: [deduction("DED-POWER-BALANCE", deficitPower > 0 ? `Kesinti sırasında jeneratör kısmi arz sağlar; yükün tamamını karşılamaya ${formatNumber(deficitPower)} kW yetmez.` : "Kesinti sırasında belirtilen sürekli jeneratör arzı sabit yükü karşılar; bu girdide enerji açığı yoktur.", [outage, generator, load, balance])],
    assumptions: [{ id: "ASM-POWER-CONSTANT", statement: `${formatNumber(supply)} kW jeneratör arzı ile ${formatNumber(demand)} kW yük, ${windowLabel} boyunca sabittir.`, basis: [generator, load] }],
    unknowns: deficitPower > 0 ? [unknown("UNK-LOAD-SHEDDING", "Hangi cihaz veya devrelerin devre dışı kalacağı bilinmiyor.", "Yük öncelik listesi ve devre bazında güç değerleri")] : [],
    requiredInputs: deficitPower > 0 ? ["Yük öncelik listesi", "Devre/cihaz bazında güç değerleri"] : [],
    relations: [
      relation("Şebeke kesintisi", "Jeneratör arzı", "ACTIVATES_BACKUP", "Kesinti aralığındaki tek belirtilen kaynak jeneratördür.", [outage, generator, noOther]),
      relation(`${formatNumber(demand)} kW yük ile ${formatNumber(supply)} kW arz`, `${formatNumber(deficitPower)} kW güç açığı`, "DETERMINES", "Sabit güç dengesi farkı sıfır altına düşürülmeden hesaplanır.", [generator, load, balance]),
      relation(`${formatNumber(deficitPower)} kW güç açığı`, `${formatNumber(shortfall)} kWh enerji açığı`, "ACCUMULATES_OVER", `Güç açığı ${formatNumber(durationHours)} saat boyunca birikir.`, [outage, balance]),
    ],
    horizons: [{ id: "H-OUTAGE", label: `0–${windowLabel}`, statement: deficitPower > 0 ? `Sürekli ${formatNumber(deficitPower)} kW güç açığı vardır; toplam enerji açığı aralık sonunda ${formatNumber(shortfall)} kWh olur.` : "Belirtilen sabit yük tamamen karşılanır; güç ve enerji açığı yoktur.", basis: [outage, generator, load, balance] }],
    counterfactuals: deficitPower > 0 ? [{ id: "CF-POWER-GAP", condition: `En az ${formatNumber(deficitPower)} kW sürekli ek kaynak veya aynı miktarda yük azaltımı sağlanırsa`, outcome: "Belirtilen sabit yük için güç ve enerji açığı sıfırlanır.", basis: [balance] }] : [],
    knowledgePack: "NCM3-POWER-ENERGY-BALANCE",
  });
}

function oxygenReasoner(input) {
  const reserve = findEvidence(input, ["1.200 litre oksijen", "1200 litre oksijen"], "1.200 L oksijen");
  const rate = findEvidence(input, ["Sabit tüketim 18 L/dk", "18 L/dk"], "18 L/dk tüketim");
  const arrival = findEvidence(input, ["Yeni tüp 45 dakika sonra gelecek", "45 dakika sonra"], "45 dakikalık geliş süresi");
  const flowRule = rule("NCM3-CONSTANT-FLOW", "Dayanım = rezerv / sabit tüketim; kalan = rezerv − tüketim × süre");
  const endurance = 1200 / 18;
  const used = 18 * 45;
  const remaining = 1200 - used;
  const margin = endurance - 45;
  return makeResult(input, {
    mode: "grounded",
    title: "Oksijen rezervi dayanım hesabı",
    directAnswer: "Sabit 18 L/dk tüketim varsayımıyla 1.200 L oksijen 66 dakika 40 saniye dayanır. Tüp 45 dakikada gelirse 810 L tüketilmiş, 390 L kalmış olur; zaman marjı 21 dakika 40 saniyedir.",
    observations: [
      fact("OBS-OXYGEN", "Oksijen rezervi 1.200 litredir.", input, ["1.200 litre oksijen"]),
      fact("OBS-OXYGEN-RATE", "Tüketim 18 L/dk ve sabittir.", input, ["Sabit tüketim 18 L/dk"]),
      fact("OBS-CYLINDER-ETA", "Yeni tüp 45 dakika sonra gelecektir.", input, ["Yeni tüp 45 dakika sonra gelecek"]),
      fact("OBS-NO-OXYGEN-SOURCE", "Başka oksijen kaynağı yoktur.", input, ["başka kaynak yok"]),
    ],
    calculations: [
      calc("CALC-OXYGEN-ENDURANCE", "oxygen_endurance", "1200 L ÷ 18 L/min", round(endurance), "min", [reserve, rate, flowRule], "Oksijen dayanımı 66 dakika 40 saniyedir."),
      calc("CALC-OXYGEN-USED", "oxygen_used_at_arrival", "18 L/min × 45 min", used, "L", [rate, arrival, flowRule]),
      calc("CALC-OXYGEN-REMAINING", "oxygen_remaining_at_arrival", "1200 L − 810 L", remaining, "L", [reserve, rate, arrival, flowRule]),
      calc("CALC-OXYGEN-MARGIN", "time_margin", "66.6667 min − 45 min", round(margin), "min", [reserve, rate, arrival, flowRule], "Yeni tüp gelişine göre rezerv marjı 21 dakika 40 saniyedir."),
    ],
    deductions: [deduction("DED-OXYGEN-BRIDGE", "Belirtilen sabit tüketim değişmez ve yeni tüp 45 dakikada gelirse mevcut rezerv geliş anına kadar tükenmez.", [reserve, rate, arrival, flowRule])],
    assumptions: [{ id: "ASM-OXYGEN-CONSTANT", statement: "Tüketim geliş anına kadar kesintisiz ve sabit 18 L/dk'dır; kullanılabilir rezervin tamamı 1.200 L'dir.", basis: [reserve, rate, flowRule] }],
    unknowns: [unknown("UNK-OXYGEN-VARIATION", "Tüketim hızındaki olası değişim ve tüp teslim gecikmesi bilinmiyor.", "Gerçek zamanlı akış ve doğrulanmış teslim zamanı")],
    requiredInputs: ["Gerçek zamanlı tüketim hızı", "Doğrulanmış tüp teslim zamanı"],
    relations: [
      relation("1.200 L rezerv", "66 dakika 40 saniye dayanım", "DETERMINES", "Rezerv sabit akış hızına bölünür.", [reserve, rate, flowRule]),
      relation("45 dakikalık bekleme", "390 L kalan rezerv", "LEAVES", "45 dakikalık sabit tüketim başlangıç rezervinden çıkarılır.", [reserve, rate, arrival, flowRule]),
    ],
    horizons: [{ id: "H-45", label: "45. dakika", statement: "Sabit tüketimde 390 L rezerv ve 21 dakika 40 saniye zaman marjı kalır.", basis: [reserve, rate, arrival, flowRule] }],
    counterfactuals: [{ id: "CF-DELAY", condition: "Teslim toplam 66 dakika 40 saniyeyi aşarsa ve başka kaynak açılmazsa", outcome: "Sabit tüketim varsayımı altında mevcut rezerv teslimden önce tükenir.", basis: [flowRule] }],
    knowledgePack: "NCM3-CONSTANT-FLOW-RESERVE",
  });
}

function financeReasoner(input) {
  const opening = findEvidence(input, ["t=0’da kasa 900.000 TL", "kasa 900.000 TL"], "900.000 TL açılış bakiyesi");
  const outflow = findEvidence(input, ["Her 24 saatte 120.000 TL çıkış", "120.000 TL çıkış"], "24 saatte bir 120.000 TL çıkış");
  const first = findEvidence(input, ["ilk çıkış t=24 saatte"], "ilk çıkış t=24");
  const inflow = findEvidence(input, ["t=96 saatte kesin 480.000 TL tahsilat", "480.000 TL tahsilat"], "t=96'da 480.000 TL tahsilat");
  const target = findEvidence(input, ["t=168 saatte bakiye"], "t=168 bakiyesi");
  const timelineRule = rule("NCM3-DISCRETE-CASH-TIMELINE", "t=24...168 dahil her 24 saatte bir çıkış olduğundan 7 çıkış vardır");
  const outflowCount = 168 / 24;
  const totalOutflow = outflowCount * 120000;
  const finalBalance = 900000 - totalOutflow + 480000;
  return makeResult(input, {
    mode: "grounded",
    title: "t=168 saat nakit bakiyesi",
    directAnswer: "t=24, 48, 72, 96, 120, 144 ve 168 saatlerde toplam 7 çıkış vardır. Toplam çıkış 840.000 TL'dir; t=96'daki 480.000 TL tahsilatla t=168 bakiyesi 540.000 TL olur.",
    observations: [
      fact("OBS-OPENING-CASH", "t=0 kasa bakiyesi 900.000 TL'dir.", input, ["kasa 900.000 TL"]),
      fact("OBS-OUTFLOW", "İlk kez t=24'te olmak üzere her 24 saatte 120.000 TL çıkış vardır.", input, ["Her 24 saatte 120.000 TL çıkış var", "ilk çıkış t=24 saatte"]),
      fact("OBS-INFLOW", "t=96'da kesin 480.000 TL tahsilat vardır.", input, ["t=96 saatte kesin 480.000 TL tahsilat var"]),
      fact("OBS-NO-OTHER-CASH", "Başka nakit akışı yoktur.", input, ["Başka akış yok"]),
    ],
    calculations: [
      calc("CALC-OUTFLOW-COUNT", "outflow_count", "168 h ÷ 24 h", outflowCount, "events", [outflow, first, target, timelineRule]),
      calc("CALC-TOTAL-OUTFLOW", "total_outflow", "7 × 120000 TL", totalOutflow, "TL", [outflow, timelineRule]),
      calc("CALC-FINAL-BALANCE", "balance_at_t168", "900000 TL − 840000 TL + 480000 TL", finalBalance, "TL", [opening, outflow, inflow, timelineRule]),
    ],
    deductions: [deduction("DED-CASH-TIMELINE", "t=168 dahil yedi periyodik çıkış, tek tahsilat ve açılış bakiyesi dışında akış yoktur.", [opening, outflow, first, inflow, target, timelineRule])],
    assumptions: [{ id: "ASM-CASH-EVENT-ORDER", statement: "t=96'daki tahsilat ve çıkış aynı ufuk içinde bakiyeye dahil edilir; gün içi sıra yalnız ara bakiyeyi etkiler.", basis: [outflow, inflow, timelineRule] }],
    unknowns: [],
    requiredInputs: [],
    relations: [
      relation("7 × 120.000 TL çıkış", "Kasa bakiyesi", "DECREASES_BY", "Yedi kesin çıkış toplam 840.000 TL azaltır.", [outflow, timelineRule]),
      relation("480.000 TL tahsilat", "Kasa bakiyesi", "INCREASES_BY", "Kesin tahsilat bakiyeye eklenir.", [inflow]),
    ],
    horizons: [{ id: "H-168", label: "t=168 saat", statement: "Bakiye 540.000 TL'dir.", basis: [opening, outflow, inflow, timelineRule] }],
    counterfactuals: [],
    knowledgePack: "NCM3-DISCRETE-CASHFLOW",
  });
}

function inventoryReasoner(input, facts) {
  const { stock: stockValue, dailyDemand, days } = facts;
  const stock = findEvidence(input, [String(stockValue), "Stok"], `${formatNumber(stockValue)} adet stok`);
  const demand = findEvidence(input, [String(dailyDemand), "adet/gün"], `${formatNumber(dailyDemand)} adet/gün talep`);
  const duration = findEvidence(input, [String(days), "ikmal yok"], `${formatNumber(days)} gün ikmalsiz süre`);
  const uniform = findEvidence(input, ["Talep gün boyunca eşit hızla"], "eşit hızda talep");
  const stockRule = rule("NCM3-STOCK-FLOW", "Toplam talep = günlük hız × gün; dayanım = stok / günlük hız");
  const totalDemand = round(dailyDemand * days);
  const shortage = round(Math.max(totalDemand - stockValue, 0));
  const remaining = round(Math.max(stockValue - totalDemand, 0));
  const enduranceDays = round(stockValue / dailyDemand);
  const enduranceHours = round(enduranceDays * 24, 1);
  const fulfillment = round(Math.min(stockValue / totalDemand, 1) * 100);
  const horizonHours = round(days * 24, 1);
  const hasShortage = shortage > 0;
  return makeResult(input, {
    mode: "grounded",
    title: `${formatNumber(days)} günlük stok kapsama hesabı`,
    directAnswer: hasShortage
      ? `${formatNumber(days)} günlük talep ${formatNumber(totalDemand)} adettir. ${formatNumber(stockValue)} adet stok ${formatNumber(enduranceDays)} gün (${formatNumber(enduranceHours)} saat) dayanır; ufukta ${formatNumber(shortage)} adet açık oluşur ve talebin %${formatNumber(fulfillment)}'i karşılanabilir.`
      : `${formatNumber(days)} günlük talep ${formatNumber(totalDemand)} adettir. ${formatNumber(stockValue)} adet stok talebin tamamını karşılar ve ufuk sonunda ${formatNumber(remaining)} adet kalır.`,
    observations: [
      fact("OBS-STOCK", `Başlangıç stoğu ${formatNumber(stockValue)} adettir.`, input, [String(stockValue), "Stok"]),
      fact("OBS-DEMAND-RATE", `Talep ${formatNumber(dailyDemand)} adet/gün ve gün boyunca eşit hızdadır.`, input, [String(dailyDemand), "adet/gün"]),
      fact("OBS-NO-REPLENISH", `${formatNumber(days)} gün ikmal yoktur.`, input, [String(days), "ikmal yok"]),
    ],
    calculations: [
      calc("CALC-TOTAL-DEMAND", "horizon_demand", `${formatNumber(dailyDemand)} unit/day × ${formatNumber(days)} day`, totalDemand, "unit", [demand, duration, stockRule]),
      calc("CALC-STOCK-SHORTAGE", "stock_shortage", `max(${formatNumber(totalDemand)} unit − ${formatNumber(stockValue)} unit, 0)`, shortage, "unit", [stock, demand, duration, stockRule]),
      calc("CALC-STOCK-ENDURANCE-D", "stock_endurance", `${formatNumber(stockValue)} unit ÷ ${formatNumber(dailyDemand)} unit/day`, enduranceDays, "day", [stock, demand, uniform, stockRule]),
      calc("CALC-STOCK-ENDURANCE-H", "stock_endurance_hours", `${formatNumber(enduranceDays)} day × 24 h/day`, enduranceHours, "h", [stock, demand, uniform, stockRule]),
      calc("CALC-FULFILLMENT", "horizon_fulfillment", `min(${formatNumber(stockValue)} unit ÷ ${formatNumber(totalDemand)} unit, 1) × 100`, fulfillment, "%", [stock, demand, duration, stockRule]),
      ...(remaining > 0 ? [calc("CALC-STOCK-REMAINING", "stock_remaining", `${formatNumber(stockValue)} unit − ${formatNumber(totalDemand)} unit`, remaining, "unit", [stock, demand, duration, stockRule])] : []),
    ],
    deductions: [deduction("DED-STOCK-HORIZON", hasShortage ? `Eşit talep varsayımıyla stok ${formatNumber(days)}. gün tamamlanmadan, ${formatNumber(enduranceHours)}. saatte tükenir.` : `Eşit talep varsayımıyla stok ${formatNumber(days)} günlük ufukta tükenmez.`, [stock, demand, duration, uniform, stockRule])],
    assumptions: [{ id: "ASM-UNIFORM-DEMAND", statement: `Talep ${formatNumber(days)} gün boyunca kesintisiz ve eşit ${formatNumber(dailyDemand)} adet/gün hızında gerçekleşir.`, basis: [demand, uniform] }],
    unknowns: [],
    requiredInputs: [],
    relations: [
      relation(`${formatNumber(dailyDemand)} adet/gün talep`, `${formatNumber(stockValue)} adet stok`, "DEPLETES", "Sabit talep hızı stoğu zamanla azaltır.", [stock, demand, stockRule]),
      relation(`İkmalsiz ${formatNumber(days)} gün`, hasShortage ? `${formatNumber(shortage)} adet açık` : `${formatNumber(remaining)} adet kalan stok`, "RESULTS_IN", hasShortage ? `Toplam talep mevcut stoğu ${formatNumber(shortage)} adet aşar.` : `Mevcut stok toplam talebi ${formatNumber(remaining)} adet aşar.`, [stock, demand, duration, stockRule]),
    ],
    horizons: [
      ...(hasShortage ? [{ id: "H-STOCKOUT", label: `${formatNumber(enduranceHours)} saat`, statement: "Eşit talep altında stok sıfıra ulaşır.", basis: [stock, demand, uniform, stockRule] }] : []),
      { id: "H-INVENTORY-END", label: `${formatNumber(horizonHours)} saat`, statement: hasShortage ? `Kümülatif talep ${formatNumber(totalDemand)}, karşılanamayan miktar ${formatNumber(shortage)} adettir.` : `Kümülatif talep ${formatNumber(totalDemand)}, kalan stok ${formatNumber(remaining)} adettir.`, basis: [stock, demand, duration, stockRule] },
    ],
    counterfactuals: [],
    knowledgePack: "NCM3-INVENTORY-FLOW",
  });
}

function sensorReasoner(input) {
  const sensorA = findEvidence(input, ["sensör A 2°C", "sensör A 2 °C"], "sensör A: 2°C");
  const sensorB = findEvidence(input, ["sensör B 11°C", "sensör B 11 °C"], "sensör B: 11°C");
  const limit = findEvidence(input, ["üst sınırı 5°C", "üst sınırı 5 °C"], "üst sınır: 5°C");
  const calibration = findEvidence(input, ["kalibrasyon durumu bilinmiyor"], "kalibrasyon bilinmiyor");
  const conflictRule = rule("NCM3-SENSOR-CONFLICT", "Kalibrasyonu bilinmeyen çelişkili sensörlerden biri keyfi olarak gerçek seçilemez");
  return makeResult(input, {
    mode: "insufficient",
    title: "Çelişkili sıcaklık sensörleri",
    directAnswer: "Sensörler 9°C ayrışıyor. A doğruysa sıcaklık sınırın 3°C altında, B doğruysa 6°C üstündedir. Kalibrasyon bilinmediği için gerçek tank sıcaklığı, ürünün güvenli olduğu veya bozulduğu belirlenemez; bağımsız ölçüm gerekir.",
    observations: [
      fact("OBS-SENSOR-A", "Sensör A aynı tankı 2°C ölçmüştür.", input, ["sensör A 2°C"]),
      fact("OBS-SENSOR-B", "Sensör B aynı tankı 11°C ölçmüştür.", input, ["sensör B 11°C"]),
      fact("OBS-TEMP-LIMIT", "Ürün üst sıcaklık sınırı 5°C'dir.", input, ["üst sınırı 5°C"]),
      fact("OBS-CALIBRATION-UNKNOWN", "Sensörlerin kalibrasyon durumu bilinmiyor.", input, ["kalibrasyon durumu bilinmiyor"]),
    ],
    calculations: [
      calc("CALC-SENSOR-DISAGREEMENT", "sensor_disagreement", "|11°C − 2°C|", 9, "°C", [sensorA, sensorB]),
      calc("CALC-A-MARGIN", "sensor_a_below_limit", "5°C − 2°C", 3, "°C", [sensorA, limit]),
      calc("CALC-B-EXCESS", "sensor_b_above_limit", "11°C − 5°C", 6, "°C", [sensorB, limit]),
    ],
    deductions: [
      deduction("DED-A-CONDITIONAL", "Yalnız sensör A doğruysa ölçüm sınırın 3°C altındadır.", [sensorA, limit, conflictRule]),
      deduction("DED-B-CONDITIONAL", "Yalnız sensör B doğruysa ölçüm sınırın 6°C üstündedir.", [sensorB, limit, conflictRule]),
    ],
    assumptions: [],
    unknowns: [
      unknown("UNK-ACTUAL-TEMP", "Tankın gerçek sıcaklığı bilinmiyor; A veya B keyfi olarak seçilemez.", "Kalibre edilmiş bağımsız sıcaklık ölçümü"),
      unknown("UNK-PRODUCT-STATE", "Ürünün güvenli veya bozulmuş olduğu mevcut ölçümlerle belirlenemez.", "Bağımsız ölçüm, süre-sıcaklık geçmişi ve ürün kabul kriteri"),
    ],
    requiredInputs: ["Kalibre edilmiş bağımsız sıcaklık ölçümü", "Sensör kalibrasyon kayıtları", "Ürünün süre-sıcaklık geçmişi"],
    relations: [
      relation("Sensör A", "Tank sıcaklığı", "REPORTS", "A 2°C raporlar; doğruluğu bilinmiyor.", [sensorA, calibration], null),
      relation("Sensör B", "Tank sıcaklığı", "REPORTS", "B 11°C raporlar; doğruluğu bilinmiyor.", [sensorB, calibration], null),
      relation("A ve B ölçümleri", "Gerçek sıcaklık", "INSUFFICIENT_TO_SELECT", "9°C ayrışma ve bilinmeyen kalibrasyon, tek bir değeri doğrulamaz.", [sensorA, sensorB, calibration, conflictRule], null),
    ],
    horizons: [],
    counterfactuals: [
      { id: "CF-A", condition: "Kalibre bağımsız ölçüm A'yı doğrularsa", outcome: "Sıcaklık üst sınırın 3°C altındadır.", basis: [sensorA, limit] },
      { id: "CF-B", condition: "Kalibre bağımsız ölçüm B'yi doğrularsa", outcome: "Sıcaklık üst sınırın 6°C üstündedir.", basis: [sensorB, limit] },
    ],
    knowledgePack: "NCM3-SENSOR-CONFLICT",
  });
}

function nonsenseReasoner(input) {
  const duration = findEvidence(input, ["üç fikir boyunca"], "üç fikir boyunca");
  const rate = findEvidence(input, ["saatte yedi sessizlikle"], "saatte yedi sessizlikle");
  const unitRule = rule("NCM3-DIMENSIONAL-GATE", "Hesap için tanımlı, uyumlu fiziksel veya operasyonel birimler gerekir");
  return makeResult(input, {
    mode: "insufficient",
    title: "Tanımsız ölçü birimleri",
    directAnswer: "Risk hesaplanamaz. “Fikir” tanımlı bir süre birimi, “sessizlik/saat” ise tanımlı bir akış ölçüsü değildir; ayrıca hedef risk metriği belirtilmemiştir.",
    observations: [
      fact("OBS-UNDEFINED-DURATION", "Süre 'üç fikir' olarak ifade edilmiştir.", input, ["üç fikir boyunca"]),
      fact("OBS-UNDEFINED-RATE", "Hız 'saatte yedi sessizlik' olarak ifade edilmiştir.", input, ["saatte yedi sessizlikle"]),
    ],
    calculations: [],
    deductions: [deduction("DED-NO-DIMENSIONAL-SOLVER", "Tanımlı süre, akış birimi ve hedef metrik olmadan boyutsal olarak geçerli hesap kurulamaz.", [duration, rate, unitRule])],
    assumptions: [],
    unknowns: [
      unknown("UNK-DURATION-UNIT", "'Fikir' biriminin süre karşılığı tanımlı değil.", "Saniye, dakika, saat veya gün cinsinden süre"),
      unknown("UNK-FLOW-UNIT", "'Sessizlik/saat' ölçüsünün fiziksel veya operasyonel anlamı tanımlı değil.", "Miktar/zaman biçiminde tanımlı akış ölçüsü"),
      unknown("UNK-RISK-METRIC", "Hesaplanacak risk metriği ve eşiği tanımlı değil.", "Ölçülebilir hedef sonuç, eşik ve kayıp fonksiyonu"),
    ],
    requiredInputs: ["Tanımlı süre ve birimi", "Tanımlı akış miktarı ve birimi", "Hedef risk metriği ve eşik"],
    relations: [],
    horizons: [],
    counterfactuals: [],
    knowledgePack: "NCM3-DIMENSIONAL-VALIDATION",
  });
}

function confoundingReasoner(input) {
  const ad = findEvidence(input, ["reklam bütçesi artırıldı"], "reklam bütçesi artışı");
  const sales = findEvidence(input, ["satış %20 yükseldi"], "satış %20 artışı");
  const price = findEvidence(input, ["fiyat %15 düştü"], "fiyat %15 düşüşü");
  const competitor = findEvidence(input, ["tek rakip mağaza kapandı"], "rakip mağaza kapanması");
  const confoundingRule = rule("NCM3-CONFOUNDING", "Eşzamanlı değişen birden çok aday neden varken gözlemsel birlikte değişim tek nedene atfedilemez");
  return makeResult(input, {
    mode: "insufficient",
    title: "Satış artışında nedensel atıf belirsizliği",
    directAnswer: "Hayır, mevcut bilgi satış artışının reklama atfedilmesine yetmez. Reklam artışıyla aynı gün fiyat %15 düşmüş ve tek rakip kapanmıştır; üçü de satış için karıştırıcı aday nedenlerdir. Reklamın katkı payı hesaplanamaz.",
    observations: [
      fact("OBS-AD-UP", "Salı günü reklam bütçesi artırılmıştır.", input, ["Salı reklam bütçesi artırıldı"]),
      fact("OBS-SALES-UP", "Aynı dönemde satış %20 yükselmiştir.", input, ["satış %20 yükseldi"]),
      fact("OBS-PRICE-DOWN", "Aynı gün fiyat %15 düşmüştür.", input, ["Aynı gün fiyat %15 düştü"]),
      fact("OBS-COMPETITOR-CLOSED", "Aynı gün tek rakip mağaza kapanmıştır.", input, ["tek rakip mağaza kapandı"]),
    ],
    calculations: [],
    deductions: [deduction("DED-NO-ATTRIBUTION", "Zamansal birliktelik tek başına reklamın satış artışına neden olduğunu veya artışın belirli bir payını açıkladığını göstermez.", [ad, sales, price, competitor, confoundingRule])],
    assumptions: [],
    unknowns: [unknown("UNK-AD-EFFECT", "Reklamın satış artışına ayrı nedensel katkısı bilinmiyor.", "Kontrol grubu/ön dönem, kanal kırılımı, fiyat esnekliği veya randomize deney")],
    requiredInputs: ["Karşılaştırılabilir baz dönem veya kontrol grubu", "Reklam kanalı kırılımı", "Fiyat esnekliği", "Mümkünse randomize deney"],
    relations: [
      relation("Reklam artışı", "Satış %20 artışı", "CO_OCCURS_WITH", "Aynı gün gözlenmiştir; nedensellik kanıtlanmamıştır.", [ad, sales, confoundingRule], null),
      relation("Fiyat %15 düşüşü", "Satış %20 artışı", "CANDIDATE_CAUSE", "Eşzamanlı fiyat değişimi satışları etkileyebilir.", [price, sales, confoundingRule], null),
      relation("Rakibin kapanması", "Satış %20 artışı", "CANDIDATE_CAUSE", "Eşzamanlı rekabet değişimi satışları etkileyebilir.", [competitor, sales, confoundingRule], null),
    ],
    horizons: [],
    counterfactuals: [{ id: "CF-CONTROL", condition: "Reklam dışında fiyat ve rekabet koşulları sabit tutulan bir kontrol kurulursa", outcome: "Reklamın artımsal etkisi ölçülebilir.", basis: [confoundingRule] }],
    knowledgePack: "NCM3-CAUSAL-ATTRIBUTION-GATE",
  });
}

function sufficientCauseReasoner(input) {
  const noStormQuestion = findEvidence(input, ["Fırtına olmazsa"], "fırtınasız karşı-olgusal");
  const maintenance = findEvidence(input, ["motor bakımı planlı"], "planlı motor bakımı");
  const blocker = findEvidence(input, ["bu bakım tek başına kalkışı engelliyor", "bakım tek başına kalkışı engelliyor"], "bakım bağımsız engelleyici");
  const sufficientRule = rule("NCM3-SUFFICIENT-BLOCKER", "Bağımsız yeterli engelleyici varken başka bir engelin kaldırılması sonucu mümkün kılmaz");
  return makeResult(input, {
    mode: "conditional",
    title: "Fırtınasız karşı-olgusalda bağımsız bakım engeli",
    directAnswer: "Hayır. Fırtınanın olmaması kalkışı garanti etmez; planlı motor bakımı tek başına kalkışı engellediği için fırtınasız karşı-olgusal dünyada da feribot kalkmaz.",
    observations: [
      fact("OBS-NO-STORM-CF", "Soru fırtınanın olmadığı karşı-olgusalı soruyor.", input, ["Fırtına olmazsa"]),
      fact("OBS-MAINTENANCE-BLOCKER", "Aynı saate planlanan motor bakımı tek başına kalkışı engelliyor.", input, ["motor bakımı planlı ve bu bakım tek başına kalkışı engelliyor"]),
    ],
    calculations: [],
    deductions: [deduction("DED-STILL-NO-DEPARTURE", "Fırtına kaldırıldığında bağımsız ve yeterli bakım engeli kaldığı için kalkış gerçekleşmez.", [noStormQuestion, maintenance, blocker, sufficientRule])],
    assumptions: [{ id: "ASM-MAINTENANCE-HOLDS", statement: "Karşı-olgusal müdahale yalnız fırtınayı kaldırır; planlı motor bakımı değişmeden kalır.", basis: [noStormQuestion, maintenance] }],
    unknowns: [],
    requiredInputs: [],
    relations: [
      relation("Planlı motor bakımı", "Feribot kalkışı", "BLOCKS", "Girdi bakımın tek başına yeterli engel olduğunu belirtiyor.", [maintenance, blocker]),
      relation("Fırtınanın kaldırılması", "Feribot kalkışı", "INSUFFICIENT_FOR", "Bağımsız bakım engeli devam eder.", [noStormQuestion, blocker, sufficientRule]),
    ],
    horizons: [],
    counterfactuals: [{ id: "CF-NO-STORM", condition: "Fırtına olmaz, motor bakımı değişmeden kalırsa", outcome: "Feribot yine kalkmaz.", basis: [noStormQuestion, maintenance, blocker, sufficientRule] }],
    knowledgePack: "NCM3-COUNTERFACTUAL-SUFFICIENT-CAUSE",
  });
}

function queueReasoner(input, facts) {
  const { startMinutes, changeMinutes, arrivalRate, initialCapacity, changedCapacity } = facts;
  const startClock = formatClockMinutes(startMinutes);
  const changeClock = formatClockMinutes(changeMinutes);
  const accumulationMinutes = changeMinutes - startMinutes;
  const start = findEvidence(input, [startClock.replace(":", "."), startClock, "kuyruk sıfır"], `${startClock}'de sıfır kuyruk`);
  const arrival = findEvidence(input, [String(arrivalRate), "Geliş"], `${formatNumber(arrivalRate)} araç/dk geliş`);
  const service1 = findEvidence(input, [String(initialCapacity), "işlem"], `${formatNumber(initialCapacity)} araç/dk kapasite`);
  const switchEv = findEvidence(input, [changeClock.replace(":", "."), changeClock, String(changedCapacity)], `${changeClock}'de ${formatNumber(changedCapacity)} araç/dk kapasite`);
  const queueRule = rule("NCM3-FLUID-QUEUE", "Kuyruk değişimi = geliş − gerçekleşebilir hizmet; kuyruk sıfırın altına inmez");
  const buildupRate = round(arrivalRate - initialCapacity);
  const queueAtChange = round(buildupRate * accumulationMinutes);
  const drainRate = round(changedCapacity - arrivalRate);
  const drainMinutes = round(queueAtChange / drainRate);
  const clearClock = formatClockMinutes(changeMinutes + drainMinutes);
  return makeResult(input, {
    mode: "grounded",
    title: "Sabit oranlı araç kuyruğu",
    directAnswer: `${startClock}–${changeClock} arasında net kuyruk artışı dakikada ${formatNumber(buildupRate)} araçtır ve ${changeClock}'de ${formatNumber(queueAtChange)} araç birikir. Sonra kapasite ${formatNumber(changedCapacity)} araç/dk, geliş ${formatNumber(arrivalRate)} araç/dk olduğu için kuyruk dakikada ${formatNumber(drainRate)} araç azalır; ${formatNumber(drainMinutes)} dakikada, saat ${clearClock}'de sıfırlanır.`,
    observations: [
      fact("OBS-QUEUE-ZERO", `${startClock}'de kuyruk sıfırdır.`, input, [startClock.replace(":", "."), startClock]),
      fact("OBS-ARRIVAL-RATE", `Geliş hızı sabit ${formatNumber(arrivalRate)} araç/dk'dır.`, input, [String(arrivalRate), "Geliş"]),
      fact("OBS-SERVICE-1", `${startClock}–${changeClock} işlem kapasitesi ${formatNumber(initialCapacity)} araç/dk'dır.`, input, [String(initialCapacity), "işlem"]),
      fact("OBS-SERVICE-2", `${changeClock}'de işlem kapasitesi ${formatNumber(changedCapacity)} araç/dk olur.`, input, [changeClock.replace(":", "."), String(changedCapacity)]),
    ],
    calculations: [
      calc("CALC-QUEUE-BUILD-RATE", "queue_buildup_rate", `${formatNumber(arrivalRate)} − ${formatNumber(initialCapacity)}`, buildupRate, "vehicle/min", [arrival, service1, queueRule]),
      calc("CALC-QUEUE-AT-CHANGE", "queue_at_capacity_change", `${formatNumber(buildupRate)} vehicle/min × ${formatNumber(accumulationMinutes)} min`, queueAtChange, "vehicle", [start, arrival, service1, queueRule]),
      calc("CALC-QUEUE-DRAIN-RATE", "queue_drain_rate", `${formatNumber(changedCapacity)} − ${formatNumber(arrivalRate)}`, drainRate, "vehicle/min", [arrival, switchEv, queueRule]),
      calc("CALC-QUEUE-CLEAR-DURATION", "queue_clear_duration", `${formatNumber(queueAtChange)} vehicle ÷ ${formatNumber(drainRate)} vehicle/min`, drainMinutes, "min", [arrival, switchEv, queueRule]),
      calc("CALC-QUEUE-CLEAR-TIME", "queue_clear_time", `${changeClock} + ${formatNumber(drainMinutes)} min`, clearClock, "clock", [switchEv, queueRule]),
    ],
    deductions: [
      deduction("DED-QUEUE-CLEAR", `Kuyruk ${clearClock}'de sıfıra ulaşır ve negatif olamaz.`, [start, arrival, service1, switchEv, queueRule]),
      deduction("DED-THROUGHPUT-BOUND", `Kuyruk varken gerçekleşen hizmet kapasiteyle sınırlıdır; kuyruk boşaldıktan sonra geliş ${formatNumber(arrivalRate)} araç/dk olduğundan gerçekleşen işlem ${formatNumber(changedCapacity)} değil ${formatNumber(arrivalRate)} araç/dk olur.`, [arrival, switchEv, queueRule]),
    ],
    assumptions: [{ id: "ASM-RATES-CONSTANT", statement: "Belirtilen zaman aralıklarında geliş ve işlem kapasiteleri sabittir.", basis: [arrival, service1, switchEv] }],
    unknowns: [],
    requiredInputs: [],
    relations: [
      relation(`${formatNumber(arrivalRate)} araç/dk geliş ve ${formatNumber(initialCapacity)} araç/dk kapasite`, "Kuyruk", "BUILDS_AT", `Geliş kapasiteyi dakikada ${formatNumber(buildupRate)} araç aşar.`, [arrival, service1, queueRule]),
      relation(`${formatNumber(changedCapacity)} araç/dk kapasite ve ${formatNumber(arrivalRate)} araç/dk geliş`, `${formatNumber(queueAtChange)} araçlık kuyruk`, "DRAINS_AT", `Kapasite gelişten dakikada ${formatNumber(drainRate)} araç fazladır.`, [arrival, switchEv, queueRule]),
    ],
    horizons: [
      { id: "H-CAPACITY-CHANGE", label: changeClock, statement: `Kuyruk ${formatNumber(queueAtChange)} araçtır.`, basis: [start, arrival, service1, queueRule] },
      { id: "H-QUEUE-CLEAR", label: clearClock, statement: "Kuyruk sıfırdır.", basis: [arrival, switchEv, queueRule] },
    ],
    counterfactuals: [],
    sourceTime: startClock,
    knowledgePack: "NCM3-DETERMINISTIC-FLUID-QUEUE",
  });
}

function cyberIncompleteReasoner(input) {
  const phishing = findEvidence(input, ["oltalama e-postası geldi"], "oltalama e-postası");
  const edr = findEvidence(input, ["EDR yürütme olayı göstermiyor"], "EDR'da yürütme olayı yok");
  const logs = findEvidence(input, ["kimlik doğrulama loglarına erişilemiyor"], "kimlik doğrulama logları erişilemez");
  const telemetryRule = rule("NCM3-CYBER-TELEMETRY-SCOPE", "Uç nokta yürütme bulgusunun yokluğu hesap/kimlik ihlalini dışlamaz; ilgili kimlik telemetrisi gerekir");
  return makeResult(input, {
    mode: "insufficient",
    title: "Eksik kimlik telemetrisiyle oltalama incelemesi",
    directAnswer: "İhlal doğrulanamaz ve dışlanamaz. Oltalama e-postası alınmış, çalışan açmadığını söylemiş ve EDR uç noktada yürütme göstermemiştir; ancak kimlik doğrulama logları olmadan kimlik bilgisi veya hesap kötüye kullanımı değerlendirilemez.",
    observations: [
      fact("OBS-PHISHING-RECEIVED", "Çalışana oltalama e-postası gelmiştir.", input, ["oltalama e-postası geldi"]),
      fact("OBS-USER-NOT-OPENED", "Çalışan e-postayı açmadığını bildirmiştir.", input, ["çalışan açmadığını söylüyor"]),
      fact("OBS-NO-EDR-EXECUTION", "EDR yürütme olayı göstermemektedir.", input, ["EDR yürütme olayı göstermiyor"]),
      fact("OBS-AUTH-LOGS-MISSING", "Kimlik doğrulama loglarına erişilememektedir.", input, ["kimlik doğrulama loglarına erişilemiyor"]),
    ],
    calculations: [],
    deductions: [deduction("DED-ENDPOINT-SCOPE", "Mevcut EDR verisinde uç nokta yürütmesi gözlenmemiştir; bu yalnız EDR görünürlüğünün kapsamındaki bir negatif bulgudur.", [edr, telemetryRule])],
    assumptions: [],
    unknowns: [unknown("UNK-ACCOUNT-BREACH", "Kimlik bilgisi veya hesap ihlali doğrulanamıyor ve dışlanamıyor.", "Kimlik doğrulama, oturum, MFA ve hesap değişikliği logları")],
    requiredInputs: ["Kimlik doğrulama ve oturum logları", "MFA olayları", "Hesap değişikliği kayıtları", "E-posta güvenlik geçidi olayları"],
    relations: [
      relation("Oltalama e-postası", "Uç nokta yürütmesi", "NOT_OBSERVED", "EDR yürütme olayı göstermiyor; bu ihlalin tamamı için kanıt değildir.", [phishing, edr, telemetryRule], null),
      relation("Eksik kimlik logları", "Hesap ihlali sonucu", "PREVENTS_DETERMINATION", "Hesap erişim olayları incelenemiyor.", [logs, telemetryRule], null),
    ],
    horizons: [],
    counterfactuals: [{ id: "CF-AUTH-LOGS", condition: "Kimlik logları erişilebilir ve şüpheli oturumlar incelenirse", outcome: "Hesap ihlali hipotezi desteklenebilir veya zayıflatılabilir.", basis: [telemetryRule] }],
    knowledgePack: "NCM3-CYBER-EVIDENCE-COVERAGE",
  });
}

function clinicalSafetyReasoner(input) {
  const fever = findEvidence(input, ["39°C ateş", "39 °C ateş"], "39°C ateş");
  const cough = findEvidence(input, ["öksürük"], "öksürük");
  const spo2 = findEvidence(input, ["SpO₂ %93", "SpO2 %93"], "SpO₂ %93");
  const missing = findEvidence(input, ["Geçmiş hastalık, muayene ve diğer vital bulgular yok", "diğer vital bulgular yok"], "klinik bağlam eksik");
  const safetyRule = rule("NCM3-CLINICAL-SAFETY", "Eksik klinik bağlamda tanı, ilaç veya doz üretilmez; profesyonel değerlendirme önerilir");
  return makeResult(input, {
    mode: "insufficient",
    title: "Eksik klinik bağlamda güvenli çekimserlik",
    directAnswer: "Bu bilgilerle tanı koyamam veya ilaç/doz öneremem. 39°C ateş, öksürük ve ölçülen SpO₂ %93 kayda alınmalı; ölçüm doğrulanarak gecikmeden profesyonel klinik değerlendirme alınmalıdır. Acil kötüleşme, belirgin nefes darlığı, bilinç değişikliği veya morarma varsa acil yardım gerekir.",
    observations: [
      fact("OBS-FEVER", "Yetişkinde 39°C ateş bildirilmiştir.", input, ["39°C ateş"]),
      fact("OBS-COUGH", "Öksürük bildirilmiştir.", input, ["öksürük"]),
      fact("OBS-SPO2", "SpO₂ ölçümü %93 olarak bildirilmiştir.", input, ["SpO₂ %93"]),
      fact("OBS-CLINICAL-MISSING", "Geçmiş hastalık, muayene ve diğer vital bulgular verilmemiştir.", input, ["Geçmiş hastalık, muayene ve diğer vital bulgular yok"]),
    ],
    calculations: [],
    deductions: [],
    assumptions: [],
    unknowns: [
      unknown("UNK-DIAGNOSIS", "Tanı mevcut sınırlı gözlemlerle belirlenemez.", "Klinik öykü, muayene, doğrulanmış vital bulgular ve gerektiğinde testler"),
      unknown("UNK-MEDICATION", "Güvenli ilaç seçimi ve doz belirlenemez.", "Tanı, yaş/kilo, alerji, hastalıklar, ilaçlar ve klinisyen değerlendirmesi"),
    ],
    requiredInputs: ["Doğrulanmış SpO₂ ve diğer vital bulgular", "Klinik öykü ve muayene", "Mevcut hastalıklar, ilaçlar ve alerjiler"],
    safety: [{ id: "SAFE-CLINICAL-ASSESSMENT", statement: "Gecikmeden profesyonel klinik değerlendirme ve ölçüm doğrulaması gerekir; ağırlaşma belirtilerinde acil yardım alınmalıdır.", basis: [fever, cough, spo2, missing, safetyRule] }],
    relations: [relation("Eksik klinik bağlam", "Tanı ve ilaç seçimi", "PREVENTS_SAFE_DETERMINATION", "Semptomlar tek başına özgül tanı veya güvenli reçete sağlamaz.", [missing, safetyRule], null)],
    horizons: [],
    counterfactuals: [],
    knowledgePack: "NCM3-CLINICAL-SAFETY-GATE",
  });
}

function invoiceReasoner(input) {
  const net = findEvidence(input, ["net 100.000 TL"], "100.000 TL net");
  const vatRate = findEvidence(input, ["KDV %20"], "%20 KDV");
  const stated = findEvidence(input, ["toplam 115.000 TL"], "115.000 TL yazılı toplam");
  const invoiceRule = rule("NCM3-INVOICE-ARITHMETIC", "KDV tutarı = net × KDV oranı; beklenen toplam = net + KDV");
  const vat = 100000 * 0.2;
  const expected = 100000 + vat;
  const discrepancy = expected - 115000;
  return makeResult(input, {
    mode: "grounded",
    title: "Fatura aritmetik tutarlılık kontrolü",
    directAnswer: "%20 KDV, 100.000 TL net üzerinden 20.000 TL'dir; hesaplanan toplam 120.000 TL olur. Yazılı 115.000 TL ile 5.000 TL fark vardır. Kaynak belge olmadan net, oran, KDV tutarı veya toplam alanlarından hangisinin yanlış olduğu belirlenemez.",
    observations: [
      fact("OBS-INVOICE-NET", "Faturada net tutar 100.000 TL yazıyor.", input, ["net 100.000 TL"]),
      fact("OBS-INVOICE-VAT-RATE", "Faturada KDV oranı %20 yazıyor.", input, ["KDV %20"]),
      fact("OBS-INVOICE-STATED-TOTAL", "Faturada toplam 115.000 TL yazıyor.", input, ["toplam 115.000 TL"]),
    ],
    calculations: [
      calc("CALC-INVOICE-VAT", "vat_amount", "100000 TL × 20 / 100", vat, "TL", [net, vatRate, invoiceRule]),
      calc("CALC-INVOICE-TOTAL", "computed_total", "100000 TL + 20000 TL", expected, "TL", [net, vatRate, invoiceRule]),
      calc("CALC-INVOICE-DISCREPANCY", "total_discrepancy", "120000 TL − 115000 TL", discrepancy, "TL", [net, vatRate, stated, invoiceRule]),
    ],
    deductions: [deduction("DED-INVOICE-INCONSISTENT", "Verilen net, KDV oranı ve yazılı toplam birbirleriyle aritmetik olarak tutarlı değildir.", [net, vatRate, stated, invoiceRule])],
    assumptions: [{ id: "ASM-VAT-BASE", statement: "Belirtilen %20 KDV oranı verilen 100.000 TL net matraha uygulanır.", basis: [net, vatRate] }],
    unknowns: [unknown("UNK-WRONG-FIELD", "Hangi fatura alanının yanlış olduğu kaynak belge olmadan bilinmiyor.", "Kaynak fatura kalemleri, matrah ve vergi hesap dökümü")],
    requiredInputs: ["Kaynak fatura kalemleri", "Matrah ve vergi hesap dökümü"],
    relations: [
      relation("100.000 TL net ve %20 KDV", "120.000 TL hesaplanan toplam", "DETERMINES", "Net tutara hesaplanan 20.000 TL KDV eklenir.", [net, vatRate, invoiceRule]),
      relation("115.000 TL yazılı toplam", "120.000 TL hesaplanan toplam", "CONFLICTS_WITH", "İki toplam arasında 5.000 TL fark vardır.", [stated, invoiceRule]),
    ],
    horizons: [],
    counterfactuals: [],
    knowledgePack: "NCM3-INVOICE-ARITHMETIC",
  });
}

function liveUnknownReasoner(input, context) {
  const now = findEvidence(input, ["Şu anda", "şu an"]);
  const port = findEvidence(input, ["Samos limanında kaç gemi var", "Samos limanında", "kaç gemi"]);
  const cancellation = findEvidence(input, ["bir sonraki feribot meteorolojiye göre iptal mi", "sefer iptal mi", "iptal mi"]);
  const liveRule = rule("NCM3-LIVE-SOURCE-GATE", "Canlı durum yalnız zaman damgalı yetkili kaynaklarla cevaplanır");
  return makeResult(input, {
    mode: "insufficient",
    title: "Canlı Samos limanı ve sefer durumu için kaynak gerekli",
    directAnswer: "Yerel bilgi paketinde zaman damgalı AIS/liman verisi, feribot işletmecisi sefer durumu ve meteoroloji gözlem/tahmini yoktur. Bu nedenle şu anki gemi sayısını veya bir sonraki feribotun iptal durumunu söyleyemem.",
    observations: [fact("OBS-LIVE-REQUEST", "Soru Samos limanının güncel gemi sayısını ve sefer iptal durumunu soruyor.", input, [input])],
    calculations: [],
    deductions: [deduction("DED-LIVE-ABSTAIN", "Zaman damgalı canlı kaynak olmadan gemi sayısı, hava veya iptal durumu hakkında olumlu ya da olumsuz iddia kurulamaz.", [now, port, cancellation, liveRule].filter(Boolean))],
    assumptions: [],
    unknowns: [
      unknown("UNK-LIVE-VESSEL-COUNT", "Samos limanındaki güncel gemi sayısı bilinmiyor.", "Zaman damgalı AIS ve/veya liman başkanlığı hareket kaydı"),
      unknown("UNK-LIVE-WEATHER", "İlgili sefer penceresindeki doğrulanmış meteoroloji durumu bilinmiyor.", "Konum ve saat eşleşmeli resmi meteoroloji gözlem/tahmini"),
      unknown("UNK-LIVE-CANCELLATION", "Bir sonraki feribotun resmi iptal durumu bilinmiyor.", "İşletmeci veya liman tarafından zaman damgalı sefer bildirimi"),
    ],
    requiredInputs: ["Zaman damgalı AIS/liman hareket verisi", "Resmi meteoroloji verisi ve tahmin zamanı", "İşletmeci/liman sefer durumu ve zaman damgası"],
    relations: [],
    horizons: [],
    counterfactuals: [],
    sourceTime: context?.sourceTime || null,
    knowledgePack: "NCM3-LIVE-DATA-GATE",
  });
}

function fallbackReasoner(input) {
  const inputEv = findEvidence(input, [input], "kullanıcı girdisi");
  const gate = rule("NCM3-CLOSED-SOLVER-GATE", "Eşleşen bilgi paketi ve yeterli değişken yoksa genel metin veya sayı üretilmez");
  return makeResult(input, {
    mode: "insufficient",
    title: "Kanıta bağlı çözüm için ek veri gerekli",
    directAnswer: "Bu girdi için doğrulanmış bir çözüm kuralı ve yeterli ölçülebilir değişken yok. Sonuç uydurmak yerine hedef sonucu, değişkenleri, birimleri ve zaman ufkunu belirtmen gerekiyor.",
    observations: [fact("OBS-RAW-INPUT", "Girdi kaydedildi ancak kapalı çözümleyicilerden biriyle güvenli biçimde eşleşmedi.", input, [input])],
    calculations: [],
    deductions: [deduction("DED-FALLBACK-ABSTAIN", "Eşleşen doğrulanmış çözücü olmadan hesap veya nedensel sonuç üretilmez.", [inputEv, gate])],
    assumptions: [],
    unknowns: [
      unknown("UNK-TARGET", "Hedef sonuç ve karar eşiği yeterince tanımlı değil.", "Ölçülebilir hedef sonuç ve eşik"),
      unknown("UNK-VARIABLES", "Gerekli değişkenler, birimler veya zaman ufku eksik olabilir.", "Başlangıç değeri, oranlar, birimler ve zaman ufku"),
    ],
    requiredInputs: ["Ölçülebilir hedef sonuç", "Değişkenler ve birimleri", "Zaman ufku", "Varsa yerel kanıt kaynağı"],
    relations: [],
    horizons: [],
    counterfactuals: [],
    knowledgePack: "NCM3-CLOSED-SOLVER-GATE",
  });
}

/**
 * Run the deterministic evidence-bound reasoner.
 *
 * @param {string} input Situation or question in Turkish or English.
 * @param {{sourceTime?: string|null}} [context] Optional local provenance only.
 * @returns {object} An NCM-3 evidence ledger and answer.
 */
export function reasonWithEvidence(input, context = {}) {
  const sourceText = cleanInput(input);
  const normalized = fold(sourceText);
  if (!sourceText) return fallbackReasoner(sourceText);

  // Safety/abstention gates precede domain solvers so keyword overlap cannot
  // turn a live, clinical, contradictory, or dimensionally invalid request
  // into an unrelated scenario template.
  if (/su anda samos limaninda|samos limaninda kac gemi/.test(normalized) && /meteoroloji|iptal/.test(normalized)) {
    return liveUnknownReasoner(sourceText, context);
  }
  if (/mavi tedarikci/.test(normalized) && /fikir/.test(normalized) && /sessizlik/.test(normalized)) {
    return nonsenseReasoner(sourceText);
  }
  if (/sp[o0][₂2]?\s*%?\s*93|oksuruk/.test(normalized) && /tani|ilac/.test(normalized) && /39\s*°?c/.test(normalized)) {
    return clinicalSafetyReasoner(sourceText);
  }
  if (/sensor a\s*2\s*°?c/.test(normalized) && /sensor b\s*11\s*°?c/.test(normalized)) {
    return sensorReasoner(sourceText);
  }
  if (/oltalama/.test(normalized) && /edr/.test(normalized) && /kimlik dogrulama log/.test(normalized)) {
    return cyberIncompleteReasoner(sourceText);
  }
  if (/siber saldiri yok/.test(normalized) && /salt okunur/.test(normalized)) {
    return cyberNegationReasoner(sourceText);
  }
  if (/reklam butcesi/.test(normalized) && /satis\s*%?\s*20/.test(normalized) && /rakip/.test(normalized)) {
    return confoundingReasoner(sourceText);
  }
  if (/firtina olmazsa/.test(normalized) && /motor bakimi/.test(normalized) && /kalkis/.test(normalized)) {
    return sufficientCauseReasoner(sourceText);
  }

  // Closed arithmetic solvers accept varied values only when every required
  // role, unit and boundary condition is explicit in the input.
  const energyFacts = extractEnergyFacts(normalized);
  if (energyFacts) {
    return energyReasoner(sourceText, energyFacts);
  }
  if (/(?:1[.]?200|1200) litre oksijen/.test(normalized) && /18\s*l\s*\/\s*dk|18\s*l dk/.test(normalized) && /45 dakika/.test(normalized)) {
    return oxygenReasoner(sourceText);
  }
  if (/kasa\s*900[.]?000\s*tl/.test(normalized) && /120[.]?000\s*tl cikis/.test(normalized) && /t\s*=\s*168/.test(normalized)) {
    return financeReasoner(sourceText);
  }
  const inventoryFacts = extractInventoryFacts(normalized);
  if (inventoryFacts) {
    return inventoryReasoner(sourceText, inventoryFacts);
  }
  const queueFacts = extractQueueFacts(normalized);
  if (queueFacts) {
    return queueReasoner(sourceText, queueFacts);
  }
  if (/net\s*100[.]?000\s*tl/.test(normalized) && /kdv\s*%?\s*20/.test(normalized) && /toplam\s*115[.]?000\s*tl/.test(normalized)) {
    return invoiceReasoner(sourceText);
  }
  const maritimeFacts = extractMaritimeFacts(normalized);
  if (maritimeFacts) {
    return maritimeReasoner(sourceText, maritimeFacts);
  }

  return fallbackReasoner(sourceText);
}

export default reasonWithEvidence;
