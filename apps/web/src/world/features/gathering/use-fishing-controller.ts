import { useCallback } from "react";
import { MuddCommandError, MuddHttpError, type CommandResponse, type GameSnapshot } from "@mudd/client-sdk";
import type { GatheringControllerOptions } from "./types.js";
import { useGatheringRun } from "./use-gathering-run.js";

function select(snapshot: GameSnapshot) {
  const action = snapshot.character?.activeFishing;
  return action && action.locationId === snapshot.location?.locationId ? { id: action.castId, dueAt: Date.parse(action.startedAt) +
    (action.ticksCompleted + 1) * action.tickIntervalSeconds * 1000 } : undefined;
}
export function useFishingController({
  client, snapshot, pending, beginForeground, finishForeground, reconcileCommand,
  setSnapshot, setConnectionError, refreshGate, addEntry,
}: GatheringControllerOptions) {
  const { stop, capture, continueAction } = useGatheringRun(client, snapshot, {
    read: () => client.getGame(),
    select,
    advance: (current, id) => client.advanceFishingCast(current.character!.characterId, id, current.character!.revision),
    reconcile: async (current, result, accepts) => {
      const { snapshot: next } = await reconcileCommand(current, result, undefined, accepts);
      if (accepts()) setConnectionError("");
      return next;
    },
    apply: setSnapshot,
    gate: refreshGate,
    report: (error) => addEntry("error", error instanceof Error ? error.message : "The gathering action could not be advanced."),
    narrate: (response) => {
      const payload = response.events?.find((event) => event.type === "character.fishing_cast_advanced")?.payload;
      if (!payload || typeof payload !== "object" || !("status" in payload)) return;
      const outcome = payload as {
        status?: unknown;
        item?: { label?: unknown; fishCatch?: { lengthCm?: unknown; weightGrams?: unknown; rarity?: unknown } };
      };
      if (outcome.status === "caught" && outcome.item) {
        const fish = outcome.item;
        addEntry("narration", `You caught a ${typeof fish.label === "string" ? fish.label : "fish"}!`);
        if (typeof fish.fishCatch?.lengthCm === "number" && typeof fish.fishCatch?.weightGrams === "number") {
          const rarity = typeof fish.fishCatch.rarity === "string"
            ? `${fish.fishCatch.rarity.charAt(0).toLocaleUpperCase()}${fish.fishCatch.rarity.slice(1)} catch`
            : "Catch";
          addEntry("system", `${rarity}: ${fish.fishCatch.lengthCm} cm, ${fish.fishCatch.weightGrams} g.`);
        }
      } else if (outcome.status === "no-bite") {
        addEntry("narration", "No bites. You reel in your line.");
      } else if (outcome.status === "interrupted") {
        addEntry("narration", "Your fishing is interrupted. You reel in your line.");
      }

    },
  });
  const performFishingCast = useCallback(async (rodItemId: string) => {
    if (!snapshot?.character || pending) return;
    const accepts = capture();
    if (!accepts()) return;
    const execution = beginForeground("use");
    if (!execution) return;
    stop();
    try {
      const result = await client.startFishingCast(
        snapshot.character.characterId,
        rodItemId,
        snapshot.character.revision,
      );
      if (!accepts()) return;
      await reconcileCommand(snapshot, result, undefined, accepts);
      if (!accepts()) return;
      setConnectionError("");
      const stoppedChopping = result.events?.some((event) =>
        event.type === "character.woodcutting_action_advanced");
      const restartedFishing = result.events?.some((event) =>
        event.type === "character.fishing_cast_advanced");
      addEntry(
        "narration",
        stoppedChopping
          ? "You lower your axe, cast your line, and wait..."
          : restartedFishing
            ? "You reel in your line, cast again, and wait..."
            : "You cast your line and wait...",
      );
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot fish here.");
    } finally {
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground, capture, stop]);

  const cancelFishingCast = useCallback(async (castId: string) => {
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
      if (!character || character.activeFishing?.castId !== castId) {
        setSnapshot(current);
        return;
      }
      let response: CommandResponse;
      try {
        response = await client.cancelFishingCast(characterId, castId, character.revision);
      } catch (error) {
        if (!accepts()) return;
        if (!(error instanceof MuddCommandError && error.code === "VERSION_CONFLICT") &&
            !(error instanceof MuddHttpError && error.status === 409)) throw error;
        current = await client.getGame();
        if (!accepts()) return;
        character = current.character;
        if (!character || character.activeFishing?.castId !== castId) {
          setSnapshot(current);
          return;
        }
        response = await client.cancelFishingCast(characterId, castId, character.revision);
      }
      if (!accepts()) return;
      await reconcileCommand(current, response, undefined, accepts);
      if (!accepts()) return;
      setConnectionError("");
      addEntry("narration", "You reel in your line and stop fishing.");
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "The fishing cast could not be cancelled.");
      try {
        const recovered = await client.getGame();
        if (accepts()) setSnapshot(recovered);
      } catch {
        // Keep the persisted cast visible; the action can be retried after reconnecting.
      }
    } finally {
      finishForeground(execution);
    }
  }, [snapshot?.character?.characterId, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, setSnapshot, finishForeground, capture, stop]);


  return { performFishingCast, cancelFishingCast, continueAction,
    active: snapshot?.character?.activeFishing };
}
