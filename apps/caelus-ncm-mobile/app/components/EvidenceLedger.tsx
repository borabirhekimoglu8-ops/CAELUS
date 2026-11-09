import type { GroundedReasoning } from "../../lib/neurocausal.mjs";

type EvidenceLedgerProps = {
  reasoning: GroundedReasoning;
};

const MODE = {
  grounded: { label: "KANITLI CEVAP", tone: "grounded" },
  conditional: { label: "KOŞULLU ÇIKARIM", tone: "conditional" },
  insufficient: { label: "VERİ YETERSİZ", tone: "insufficient" },
} as const;

function basisLabel(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "Yerel kanıt defteri";
  const sources = new Set(value.map((item) => typeof item === "object" && item && "source" in item ? String(item.source) : "rule"));
  return [...sources].map((source) => source === "input" ? "girdi" : source === "rule" ? "yerel kural" : source === "public_source" ? "açık kaynak" : source === "user_file" ? "yüklenen dosya" : source).join(" + ");
}

type SourceReference = {
  documentId: string;
  sourceId?: string;
  source: "public_source" | "user_file";
  title?: string;
  uri?: string | null;
  publisher?: string | null;
  publishedAt?: string | null;
  retrievedAt?: string | null;
  trustTier?: string;
  tier?: number;
  locator?: { fileName?: string; line?: number; row?: number; jsonPath?: string };
  corroborationCount?: number;
};

function sourceReferences(reasoning: GroundedReasoning): SourceReference[] {
  const unique = new Map<string, SourceReference>();
  reasoning.claims.forEach((claim) => claim.evidence.forEach((item) => {
    if (!item || (item.source !== "public_source" && item.source !== "user_file") || typeof item.documentId !== "string") return;
    const reference = item as unknown as SourceReference;
    unique.set(`${reference.sourceId || reference.source}:${reference.documentId}`, reference);
  }));
  return [...unique.values()];
}

function sourceLocator(reference: SourceReference): string {
  const locator = reference.locator;
  if (!locator) return "belge";
  if (locator.row) return `${locator.fileName || "veri"} · satır ${locator.row}`;
  if (locator.line) return `${locator.fileName || "belge"} · satır ${locator.line}`;
  if (locator.jsonPath) return `${locator.fileName || "JSON"} · ${locator.jsonPath}`;
  return locator.fileName || "belge";
}

function safeSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function EvidenceLedger({ reasoning }: EvidenceLedgerProps) {
  const mode = MODE[reasoning.mode];
  const references = sourceReferences(reasoning);

  return (
    <section className={`evidence-ledger evidence-ledger--${mode.tone}`} aria-label="Kanıta bağlı cevap">
      <div className="evidence-ledger__status">
        <div><span>GERÇEKLİK KAPISI</span><strong>{mode.label}</strong></div>
        <em>{reasoning.knowledgePack.id} · %{Math.round(reasoning.coverage.score * 100)} kapsam</em>
      </div>

      <h3>{reasoning.title}</h3>
      <p className="evidence-ledger__answer">{reasoning.directAnswer}</p>

      {references.length ? (
        <div className="evidence-sources">
          <h4>Kaynak izi</h4>
          {references.map((reference) => {
            const href = safeSourceUrl(reference.uri);
            return (
              <article key={`${reference.sourceId || reference.source}:${reference.documentId}`}>
                <div><span>{reference.source === "user_file" ? "DOSYA" : `KATMAN ${reference.tier ?? "—"}`}</span><em>{reference.corroborationCount && reference.corroborationCount > 1 ? `${reference.corroborationCount} bağımsız teyit` : reference.trustTier || "tek kaynak"}</em></div>
                {href ? <a href={href} target="_blank" rel="noreferrer nofollow">{reference.title || reference.publisher || href}</a> : <strong>{reference.title || reference.publisher || "Yerel dosya"}</strong>}
                <small>{reference.publisher || "Kullanıcı yüklemesi"} · {sourceLocator(reference)} · {reference.publishedAt || reference.retrievedAt || "tarih yok"}</small>
              </article>
            );
          })}
        </div>
      ) : null}

      {reasoning.observations.length ? (
        <div className="evidence-group">
          <h4>Gözlenen</h4>
          <ul>{reasoning.observations.map((item) => <li key={item.id}>{item.statement}</li>)}</ul>
        </div>
      ) : null}

      {reasoning.calculations.length ? (
        <div className="calculation-list">
          <h4>Hesaplanan</h4>
          {reasoning.calculations.map((item) => (
            <article key={`${item.label}-${item.expression}`}>
              <span>{item.label}</span>
              <strong>{item.result}{item.unit ? ` ${item.unit}` : ""}</strong>
              <code>{item.expression}</code>
              <small>{basisLabel(item.basis)}</small>
            </article>
          ))}
        </div>
      ) : null}

      {reasoning.deductions.length ? (
        <div className="evidence-group">
          <h4>Çıkarım</h4>
          <ul>{reasoning.deductions.map((item) => <li key={item.id}>{item.statement}</li>)}</ul>
        </div>
      ) : null}

      {reasoning.unknowns.length ? (
        <div className="evidence-group evidence-group--unknown">
          <h4>Bilinmeyen</h4>
          <ul>{reasoning.unknowns.map((item) => <li key={item.id}>{item.statement}</li>)}</ul>
        </div>
      ) : null}

      {reasoning.requiredInputs.length ? (
        <div className="required-inputs">
          <h4>Gerçek hesap için gerekenler</h4>
          <div>{reasoning.requiredInputs.map((item) => <span key={item}>{item}</span>)}</div>
        </div>
      ) : null}

      <footer>Kaynak/zaman: {reasoning.sourceTime || "yalnızca yerel girdi"} · Üretken model yok · kanıtsız yüzde yasak</footer>
    </section>
  );
}
