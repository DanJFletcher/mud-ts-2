import type { EntityRef } from "../../commands/intents.js";
import { useCallback, useState } from "react";
import type { MuddHttpClient, GameSnapshot } from "@mudd/client-sdk";
import { characterHasEquippedItem, type EquipmentSlot } from "@mudd/contracts";
import { findObjectMatches, findNpcMatches } from "../../commands/targets.js";
import { type ControllerOptions, roomContext } from "../controller-options.js";
import { useRequestScope } from "../session/use-request-scope.js";
import type { MutationRefresh } from "../daily/use-daily-controller.js";

export function useInventoryController({
  client, snapshot, pending, beginForeground, finishForeground, reconcileCommand,
  setSnapshot, setConnectionError, refreshGate, addEntry, announceNewQuestObjectives,
  refreshAfterMutation,
}: ControllerOptions & { announceNewQuestObjectives(snapshot: GameSnapshot): void; refreshAfterMutation: MutationRefresh }) {
  const scope = useRequestScope(roomContext(snapshot), refreshGate, client);
  const [inspectedCarriedItem, setInspectedCarriedItem] = useState<Awaited<ReturnType<MuddHttpClient["inspect"]>>>();
  const [inventoryInspectError, setInventoryInspectError] = useState("");
  const inspect = useCallback(async (target?: string, selected?: EntityRef) => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground("look");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const location = await client.look(
        snapshot.character.characterId,
        undefined,
        { includeNpcDescriptions: true },
      );
      if (!accepts()) return;
      setSnapshot((current) => current ? { ...current, location } : current);
      if (!target) {
        addEntry("location", location.title);
        addEntry("narration", location.description);
        return;
      }
      const npcMatches = selected
        ? selected.kind === "npc" ? (location.npcs ?? []).filter((npc) => npc.id === selected.id) : []
        : findNpcMatches(target, location.npcs ?? []);
      if (npcMatches.length === 1) {
        const description = npcMatches[0]!.description;
        if (!description) {
          addEntry("error", `You cannot get a clear look at ${npcMatches[0]!.name} right now.`);
          return;
        }
        addEntry("narration", description);
        return;
      }
      if (npcMatches.length > 1) {
        addEntry("error", `Which one do you mean: ${npcMatches.map((npc) => npc.name).join(", ")}?`);
        return;
      }
      const inventoryObjects = (snapshot.character.inventory ?? []).map((item) => ({
        ...item,
        readable: false,
        takeable: true,
      }));
      const matches = selected
        ? (selected.kind === "inventory" ? inventoryObjects : location.objects).filter((item) => item.id === selected.id)
        : findObjectMatches(target, [...location.objects, ...inventoryObjects]);
      if (matches.length === 0) {
        addEntry("error", `You do not see anything called “${target}” here.`);
      } else if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((object) => object.label).join(", ")}?`);
      } else {
        const object = await client.inspect(snapshot.character.characterId, matches[0]!.id);
      if (!accepts()) return;
        addEntry("narration", object.description);
      }
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot get a clear look just now.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, setSnapshot, snapshot?.character, scope]);

  const inspectCarriedItem = useCallback(async (item: NonNullable<GameSnapshot["character"]>["inventory"][number]) => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground("look");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    setInventoryInspectError("");
    try {
      const inspected = await client.inspect(snapshot.character.characterId, item.id);
      if (!accepts()) return;
      setInspectedCarriedItem(inspected);
    } catch (error) {
      if (!accepts()) return;
      setInventoryInspectError(error instanceof Error ? error.message : "You cannot inspect that item just now.");
    } finally {
      finishForeground(execution);
    }
  }, [beginForeground, client, finishForeground, pending, snapshot?.character, scope]);

  const readObject = useCallback(async (objectId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const execution = beginForeground("read");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const readable = await client.read(
        snapshot.character.characterId,
        objectId,
        snapshot.location.revision,
      );
      if (!accepts()) return;
      const nextSnapshot = await client.getGame();
      if (!accepts()) return;
      setSnapshot(nextSnapshot);
      setConnectionError("");
      addEntry("narration", readable.text);
      announceNewQuestObjectives(nextSnapshot);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot read that just now.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, announceNewQuestObjectives, beginForeground, client, finishForeground, pending, setConnectionError, setSnapshot, snapshot?.character, snapshot?.location, scope]);

  const takeObject = useCallback(async (itemId: string, label: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const execution = beginForeground("take");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.take(snapshot.character.characterId, itemId, snapshot.location.revision);
      if (!accepts()) return;
      await refreshAfterMutation(`You pick up the ${label.toLocaleLowerCase()}.`, { base: snapshot, response }, false, undefined, accepts);
      if (!accepts()) return;
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot take that item just now.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, refreshAfterMutation, snapshot, scope]);

  const extinguishCampfire = useCallback(async (campfireId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const execution = beginForeground("use");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.extinguishCampfire(
        snapshot.character.characterId,
        campfireId,
        snapshot.character.revision,
      );
      if (!accepts()) return;
      await refreshAfterMutation("You extinguish the campfire.", { base: snapshot, response }, false, undefined, accepts);
      if (!accepts()) return;
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot extinguish that campfire.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, refreshAfterMutation, snapshot, scope]);

  const takeAllObjects = useCallback(async () => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground("take");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      let latestSnapshot = await client.getGame();
      if (!accepts()) return;
      let takenCount = 0;
      const initialTakeables = (latestSnapshot.location?.objects ?? []).filter((object) => object.takeable);
      if (!initialTakeables.length) {
        addEntry("error", "There is nothing here you can take.");
        return;
      }

      for (const item of initialTakeables) {
        const location = latestSnapshot.location;
        if (!location || !location.objects.some((object) => object.id === item.id && object.takeable)) continue;
        const response = await client.take(snapshot.character.characterId, item.id, location.revision);
      if (!accepts()) return;
        latestSnapshot = (await reconcileCommand(latestSnapshot, response, undefined, accepts)).snapshot;
      if (!accepts()) return;
        setConnectionError("");
        addEntry("narration", `You pick up the ${item.label.toLocaleLowerCase()}.`);
        takenCount += 1;
      }

      if (!takenCount) addEntry("error", "There is nothing here you can take.");
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot take those items just now.");
      try {
        const currentSnapshot = await client.getGame();
      if (!accepts()) return;
        setSnapshot(currentSnapshot);
        setConnectionError("");
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "The world could not be reached.";
        setConnectionError(message);
        addEntry("error", message);
      }
    } finally {
      finishForeground(execution);
    }
  }, [snapshot?.character, pending, beginForeground, client, addEntry, reconcileCommand, setConnectionError, setSnapshot, finishForeground, scope]);

  const lootCorpse = useCallback(async (corpseId: string, corpseLabel: string) => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground("take");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      let latestSnapshot = await client.getGame();
      if (!accepts()) return;
      setSnapshot(latestSnapshot);
      setConnectionError("");
      const location = latestSnapshot.location;
      const corpse = location?.objects.find((object) =>
        object.id === corpseId && object.containerKind === "corpse",
      );
      if (!location || !corpse) {
        addEntry("error", `You do not see the ${corpseLabel.toLocaleLowerCase()} here.`);
        return;
      }

      const initialContents = location.objects.filter((object) =>
        object.containerId === corpse.id && object.takeable,
      );
      if (!initialContents.length) {
        addEntry("narration", `The ${corpse.label.toLocaleLowerCase()} has nothing left to loot.`);
        return;
      }

      let takenCount = 0;
      for (const item of initialContents) {
        const currentLocation = latestSnapshot.location;
        if (!currentLocation?.objects.some((object) =>
          object.id === item.id &&
          object.containerId === corpse.id &&
          object.takeable,
        )) continue;

        const response = await client.take(snapshot.character.characterId, item.id, currentLocation.revision);
      if (!accepts()) return;
        latestSnapshot = (await reconcileCommand(latestSnapshot, response, undefined, accepts)).snapshot;
      if (!accepts()) return;
        setConnectionError("");
        addEntry("narration", `You pick up the ${item.label.toLocaleLowerCase()}.`);
        takenCount += 1;
      }

      if (!takenCount) addEntry("narration", `The ${corpse.label.toLocaleLowerCase()} has nothing left to loot.`);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot loot that corpse just now.");
      try {
        const currentSnapshot = await client.getGame();
      if (!accepts()) return;
        setSnapshot(currentSnapshot);
        setConnectionError("");
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : "The world could not be reached.";
        setConnectionError(message);
        addEntry("error", message);
      }
    } finally {
      finishForeground(execution);
    }
  }, [snapshot?.character, pending, beginForeground, client, setSnapshot, setConnectionError, addEntry, reconcileCommand, finishForeground, scope]);

  const dropObject = useCallback(async (itemId: string, label: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    if (snapshot.character.inventory.find((item) => item.id === itemId)?.questBound) {
      addEntry("error", "Quest items cannot be dropped.");
      return;
    }
    const execution = beginForeground("drop");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.drop(snapshot.character.characterId, itemId, snapshot.location.revision);
      if (!accepts()) return;
      await refreshAfterMutation(`You put down the ${label.toLocaleLowerCase()}.`, { base: snapshot, response }, false, undefined, accepts);
      if (!accepts()) return;
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot drop that item just now.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, refreshAfterMutation, snapshot, scope]);

  const putObject = useCallback(async (
    itemId: string,
    itemLabel: string,
    containerId: string,
    containerLabel: string,
  ) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const item = snapshot.character.inventory.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (item.questBound) {
      addEntry("error", "Quest items cannot be put away.");
      return;
    }
    if (
      characterHasEquippedItem(snapshot.character.equipment, itemId)
    ) {
      addEntry("error", "Unequip that item before putting it away.");
      return;
    }
    const execution = beginForeground("put");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = await client.put(
        snapshot.character.characterId,
        itemId,
        containerId,
        snapshot.location.revision,
      );
      if (!accepts()) return;
      await refreshAfterMutation(
        `You put the ${itemLabel.toLocaleLowerCase()} in the ${containerLabel.toLocaleLowerCase()}.`,
        { base: snapshot, response }, false, undefined, accepts,
      );
      if (!accepts()) return;
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot put that item away just now.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, refreshAfterMutation, snapshot, scope]);

  const changeEquipment = useCallback(async (
    action: "equip" | "unequip",
    itemOrSlot: string,
  ) => {
    if (!snapshot?.character || pending) return;
    const item = action === "equip"
      ? snapshot.character.inventory.find((candidate) => candidate.id === itemOrSlot)
      : undefined;
    const slot = action === "equip" ? item?.equipment?.slot : itemOrSlot as EquipmentSlot;
    if (!slot) return;
    const execution = beginForeground("equip");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const response = action === "equip"
        ? await client.equip(snapshot.character.characterId, item!.id, snapshot.character.revision)
        : await client.unequip(snapshot.character.characterId, slot, snapshot.character.revision);
      if (!accepts()) return;
      await reconcileCommand(snapshot, response, undefined, accepts);
      if (!accepts()) return;
      setConnectionError("");
      addEntry("narration", action === "equip"
        ? `You equip the ${item!.label.toLocaleLowerCase()} as your ${slot}.`
        : `You unequip your ${slot}.`);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "Your equipment could not be changed.");
    } finally {
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground, scope]);

  const performItemUse = useCallback(async (itemId: string, targetId: string) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const execution = beginForeground("use");
    if (!execution) return;
    const accepts = scope.begin(true);
    if (!accepts) { finishForeground(execution); return; }
    try {
      const result = await client.use(
        snapshot.character.characterId,
        itemId,
        targetId,
        snapshot.location.revision,
      );
      if (!accepts()) return;
      const nextSnapshot = await client.getGame();
      if (!accepts()) return;
      setSnapshot(nextSnapshot);
      setConnectionError("");
      addEntry("narration", result.response);
    } catch (error) {
      if (!accepts()) return;
      addEntry("error", error instanceof Error ? error.message : "You cannot use that item here.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, pending, setConnectionError, setSnapshot, snapshot?.character, snapshot?.location, scope]);



  return { inspect, inspectCarriedItem, readObject, takeObject, takeAllObjects, lootCorpse,
    extinguishCampfire, dropObject, putObject, changeEquipment, performItemUse,
    inspectedCarriedItem, inventoryInspectError };
}
