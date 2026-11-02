import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSnapshotSchema, MuddHttpClient, type CommandResponse } from "@mudd/client-sdk";
import { useFishingController } from "./use-fishing-controller.js";
import { useWoodcuttingController } from "./use-woodcutting-controller.js";
import type { GatheringControllerOptions } from "./types.js";
import { ActionRefreshGate } from "../../action-refresh-gate.js";

function snapshot() {
  return GameSnapshotSchema.parse({
    player: { id: "player", displayName: "Player" },
    character: {
      characterId: "character", worldInstanceId: "world", name: "Arin",
      locationId: "room", revision: 1,
      activeFishing: {
        castId: "cast", spotId: "spot", locationId: "room", rodItemId: "rod", rodQualityId: "old",
        startedAt: new Date(Date.now() - 10000).toISOString(),
        tickIntervalSeconds: 1, ticksRequired: 10, ticksCompleted: 0,
      },
      activeWoodcutting: {
        actionId: "chop", treeId: "tree", treeLabel: "Pine", locationId: "room", axeItemId: "axe",
        startedAt: new Date(Date.now() - 10000).toISOString(), ticksRequired: 10, ticksCompleted: 0,
      },
    },
    location: {
      worldInstanceId: "world", locationId: "room", revision: 1, title: "Room",
      shortName: "Room", qualifiedName: "Room", locationGroups: [], description: "A room.",
      objects: [], occupants: [], exits: [],
    },
  });
}
const response: CommandResponse = {
  receipt: { ok: true, commandId: "command", eventIds: [], newAggregateVersion: 2 },
};
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("gathering feature controllers", () => {
  it.each(["fishing", "woodcutting"] as const)("invalidates an in-flight %s advance immediately on cancellation", async (feature) => {
    vi.useFakeTimers();
    const current = snapshot();
    const client = new MuddHttpClient({ worldInstanceId: "world" });
    vi.spyOn(client, "getGame").mockResolvedValue(current);
    let resolve!: (value: CommandResponse) => void;
    const method = feature === "fishing" ? "advanceFishingCast" : "advanceWoodcutting";
    const advance = vi.spyOn(client, method).mockImplementation(() =>
      new Promise<CommandResponse>((done) => { resolve = done; }));
    vi.spyOn(client, "cancelFishingCast").mockResolvedValue(response);
    vi.spyOn(client, "cancelWoodcutting").mockResolvedValue(response);
    const reconcileCommand = vi.fn(async () => ({ snapshot: current, source: "command-response" as const }));
    const options: GatheringControllerOptions = {
      client, snapshot: current, pending: false, refreshGate: new ActionRefreshGate(),
      beginForeground: () => ({ id: Symbol(), label: "use" }), finishForeground: vi.fn(),
      setSnapshot: vi.fn(), setConnectionError: vi.fn(), addEntry: vi.fn(() => "entry"),
      reconcileCommand,
    };
    const useController = feature === "fishing" ? useFishingController : useWoodcuttingController;
    const { result, unmount } = renderHook(() => useController(options));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(advance).toHaveBeenCalledOnce();
    await act(async () => {
      if ("cancelFishingCast" in result.current) await result.current.cancelFishingCast("cast");
      else await result.current.cancelWoodcuttingAction("chop");
    });
    expect(reconcileCommand).toHaveBeenCalledOnce(); // cancellation only
    await act(async () => { resolve(response); await vi.advanceTimersByTimeAsync(3000); });
    expect(reconcileCommand).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledOnce();
    expect(options.addEntry).not.toHaveBeenCalledWith("narration", expect.stringContaining("caught"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["fishing", "woodcutting"] as const)("disposes a scheduled %s retry on unmount and re-entry", async (feature) => {
    vi.useFakeTimers();
    const current = snapshot();
    const client = new MuddHttpClient({ worldInstanceId: "world" });
    const read = vi.spyOn(client, "getGame").mockResolvedValue(current);
    const options: GatheringControllerOptions = {
      client, snapshot: current, pending: false, refreshGate: new ActionRefreshGate(),
      beginForeground: () => undefined, finishForeground: vi.fn(),
      setSnapshot: vi.fn(), setConnectionError: vi.fn(), addEntry: vi.fn(() => "entry"),
      reconcileCommand: vi.fn(),
    };
    const useController = feature === "fishing" ? useFishingController : useWoodcuttingController;
    const old = renderHook(() => useController(options));
    old.unmount();
    const nextClient = new MuddHttpClient({ worldInstanceId: "next-world" });
    const next = renderHook(() => useController({ ...options, client: nextClient, snapshot: null }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(read).not.toHaveBeenCalled();
    next.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
