import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GameSnapshotSchema,
  MuddHttpClient,
  type CommandResponse,
  type GameSnapshot,
} from "@mudd/client-sdk";
import { ActionRefreshGate } from "./action-refresh-gate.js";
import { commandResultProjection } from "./command-projection.js";

type RoomPresenceProjection = Awaited<ReturnType<MuddHttpClient["heartbeatWorldSession"]>>;
type GameSessionClient = Pick<
  MuddHttpClient,
  | "getGame"
  | "heartbeatWorldSession"
  | "realtimeConnectionState"
  | "realtimeRevisionHint"
  | "watchRealtime"
>;

type GameLoadResult =
  | { snapshot: GameSnapshot }
  | { error: string };

type CommandReconciliation = {
  snapshot: GameSnapshot;
  source: "command-response" | "snapshot-fallback";
};

type ActionRefreshControls = {
  readonly busy: boolean;
  begin(): void;
  end(): void;
  capture(): number;
  accepts(epoch: number): boolean;
};

export function useGameSession(client: GameSessionClient) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [presenceStale, setPresenceStale] = useState(false);
  const actionRefreshGateRef = useRef(new ActionRefreshGate());
  const refreshGate = useMemo<ActionRefreshControls>(() => ({
    get busy() { return actionRefreshGateRef.current.busy; },
    begin: () => actionRefreshGateRef.current.begin(),
    end: () => actionRefreshGateRef.current.end(),
    capture: () => actionRefreshGateRef.current.capture(),
    accepts: (epoch) => actionRefreshGateRef.current.accepts(epoch),
  }), []);
  const appliedCharacterRevisionRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    appliedCharacterRevisionRef.current = snapshot?.character?.revision;
  }, [snapshot?.character?.revision]);

  const loadGame = useCallback(async (): Promise<GameLoadResult> => {
    setLoading(true);
    setConnectionError("");
    try {
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      return { snapshot: nextSnapshot };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The world could not be reached.";
      setConnectionError(message);
      return { error: message };
    } finally {
      setLoading(false);
    }
  }, [client]);

  const reconcileCommand = useCallback(async (
    base: GameSnapshot,
    response: CommandResponse,
    traceId?: string,
  ): Promise<CommandReconciliation> => {
    const projection = commandResultProjection(response, client.realtimeRevisionHint("character"));
    const nextSnapshot = projection
      ? { ...base, ...projection }
      : await client.getGame(traceId);
    setSnapshot(nextSnapshot);
    return {
      snapshot: nextSnapshot,
      source: projection ? "command-response" : "snapshot-fallback",
    };
  }, [client]);

  const presenceCharacterId = snapshot?.character &&
    snapshot.character.health?.current !== 0 &&
    snapshot.character.combat?.status !== "defeat"
    ? snapshot.character.characterId
    : null;

  useEffect(() => {
    if (!presenceCharacterId) {
      setPresenceStale(false);
      return;
    }

    let active = true;
    let requestRunning = false;
    const sendHeartbeat = async () => {
      if (!active || document.visibilityState === "hidden" || requestRunning || refreshGate.busy) return;
      const epoch = refreshGate.capture();
      requestRunning = true;
      try {
        const presence = await client.heartbeatWorldSession();
        if (!active || !refreshGate.accepts(epoch)) return;
        setSnapshot((current) => applyRoomPresence(current, presence));
        setPresenceStale(false);
      } catch {
        if (active) setPresenceStale(true);
      } finally {
        requestRunning = false;
      }
    };
    let snapshotRefreshRunning = false;
    const refreshSnapshot = async () => {
      if (!active || document.visibilityState === "hidden" || snapshotRefreshRunning || refreshGate.busy) return;
      const epoch = refreshGate.capture();
      snapshotRefreshRunning = true;
      try {
        const latest = GameSnapshotSchema.parse(await client.getGame());
        if (active && refreshGate.accepts(epoch)) {
          setSnapshot((current) => preserveCurrentRoomOccupants(current, latest));
        }
      } catch {
        // Keep the last known snapshot; heartbeat owns connection health.
      } finally {
        snapshotRefreshRunning = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
        void refreshSnapshot();
      }
    };

    void sendHeartbeat();
    const interval = window.setInterval(() => void sendHeartbeat(), 30_000);
    const snapshotFallback = window.setInterval(() => {
      if (client.realtimeConnectionState !== "connected") void refreshSnapshot();
    }, 15_000);
    const stopPresence = client.watchRealtime(
      "presence",
      sendHeartbeat,
      3_000,
      () => !refreshGate.busy,
    );
    let skipInitialCharacterRefresh = true;
    const refreshSnapshotForCharacterChange = () => {
      if (skipInitialCharacterRefresh) {
        skipInitialCharacterRefresh = false;
        return;
      }
      const hinted = client.realtimeRevisionHint("character");
      const applied = appliedCharacterRevisionRef.current;
      if (hinted !== undefined && applied !== undefined && hinted <= applied) return;
      return refreshSnapshot();
    };
    const stopSnapshot = client.watchRealtime(
      "character",
      refreshSnapshotForCharacterChange,
      15_000,
      () => !refreshGate.busy,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearInterval(snapshotFallback);
      stopPresence();
      stopSnapshot();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
    };
  }, [client, presenceCharacterId, refreshGate]);

  return {
    snapshot,
    setSnapshot,
    loading,
    connectionError,
    setConnectionError,
    loadGame,
    reconcileCommand,
    presenceStale,
    refreshGate,
  };
}

function applyRoomPresence(
  current: GameSnapshot | null,
  presence: RoomPresenceProjection,
): GameSnapshot | null {
  const location = current?.location;
  if (
    !current ||
    !location ||
    presence.worldInstanceId !== location.worldInstanceId ||
    presence.locationId !== location.locationId
  ) return current;
  return { ...current, location: { ...location, occupants: presence.occupants } };
}

function preserveCurrentRoomOccupants(
  current: GameSnapshot | null,
  latest: GameSnapshot,
): GameSnapshot {
  const previousLocation = current?.location;
  if (
    previousLocation &&
    latest.location &&
    previousLocation.worldInstanceId === latest.location.worldInstanceId &&
    previousLocation.locationId === latest.location.locationId
  ) {
    return { ...latest, location: { ...latest.location, occupants: previousLocation.occupants } };
  }
  return latest;
}
