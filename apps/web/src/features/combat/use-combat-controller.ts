import { MuddCommandError, MuddHttpError, type CommandResponse } from "@mudd/client-sdk";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { ControllerOptions } from "../controller-options.js";
import { traceFirstFeedbackPaint } from "../session/action-feedback.js";
import type { useSocialController } from "../social/use-social-controller.js";
type Social = ReturnType<typeof useSocialController>;
type Options = Omit<ControllerOptions, "refreshGate"> & Pick<Social, "partyInfo" | "teamCombatInfo" | "interactionInbox" | "refreshPartyState" | "refreshTeamCombat" | "refreshInteractions" | "knownInteractionIds"> & {
  worldInstanceId: string;
  classChoiceId: string;
  setClassChoiceId: Dispatch<SetStateAction<string>>;
  confirmClassAdoption: boolean;
  setConfirmClassAdoption: Dispatch<SetStateAction<boolean>>;
};
function isRejectedAction(error: unknown): boolean {
  return error instanceof MuddCommandError ||
    (error instanceof MuddHttpError && error.status >= 400 && error.status < 500);
}
function respawnNotice(events: CommandResponse["events"], locationName: string): string | undefined {
  const event = events?.find((candidate) => candidate.type === "character.respawned");
  if (!event?.payload || typeof event.payload !== "object") return undefined;
  const payload = event.payload as {
    droppedItem?: { item?: { label?: unknown; }; };
  };
  const droppedLabel = typeof payload.droppedItem?.item?.label === "string"
    ? payload.droppedItem.item.label
    : undefined;
  return `You awaken at ${locationName}, restored to full health.${droppedLabel ? ` ${droppedLabel} was dropped where you fell.` : ""}`;
}
/** Executes combat, challenge, class-adoption and recovery intents through session ports. */
export function useCombatController({
  client, snapshot, pending, beginForeground, finishForeground, reconcileCommand,
  setSnapshot, setConnectionError, addEntry, worldInstanceId, partyInfo,
  teamCombatInfo, interactionInbox, refreshPartyState, refreshTeamCombat,
  refreshInteractions, knownInteractionIds, classChoiceId, setClassChoiceId,
  confirmClassAdoption, setConfirmClassAdoption,
}: Options) {
  const performCombatAction = useCallback(async (
    action: "attack" | "defend" | "flee" | "use-item",
    targetNpcId?: string,
    recordCommand = false,
    itemId?: string,
  ) => {
    if (!snapshot?.character || !snapshot.location || pending) return;
    const previousExperience = snapshot.character.advancement?.experience ?? 0;
    const activeEncounter = snapshot.character.combat?.status === "active"
      ? snapshot.character.combat
      : undefined;
    let activeTeamEncounter = teamCombatInfo?.encounter?.status === "active"
      ? teamCombatInfo.encounter
      : undefined;
    if (recordCommand) {
      const commandText = action === "attack" && targetNpcId
        ? `> attack ${snapshot.location.npcs?.find((npc) => npc.id === targetNpcId)?.name ?? "opponent"}`
        : action === "use-item" && itemId
          ? `> use ${snapshot.character.inventory.find((item) => item.id === itemId)?.label ?? "item"}`
          : `> ${action}`;
      addEntry("system", commandText);
    }
    const execution = beginForeground("combat");
    if (!execution) return;
    try {
      let playerHasParty = Boolean(partyInfo?.party);
      if (!activeTeamEncounter && !activeEncounter && action === "attack" && targetNpcId) {
        const currentParty = await refreshPartyState();
        if (!currentParty) return;
        playerHasParty = Boolean(currentParty.party);
      }
      let result;
      if (activeTeamEncounter) {
        result = await client.performTeamCombatAction(
          snapshot.character.characterId,
          activeTeamEncounter.encounterId,
          action,
          itemId ? { itemId } : {},
        );
      } else if (!activeEncounter && action === "attack" && targetNpcId && playerHasParty) {
        const started = await client.startTeamCombat(
          snapshot.character.characterId,
          targetNpcId,
          snapshot.character.revision,
        );
        if (!started.receipt.ok) throw new Error(started.receipt.message);
        const startedInfo = await refreshTeamCombat();
        if (!startedInfo) return;
        activeTeamEncounter = startedInfo.encounter?.status === "active"
          ? startedInfo.encounter
          : undefined;
        if (!activeTeamEncounter) throw new Error("The cooperative encounter did not start.");
        result = await client.performTeamCombatAction(
          snapshot.character.characterId,
          activeTeamEncounter.encounterId,
          "attack",
        );
      } else {
        result = await client.performCombatAction(
          snapshot.character.characterId,
          action,
          snapshot.character.revision,
          activeEncounter
            ? { encounterId: activeEncounter.encounterId, ...(itemId ? { itemId } : {}) }
            : targetNpcId
              ? { targetNpcId }
              : itemId
                ? { itemId }
                : {},
        );
      }
      if (!result.receipt.ok) throw new Error(result.receipt.message);
      const [reconciliation, nextTeamInfo] = await Promise.all([
        reconcileCommand(snapshot, result),
        refreshTeamCombat(),
      ]);
      const nextSnapshot = reconciliation.snapshot;

      setConnectionError("");
      const encounter = nextSnapshot.character?.combat;
      const teamEncounter = nextTeamInfo?.encounter;
      const notice = respawnNotice(result.events, nextSnapshot.location?.title ?? "the fountain");
      if (notice) {
        addEntry("narration", notice);
      } else if (teamEncounter) {
        addEntry("narration", `${teamEncounter.lastNarration} Round ${teamEncounter.round}.`);
      } else if (action === "use-item" && !activeEncounter) {
        const nextHealth = nextSnapshot.character?.health;
        const previousHealth = snapshot.character.health;
        const label = snapshot.character.inventory.find((item) => item.id === itemId)?.label ?? "item";
        const recovered = nextHealth && previousHealth
          ? nextHealth.current - previousHealth.current
          : 0;
        if (nextHealth) {
          addEntry("narration", `You use the ${label.toLocaleLowerCase()} and recover ${recovered} health. You: ${nextHealth.current}/${nextHealth.maximum}.`);
        }
      } else if (encounter) {
        const advancement = nextSnapshot.character?.advancement;
        const rewardNarration = encounter.status === "victory" &&
          advancement?.lastRewardedEncounterId === encounter.encounterId
          ? ` You gain ${advancement.experience - previousExperience} XP. Level ${advancement.level}.`
          : "";
        addEntry("narration", `${encounter.lastNarration}${rewardNarration} You: ${encounter.playerHealth}/${encounter.playerMaxHealth}. ${encounter.opponentName}: ${encounter.opponentHealth}/${encounter.opponentMaxHealth}.`);
      }
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The combat action could not be completed.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, partyInfo?.party, pending, reconcileCommand, refreshPartyState, refreshTeamCombat, setConnectionError, snapshot, teamCombatInfo?.encounter]);

  const performClassAbility = useCallback(async (abilityId: string) => {
    const game = snapshot;
    const character = game?.character;
    if (!game?.character || !character || !game.location || pending) return;
    const teamEncounter = teamCombatInfo?.encounter?.status === "active" ? teamCombatInfo.encounter : undefined;
    const soloEncounter = game.character.combat?.status === "active" ? game.character.combat : undefined;
    const pvpEncounter = interactionInbox?.encounter?.status === "active" &&
      interactionInbox.encounter.participants.some((participant) => participant.characterId === game.character!.characterId)
      ? interactionInbox.encounter : undefined;
    if (!teamEncounter && !soloEncounter && !pvpEncounter) return;
    const execution = beginForeground("combat");
    if (!execution) return;
    try {
      const result = pvpEncounter
        ? await client.performPvpAction(game.character.characterId, pvpEncounter.encounterId, "ability", undefined, abilityId)
        : teamEncounter
          ? await client.performTeamCombatAction(game.character.characterId, teamEncounter.encounterId, "ability", { abilityId })
          : await client.performCombatAction(
            game.character.characterId,
            "ability",
            game.character.revision,
            { encounterId: soloEncounter?.encounterId, abilityId },
          );
      if (!result.receipt.ok) throw new Error(result.receipt.message);
      const [reconciliation, nextTeamInfo, nextInbox] = await Promise.all([
        reconcileCommand(game, result),
        refreshTeamCombat(),
        pvpEncounter ? refreshInteractions() : Promise.resolve(interactionInbox),
      ]);
      const nextSnapshot = reconciliation.snapshot;

      const refreshedPvp = nextInbox?.encounter;
      const refreshedTeam = nextTeamInfo?.encounter;
      const refreshedSolo = nextSnapshot.character?.combat;
      const narration = pvpEncounter
        ? refreshedPvp?.lastNarration
        : teamEncounter
          ? refreshedTeam?.lastNarration
          : refreshedSolo?.lastNarration;
      if (narration) addEntry("narration", narration);
      setConnectionError("");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The class action could not be completed.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox, pending, reconcileCommand, refreshInteractions, refreshTeamCombat, setConnectionError, snapshot, teamCombatInfo?.encounter]);

  const adoptCharacterClass = useCallback(async () => {
    const game = snapshot;
    const character = game?.character;
    if (!game?.character || !character || character.characterClass || !classChoiceId || pending) return;
    if (snapshot?.character?.combat?.status === "active" || teamCombatInfo?.encounter?.status === "active" || interactionInbox?.encounter?.status === "active") {
      addEntry("error", "Class adoption is available only outside combat.");
      return;
    }
    if (!confirmClassAdoption) {
      setConfirmClassAdoption(true);
      return;
    }
    const execution = beginForeground("combat");
    if (!execution) return;
    try {
      await client.chooseCharacterClass(
        game.character.characterId,
        game.character.revision,
        classChoiceId,
      );
      const nextSnapshot = await client.getGame();
      setSnapshot(nextSnapshot);
      setConfirmClassAdoption(false);
      setClassChoiceId("");
      addEntry("system", "Your class has been adopted. This choice cannot be changed.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "Class adoption could not be completed.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, classChoiceId, client, confirmClassAdoption, finishForeground, interactionInbox?.encounter?.status, pending, setClassChoiceId, setConfirmClassAdoption, setSnapshot, snapshot, teamCombatInfo?.encounter?.status]);

  const challengePlayer = useCallback(async (recipientCharacterId: string, recipientName: string) => {
    if (!snapshot?.character || pending) return;
    const characterId = snapshot.character.characterId;
    const retryAction = client.pendingActions.getSnapshot().filter((action) =>
      action.scope.worldInstanceId === worldInstanceId &&
      action.scope.characterId === characterId &&
      action.details.kind === "pvp.challenge" &&
      action.details.recipientCharacterId === recipientCharacterId &&
      (action.state === "uncertain" || action.state === "acknowledged")
    ).at(-1);
    const commandId = (retryAction?.id ?? crypto.randomUUID()) as ReturnType<Crypto["randomUUID"]>;
    const traceId = new URLSearchParams(window.location.search).get("muddTrace") === "1"
      ? commandId
      : undefined;
    const actionStartedAt = performance.now();
    addEntry("system", `> attack ${recipientName}`);
    client.pendingActions.begin({
      id: commandId,
      scope: { worldInstanceId, characterId: snapshot.character.characterId },
      details: retryAction?.details ?? {
        kind: "pvp.challenge",
        recipientCharacterId,
        recipientName,
        priorRequestIds: [...new Set([
          ...knownInteractionIds(),
          ...(interactionInbox?.requests.map((request) => request.requestId) ?? []),
        ])],
      },
    });
    const execution = beginForeground("combat");
    if (!execution) return;
    traceFirstFeedbackPaint(traceId, "interaction.request", actionStartedAt);
    try {
      await client.requestInteraction(snapshot.character.characterId, recipientCharacterId, "pvp.challenge", commandId);
      client.pendingActions.acknowledge(commandId);
      await refreshInteractions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The challenge could not be sent.";
      if (isRejectedAction(error)) {
        client.pendingActions.reject(commandId, message);
        addEntry("error", message);
      } else {
        client.pendingActions.markUncertain(commandId, "Challenge status is not confirmed yet.");
      }
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox?.requests, knownInteractionIds, pending, refreshInteractions, snapshot?.character, worldInstanceId]);

  const respondToPlayerChallenge = useCallback(async (requestId: string, response: "accept" | "decline") => {
    if (!snapshot?.character || pending) return;
    const characterId = snapshot.character.characterId;
    const retryAction = client.pendingActions.getSnapshot().filter((action) =>
      action.scope.worldInstanceId === worldInstanceId &&
      action.scope.characterId === characterId &&
      action.details.kind === "pvp.respond" &&
      action.details.requestId === requestId &&
      action.details.response === response &&
      (action.state === "uncertain" || action.state === "acknowledged")
    ).at(-1);
    const commandId = (retryAction?.id ?? crypto.randomUUID()) as ReturnType<Crypto["randomUUID"]>;
    const traceId = new URLSearchParams(window.location.search).get("muddTrace") === "1"
      ? commandId
      : undefined;
    const actionStartedAt = performance.now();
    const requestBefore = interactionInbox?.requests.find((candidate) => candidate.requestId === requestId);
    client.pendingActions.begin({
      id: commandId,
      scope: { worldInstanceId, characterId: snapshot.character.characterId },
      details: retryAction?.details ?? {
        kind: "pvp.respond",
        requestId,
        response,
        otherCharacterName: requestBefore?.initiatorName ?? "the other player",
      },
    });
    const execution = beginForeground("combat");
    if (!execution) return;
    traceFirstFeedbackPaint(traceId, "interaction.respond", actionStartedAt);
    try {
      await client.respondToInteraction(snapshot.character.characterId, requestId, response, commandId);
      client.pendingActions.acknowledge(commandId);
      const inbox = await refreshInteractions();
      if (!inbox) return;
      const request = inbox.requests.find((candidate) => candidate.requestId === requestId);
      if (request?.status === (response === "accept" ? "accepted" : "declined")) {
        client.pendingActions.confirm(commandId);
        addEntry("system", response === "accept"
          ? `You accept ${request.initiatorName}’s challenge.`
          : `You decline ${request.initiatorName}’s challenge.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "You could not respond to that challenge.";
      if (isRejectedAction(error)) {
        client.pendingActions.reject(commandId, message);
        addEntry("error", message);
      } else {
        client.pendingActions.markUncertain(commandId, "Your response status is not confirmed yet.");
      }
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox?.requests, pending, refreshInteractions, snapshot?.character, worldInstanceId]);

  const performPvpAction = useCallback(async (
    action: "attack" | "defend" | "flee" | "use-item",
    itemId?: string,
  ) => {
    const encounter = interactionInbox?.encounter;
    if (!snapshot?.character || !encounter || pending) return;
    const execution = beginForeground("combat");
    if (!execution) return;
    try {
      const result = await client.performPvpAction(snapshot.character.characterId, encounter.encounterId, action, itemId);
      const [inbox, reconciliation] = await Promise.all([
        refreshInteractions(),
        reconcileCommand(snapshot, result),
      ]);
      const nextSnapshot = reconciliation.snapshot;
      if (!inbox) return;
      const nextEncounter = inbox.encounter;
      if (nextEncounter) {
        addEntry("narration", nextEncounter.lastNarration);
      }
      const notice = respawnNotice(result.events, nextSnapshot.location?.title ?? "the fountain");
      if (notice) addEntry("narration", notice);
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "The combat action could not be completed.");
    } finally {
      finishForeground(execution);
    }
  }, [addEntry, beginForeground, client, finishForeground, interactionInbox?.encounter, pending, reconcileCommand, refreshInteractions, snapshot]);

  const performStaminaPostureChange = useCallback(async (posture: "rest" | "stand") => {
    if (!snapshot?.character || pending) return;
    const execution = beginForeground(posture);
    if (!execution) return;
    try {
      const response = posture === "rest"
        ? await client.rest(snapshot.character.characterId, snapshot.character.revision)
        : await client.stand(snapshot.character.characterId, snapshot.character.revision);
      await reconcileCommand(snapshot, response);
      setConnectionError("");
      addEntry("narration", posture === "rest"
        ? "You ease into a resting posture. The surface beneath you feels cool and firm; your breathing slows as nearby sounds soften."
        : "You rise, stretching the stiffness from your limbs. Your clothes rustle as your feet find steady ground.");
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not change your resting posture.");
    } finally {
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground]);

  const performInnRest = useCallback(async () => {
    if (!snapshot?.character || !snapshot.location?.inn || pending) return;
    const inn = snapshot.location.inn;
    const previousHealth = snapshot.character.health;
    const previousResources = snapshot.character.resources;
    const execution = beginForeground("rest");
    if (!execution) return;
    try {
      const response = await client.restAtInn(snapshot.character.characterId, inn.id, snapshot.character.revision);
      const { snapshot: nextSnapshot } = await reconcileCommand(snapshot, response);
      setConnectionError("");
      const nextHealth = nextSnapshot.character?.health;
      const nextResources = nextSnapshot.character?.resources;
      const nextWallet = nextSnapshot.character?.wallet;
      const healthRestored = nextHealth
        ? nextHealth.current - (previousHealth?.current ?? nextHealth.maximum)
        : 0;
      const staminaRestored = nextResources
        ? nextResources.stamina.current - previousResources.stamina.current
        : 0;
      const manaRestored = nextResources
        ? nextResources.mana.current - previousResources.mana.current
        : 0;
      addEntry(
        "narration",
        `You rest at ${inn.name}, restore ${healthRestored} health, ${staminaRestored} stamina, and ${manaRestored} mana, and pay ${inn.restPrice} ${inn.currency.name}${inn.restPrice === 1 ? "" : "s"}. Health: ${nextHealth?.current ?? "—"}/${nextHealth?.maximum ?? "—"}. Balance: ${nextWallet?.balance ?? "—"}.`,
      );
    } catch (error) {
      addEntry("error", error instanceof Error ? error.message : "You could not rest at this inn.");
    } finally {
      finishForeground(execution);
    }
  }, [snapshot, pending, beginForeground, client, reconcileCommand, setConnectionError, addEntry, finishForeground]);


return {performCombatAction, performClassAbility, adoptCharacterClass, challengePlayer, respondToPlayerChallenge, performPvpAction, performStaminaPostureChange, performInnRest};
}
