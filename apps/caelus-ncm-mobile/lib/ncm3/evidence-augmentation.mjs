import { buildEvidenceContext } from "../evidence-vault.mjs";

function compact(value, max = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > max * 0.6 ? boundary : slice.length).trim()}…`;
}

function externalReference(record, source = record.source || {}) {
  return {
    source: source.kind === "user_file" ? "user_file" : source.kind === "public_source" || source.uri ? "public_source" : "user_file",
    text: record.text,
    documentId: record.id,
    sourceId: source.id,
    uri: source.uri,
    title: record.locator?.fileName || source.name || "Kanıt kaydı",
    publisher: source.publisher,
    retrievedAt: source.retrievedAt,
    publishedAt: source.publishedAt,
    fingerprint: record.fingerprint,
    locator: record.locator,
    trustTier: source.tierLabel,
    tier: source.tier,
    license: source.license,
    retrievalScore: record.retrieval?.score || 0,
    corroborationCount: record.corroboration?.independentSourceCount || 1,
    verified: true,
    promotionEligible: source.promotionEligible !== false,
  };
}

function externalReferences(record, eligibleOnly = false) {
  const provenance = Array.isArray(record.provenance) && record.provenance.length
    ? record.provenance
    : [record.source || {}];
  const selected = eligibleOnly
    ? provenance.filter((source) => source?.promotionEligible !== false)
    : provenance;
  return (selected.length ? selected : provenance).map((source) => externalReference(record, source));
}

function recomputeCoverage(claims, requiredInputs, abstained) {
  const supportedClaimCount = claims.filter((claim) => claim.type !== "UNKNOWN").length;
  const unknownClaimCount = claims.length - supportedClaimCount;
  const denominator = supportedClaimCount + unknownClaimCount + requiredInputs.length;
  return {
    status: unknownClaimCount || requiredInputs.length ? "partial" : "complete",
    score: denominator ? Math.round((supportedClaimCount / denominator) * 10_000) / 10_000 : 1,
    supportedClaimCount,
    unknownClaimCount,
    missingInputCount: requiredInputs.length,
    abstained,
  };
}

function isFreshPublishedRecord(record, maxAgeHours = 24) {
  const published = Date.parse(record.source?.publishedAt || "");
  const retrieved = Date.parse(record.source?.retrievedAt || "");
  if (!Number.isFinite(published) || !Number.isFinite(retrieved)) return false;
  const ageMs = retrieved - published;
  return ageMs >= -5 * 60_000 && ageMs <= maxAgeHours * 60 * 60_000;
}

export function augmentGroundingWithVault(grounding, query, evidenceRecords = []) {
  if (!Array.isArray(evidenceRecords) || !evidenceRecords.length) return grounding;
  const context = buildEvidenceContext(query, evidenceRecords, { limit: 6, maxSnippetChars: 360, minScore: 180 });
  if (!context.records.length) return grounding;

  // A safety gate is never relaxed by retrieved prose. Medical, legal or other
  // high-stakes source text remains visible in the vault but cannot become an
  // instruction or override the deterministic abstention.
  if (grounding.claims.some((claim) => claim.type === "SAFETY")) return grounding;
  const liveGate = grounding.knowledgePack?.id === "NCM3-LIVE-DATA-GATE";

  const queryWordCount = String(query || "").trim().split(/\s+/).filter(Boolean).length;
  const minimumMatches = queryWordCount <= 2 ? 1 : 2;
  const relevant = context.records.filter((record) =>
    !record.contradicted && record.retrieval.matchedTokens.length >= minimumMatches && record.retrieval.score >= 180);
  const contested = context.contradictions.length > 0;
  const isExplicitUserFile = (record) => record.source?.kind === "user_file"
    || (!record.source?.uri && record.source?.publisher === "Kullanıcı yüklemesi");
  const isAttributedInstitutionalClaim = (record) => record.source?.kind === "public_source"
    && record.source?.tier === 2
    && record.source?.promotionEligible !== false
    && record.retrieval?.queryCoverage >= 500
    && record.retrieval?.matchedTokens?.length >= minimumMatches
    && (record.corroboration?.independentSourceCount || 1) < 2;
  const isTimestampedLiveClaim = (record) => record.source?.kind === "public_source"
    && isFreshPublishedRecord(record)
    && record.retrieval?.queryCoverage >= 500
    && record.retrieval?.matchedTokens?.length >= minimumMatches
    && ((record.source?.promotionEligible !== false && record.source?.tier <= 2)
      || (record.source?.promotionEligible === false && record.source?.tier === 3));
  // Promotion is claim-local: one strong record must never bootstrap another
  // weak record that merely shares query words. A record must itself be user
  // supplied, primary, carry independent provenance for the same content, or
  // be a directly matching institutional record that remains explicitly
  // attributed and conditional rather than becoming an unqualified fact.
  const acceptedWitnesses = liveGate
    ? relevant.filter(isTimestampedLiveClaim)
    : relevant.filter((record) => record.source?.promotionEligible !== false && (
      isExplicitUserFile(record)
      || record.source?.tier === 1
      || record.corroboration?.independentSourceCount >= 2
      || isAttributedInstitutionalClaim(record)
    ));
  const hasExplicitUserFile = acceptedWitnesses.some(isExplicitUserFile);
  const attributedOnly = acceptedWitnesses.length > 0
    && (liveGate || acceptedWitnesses.every(isAttributedInstitutionalClaim));
  const promotable = !contested && acceptedWitnesses.length > 0;

  if (liveGate && !promotable && !contested) return grounding;

  const externalObservations = (promotable ? acceptedWitnesses : relevant).slice(0, 4).map((record, index) => {
    const references = externalReferences(record, promotable);
    const statement = compact(record.text);
    const attribution = compact(record.source?.publisher || record.source?.name || "Kurumsal kaynak", 120);
    return {
      id: `SRC-${record.fingerprint}-${index + 1}`,
      statement: liveGate
        ? `${attribution} kaydında (${record.source?.publishedAt}): ${statement}`
        : isAttributedInstitutionalClaim(record) ? `${attribution} kaydında: ${statement}` : statement,
      basis: references,
      evidence: references,
    };
  });
  const externalClaims = externalObservations.map((item) => ({
    id: item.id,
    type: "FACT",
    statement: item.statement,
    basis: item.basis,
    evidence: item.evidence,
  }));

  let mode = grounding.mode;
  let title = grounding.title;
  let directAnswer = grounding.directAnswer;
  let observations = grounding.observations;
  let claims = grounding.claims;
  let unknowns = grounding.unknowns;
  let requiredInputs = grounding.requiredInputs;
  let knowledgePack = grounding.knowledgePack;

  if (promotable) {
    observations = [...externalObservations, ...observations];
    claims = [...externalClaims, ...claims];
    const extracts = externalObservations.map((item, index) => `[E${index + 1}] ${item.statement}`).join(" ");
    if (grounding.mode === "insufficient") {
      mode = attributedOnly ? "conditional" : "grounded";
      title = liveGate ? "Zaman damgalı güncel kaynak özeti" : attributedOnly ? "Atıflı kurumsal kaynak özeti" : "Açık kaynak ve dosya kanıt özeti";
      directAnswer = liveGate
        ? `Truth Gate son 24 saat içinde yayınlanmış ve sorguyla doğrudan eşleşen ${externalObservations.length} açık kaynak kaydını zamanıyla aktarıyor. ${extracts} Bu, kaynağın o andaki beyanıdır; bağımsız canlı sensör doğrulaması değildir.`
        : attributedOnly
        ? `Truth Gate sorguyla doğrudan eşleşen ${externalObservations.length} kurumsal kaydı koşullu ve kaynak adıyla aktarıyor. ${extracts} Bu, kaynağın beyanıdır; olayın bağımsız doğrulaması veya nedensel kanıtı değildir.`
        : `Truth Gate sorguyla doğrudan eşleşen ${externalObservations.length} kaynak kaydını kabul etti. ${extracts} Nedensel veya sayısal olarak doğrulanmayan ayrıntılar aşağıda bilinmeyen olarak korunmuştur.`;
      knowledgePack = {
        ...grounding.knowledgePack,
        id: "NCM3-OPEN-EVIDENCE-MESH",
        rules: [...new Set([
          ...(grounding.knowledgePack.rules || []),
          "NCM3-EVIDENCE-RETRIEVAL",
          hasExplicitUserFile ? "NCM3-USER-PROVIDED-DATA" : "NCM3-SOURCE-INDEPENDENCE-GATE",
          ...(attributedOnly && !liveGate ? ["NCM3-ATTRIBUTED-INSTITUTIONAL-SOURCE"] : []),
          ...(liveGate ? ["NCM3-FRESH-PUBLISHED-SOURCE-GATE"] : []),
        ])],
      };
    }
  } else if (contested) {
    const conflictRefs = context.records.slice(0, 4).flatMap((record) => externalReferences(record));
    const conflict = {
      id: "UNK-OPEN-SOURCE-CONFLICT",
      statement: `Sorguyla eşleşen açık kaynak kayıtlarında ${context.contradictions.length} çözülmemiş çelişki var; Truth Gate bir tarafı gerçek seçmedi.`,
      requiredInput: "Aynı zaman ve kapsam için bağımsız birincil kaynak",
      basis: conflictRefs,
      evidence: conflictRefs,
    };
    unknowns = [conflict, ...unknowns];
    claims = [{ id: conflict.id, type: "UNKNOWN", statement: conflict.statement, basis: conflict.basis, evidence: conflict.evidence }, ...claims];
    requiredInputs = [...new Set([conflict.requiredInput, ...requiredInputs])];
    directAnswer = `${directAnswer} Açık kaynak taraması çelişkili sonuç verdi; hiçbir uyuşmayan değer otomatik seçilmedi.`;
  } else if (context.records.length) {
    const weakRefs = context.records.slice(0, 4).flatMap((record) => externalReferences(record));
    const weak = {
      id: "UNK-OPEN-SOURCE-SUPPORT",
      statement: "Eşleşen kayıtlar bulundu ancak kaynak bağımsızlığı, güven katmanı veya sorgu kapsamı gerçeğe yükseltmek için yeterli değil.",
      requiredInput: "Bağımsız birincil/kurumsal teyit veya imzalı yerel veri seti",
      basis: weakRefs,
      evidence: weakRefs,
    };
    unknowns = [weak, ...unknowns];
    claims = [{ id: weak.id, type: "UNKNOWN", statement: weak.statement, basis: weak.basis, evidence: weak.evidence }, ...claims];
    requiredInputs = [...new Set([weak.requiredInput, ...requiredInputs])];
  }

  // Retrieval/upload time is provenance, not the observation time of a claim.
  const sourceTimes = context.records.map((record) => record.source?.publishedAt).filter(Boolean).sort();
  const coverage = recomputeCoverage(claims, requiredInputs, mode === "insufficient");
  return {
    ...grounding,
    mode,
    title,
    directAnswer,
    observations,
    unknowns,
    requiredInputs,
    claims,
    sourceTime: sourceTimes.at(-1) || grounding.sourceTime,
    knowledgePack,
    coverage,
  };
}
