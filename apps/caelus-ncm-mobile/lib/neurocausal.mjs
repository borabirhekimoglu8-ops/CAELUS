import { NEURO_WEIGHTS } from "./neuro-weights.mjs";
import { parseSituation } from "./ncm2/frame-parser.mjs";
import {
  buildNeuralGate,
  buildSemanticGraph,
  runTemporalObserver,
  snapshotStates,
  TEMPORAL_MODEL_INFO,
} from "./ncm2/temporal-observer.mjs";
import { buildContextualActions, buildDeepExplanation } from "./ncm2/explain.mjs";

const INPUT = NEURO_WEIGHTS.input;
const SECTORS = NEURO_WEIGHTS.sectors;
const NCM2_VERSION = "NCM-2.0.0";
const NCM2_ARCHITECTURE = `${NEURO_WEIGHTS.architecture}+${TEMPORAL_MODEL_INFO.architecture}+DETERMINISTIC_NEURAL_GATE`;
const STOP_WORDS = new Set([
  "acaba", "ama", "ancak", "artik", "bana", "ben", "bence", "bile", "bir", "biri", "biz", "bu", "buna", "bunu",
  "cok", "daha", "de", "da", "diye", "en", "fakat", "gibi", "icin", "ile", "ise", "ki", "mi", "mu", "mı", "mü",
  "nasil", "neden", "ne", "olarak", "olan", "oldu", "olur", "sonra", "su", "şu", "ve", "veya", "ya", "yani",
  "the", "a", "an", "and", "or", "but", "for", "from", "in", "into", "of", "on", "to", "with", "what", "when",
  "where", "why", "how", "is", "are", "be", "will", "would", "should", "could", "this", "that", "scenario", "senaryo",
  "analiz", "et", "olursa", "oldugunda", "hakkinda", "ilgili", "uzerine", "nedeniyle", "sonucu", "durumunda",
]);
const CRISIS_WORDS = ["kriz", "saldiri", "cokus", "yangin", "deprem", "firtina", "iptal", "kesinti", "abluka", "grev", "salgin", "hack", "ariza", "kayip", "tehdit", "acil"];

const DOMAIN = {
  MARITIME: {
    label: "Denizcilik ve liman",
    roles: ["Ana sefer akışı", "Yolcu ve yük talebi", "Liman kapasitesi", "Gümrük kapısı", "Dış operasyon baskısı", "Zaman kritik yük"],
    actions: ["Alternatif kapasiteyi devreye al", "Akışı kritik gruplara göre sırala", "Ortak operasyon masası kur", "Zaman kritik yükü güvenceye al"],
  },
  AVIATION: {
    label: "Havacılık",
    roles: ["Uçuş akışı", "Slot talebi", "Filo ve pist kapasitesi", "Emniyet kapısı", "Dış trafik baskısı", "Kritik bağlantı"],
    actions: ["Filo kapasitesini yeniden planla", "Slot önceliği uygula", "Otoriteyle ortak karar kur", "Kritik bağlantıyı koru"],
  },
  SUPPLY: {
    label: "Tedarik ve üretim",
    roles: ["Üretim akışı", "Sipariş talebi", "Stok tamponu", "Tedarik kapısı", "Dış tedarik baskısı", "Kritik stok"],
    actions: ["Alternatif tedarik hattını aç", "Siparişleri önceliklendir", "Tampon stoğu yeniden dağıt", "Kritik stoğu koru"],
  },
  FINANCE: {
    label: "Finans ve piyasa",
    roles: ["Finansal akış", "İşlem talebi", "Likidite tamponu", "Düzenleyici kapı", "Piyasa baskısı", "Vade kritik yükümlülük"],
    actions: ["Likiditeyi yeniden dağıt", "İşlem önceliği koy", "Düzenleyici güven hattı aç", "Vade riskini korumaya al"],
  },
  CYBER: {
    label: "Siber ve teknoloji",
    roles: ["Servis sürekliliği", "Olay kuyruğu", "Yedek kapasite", "Kimlik ve güven kapısı", "Tehdit aktörü", "Kritik veri penceresi"],
    actions: ["Yedek kapasiteye geçir", "Olayları etki düzeyine göre sırala", "Güven zincirini yenile", "Kritik veriyi izole et"],
  },
  HEALTH: {
    label: "Sağlık",
    roles: ["Klinik hizmet akışı", "Hasta talebi", "Yatak ve malzeme kapasitesi", "Klinik güvenlik kapısı", "Dış sağlık baskısı", "Kritik vaka"],
    actions: ["Kapasiteyi yeniden dağıt", "Triyajı güçlendir", "Ortak klinik karar kur", "Kritik vakayı koru"],
  },
  ENERGY: {
    label: "Enerji ve altyapı",
    roles: ["Enerji arz akışı", "Talep yükü", "Rezerv kapasite", "Şebeke güvenlik kapısı", "Dış arz baskısı", "Kritik altyapı"],
    actions: ["Rezervi devreye al", "Talebi önceliklendir", "Şebeke adalarını ayır", "Kritik altyapıyı koru"],
  },
  SPACE: {
    label: "Uzay ve yüksek teknoloji",
    roles: ["Görev akışı", "Komut kuyruğu", "Enerji ve itki kapasitesi", "Görev emniyet kapısı", "Yörünge baskısı", "Kritik görev penceresi"],
    actions: ["Görev kaynaklarını yeniden dağıt", "Komutları önceliklendir", "Emniyet moduna geç", "Kritik pencereyi koru"],
  },
  SECURITY: {
    label: "Kamu ve stratejik güvenlik",
    roles: ["Stratejik hedef akışı", "Operasyonel baskı", "Kurumsal kapasite", "Hukuki karar kapısı", "Rakip aktör", "Zaman kritik insani unsur"],
    actions: ["Kaynakları ana hedefe yoğunlaştır", "Baskıyı kademelendir", "Doğrulanmış ortak kanal aç", "İnsani eşiği koru"],
  },
  BUSINESS: {
    label: "İş ve kurumsal operasyon",
    roles: ["Ana iş akışı", "Müşteri ve iş talebi", "Kaynak kapasitesi", "Yönetişim kapısı", "Rakip ve paydaş baskısı", "Kritik taahhüt"],
    actions: ["Kaynağı yeniden dağıt", "İş kuyruğunu önceliklendir", "Paydaş mutabakatı kur", "Kritik taahhüdü koru"],
  },
  UNIVERSAL: {
    label: "Evrensel sistem",
    roles: ["Ana sonuç akışı", "Talep ve baskı", "Kaynak kapasitesi", "Karar ve kısıt kapısı", "Dış aktör", "Zaman kritik unsur"],
    actions: ["Kaynağı ana sonuca yönlendir", "Darboğazı önceliklendir", "Doğrulama hattı kur", "Zaman kritik unsuru koru"],
  },
};

const NODE_KINDS = ["Service", "Queue", "Buffer", "Gate", "Adversary", "Perishable"];
const EDGE_CANDIDATES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 5], [1, 4], [2, 5]];

export function fold(value) {
  return String(value || "").replace(/İ/g, "I").replace(/ı/g, "i").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function hash32(value, salt = 0) {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function features(text) {
  const normalized = fold(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const x = Array(INPUT).fill(0);
  for (const token of tokens) {
    const bucket = hash32(token) % 96;
    x[bucket] += (hash32(token, 17) & 1) ? 1 : -1;
    const padded = `_${token}_`;
    for (let i = 0; i < padded.length - 2; i += 1) {
      const tri = padded.slice(i, i + 3);
      const triBucket = 96 + (hash32(tri, 29) % 24);
      x[triBucket] += (hash32(tri, 47) & 1) ? 0.35 : -0.35;
    }
  }
  const norm = Math.sqrt(x.reduce((sum, n) => sum + n * n, 0)) || 1;
  for (let i = 0; i < 120; i += 1) x[i] /= norm;
  SECTORS.forEach((sector, index) => {
    const anchors = NEURO_WEIGHTS.semanticLexicon[sector] || [];
    const hits = tokens.filter((token) => anchors.some((anchor) => token === anchor || token.startsWith(anchor) || anchor.startsWith(token))).length;
    x[120 + index] = Math.min(1, hits / 4);
  });
  x[131] = Math.min(1, tokens.length / 24);
  x[132] = /\d/.test(normalized) ? 1 : 0;
  x[133] = /saat|gun|hafta|dakika|hour|day|week/.test(normalized) ? 1 : 0;
  x[134] = CRISIS_WORDS.some((word) => normalized.includes(word)) ? 1 : 0;
  x[135] = /acil|kritik|derhal|emergency|critical/.test(normalized) ? 1 : 0;
  x[136] = /uluslararasi|sinir|global|international|border/.test(normalized) ? 1 : 0;
  x[137] = /art|yuksel|buyu|increase|surge/.test(normalized) ? 1 : 0;
  x[138] = /dur|kes|iptal|cok|fail|stop|cancel/.test(normalized) ? 1 : 0;
  x[139] = /azal|dus|kayip|reduce|drop|loss/.test(normalized) ? 1 : 0;
  x[140] = Math.min(1, new Set(tokens).size / 20);
  x[141] = Math.min(1, normalized.length / 300);
  x[142] = Math.min(1, CRISIS_WORDS.filter((word) => normalized.includes(word)).length / 3);
  x[143] = 1;
  return x;
}

function sigmoid(value) { return 1 / (1 + Math.exp(-Math.max(-18, Math.min(18, value)))); }
function softmax(values) {
  const max = Math.max(...values);
  const exp = values.map((value) => Math.exp(value - max));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return exp.map((value) => value / total);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function hex(value) { return (value >>> 0).toString(16).toUpperCase().padStart(8, "0"); }
function slug(value, fallback) {
  const normalized = fold(value).replace(/\s+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20).toUpperCase();
  return normalized || fallback;
}

export function runNeuralInference(text) {
  const x = features(text);
  const hidden = NEURO_WEIGHTS.w1.map((row, index) => Math.tanh(row.reduce((sum, weight, i) => sum + weight * x[i], NEURO_WEIGHTS.b1[index])));
  const raw = NEURO_WEIGHTS.w2.map((row, index) => row.reduce((sum, weight, i) => sum + weight * hidden[i], NEURO_WEIGHTS.b2[index]));
  const probabilities = softmax(raw.slice(0, SECTORS.length));
  const sectorIndex = probabilities.indexOf(Math.max(...probabilities));
  const values = raw.slice(SECTORS.length).map(sigmoid);
  return {
    model: NEURO_WEIGHTS.version,
    architecture: NEURO_WEIGHTS.architecture,
    sector: SECTORS[sectorIndex],
    confidence: probabilities[sectorIndex],
    probabilities: Object.fromEntries(SECTORS.map((sector, index) => [sector, probabilities[index]])),
    severity: values[0],
    nodeStates: values.slice(1, 7),
    edgeStrengths: values.slice(7, 15),
    leverSuccess: values.slice(15, 19),
    timeDynamics: values.slice(19, 25),
    latent: hidden,
  };
}

function conceptsFrom(text) {
  const words = String(text).match(/[A-Za-z0-9À-žĞğÜüŞşİıÖöÇç]+/g) || [];
  const seen = new Set();
  const concepts = [];
  for (const word of words) {
    const key = fold(word);
    if (key.length < 3 || STOP_WORDS.has(key) || seen.has(key) || /^\d+$/.test(key)) continue;
    seen.add(key);
    concepts.push({ key, label: word.charAt(0).toLocaleUpperCase("tr-TR") + word.slice(1) });
    if (concepts.length === 6) break;
  }
  return concepts;
}

function durationHours(text) {
  const normalized = fold(text);
  const match = normalized.match(/(\d{1,4})\s*(dakika|saat|gun|hafta|minute|hour|day|week)/);
  if (!match) return 72;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "dakika" || unit === "minute") return Math.max(1, amount / 60);
  if (unit === "gun" || unit === "day") return amount * 24;
  if (unit === "hafta" || unit === "week") return amount * 168;
  return amount;
}

export function compileLegacyScenario(input) {
  const sourceText = String(input || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (sourceText.length < 8) throw new Error("Nöro-nedensel model için daha açıklayıcı bir durum yazın.");
  const neural = runNeuralInference(sourceText);
  const domain = DOMAIN[neural.sector] || DOMAIN.UNIVERSAL;
  const concepts = conceptsFrom(sourceText);
  while (concepts.length < 6) {
    const index = concepts.length;
    concepts.push({ key: `unsur_${index + 1}`, label: domain.roles[index] });
  }
  const fingerprint = hex(hash32(`${NEURO_WEIGHTS.version}:${fold(sourceText)}`));
  const scenarioId = `NCM-${neural.sector}-${fingerprint}`;
  const duration = durationHours(sourceText);
  const tickMinutes = duration <= 24 ? 15 : 30;
  const deadlineTick = Math.max(8, Math.round((duration * 60) / tickMinutes));

  const nodes = concepts.slice(0, 6).map((concept, index) => {
    const state = clamp(0.16 + neural.nodeStates[index] * 0.78, 0.12, 0.96);
    const pressure = neural.timeDynamics[index];
    const hiddenRisk = index === 4 && neural.severity > 0.55;
    return {
      id: `${slug(concept.key, `UNSUR${index + 1}`)}_${index + 1}`,
      label: `${concept.label} · ${domain.roles[index]}`,
      kind: NODE_KINDS[index],
      capacity_fp: 1000000,
      state_fp: Math.round(state * 1000000),
      weight_fp: [260000, 240000, 220000, 210000, 180000, 200000][index],
      reported_state_fp: Math.round(clamp(state - (hiddenRisk ? 0.22 : 0), 0.06, 0.98) * 1000000),
      trust_fp: hiddenRisk ? 690000 : Math.round((0.84 + (1 - pressure) * 0.16) * 1000000),
      deadline_tick: index === 5 ? deadlineTick : -1,
      irrecoverable: false,
      notes: `${concept.label}, yerel sinir ağının ${domain.label} grafında ${domain.roles[index].toLocaleLowerCase("tr-TR")} rolüne yerleştirildi.`,
    };
  });

  const rankedEdges = EDGE_CANDIDATES.map(([from, to], index) => ({ from, to, strength: neural.edgeStrengths[index] }))
    .sort((a, b) => b.strength - a.strength).slice(0, 6);
  const edges = rankedEdges.map((edge, index) => ({
    from: nodes[edge.from].id,
    to: nodes[edge.to].id,
    multiplier_fp: Math.round((0.45 + edge.strength * 1.15) * 1000000),
    lag_ticks: 1 + Math.round(neural.timeDynamics[index % 6] * 4),
    active: true,
    notes: `${nodes[edge.from].label} → ${nodes[edge.to].label} yerel neural graph head tarafından ${(edge.strength * 100).toFixed(0)} güvenle bağlandı.`,
  }));
  nodes.forEach((node, index) => edges.push({
    from: node.id,
    to: "",
    multiplier_fp: Math.round((0.12 + neural.nodeStates[index] * 0.24) * 1000000),
    lag_ticks: 0,
    active: true,
  }));

  const targetOrder = [2, 1, 3, 5];
  const levers = domain.actions.map((label, index) => {
    const targetIndex = targetOrder[index];
    const probability = clamp(0.42 + neural.leverSuccess[index] * 0.52, 0.42, 0.94);
    return {
      id: `N-${index + 1}_${slug(label, `HAMLE${index + 1}`).slice(0, 22)}`,
      label,
      target: nodes[targetIndex].label,
      success_p_fp: Math.round(probability * 1000000),
      cost_ticks: 2 + Math.round(neural.timeDynamics[targetIndex] * 10),
      lockout_ticks: 8 + Math.round(neural.severity * 20),
      on_success: {
        target_node_id: nodes[targetIndex].id,
        state_delta_fp: -Math.round((0.12 + probability * 0.22) * 1000000),
        trust_delta_fp: index === 2 ? 180000 : 0,
        friction_delta_fp: -Math.round((0.05 + probability * 0.10) * 1000000),
        clear_irrecoverable: index === 3,
      },
      on_failure: {
        target_node_id: nodes[targetIndex].id,
        state_delta_fp: Math.round((0.02 + neural.severity * 0.04) * 1000000),
        trust_delta_fp: index === 2 ? -60000 : 0,
        friction_delta_fp: 30000,
        clear_irrecoverable: false,
      },
      notes: `${label}; yerel model güveni %${(probability * 100).toFixed(0)}.`,
    };
  });

  const strongest = rankedEdges[0];
  const second = rankedEdges[1];
  const synopsis = `${domain.label} bağlamında ${concepts.slice(0, 4).map((item) => item.label).join(", ")} unsurları arasında öğrenilmiş bir etkileşim grafiği kuruldu. En güçlü aktarım ${nodes[strongest.from].label} ile ${nodes[strongest.to].label} arasında; ikincil baskı ${nodes[second.from].label} üzerinden yayılıyor.`;
  const pack = {
    schema_version: "2.0",
    id: scenarioId,
    blackswan_class: "local_neurocausal_world_model",
    sector: neural.sector,
    min_caelus_engine: "2.0",
    labels: {
      node: nodes[0].label,
      edge: nodes[strongest.from].label,
      actor: nodes[4].label,
      regulatory_gate: nodes[3].label,
      friction: `${concepts[0].label} baskısı`,
    },
    meta: {
      title: `${domain.label} · ${concepts[0].label} senaryosu`,
      region: "ON_DEVICE",
      tick_minutes: tickMinutes,
      horizon_hours: Math.max(72, Math.ceil(duration * 2)),
      synopsis: sourceText,
      generated_by: "CAELUS_LOCAL_NEUROCAUSAL_MODEL",
      neural_model: NEURO_WEIGHTS.version,
      neural_architecture: NEURO_WEIGHTS.architecture,
      compiler_fingerprint: fingerprint,
      neural_confidence: Number(neural.confidence.toFixed(4)),
      severity: Number(neural.severity.toFixed(4)),
      cloud_used: false,
    },
    extended_causal_model: {
      nodes,
      edges,
      feedback_loops: [{
        id: `NCM-FL-${fingerprint}`,
        path: [nodes[strongest.from].id, nodes[strongest.to].id, nodes[second.to].id],
        gain_fp: Math.round((1.02 + neural.severity * 0.30) * 1000000),
        notes: "Yerel neural graph head tarafından bulunan baskın geri besleme döngüsü.",
      }],
      levers,
      hysteresis: [
        { id: `NCM-HYST-${fingerprint}-1`, threshold_tick: Math.max(12, Math.round(deadlineTick * 0.45)), reversible: true, permanent_loss_fp: 0 },
        { id: `NCM-HYST-${fingerprint}-2`, threshold_tick: deadlineTick, reversible: false, permanent_loss_fp: Math.round((0.08 + neural.severity * 0.22) * 1000000) },
      ],
      hard_deadlines: [{ node_id: nodes[5].id, at_tick: deadlineTick, label: `NCM-DEADLINE-${fingerprint}`, notes: `${duration} saatlik kullanıcı penceresinden türetildi.` }],
    },
  };

  return {
    pack,
    analysis: {
      sourceText,
      fingerprint,
      scenarioId,
      sector: neural.sector,
      sectorLabel: domain.label,
      confidence: neural.confidence,
      severity: neural.severity,
      synopsis,
      concepts: concepts.slice(0, 6).map((item) => item.label),
      strongestRelations: rankedEdges.slice(0, 3).map((edge) => ({
        from: nodes[edge.from].label,
        to: nodes[edge.to].label,
        confidence: edge.strength,
      })),
      leverNarratives: levers.map((lever) => `${lever.label}: ${lever.target}`),
      model: NEURO_WEIGHTS.version,
      architecture: NEURO_WEIGHTS.architecture,
      cloudUsed: false,
    },
  };
}

function domainLabels() {
  return Object.fromEntries(Object.entries(DOMAIN).map(([key, value]) => [key, value.label]));
}

function roleLabel(concept, primaryDomain) {
  const domain = DOMAIN[concept.domain] || primaryDomain || DOMAIN.UNIVERSAL;
  return domain.roles[concept.role] || primaryDomain.roles[concept.role] || DOMAIN.UNIVERSAL.roles[concept.role];
}

function initialPressure(concept, index, situation, neural) {
  const baseByType = {
    ACTOR: 0.38,
    SERVICE: 0.24,
    DEMAND: 0.28,
    CAPACITY: 0.22,
    GATE: 0.26,
    DEADLINE: 0.20,
  };
  const typeBias = baseByType[concept.semanticType] ?? 0.22;
  const neuralState = neural.nodeStates[index % neural.nodeStates.length] || 0.5;
  let pressure = typeBias + situation.severity * (concept.semanticType === "ACTOR" ? 0.48 : 0.36) + neuralState * 0.16;
  if (concept.semanticType === "CAPACITY" && situation.activeMitigation) pressure -= 0.22;
  if (concept.semanticType === "CAPACITY" && situation.failedMitigation) pressure += 0.20;
  if (situation.negatedEvents.length && concept.semanticType === "ACTOR") pressure -= 0.24;
  return clamp(pressure, 0.08, 0.94);
}

function relationNarrative(edge, nodeByKey) {
  const from = nodeByKey.get(edge.from);
  const to = nodeByKey.get(edge.to);
  return {
    from: from?.label || edge.from,
    to: to?.label || edge.to,
    confidence: edge.confidenceFp / 1_000_000,
    relation: edge.relation,
    mechanism: edge.mechanism,
    lagTicks: edge.lagTicks,
    polarity: edge.polarity,
    evidence: edge.evidence,
  };
}

export function compileNeuralScenario(input) {
  const sourceText = String(input || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (sourceText.length < 8) throw new Error("NCM-2 için aktör, olay veya süre içeren daha açıklayıcı bir durum yazın.");

  const neural = runNeuralInference(sourceText);
  const situation = parseSituation(sourceText, {
    fold,
    hash32,
    semanticLexicon: NEURO_WEIGHTS.semanticLexicon,
    neuralProbabilities: neural.probabilities,
    neuralSeverity: neural.severity,
  });
  const primaryDomain = DOMAIN[situation.primarySector] || DOMAIN.UNIVERSAL;
  const concepts = situation.concepts;
  const fingerprint = hex(hash32(`${NCM2_VERSION}:${fold(sourceText)}`));
  const scenarioId = `NCM2-${situation.primarySector}-${fingerprint}`;
  const tickMinutes = situation.durationHours <= 24 ? 15 : 30;
  const deadlineTick = Math.max(4, Math.round((situation.durationHours * 60) / tickMinutes));

  const nodes = concepts.map((concept, index) => {
    const state = initialPressure(concept, index, situation, neural);
    const nodeId = `${slug(concept.key, `UNSUR${index + 1}`)}_${index + 1}`;
    concept.nodeId = nodeId;
    const hiddenRisk = concept.semanticType === "ACTOR" && situation.severity > 0.62 && !situation.negatedEvents.length;
    return {
      id: nodeId,
      label: `${concept.label} · ${roleLabel(concept, primaryDomain)}`,
      kind: concept.kind,
      capacity_fp: 1_000_000,
      state_fp: Math.round(state * 1_000_000),
      weight_fp: [260_000, 240_000, 220_000, 210_000, 180_000, 230_000][concept.role] || 210_000,
      reported_state_fp: Math.round(clamp(state - (hiddenRisk ? 0.20 : 0), 0.05, 0.98) * 1_000_000),
      trust_fp: hiddenRisk ? 700_000 : Math.round((0.86 + situation.coverage * 0.13) * 1_000_000),
      deadline_tick: concept.semanticType === "DEADLINE" ? deadlineTick : -1,
      irrecoverable: false,
      notes: concept.explicit
        ? `${concept.label} doğrudan kullanıcı girdisinden çıkarıldı.`
        : `${concept.label} ${concept.evidence[0]?.ruleId || "NCM2-ONTOLOGY"} kuralıyla görünür varsayım olarak eklendi.`,
    };
  });
  const nodeByKey = new Map(concepts.map((concept, index) => [concept.key, nodes[index]]));

  const semanticEdges = buildSemanticGraph(situation, neural, hash32);
  const gateAudit = buildNeuralGate(situation, semanticEdges);
  const positiveEdges = semanticEdges.filter((edge) => edge.polarity > 0).slice(0, 9);
  const edges = positiveEdges.map((edge) => ({
    from: nodeByKey.get(edge.from).id,
    to: nodeByKey.get(edge.to).id,
    multiplier_fp: Math.round((0.42 + edge.strengthFp / 1_000_000) * 1_000_000),
    lag_ticks: edge.lagTicks,
    active: true,
    notes: `${edge.relation}: ${edge.mechanism} | kanıt ${edge.evidence[0]?.source || "ontology"}`,
  }));
  nodes.forEach((node, index) => edges.push({
    from: node.id,
    to: "",
    multiplier_fp: Math.round((0.12 + nodes[index].state_fp / 1_000_000 * 0.25) * 1_000_000),
    lag_ticks: 0,
    active: true,
  }));

  const forecasts = runTemporalObserver({
    concepts,
    edges: semanticEdges,
    initialStatesFp: nodes.map((node) => node.state_fp),
    severity: situation.severity,
    durationHours: situation.durationHours,
    activeMitigation: situation.activeMitigation,
    failedMitigation: situation.failedMitigation,
  });
  const deep = buildDeepExplanation({
    situation,
    concepts,
    edges: semanticEdges,
    forecasts,
    gateAudit,
    domainLabels: domainLabels(),
  });
  const contextualActions = buildContextualActions({ situation, concepts, forecasts });
  const levers = contextualActions.map((action, index) => {
    const targetIndex = Math.max(0, concepts.findIndex((concept) => concept.key === action.targetKey));
    const targetNode = nodes[targetIndex];
    return {
      id: `N2-${index + 1}_${slug(action.label, `HAMLE${index + 1}`).slice(0, 22)}`,
      label: action.label,
      target: targetNode.label,
      success_p_fp: Math.round(action.probability * 1_000_000),
      cost_ticks: 2 + Math.round((forecasts[0].nodePressureFp[action.targetKey] / 1_000_000) * 8),
      lockout_ticks: 6 + Math.round(situation.severity * 18),
      on_success: {
        target_node_id: targetNode.id,
        state_delta_fp: -Math.round((0.16 + action.probability * 0.18) * 1_000_000),
        trust_delta_fp: concepts[targetIndex].semanticType === "GATE" ? 160_000 : 0,
        friction_delta_fp: -Math.round((0.06 + action.probability * 0.09) * 1_000_000),
        clear_irrecoverable: concepts[targetIndex].semanticType === "DEADLINE",
      },
      on_failure: {
        target_node_id: targetNode.id,
        state_delta_fp: Math.round((0.025 + situation.severity * 0.045) * 1_000_000),
        trust_delta_fp: concepts[targetIndex].semanticType === "GATE" ? -50_000 : 0,
        friction_delta_fp: 30_000,
        clear_irrecoverable: false,
      },
      notes: `${action.rationale} Observer önerisidir; kabul kararı Rust/WASM çekirdeğindedir.`,
    };
  });

  const strongest = positiveEdges[0];
  const secondary = positiveEdges[1] || strongest;
  const pack = {
    schema_version: "2.0",
    id: scenarioId,
    blackswan_class: "local_temporal_neurocausal_observer",
    sector: situation.primarySector,
    min_caelus_engine: "2.0",
    labels: {
      node: nodes[0].label,
      edge: nodeByKey.get(strongest?.from)?.label || nodes[0].label,
      actor: nodes.find((node, index) => concepts[index].semanticType === "ACTOR")?.label || nodes[0].label,
      regulatory_gate: nodes.find((node, index) => concepts[index].semanticType === "GATE")?.label || nodes[2].label,
      friction: `${concepts[0].label} kaynaklı sistem baskısı`,
    },
    meta: {
      title: `${deep.domainLabel} · ${concepts[0].label} senaryosu`,
      region: "ON_DEVICE",
      tick_minutes: tickMinutes,
      horizon_hours: Math.min(2_160, Math.max(72, Math.ceil(situation.durationHours * 2))),
      synopsis: sourceText,
      generated_by: "CAELUS_LOCAL_NCM2_TEMPORAL_OBSERVER",
      neural_model: NCM2_VERSION,
      semantic_encoder: NEURO_WEIGHTS.version,
      neural_architecture: NCM2_ARCHITECTURE,
      temporal_model: TEMPORAL_MODEL_INFO.version,
      compiler_fingerprint: fingerprint,
      neural_confidence: Number(situation.confidence.toFixed(4)),
      severity: Number(situation.severity.toFixed(4)),
      observer_gate: gateAudit.mode,
      observer_authority: "ADVISORY_ONLY",
      engine_authority: "RUST_WASM",
      cloud_used: false,
    },
    extended_causal_model: {
      nodes,
      edges,
      feedback_loops: [{
        id: `NCM2-FL-${fingerprint}`,
        path: [nodeByKey.get(strongest.from).id, nodeByKey.get(strongest.to).id, nodeByKey.get(secondary.to).id],
        gain_fp: Math.round((1.01 + situation.severity * 0.26) * 1_000_000),
        notes: "Neural Gate tarafından doğrulanan baskın temporal yayılım yolu.",
      }],
      levers,
      hysteresis: [
        { id: `NCM2-HYST-${fingerprint}-1`, threshold_tick: Math.max(8, Math.round(deadlineTick * 0.42)), reversible: true, permanent_loss_fp: 0 },
        { id: `NCM2-HYST-${fingerprint}-2`, threshold_tick: deadlineTick, reversible: false, permanent_loss_fp: Math.round((0.06 + situation.severity * 0.24) * 1_000_000) },
      ],
      hard_deadlines: [{
        node_id: nodes.find((node, index) => concepts[index].semanticType === "DEADLINE")?.id || nodes[nodes.length - 1].id,
        at_tick: deadlineTick,
        label: `NCM2-DEADLINE-${fingerprint}`,
        notes: `${Number(situation.durationHours.toFixed(2))} saatlik girdiden türetilen karar penceresi.`,
      }],
    },
  };

  const strongestRelations = positiveEdges.slice(0, 5).map((edge) => relationNarrative(edge, nodeByKey));
  const observerProposal = {
    schema: "ncm-observer/2",
    modelVersion: NCM2_VERSION,
    sourceHash: situation.sourceHash,
    situation,
    concepts,
    edges: semanticEdges,
    forecasts,
    gateAudit,
    initialStatesFp: nodes.map((node) => node.state_fp),
  };

  return {
    pack,
    analysis: {
      sourceText,
      fingerprint,
      scenarioId,
      sector: situation.primarySector,
      sectorLabel: deep.domainLabel,
      activeDomains: situation.activeDomains.map((row) => row.sector),
      confidence: situation.confidence,
      severity: situation.severity,
      synopsis: deep.executiveSummary,
      executiveSummary: deep.executiveSummary,
      concepts: concepts.map((item) => item.label),
      strongestRelations,
      leverNarratives: levers.map((lever) => `${lever.label}: ${lever.target}`),
      horizons: deep.horizons,
      counterfactuals: deep.counterfactuals,
      assumptions: deep.assumptions,
      unknowns: deep.unknowns,
      criticalSignals: deep.criticalSignals,
      gateAudit,
      evidence: deep.evidence,
      observerProposal,
      observerTick: 0,
      model: NCM2_VERSION,
      semanticEncoder: NEURO_WEIGHTS.version,
      architecture: NCM2_ARCHITECTURE,
      authority: "ADVISORY_OBSERVER_WITH_RUST_WASM_AUTHORITY",
      cloudUsed: false,
    },
  };
}

export function observeTemporalSnapshot(scenario, snapshot) {
  const proposal = scenario?.analysis?.observerProposal;
  if (!proposal || !snapshot) return scenario;
  const currentStates = snapshotStates(snapshot, proposal.concepts, proposal.initialStatesFp);
  const forecasts = runTemporalObserver({
    concepts: proposal.concepts,
    edges: proposal.edges,
    initialStatesFp: currentStates,
    severity: proposal.situation.severity,
    durationHours: proposal.situation.durationHours,
    activeMitigation: proposal.situation.activeMitigation,
    failedMitigation: proposal.situation.failedMitigation,
  });
  const deep = buildDeepExplanation({
    situation: proposal.situation,
    concepts: proposal.concepts,
    edges: proposal.edges,
    forecasts,
    gateAudit: proposal.gateAudit,
    domainLabels: domainLabels(),
  });
  return {
    ...scenario,
    analysis: {
      ...scenario.analysis,
      synopsis: deep.executiveSummary,
      executiveSummary: deep.executiveSummary,
      horizons: deep.horizons,
      counterfactuals: deep.counterfactuals,
      observerTick: Number(snapshot.tick || 0),
    },
  };
}

export const NEURO_MODEL_INFO = Object.freeze({
  version: NCM2_VERSION,
  semanticEncoderVersion: NEURO_WEIGHTS.version,
  temporalModelVersion: TEMPORAL_MODEL_INFO.version,
  architecture: NCM2_ARCHITECTURE,
  inputDimensions: NEURO_WEIGHTS.input,
  hiddenUnits: NEURO_WEIGHTS.hidden,
  temporalHiddenUnits: 6,
  sectors: [...NEURO_WEIGHTS.sectors],
  observerAuthority: "advisory",
  engineAuthority: "rust_wasm",
  cloudUsed: false,
});
