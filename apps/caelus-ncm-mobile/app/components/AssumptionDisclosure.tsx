import type { Assumption } from "../../lib/neurocausal.mjs";

type AssumptionDisclosureProps = {
  assumptions: Assumption[];
  unknowns: string[];
};

const SOURCE_LABEL = { input: "GİRDİ", inferred: "ÇIKARIM", default: "VARSAYIM" } as const;

export function AssumptionDisclosure({ assumptions, unknowns }: AssumptionDisclosureProps) {
  return (
    <details className="assumption-disclosure">
      <summary><span>Kritik varsayımlar ve bilinmeyenler</span><em>{assumptions.length + unknowns.length}</em></summary>
      <div className="assumption-list">
        {assumptions.map((assumption) => (
          <div key={assumption.id}><b>{SOURCE_LABEL[assumption.source]}</b><p>{assumption.text}</p></div>
        ))}
        {unknowns.map((unknown) => <div key={unknown}><b>BİLİNMİYOR</b><p>{unknown}</p></div>)}
      </div>
    </details>
  );
}
