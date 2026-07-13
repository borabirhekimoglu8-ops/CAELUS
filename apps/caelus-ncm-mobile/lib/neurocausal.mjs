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
import { NCM3_VERSION, reasonWithEvidence } from "./ncm3/evidence-reasoner.mjs";
import { augmentGroundingWithVault } from "./ncm3/evidence-augmentation.mjs";

const INPUT = NEURO_WEIGHTS.input;
const SECTORS = NEURO_WEIGHTS.sectors;
const NCM3_ARCHITECTURE = `${NEURO_WEIGHTS.architecture}+OPEN_EVIDENCE_MESH+EVIDENCE_LEDGER+DIMENSIONAL_SOLVERS+FAIL_CLOSED_TRUTH_GATE+RUST_WASM_SCENARIOPACK_STATE_VALIDATOR`;
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

export function compileNcm2ScenarioInternal(input) {
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

function observeNcm2Snapshot(scenario, snapshot) {
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

function truthEvidenceSpan(item) {
  if (item?.source === "public_source" || item?.source === "user_file") {
    return {
      ...item,
      source: item.source,
      text: String(item.text || item.title || "Kaynak kanıtı"),
    };
  }
  const source = item?.source === "input"
    ? "input"
    : item?.source === "rule" ? "knowledge" : item?.source === "safety" ? "safety" : "engine";
  return {
    source,
    text: String(item?.text || item?.ruleId || "NCM-3 yerel kanıtı"),
    ...(item?.ruleId ? { ruleId: item.ruleId } : {}),
  };
}

function sectorFromGrounding(grounding) {
  const pack = grounding.knowledgePack.id;
  if (/MARITIME|COUNTERFACTUAL-SUFFICIENT-CAUSE/.test(pack)) return "MARITIME";
  if (/CYBER/.test(pack)) return "CYBER";
  if (/POWER-ENERGY/.test(pack)) return "ENERGY";
  if (/OXYGEN|CLINICAL/.test(pack)) return "HEALTH";
  if (/CASHFLOW|INVOICE/.test(pack)) return "FINANCE";
  if (/INVENTORY/.test(pack)) return "SUPPLY";
  if (/QUEUE/.test(pack)) return "BUSINESS";
  return "UNIVERSAL";
}

function buildTruthGate(grounding) {
  const validReference = (item) => {
    if (!item || typeof item !== "object") return false;
    if (item.source === "rule") return Boolean(item.ruleId && item.text);
    if (item.source === "input") return Boolean(item.text) && Number.isInteger(item.start) && Number.isInteger(item.end) && item.end > item.start;
    if (item.source === "safety" || item.source === "engine") return Boolean(item.text || item.ruleId);
    if (item.source === "public_source" || item.source === "user_file") {
      return item.verified === true && Boolean(item.documentId && item.sourceId && item.fingerprint && item.locator && item.text);
    }
    return false;
  };
  const provenanceCount = grounding.claims.filter((claim) =>
    Array.isArray(claim.evidence) && claim.evidence.length > 0 && claim.evidence.every(validReference)).length;
  const provenanceValid = provenanceCount === grounding.claims.length;
  const unsupportedCount = grounding.claims.filter((claim) => !["FACT", "DEDUCTION", "CALCULATION", "UNKNOWN", "SAFETY"].includes(claim.type)).length;
  const calculationsValid = grounding.calculations.every((item) => item.expression && item.unit && item.result !== undefined && item.result !== null);
  const supported = grounding.coverage.supportedClaimCount;
  const accepted = grounding.mode !== "insufficient" && provenanceValid && calculationsValid && supported >= 2;
  const graphDepth = grounding.relations.length ? Math.min(6, grounding.relations.length + 1) : 0;
  return {
    accepted,
    mode: accepted ? (grounding.mode === "grounded" ? "evidence_bound" : "conditional") : "symbolic_fallback",
    fingerprint: hash32(`${NCM3_VERSION}:${grounding.knowledgePack.id}:${grounding.directAnswer}`).toString(16).toUpperCase().padStart(8, "0"),
    modelVersion: NCM3_VERSION,
    graphDepth,
    gates: [
      {
        id: "provenance", label: "İddia kaynağı", status: provenanceValid ? "pass" : "fail",
        value: `${provenanceCount}/${grounding.claims.length} izlenebilir`, threshold: "tümü",
      },
      {
        id: "knowledge", label: "Yerel bilgi paketi", status: grounding.mode === "insufficient" ? "fail" : grounding.mode === "conditional" ? "warn" : "pass",
        value: grounding.knowledgePack.id, threshold: "eşleşen kapalı çözücü",
      },
      {
        id: "dimensions", label: "Birim ve aritmetik", status: calculationsValid ? "pass" : "fail",
        value: grounding.calculations.length ? `${grounding.calculations.length} doğrulanmış hesap` : "hesap gerekmiyor", threshold: "boyutsal tutarlılık",
      },
      {
        id: "unsupported", label: "Sözleşme dışı iddia", status: unsupportedCount ? "fail" : "pass",
        value: `${unsupportedCount}`, threshold: "0",
      },
      {
        id: "unknowns", label: "Belirsizlik açıklaması", status: grounding.unknowns.length || grounding.mode === "grounded" ? "pass" : "warn",
        value: `${grounding.unknowns.length} bilinmeyen`, threshold: "görünür",
      },
    ],
  };
}

function normalizeTruthRelations(grounding) {
  return grounding.relations.map((item) => ({
    from: item.from,
    to: item.to,
    confidence: Number.isFinite(item.confidence) ? item.confidence : 0,
    relation: item.relation,
    mechanism: item.mechanism,
    lagTicks: 0,
    polarity: /PRESERVES|CAN_DECREASE|DECREASES|DRAINS/.test(item.relation) ? -1 : 1,
    evidence: (item.evidence || []).map(truthEvidenceSpan),
  }));
}

function normalizeTruthHorizons(grounding) {
  const keys = ["immediate", "near", "extended"];
  return grounding.horizons.slice(0, 3).map((item, index) => ({
    key: keys[index],
    label: item.label || `Ufuk ${index + 1}`,
    range: item.label || `Ufuk ${index + 1}`,
    summary: item.statement,
    risks: [],
    confidence: grounding.coverage.score,
    expected: { risk: 0, throughput: 0 },
    criticalPath: [],
    calibrated: false,
  }));
}

function normalizeTruthCounterfactuals(grounding) {
  const ids = ["baseline", "contained", "cascade"];
  const labels = ["Koşul 1", "Koşul 2", "Koşul 3"];
  return grounding.counterfactuals.slice(0, 3).map((item, index) => ({
    id: ids[index],
    label: labels[index],
    premise: item.condition,
    outcome: item.outcome,
    risk: 0,
    throughput: 0,
    deltaRisk: 0,
    deltaThroughput: 0,
    confidence: grounding.coverage.score,
    calibrated: false,
  }));
}

function groundedLabels(grounding) {
  const labels = [];
  const seen = new Set();
  const add = (value) => {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    const key = fold(label);
    if (!label || seen.has(key)) return;
    seen.add(key);
    labels.push(label.slice(0, 64));
  };
  grounding.relations.forEach((item) => { add(item.from); add(item.to); });
  grounding.observations.forEach((item) => add(item.statement));
  grounding.requiredInputs.forEach(add);
  const visible = [...labels];
  while (labels.length < 6) add(`Kanıt düğümü ${labels.length + 1}`);
  return { nodeLabels: labels.slice(0, 6), visibleLabels: visible.slice(0, 6) };
}

export function compileNeuralScenario(input, options = {}) {
  const sourceText = String(input || "").replace(/\s+/g, " ").trim().slice(0, 1_200);
  if (sourceText.length < 8) throw new Error("NCM-3 için olay, miktar, süre veya karar sorusu içeren daha açıklayıcı bir durum yazın.");

  // The local encoder is an advisory route proposal only. Its output is kept
  // outside the answer, claim ledger, graph state, and Truth Gate decision.
  const neuralAdvisory = runNeuralInference(sourceText);
  const baseGrounding = reasonWithEvidence(sourceText, { sourceTime: null });
  const grounding = augmentGroundingWithVault(baseGrounding, sourceText, options.evidenceRecords || []);
  const gateAudit = buildTruthGate(grounding);
  const sector = sectorFromGrounding(grounding);
  const primaryDomain = DOMAIN[sector] || DOMAIN.UNIVERSAL;
  const fingerprint = hex(hash32(`${NCM3_VERSION}:${fold(sourceText)}`));
  const scenarioId = `NCM3-${sector}-${fingerprint}`;
  const explicitDuration = /\d+(?:[.,]\d+)?\s*(?:dakika|saat|gun|hafta|ay|minute|hour|day|week|month)\b/.test(fold(sourceText));
  const duration = durationHours(sourceText);
  const tickMinutes = duration <= 24 ? 15 : 30;
  const { nodeLabels, visibleLabels } = groundedLabels(grounding);

  const nodes = nodeLabels.map((label, index) => {
    return {
      id: `${slug(label, `KANIT${index + 1}`)}_${index + 1}`,
      label,
      kind: NODE_KINDS[index],
      capacity_fp: 1_000_000,
      // The evidence ledger does not provide a calibrated dynamic state. Keep
      // the WASM state neutral instead of turning advisory MLP activations into
      // apparent real-world pressure, throughput, or risk.
      state_fp: 0,
      weight_fp: 0,
      reported_state_fp: 0,
      trust_fp: 1_000_000,
      // A duration is not necessarily a deadline. NCM-3 must not attach it to an
      // arbitrary (and potentially schema-filler) node without a grounded target.
      deadline_tick: -1,
      irrecoverable: false,
      notes: label.startsWith("Kanıt düğümü") ? "WASM şema dolgusu; kullanıcıya iddia olarak gösterilmez." : "NCM-3 kanıt defterinden alınmıştır.",
    };
  });
  const nodeByLabel = new Map(nodes.map((node) => [fold(node.label), node]));
  const relationEdges = grounding.relations.slice(0, 9).flatMap((item) => {
    const from = nodeByLabel.get(fold(item.from));
    const to = nodeByLabel.get(fold(item.to));
    if (!from || !to || from.id === to.id) return [];
    return [{
      from: from.id,
      to: to.id,
      // This edge records provenance/topology only. NCM-3 has no calibrated
      // transmission coefficient, so it must not drive synthetic dynamics.
      multiplier_fp: 0,
      lag_ticks: 0,
      active: true,
      notes: `${item.relation}: ${item.mechanism} · NCM-3 kanıtlı/koşullu ilişki`,
    }];
  });
  const edges = [...relationEdges];
  nodes.forEach((node) => edges.push({
    from: node.id,
    to: "",
    multiplier_fp: 0,
    lag_ticks: 0,
    active: true,
    notes: "Yerel deterministik düğüm durumu.",
  }));

  const pack = {
    schema_version: "2.0",
    id: scenarioId,
    blackswan_class: "evidence_bound_local_reasoner",
    sector,
    min_caelus_engine: "2.0",
    labels: {
      node: nodes[0].label,
      edge: grounding.relations[0]?.from || nodes[0].label,
      actor: grounding.relations[0]?.from || nodes[0].label,
      regulatory_gate: grounding.requiredInputs[0] || nodes[3].label,
      friction: `${grounding.title} model baskısı`,
    },
    meta: {
      title: grounding.title,
      region: "ON_DEVICE",
      tick_minutes: tickMinutes,
      horizon_hours: explicitDuration ? Math.min(2_160, Math.max(1, Math.ceil(duration))) : 0,
      synopsis: sourceText,
      generated_by: "CAELUS_LOCAL_NCM3_EVIDENCE_REASONER",
      neural_model: NEURO_WEIGHTS.version,
      reasoner_model: NCM3_VERSION,
      semantic_encoder: NEURO_WEIGHTS.version,
      neural_architecture: NEURO_WEIGHTS.architecture,
      reasoner_architecture: NCM3_ARCHITECTURE,
      compiler_fingerprint: fingerprint,
      truth_mode: grounding.mode,
      knowledge_pack: grounding.knowledgePack.id,
      evidence_coverage: grounding.coverage.score,
      calibrated_probability_available: false,
      observer_gate: gateAudit.mode,
      observer_authority: "ADVISORY_ONLY",
      engine_authority: "RUST_WASM",
      answer_authority: "NCM3_EVIDENCE_REASONER",
      wasm_role: "SCENARIOPACK_STATE_VALIDATOR",
      cloud_used: false,
    },
    extended_causal_model: {
      nodes,
      edges,
      feedback_loops: [],
      levers: [],
      hysteresis: [],
      hard_deadlines: [],
    },
  };

  const strongestRelations = normalizeTruthRelations(grounding);
  const assumptions = grounding.assumptions.map((item) => ({
    id: item.id,
    text: item.statement,
    source: Array.isArray(item.basis) && item.basis.some((entry) => entry?.source === "input") ? "input" : "inferred",
    confidence: 0,
    material: true,
  }));
  const evidence = grounding.claims.flatMap((claim) => claim.evidence.map(truthEvidenceSpan));

  return {
    pack,
    analysis: {
      sourceText,
      fingerprint,
      scenarioId,
      sector,
      sectorLabel: sector === "UNIVERSAL" && grounding.mode === "insufficient" ? "Kanıt paketi bulunamadı" : primaryDomain.label,
      activeDomains: sector === "UNIVERSAL" ? [] : [sector],
      confidence: 0,
      severity: 0,
      synopsis: grounding.directAnswer,
      executiveSummary: grounding.directAnswer,
      concepts: visibleLabels.length ? visibleLabels : [grounding.title],
      strongestRelations,
      leverNarratives: [],
      horizons: normalizeTruthHorizons(grounding),
      counterfactuals: normalizeTruthCounterfactuals(grounding),
      assumptions,
      unknowns: grounding.unknowns.map((item) => item.statement),
      criticalSignals: grounding.requiredInputs,
      gateAudit,
      evidence,
      grounding,
      observerProposal: {
        schema: "ncm-observer/3",
        modelVersion: NCM3_VERSION,
        sourceHash: fingerprint,
        authority: "ADVISORY_ONLY",
        usedForAnswer: false,
        semanticRoute: {
          model: neuralAdvisory.model,
          sector: neuralAdvisory.sector,
        },
        grounding,
      },
      observerTick: 0,
      model: NCM3_VERSION,
      semanticEncoder: NEURO_WEIGHTS.version,
      architecture: NCM3_ARCHITECTURE,
      authority: "NCM3_EVIDENCE_REASONER_WITH_RUST_WASM_STATE_VALIDATOR",
      cloudUsed: false,
    },
  };
}

export function observeTemporalSnapshot(scenario, snapshot) {
  if (scenario?.analysis?.grounding?.version === NCM3_VERSION) {
    return {
      ...scenario,
      analysis: { ...scenario.analysis, observerTick: Number(snapshot?.tick || 0) },
    };
  }
  return observeNcm2Snapshot(scenario, snapshot);
}

export const NEURO_MODEL_INFO = Object.freeze({
  version: NCM3_VERSION,
  semanticEncoderVersion: NEURO_WEIGHTS.version,
  temporalModelVersion: TEMPORAL_MODEL_INFO.version,
  architecture: NCM3_ARCHITECTURE,
  inputDimensions: NEURO_WEIGHTS.input,
  hiddenUnits: NEURO_WEIGHTS.hidden,
  temporalHiddenUnits: 6,
  sectors: [...NEURO_WEIGHTS.sectors],
  observerAuthority: "advisory",
  engineAuthority: "rust_wasm",
  cloudUsed: false,
});
