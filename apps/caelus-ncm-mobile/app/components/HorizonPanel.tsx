import type { HorizonForecast } from "../../lib/neurocausal.mjs";

type HorizonPanelProps = {
  horizons: HorizonForecast[];
  selected: string;
  onSelect(key: string): void;
};

function percent(value: number): string {
  return `%${Math.round(Math.max(0, Math.min(1, value)) * 100)}`;
}

export function HorizonPanel({ horizons, selected, onSelect }: HorizonPanelProps) {
  const active = horizons.find((horizon) => horizon.key === selected) ?? horizons[0];
  if (!active) return null;
  const panelId = `horizon-panel-${active.key}`;

  return (
    <section className="depth-section" aria-labelledby="horizon-title">
      <div className="depth-heading"><span>ZAMANSAL GÖZLEMCİ</span><h3 id="horizon-title">Etki ufukları</h3></div>
      <div className="segment-tabs" role="tablist" aria-label="Tahmin zaman ufku">
        {horizons.map((horizon) => (
          <button
            type="button"
            role="tab"
            id={`horizon-tab-${horizon.key}`}
            aria-selected={horizon.key === active.key}
            aria-controls={`horizon-panel-${horizon.key}`}
            className={horizon.key === active.key ? "is-active" : ""}
            key={horizon.key}
            onClick={() => onSelect(horizon.key)}
          >
            <b>{horizon.range.replace(" saat", "s")}</b>
            <small>{horizon.calibrated ? `${percent(horizon.expected.risk)} risk` : "YÖNSEL"}</small>
          </button>
        ))}
      </div>
      <article className="forecast-card" id={panelId} role="tabpanel" aria-labelledby={`horizon-tab-${active.key}`}>
        <div className="forecast-card__top">
          <div><span>{active.label}</span><strong>{active.range}</strong></div>
          <div className="forecast-kpis">
            {active.calibrated ? <><b>{percent(active.expected.risk)} risk</b><b>{percent(active.expected.throughput)} akış</b></> : <b>Kalibre yüzde yok</b>}
          </div>
        </div>
        <p>{active.summary}</p>
        <ul>{active.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
        <small>{active.calibrated ? `Kalibre güven ${percent(active.confidence)}` : "Yönsel çıkarım · gerçek olasılık değildir"}</small>
      </article>
    </section>
  );
}
