import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  GameSnapshotSchema,
  type CommandResponse,
  type GameSnapshot,
} from "@mudd/client-sdk";
import { useGameSession } from "./use-game-session.js";

type SessionClient = Parameters<typeof useGameSession>[0];
type RealtimeChannel = Parameters<SessionClient["watchRealtime"]>[0];
type RealtimeCallback = Parameters<SessionClient["watchRealtime"]>[1];

function createSnapshot(occupants: Array<{ id: string; displayName: string }> = []): GameSnapshot {
  return GameSnapshotSchema.parse({
    player: { id: "player-one", displayName: "Player" },
    character: {
      characterId: "character-one",
      worldInstanceId: "world-one",
      name: "Arin",
      locationId: "room-one",
      revision: 1,
      health: { current: 10, maximum: 10 },
    },
    location: {
      worldInstanceId: "world-one",
      locationId: "room-one",
      revision: 1,
      title: "Test room",
      shortName: "Test room",
      qualifiedName: "Test room",
      locationGroups: [],
      description: "A test room.",
      exits: [],
      objects: [],
      occupants,
    },
  });
}

function createClient(getGame: () => Promise<GameSnapshot>, revisionHint?: number) {
  const watchers = new Map<RealtimeChannel, RealtimeCallback>();
  const client: SessionClient = {
    getGame,
    heartbeatWorldSession: vi.fn().mockRejectedValue(new Error("Heartbeat unavailable.")),
    get realtimeConnectionState(): "polling" { return "polling"; },
    realtimeRevisionHint: vi.fn(() => revisionHint),
    watchRealtime: (channel, callback) => {
      watchers.set(channel, callback);
      return () => watchers.delete(channel);
    },
  };
  return { client, watchers };
}

function responseWithProjection(revision: number): CommandResponse {
  return {
    receipt: { ok: true, commandId: "command-one", eventIds: [], newAggregateVersion: 2 },
    gameProjection: { character: { revision } } as NonNullable<CommandResponse["gameProjection"]>,
  };
}

describe("useGameSession", () => {
  it("loads and stores the initial game snapshot", async () => {
    const snapshot = createSnapshot();
    const getGame = vi.fn().mockResolvedValue(snapshot);
    const { client } = createClient(getGame);
    const { result } = renderHook(() => useGameSession(client));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      const loadResult = await result.current.loadGame();
      expect(loadResult).toEqual({ snapshot });
    });

    expect(getGame).toHaveBeenCalledOnce();
    expect(result.current.snapshot).toBe(snapshot);
    expect(result.current.loading).toBe(false);
    expect(result.current.connectionError).toBe("");
  });

  it("surfaces load errors and ends the loading state", async () => {
    const getGame = vi.fn().mockRejectedValue(new Error("World unavailable."));
    const { client } = createClient(getGame);
    const { result } = renderHook(() => useGameSession(client));

    await act(async () => {
      const loadResult = await result.current.loadGame();
      expect(loadResult).toEqual({ error: "World unavailable." });
    });

    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.connectionError).toBe("World unavailable.");
  });

  it("uses a safe message when the load rejects with a non-Error value", async () => {
    const getGame = vi.fn().mockRejectedValue("unavailable");
    const { client } = createClient(getGame);
    const { result } = renderHook(() => useGameSession(client));

    await act(async () => {
      const loadResult = await result.current.loadGame();
      expect(loadResult).toEqual({ error: "The world could not be reached." });
    });

    expect(result.current.connectionError).toBe("The world could not be reached.");
    expect(result.current.loading).toBe(false);
  });

  it("rejects a background snapshot that crosses a foreground action", async () => {
    const currentSnapshot = createSnapshot();
    const nextSnapshot = createSnapshot();
    const getGame = vi.fn()
      .mockResolvedValueOnce(currentSnapshot)
      .mockResolvedValueOnce(nextSnapshot);
    const { client, watchers } = createClient(getGame);
    const { result } = renderHook(() => useGameSession(client));
    await act(async () => { await result.current.loadGame(); });

    await act(async () => {
      await watchers.get("character")?.();
    });

    await act(async () => {
      const refresh = watchers.get("character")?.();
      result.current.refreshGate.begin();
      await refresh;
      result.current.refreshGate.end();
    });

    expect(getGame).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot).toBe(currentSnapshot);
  });

  it("retains the current room occupants when a same-room snapshot refreshes", async () => {
    const currentSnapshot = createSnapshot([{ id: "player-two", displayName: "Mira" }]);
    const refreshedSnapshot = GameSnapshotSchema.parse({
      ...createSnapshot(),
      location: {
        ...createSnapshot().location,
        revision: 2,
        occupants: [],
      },
    });
    const getGame = vi.fn()
      .mockResolvedValueOnce(currentSnapshot)
      .mockResolvedValueOnce(refreshedSnapshot);
    const { client, watchers } = createClient(getGame);
    const { result } = renderHook(() => useGameSession(client));
    await act(async () => { await result.current.loadGame(); });

    await act(async () => {
      await watchers.get("character")?.();
    });

    expect(result.current.snapshot?.location?.occupants).toEqual([
      { id: "player-two", displayName: "Mira" },
    ]);
  });

  it("applies a command projection when it is not older than the realtime revision hint", async () => {
    const base = createSnapshot();
    const getGame = vi.fn().mockResolvedValue(base);
    const { client } = createClient(getGame, 2);
    const { result } = renderHook(() => useGameSession(client));

    let reconciliation: Awaited<ReturnType<typeof result.current.reconcileCommand>> | undefined;
    await act(async () => {
      reconciliation = await result.current.reconcileCommand(base, responseWithProjection(2));
    });

    expect(reconciliation?.source).toBe("command-response");
    expect(reconciliation?.snapshot.character?.revision).toBe(2);
    expect(getGame).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBe(reconciliation?.snapshot);
  });

  it("fetches an authoritative snapshot when a command projection is stale", async () => {
    const base = createSnapshot();
    const authoritativeSnapshot = createSnapshot();
    const getGame = vi.fn().mockResolvedValue(authoritativeSnapshot);
    const { client } = createClient(getGame, 3);
    const { result } = renderHook(() => useGameSession(client));

    let reconciliation: Awaited<ReturnType<typeof result.current.reconcileCommand>> | undefined;
    await act(async () => {
      reconciliation = await result.current.reconcileCommand(base, responseWithProjection(2));
    });

    expect(reconciliation).toEqual({
      snapshot: authoritativeSnapshot,
      source: "snapshot-fallback",
    });
    expect(getGame).toHaveBeenCalledOnce();
    expect(result.current.snapshot).toBe(authoritativeSnapshot);
  });
});
