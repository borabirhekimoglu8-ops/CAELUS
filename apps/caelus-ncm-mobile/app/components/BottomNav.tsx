export type MobileTab = "scenario" | "sources" | "graph" | "levers" | "audit";

type BottomNavProps = {
  active: MobileTab;
  onChange(tab: MobileTab): void;
  leverCount: number;
  sourceCount?: number;
};

const tabs: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: "scenario", label: "Senaryo", icon: "⌁" },
  { id: "sources", label: "Kaynak", icon: "▣" },
  { id: "graph", label: "Graf", icon: "⌬" },
  { id: "levers", label: "Hamleler", icon: "◆" },
  { id: "audit", label: "Kayıt", icon: "≡" },
];

export function BottomNav({ active, onChange, leverCount, sourceCount = 0 }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Ana bölümler">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={active === tab.id ? "bottom-nav__item is-active" : "bottom-nav__item"}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? "page" : undefined}
        >
          <span className="bottom-nav__icon" aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.id === "levers" && leverCount > 0 ? <em>{leverCount}</em> : null}
          {tab.id === "sources" && sourceCount > 0 ? <em>{sourceCount > 99 ? "99+" : sourceCount}</em> : null}
        </button>
      ))}
    </nav>
  );
}
