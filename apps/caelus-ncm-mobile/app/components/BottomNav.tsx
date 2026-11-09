import { useState } from "react";

export type MobileTab = "scenario" | "graph" | "levers" | "audit";

type BottomNavProps = {
  active: MobileTab;
  onChange(tab: MobileTab): void;
  leverCount: number;
};

const tabs: Array<{ id: MobileTab; label: string; desc: string; icon: string }> = [
  { id: "scenario", label: "Dünyam & Senaryo", desc: "Doğal dil durum analizi ve 3 gelecek ufku", icon: "🌍" },
  { id: "graph", label: "İlişkiler ve Keşfet", desc: "Adım adım nedensel yol ve etki grafiği", icon: "🕸" },
  { id: "levers", label: "Gelecekler & Hamleler", desc: "Deterministik WASM müdahale kaldıraçları", icon: "⚖" },
  { id: "audit", label: "Kaynaklar ve Dayanak", desc: "Epistemik denetim ve yerel çalışma kaydı", icon: "📜" },
];

export function BottomNav({ active, onChange, leverCount }: BottomNavProps) {
  const [open, setOpen] = useState(false);
  const currentTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <nav className="spatial-compass-bar" id="caelus-mobile-spatial-compass" aria-label="CAELUS Mekânsal Pusula ve Çalışma Alanları">
      <div className="spatial-compass-row">
        <button
          type="button"
          className="spatial-compass-trigger"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="caelus-mobile-compass-popover"
        >
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="11.5" stroke="#88D4FF" strokeOpacity="0.4" strokeWidth="1.3" strokeDasharray="3 2.5" />
            <path d="M14 4.2C19.4 4.2 23.8 8.6 23.8 14C23.8 18.3 20.6 21.8 16.3 22.3C12.7 22.7 9.4 20.1 9.0 16.5C8.7 13.6 10.8 10.9 13.7 10.6C15.9 10.4 17.9 12.0 18.1 14.2" stroke="#88D4FF" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="14" cy="14" r="2.6" fill="#E6C387" />
          </svg>
          <span className="spatial-compass-brand">CAELUS <b>NCM</b></span>
          <span className="spatial-compass-active-domain">{currentTab.label}</span>
          <span className="spatial-compass-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>

        {active !== "scenario" ? (
          <button
            type="button"
            className="spatial-return-pill"
            onClick={() => {
              onChange("scenario");
              setOpen(false);
            }}
          >
            🌍 Sahneye Dön
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="spatial-compass-popover" id="caelus-mobile-compass-popover" role="dialog" aria-label="Mekânsal Çalışma Alanı Seçici">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={active === tab.id ? "spatial-domain-btn is-active" : "spatial-domain-btn"}
              onClick={() => {
                onChange(tab.id);
                setOpen(false);
              }}
              aria-current={active === tab.id ? "page" : undefined}
            >
              <span className="spatial-domain-icon" aria-hidden="true">{tab.icon}</span>
              <span className="spatial-domain-copy">
                <strong>{tab.label}</strong>
                <small>{tab.desc}</small>
              </span>
              {tab.id === "levers" && leverCount > 0 ? <em>{leverCount}</em> : null}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
