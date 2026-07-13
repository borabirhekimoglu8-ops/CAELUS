import { RELATION_RULES } from "./ontology.mjs";

const FP = 1_000_000;
const TEMPORAL_WEIGHTS = Object.freeze({
  version: "TGN-Q15-1.0.0",
  architecture: "FIXED_POINT_GATED_TEMPORAL_MESSAGE_PASSING",
  gateBias: 110_000,
  gateSelf: 230_000,
  gateMessage: 270_000,
  gateUrgency: 90_000,
  candidateBias: 20_000,
  candidateSelf: 500_000,
  candidateMessage: 350_000,
  candidateSeverity: 180_000,
  candidateUrgency: 80_000,
  candidateProtection: 430_000,
});

function clampFp(value, min = 0, max = FP) { return Math.max(min, Math.min(max, Math.round(value))); }
function mulFp(a, b) { return Math.round((a * b) / FP); }

function ruleFor(from, to) {
  return RELATION_RULES.find((rule) => rule.from === from.semanticType && rule.to === to.semanticType) || null;
}

function edgeEvidence(from, to, rule) {
  const crossDomain = from.domain !== to.domain;
  const source = from.explicit && to.explicit ? "input" : "ontology";
  return [{
    source,
    text: `${from.label} → ${to.label}: ${rule.mechanism}`,
    ruleId: crossDomain ? `NCM2-CROSS-${from.domain}-${to.domain}` : `NCM2-${from.domain}-${rule.relation}`,
  }];
}

export function buildSemanticGraph(situation, neural, hash32) {
  const concepts = situation.concepts;
  const suppressActor = situation.negatedEvents.includes("ATTACK") && !situation.frames.some((frame) => frame.event === "ATTACK" && !frame.negated);
  const candidates = [];
  for (const from of concepts) {
    for (const to of concepts) {
      if (from.key === to.key || (suppressActor && from.semanticType === "ACTOR")) continue;
      const rule = ruleFor(from, to);
      if (!rule) continue;
      const neuralStrength = neural.edgeStrengths[hash32(`${from.key}>${to.key}`) % neural.edgeStrengths.length] || 0.5;
      const crossDomain = from.domain !== to.domain;
      const explicitBonus = from.explicit && to.explicit ? 0.05 : 0;
      const crossBonus = crossDomain && situation.activeDomains.length > 1 ? 0.06 : 0;
      const confidence = Math.max(0.42, Math.min(0.94, rule.base * 0.70 + neuralStrength * 0.24 + explicitBonus + crossBonus));
      candidates.push({
        id: `E-${hash32(`${from.key}:${to.key}:${rule.relation}`).toString(16).toUpperCase().padStart(8, "0")}`,
        from: from.key,
        to: to.key,
        relation: rule.relation,
        polarity: rule.polarity,
        strengthFp: Math.round(confidence * FP),
        confidenceFp: Math.round(Math.min(confidence, situation.confidence) * FP),
        lagTicks: 1 + (hash32(`${from.key}:${to.key}:lag`) % 5),
        mechanism: rule.mechanism,
        evidence: edgeEvidence(from, to, rule),
        fallback: false,
      });
    }
  }
  candidates.sort((a, b) => b.strengthFp - a.strengthFp || a.id.localeCompare(b.id));
  const edges = [];
  const targetIncoming = new Map();
  for (const edge of candidates) {
    if (edges.length >= 12) break;
    const key = `${edge.from}->${edge.to}`;
    if (edges.some((current) => `${current.from}->${current.to}` === key)) continue;
    const incoming = targetIncoming.get(edge.to) || 0;
    if (incoming >= 3) continue;
    edges.push(edge);
    targetIncoming.set(edge.to, incoming + 1);
  }
  return edges;
}

function longestPositivePath(edges) {
  const positive = edges.filter((edge) => edge.polarity > 0);
  const outgoing = new Map();
  positive.forEach((edge) => outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]));
  let best = 0;
  function visit(node, seen) {
    let depth = 1;
    for (const next of outgoing.get(node) || []) {
      if (seen.has(next)) continue;
      const branch = new Set(seen);
      branch.add(next);
      depth = Math.max(depth, 1 + visit(next, branch));
    }
    return depth;
  }
  for (const node of outgoing.keys()) best = Math.max(best, visit(node, new Set([node])));
  return best;
}

export function buildNeuralGate(situation, edges) {
  const depth = longestPositivePath(edges);
  const dangling = edges.filter((edge) => !situation.concepts.some((concept) => concept.key === edge.from) || !situation.concepts.some((concept) => concept.key === edge.to)).length;
  const contradiction = situation.frames.some((frame) => frame.negated && situation.frames.some((other) => other.event === frame.event && !other.negated && other.clauseId === frame.clauseId));
  const gates = [
    { id: "coverage", label: "Girdi kapsamı", status: situation.coverage >= 0.34 ? "pass" : situation.coverage >= 0.22 ? "warn" : "fail", value: `%${Math.round(situation.coverage * 100)}`, threshold: ">=%34" },
    { id: "entities", label: "Açık varlık", status: situation.explicitCount >= 4 ? "pass" : situation.explicitCount >= 3 ? "warn" : "fail", value: `${situation.explicitCount}/6`, threshold: ">=3" },
    { id: "path", label: "Nedensel yol", status: depth >= 4 ? "pass" : depth >= 3 ? "warn" : "fail", value: `${depth} düğüm`, threshold: ">=3" },
    { id: "integrity", label: "Graf bütünlüğü", status: dangling === 0 ? "pass" : "fail", value: dangling === 0 ? "dangling yok" : `${dangling} kopuk kenar`, threshold: "0" },
    { id: "negation", label: "Negasyon tutarlılığı", status: contradiction ? "fail" : "pass", value: contradiction ? "çelişki" : `${situation.negatedEvents.length} bastırılmış olay`, threshold: "çelişki yok" },
  ];
  const accepted = !gates.some((gate) => gate.status === "fail");
  return {
    accepted,
    mode: accepted ? "neural_observer" : "symbolic_fallback",
    fingerprint: situation.sourceHash,
    modelVersion: "NCM-2.0.0",
    graphDepth: depth,
    gates,
  };
}

function graphStep(states, concepts, edges, severityFp, urgencyFp) {
  const next = {};
  for (const concept of concepts) {
    let positive = 0;
    let protection = 0;
    let degree = 0;
    for (const edge of edges) {
      if (edge.to !== concept.key) continue;
      const message = mulFp(states[edge.from] || 0, edge.strengthFp);
      if (edge.polarity < 0) protection += message;
      else positive += message;
      degree += 1;
    }
    const messageFp = degree ? clampFp(positive / degree) : 0;
    const protectionFp = degree ? clampFp(protection / degree) : 0;
    const current = states[concept.key] || 0;
    const gate = clampFp(
      TEMPORAL_WEIGHTS.gateBias
      + mulFp(current, TEMPORAL_WEIGHTS.gateSelf)
      + mulFp(messageFp, TEMPORAL_WEIGHTS.gateMessage)
      + mulFp(urgencyFp, TEMPORAL_WEIGHTS.gateUrgency),
    );
    const candidate = clampFp(
      TEMPORAL_WEIGHTS.candidateBias
      + mulFp(current, TEMPORAL_WEIGHTS.candidateSelf)
      + mulFp(messageFp, TEMPORAL_WEIGHTS.candidateMessage)
      + mulFp(severityFp, TEMPORAL_WEIGHTS.candidateSeverity)
      + mulFp(urgencyFp, TEMPORAL_WEIGHTS.candidateUrgency)
      - mulFp(protectionFp, TEMPORAL_WEIGHTS.candidateProtection),
    );
    next[concept.key] = clampFp(mulFp(FP - gate, current) + mulFp(gate, candidate));
  }
  return next;
}

function systemRisk(states, concepts) {
  let weighted = 0;
  let total = 0;
  for (const concept of concepts) {
    const weight = concept.semanticType === "DEADLINE" ? 1_350_000 : concept.semanticType === "SERVICE" ? 1_200_000 : 1_000_000;
    weighted += mulFp(states[concept.key] || 0, weight);
    total += weight;
  }
  return total ? clampFp((weighted * FP) / total) : 0;
}

function criticalPath(states, edges, concepts) {
  const labels = new Map(concepts.map((concept) => [concept.key, concept.label]));
  return edges.filter((edge) => edge.polarity > 0).map((edge) => ({
    edge,
    score: mulFp(states[edge.from] || 0, edge.strengthFp),
  })).sort((a, b) => b.score - a.score).slice(0, 3).map(({ edge }) => ({
    from: labels.get(edge.from) || edge.from,
    to: labels.get(edge.to) || edge.to,
    relation: edge.relation,
    mechanism: edge.mechanism,
    confidence: edge.confidenceFp / FP,
    lagTicks: edge.lagTicks,
  }));
}

export function runTemporalObserver({ concepts, edges, initialStatesFp, severity, durationHours, activeMitigation, failedMitigation }) {
  const definitions = [
    { key: "immediate", label: "İlk etki", range: "0–6 saat", steps: 2, hours: 6 },
    { key: "near", label: "Yakın dönem", range: "6–24 saat", steps: 5, hours: 24 },
    { key: "extended", label: "Zincirleme etki", range: "24–72 saat", steps: 9, hours: 72 },
  ];
  let states = Object.fromEntries(concepts.map((concept, index) => [concept.key, clampFp(initialStatesFp[index] || 0)]));
  const severityFp = clampFp(severity * FP);
  const forecasts = [];
  let completed = 0;
  for (const definition of definitions) {
    const needed = definition.steps - completed;
    for (let step = 0; step < needed; step += 1) {
      const urgency = clampFp(((completed + step + 1) / definitions[definitions.length - 1].steps) * FP);
      states = graphStep(states, concepts, edges, severityFp, urgency);
    }
    completed = definition.steps;
    let riskFp = systemRisk(states, concepts);
    const eventActiveRatioFp = clampFp((durationHours / definition.hours) * FP);
    riskFp = mulFp(riskFp, 500_000 + mulFp(eventActiveRatioFp, 500_000));
    if (activeMitigation) riskFp = clampFp(riskFp - 90_000);
    if (failedMitigation) riskFp = clampFp(riskFp + 110_000);
    forecasts.push({
      ...definition,
      nodePressureFp: { ...states },
      systemRiskFp: riskFp,
      uncertaintyFp: clampFp(110_000 + (1 - Math.min(1, concepts.filter((concept) => concept.explicit).length / 6)) * 280_000),
      throughputFp: clampFp(FP - mulFp(riskFp, 680_000), 180_000, FP),
      criticalPath: criticalPath(states, edges, concepts),
    });
  }
  return forecasts;
}

export function snapshotStates(snapshot, concepts, fallbackStates) {
  const engineById = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
  return concepts.map((concept, index) => {
    const node = engineById.get(concept.nodeId)
      || [...engineById.entries()].find(([id]) => id.startsWith(concept.key.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20)))?.[1];
    const state = Number(node?.state ?? node?.state_fp);
    return Number.isFinite(state) ? clampFp(state > 1 ? state : state * FP) : fallbackStates[index];
  });
}

export const TEMPORAL_MODEL_INFO = Object.freeze({ ...TEMPORAL_WEIGHTS, fixedPointScale: FP });
