import { traceFirstFeedbackPaint } from "../../session/action-feedback.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { MuddCommandError, MuddHttpError, type MuddHttpClient, type GameSnapshot } from "@mudd/client-sdk";
import type { ActivityEntry } from "@mudd/ui";
import type { useGameSession } from "../../session/use-game-session.js";
import type { ExecutionToken } from "../../session/foreground-execution.js";

type DestinationRoomPreview = NonNullable<
  NonNullable<GameSnapshot["location"]>["exits"][number]["destinationPreview"]
>;
type OptimisticTravel = Readonly<{
  commandId: string;
  exitId: string;
  fromLocationId: string;
  preview: DestinationRoomPreview;
  entryIds: readonly string[];
  roomDetailsEntryId?: string;
}>;

type Room = NonNullable<GameSnapshot["location"]>;
type LookPreview = Pick<Room, "locationId" | "title" | "description">;
type Fallback = { worldInstanceId: string; locationId: string; npcName: string; entryId: string; expiresAt: number };
type Session = ReturnType<typeof useGameSession>;

export interface TravelControllerOptions {
  client: MuddHttpClient;
  worldInstanceId: string;
  snapshot: GameSnapshot | null;
  pending: boolean;
  beginForeground(label: "move"): ExecutionToken | undefined;
  finishForeground(token: ExecutionToken, keepFeedback?: boolean): void;
  clearTravelFeedback(token: ExecutionToken | undefined): void;
  setPendingState(value: "move"): void;
  reconcileCommand: Session["reconcileCommand"];
  setSnapshot: Session["setSnapshot"];
  setConnectionError: Session["setConnectionError"];
  refreshTeamCombat(): Promise<Awaited<ReturnType<MuddHttpClient["getTeamCombatInfo"]>> | null>;
  announceNewQuestObjectives(snapshot: GameSnapshot): void;
  dismissRoomFeatures(): void;
  addDefaultLook(location: LookPreview | null | undefined): string[];
  addEntry(kind: ActivityEntry["kind"], text: string, preserveScroll?: boolean, locationId?: string): string;
  history: {
    remove(ids: readonly string[]): void; resetLook(locationId: string): void;
    beginOptimistic(owner: string): void; endOptimisticCreation(): void; settle(owner: string): void;
  };
  npcNarration: {
    wasAnnounced(name: string, locationId: string, now: number): boolean;
    recordFallback(fallback: Fallback): void;
  };
}

/** Owns a single travel operation and its optimistic reconciliation, until disposal. */
export function useTravelController({
  client, worldInstanceId, snapshot, pending, beginForeground, finishForeground,
  clearTravelFeedback, setPendingState, reconcileCommand, setSnapshot,
  setConnectionError, refreshTeamCombat, announceNewQuestObjectives, dismissRoomFeatures,
  addDefaultLook, addEntry, history, npcNarration,
}: TravelControllerOptions) {
  const [optimisticTravel, setOptimisticTravel] = useState<OptimisticTravel | null>(null);
  const optimisticTravelRef = useRef<OptimisticTravel | null>(null);
  const moveExecution = useRef<ExecutionToken | undefined>(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const rollbackOptimisticTravel = useCallback((commandId?: string) => {
    const travel = optimisticTravelRef.current;
    if (!travel || (commandId && travel.commandId !== commandId)) return;
    const optimisticEntryIds = new Set(travel.entryIds);
    history.remove([...optimisticEntryIds]);
    history.settle(travel.commandId);
    history.resetLook(travel.fromLocationId);
    optimisticTravelRef.current = null;
    setOptimisticTravel(null);
    clearTravelFeedback(moveExecution.current);
  }, [history, clearTravelFeedback]);
  const reconcileOptimisticTravel = useCallback((
    location: NonNullable<GameSnapshot["location"]>,
    commandId?: string,
  ) => {
    const travel = optimisticTravelRef.current;
    if (!travel || (commandId && travel.commandId !== commandId)) return false;

    if (location.locationId !== travel.preview.locationId) {
      rollbackOptimisticTravel(travel.commandId);
      addDefaultLook(location);
      return true;
    }

    const appendMissingNpcDepartures = () => {
      const now = Date.now();
      const actualNpcIds = new Set((location.npcs ?? []).map((npc) => npc.id));
      for (const npc of travel.preview.npcs ?? []) {
        if (!npc.mobile || actualNpcIds.has(npc.id)) continue;
        const wasAlreadyAnnounced = npcNarration.wasAnnounced(npc.name, location.locationId, now);
        if (wasAlreadyAnnounced) continue;
        const entryId = addEntry("narration", `${npc.name} leaves the room.`, false, location.locationId);
        npcNarration.recordFallback({
          worldInstanceId, locationId: location.locationId, npcName: npc.name,
          entryId, expiresAt: now + 30_000,
        });
      }
    };

    const optimisticDescription = travel.preview.description.trim();
    const authoritativeDescription = location.description.trim();
    let authoritativeRoomDetails: string;
    if (authoritativeDescription === optimisticDescription) {
      authoritativeRoomDetails = "";
    } else if (authoritativeDescription.startsWith(`${optimisticDescription}\n\n`)) {
      authoritativeRoomDetails = authoritativeDescription.slice(optimisticDescription.length).trim();
    } else {
      rollbackOptimisticTravel(travel.commandId);
      addDefaultLook(location);
      appendMissingNpcDepartures();
      return true;
    }

    const previewRoomDetails = travel.preview.roomDetails?.trim() ?? "";
    if (authoritativeRoomDetails !== previewRoomDetails) {
      if (travel.roomDetailsEntryId) {
        history.remove([travel.roomDetailsEntryId]);
      }
      if (authoritativeRoomDetails) {
        addEntry("narration", authoritativeRoomDetails, false, location.locationId);
      }
    }
    appendMissingNpcDepartures();
    history.settle(travel.commandId);

    optimisticTravelRef.current = null;
    setOptimisticTravel(null);
    clearTravelFeedback(moveExecution.current);
    return true;
  }, [history, npcNarration, addDefaultLook, addEntry, clearTravelFeedback, rollbackOptimisticTravel, worldInstanceId]);
  useEffect(() => {
    const travel = optimisticTravelRef.current;
    const location = snapshot?.location;
    if (
      travel &&
      location &&
      location.locationId !== travel.fromLocationId
    ) reconcileOptimisticTravel(location, travel.commandId);
  }, [reconcileOptimisticTravel, snapshot?.location]);

  const move = useCallback(async (exitId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const exit = snapshot.location.exits.find((item) => item.id === exitId);
    if (!exit?.available) {
      addEntry("error", "That way is not open from here.");
      return;
    }
    const execution = beginForeground("move");
    if (!execution) return;
    moveExecution.current = execution;
    const fromLocationId = snapshot.location.locationId;
    const existingOptimisticTravel = optimisticTravelRef.current;
    if (
      existingOptimisticTravel &&
      (existingOptimisticTravel.fromLocationId !== fromLocationId ||
        existingOptimisticTravel.exitId !== exit.id)
    ) { finishForeground(execution); return; }
    const characterId = snapshot.character.characterId;
    const retryAction = client.pendingActions.getSnapshot().filter((action) =>
      action.scope.worldInstanceId === worldInstanceId &&
      action.scope.characterId === characterId &&
      action.details.kind === "character.move" &&
      action.details.fromLocationId === fromLocationId &&
      action.details.exitId === exit.id &&
      (action.state === "uncertain" || action.state === "acknowledged")
    ).at(-1);
    const commandId = (retryAction?.id ?? crypto.randomUUID()) as ReturnType<Crypto["randomUUID"]>;
    const traceId = new URLSearchParams(window.location.search).get("muddTrace") === "1"
      ? crypto.randomUUID()
      : undefined;
    const actionStartedAt = performance.now();
    let snapshotReadyAt: number | undefined;
    let projectionSource: "command-response" | "snapshot-fallback" | undefined;
    const logMoveTrace = (outcome: "success" | "error" | "uncertain") => {
      if (!traceId) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const paintedAt = performance.now();
        console.info("[mudd_perf_trace_action]", JSON.stringify({
          traceId,
          action: exit.roadId ? "character.road.step" : "character.move",
          outcome,
          commandAndProjectionMs: snapshotReadyAt === undefined
            ? null
            : Math.round((snapshotReadyAt - actionStartedAt) * 10) / 10,
          projectionSource: projectionSource ?? null,
          projectionToPaintMs: snapshotReadyAt === undefined
            ? null
            : Math.round((paintedAt - snapshotReadyAt) * 10) / 10,
          actionToPaintMs: Math.round((paintedAt - actionStartedAt) * 10) / 10,
        }));
      }));
    };
    client.pendingActions.begin({
      id: commandId,
      scope: { worldInstanceId, characterId, roomId: fromLocationId },
      details: retryAction?.details ?? {
        kind: "character.move",
        fromLocationId,
        exitId: exit.id,
        direction: exit.direction || exit.label,
      },
    });
    if (exit.destinationPreview && !existingOptimisticTravel) {
      history.beginOptimistic(commandId);
      const entryIds = addDefaultLook(exit.destinationPreview);
      const roomDetails = exit.destinationPreview.roomDetails?.trim();
      const roomDetailsEntryId = roomDetails
        ? addEntry("narration", roomDetails, false, exit.destinationPreview.locationId)
        : undefined;
      if (roomDetailsEntryId) entryIds.push(roomDetailsEntryId);
      history.endOptimisticCreation();
      const travel: OptimisticTravel = {
        commandId,
        exitId: exit.id,
        fromLocationId,
        preview: exit.destinationPreview,
        entryIds,
        ...(roomDetailsEntryId ? { roomDetailsEntryId } : {}),
      };
      optimisticTravelRef.current = travel;
      setOptimisticTravel(travel);
    }
    traceFirstFeedbackPaint(traceId, "character.move", actionStartedAt);
    let commandAccepted = false;
    try {
      const response = exit.roadId
        ? await client.roadStep(
            snapshot.character.characterId,
            exit.id,
            snapshot.location.revision,
            commandId,
            traceId,
            fromLocationId,
          )
        : await client.move(
            snapshot.character.characterId,
            exit.id,
            snapshot.location.revision,
            commandId,
            traceId,
            fromLocationId,
          );
      if (!active.current) return;
      client.pendingActions.acknowledge(commandId);
      commandAccepted = true;
      const partyAmbush = response.events?.some((event) => event.type === "team.road_encounter_started");
      const reconciliation = await reconcileCommand(snapshot, response, traceId);
      if (!active.current) return;
      const nextSnapshot = reconciliation.snapshot;
      projectionSource = reconciliation.source;
      snapshotReadyAt = traceId ? performance.now() : undefined;
      setConnectionError("");
      if (nextSnapshot.location?.locationId !== fromLocationId) {
        const stoppedFishing = response.events?.some((event) =>
          event.type === "character.fishing_cast_advanced");
        const stoppedChopping = response.events?.some((event) =>
          event.type === "character.woodcutting_action_advanced");
        if (stoppedFishing) addEntry("narration", "You reel in your line before moving on.");
        if (stoppedChopping) addEntry("narration", "You lower your axe before moving on.");
        const reconciled = nextSnapshot.location
          ? reconcileOptimisticTravel(nextSnapshot.location, commandId)
          : false;
        if (!reconciled) addDefaultLook(nextSnapshot.location);
        announceNewQuestObjectives(nextSnapshot);
        const currentAction = client.pendingActions.getSnapshot().find((action) => action.id === commandId);
        if (currentAction?.state !== "confirmed") {
          client.pendingActions.confirm(commandId);
          if (partyAmbush) addEntry("system", "A roadside ambush interrupts your travel.");
        }
        if (partyAmbush) {
          const nextTeamInfo = await refreshTeamCombat();
          if (!active.current) return;
          if (nextTeamInfo?.encounter) {
            addEntry("narration", `${nextTeamInfo.encounter.lastNarration} Round ${nextTeamInfo.encounter.round}.`);
          }
        } else if (response.events?.some((event) => event.type === "character.combat_encounter_started")) {
          addEntry("narration", nextSnapshot.character?.combat?.lastNarration ?? "A roadside opponent blocks your way.");
        }
        dismissRoomFeatures();
        logMoveTrace("success");
      } else {
        client.pendingActions.markUncertain(commandId, "Awaiting the authoritative room update.");
        logMoveTrace("uncertain");
      }
    } catch (error) {
      if (!active.current) return;
      const message = error instanceof Error ? error.message : "Unable to move.";
      if (error instanceof MuddCommandError && error.code === "VERSION_CONFLICT" && !commandAccepted) {
        client.pendingActions.clearWhere((action) => action.id === commandId);
        try {
          const refreshed = await client.getGame(traceId);
          if (!active.current) return;
          setSnapshot(refreshed);
          setConnectionError("");
          const actualLocation = refreshed.location;
          if (
            actualLocation &&
            exit.destinationPreview &&
            actualLocation.locationId === exit.destinationPreview.locationId
          ) {
            const reconciled = reconcileOptimisticTravel(actualLocation, commandId);
            if (!reconciled) addDefaultLook(actualLocation);
          } else {
            rollbackOptimisticTravel(commandId);
            if (actualLocation && actualLocation.locationId !== fromLocationId) {
              addDefaultLook(actualLocation);
            }
          }
          if (actualLocation && actualLocation.locationId !== fromLocationId) {
            announceNewQuestObjectives(refreshed);
            dismissRoomFeatures();
          }
          logMoveTrace("error");
        } catch {
          if (!active.current) return;
          rollbackOptimisticTravel(commandId);
          logMoveTrace("uncertain");
        }
      } else if (isRejectedAction(error) && !commandAccepted) {
        client.pendingActions.reject(commandId, message);
        rollbackOptimisticTravel(commandId);
        addEntry("error", message);
        logMoveTrace("error");
      } else {
        client.pendingActions.markUncertain(commandId, "Awaiting the authoritative room update.");
        if (!commandAccepted) rollbackOptimisticTravel(commandId);
        logMoveTrace("uncertain");
      }
    } finally {
      if (active.current && optimisticTravelRef.current?.commandId === commandId) {
        // Let realtime and fallback snapshots reconcile the optimistic room while
        // keeping other actions locked against the still-authoritative source room.
        finishForeground(execution, true);
        setPendingState("move");
      } else if (active.current) {
        finishForeground(execution);
      }
    }
  }, [snapshot, pending, beginForeground, client, worldInstanceId, addEntry,
    finishForeground, addDefaultLook, reconcileCommand, setConnectionError,
    reconcileOptimisticTravel, announceNewQuestObjectives, dismissRoomFeatures,
    refreshTeamCombat, setSnapshot, setPendingState, rollbackOptimisticTravel, history]);

  return { optimisticTravel, move };
}

function isRejectedAction(error: unknown): boolean {
  return error instanceof MuddCommandError ||
    (error instanceof MuddHttpError && error.status >= 400 && error.status < 500);
}
