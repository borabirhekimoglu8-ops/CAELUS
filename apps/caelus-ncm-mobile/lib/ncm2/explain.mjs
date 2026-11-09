import { ACTION_LIBRARY, DOMAIN_EFFECTS } from "./ontology.mjs";

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function percent(value) { return `%${Math.round(clamp(value) * 100)}`; }

function conceptByType(concepts, type, fallbackIndex = 0) {
  return concepts.find((concept) => concept.semanticType === type) || concepts[fallbackIndex] || concepts[0];
}

function relationSentence(relation) {
  if (!relation) return "Kritik yol henüz doğrulanamadı.";
  return `${relation.from}, ${relation.to} üzerinde ${relation.mechanism}; aktarım ${relation.lagTicks} model tick içinde belirginleşiyor.`;
}

function horizonSummary(forecast, situation) {
  const relation = forecast.criticalPath[0];
  const risk = forecast.systemRiskFp / 1_000_000;
  const posture = risk >= 0.78 ? "geri döndürülemez eşik yaklaşır" : risk >= 0.58 ? "darboğaz sistemik yayılıma döner" : "baskı tamponlar içinde tutulabilir";
  const mitigation = situation.activeMitigation
    ? " Girdideki koruyucu kapasite yayılımı yavaşlatıyor."
    : situation.failedMitigation ? " Koruyucu kapasitenin devreye girmemesi yayılımı hızlandırıyor." : "";
  return `${relationSentence(relation)} Bu pencerede ${posture}.${mitigation}`;
}

function domainRisks(situation, index) {
  const selected = [];
  for (const row of situation.activeDomains) {
    const effects = DOMAIN_EFFECTS[row.sector] || DOMAIN_EFFECTS.UNIVERSAL;
    selected.push(effects[index % effects.length]);
    if (selected.length === 2) break;
  }
  return [...new Set(selected)];
}

export function buildDeepExplanation({ situation, concepts, edges, forecasts, gateAudit, domainLabels }) {
  const trigger = conceptByType(concepts, "ACTOR", 0);
  const service = conceptByType(concepts, "SERVICE", 1);
  const capacity = conceptByType(concepts, "CAPACITY", 3);
  const bottleneck = concepts.find((concept) => concept.semanticType === "GATE") || capacity || conceptByType(concepts, "SERVICE", 1);
  const critical = conceptByType(concepts, "DEADLINE", 5);
  const immediate = forecasts[0];
  const extended = forecasts[forecasts.length - 1];
  const primaryRelation = immediate.criticalPath[0];
  const domainLabel = situation.activeDomains.map((row) => domainLabels[row.sector] || row.sector).join(" + ");

  const negationNote = situation.negatedEvents.length
    ? ` Girdide açıkça reddedilen ${situation.negatedEvents.join("/")} olayı aktif tetikleyici yapılmadı.`
    : "";
  const executiveSummary = [
    `${domainLabel} zincirinde ilk kırılma ${primaryRelation ? `${primaryRelation.from} → ${primaryRelation.to}` : `${trigger.label} → ${service.label}`} hattında oluşuyor.`,
    `${bottleneck.label} darboğazı büyürse ${critical.label} için kritik karar penceresi ${situation.durationHours <= 6 ? "ilk saatler" : "ilk 4–8 saat"}.`,
    `Baz senaryoda ${Number(situation.durationHours.toFixed(2))} saatlik pencerenin sonunda sistem riski ${percent(extended.systemRiskFp / 1_000_000)}, beklenen akış ${percent(extended.throughputFp / 1_000_000)} düzeyinde.`,
  ].join(" ") + negationNote;

  const horizons = forecasts.map((forecast, index) => ({
    key: forecast.key,
    label: forecast.label,
    range: forecast.range,
    summary: horizonSummary(forecast, situation),
    risks: domainRisks(situation, index),
    confidence: clamp(situation.confidence * (1 - forecast.uncertaintyFp / 2_000_000)),
    expected: {
      risk: forecast.systemRiskFp / 1_000_000,
      throughput: forecast.throughputFp / 1_000_000,
    },
    criticalPath: forecast.criticalPath,
  }));

  const baseRisk = extended.systemRiskFp / 1_000_000;
  const baseThroughput = extended.throughputFp / 1_000_000;
  const interventionGain = clamp(0.17 + (1 - baseRisk) * 0.05 + (situation.activeMitigation ? 0.07 : 0), 0.16, 0.29);
  const cascadeLoss = clamp(0.15 + situation.severity * 0.12 + (situation.failedMitigation ? 0.08 : 0), 0.16, 0.34);
  const counterfactuals = [
    {
      id: "baseline", label: "Baz", premise: "Yeni bir müdahale yapılmaz ve mevcut koşullar sürer.",
      outcome: `${critical.label} üzerindeki baskı ${percent(baseRisk)} riske ulaşır; ${capacity.label} kritik yolun ana tamponu olur.`,
      risk: baseRisk, throughput: baseThroughput, deltaRisk: 0, deltaThroughput: 0, confidence: situation.confidence,
    },
    {
      id: "contained", label: "Müdahale", premise: `${capacity.label} kritik yola ayrılır ve ${bottleneck.label} hızlandırılır.`,
      outcome: `${service.label} üzerindeki yayılım sınırlandırılır; geri döndürülemez eşik için zaman kazanılır.`,
      risk: clamp(baseRisk - interventionGain), throughput: clamp(baseThroughput + interventionGain * 0.62),
      deltaRisk: -interventionGain, deltaThroughput: interventionGain * 0.62, confidence: clamp(situation.confidence - 0.04),
    },
    {
      id: "cascade", label: "En kötü", premise: `${capacity.label} tükenir veya koruyucu kapasite devreye girmez.`,
      outcome: `${service.label} kaybı ${critical.label} bileşenine yayılır; ikincil alanlar aynı karar penceresine sıkışır.`,
      risk: clamp(baseRisk + cascadeLoss), throughput: clamp(baseThroughput - cascadeLoss * 0.68),
      deltaRisk: cascadeLoss, deltaThroughput: -cascadeLoss * 0.68, confidence: clamp(situation.confidence - 0.08),
    },
  ];

  const assumptions = [
    {
      id: "A-DURATION", text: `Simülasyon penceresi girdiden ${Number(situation.durationHours.toFixed(2))} saat olarak normalleştirildi.`,
      source: situation.quantitativeFacts.some((fact) => fact.includes("saat")) ? "input" : "default", confidence: situation.quantitativeFacts.length ? 1 : 0.55, material: true,
    },
    {
      id: "A-CAPACITY", text: situation.activeMitigation
        ? "Girdide belirtilen yedek/koruyucu kapasitenin zamanında çalıştığı varsayıldı."
        : situation.failedMitigation ? "Girdideki yedek kapasitenin devreye girmediği kabul edildi." : "Doğrulanmış ek kapasite bilgisi olmadığı için mevcut tampon sınırlı kabul edildi.",
      source: situation.activeMitigation || situation.failedMitigation ? "input" : "inferred", confidence: situation.activeMitigation || situation.failedMitigation ? 0.95 : 0.58, material: true,
    },
    {
      id: "A-RESPONSE", text: "Dış kurumların ek müdahalesi ancak hamle uygulanırsa modele girer; kendiliğinden yardım varsayılmadı.",
      source: "default", confidence: 0.72, material: true,
    },
  ];

  const unknowns = [
    `${capacity.label} için doğrulanmış kullanılabilir kapasite`,
    `${bottleneck.label} için gerçek hizmet/karar süresi`,
    `${critical.label} için kabul edilebilir kayıp eşiği`,
  ];
  const criticalSignals = [
    `${service.label}: akış kaybı ve toparlanma süresi`,
    `${bottleneck.label}: işlem hızı ve bekleyen iş`,
    `${capacity.label}: kalan tampon yüzdesi`,
    `${critical.label}: geri döndürülemez eşiğe kalan süre`,
  ];

  return {
    domainLabel,
    executiveSummary,
    horizons,
    counterfactuals,
    assumptions,
    unknowns,
    criticalSignals,
    gateAudit,
    evidence: [
      ...situation.frames.flatMap((frame) => frame.evidence),
      ...edges.slice(0, 8).flatMap((edge) => edge.evidence),
    ],
  };
}

export function buildContextualActions({ situation, concepts, forecasts }) {
  const final = forecasts[forecasts.length - 1];
  const ranked = concepts.map((concept) => ({
    concept,
    pressure: final.nodePressureFp[concept.key] || 0,
  })).sort((a, b) => b.pressure - a.pressure);
  const selected = [];
  for (const row of ranked) {
    if (selected.length >= 4 || selected.some((item) => item.concept.semanticType === row.concept.semanticType)) continue;
    selected.push(row);
  }
  for (const row of ranked) {
    if (selected.length >= 4 || selected.includes(row)) continue;
    selected.push(row);
  }
  return selected.slice(0, 4).map(({ concept, pressure }, index) => {
    const options = ACTION_LIBRARY[concept.semanticType] || ACTION_LIBRARY.SERVICE;
    const action = options[index % options.length];
    const probability = clamp(0.84 - pressure / 2_900_000 - situation.severity * 0.12 + (situation.activeMitigation ? 0.05 : 0), 0.44, 0.90);
    return {
      label: `${concept.label}: ${action}`,
      targetKey: concept.key,
      target: concept.label,
      probability,
      rationale: `${concept.label}, ${percent(pressure / 1_000_000)} tahmini baskıyla kritik yol üzerinde.`
    };
  });
}
