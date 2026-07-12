export type NeuralRelation = {
  from: string;
  to: string;
  confidence: number;
};

export type NeuralAnalysis = {
  sourceText: string;
  fingerprint: string;
  scenarioId: string;
  sector: string;
  sectorLabel: string;
  confidence: number;
  severity: number;
  synopsis: string;
  concepts: string[];
  strongestRelations: NeuralRelation[];
  leverNarratives: string[];
  model: string;
  architecture: string;
  cloudUsed: false;
};

export type NeuralScenario = {
  pack: {
    id: string;
    sector: string;
    meta: Record<string, unknown>;
    extended_causal_model: {
      nodes: Array<{ id: string; label: string; kind: string }>;
      edges: Array<{ from: string; to: string; multiplier_fp: number }>;
      levers: Array<{ id: string; label: string; target: string; success_p_fp: number }>;
    };
  };
  analysis: NeuralAnalysis;
};

export function compileNeuralScenario(input: string): NeuralScenario;
export function runNeuralInference(input: string): Record<string, unknown>;
export const NEURO_MODEL_INFO: {
  version: string;
  architecture: string;
  inputDimensions: number;
  hiddenUnits: number;
  sectors: string[];
  cloudUsed: false;
};
