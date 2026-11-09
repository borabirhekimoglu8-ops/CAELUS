import type { NeuralGateAudit } from "../../lib/neurocausal.mjs";

type NeuralGateCardProps = {
  audit: NeuralGateAudit;
  observerTick: number;
};

export function NeuralGateCard({ audit, observerTick }: NeuralGateCardProps) {
  return (
    <section className="gate-card" aria-label="Truth Gate doğrulama sonucu">
      <div className="gate-card__title">
        <div><span>TRUTH GATE</span><strong>{audit.accepted ? "KANITA BAĞLI" : "ÇEKİMSER MOD"}</strong></div>
        <em>{audit.modelVersion} · T{observerTick}</em>
      </div>
      <dl>
        {audit.gates.map((gate) => (
          <div key={gate.id}>
            <dt>{gate.label}</dt>
            <dd><b className={`gate-${gate.status}`}>{gate.status.toUpperCase()}</b><span>{gate.value}</span></dd>
          </div>
        ))}
      </dl>
      <small>Kanıtsız iddia engellenir · paket/durum kontrolü Rust/WASM · bulut=false</small>
    </section>
  );
}
