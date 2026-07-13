export type EvidenceSpan = {
  source: "input" | "ontology" | "engine";
  text: string;
  ruleId?: string;
};

export type NeuralRelation = {
  from: string;
  to: string;
  confidence: number;
  relation: string;
  mechanism: string;
  lagTicks: number;
  polarity: number;
  evidence: EvidenceSpan[];
};

export type HorizonForecast = {
  key: "immediate" | "near" | "extended";
  label: string;
  range: string;
  summary: string;
  risks: string[];
  confidence: number;
  expected: { risk: number; throughput: number };
  criticalPath: Array<{
    from: string;
    to: string;
    relation: string;
    mechanism: string;
    confidence: number;
    lagTicks: number;
  }>;
};

export type CounterfactualBranch = {
  id: "baseline" | "contained" | "cascade";
  label: string;
  premise: string;
  outcome: string;
  risk: number;
  throughput: number;
  deltaRisk: number;
  deltaThroughput: number;
  confidence: number;
};

export type Assumption = {
  id: string;
  text: string;
  source: "input" | "inferred" | "default";
  confidence: number;
  material: boolean;
};

export type NeuralGateAudit = {
  accepted: boolean;
  mode: "neural_observer" | "symbolic_fallback";
  fingerprint: string;
  modelVersion: string;
  graphDepth: number;
  gates: Array<{
    id: string;
    label: string;
    status: "pass" | "warn" | "fail";
    value: string;
    threshold: string;
  }>;
};

export type NeuralAnalysis = {
  sourceText: string;
  fingerprint: string;
  scenarioId: string;
  sector: string;
  sectorLabel: string;
  activeDomains: string[];
  confidence: number;
  severity: number;
  synopsis: string;
  executiveSummary: string;
  concepts: string[];
  strongestRelations: NeuralRelation[];
  leverNarratives: string[];
  horizons: HorizonForecast[];
  counterfactuals: CounterfactualBranch[];
  assumptions: Assumption[];
  unknowns: string[];
  criticalSignals: string[];
  gateAudit: NeuralGateAudit;
  evidence: EvidenceSpan[];
  observerProposal: Record<string, unknown>;
  observerTick: number;
  model: string;
  semanticEncoder: string;
  architecture: string;
  authority: string;
  cloudUsed: false;
};

export type NeuralScenario = {
  pack: {
    id: string;
    sector: string;
    meta: Record<string, unknown>;
    extended_causal_model: {
      nodes: Array<{ id: string; label: string; kind: string; state_fp: number }>;
      edges: Array<{ from: string; to: string; multiplier_fp: number }>;
      levers: Array<{ id: string; label: string; target: string; success_p_fp: number }>;
    };
  };
  analysis: NeuralAnalysis;
};

export function compileNeuralScenario(input: string): NeuralScenario;
export function compileLegacyScenario(input: string): NeuralScenario;
export function observeTemporalSnapshot(scenario: NeuralScenario, snapshot: unknown): NeuralScenario;
export function runNeuralInference(input: string): Record<string, unknown>;
export const NEURO_MODEL_INFO: {
  version: string;
  semanticEncoderVersion: string;
  temporalModelVersion: string;
  architecture: string;
  inputDimensions: number;
  hiddenUnits: number;
  temporalHiddenUnits: number;
  sectors: string[];
  observerAuthority: "advisory";
  engineAuthority: "rust_wasm";
  cloudUsed: false;
};
