import { describe, expect, it } from "vitest";
import { GameSnapshotSchema } from "@mudd/client-sdk";
import { selectItemActions, selectUsableAxes } from "./action-selectors.js";
const item = (id: string) => ({ id, label: "Same label", description: "An item." });
const snapshot = () => GameSnapshotSchema.parse({
  player: { id: "player", displayName: "Player" },
  character: {
    characterId: "character", worldInstanceId: "world", name: "Arin", locationId: "room", revision: 1,
    inventory: [
      { ...item("equipped"), equipment: { slot: "weapon" } },
      { ...item("other-gear"), equipment: { slot: "weapon" } },
      { ...item("quest"), questBound: true },
      { ...item("axe"), woodcuttingAxe: { requiredLevel: 2, power: 1 } },
    ],
    equipment: { weaponItemId: "equipped", armorItemId: null },
    woodcutting: { level: 1, experience: 0 },
  },
  location: {
    worldInstanceId: "world", locationId: "room", revision: 1, title: "Room", shortName: "Room",
    qualifiedName: "Room", locationGroups: [], description: "Room", exits: [], occupants: [],
    objects: [
      { id: "corpse", label: "Corpse", description: "A corpse", readable: false, takeable: false, containerKind: "corpse" },
      { id: "loot", label: "Loot", description: "Loot", readable: false, takeable: true, containerId: "corpse" },
    ],
  },
});
describe("inventory action selectors", () => {
  it("excludes equipped and quest-bound drops while keeping duplicate labels identified", () => {
    const result = selectItemActions(snapshot());
    expect(result.droppable.map((item) => item.id)).toEqual(["other-gear", "axe"]);
    expect(result.equipable.map((item) => item.id)).toEqual(["other-gear"]);
    expect(result.droppable.map((item) => item.label)).toEqual(["Same label", "Same label"]);
  });
  it("updates gathering affordances when the projected level changes", () => {
    const low = snapshot();
    expect(selectUsableAxes(low, low.character!.inventory)).toEqual([]);
    const high = GameSnapshotSchema.parse({
      ...low, character: { ...low.character, woodcutting: { level: 2, experience: 100 } },
    });
    expect(selectUsableAxes(high, high.character!.inventory).map((item) => item.id)).toEqual(["axe"]);
  });
  it("removes depleted targets and corpse affordances when projected contents disappear", () => {
    const current = snapshot();
    expect(selectItemActions(current).lootable.map((item) => item.id)).toEqual(["corpse"]);
    const changed = GameSnapshotSchema.parse({
      ...current, location: { ...current.location, objects: current.location!.objects.filter((item) => item.id !== "loot") },
    });
    expect(selectItemActions(changed).lootable).toEqual([]);
    expect(selectItemActions(changed).takeable).toEqual([]);
  });
});
