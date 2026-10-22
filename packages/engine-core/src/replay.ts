import type { StoredGameEvent } from './types.js';
import {
  CharacterItemTakenEventSchema,
  CharacterItemDroppedEventSchema,
  CharacterEquipmentChangedEventSchema,
  CharacterItemUsedEventSchema,
  CharacterObjectReadEventSchema,
  CharacterNpcDialogueChoiceMadeEventSchema,
  QuestAcceptedEventSchema,
  QuestCompletedEventSchema,
  CharacterQuestRewardedEventSchema,
  CharacterProjectionSchema,
  CharacterCreatedEventSchema,
  CharacterMovedEventSchema,
  CharacterRenamedEventSchema,
  CharacterArchivedEventSchema,
  CharacterRestoredEventSchema,
  CharacterWalletInitializedEventSchema,
  CharacterInnRestCompletedEventSchema,
  CharacterCombatEncounterStartedEventSchema,
  CharacterAdvancementAwardedEventSchema,
  CharacterCombatItemUsedEventSchema,
  CharacterPvpOutcomeAppliedEventSchema,
  CharacterTeamCombatOutcomeAppliedEventSchema,
  CharacterRespawnedEventSchema,
  CharacterSharedItemReceivedEventSchema,
  CharacterSharedItemRelinquishedEventSchema,
  MerchantItemPurchasedEventSchema,
  CombatActionResolvedEventSchema,
} from '@mudd/contracts';

export function replayCharacter(events: readonly StoredGameEvent[]) {
  let state: ReturnType<typeof CharacterProjectionSchema.parse> | undefined;
  const pvpOutcomeEncounterIds = new Set<string>();
  const teamCombatOutcomeEncounterIds = new Set<string>();
  const teamCombatVictoryEncounterIds = new Set<string>();

  for (const event of events) {
    const { streamId: _streamId, ...publicEvent } = event;
    if (event.aggregateVersion !== (state?.revision ?? 0) + 1) {
      throw new Error(`Non-contiguous aggregate revision at ${event.aggregateVersion}.`);
    }
    if (event.type === 'character.created') {
      const created = CharacterCreatedEventSchema.parse(publicEvent);
      state = CharacterProjectionSchema.parse({
        worldInstanceId: event.worldInstanceId,
        characterId: created.payload.characterId,
        name: created.payload.name,
        locationId: created.payload.startingLocationId,
        ...(created.payload.startingStateId ? { locationStateId: created.payload.startingStateId } : {}),
        visitedLocationIds: [created.payload.startingLocationId],
        revision: event.aggregateVersion,
        ...(created.payload.wallet ? { wallet: created.payload.wallet } : {}),
      });
    } else if (event.type === 'character.wallet_initialized') {
      if (!state) throw new Error('Wallet initialization encountered before character creation.');
      const initialized = CharacterWalletInitializedEventSchema.parse(publicEvent);
      if (initialized.payload.characterId !== state.characterId || state.wallet) {
        throw new Error(`Invalid wallet initialization at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: initialized.payload.wallet,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.merchant_item_purchased') {
      if (!state) throw new Error('Merchant purchase encountered before character creation.');
      const purchased = MerchantItemPurchasedEventSchema.parse(publicEvent);
      const { characterId, locationId, currencyId, listingId, price, item } = purchased.payload;
      if (
        characterId !== state.characterId ||
        locationId !== state.locationId ||
        !state.wallet ||
        state.wallet.currencyId !== currencyId ||
        state.wallet.balance < price ||
        state.inventory.some((candidate) => candidate.id === item.id) ||
        state.purchasedMerchantListingIds.includes(listingId)
      ) {
        throw new Error(`Invalid merchant purchase at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: { ...state.wallet, balance: state.wallet.balance - price },
        inventory: [...state.inventory, item],
        itemLocations: [...state.itemLocations, { item, locationId: null }],
        purchasedMerchantListingIds: [...state.purchasedMerchantListingIds, listingId],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.inn_rest_completed') {
      if (!state) throw new Error('Inn rest encountered before character creation.');
      const rested = CharacterInnRestCompletedEventSchema.parse(publicEvent);
      const { characterId, locationId, currencyId, price, healthRestored, health } = rested.payload;
      const previousHealth = state.health;
      if (
        characterId !== state.characterId ||
        locationId !== state.locationId ||
        state.combat?.status === 'active' ||
        !previousHealth ||
        previousHealth.current <= 0 ||
        !state.wallet ||
        state.wallet.currencyId !== currencyId ||
        state.wallet.balance < price ||
        health.maximum !== previousHealth.maximum ||
        health.current !== health.maximum ||
        healthRestored !== health.maximum - previousHealth.current ||
        healthRestored <= 0
      ) {
        throw new Error(`Invalid inn rest event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: { ...state.wallet, balance: state.wallet.balance - price },
        health,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.combat_encounter_started') {
      if (!state) throw new Error('Combat encounter start encountered before character creation.');
      const started = CharacterCombatEncounterStartedEventSchema.parse(publicEvent);
      const encounter = {
        ...started.payload.encounter,
        opponentStyle: started.payload.encounter.opponentStyle ?? 'steady',
      };
      const maximumHealth = 6 + ((state.advancement?.level ?? 1) - 1) * 2;
      const expectedHealth = Math.min(state.health?.current ?? maximumHealth, maximumHealth);
      if (
        started.payload.characterId !== state.characterId ||
        encounter.locationId !== state.locationId ||
        state.combat?.status === 'active' ||
        encounter.playerHealth !== expectedHealth ||
        encounter.playerMaxHealth !== maximumHealth
      ) {
        throw new Error(`Invalid combat encounter start at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        combat: encounter,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.combat_action_resolved') {
      if (!state) throw new Error('Combat action encountered before character creation.');
      const resolved = CombatActionResolvedEventSchema.parse(publicEvent);
      const combat = {
        ...resolved.payload.encounter,
        opponentStyle: resolved.payload.encounter.opponentStyle ?? 'steady',
      };
      const healingDone = 'healingDone' in resolved.payload ? resolved.payload.healingDone : 0;
      const consumedItemId = 'consumedItemId' in resolved.payload
        ? resolved.payload.consumedItemId
        : undefined;
      const previous = state.combat;
      const consumedItem = consumedItemId
        ? state.inventory.find((item) => item.id === consumedItemId)
        : undefined;
      const combatItemUseIsValid = combat.lastAction === 'use-item'
        ? event.version === 3 &&
          Boolean(consumedItem?.consumable) &&
          !consumedItem?.equipment &&
          state.equipment.weaponItemId !== consumedItemId &&
          state.equipment.armorItemId !== consumedItemId
        : !consumedItemId && healingDone === 0;
      const expectedStartingHealth = previous?.status === 'active'
        ? previous.playerHealth
        : event.version >= 3
          ? Math.min(state.health?.current ?? combat.playerMaxHealth, combat.playerMaxHealth)
          : combat.playerMaxHealth;
      if (
        resolved.payload.characterId !== state.characterId ||
        combat.locationId !== state.locationId ||
        !combatItemUseIsValid ||
        (previous?.status === 'active' && (
          combat.encounterId !== previous.encounterId ||
          combat.opponentNpcId !== previous.opponentNpcId ||
          combat.opponentStyle !== previous.opponentStyle ||
          combat.round !== previous.round + 1 ||
          combat.playerMaxHealth !== previous.playerMaxHealth ||
          combat.opponentHealth > previous.opponentHealth ||
          (combat.lastAction === 'use-item' && !consumedItem) ||
          (combat.lastAction === 'use-item'
            ? healingDone !== Math.min(
              consumedItem?.consumable?.amount ?? 0,
              previous.playerMaxHealth - previous.playerHealth,
            )
            : healingDone !== 0) ||
          combat.playerHealth !== previous.playerHealth + healingDone - resolved.payload.damageTaken
        )) ||
        (previous?.status !== 'active' && (
          combat.lastAction !== 'attack' ||
          combat.round !== 1 ||
          combat.encounterId === previous?.encounterId ||
          (event.version >= 3 && state.health !== undefined && combat.playerMaxHealth < state.health.maximum) ||
          healingDone !== 0 ||
          Boolean(consumedItemId)
        )) ||
        combat.playerHealth !== expectedStartingHealth + healingDone - resolved.payload.damageTaken
      ) {
        throw new Error(`Invalid combat action at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        combat,
        health: {
          current: combat.playerHealth,
          maximum: combat.playerMaxHealth,
        },
        ...(consumedItemId ? {
          inventory: state.inventory.filter((item) => item.id !== consumedItemId),
          itemLocations: state.itemLocations.filter((entry) => entry.item.id !== consumedItemId),
        } : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.advancement_awarded') {
      if (!state) throw new Error('Advancement event encountered before character creation.');
      const awarded = CharacterAdvancementAwardedEventSchema.parse(publicEvent);
      const { characterId, encounterId, experienceAwarded, totalExperience, level } = awarded.payload;
      const previousAdvancement = state.advancement;
      const source = awarded.version === 2 ? awarded.payload.source ?? 'pve' : 'pve';
      const encounterIsValid = source === 'team-pve'
        ? teamCombatVictoryEncounterIds.has(encounterId)
        : state.combat?.status === 'victory' && state.combat.encounterId === encounterId;
      if (
        characterId !== state.characterId ||
        !encounterIsValid ||
        previousAdvancement?.lastRewardedEncounterId === encounterId ||
        totalExperience !== (previousAdvancement?.experience ?? 0) + experienceAwarded ||
        level < (previousAdvancement?.level ?? 1) ||
        (awarded.version === 2 && state.health !== undefined &&
          awarded.payload.maximumHealth < state.health.maximum)
      ) {
        throw new Error(`Invalid character advancement event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        advancement: { experience: totalExperience, level, lastRewardedEncounterId: encounterId },
        ...(awarded.version === 2 ? {
          health: state.health
            ? { ...state.health, maximum: awarded.payload.maximumHealth }
            : undefined,
        } : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.combat_item_used') {
      if (!state) throw new Error('Combat item use encountered before character creation.');
      const used = CharacterCombatItemUsedEventSchema.parse(publicEvent);
      const item = state.inventory.find((candidate) => candidate.id === used.payload.itemId);
      const previousHealth = state.health;
      const expectedHealing = item?.consumable && previousHealth
        ? Math.min(item.consumable.amount, used.payload.health.maximum - previousHealth.current)
        : 0;
      if (
        used.payload.characterId !== state.characterId ||
        state.combat?.status === 'active' ||
        !item?.consumable ||
        item.equipment ||
        state.equipment.weaponItemId === used.payload.itemId ||
        state.equipment.armorItemId === used.payload.itemId ||
        !previousHealth ||
        expectedHealing <= 0 ||
        used.payload.healingDone !== expectedHealing ||
        used.payload.health.maximum < previousHealth.maximum ||
        used.payload.health.current !== previousHealth.current + expectedHealing
      ) {
        throw new Error(`Invalid combat item use event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        health: used.payload.health,
        inventory: state.inventory.filter((candidate) => candidate.id !== used.payload.itemId),
        itemLocations: state.itemLocations.filter((entry) => entry.item.id !== used.payload.itemId),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.pvp_outcome_applied') {
      if (!state) throw new Error('PvP outcome encountered before character creation.');
      const outcome = CharacterPvpOutcomeAppliedEventSchema.parse(publicEvent);
      const previousHealth = state.health;
      const previousMaximum = previousHealth?.maximum ?? outcome.payload.health.maximum;
      const consumedItems = outcome.payload.consumedItemIds.map((itemId) =>
        state!.inventory.find((candidate) => candidate.id === itemId));
      if (
        outcome.payload.characterId !== state.characterId ||
        outcome.payload.health.maximum !== previousMaximum ||
        outcome.payload.health.current > outcome.payload.health.maximum ||
        new Set(outcome.payload.consumedItemIds).size !== outcome.payload.consumedItemIds.length ||
        consumedItems.some((item) =>
          !item?.consumable ||
          item.equipment ||
          state!.equipment.weaponItemId === item.id ||
          state!.equipment.armorItemId === item.id)
      ) {
        throw new Error(`Invalid PvP outcome at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        health: outcome.payload.health,
        inventory: state.inventory.filter((item) => !outcome.payload.consumedItemIds.includes(item.id)),
        itemLocations: state.itemLocations.filter((entry) => !outcome.payload.consumedItemIds.includes(entry.item.id)),
        revision: event.aggregateVersion,
      });
      if (outcome.payload.health.current === 0) {
        pvpOutcomeEncounterIds.add(outcome.payload.encounterId);
      }
    } else if (event.type === 'character.team_combat_outcome_applied') {
      if (!state) throw new Error('Team combat outcome encountered before character creation.');
      const outcome = CharacterTeamCombatOutcomeAppliedEventSchema.parse(publicEvent);
      const maximum = state.health?.maximum ?? outcome.payload.health.maximum;
      const consumedItems = outcome.payload.consumedItemIds.map((id) =>
        state!.inventory.find((item) => item.id === id),
      );
      if (
        outcome.payload.characterId !== state.characterId ||
        outcome.payload.health.maximum !== maximum ||
        outcome.payload.health.current > maximum ||
        new Set(outcome.payload.consumedItemIds).size !== outcome.payload.consumedItemIds.length ||
        consumedItems.some((item) => !item || !item.consumable || item.questBound === true)
      ) {
        throw new Error(`Invalid team combat outcome at revision ${event.aggregateVersion}.`);
      }
      teamCombatOutcomeEncounterIds.add(outcome.payload.encounterId);
      if (outcome.payload.result === 'victory') {
        teamCombatVictoryEncounterIds.add(outcome.payload.encounterId);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        health: outcome.payload.health,
        inventory: state.inventory.filter((item) => !outcome.payload.consumedItemIds.includes(item.id)),
        itemLocations: state.itemLocations.filter((entry) => !outcome.payload.consumedItemIds.includes(entry.item.id)),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.respawned') {
      if (!state) throw new Error('Respawn event encountered before character creation.');
      const respawned = CharacterRespawnedEventSchema.parse(publicEvent);
      const { characterId, cause, encounterId, deathLocationId, respawnLocationId, health, droppedItem } =
        respawned.payload;
      const sourceItem = droppedItem
        ? state.inventory.find((item) => item.id === droppedItem.sourceItemId)
        : undefined;
      const { id: _droppedId, sharedItemId: _sharedId, ...droppedItemDetails } = droppedItem?.item ?? {
        id: '',
        label: '',
        description: '',
      };
      const { id: _sourceId, sharedItemId: _sourceSharedId, ...sourceItemDetails } = sourceItem ?? {
        id: '',
        label: '',
        description: '',
      };
      const causeIsValid = cause === 'pve'
        ? state.combat?.status === 'defeat' &&
          state.combat.encounterId === encounterId &&
          state.combat.locationId === deathLocationId
        : cause === 'team-pve'
          ? teamCombatOutcomeEncounterIds.has(encounterId) && state.combat?.status !== 'defeat'
          : pvpOutcomeEncounterIds.has(encounterId) && state.combat?.status !== 'defeat';
      if (
        characterId !== state.characterId ||
        state.health?.current !== 0 ||
        !causeIsValid ||
        deathLocationId !== state.locationId ||
        health.current !== health.maximum ||
        health.maximum !== state.health.maximum ||
        (droppedItem && (
          !sourceItem ||
          sourceItem.questBound === true ||
          sourceItem.id === state.equipment.weaponItemId ||
          sourceItem.id === state.equipment.armorItemId ||
          droppedItem.item.id !== droppedItem.item.sharedItemId ||
          state.inventory.some((item) =>
            item.id === droppedItem.item.id && item.id !== droppedItem.sourceItemId) ||
          JSON.stringify(droppedItemDetails) !== JSON.stringify(sourceItemDetails)
        ))
      ) {
        throw new Error(`Invalid character respawn at revision ${event.aggregateVersion}.`);
      }
      pvpOutcomeEncounterIds.delete(encounterId);
      teamCombatOutcomeEncounterIds.delete(encounterId);
      teamCombatVictoryEncounterIds.delete(encounterId);
      state = CharacterProjectionSchema.parse({
        ...state,
        locationId: respawnLocationId,
        locationStateId: undefined,
        visitedLocationIds: state.visitedLocationIds.includes(respawnLocationId)
          ? state.visitedLocationIds
          : [...state.visitedLocationIds, respawnLocationId],
        health,
        combat: undefined,
        ...(droppedItem ? {
          inventory: state.inventory.filter((item) => item.id !== droppedItem.sourceItemId),
          itemLocations: state.itemLocations.filter((entry) => entry.item.id !== droppedItem.sourceItemId),
        } : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.shared_item_received') {
      if (!state) throw new Error('Shared item receipt encountered before character creation.');
      const received = CharacterSharedItemReceivedEventSchema.parse(publicEvent);
      const { characterId, worldItemId, item } = received.payload;
      if (
        characterId !== state.characterId ||
        worldItemId !== item.id ||
        worldItemId !== item.sharedItemId ||
        item.questBound === true ||
        state.inventory.some((candidate) => candidate.id === worldItemId)
      ) {
        throw new Error(`Invalid shared item receipt at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: [...state.inventory, item],
        itemLocations: [...state.itemLocations, { item, locationId: null }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.shared_item_relinquished') {
      if (!state) throw new Error('Shared item relinquishment encountered before character creation.');
      const relinquished = CharacterSharedItemRelinquishedEventSchema.parse(publicEvent);
      const { characterId, worldItemId, locationId } = relinquished.payload;
      const item = state.inventory.find((candidate) => candidate.id === worldItemId);
      if (
        characterId !== state.characterId ||
        locationId !== state.locationId ||
        !item ||
        item.sharedItemId !== worldItemId ||
        item.questBound === true ||
        state.equipment.weaponItemId === worldItemId ||
        state.equipment.armorItemId === worldItemId
      ) {
        throw new Error(`Invalid shared item relinquishment at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: state.inventory.filter((candidate) => candidate.id !== worldItemId),
        itemLocations: state.itemLocations.filter((entry) => entry.item.id !== worldItemId),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.moved') {
      if (!state) throw new Error('Movement event encountered before character creation.');
      const moved = CharacterMovedEventSchema.parse(publicEvent);
      if (
        moved.payload.characterId !== state.characterId ||
        moved.payload.fromLocationId !== state.locationId ||
        (
          moved.payload.fromStateId !== undefined &&
          state.locationStateId !== undefined &&
          moved.payload.fromStateId !== state.locationStateId
        )
      ) {
        throw new Error(`Invalid movement event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        locationId: moved.payload.toLocationId,
        ...(moved.payload.toStateId !== undefined
          ? { locationStateId: moved.payload.toStateId ?? undefined }
          : {}),
        visitedLocationIds: state.visitedLocationIds.includes(moved.payload.toLocationId)
          ? state.visitedLocationIds
          : [...state.visitedLocationIds, moved.payload.toLocationId],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_taken') {
      if (!state) throw new Error('Item taken event encountered before character creation.');
      const taken = CharacterItemTakenEventSchema.parse(publicEvent);
      if (taken.payload.characterId !== state.characterId || taken.payload.locationId !== state.locationId) {
        throw new Error(`Invalid item taken event at revision ${event.aggregateVersion}.`);
      }
      if (state.inventory.some((item) => item.id === taken.payload.item.id)) {
        throw new Error(`Duplicate inventory item at revision ${event.aggregateVersion}.`);
      }
      const itemLocation = state.itemLocations.find((entry) => entry.item.id === taken.payload.item.id);
      if (itemLocation && (
        itemLocation.locationId !== taken.payload.locationId ||
        itemLocation.item.label !== taken.payload.item.label ||
        itemLocation.item.description !== taken.payload.item.description
      )) {
        throw new Error(`Invalid item location at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: [...state.inventory, taken.payload.item],
        itemLocations: itemLocation
          ? state.itemLocations.map((entry) => entry.item.id === taken.payload.item.id
            ? { ...entry, locationId: null }
            : entry)
          : [...state.itemLocations, { item: taken.payload.item, locationId: null }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_dropped') {
      if (!state) throw new Error('Item dropped event encountered before character creation.');
      const dropped = CharacterItemDroppedEventSchema.parse(publicEvent);
      const carriedItem = state.inventory.find((item) => item.id === dropped.payload.item.id);
      const itemLocation = state.itemLocations.find((entry) => entry.item.id === dropped.payload.item.id);
      if (
        dropped.payload.characterId !== state.characterId ||
        dropped.payload.locationId !== state.locationId ||
        !carriedItem ||
        carriedItem.questBound === true ||
        carriedItem.questBound !== dropped.payload.item.questBound ||
        state.equipment.weaponItemId === dropped.payload.item.id ||
        state.equipment.armorItemId === dropped.payload.item.id ||
        itemLocation?.locationId !== null ||
        carriedItem.label !== dropped.payload.item.label ||
        carriedItem.description !== dropped.payload.item.description
      ) {
        throw new Error(`Invalid item dropped event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: state.inventory.filter((item) => item.id !== dropped.payload.item.id),
        itemLocations: state.itemLocations.map((entry) => entry.item.id === dropped.payload.item.id
          ? { ...entry, locationId: dropped.payload.locationId }
          : entry),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.equipment_changed') {
      if (!state) throw new Error('Equipment event encountered before character creation.');
      const changed = CharacterEquipmentChangedEventSchema.parse(publicEvent);
      const { characterId, slot, itemId } = changed.payload;
      const item = itemId ? state.inventory.find((candidate) => candidate.id === itemId) : undefined;
      const previousItemId = slot === 'weapon'
        ? state.equipment.weaponItemId
        : state.equipment.armorItemId;
      if (
        characterId !== state.characterId ||
        previousItemId === itemId ||
        (itemId !== null && (!item || item.equipment?.slot !== slot))
      ) {
        throw new Error(`Invalid equipment event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        equipment: {
          ...state.equipment,
          [slot === 'weapon' ? 'weaponItemId' : 'armorItemId']: itemId,
        },
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_used') {
      if (!state) throw new Error('Item use event encountered before character creation.');
      const used = CharacterItemUsedEventSchema.parse(publicEvent);
      if (
        used.payload.characterId !== state.characterId ||
        used.payload.locationId !== state.locationId ||
        !state.inventory.some((item) => item.id === used.payload.itemId)
      ) {
        throw new Error(`Invalid item use event at revision ${event.aggregateVersion}.`);
      }
      const alreadyUsed = state.itemUseObservations.some((observation) =>
        observation.interactionId === used.payload.interactionId &&
        observation.locationId === used.payload.locationId,
      );
      state = CharacterProjectionSchema.parse({
        ...state,
        itemUseObservations: alreadyUsed
          ? state.itemUseObservations
          : [...state.itemUseObservations, {
            interactionId: used.payload.interactionId,
            itemId: used.payload.itemId,
            targetId: used.payload.targetId,
            locationId: used.payload.locationId,
          }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.object_read') {
      if (!state) throw new Error('Object read event encountered before character creation.');
      const read = CharacterObjectReadEventSchema.parse(publicEvent);
      if (read.payload.characterId !== state.characterId || read.payload.locationId !== state.locationId) {
        throw new Error(`Invalid object read event at revision ${event.aggregateVersion}.`);
      }
      const alreadyRead = state.readableObservations.some((observation) =>
        observation.objectId === read.payload.objectId && observation.locationId === read.payload.locationId,
      );
      state = CharacterProjectionSchema.parse({
        ...state,
        readableObservations: alreadyRead
          ? state.readableObservations
          : [...state.readableObservations, {
            objectId: read.payload.objectId,
            locationId: read.payload.locationId,
          }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.npc_dialogue_choice_made') {
      if (!state) throw new Error('NPC dialogue event encountered before character creation.');
      const choice = CharacterNpcDialogueChoiceMadeEventSchema.parse(publicEvent);
      if (choice.payload.characterId !== state.characterId) {
        throw new Error(`Invalid NPC dialogue event at revision ${event.aggregateVersion}.`);
      }
      const existingProgress = state.npcProgress.find((entry) => entry.npcId === choice.payload.npcId);
      if (existingProgress?.progressFlagIds.includes(choice.payload.progressFlagId)) {
        throw new Error(`Duplicate NPC dialogue progress at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        npcProgress: existingProgress
          ? state.npcProgress.map((entry) => entry.npcId === choice.payload.npcId
            ? {
              ...entry,
              progressFlagIds: [...entry.progressFlagIds, choice.payload.progressFlagId],
              lastChoiceId: choice.payload.choiceId,
            }
            : entry)
          : [...state.npcProgress, {
            npcId: choice.payload.npcId,
            progressFlagIds: [choice.payload.progressFlagId],
            lastChoiceId: choice.payload.choiceId,
          }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'quest.accepted') {
      if (!state) throw new Error('Quest acceptance event encountered before character creation.');
      const accepted = QuestAcceptedEventSchema.parse(publicEvent);
      if (accepted.payload.characterId !== state.characterId ||
        state.questProgress.some((progress) => progress.questId === accepted.payload.questId)) {
        throw new Error(`Invalid quest acceptance event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        questProgress: [...state.questProgress, {
          questId: accepted.payload.questId,
          definitionVersion: accepted.payload.definitionVersion,
          status: 'active',
        }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'quest.completed') {
      if (!state) throw new Error('Quest completion event encountered before character creation.');
      const completed = QuestCompletedEventSchema.parse(publicEvent);
      const progress = state.questProgress.find((entry) => entry.questId === completed.payload.questId);
      if (
        completed.payload.characterId !== state.characterId ||
        !progress ||
        progress.status !== 'active' ||
        progress.definitionVersion !== completed.payload.definitionVersion
      ) {
        throw new Error(`Invalid quest completion event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        questProgress: state.questProgress.map((entry) => entry.questId === completed.payload.questId
          ? { ...entry, status: 'completed' }
          : entry),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.quest_rewarded') {
      if (!state) throw new Error('Quest reward event encountered before character creation.');
      const rewarded = CharacterQuestRewardedEventSchema.parse(publicEvent);
      const progress = state.questProgress.find((entry) => entry.questId === rewarded.payload.questId);
      const nextBalance = state.wallet ? state.wallet.balance + rewarded.payload.amount : Number.MAX_SAFE_INTEGER;
      const inventory = state.inventory;
      if (
        rewarded.payload.characterId !== state.characterId ||
        !progress ||
        progress.status !== 'completed' ||
        progress.definitionVersion !== rewarded.payload.definitionVersion ||
        state.questRewardedIds.includes(rewarded.payload.questId) ||
        !state.wallet ||
        state.wallet.currencyId !== rewarded.payload.currencyId ||
        (rewarded.payload.itemIds ?? []).some((itemId) =>
          !inventory.some((item) => item.id === itemId),
        ) ||
        !Number.isSafeInteger(nextBalance) ||
        nextBalance > 2_147_483_647
      ) {
        throw new Error(`Invalid quest reward event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: { ...state.wallet, balance: nextBalance },
        questRewardedIds: [...state.questRewardedIds, rewarded.payload.questId],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.renamed') {
      if (!state) throw new Error('Rename event encountered before character creation.');
      const renamed = CharacterRenamedEventSchema.parse(publicEvent);
      if (renamed.payload.characterId !== state.characterId || state.archived) {
        throw new Error(`Invalid rename event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        name: renamed.payload.name,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.archived') {
      if (!state) throw new Error('Archive event encountered before character creation.');
      const archived = CharacterArchivedEventSchema.parse(publicEvent);
      if (archived.payload.characterId !== state.characterId || state.archived) {
        throw new Error(`Invalid archive event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        archived: true,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.restored') {
      if (!state) throw new Error('Restore event encountered before character creation.');
      const restored = CharacterRestoredEventSchema.parse(publicEvent);
      if (restored.payload.characterId !== state.characterId || !state.archived) {
        throw new Error(`Invalid restore event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        archived: false,
        revision: event.aggregateVersion,
      });
    } else {
      throw new Error(`Unsupported event type "${event.type}" at revision ${event.aggregateVersion}.`);
    }
  }
  return state;
}
