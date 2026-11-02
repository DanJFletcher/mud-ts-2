import { useCallback } from "react";
import { EQUIPMENT_SLOTS, type EquipmentSlot } from "@mudd/contracts";
import type { ControllerOptions } from "../features/controller-options.js";
import type { useInventoryController } from "../features/inventory/use-inventory-controller.js";
import type { useSocialController } from "../features/social/use-social-controller.js";
import type { useDailyController } from "../features/daily/use-daily-controller.js";
import type { useDialogueController } from "../features/dialogue/use-dialogue-controller.js";
import type { useCommerceController } from "../features/commerce/use-commerce-controller.js";
import type { useFishingController } from "../features/gathering/use-fishing-controller.js";
import type { useWoodcuttingController } from "../features/gathering/use-woodcutting-controller.js";
import type { useActionDispatch } from "./use-action-dispatch.js";
import { getCommandHelp } from "./metadata.js";
import { parseWorldCommand } from "./intents.js";
import { findObjectMatches, findItemContainerMatches, findNpcMatches } from "./targets.js";

type CommandOptions = Pick<ControllerOptions, "snapshot" | "pending" | "addEntry" | "client" | "beginForeground" | "finishForeground">
  & Pick<ReturnType<typeof useInventoryController>, "inspect" | "extinguishCampfire" | "readObject" | "lootCorpse" | "takeObject" | "takeAllObjects" | "putObject" | "performItemUse" | "dropObject" | "changeEquipment">
  & Pick<ReturnType<typeof useSocialController>, "partyInfo" | "teamCombatInfo" | "interactionInbox" | "refreshPartyState">
  & Pick<ReturnType<typeof useDailyController>, "openDailyBoard" | "displayedDailyBoard" | "fetchDailyBoard" | "performDailyJob" | "performSupplyGather">
  & Pick<ReturnType<typeof useDialogueController>, "activeDialogue" | "chooseDialogueReply" | "talkToNpc">
  & Pick<ReturnType<typeof useCommerceController>, "craftingCommand" | "activeMerchantCatalog" | "purchaseMerchantListing" | "browseMerchant">
  & Pick<ReturnType<typeof useFishingController>, "performFishingCast">
  & Pick<ReturnType<typeof useWoodcuttingController>, "performWoodcuttingStart">
  & {
    dispatchIntent: ReturnType<typeof useActionDispatch>;
    move(id: string): Promise<void>;
    challengePlayer(id: string, name: string): Promise<void>;
    respondToPlayerChallenge(id: string, response: "accept" | "decline"): Promise<void>;
    performCombatAction(action: "attack" | "defend" | "flee" | "use-item", targetId?: string, recordCommand?: boolean, itemId?: string): Promise<void>;
    performStaminaPostureChange(posture: "rest" | "stand"): Promise<void>;
    performInnRest(): Promise<void>;
  };

/** Text input adapter. Pure parsing/resolution is separate from feature execution. */
export function useWorldCommands({
  dispatchIntent,
  pending,
  addEntry,
  interactionInbox,
  respondToPlayerChallenge,
  snapshot,
  craftingCommand,
  activeDialogue,
  chooseDialogueReply,
  openDailyBoard,
  displayedDailyBoard,
  fetchDailyBoard,
  performDailyJob,
  performSupplyGather,
  beginForeground,
  client,
  refreshPartyState,
  partyInfo,
  finishForeground,
  performStaminaPostureChange,
  performInnRest,
  teamCombatInfo,
  performCombatAction,
  challengePlayer,
  talkToNpc,
  browseMerchant,
  activeMerchantCatalog,
  purchaseMerchantListing,
  changeEquipment,
  inspect,
  extinguishCampfire,
  readObject,
  lootCorpse,
  takeObject,
  takeAllObjects,
  putObject,
  performItemUse,
  performFishingCast,
  performWoodcuttingStart,
  dropObject,
  move
}: CommandOptions) {
  const executeCommand = useCallback(async (rawCommand: string) => {
    const parsed = parseWorldCommand(rawCommand, snapshot);
    if (!parsed || pending) return;
    if (parsed.kind === "error") {
      addEntry("system", `> ${parsed.value}`);
      addEntry("error", parsed.message);
      return;
    }
    if (parsed.kind !== "text") { await dispatchIntent(parsed); return; }
    const { value, verb, target } = parsed;
    if (["accept", "decline"].includes(verb.toLowerCase())) {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", `Choose a challenge ID: ${verb.toLowerCase()} <id>.`);
        return;
      }
      const request = interactionInbox?.requests.find((candidate) =>
        candidate.requestId === target &&
        candidate.recipientCharacterId === snapshot?.character?.characterId &&
        candidate.status === "pending");
      if (!request) {
        addEntry("error", "That pending challenge is not available to this character.");
        return;
      }
      await respondToPlayerChallenge(target, verb.toLowerCase() as "accept" | "decline");
      return;
    }
    if (verb.toLowerCase() === "help") {
      addEntry("system", `> ${value}`);
      for (const line of getCommandHelp(target)) addEntry("narration", line);
      return;
    }
    if (verb.toLocaleLowerCase() === "craft") {
      addEntry("system", `> ${value}`);
      await craftingCommand(target);
      return;
    }
    if (verb.toLocaleLowerCase() === "quests") {
      addEntry("system", `> ${value}`);
      const choices = activeDialogue?.choices ?? [];
      if (!activeDialogue || choices.length === 0) {
        addEntry("error", 'Talk to an NPC first with “talk <name>”; there are no dialogue choices to select.');
        return;
      }
      if (!target) {
        addEntry("narration", `Replies from ${activeDialogue.npcName}:`);
        choices.forEach((choice, index) => addEntry("narration", `${index + 1}. ${choice.label}`));
        addEntry("narration", "Choose a reply with “quests <number>”.");
        return;
      }

      const index = /^\d+$/.test(target) ? Number(target) : 0;
      const exactId = choices.find((choice) => choice.id === target);
      const exactMatches = choices.filter(
        (choice) => choice.label.toLocaleLowerCase() === target.toLocaleLowerCase(),
      );
      const choice = exactId ?? (index > 0
        ? choices[index - 1]
        : exactMatches.length === 1
          ? exactMatches[0]
          : undefined);
      if (!choice) {
        addEntry("error", `Choose a number from 1 to ${choices.length}, or enter a reply exactly as shown. Type “quests” to list replies.`);
        return;
      }
      await chooseDialogueReply(choice.id, false);
      return;
    }
    if (verb.toLowerCase() === "jobs") {
      addEntry("system", `> ${value}`);
      const commandArgs = target.split(/\s+/).filter(Boolean);
      const [subcommand = "browse", jobId] = commandArgs;
      const normalized = subcommand.toLocaleLowerCase();
      if (normalized === "help") {
        for (const line of getCommandHelp("jobs")) addEntry("narration", line);
        return;
      }
      const boardId = snapshot?.dailyActivities?.boards[0]?.id;
      if (normalized === "browse" && (commandArgs.length === 0 || commandArgs.length === 1)) {
        await openDailyBoard(boardId);
        return;
      }
      if ((normalized !== "accept" && normalized !== "deliver") || commandArgs.length !== 2 || !jobId) {
        addEntry("error", "Usage: jobs [browse|accept <id>|deliver <id>].");
        return;
      }
      if (!boardId) {
        addEntry("error", "There is no daily bulletin available in this world.");
        return;
      }
      try {
        const board = displayedDailyBoard?.boardId === boardId ? displayedDailyBoard : await fetchDailyBoard(boardId);
        if (!board) throw new Error("The bulletin returned no postings.");
        await performDailyJob(board, jobId, normalized);
      } catch (error) {
        addEntry("error", error instanceof Error ? error.message : "The daily posting could not be completed.");
      }
      return;
    }
    if (verb.toLowerCase() === "gather") {
      addEntry("system", `> ${value}`);
      const sources = (snapshot?.dailyActivities?.sources ?? [])
        .filter((source) => source.locationId === snapshot?.location?.locationId);
      if (!target) {
        addEntry("error", "Choose a local source: gather <source-id or label>.");
        return;
      }
      const matches = findObjectMatches(target, sources);
      if (matches.length !== 1) {
        addEntry("error", matches.length
          ? `Which source do you mean: ${matches.map((source) => source.label).join(", ")}?`
          : `There is no local supply source matching “${target}”.`);
        return;
      }
      await performSupplyGather(matches[0]!.id, matches[0]!.label);
      return;
    }
    if (verb.toLowerCase() === "party") {
      addEntry("system", `> ${value}`);
      const [subcommand = "info", ...args] = target.split(/\s+/).filter(Boolean);
      const partyCommand = subcommand.toLocaleLowerCase();
      if (partyCommand === "help") {
        for (const line of getCommandHelp("party")) addEntry("narration", line);
        return;
      }
      if (!snapshot?.character) {
        addEntry("error", "Enter the world with a character before managing a party.");
        return;
      }
      const execution = beginForeground("party");
    if (!execution) return;
      try {
        if (partyCommand === "list") {
          const { parties } = await client.listParties(snapshot.character.characterId);
          if (!parties.length) {
            addEntry("narration", "There are no public parties available.");
          } else {
            for (const party of parties) {
              addEntry("narration",
                `${party.leaderName} — ${party.memberCount}/${party.maxMembers} members — ID ${party.groupId}${party.joinable ? "" : " (full)"}`);
            }
            addEntry("system", "Join with: party join <id>");
          }
        } else if (partyCommand === "quests" || (partyCommand === "quest" && args.length === 0)) {
          const journal = await client.getPartyQuests(snapshot.character.characterId);
          if (!journal.partyId) {
            addEntry("narration", "Join a party to view shared quests.");
          } else if (!journal.available.length && !journal.quests.length) {
            addEntry("narration", "There are no party quests available.");
          } else {
            for (const quest of journal.quests) {
              addEntry("narration", `${quest.title} (${quest.status}) — ${quest.summary}`);
              for (const objective of quest.objectives) {
                addEntry("narration", `${objective.completed ? "✓" : "·"} ${objective.progress}/${objective.required} ${objective.label}`);
              }
            }
            for (const quest of journal.available) {
              addEntry("narration", `${quest.title} — ${quest.summary} (start: party quest start ${quest.questId})`);
            }
          }
        } else if (partyCommand === "quest") {
          if (args.length !== 2 || args[0]?.toLocaleLowerCase() !== "start") {
            throw new Error("Usage: party quest start <quest-id>");
          }
          await client.startPartyQuest(snapshot.character.characterId, args[1]!);
          const journal = await client.getPartyQuests(snapshot.character.characterId);
          const started = journal.quests.find((quest) => quest.questId === args[1]);
          addEntry("narration", `Your party started ${started?.title ?? args[1]}.`);
        } else if (partyCommand === "create") {
          if (args.length) throw new Error("Usage: party create");
          await client.createParty(snapshot.character.characterId);
          const info = await refreshPartyState();
          addEntry("narration", `Party created${info?.party ? ` (ID ${info.party.groupId})` : ""}.`);
        } else if (partyCommand === "join") {
          if (args.length !== 1) throw new Error("Usage: party join <id>");
          await client.joinParty(snapshot.character.characterId, args[0]!);
          const info = await refreshPartyState();
          addEntry("narration", `You joined ${info?.party?.leaderName ?? "the party"}.`);
        } else if (partyCommand === "info") {
          if (args.length) throw new Error("Usage: party info");
          const info = await refreshPartyState() ?? partyInfo;
          if (!info?.party) {
            addEntry("narration", "You are not in a party. Use “party list” to browse or “party create” to start one.");
          } else {
            addEntry("narration",
              `${info.party.leaderName} leads party ${info.party.groupId} (${info.party.members.length}/${info.party.maxMembers}).`);
            for (const member of info.party.members) {
              addEntry("narration", `${member.displayName}${member.playerId === info.party.ownerPlayerId ? " (leader)" : ""}`);
            }
          }
        } else if (partyCommand === "leave") {
          if (args.length) throw new Error("Usage: party leave");
          const before = await refreshPartyState();
          await client.leaveParty(snapshot.character.characterId);
          await refreshPartyState();
          addEntry("narration", before?.party?.ownerPlayerId === snapshot.player.id
            ? "You left and closed your party."
            : "You left the party.");
        } else if (partyCommand === "close") {
          if (args.length) throw new Error("Usage: party close");
          await client.closeParty(snapshot.character.characterId);
          await refreshPartyState();
          addEntry("narration", "You closed the party.");
        } else {
          throw new Error('Unknown party command. Try “party help”.');
        }
      } catch (error) {
        addEntry("error", error instanceof Error ? error.message : "That party action could not be completed.");
      } finally {
        finishForeground(execution);
      }
      return;
    }
    if (verb.toLowerCase() === "rest") {
      addEntry("system", `> ${value}`);
      if (target) {
        addEntry("error", 'Use “inn rest” for the paid immediate inn service.');
        return;
      }
      await performStaminaPostureChange("rest");
      return;
    }
    if (verb.toLowerCase() === "stand") {
      addEntry("system", `> ${value}`);
      if (target) {
        addEntry("error", "Use “stand” without a target.");
        return;
      }
      await performStaminaPostureChange("stand");
      return;
    }
    if (verb.toLowerCase() === "inn") {
      addEntry("system", `> ${value}`);
      if (target.toLocaleLowerCase() !== "rest") {
        addEntry("error", 'Usage: inn rest — immediately restore health, stamina, and mana for the listed price.');
        return;
      }
      if (!snapshot?.location?.inn) {
        addEntry("error", "There is no priced inn service in this location.");
        return;
      }
      await performInnRest();
      return;
    }
    if (["attack", "defend", "flee"].includes(verb.toLowerCase())) {
      const action = verb.toLowerCase() as "attack" | "defend" | "flee";
      addEntry("system", `> ${value}`);
      const activeEncounter = snapshot?.character?.combat?.status === "active"
        ? snapshot.character.combat
        : undefined;
      const activeTeamEncounter = teamCombatInfo?.encounter?.status === "active"
        ? teamCombatInfo.encounter
        : undefined;
      if (action === "attack" && !activeEncounter && !activeTeamEncounter) {
        if (!target) {
          addEntry("error", "Attack whom? Choose an available combatant or try “attack Practice Sentinel”.");
          return;
        }
        const targets = (snapshot?.location?.npcs ?? []).filter((npc) => npc.canChallenge);
        const matches = findNpcMatches(target, targets);
        if (matches.length === 0) {
          const playerMatches = (snapshot?.location?.occupants ?? [])
            .filter((player) =>
              player.id !== snapshot?.character?.characterId &&
              player.displayName.toLocaleLowerCase().includes(target.toLocaleLowerCase()));
          if (playerMatches.length === 1) {
            await challengePlayer(playerMatches[0]!.id, playerMatches[0]!.displayName);
            return;
          }
          if (playerMatches.length > 1) {
            addEntry("error", `Which player do you mean: ${playerMatches.map((player) => player.displayName).join(", ")}?`);
            return;
          }
          addEntry("error", `There is no available combatant called “${target}” here.`);
          return;
        }
        if (matches.length > 1) {
          addEntry("error", `Who do you mean: ${matches.map((npc) => npc.name).join(", ")}?`);
          return;
        }
        await performCombatAction("attack", matches[0]!.id);
        return;
      }
      if (!activeEncounter && !activeTeamEncounter) {
        addEntry("error", "There is no active encounter. Choose an available combatant to attack first.");
        return;
      }
      if (target) {
        const activeOpponent = activeEncounter?.opponentName ??
          activeTeamEncounter?.participants.find((participant) => participant.teamId !== "allies")?.displayName ??
          "the opponent";
        addEntry("error", `The active opponent is ${activeOpponent}; use “${action}” without a target.`);
        return;
      }
      await performCombatAction(action);
      return;
    }
    if (verb.toLowerCase() === "talk") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Talk to whom? Try “talk Mara”.");
        return;
      }
      const aboutMatch = /^(.+?)\s+about(?:\s+(.+))?$/i.exec(target);
      const npcTarget = aboutMatch?.[1]?.trim() || target;
      const topic = aboutMatch?.[2]?.trim();
      if (aboutMatch && !topic) {
        addEntry("error", "Talk about what? Try “talk Mara about the tower”.");
        return;
      }
      const matches = findNpcMatches(npcTarget, snapshot?.location?.npcs ?? []);
      if (matches.length === 0) {
        addEntry("error", `You do not see anyone called “${npcTarget}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Who do you mean: ${matches.map((npc) => npc.name).join(", ")}?`);
        return;
      }
      await talkToNpc(matches[0]!.id, topic);
      return;
    }
    if (verb.toLowerCase() === "shop") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Browse whose goods? Try “shop Sella”.");
        return;
      }
      const matches = findNpcMatches(target, snapshot?.location?.npcs ?? []);
      if (matches.length === 0) {
        addEntry("error", `You do not see anyone called “${target}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Who do you mean: ${matches.map((npc) => npc.name).join(", ")}?`);
        return;
      }
      await browseMerchant(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "buy") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Buy what? Browse the shop, then try “buy lantern”.");
        return;
      }
      if (!activeMerchantCatalog) {
        addEntry("error", "Open a merchant’s catalog first with “shop <merchant>”.");
        return;
      }
      const matches = findObjectMatches(target, activeMerchantCatalog.listings.map((listing) => ({
        ...listing, label: listing.item.label,
      })));
      if (matches.length === 0) {
        addEntry("error", `The open catalog has no item called “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which item do you mean: ${matches.map((listing) => listing.item.label).join(", ")}?`);
        return;
      }
      await purchaseMerchantListing(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "equip") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Equip what? Try “equip practice blade”.");
        return;
      }
      const inventory = snapshot?.character?.inventory ?? [];
      const matches = findObjectMatches(target, inventory.map((item) => ({
        ...item, readable: false, takeable: true,
      })));
      if (matches.length !== 1) {
        addEntry("error", matches.length
          ? `Which item do you mean: ${matches.map((item) => item.label).join(", ")}?`
          : `You are not carrying an item called “${target}”.`);
        return;
      }
      const item = inventory.find((candidate) => candidate.id === matches[0]!.id);
      if (!item?.equipment) {
        addEntry("error", `The ${matches[0]!.label.toLocaleLowerCase()} cannot be equipped.`);
        return;
      }
      await changeEquipment("equip", item.id);
      return;
    }
    if (verb.toLowerCase() === "unequip") {
      addEntry("system", `> ${value}`);
      const slot = target.toLocaleLowerCase();
      if (!EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)) {
        addEntry("error", `Unequip which slot? Choose ${EQUIPMENT_SLOTS.join(", ")}.`);
        return;
      }
      await changeEquipment("unequip", slot as EquipmentSlot);
      return;
    }
    if (verb.toLowerCase() === "look") {
      addEntry("system", `> ${value}`);
      const lookTarget = target.replace(/^at\s+/i, "").replace(/^the\s+/i, "").trim();
      if (target && (!lookTarget || /^at$/i.test(target))) {
        addEntry("error", "Look at what? Try “look at marker”.");
        return;
      }
      await inspect(lookTarget || undefined);
      return;
    }
    if (verb.toLowerCase() === "extinguish") {
      addEntry("system", `> ${value}`);
      const fireTarget = target.replace(/^(?:the|a|an)\s+/i, "").trim();
      const campfires = (snapshot?.location?.objects ?? []).filter((object) =>
        object.label.toLocaleLowerCase() === "campfire",
      );
      const matches = fireTarget
        ? findObjectMatches(fireTarget, campfires)
        : campfires;
      if (matches.length === 0) {
        addEntry("error", `There is no burning campfire called “${fireTarget || "campfire"}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which campfire do you mean: ${matches.map((object) => object.label).join(", ")}?`);
        return;
      }
      await extinguishCampfire(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "read") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Read what? Try “read marker” or “read bulletin”.");
        return;
      }
      const bulletinTarget = target.replace(/^the\s+/i, "").trim().toLocaleLowerCase();
      if (/^(?:daily\s+)?(?:bulletin|notice)(?:\s+board)?$/.test(bulletinTarget)) {
        const bulletin = snapshot?.dailyActivities?.boards[0];
        if (!bulletin) {
          addEntry("error", "There is no bulletin board here.");
          return;
        }
        await openDailyBoard(bulletin.id);
        return;
      }
      const readableObjects = (snapshot?.location?.objects ?? []).filter((object) => object.readable);
      const matches = findObjectMatches(target, readableObjects);
      if (matches.length === 0) {
        addEntry("error", `There is nothing readable called “${target}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((object) => object.label).join(", ")}?`);
        return;
      }
      await readObject(matches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "loot") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Loot which corpse? Try “loot Practice Sentinel corpse”.");
        return;
      }
      const corpses = (snapshot?.location?.objects ?? []).filter((object) =>
        object.containerKind === "corpse",
      );
      const matches = findObjectMatches(target.replace(/^(?:the|a|an)\s+/i, ""), corpses);
      if (matches.length === 0) {
        addEntry("error", `There is no corpse called “${target}” here.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which corpse do you mean: ${matches.map((corpse) => corpse.label).join(", ")}?`);
        return;
      }
      await lootCorpse(matches[0]!.id, matches[0]!.label);
      return;
    }
    if (verb.toLowerCase() === "take" || verb.toLowerCase() === "get") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Take what? Try “get stone” or “get stone sack”.");
        return;
      }
      if (target.toLocaleLowerCase() === "all") {
        await takeAllObjects();
        return;
      }
      const objects = snapshot?.location?.objects ?? [];
      const takeables = objects.filter((object) => object.takeable);
      const containers = objects.filter((object) => Boolean(object.containerKind));
      const containerMatches = findItemContainerMatches(target, takeables, containers, true);
      if (containerMatches.length > 1) {
        addEntry("error", `Which item do you mean: ${containerMatches.map(({ item, container }) =>
          `${item.label} in ${container.label}`,
        ).join(", ")}?`);
        return;
      }
      const matches = containerMatches.length === 1
        ? [containerMatches[0]!.item]
        : findObjectMatches(target.replace(/^(?:the|a|an)\s+/i, ""), objects);
      if (matches.length === 0) {
        addEntry("error", `There is nothing here you can take called “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((object) => object.label).join(", ")}?`);
        return;
      }
      const object = matches[0]!;
      if (!object.takeable) {
        addEntry("error", `You cannot take the ${object.label.toLocaleLowerCase()}.`);
        return;
      }
      await takeObject(object.id, object.label);
      return;
    }
    if (verb.toLowerCase() === "put") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Put what where? Try “put stone sack”.");
        return;
      }
      const containers = (snapshot?.location?.objects ?? []).filter((object) =>
        Boolean(object.containerKind),
      );
      const inventory = (snapshot?.character?.inventory ?? []).map((item) => ({
        ...item, readable: false, takeable: true,
      }));
      const matches = findItemContainerMatches(target, inventory, containers);
      if (matches.length === 0) {
        addEntry("error", `Name an item you carry and a container here, for example “put stone sack”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which item and container do you mean: ${matches.map(({ item, container }) =>
          `${item.label} in ${container.label}`,
        ).join(", ")}?`);
        return;
      }
      const { item, container } = matches[0]!;
      await putObject(item.id, item.label, container.id, container.label);
      return;
    }
    if (verb.toLowerCase() === "use") {
      addEntry("system", `> ${value}`);
      const activeEncounter = snapshot?.character?.combat?.status === "active"
        ? snapshot.character.combat
        : undefined;
      if (activeEncounter) {
        if (!target || /\s+on\s+/i.test(target)) {
          addEntry("error", "During combat, use a healing item by name, for example “use Small healing draught”.");
          return;
        }
        const carriedItems = snapshot?.character?.inventory ?? [];
        const itemMatches = findObjectMatches(target.replace(/^(?:the|a|an)\s+/i, "").trim(), carriedItems);
        if (itemMatches.length === 0) {
          addEntry("error", `You are not carrying anything called “${target}”.`);
          return;
        }
        if (itemMatches.length > 1) {
          addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const item = itemMatches[0]!;
        if (!item.consumable || item.equipment) {
          addEntry("error", `${item.label} cannot be used as a combat item.`);
          return;
        }
        await performCombatAction("use-item", undefined, false, item.id);
        return;
      }
      const explicitUseMatch = /^(.+?)\s+on\s+(.+)$/i.exec(target);
      const cleanedUseTarget = target.replace(/^(?:the|a|an)\s+/i, "").trim();
      const carriedAxes = (snapshot?.character?.inventory ?? []).filter((item) => item.woodcuttingAxe);
      let itemTarget = explicitUseMatch?.[1]?.replace(/^(?:the|a|an)\s+/i, "").trim();
      let objectTarget = explicitUseMatch?.[2]?.replace(/^(?:the|a|an)\s+/i, "").trim();
      if (!explicitUseMatch) {
        const normalizedUseTarget = cleanedUseTarget.toLocaleLowerCase();
        const matchingAxes = carriedAxes.filter((item) =>
          normalizedUseTarget.startsWith(`${item.label.toLocaleLowerCase()} `),
        );
        const genericAxeTarget = /^axe\s+(.+)$/i.exec(cleanedUseTarget);
        if (matchingAxes.length > 1) {
          addEntry("error", `Which axe do you mean: ${matchingAxes.map((item) => item.label).join(", ")}?`);
          return;
        }
        if (matchingAxes.length === 1) {
          itemTarget = matchingAxes[0]!.label;
          objectTarget = cleanedUseTarget.slice(itemTarget.length).trim();
        } else if (genericAxeTarget) {
          if (carriedAxes.length > 1) {
            addEntry("error", `Which axe do you mean: ${carriedAxes.map((item) => item.label).join(", ")}?`);
            return;
          }
          if (carriedAxes.length === 1) {
            itemTarget = carriedAxes[0]!.label;
            objectTarget = genericAxeTarget[1]!.trim();
          }
        }
      }
      if (!itemTarget || !objectTarget) {
        const itemTarget = cleanedUseTarget;
        let itemMatches = findObjectMatches(itemTarget, snapshot?.character?.inventory ?? []);
        if (!itemMatches.length && itemTarget.replace(/\s+/g, "").toLocaleLowerCase() === "fishingrod") {
          itemMatches = (snapshot?.character?.inventory ?? []).filter((item) => item.fishingRod);
        }
        if (itemMatches.length > 1) {
          addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const item = itemMatches[0];
        if (item?.consumable?.effect === "heal") {
          await performCombatAction("use-item", undefined, false, item.id);
          return;
        }
        if (item?.fishingRod) {
          await performFishingCast(item.id);
          return;
        }
        addEntry("error", "Use a healing item, a fishing rod at a marked spot, or an axe on a named tree (for example, “use Copper Axe pine”).");
        return;
      }
      const carriedItems = (snapshot?.character?.inventory ?? []).map((item) => ({
        ...item, readable: false, takeable: true,
      }));
      const axeMatches = findObjectMatches(
        itemTarget,
        carriedItems.filter((item) => item.woodcuttingAxe),
      );
      if (axeMatches.length) {
        if (axeMatches.length > 1) {
          addEntry("error", `Which axe do you mean: ${axeMatches.map((item) => item.label).join(", ")}?`);
          return;
        }
        const treeTarget = objectTarget.replace(/\s+tree$/i, "").trim();
        const treeMatches = findObjectMatches(treeTarget, snapshot?.availableWoodcuttingTrees ?? []);
        if (treeMatches.length === 0) {
          addEntry("error", `There is no tree called “${objectTarget}” here.`);
          return;
        }
        if (treeMatches.length > 1) {
          addEntry("error", `Which tree do you mean: ${treeMatches.map((tree) => tree.label).join(", ")}?`);
          return;
        }
        await performWoodcuttingStart(axeMatches[0]!.id, treeMatches[0]!.id);
        return;
      }
      const itemMatches = findObjectMatches(itemTarget, carriedItems);
      if (itemMatches.length === 0) {
        addEntry("error", `You are not carrying anything called “${itemTarget}”.`);
        return;
      }
      if (itemMatches.length > 1) {
        addEntry("error", `Which item do you mean: ${itemMatches.map((item) => item.label).join(", ")}?`);
        return;
      }
      const targetMatches = findObjectMatches(objectTarget, snapshot?.location?.objects ?? []);
      if (targetMatches.length === 0) {
        addEntry("error", `There is no object called “${objectTarget}” in this room.`);
        return;
      }
      if (targetMatches.length > 1) {
        addEntry("error", `Which target do you mean: ${targetMatches.map((object) => object.label).join(", ")}?`);
        return;
      }
      await performItemUse(itemMatches[0]!.id, targetMatches[0]!.id);
      return;
    }
    if (verb.toLowerCase() === "drop") {
      addEntry("system", `> ${value}`);
      if (!target) {
        addEntry("error", "Drop what? Try “drop stone”.");
        return;
      }
      const inventory = snapshot?.character?.inventory ?? [];
      const matches = findObjectMatches(target, inventory.map((item) => ({
        ...item, readable: false, takeable: true,
      })));
      if (matches.length === 0) {
        addEntry("error", `You are not carrying anything called “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `Which one do you mean: ${matches.map((item) => item.label).join(", ")}?`);
        return;
      }
      await dropObject(matches[0]!.id, matches[0]!.label);
      return;
    }
    if (verb.toLowerCase() === "go" && target) {
      const exits = snapshot?.location?.exits ?? [];
      const matches = exits.filter((exit) => exit.available && (
        exit.label.toLowerCase() === target.toLowerCase() ||
        exit.direction?.toLowerCase() === target.toLowerCase()
      ));
      addEntry("system", `> ${value}`);
      if (matches.length === 0) {
        addEntry("error", `No available exit matches “${target}”.`);
        return;
      }
      if (matches.length > 1) {
        addEntry("error", `More than one exit leads ${target}. Choose one: ${matches.map((exit) => exit.label).join('; ')}.`);
        return;
      }
      await move(matches[0]!.id);
      return;
    }
    addEntry("system", `> ${value}`);
    addEntry("error", 'Unknown command. Try "help" for the command list.');
  }, [snapshot, dispatchIntent, pending, addEntry, interactionInbox?.requests, respondToPlayerChallenge, craftingCommand, activeDialogue, chooseDialogueReply, openDailyBoard, displayedDailyBoard, fetchDailyBoard, performDailyJob, performSupplyGather, beginForeground, client, refreshPartyState, partyInfo, finishForeground, performStaminaPostureChange, performInnRest, teamCombatInfo?.encounter, performCombatAction, challengePlayer, talkToNpc, browseMerchant, activeMerchantCatalog, purchaseMerchantListing, changeEquipment, inspect, extinguishCampfire, readObject, lootCorpse, takeObject, takeAllObjects, putObject, performItemUse, performFishingCast, performWoodcuttingStart, dropObject, move]);

  return executeCommand;
}
