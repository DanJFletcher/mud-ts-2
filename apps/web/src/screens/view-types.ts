import type { MuddHttpClient } from "@mudd/client-sdk";
export type ClassCatalogSummary = NonNullable<Awaited<ReturnType<MuddHttpClient["getWorlds"]>>[number]["classCatalog"]>;
export type QuickMode = "quick" | "choose-exit" | "look" | "read" | "drop" | "take" | "loot" | "talk" | "attack" | "shop" | "buy" | "use" | "use-target" | "equip" | "unequip";
export type QuickAction = { id: string; label: string; ariaLabel: string; opensMenu: boolean; disabled?: boolean; onSelect: () => void; };
