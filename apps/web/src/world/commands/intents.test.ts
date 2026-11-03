import { describe, expect, it } from "vitest";
import { GameSnapshotSchema } from "@mudd/client-sdk";
import { entityRef, intentContext, parseWorldCommand, sameIntentContext, entityAvailable } from "./intents.js";
import { findObjectMatches, findNpcMatches, findItemContainerMatches } from "./targets.js";

const items = [
  { id: "first", label: "Loose stone" }, { id: "second", label: "Loose stone" },
  { id: "loose stone", label: "Different label" },
];
function snapshot() {
  return GameSnapshotSchema.parse({
    player: { id: "player", displayName: "Player" },
    character: { characterId: "character", worldInstanceId: "world", name: "Arin", locationId: "room", revision: 1,
      inventory: [{ id: "carried", typeId: "stone", label: "Smooth stone", description: "A stone.", questBound: false }],
    },
    location: { worldInstanceId: "world", locationId: "room", revision: 1, title: "Room", shortName: "Room",
      qualifiedName: "Room", locationGroups: [], description: "Room", exits: [], occupants: [], npcs: [],
      objects: [
        { id: "sack", label: "Canvas sack", description: "A sack.", readable: false, takeable: false, containerKind: "sack" },
        { id: "inside", label: "Loose stone", description: "A stone.", readable: false, takeable: true, containerId: "sack" },
      ],
    },
  });
}
describe("pure command intent parsing", () => {
  it('resolves read IDs, names and aliases through explicit metadata with ambiguity protection', () => {
    const view = snapshot();
    view.dailyActivities = { cycle: '2026-10-23', boards: [{ id: 'jobs', name: 'Local jobs' }], sources: [] };
    view.location!.objects.push({ id: 'notice', label: 'Bulletin board', description: 'Jobs', readable: true,
      takeable: false, readAction: { type: 'daily-board', boardId: 'jobs' } });
    for (const text of ['read notice', 'read Bulletin board']) {
      expect(parseWorldCommand(text, view)).toMatchObject({ kind: 'read', target: { id: 'notice',
        readAction: { type: 'daily-board', boardId: 'jobs' } } });
    }
    for (const text of ['read bulletin', 'read board', 'read the notice board', 'read daily bulletin']) {
      expect(parseWorldCommand(text, view)).toMatchObject({ kind: 'read-board', target: { id: 'jobs' } });
    }
    view.dailyActivities.boards.push({ id: 'second', name: 'Local jobs' });
    expect(parseWorldCommand('read board', view)?.kind).toBe('error');
    view.location!.objects.push({ ...view.location!.objects.at(-1)!, id: 'unrelated', readAction: undefined });
    expect(parseWorldCommand('read Bulletin board', view)?.kind).toBe('error');
    expect(parseWorldCommand('read unrelated', view)).toMatchObject({ kind: 'read', target: { id: 'unrelated', readAction: null } });
  });
  it.each([
    ["first", ["first"]], ["loose stone", ["loose stone"]], ["stone", ["first", "second"]],
    ["missing", []],
  ])("resolves %s with exact ID before exact and partial labels", (target, ids) => {
    expect(findObjectMatches(target, items).map((item) => item.id)).toEqual(ids);
  });
  it("does not silently choose a duplicate exact item or NPC label", () => {
    expect(findObjectMatches("Loose stone", items.slice(0, 2))).toHaveLength(2);
    expect(findNpcMatches("Mara", [{ id: "one", name: "Mara" }, { id: "two", name: "Mara" }])).toHaveLength(2);
  });
  it.each(["get loose stone from canvas sack", "take the loose stone in the canvas sack"])("parses multiword container syntax: %s", (input) => {
    expect(parseWorldCommand(input, snapshot())).toMatchObject({
      kind: "take", target: { id: "inside", kind: "object" },
    });
  });
  it("parses put with stable item and container IDs", () => {
    expect(parseWorldCommand("put smooth stone into canvas sack", snapshot())).toMatchObject({
      kind: "put", item: { id: "carried" }, target: { id: "sack" },
    });
    expect(findItemContainerMatches("stone sack",
      [{ id: "inside", label: "Loose stone", containerId: "sack" }],
      [{ id: "sack", label: "Canvas sack" }], true)).toHaveLength(1);
  });
  it("retains feature-specific grammar and validation as typed text intents", () => {
    expect(parseWorldCommand("party quest start quest-id", snapshot())).toMatchObject({
      kind: "text", verb: "party", target: "quest start quest-id",
    });
    expect(parseWorldCommand("help take", snapshot())).toMatchObject({ kind: "text", verb: "help" });
  });
  it("rejects disappeared IDs even if a same-named replacement exists", () => {
    const current = snapshot();
    expect(entityAvailable(entityRef("old-item", "Loose stone", "object"), current)).toBe(false);
    expect(sameIntentContext({ ...intentContext(current), locationId: "old-room" }, current)).toBe(false);
  });
});
