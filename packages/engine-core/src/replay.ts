import type { StoredGameEvent } from './types.js';
import {
  DailyJobChangedEventSchema,
  SupplyGatheredEventSchema,
  CharacterItemTakenEventSchema,
  CharacterItemGrantedEventSchema,
  CharacterItemDroppedEventSchema,
  CharacterItemStoredEventSchema,
  CharacterEquipmentChangedEventSchema,
  characterHasEquippedItem,
  equipmentItemIdForSlot,
  CharacterItemUsedEventSchema,
  CharacterObjectReadEventSchema,
  CharacterNpcDialogueChoiceMadeEventSchema,
  CharacterNpcDialogueRestartedEventSchema,
  QuestAcceptedEventSchema,
  QuestCompletedEventSchema,
  CharacterQuestRewardedEventSchema,
  CharacterProjectionSchema,
  CharacterCreatedEventSchema,
  CharacterCreatedEventV2Schema,
  CharacterCreatedEventV3Schema,
  CharacterClassSelectedEventSchema,
  CharacterAbilityResourceSpentEventSchema,
  CharacterStaminaSpentEventSchema,
  CharacterStaminaRecoverySettledEventSchema,
  CharacterVitalRecoverySettledEventSchema,
  CharacterPostureChangedEventSchema,
  FishingCastStartedEventSchema,
  FishingCastAdvancedEventSchema,
  WoodcuttingActionStartedEventSchema,
  WoodcuttingActionAdvancedEventSchema,
  CharacterCraftingCompletedEventSchema,
  type InventoryItemProjection,
  DEFAULT_CHARACTER_RESOURCES,
  resolveStaminaRecovery,
  resolveVitalRecovery,
  MOVEMENT_STAMINA_COST,
  CharacterMovedEventSchema,
  CharacterRenamedEventSchema,
  CharacterArchivedEventSchema,
  CharacterRestoredEventSchema,
  CharacterWalletInitializedEventSchema,
  CharacterCorpseGoldReceivedEventSchema,
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

type ReplayCheckpoint = {
  state: ReturnType<typeof CharacterProjectionSchema.parse> | undefined;
  count: number;
  pvp: Set<string>;
  team: Set<string>;
  victories: Set<string>;
  abilities: Set<string>;
};
// Histories are immutable adapter-owned values. Weak keys bound checkpoint
// lifetime to the adapter's bounded history cache, not the number of characters.
const checkpoints = new WeakMap<readonly StoredGameEvent[], ReplayCheckpoint>();
const prefixes = new WeakMap<readonly StoredGameEvent[], ReplayCheckpoint>();
const immutableHistories = new WeakSet<readonly StoredGameEvent[]>();
const historyParents = new WeakMap<readonly StoredGameEvent[], WeakRef<readonly StoredGameEvent[]>>();
export function immutableReplayParent(events: readonly unknown[]): readonly StoredGameEvent[] | undefined {
  return historyParents.get(events as readonly StoredGameEvent[])?.deref();
}
/** Only adapter-registered histories may participate in incremental projections. */
export function isImmutableReplayHistory(events: readonly unknown[]): boolean {
  return immutableHistories.has(events as readonly StoredGameEvent[]);
}
function freezeHistoryValue(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeHistoryValue(nested);
  Object.freeze(value);
}

/** Adapter-only: a fresh history consists of this exact committed prefix + tail. */
export function retainCharacterReplayPrefix(
  next: readonly StoredGameEvent[],
  previous?: readonly StoredGameEvent[],
) {
  if (immutableHistories.has(next)) return;
  const hasPrefix = previous && immutableHistories.has(previous) && next.length > previous.length &&
    next[previous.length - 1] === previous.at(-1);
  if (hasPrefix) historyParents.set(next, new WeakRef(previous));
  for (let i = hasPrefix ? previous.length : 0; i < next.length; i++) freezeHistoryValue(next[i]);
  Object.freeze(next);
  immutableHistories.add(next);
  const checkpoint = hasPrefix ? checkpoints.get(previous) : undefined;
  if (checkpoint) prefixes.set(next, checkpoint);
}

/** Pure full reconstruction for rebuilds, audits and benchmark comparisons. */
export function replayCharacterUncached(events: readonly StoredGameEvent[]) {
  return reconstructCharacter(events);
}

export function replayCharacter(events: readonly StoredGameEvent[]) {
  // Unregistered author/test histories remain pure and can be edited between
  // calls. Only adapters explicitly promising an immutable prefix opt in.
  if (!immutableHistories.has(events)) return reconstructCharacter(events);
  const known = checkpoints.get(events);
  if (known) return structuredClone(known.state);
  return reconstructCharacter(events, prefixes.get(events), true);
}

function reconstructCharacter(events: readonly StoredGameEvent[], prefix?: ReplayCheckpoint, cache = false) {
  let state = prefix?.state;
  const pvpOutcomeEncounterIds = new Set(prefix?.pvp);
  const teamCombatOutcomeEncounterIds = new Set(prefix?.team);
  const teamCombatVictoryEncounterIds = new Set(prefix?.victories);
  const abilityActionIds = new Set(prefix?.abilities);

  for (let index = prefix?.count ?? 0; index < events.length; index++) {
    const event = events[index]!;
    const { streamId: _streamId, ...publicEvent } = event;
    if (event.aggregateVersion !== (state?.revision ?? 0) + 1) {
      throw new Error(`Non-contiguous aggregate revision at ${event.aggregateVersion}.`);
    }
    if (event.type === 'character.created') {
      const created = event.version === 3 ? CharacterCreatedEventV3Schema.parse(publicEvent) : event.version === 2
        ? CharacterCreatedEventV2Schema.parse(publicEvent)
        : CharacterCreatedEventSchema.parse(publicEvent);
      if ('characterClass' in created.payload &&
          JSON.stringify(created.payload.attributes) !== JSON.stringify(created.payload.characterClass.attributes)) {
        throw new Error('Class creation attributes must match its recorded snapshot.');
      }
      state = CharacterProjectionSchema.parse({
        worldInstanceId: event.worldInstanceId,
        characterId: created.payload.characterId,
        name: created.payload.name,
        locationId: created.payload.startingLocationId,
        ...(created.payload.startingStateId ? { locationStateId: created.payload.startingStateId } : {}),
        visitedLocationIds: [created.payload.startingLocationId],
        revision: event.aggregateVersion,
        ...(created.payload.attributes ? { attributes: created.payload.attributes } : {}),
        ...(created.payload.honors ? { honors: created.payload.honors } : {}),
        ...('characterClass' in created.payload ? {
          characterClass: created.payload.characterClass, health: created.payload.health,
        } : {}),
        resources: 'resources' in created.payload
          ? created.payload.resources
          : DEFAULT_CHARACTER_RESOURCES,
        ...(created.payload.wallet ? { wallet: created.payload.wallet } : {}),
      });
    } else if (event.type === 'character.supply_gathered') {
      if (!state) throw new Error('Supply collection before creation.');
      const collected = SupplyGatheredEventSchema.parse(publicEvent).payload;
      if (collected.characterId !== state.characterId || state.inventory.some((item) => item.id === collected.item.id)) {
        throw new Error('Invalid supply collection.');
      }
      const prior = state.supplyCollections.find((entry) => entry.sourceId === collected.sourceId && entry.cycle === collected.cycle);
      state = CharacterProjectionSchema.parse({
        ...state, revision: event.aggregateVersion,
        inventory: [...state.inventory, collected.item],
        supplyCollections: [
          ...state.supplyCollections.filter((entry) => entry.cycle === collected.cycle && entry.sourceId !== collected.sourceId),
          { sourceId: collected.sourceId, cycle: collected.cycle, count: (prior?.count ?? 0) + 1 },
        ],
      });
    } else if (event.type === 'character.fishing_cast_started') {
      if (!state) throw new Error('Fishing cast started before character creation.');
      const started = FishingCastStartedEventSchema.parse(publicEvent).payload;
      if (started.characterId !== state.characterId || state.activeFishing || state.activeWoodcutting ||
          started.cast.locationId !== state.locationId ||
          !state.inventory.some((item) => item.id === started.cast.rodItemId && item.fishingRod?.qualityId === started.cast.rodQualityId)) {
        throw new Error(`Invalid fishing cast start at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({ ...state, activeFishing: started.cast, revision: event.aggregateVersion });
    } else if (event.type === 'character.fishing_cast_advanced') {
      if (!state) throw new Error('Fishing cast advanced before character creation.');
      const advanced = FishingCastAdvancedEventSchema.parse(publicEvent).payload;
      const cast = state.activeFishing;
      if (!cast || advanced.characterId !== state.characterId || advanced.castId !== cast.castId ||
          advanced.ticksCompleted < cast.ticksCompleted ||
          (advanced.status !== 'interrupted' && advanced.ticksCompleted === cast.ticksCompleted) ||
          advanced.ticksCompleted > cast.ticksRequired ||
          (advanced.status !== 'interrupted' && advanced.tickRolls.length !== advanced.ticksCompleted - cast.ticksCompleted) ||
          advanced.tickRolls.some((roll, index) => roll.tick !== cast.ticksCompleted + index + 1) ||
          (advanced.status === 'waiting' && advanced.ticksCompleted >= cast.ticksRequired) ||
          (advanced.status === 'no-bite' && advanced.ticksCompleted !== cast.ticksRequired) ||
          (advanced.status === 'interrupted' && advanced.item)) {
        throw new Error(`Invalid fishing progress at revision ${event.aggregateVersion}.`);
      }
      if (advanced.item && state.inventory.some((item) => item.id === advanced.item!.id)) {
        throw new Error(`Duplicate fish item at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        ...(advanced.status === 'waiting'
          ? { activeFishing: { ...cast, ticksCompleted: advanced.ticksCompleted } }
          : { activeFishing: undefined }),
        ...(advanced.item ? { inventory: [...state.inventory, advanced.item] } : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.woodcutting_action_started') {
      if (!state) throw new Error('Woodcutting action started before character creation.');
      const started = WoodcuttingActionStartedEventSchema.parse(publicEvent).payload;
      const axe = state.inventory.find((item) => item.id === started.action.axeItemId);
      if (started.characterId !== state.characterId || state.activeWoodcutting || state.activeFishing ||
          started.action.locationId !== state.locationId || !axe?.woodcuttingAxe ||
          (state.woodcutting?.level ?? 1) < axe.woodcuttingAxe.requiredLevel) {
        throw new Error(`Invalid woodcutting start at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        activeWoodcutting: started.action,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.woodcutting_action_advanced') {
      if (!state) throw new Error('Woodcutting action advanced before character creation.');
      const advanced = WoodcuttingActionAdvancedEventSchema.parse(publicEvent).payload;
      const action = state.activeWoodcutting;
      const skillExperience = advanced.skillExperienceAwarded;
      const expectedExperience = (state.woodcutting?.experience ?? 0) + skillExperience;
      let expectedLevel = 1;
      while (expectedLevel < 99 && expectedExperience >= 25 * expectedLevel * expectedLevel) expectedLevel += 1;
      const hasLog = advanced.status === 'logged';
      const validLogItem = advanced.item
        ? advanced.item.stackable === true && advanced.item.quantity === 1 &&
          advanced.item.typeId === advanced.logTypeId &&
          !state.inventory.some((item) => item.id === advanced.item!.id || (item.stackable && item.typeId === advanced.item!.typeId))
        : true;
      const stack = advanced.stackItemId
        ? state.inventory.find((item) => item.id === advanced.stackItemId)
        : undefined;
      if (!action || advanced.characterId !== state.characterId || advanced.actionId !== action.actionId ||
          advanced.ticksCompleted < action.ticksCompleted || advanced.ticksCompleted > action.ticksRequired ||
          (['waiting', 'logged', 'no-log'].includes(advanced.status) &&
            advanced.tickRolls.length !== advanced.ticksCompleted - action.ticksCompleted) ||
          advanced.tickRolls.some((roll, index) => roll.tick !== action.ticksCompleted + index + 1) ||
          (advanced.status === 'waiting' && (advanced.ticksCompleted <= action.ticksCompleted || advanced.ticksCompleted >= action.ticksRequired || advanced.tickRolls.some((roll) => roll.success) || skillExperience !== 0 || advanced.item || advanced.stackItemId)) ||
          (advanced.status === 'logged' && (!advanced.tickRolls.some((roll) => roll.success) || skillExperience <= 0 || (advanced.item === undefined) === (advanced.stackItemId === undefined) || !advanced.logTypeId || !advanced.logLabel)) ||
          (advanced.status === 'no-log' && (advanced.ticksCompleted !== action.ticksRequired || advanced.tickRolls.some((roll) => roll.success) || skillExperience !== 0 || advanced.item || advanced.stackItemId)) ||
          (['interrupted', 'tree-depleted'].includes(advanced.status) && (advanced.tickRolls.length || skillExperience || advanced.item || advanced.stackItemId)) ||
          (advanced.status !== 'logged' && (advanced.logTypeId || advanced.logLabel || advanced.treeDepleted)) ||
          (hasLog ? expectedExperience !== advanced.totalExperience : advanced.totalExperience !== (state.woodcutting?.experience ?? 0)) ||
          (hasLog ? advanced.level !== expectedLevel : advanced.level !== (state.woodcutting?.level ?? 1)) ||
          !validLogItem ||
          (advanced.stackItemId && (!stack?.stackable || stack.typeId !== advanced.logTypeId ||
            advanced.stackQuantity !== (stack.quantity ?? 1) + 1)) ||
          (!advanced.stackItemId && advanced.stackQuantity !== undefined)) {
        throw new Error(`Invalid woodcutting progress at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        ...(advanced.status === 'waiting'
          ? { activeWoodcutting: { ...action, ticksCompleted: advanced.ticksCompleted } }
          : { activeWoodcutting: undefined }),
        ...(advanced.item ? { inventory: [...state.inventory, advanced.item] } : {}),
        ...(advanced.stackItemId
          ? { inventory: state.inventory.map((item) => item.id === advanced.stackItemId
            ? { ...item, quantity: advanced.stackQuantity }
            : item) }
          : {}),
        ...(hasLog ? {
          woodcutting: { experience: advanced.totalExperience, level: advanced.level },
        } : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.daily_job_changed') {
      if (!state) throw new Error('Daily job before creation.');
      const changed = DailyJobChangedEventSchema.parse(publicEvent).payload;
      const { job, consumedItemIds, gold, experience } = changed;
      const consumedItemQuantities = changed.consumedItemQuantities ?? [];
      const matches = (entry: typeof job) => entry.boardId === job.boardId && entry.cycle === job.cycle && entry.jobId === job.jobId;
      const prior = state.dailyJobs.find(matches);
      const consumed = new Set(consumedItemIds);
      const partialConsumption = new Map(consumedItemQuantities.map(({ itemId, quantity }) => [itemId, quantity]));
      const consumedQuantity = consumedItemIds.reduce((total, itemId) => {
        const item = state!.inventory.find((entry) => entry.id === itemId);
        return total + (item?.stackable ? item.quantity ?? 1 : 1);
      }, 0) +
        consumedItemQuantities.reduce((total, entry) => total + entry.quantity, 0);
      const terms = prior?.details ?? job.details;
      if (changed.characterId !== state.characterId || state.wallet?.currencyId !== changed.currencyId ||
          (job.details && job.details.id !== job.jobId) ||
          consumed.size !== consumedItemIds.length ||
          partialConsumption.size !== consumedItemQuantities.length ||
          consumedItemQuantities.some(({ itemId, quantity }) => {
            const item = state!.inventory.find((entry) => entry.id === itemId);
            return consumed.has(itemId) || !item?.stackable || !item.quantity || quantity >= item.quantity;
          }) ||
          consumedItemIds.some((id) => !state!.inventory.some((item) => item.id === id && !item.questBound)) ||
          (job.status === 'active' ? prior || gold || experience || consumedQuantity : prior?.status !== 'active') ||
          (job.status === 'completed' && terms && (
            gold !== terms.gold || experience !== terms.experience || consumedQuantity !== terms.quantity ||
            consumedItemIds.some((id) => state!.inventory.find((item) => item.id === id)?.typeId !== terms.supplyTypeId) ||
            consumedItemQuantities.some(({ itemId }) => state!.inventory.find((item) => item.id === itemId)?.typeId !== terms.supplyTypeId)
          )) ||
          [...consumed].some((id) => characterHasEquippedItem(state!.equipment, id)) ||
          [...partialConsumption.keys()].some((id) => characterHasEquippedItem(state!.equipment, id))) {
        throw new Error('Invalid daily job transition.');
      }
      state = CharacterProjectionSchema.parse({
        ...state, revision: event.aggregateVersion,
        dailyJobs: [...state.dailyJobs.filter((entry) => entry.cycle === job.cycle && !matches(entry)), job],
        inventory: state.inventory.flatMap((item) => {
          if (consumed.has(item.id)) return [];
          const amount = partialConsumption.get(item.id);
          if (!amount) return [item];
          const { sharedItemId: _sharedItemId, ...detached } = item;
          return [{ ...detached, quantity: (item.quantity ?? 1) - amount }];
        }),
        itemLocations: state.itemLocations.filter((entry) =>
          !consumed.has(entry.item.id) && !(partialConsumption.has(entry.item.id) && entry.item.sharedItemId)),
        wallet: { ...state.wallet, balance: state.wallet.balance + gold },
        advancement: { ...state.advancement, experience: (state.advancement?.experience ?? 0) + experience, level: changed.level },
        ...(state.health ? { health: { ...state.health, maximum: changed.maximumHealth } } : {}),
      });
    } else if (event.type === 'character.class_selected') {
      if (!state) throw new Error('Class selection before creation.');
      const selected = CharacterClassSelectedEventSchema.parse(publicEvent).payload;
      if (state.characterClass || selected.characterId !== state.characterId ||
          state.combat?.status === 'active' ||
          JSON.stringify(selected.attributes) !== JSON.stringify(selected.characterClass.attributes) ||
          (state.health !== undefined && selected.health.current > state.health.current) ||
          selected.health.current > selected.health.maximum) {
        throw new Error('Invalid class selection event.');
      }
      state = CharacterProjectionSchema.parse({ ...state, characterClass: selected.characterClass,
        attributes: selected.attributes, health: selected.health, revision: event.aggregateVersion });
    } else if (event.type === 'character.ability_resource_spent') {
      if (!state) throw new Error('Ability resource spending before creation.');
      const spent = CharacterAbilityResourceSpentEventSchema.parse(publicEvent).payload;
      const ability = state.characterClass?.coreAction;
      const pool = state.resources[spent.cost.resource];
      if (abilityActionIds.has(spent.actionId) || spent.characterId !== state.characterId || ability?.id !== spent.abilityId ||
          ability.revision !== spent.abilityRevision ||
          JSON.stringify(ability.cost) !== JSON.stringify(spent.cost) ||
          spent.remaining !== pool.current - spent.cost.amount) throw new Error('Invalid ability resource spending.');
      abilityActionIds.add(spent.actionId);
      state = CharacterProjectionSchema.parse({ ...state, resources: { ...state.resources,
        [spent.cost.resource]: { ...pool, current: spent.remaining } }, revision: event.aggregateVersion });
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
      const { characterId, locationId, currencyId, listingId, price, item, repeatable } = purchased.payload;
      if (
        characterId !== state.characterId ||
        locationId !== state.locationId ||
        !state.wallet ||
        state.wallet.currencyId !== currencyId ||
        state.wallet.balance < price ||
        state.inventory.some((candidate) => candidate.id === item.id) ||
        (!repeatable && state.purchasedMerchantListingIds.includes(listingId))
      ) {
        throw new Error(`Invalid merchant purchase at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: { ...state.wallet, balance: state.wallet.balance - price },
        inventory: [...state.inventory, item],
        itemLocations: [...state.itemLocations, { item, locationId: null }],
        purchasedMerchantListingIds: repeatable
          ? state.purchasedMerchantListingIds
          : [...state.purchasedMerchantListingIds, listingId],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.crafting_completed') {
      if (!state) throw new Error('Crafting completion encountered before character creation.');
      const crafted = CharacterCraftingCompletedEventSchema.parse(publicEvent).payload;
      const { recipe, quantity, materialConsumptions, outputItems } = crafted;
      const materialAmounts = new Map<string, number>();
      const replacements = new Map<string, InventoryItemProjection | null>();
      const consumedItemIds = new Set<string>();
      const validOutputs = outputItems.every((item) =>
        item.typeId === recipe.outputTypeId &&
        item.label === recipe.outputLabel &&
        item.description === recipe.outputDescription &&
        JSON.stringify(item.equipment ?? null) === JSON.stringify(recipe.equipment ?? null) &&
        Object.keys(item).every((key) => ['id', 'typeId', 'label', 'description', 'equipment'].includes(key)),
      );
      for (const consumption of materialConsumptions) {
        const item = state.inventory.find((candidate) => candidate.id === consumption.itemId);
        const itemLocation = state.itemLocations.find((entry) => entry.item.id === consumption.itemId);
        const ingredient = recipe.ingredients.find((candidate) => candidate.typeId === consumption.typeId);
        if (
          !item ||
          (itemLocation !== undefined && itemLocation.locationId !== null) ||
          item.typeId !== consumption.typeId ||
          !ingredient ||
          consumedItemIds.has(consumption.itemId) ||
          consumption.kind !== (ingredient.consumeUses ? 'uses' : 'quantity')
        ) {
          throw new Error(`Invalid crafting material at revision ${event.aggregateVersion}.`);
        }
        consumedItemIds.add(consumption.itemId);
        materialAmounts.set(
          consumption.typeId,
          (materialAmounts.get(consumption.typeId) ?? 0) + consumption.amount,
        );
        if (consumption.kind === 'uses') {
          if ((item.usesRemaining ?? 0) < consumption.amount) {
            throw new Error(`Insufficient item uses at revision ${event.aggregateVersion}.`);
          }
          const usesRemaining = item.usesRemaining! - consumption.amount;
          replacements.set(consumption.itemId, usesRemaining > 0 ? { ...item, usesRemaining } : null);
        } else if (item.stackable) {
          if ((item.quantity ?? 0) < consumption.amount) {
            throw new Error(`Insufficient material quantity at revision ${event.aggregateVersion}.`);
          }
          const quantityRemaining = item.quantity! - consumption.amount;
          replacements.set(consumption.itemId, quantityRemaining > 0
            ? { ...item, quantity: quantityRemaining }
            : null);
        } else if (consumption.amount === 1) {
          replacements.set(consumption.itemId, null);
        } else {
          throw new Error(`Invalid unstackable material quantity at revision ${event.aggregateVersion}.`);
        }
      }
      const experienceAwardedHundredths = Math.round(recipe.experience * 100) * quantity;
      const totalExperienceHundredths =
        (state.crafting?.experienceHundredths ?? 0) + experienceAwardedHundredths;
      let expectedLevel = 1;
      while (expectedLevel < 99 && totalExperienceHundredths >= 2500 * expectedLevel * expectedLevel) {
        expectedLevel += 1;
      }
      const hasRequiredTools = recipe.toolTypeIds.every((typeId) =>
        state!.inventory.some((item) => item.typeId === typeId && !consumedItemIds.has(item.id)),
      );
      if (
        crafted.characterId !== state.characterId ||
        crafted.locationId !== state.locationId ||
        state.combat?.status === 'active' ||
        state.activeFishing ||
        state.activeWoodcutting ||
        (state.health && state.health.current <= 0) ||
        (state.crafting?.level ?? 1) < recipe.requiredLevel ||
        !hasRequiredTools ||
        !validOutputs ||
        outputItems.length !== quantity ||
        new Set(outputItems.map((item) => item.id)).size !== outputItems.length ||
        outputItems.some((item) =>
          state!.inventory.some((existing) => existing.id === item.id) ||
          state!.itemLocations.some((entry) => entry.item.id === item.id),
        ) ||
        recipe.ingredients.some((ingredient) =>
          (materialAmounts.get(ingredient.typeId) ?? 0) !== ingredient.quantityPerCraft * quantity,
        ) ||
        [...materialAmounts.keys()].some((typeId) =>
          !recipe.ingredients.some((ingredient) => ingredient.typeId === typeId),
        ) ||
        crafted.experienceAwardedHundredths !== experienceAwardedHundredths ||
        crafted.totalExperienceHundredths !== totalExperienceHundredths ||
        crafted.level !== expectedLevel
      ) {
        throw new Error(`Invalid crafting completion at revision ${event.aggregateVersion}.`);
      }
      const inventory = state.inventory.flatMap((item) => {
        if (!replacements.has(item.id)) return [item];
        const replacement = replacements.get(item.id);
        return replacement ? [replacement] : [];
      });
      const itemLocations = state.itemLocations.flatMap((entry) => {
        if (!replacements.has(entry.item.id)) return [entry];
        const replacement = replacements.get(entry.item.id);
        return replacement ? [{ ...entry, item: replacement }] : [];
      });
      state = CharacterProjectionSchema.parse({
        ...state,
        crafting: {
          experienceHundredths: crafted.totalExperienceHundredths,
          level: crafted.level,
        },
        inventory: [...inventory, ...outputItems],
        itemLocations: [
          ...itemLocations,
          ...outputItems.map((item) => ({ item, locationId: null })),
        ],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.inn_rest_completed') {
      if (!state) throw new Error('Inn rest encountered before character creation.');
      const rested = CharacterInnRestCompletedEventSchema.parse(publicEvent);
      const { characterId, locationId, currencyId, price, healthRestored, health } = rested.payload;
      const previousHealth = state.health;
      const previousHealthCurrent = previousHealth?.current ?? health.maximum;
      const previousHealthMaximum = previousHealth?.maximum ?? health.maximum;
      const resourcesV2 = rested.version === 2 ? rested.payload.resources : state.resources;
      const staminaRestoredV2 = rested.version === 2 ? rested.payload.staminaRestored : 0;
      const manaRestoredV2 = rested.version === 2 ? rested.payload.manaRestored : 0;
      if (
        characterId !== state.characterId ||
        locationId !== state.locationId ||
        state.combat?.status === 'active' ||
        previousHealthCurrent <= 0 ||
        !state.wallet ||
        state.wallet.currencyId !== currencyId ||
        state.wallet.balance < price ||
        health.maximum !== previousHealthMaximum ||
        health.current !== health.maximum ||
        healthRestored !== health.maximum - previousHealthCurrent ||
        (rested.version === 1 && healthRestored <= 0) ||
        resourcesV2.stamina.maximum !== state.resources.stamina.maximum ||
        resourcesV2.mana.maximum !== state.resources.mana.maximum ||
        resourcesV2.stamina.current !== resourcesV2.stamina.maximum ||
        resourcesV2.mana.current !== resourcesV2.mana.maximum ||
        staminaRestoredV2 !== resourcesV2.stamina.maximum - state.resources.stamina.current ||
        manaRestoredV2 !== resourcesV2.mana.maximum - state.resources.mana.current
      ) {
        throw new Error(`Invalid inn rest event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: { ...state.wallet, balance: state.wallet.balance - price },
        health,
        resources: resourcesV2,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.stamina_spent') {
      if (!state) throw new Error('Stamina expenditure encountered before character creation.');
      const spent = CharacterStaminaSpentEventSchema.parse(publicEvent);
      const previousStamina = state.resources.stamina;
      const nextStamina = spent.payload.resources.stamina;
      const encounter = state.combat;
      if (
        spent.payload.characterId !== state.characterId ||
        spent.payload.staminaSpent > previousStamina.current ||
        nextStamina.maximum !== previousStamina.maximum ||
        nextStamina.current !== previousStamina.current - spent.payload.staminaSpent ||
        spent.payload.resources.mana.current !== state.resources.mana.current ||
        spent.payload.resources.mana.maximum !== state.resources.mana.maximum ||
        (spent.payload.cause === 'solo-flee' && (
          encounter?.status !== 'fled' ||
          encounter.encounterId !== spent.payload.causeId ||
          encounter.lastAction !== 'flee'
        ))
      ) {
        throw new Error(`Invalid stamina expenditure at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        resources: spent.payload.resources,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.stamina_recovery_settled') {
      if (!state) throw new Error('Stamina recovery encountered before character creation.');
      const settled = CharacterStaminaRecoverySettledEventSchema.parse(publicEvent).payload;
      const at = settled.recovery.lastSettledAt;
      const expected = at ? settled.resetAnchor
        ? {
          stamina: state.resources.stamina,
          recovery: {
            ...state.staminaRecovery,
            lastSettledAt: new Date(Math.max(
              state.staminaRecovery.lastSettledAt ? Date.parse(state.staminaRecovery.lastSettledAt) : 0,
              Date.parse(at),
            )).toISOString(),
            fractionalCarry: 0,
          },
        }
        : resolveStaminaRecovery(state.resources.stamina, state.staminaRecovery, new Date(at))
        : undefined;
      if (
        settled.characterId !== state.characterId ||
        !at ||
        Date.parse(at) > Date.parse(event.occurredAt) ||
        !expected ||
        JSON.stringify(settled.resources.stamina) !== JSON.stringify(expected.stamina) ||
        settled.resources.mana.current !== state.resources.mana.current ||
        settled.resources.mana.maximum !== state.resources.mana.maximum ||
        JSON.stringify(settled.recovery) !== JSON.stringify(expected.recovery)
      ) {
        throw new Error(`Invalid stamina recovery event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        resources: settled.resources,
        staminaRecovery: settled.recovery,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.vital_recovery_settled') {
      if (!state) throw new Error('Vital recovery encountered before character creation.');
      const settled = CharacterVitalRecoverySettledEventSchema.parse(publicEvent).payload;
      const at = settled.recovery.lastSettledAt;
      const maximum = state.health?.maximum ?? settled.health.maximum;
      const baseHealth = state.health ?? { current: maximum, maximum };
      const expected = at ? settled.resetAnchor
        ? settled.settledAt
          ? (() => {
            const recovered = resolveVitalRecovery({
              health: baseHealth,
              stamina: state.resources.stamina,
              mana: state.resources.mana,
            }, state.staminaRecovery, new Date(settled.settledAt!));
            return {
              ...recovered,
              recovery: {
                ...recovered.recovery,
                lastSettledAt: new Date(Math.max(
                  Date.parse(recovered.recovery.lastSettledAt!),
                  Date.parse(at),
                )).toISOString(),
              },
            };
          })()
          : {
            health: baseHealth,
            stamina: state.resources.stamina,
            mana: state.resources.mana,
            recovery: {
              ...state.staminaRecovery,
              lastSettledAt: new Date(Math.max(
                state.staminaRecovery.lastSettledAt ? Date.parse(state.staminaRecovery.lastSettledAt) : 0,
                Date.parse(at),
              )).toISOString(),
              fractionalCarry: 0,
              healthFractionalCarry: 0,
              manaFractionalCarry: 0,
            },
          }
        : resolveVitalRecovery({
          health: baseHealth,
          stamina: state.resources.stamina,
          mana: state.resources.mana,
        }, state.staminaRecovery, new Date(at))
        : undefined;
      if (
        settled.characterId !== state.characterId ||
        !at ||
        Date.parse(at) > Date.parse(event.occurredAt) ||
        (settled.settledAt && (!settled.resetAnchor || Date.parse(settled.settledAt) > Date.parse(at))) ||
        !expected ||
        settled.health.maximum !== maximum ||
        (state.health?.current === 0) ||
        JSON.stringify(settled.health) !== JSON.stringify(expected.health) ||
        JSON.stringify(settled.resources.stamina) !== JSON.stringify(expected.stamina) ||
        JSON.stringify(settled.resources.mana) !== JSON.stringify(expected.mana) ||
        JSON.stringify(settled.recovery) !== JSON.stringify(expected.recovery)
      ) {
        throw new Error(`Invalid vital recovery event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        health: settled.health,
        resources: settled.resources,
        staminaRecovery: settled.recovery,
        ...(state.combat?.status === 'active' ? {
          combat: { ...state.combat, playerHealth: settled.health.current },
        } : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.posture_changed') {
      if (!state) throw new Error('Posture change encountered before character creation.');
      const changed = CharacterPostureChangedEventSchema.parse(publicEvent).payload;
      if (
        changed.characterId !== state.characterId ||
        changed.locationId !== state.locationId ||
        changed.posture === state.staminaRecovery.posture ||
        (changed.posture === 'resting' &&
          (state.combat?.status === 'active' || state.health?.current === 0))
      ) {
        throw new Error(`Invalid posture change at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        staminaRecovery: { ...state.staminaRecovery, posture: changed.posture },
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.combat_encounter_started') {
      if (!state) throw new Error('Combat encounter start encountered before character creation.');
      const started = CharacterCombatEncounterStartedEventSchema.parse(publicEvent);
      const encounter = {
        ...started.payload.encounter,
        opponentStyle: started.payload.encounter.opponentStyle ?? 'steady',
      };
      // Class events snapshot health. Historical classless starts retain their original policy.
      const maximumHealth = state.characterClass && state.health
        ? state.health.maximum : 6 + ((state.advancement?.level ?? 1) - 1) * 2;
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
          (consumedItemId === undefined || !characterHasEquippedItem(state.equipment, consumedItemId))
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
        characterHasEquippedItem(state.equipment, used.payload.itemId) ||
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
          characterHasEquippedItem(state!.equipment, item.id))
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
          characterHasEquippedItem(state.equipment, sourceItem.id) ||
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
        staminaRecovery: { posture: 'standing', lastSettledAt: null, fractionalCarry: 0 },
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
        characterHasEquippedItem(state.equipment, worldItemId)
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
        state.staminaRecovery.posture === 'resting' ||
        (moved.payload.movementCost !== undefined &&
          (moved.payload.movementCost !== MOVEMENT_STAMINA_COST ||
            state.resources.stamina.current < MOVEMENT_STAMINA_COST)) ||
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
        ...(moved.payload.movementCost !== undefined ? {
          resources: {
            ...state.resources,
            stamina: {
              ...state.resources.stamina,
              current: state.resources.stamina.current - MOVEMENT_STAMINA_COST,
            },
          },
        } : {}),
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
            ? { item: taken.payload.item, locationId: null }
            : entry)
          : [...state.itemLocations, { item: taken.payload.item, locationId: null }],
        ...(taken.payload.containerId
          ? {
            claimedContainerItemIds: state.claimedContainerItemIds.includes(taken.payload.item.id)
              ? state.claimedContainerItemIds
              : [...state.claimedContainerItemIds, taken.payload.item.id],
          }
          : {}),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_granted') {
      if (!state) throw new Error('Item granted event encountered before character creation.');
      const granted = CharacterItemGrantedEventSchema.parse(publicEvent);
      if (granted.payload.characterId !== state.characterId ||
          state.inventory.some((item) => item.id === granted.payload.item.id)) {
        throw new Error(`Invalid item grant at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: [...state.inventory, granted.payload.item],
        itemLocations: state.itemLocations.some((entry) => entry.item.id === granted.payload.item.id)
          ? state.itemLocations.map((entry) => entry.item.id === granted.payload.item.id
            ? { item: granted.payload.item, locationId: null }
            : entry)
          : [...state.itemLocations, { item: granted.payload.item, locationId: null }],
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
        characterHasEquippedItem(state.equipment, dropped.payload.item.id) ||
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
          ? { item: dropped.payload.item, locationId: dropped.payload.locationId }
          : entry),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_stored') {
      if (!state) throw new Error('Item stored event encountered before character creation.');
      const stored = CharacterItemStoredEventSchema.parse(publicEvent);
      const carriedItem = state.inventory.find((item) => item.id === stored.payload.item.id);
      const itemLocation = state.itemLocations.find((entry) => entry.item.id === stored.payload.item.id);
      if (
        stored.payload.characterId !== state.characterId ||
        stored.payload.locationId !== state.locationId ||
        !carriedItem ||
        carriedItem.questBound === true ||
        characterHasEquippedItem(state.equipment, stored.payload.item.id) ||
        itemLocation?.locationId !== null ||
        carriedItem.typeId !== stored.payload.item.typeId ||
        carriedItem.label !== stored.payload.item.label ||
        carriedItem.description !== stored.payload.item.description ||
        carriedItem.stackable !== stored.payload.item.stackable ||
        carriedItem.quantity !== stored.payload.item.quantity
      ) {
        throw new Error(`Invalid item stored event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: state.inventory.filter((item) => item.id !== stored.payload.item.id),
        itemLocations: state.itemLocations.map((entry) => entry.item.id === stored.payload.item.id
          ? {
            item: stored.payload.item,
            locationId: stored.payload.locationId,
            containerId: stored.payload.containerId,
          }
          : entry),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.equipment_changed') {
      if (!state) throw new Error('Equipment event encountered before character creation.');
      const changed = CharacterEquipmentChangedEventSchema.parse(publicEvent);
      const { characterId, slot, itemId } = changed.payload;
      const item = itemId ? state.inventory.find((candidate) => candidate.id === itemId) : undefined;
      const previousItemId = equipmentItemIdForSlot(state.equipment, slot);
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
          [`${slot}ItemId`]: itemId,
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
    } else if (event.type === 'character.npc_dialogue_restarted') {
      if (!state) throw new Error('NPC dialogue restart event encountered before character creation.');
      const restarted = CharacterNpcDialogueRestartedEventSchema.parse(publicEvent);
      if (restarted.payload.characterId !== state.characterId) {
        throw new Error(`Invalid NPC dialogue restart event at revision ${event.aggregateVersion}.`);
      }
      const existingProgress = state.npcProgress.find((entry) => entry.npcId === restarted.payload.npcId);
      const preservedFlags = new Set(restarted.payload.preservedProgressFlagIds);
      if (
        preservedFlags.size !== restarted.payload.preservedProgressFlagIds.length ||
        restarted.payload.preservedProgressFlagIds.some((flagId) => !existingProgress?.progressFlagIds.includes(flagId))
      ) {
        throw new Error(`Invalid preserved NPC dialogue progress at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        npcProgress: existingProgress
          ? preservedFlags.size
            ? state.npcProgress.map((entry) => entry.npcId === restarted.payload.npcId
              ? { npcId: entry.npcId, progressFlagIds: [...preservedFlags] }
              : entry)
            : state.npcProgress.filter((entry) => entry.npcId !== restarted.payload.npcId)
          : state.npcProgress,
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
    } else if (event.type === 'character.corpse_gold_received') {
      if (!state) throw new Error('Corpse gold receipt encountered before character creation.');
      const received = CharacterCorpseGoldReceivedEventSchema.parse(publicEvent);
      const { characterId, corpseId, currencyId, amount } = received.payload;
      const nextBalance = state.wallet ? state.wallet.balance + amount : Number.MAX_SAFE_INTEGER;
      if (
        characterId !== state.characterId ||
        !state.wallet ||
        state.wallet.currencyId !== currencyId ||
        state.claimedCorpseGoldIds.includes(corpseId) ||
        !Number.isSafeInteger(nextBalance) ||
        nextBalance > 2_147_483_647
      ) {
        throw new Error(`Invalid corpse gold receipt at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        wallet: { ...state.wallet, balance: nextBalance },
        claimedCorpseGoldIds: [...state.claimedCorpseGoldIds, corpseId],
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
  if (state?.characterClass) {
    const ability = state.characterClass.coreAction;
    const available = state.resources[ability.cost.resource].current >= ability.cost.amount;
    state = { ...state, availableClassActions: [{ ...ability, available,
      ...(!available ? { unavailableReason: `You need ${ability.cost.amount} ${ability.cost.resource}.` } : {}),
    }] };
  }
  if (cache) {
    checkpoints.set(events, { state, count: events.length, pvp: pvpOutcomeEncounterIds,
      team: teamCombatOutcomeEncounterIds, victories: teamCombatVictoryEncounterIds, abilities: abilityActionIds });
    prefixes.delete(events);
    return structuredClone(state);
  }
  return state;
}
