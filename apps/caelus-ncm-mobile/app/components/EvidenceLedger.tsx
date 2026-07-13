import type { GroundedReasoning } from "../../lib/neurocausal.mjs";

type EvidenceLedgerProps = {
  reasoning: GroundedReasoning;
};

const MODE = {
  grounded: { label: "KANITLI HESAP", tone: "grounded" },
  conditional: { label: "KOŞULLU ÇIKARIM", tone: "conditional" },
  insufficient: { label: "VERİ YETERSİZ", tone: "insufficient" },
} as const;

function basisLabel(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "Yerel kanıt defteri";
  const sources = new Set(value.map((item) => typeof item === "object" && item && "source" in item ? String(item.source) : "rule"));
  return [...sources].map((source) => source === "input" ? "girdi" : source === "rule" ? "yerel kural" : source).join(" + ");
}

export function EvidenceLedger({ reasoning }: EvidenceLedgerProps) {
  const mode = MODE[reasoning.mode];

  return (
    <section className={`evidence-ledger evidence-ledger--${mode.tone}`} aria-label="Kanıta bağlı cevap">
      <div className="evidence-ledger__status">
        <div><span>GERÇEKLİK KAPISI</span><strong>{mode.label}</strong></div>
        <em>{reasoning.knowledgePack.id} · %{Math.round(reasoning.coverage.score * 100)} kapsam</em>
      </div>

      <h3>{reasoning.title}</h3>
      <p className="evidence-ledger__answer">{reasoning.directAnswer}</p>

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
