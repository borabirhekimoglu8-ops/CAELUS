import type { CounterfactualBranch } from "../../lib/neurocausal.mjs";

type CounterfactualPanelProps = {
  branches: CounterfactualBranch[];
  selected: string;
  onSelect(id: string): void;
};

function percent(value: number): string {
  return `%${Math.round(Math.max(0, Math.min(1, value)) * 100)}`;
}

function signed(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function CounterfactualPanel({ branches, selected, onSelect }: CounterfactualPanelProps) {
  const active = branches.find((branch) => branch.id === selected) ?? branches[0];
  if (!active) return null;

  return (
    <section className="depth-section" aria-labelledby="counterfactual-title">
      <div className="depth-heading"><span>KARŞI-OLGUSAL MOTOR</span><h3 id="counterfactual-title">Üç olası yol</h3></div>
      <div className="segment-tabs" role="tablist" aria-label="Karşı-olgusal senaryo dalı">
        {branches.map((branch) => (
          <button
            type="button"
            role="tab"
            id={`branch-tab-${branch.id}`}
            aria-selected={branch.id === active.id}
            aria-controls={`branch-panel-${branch.id}`}
            className={branch.id === active.id ? "is-active" : ""}
            key={branch.id}
            onClick={() => onSelect(branch.id)}
          >
            <b>{branch.label}</b>
            <small>{percent(branch.risk)} risk</small>
          </button>
        ))}
      </div>
      <article className={`branch-card branch-card--${active.id}`} id={`branch-panel-${active.id}`} role="tabpanel" aria-labelledby={`branch-tab-${active.id}`}>
        <div><span>RİSK {percent(active.risk)}</span><span>AKIŞ {percent(active.throughput)}</span><span>ΔR {signed(active.deltaRisk)}</span></div>
        <h4>{active.premise}</h4>
        <p>{active.outcome}</p>
      </article>
    </section>
  );
}
