import type { EvidenceRecord } from "../evidence-vault.mjs";
import type { GroundedReasoning } from "../neurocausal.mjs";

export function augmentGroundingWithVault(
  grounding: GroundedReasoning,
  query: string,
  evidenceRecords?: EvidenceRecord[],
): GroundedReasoning;

