import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameSnapshotSchema, MuddHttpClient } from "@mudd/client-sdk";
import { ActionRefreshGate } from "../action-refresh-gate.js";
import type { ControllerOptions } from "./controller-options.js";
import { useDialogueController } from "./dialogue/use-dialogue-controller.js";
import { useInventoryController } from "./inventory/use-inventory-controller.js";
import { useDailyController } from "./daily/use-daily-controller.js";
import { useCommerceController } from "./commerce/use-commerce-controller.js";

function fixture(): ControllerOptions {
  return {
    client: new MuddHttpClient({ worldInstanceId: "world" }),
    snapshot: GameSnapshotSchema.parse({
      player: { id: "player", displayName: "Player" },
      character: { characterId: "character", worldInstanceId: "world", name: "Arin", locationId: "room", revision: 1 },
      location: {
        worldInstanceId: "world", locationId: "room", revision: 1, title: "Room",
        shortName: "Room", qualifiedName: "Room", locationGroups: [], description: "A room.",
        exits: [], occupants: [], objects: [],
      },
    }),
    pending: false, refreshGate: new ActionRefreshGate(),
    beginForeground: () => ({ id: Symbol(), label: "test" }), finishForeground: vi.fn(),
    setSnapshot: vi.fn(), setConnectionError: vi.fn(), reconcileCommand: vi.fn(),
    addEntry: vi.fn(() => "entry"),
  };
}
function travel(options: ControllerOptions): ControllerOptions {
  return { ...options, snapshot: { ...options.snapshot!, location: {
    ...options.snapshot!.location!, locationId: "next-room",
  } } };
}
describe("room feature request ownership", () => {
  it("does not reopen dialogue or narrate a delayed response after travel", async () => {
    const options = fixture();
    let complete!: (value: Awaited<ReturnType<MuddHttpClient["talk"]>>) => void;
    vi.spyOn(options.client, "talk").mockImplementation(() => new Promise((done) => { complete = done; }));
    const { result, rerender } = renderHook((options) => useDialogueController({
      ...options, rememberCompletedQuestObjectives: vi.fn(),
    }), { initialProps: options });
    let work!: ReturnType<typeof result.current.talkToNpc>;
    act(() => { work = result.current.talkToNpc("npc"); });
    rerender(travel(options));
    await act(async () => {
      complete({ npcId: "npc", npcName: "Obsolete", text: "Old room", choices: [{ id: "reply", label: "Reply" }] });
      await work;
    });
    expect(result.current.activeDialogue).toBeNull();
    expect(result.current.dialogueModalOpen).toBe(false);
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it("closing a conversation invalidates an unresolved opening request", async () => {
    const options = fixture();
    let complete!: (value: Awaited<ReturnType<MuddHttpClient["talk"]>>) => void;
    vi.spyOn(options.client, "talk").mockImplementation(() => new Promise((done) => { complete = done; }));
    const { result } = renderHook(() => useDialogueController({
      ...options, rememberCompletedQuestObjectives: vi.fn(),
    }));
    let work!: ReturnType<typeof result.current.talkToNpc>;
    act(() => { work = result.current.talkToNpc("npc"); });
    await act(async () => { await result.current.closeNpcDialogue(); });
    await act(async () => { complete({ npcId: "npc", npcName: "NPC", text: "Old", choices: [] }); await work; });
    expect(result.current.activeDialogue).toBeNull();
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it("does not reopen an obsolete merchant catalog", async () => {
    const options = fixture();
    let complete!: (value: Awaited<ReturnType<MuddHttpClient["getMerchantCatalog"]>>) => void;
    vi.spyOn(options.client, "getMerchantCatalog").mockImplementation(() => new Promise((done) => { complete = done; }));
    const { result, rerender } = renderHook(useCommerceController, { initialProps: options });
    let work!: ReturnType<typeof result.current.browseMerchant>;
    act(() => { work = result.current.browseMerchant("merchant"); });
    rerender(travel(options));
    await act(async () => {
      complete({ merchantNpcId: "merchant", merchantName: "Obsolete", listings: [],
        currency: { id: "gold", name: "gold", symbol: "g", balance: 0 } });
      await work;
    });
    expect(result.current.activeMerchantCatalog).toBeNull();
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it("does not open a crafting prompt from a delayed room-specific catalog", async () => {
    const options = fixture();
    let complete!: (value: Awaited<ReturnType<MuddHttpClient["getCraftingCatalog"]>>) => void;
    vi.spyOn(options.client, "getCraftingCatalog").mockImplementation(() => new Promise((done) => { complete = done; }));
    const { result, rerender } = renderHook(useCommerceController, { initialProps: options });
    let work!: ReturnType<typeof result.current.craftingCommand>;
    act(() => { work = result.current.craftingCommand("Plank"); });
    rerender(travel(options));
    await act(async () => {
      complete({ skill: { level: 1, experienceHundredths: 0 }, atWorkbench: true,
        recipes: [{ recipeId: "plank", outputTypeId: "plank", outputLabel: "Plank", requiredLevel: 1,
          experience: 1, maxCraftable: 10 }] });
      await work;
    });
    expect(result.current.activeCraftingPrompt).toBeNull();
    expect(options.addEntry).not.toHaveBeenCalled();
  });
  it("discards an inventory inspection after leaving its room", async () => {
    const options = fixture();
    let complete!: (value: Awaited<ReturnType<MuddHttpClient["inspect"]>>) => void;
    vi.spyOn(options.client, "inspect").mockImplementation(() => new Promise((done) => { complete = done; }));
    const { result, rerender } = renderHook((props) => useInventoryController({
      ...props, announceNewQuestObjectives: vi.fn(), refreshAfterMutation: vi.fn(),
    }), { initialProps: options });
    const item = { id: "item", typeId: "item", label: "Item", description: "Description", questBound: false };
    let work!: ReturnType<typeof result.current.inspectCarriedItem>;
    act(() => { work = result.current.inspectCarriedItem(item); });
    rerender(travel(options));
    await act(async () => { complete({ id: "item", label: "Obsolete", description: "Old room" }); await work; });
    expect(result.current.inspectedCarriedItem).toBeUndefined();
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it('discards a pending board response when the readable association changes in the same room', async () => {
    const options = fixture();
    options.snapshot!.dailyActivities = { cycle: '2026-11-02',
      boards: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }], sources: [] };
    options.snapshot!.location!.objects = [{ id: 'notice', label: 'Board', description: 'Board',
      readable: true, takeable: false, readAction: { type: 'daily-board', boardId: 'one' } }];
    let complete!: (value: Awaited<ReturnType<MuddHttpClient['dailyBoard']>>) => void;
    vi.spyOn(options.client, 'dailyBoard').mockImplementation(() => new Promise((done) => { complete = done; }));
    const { result, rerender } = renderHook((props) => useDailyController({ ...props,
      worldInstanceId: 'world', refreshAfterMutation: vi.fn(), loadGame: vi.fn() }), { initialProps: options });
    let work!: ReturnType<typeof result.current.openDailyBoard>;
    act(() => { work = result.current.openDailyBoard('one'); });
    const changed = structuredClone(options.snapshot!);
    changed.location!.objects[0]!.readAction = { type: 'daily-board', boardId: 'two' };
    rerender({ ...options, snapshot: changed });
    await act(async () => { complete({ boardId: 'one', name: 'Obsolete', cycle: '2026-11-02',
      resetsAt: '2026-11-03T00:00:00.000Z', jobs: [] }); await work; });
    expect(result.current.displayedDailyBoard).toBeNull();
    expect(result.current.activeDailyBoardId).toBeUndefined();
    expect(options.addEntry).not.toHaveBeenCalled();
  });

  it("ignores a delayed daily board and its errors after room replacement", async () => {
    const options = fixture();
    options.snapshot = { ...options.snapshot!, dailyActivities: {
      cycle: "2026-11-02", boards: [{ id: "board", name: "Bulletin" }], sources: [],
    } };
    let reject!: (error: Error) => void;
    vi.spyOn(options.client, "dailyBoard").mockImplementation(() => new Promise((_, done) => { reject = done; }));
    const { result, rerender } = renderHook((props) => useDailyController({
      ...props, worldInstanceId: "world", refreshAfterMutation: vi.fn(), loadGame: vi.fn(),
    }), { initialProps: options });
    let work!: ReturnType<typeof result.current.openDailyBoard>;
    act(() => { work = result.current.openDailyBoard("board"); });
    rerender(travel(options));
    await act(async () => { reject(new Error("Old room failed")); await work; });
    expect(result.current.displayedDailyBoard).toBeNull();
    expect(result.current.dailyBoardError).toBe("");
    expect(result.current.dailyBoardLoading).toBe(false);
    expect(options.addEntry).not.toHaveBeenCalled();
  });

});
