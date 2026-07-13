export const EVIDENCE_VAULT_VERSION: "EV-1.0.0";

export type EvidenceFormat = "txt" | "md" | "csv" | "tsv" | "json" | "jsonl";
export type EvidenceTier = 1 | 2 | 3 | 4;
export type EvidenceStatus = "grounded" | "insufficient" | "contested";

export interface EvidenceSourceInput {
  name?: string;
  kind?: "user_file" | "public_source";
  uri?: string;
  publisher?: string;
  tier?: EvidenceTier | "primary" | "official" | "institutional" | "reputable" | "community" | "unknown" | string;
  publishedAt?: string;
  retrievedAt?: string;
  license?: string;
  /** False for discovery indexes/snippets that may be shown but cannot witness a fact. */
  promotionEligible?: boolean;
}

export interface EvidenceSource {
  id: string;
  name: string;
  kind: "user_file" | "public_source" | null;
  uri: string | null;
  publisher: string | null;
  tier: EvidenceTier;
  tierLabel: "primary" | "institutional" | "community" | "unknown";
  publishedAt: string | null;
  retrievedAt: string | null;
  license: string | null;
  promotionEligible: boolean;
}

export interface EvidenceScores {
  tier: number;
  recency: number;
  total: number;
}

export interface EvidenceNumberSignal {
  raw: string;
  value: number;
  unit: string | null;
}

export interface EvidenceRecord {
  id: string;
  fingerprint: string;
  text: string;
  normalizedText: string;
  format: EvidenceFormat;
  locator: {
    fileName: string;
    line?: number;
    row?: number;
    jsonPath?: string;
  };
  fields: Record<string, unknown> | null;
  source: EvidenceSource;
  scores: EvidenceScores;
  signals: {
    polarity: "positive" | "negative";
    numbers: EvidenceNumberSignal[];
    assertionTokens: string[];
  };
  provenance: EvidenceSource[];
  duplicateCount: number;
  corroboration: {
    independentSourceCount: number;
    supportingRecordIds: string[];
    corroborated: boolean;
  };
}

export interface EvidenceError {
  code: string;
  message: string;
  locator: EvidenceRecord["locator"];
}

export interface ParseEvidenceOptions {
  format?: EvidenceFormat | `.${EvidenceFormat}`;
  fileName?: string;
  mimeType?: string;
  source?: EvidenceSourceInput;
  /** Explicit reference instant keeps recency scoring deterministic. */
  referenceDate?: string;
}

export interface ParseEvidenceResult {
  records: EvidenceRecord[];
  errors: EvidenceError[];
  audit: {
    version: string;
    format: EvidenceFormat | null;
    parsedCount: number;
    duplicateCount?: number;
    errorCount: number;
    sourceId: string;
    deterministic?: boolean;
    externalCalls?: boolean;
  };
}

export interface EvidenceContradiction {
  id: string;
  type: "EXPLICIT_NEGATION" | "NUMERIC_CONFLICT";
  recordIds: string[];
  similarity: number;
  detail: string;
  values?: Array<{ left: EvidenceNumberSignal; right: EvidenceNumberSignal }>;
}

export interface RetrievedEvidenceRecord extends EvidenceRecord {
  retrieval: {
    score: number;
    matchedTokens: string[];
    queryCoverage: number;
  };
  contradicted: boolean;
}

export const SOURCE_TIERS: Readonly<Record<EvidenceTier, Readonly<{ label: EvidenceSource["tierLabel"]; baseScore: number }>>>;

export function scoreEvidenceSource(
  source?: EvidenceSourceInput,
  options?: { referenceDate?: string },
): Readonly<EvidenceScores>;

export function parseEvidenceFileText(input: string, options?: ParseEvidenceOptions): ParseEvidenceResult;

export function spreadsheetRowsToJson(rows: unknown[][]): string;
export function spreadsheetSheetsToJson(sheets: Array<{ sheet: string; data: unknown[][] }>): string;

export function mergeEvidenceRecords(
  ...inputs: Array<EvidenceRecord[] | ParseEvidenceResult | null | undefined>
): {
  records: EvidenceRecord[];
  duplicates: number;
  audit: {
    inputCount: number;
    outputCount: number;
    duplicateCount: number;
    uniqueSourceCount: number;
    contradictionCount: number;
    contradictionScanComplete: boolean;
    corroboratedCount: number;
  };
};

export function analyzeEvidence(records: EvidenceRecord[]): {
  records: Array<EvidenceRecord & { contradicted: boolean }>;
  contradictions: EvidenceContradiction[];
  corroboration: Array<EvidenceRecord["corroboration"] & { recordId: string }>;
  audit: {
    recordCount: number;
    uniqueSourceCount: number;
    contradictionCount: number;
    contradictionScanComplete: boolean;
    corroboratedCount: number;
    weakSingleSourceCount: number;
  };
};

export function retrieveEvidence(
  query: string,
  records: EvidenceRecord[],
  options?: { limit?: number; minScore?: number },
): RetrievedEvidenceRecord[];

export function buildEvidenceContext(
  query: string,
  records: EvidenceRecord[],
  options?: { limit?: number; minScore?: number; maxSnippetChars?: number },
): {
  query: string;
  status: EvidenceStatus;
  context: string;
  citations: Array<{
    id: string;
    recordId: string;
    sourceIds: string[];
    sourceName: string;
    uri: string | null;
    publisher: string | null;
    publishedAt: string | null;
    tier: EvidenceTier;
    locator: EvidenceRecord["locator"];
    score: number;
    corroborationCount: number;
    contradicted: boolean;
  }>;
  records: RetrievedEvidenceRecord[];
  contradictions: EvidenceContradiction[];
  audit: {
    candidateCount: number;
    selectedCount: number;
    uniqueSourceCount: number;
    contradictionCount: number;
    corroboratedCount: number;
    weakSingleSourceCount: number;
    factPromotionAllowed: boolean;
  };
};
