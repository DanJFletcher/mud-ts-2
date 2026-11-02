import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  const [snapshot, storeSnapshot] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, storeConnectionError] = useState("");
  const lifetime = useRef({ client, characterId: snapshot?.character?.characterId, active: true });
  const characterId = snapshot?.character?.characterId;
  if (lifetime.current.client !== client ||
      (characterId && lifetime.current.characterId && characterId !== lifetime.current.characterId)) {
    lifetime.current.active = false;
    lifetime.current = { client, characterId, active: true };
  } else if (characterId) lifetime.current.characterId = characterId;
  const owner = lifetime.current;
  useEffect(() => {
    owner.active = true;
    return () => { owner.active = false; };
  }, [owner]);
  const setSnapshot = useCallback<Dispatch<SetStateAction<GameSnapshot | null>>>((next) => {
    if (!owner.active) return;
    storeSnapshot((current) => owner.active
      ? typeof next === "function" ? next(current) : next
      : current);
  }, [owner]);
  const setConnectionError = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    if (owner.active) storeConnectionError(next);
  }, [owner]);
  const [presenceStale, setPresenceStale] = useState(false);
  const refreshGate = useMemo<ActionRefreshControls>(() => {
    const gate = new ActionRefreshGate();
    return {
      get busy() { return gate.busy; },
      begin: () => { if (owner.active) gate.begin(); },
      end: () => { if (owner.active) gate.end(); },
      capture: () => gate.capture(),
      accepts: (epoch) => owner.active && gate.accepts(epoch),
    };
  }, [owner]);
  const appliedCharacterRevisionRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    appliedCharacterRevisionRef.current = snapshot?.character?.revision;
  }, [snapshot?.character?.revision]);

  const loadGame = useCallback(async (): Promise<GameLoadResult> => {
    if (!owner.active) return { error: "This world session has ended." };
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
      if (owner.active) setLoading(false);
    }
  }, [client, owner, setSnapshot, setConnectionError]);

  const reconcileCommand = useCallback(async (
    base: GameSnapshot,
    response: CommandResponse,
    traceId?: string,
    accepts: () => boolean = () => true,
  ): Promise<CommandReconciliation> => {
    const projection = commandResultProjection(response, client.realtimeRevisionHint("character"));
    const nextSnapshot = projection
      ? { ...base, ...projection }
      : await client.getGame(traceId);
    if (accepts()) setSnapshot(nextSnapshot);
    return {
      snapshot: nextSnapshot,
      source: projection ? "command-response" : "snapshot-fallback",
    };
  }, [client, setSnapshot]);

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
        if (active && owner.active && refreshGate.accepts(epoch)) setPresenceStale(true);
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
  }, [client, presenceCharacterId, refreshGate, owner, setSnapshot]);

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
