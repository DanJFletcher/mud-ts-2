import { useCallback, useEffect } from "react";
import { MuddCommandError, MuddHttpError, type CommandResponse, type GameSnapshot } from "@mudd/client-sdk";
import type { GatheringControllerOptions } from "./types.js";
import { useGatheringRun } from "./use-gathering-run.js";

function select(snapshot: GameSnapshot) {
  const action = snapshot.character?.activeWoodcutting;
  return action && action.locationId === snapshot.location?.locationId ? { id: action.actionId, dueAt: Date.parse(action.startedAt) +
    (action.ticksCompleted + 1) * 1000 } : undefined;
}
export function useWoodcuttingController({
  client, snapshot, pending, beginForeground, finishForeground, reconcileCommand,
  setSnapshot, setConnectionError, refreshGate, addEntry,
}: GatheringControllerOptions) {
  const { stop, capture, continueAction } = useGatheringRun(client, snapshot, {
    read: () => client.getGame(),
    select,
    advance: (current, id) => client.advanceWoodcutting(current.character!.characterId, id, current.character!.revision),
    reconcile: async (current, result, accepts) => {
      const { snapshot: next } = await reconcileCommand(current, result, undefined, accepts);
      if (accepts()) setConnectionError("");
      return next;
    },
    apply: setSnapshot,
    gate: refreshGate,
    report: (error) => addEntry("error", error instanceof Error ? error.message : "The gathering action could not be advanced."),
    narrate: (response, before) => {
      const payload = response.events?.find((event) => event.type === "character.woodcutting_action_advanced")?.payload;
      const treeLabel = before.character?.activeWoodcutting?.treeLabel ?? "tree";
      if (!payload || typeof payload !== "object" || !("status" in payload)) return;
      const outcome = payload as {
        status?: unknown;
        logLabel?: unknown;
        skillExperienceAwarded?: unknown;
        totalExperience?: unknown;
        level?: unknown;
        treeDepleted?: unknown;
      };
      if (outcome.status === "logged") {
        const label = typeof outcome.logLabel === "string" ? outcome.logLabel : "logs";
        addEntry("narration", `You cut a bundle of ${label}.`);
        if (typeof outcome.skillExperienceAwarded === "number" &&
            typeof outcome.totalExperience === "number" && typeof outcome.level === "number") {
          addEntry("system", `Woodcutting +${outcome.skillExperienceAwarded} XP · Level ${outcome.level} · ${outcome.totalExperience} XP total.`);
        }
        if (outcome.treeDepleted === true) {
          addEntry("narration", `You cut down the ${treeLabel}; only a stump remains.`);
        }
      } else if (outcome.status === "no-log") {
        addEntry("narration", "You swing for ten seconds, but no logs come free.");
      } else if (outcome.status === "tree-depleted") {
        addEntry("narration", "Only a stump remains where the tree stood.");
      } else if (outcome.status === "interrupted") {
        addEntry("narration", "You stop chopping.");
      }

    },
  });
  const performWoodcuttingStart = useCallback(async (axeItemId: string, treeId: string) => {
    if (!snapshot?.character || pending) return;
    const accepts = capture();
    if (!accepts()) return;
    const execution = beginForeground("use");
    if (!execution) return;
    stop();
    try {
      const result = await client.startWoodcutting(
        snapshot.character.characterId,
        axeItemId,
        treeId,
        snapshot.character.revision,
      );
      if (!accepts()) return;
      await reconcileCommand(snapshot, result, undefined, accepts);
      if (!accepts()) return;
      setConnectionError("");
      const stoppedFishing = result.events?.some((event) =>
        event.type === "character.fishing_cast_advanced");
      const restartedChopping = result.events?.some((event) =>
        event.type === "character.woodcutting_action_advanced");
      addEntry(
        "narration",
        stoppedFishing
          ? "You reel in your line and begin swinging your axe at the tree..."
          : restartedChopping
            ? "You pause, then swing your axe at the tree again..."
            : "You begin swinging your axe at the tree...",
      );
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot chop that tree.");
    } finally {
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground, capture, stop]);

  const cancelWoodcuttingAction = useCallback(async (actionId: string) => {
    const characterId = snapshot?.character?.characterId;
    if (!characterId || pending) return;
    const accepts = capture();
    if (!accepts()) return;
    const execution = beginForeground("use");
    if (!execution) return;
    stop();
    try {
      let current = await client.getGame();
      if (!accepts()) return;
      let character = current.character;
      if (!character || character.activeWoodcutting?.actionId !== actionId) {
        setSnapshot(current);
        return;
      }
      let response: CommandResponse;
      try {
        response = await client.cancelWoodcutting(characterId, actionId, character.revision);
      } catch (error) {
        if (!accepts()) return;
        if (!(error instanceof MuddCommandError && error.code === "VERSION_CONFLICT") &&
            !(error instanceof MuddHttpError && error.status === 409)) throw error;
        current = await client.getGame();
        if (!accepts()) return;
        character = current.character;
        if (!character || character.activeWoodcutting?.actionId !== actionId) {
          setSnapshot(current);
          return;
        }
        response = await client.cancelWoodcutting(characterId, actionId, character.revision);
      }
      if (!accepts()) return;
      await reconcileCommand(current, response, undefined, accepts);
      if (!accepts()) return;
      setConnectionError("");
      addEntry("narration", "You lower your axe and stop chopping.");
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "The woodcutting action could not be cancelled.");
      try {
        const recovered = await client.getGame();
        if (accepts()) setSnapshot(recovered);
      } catch {
        // Keep the persisted action visible; it can be retried after reconnecting.
      }
    } finally {
      finishForeground(execution);
    }
  }, [snapshot?.character?.characterId, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, setSnapshot, finishForeground, capture, stop]);

  const actionId = snapshot?.character?.activeWoodcutting?.actionId;
  useEffect(() => {
    if (!actionId) return;
    const timer = window.setInterval(() => addEntry("narration", "Chop!"), 2_000);
    return () => window.clearInterval(timer);
  }, [actionId, addEntry]);

  return { performWoodcuttingStart, cancelWoodcuttingAction, continueAction,
    active: snapshot?.character?.activeWoodcutting };
}
