import type { Dispatch, SetStateAction } from "react";
import type { Screen } from "../features/navigation/world-navigation.js";

export interface InfoTabsProps {
  view: {
    screen: Screen;
    setMenuOpen: Dispatch<SetStateAction<boolean>>;
  };
}
export function InfoTabs({ view }: InfoTabsProps) {
  const { screen, setMenuOpen } = view;
  return (<nav className="focused-info-tabs" aria-label="Info sections">
    {([
      { id: "vitals", label: "Vitals", href: "#/info" },
      { id: "items", label: "Items", href: "#/info/items" },
      { id: "equipment", label: "Equipment", href: "#/info/equipment" },
      { id: "stats", label: "Stats", href: "#/info/stats" },
      { id: "notes", label: "Field notes", href: "#/info/notes" },
      { id: "codex", label: "Codex", href: "#/info/codex" },
    ] as const).map((tab) => (
      <a
        key={tab.id}
        href={tab.href}
        className="focused-info-tab"
        aria-current={screen === tab.id ? "page" : undefined}
        onClick={() => setMenuOpen(false)}
      >
        {tab.label}
      </a>
    ))}
  </nav>);
}
