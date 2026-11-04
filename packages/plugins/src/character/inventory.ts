import {
  characterHasEquippedItem,
  equipmentItemIdForSlot,
  CharacterSharedItemRelinquishedEventSchema,
  CharacterItemTakenEventSchema,
  CharacterItemDroppedEventSchema,
  CharacterItemStoredEventSchema,
  CharacterItemUsedEventSchema,
  CharacterEquipmentChangedEventSchema,
  TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema,
  PutCharacterItemCommandSchema,
  EquipCharacterItemCommandSchema,
  UnequipCharacterItemCommandSchema,
  UseCharacterItemCommandSchema,
  WorldCorpseGoldClaimedEventSchema,
  WorldItemClaimedEventSchema,
} from '@mudd/contracts';
import {
  RuleViolationError,
  type EngineCommandContext,
  type PluginContext,
} from '@mudd/engine-core';
import {
  worldItemClaimEffect,
  worldItemDropEffect,
  worldCorpseGoldCreditEffect,
  worldItemsStreamId,
  type WorldItemsStateCapability,
} from '../world-items.js';
import {
  objectLifecycleRescheduledEvent,
  objectLifecycleStreamId,
  projectObjectLifecycle,
} from '../object-lifecycle.js';
import {
  assertCharacterAlive,
  assertCharacterStanding,
  isInSharedCombat,
  type CharacterStateCapability,
} from './state.js';

type InventoryRegistrations = Pick<PluginContext, 'registerCommand'>;
type ProjectedWorldCorpse =
  Awaited<ReturnType<WorldItemsStateCapability['load']>>['corpses'][number];

async function rescheduleEmptyCorpse(
  context: EngineCommandContext,
  corpse: ProjectedWorldCorpse,
): Promise<{
  streamId: string;
  streamKind: 'non-character';
  expectedVersion: number;
  events: { type: string; version: number; payload: Record<string, unknown> }[];
} | undefined> {
  if (!corpse.expiresAt) return undefined;
  const currentExpiry = Date.parse(corpse.expiresAt);
  const emptyExpiry = context.now().getTime() + context.world.corpseLifecycle.emptyCorpseSeconds * 1000;
  const expiresAt = new Date(Math.min(currentExpiry, emptyExpiry)).toISOString();
  if (Date.parse(expiresAt) >= currentExpiry) return undefined;
  const streamId = objectLifecycleStreamId(corpse.corpseId);
  const events = await context.store.readStream(context.worldInstanceId, streamId);
  const lifecycle = projectObjectLifecycle(events);
  if (!lifecycle || lifecycle.state !== 'scheduled') return undefined;
  return {
    streamId,
    streamKind: 'non-character',
    expectedVersion: lifecycle.revision,
    events: [objectLifecycleRescheduledEvent({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: corpse.locationId,
      expiresAt,
    })],
  };
}

export function registerCharacterInventory(
  { registerCommand }: InventoryRegistrations,
  state: CharacterStateCapability,
  worldItems: WorldItemsStateCapability,
): void {
  registerCommand('character.take', TakeCharacterItemCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    assertCharacterStanding(character);
    if (character.inventory.some((item) => item.id === command.payload.itemId)) {
      throw new RuleViolationError('You are already carrying that item.');
    }
    const location = context.world.locations.find((item) => item.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const sharedState = await worldItems.load(context);
    const sharedItem = sharedState.items.find((entry) => entry.worldItemId === command.payload.itemId);
    if (sharedItem && sharedItem.locationId !== null) {
      const containingCorpse = sharedItem.containerId
        ? sharedState.corpses.find((corpse) => corpse.corpseId === sharedItem.containerId)
        : undefined;
      if (
        containingCorpse?.expiresAt &&
        Date.parse(containingCorpse.expiresAt) <= context.now().getTime()
      ) {
        throw new RuleViolationError('That corpse has already begun to decay beyond recovery.');
      }
      if (sharedItem.locationId !== character.locationId) {
        throw new RuleViolationError('That item is not available to take here.');
      }
      const remainingInCorpse = containingCorpse
        ? sharedState.items.some((entry) =>
          entry.containerId === containingCorpse.corpseId &&
          entry.worldItemId !== sharedItem.worldItemId)
        : true;
      const unclaimedGold = Boolean(
        containingCorpse &&
        containingCorpse.currencyAmount > 0 &&
        containingCorpse.goldItemId &&
        !containingCorpse.goldClaimed,
      );
      const lifecycleWrite = containingCorpse && !remainingInCorpse && !unclaimedGold
        ? await rescheduleEmptyCorpse(context, containingCorpse)
        : undefined;
      const eventPayload = {
        worldItemId: sharedItem.worldItemId,
        characterId: character.characterId,
        locationId: character.locationId,
      };
      WorldItemClaimedEventSchema.shape.payload.parse(eventPayload);
      return {
        streamId: worldItemsStreamId(context.worldInstanceId),
        streamKind: 'non-character',
        expectedVersion: sharedState.revision,
        events: [{ type: 'world.item_claimed', version: 1, payload: eventPayload }],
        ...(lifecycleWrite ? { companions: [lifecycleWrite] } : {}),
        effects: [worldItemClaimEffect({
          worldItemId: sharedItem.worldItemId,
          characterId: character.characterId,
          sourceLocationId: character.locationId,
          item: sharedItem.item,
        })],
      };
    }
    const corpseWithGold = sharedState.corpses.find((corpse) =>
      corpse.goldItemId === command.payload.itemId &&
      corpse.locationId === character.locationId &&
      !corpse.goldClaimed &&
      (!corpse.expiresAt || Date.parse(corpse.expiresAt) > context.now().getTime()),
    );
    const looseCurrency = sharedState.currencyDrops.find((drop) =>
      drop.dropId === command.payload.itemId && drop.locationId === character.locationId,
    );
    const currencySource = corpseWithGold
      ? {
        corpseId: corpseWithGold.corpseId,
        currencyId: corpseWithGold.currencyId,
        currencyAmount: corpseWithGold.currencyAmount,
      }
      : looseCurrency
        ? {
          corpseId: looseCurrency.corpseId,
          currencyId: looseCurrency.currencyId,
          currencyAmount: looseCurrency.amount,
        }
        : undefined;
    if (currencySource) {
      const currency = context.world.currency;
      if (
        !currency ||
        currency.id !== currencySource.currencyId ||
        !character.wallet ||
        character.wallet.currencyId !== currency.id
      ) {
        throw new RuleViolationError('This character’s wallet is not ready to collect that currency.');
      }
      if (character.wallet.balance > 2_147_483_647 - currencySource.currencyAmount) {
        throw new RuleViolationError('Your wallet cannot hold that much currency.');
      }
      const eventPayload = {
        corpseId: currencySource.corpseId,
        characterId: character.characterId,
        locationId: character.locationId,
        currencyId: currency.id,
        amount: currencySource.currencyAmount,
      };
      WorldCorpseGoldClaimedEventSchema.shape.payload.parse(eventPayload);
      const hasCorpseItems = corpseWithGold &&
        sharedState.items.some((item) => item.containerId === corpseWithGold.corpseId);
      const lifecycleWrite = corpseWithGold && !hasCorpseItems
        ? await rescheduleEmptyCorpse(context, corpseWithGold)
        : undefined;
      return {
        streamId: worldItemsStreamId(context.worldInstanceId),
        streamKind: 'non-character',
        expectedVersion: sharedState.revision,
        events: [{ type: 'world.corpse_gold_claimed', version: 1, payload: eventPayload }],
        ...(lifecycleWrite ? { companions: [lifecycleWrite] } : {}),
        effects: [worldCorpseGoldCreditEffect({
          characterId: character.characterId,
          corpseId: currencySource.corpseId,
          currencyId: currency.id,
          amount: currencySource.currencyAmount,
        })],
      };
    }
    const trackedItem = character.itemLocations.find((entry) => entry.item.id === command.payload.itemId);
    const authoredContainer = location.containers?.find((container) =>
      container.contents.some((candidate) => candidate.id === command.payload.itemId),
    );
    const containerItem = authoredContainer?.contents.find((candidate) =>
      candidate.id === command.payload.itemId &&
      !character.claimedContainerItemIds.includes(candidate.id),
    );
    const item = trackedItem
      ? trackedItem.locationId === character.locationId ? trackedItem.item : undefined
      : (location.takeables ?? []).find((candidate) => candidate.id === command.payload.itemId) ?? containerItem;
    if (!item) throw new RuleViolationError('That item is not available to take here.');
    const sourceContainerId = trackedItem?.containerId ??
      (containerItem ? authoredContainer?.id : undefined);
    const questBound = item.questBound === true || context.world.locations.some((worldLocation) =>
      worldLocation.takeables?.some((candidate) => candidate.id === item.id && candidate.questBound === true),
    );
    const inventoryItem = questBound ? { ...item, questBound: true } : item;
    const payload = {
      characterId: character.characterId,
      locationId: character.locationId,
      ...(sourceContainerId ? { containerId: sourceContainerId } : {}),
      item: {
        id: inventoryItem.id,
        ...(inventoryItem.typeId ? { typeId: inventoryItem.typeId } : {}),
        label: inventoryItem.label,
        description: inventoryItem.description,
        ...(inventoryItem.questBound ? { questBound: true } : {}),
        ...(inventoryItem.stackable !== undefined ? {
          stackable: inventoryItem.stackable,
          ...(inventoryItem.quantity !== undefined ? { quantity: inventoryItem.quantity } : {}),
        } : {}),
        ...(inventoryItem.usesRemaining !== undefined ? { usesRemaining: inventoryItem.usesRemaining } : {}),
        ...(inventoryItem.consumable ? { consumable: inventoryItem.consumable } : {}),
        ...(inventoryItem.equipment ? { equipment: inventoryItem.equipment } : {}),
        ...(inventoryItem.fishingRod ? { fishingRod: inventoryItem.fishingRod } : {}),
        ...(inventoryItem.woodcuttingAxe ? { woodcuttingAxe: inventoryItem.woodcuttingAxe } : {}),
      },
    };
    CharacterItemTakenEventSchema.shape.payload.parse(payload);
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.item_taken', version: 1, payload }],
    };
  });

  registerCommand('character.drop', DropCharacterItemCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    assertCharacterStanding(character);
    const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
    if (!item) throw new RuleViolationError('You are not carrying that item.');
    const questBound = item.questBound === true || context.world.locations.some((worldLocation) =>
      worldLocation.takeables?.some((candidate) => candidate.id === item.id && candidate.questBound === true),
    );
    if (questBound) throw new RuleViolationError('Quest items cannot be dropped.');
    if (characterHasEquippedItem(character.equipment, item.id)) {
      throw new RuleViolationError('Unequip that item before dropping it.');
    }
    if (item.sharedItemId) {
      const sharedState = await worldItems.load(context);
      const sharedItem = sharedState.items.find((candidate) => candidate.worldItemId === item.sharedItemId);
      if (sharedItem?.holderCharacterId !== character.characterId) {
        throw new RuleViolationError('That shared item is not currently held by this character.');
      }
      const payload = {
        characterId: character.characterId,
        worldItemId: item.sharedItemId,
        locationId: character.locationId,
      };
      CharacterSharedItemRelinquishedEventSchema.shape.payload.parse(payload);
      return {
        streamId: command.characterId,
        streamKind: 'character',
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.shared_item_relinquished', version: 1, payload }],
        effects: [worldItemDropEffect({
          worldItemId: item.sharedItemId,
          fromCharacterId: character.characterId,
          locationId: character.locationId,
          item,
        })],
      };
    }
    CharacterItemDroppedEventSchema.shape.payload.parse({
      characterId: character.characterId,
      locationId: character.locationId,
      item,
    });
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{
        type: 'character.item_dropped',
        version: 1,
        payload: { characterId: character.characterId, locationId: character.locationId, item },
      }],
    };
  });

  registerCommand('character.put', PutCharacterItemCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    assertCharacterStanding(character);
    const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
    if (!item) throw new RuleViolationError('You are not carrying that item.');
    const questBound = item.questBound === true || context.world.locations.some((worldLocation) =>
      worldLocation.takeables?.some((candidate) => candidate.id === item.id && candidate.questBound === true) ||
      worldLocation.containers?.some((container) =>
        container.contents.some((candidate) => candidate.id === item.id && candidate.questBound === true),
      ),
    );
    if (questBound) throw new RuleViolationError('Quest items cannot be put away.');
    if (characterHasEquippedItem(character.equipment, item.id)) {
      throw new RuleViolationError('Unequip that item before putting it away.');
    }
    const itemLocation = character.itemLocations.find((entry) => entry.item.id === item.id);
    if (!itemLocation || itemLocation.locationId !== null) {
      throw new RuleViolationError('That item is not available to put away.');
    }
    const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const authoredContainer = (location.containers ?? []).find((container) =>
      container.id === command.payload.containerId,
    );
    let sharedState: Awaited<ReturnType<WorldItemsStateCapability['load']>> | undefined;
    if (item.sharedItemId || !authoredContainer) {
      sharedState = await worldItems.load(context);
    }
    if (item.sharedItemId) {
      const sharedItem = sharedState?.items.find((candidate) =>
        candidate.worldItemId === item.sharedItemId,
      );
      if (sharedItem?.holderCharacterId !== character.characterId) {
        throw new RuleViolationError('That shared item is not currently held by this character.');
      }
    }
    const isCurrentCorpse = sharedState?.corpses.some((corpse) =>
      corpse.corpseId === command.payload.containerId &&
      corpse.locationId === character.locationId,
    ) ?? false;
    if (!authoredContainer && !isCurrentCorpse) {
      throw new RuleViolationError('That container is not here.');
    }
    if (authoredContainer?.capacity !== undefined) {
      const trackedItemIds = new Set(character.itemLocations.map((entry) => entry.item.id));
      const authoredContents = authoredContainer.contents.filter((containerItem) =>
        !character.claimedContainerItemIds.includes(containerItem.id) &&
        !trackedItemIds.has(containerItem.id),
      );
      const storedContents = character.itemLocations
        .filter((entry) =>
          entry.locationId === character.locationId &&
          entry.containerId === authoredContainer.id,
        )
        .map(({ item: storedItem }) => storedItem);
      const currentUnits = [...authoredContents, ...storedContents].reduce(
        (total, containerItem) => total + (containerItem.stackable ? containerItem.quantity ?? 1 : 1),
        0,
      );
      const itemUnits = item.stackable ? item.quantity ?? 1 : 1;
      if (currentUnits + itemUnits > authoredContainer.capacity) {
        throw new RuleViolationError(`${authoredContainer.label} cannot hold any more items.`);
      }
    }
    const payload = {
      characterId: character.characterId,
      locationId: character.locationId,
      containerId: command.payload.containerId,
      item,
    };
    CharacterItemStoredEventSchema.shape.payload.parse(payload);
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.item_stored', version: 1, payload }],
    };
  });

  registerCommand('character.equip', EquipCharacterItemCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    assertCharacterStanding(character);
    if (character.combat?.status === 'active' || await isInSharedCombat(context, character.characterId)) {
      throw new RuleViolationError('You cannot change equipment during an active encounter.');
    }
    const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
    if (!item) throw new RuleViolationError('You are not carrying that item.');
    if (!item.equipment) throw new RuleViolationError(`${item.label} cannot be equipped.`);
    const { slot } = item.equipment;
    const currentItemId = equipmentItemIdForSlot(character.equipment, slot);
    if (currentItemId === item.id) throw new RuleViolationError(`${item.label} is already equipped.`);
    const payload = { characterId: character.characterId, slot, itemId: item.id };
    CharacterEquipmentChangedEventSchema.shape.payload.parse(payload);
    return {
      streamId: character.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.equipment_changed', version: 1, payload }],
    };
  });

  registerCommand('character.unequip', UnequipCharacterItemCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    assertCharacterStanding(character);
    if (character.combat?.status === 'active' || await isInSharedCombat(context, character.characterId)) {
      throw new RuleViolationError('You cannot change equipment during an active encounter.');
    }
    const currentItemId = equipmentItemIdForSlot(character.equipment, command.payload.slot);
    if (!currentItemId) throw new RuleViolationError(`You have no ${command.payload.slot} equipped.`);
    const payload = { characterId: character.characterId, slot: command.payload.slot, itemId: null };
    CharacterEquipmentChangedEventSchema.shape.payload.parse(payload);
    return {
      streamId: character.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.equipment_changed', version: 1, payload }],
    };
  });

  registerCommand('character.use', UseCharacterItemCommandSchema, async (command, context) => {
    const character = await state.load(context, command.characterId);
    if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
    assertCharacterAlive(character);
    assertCharacterStanding(character);
    if (character.combat?.status === 'active') {
      throw new RuleViolationError('Use a healing item through your combat action while a fight is active.');
    }
    const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
    if (!item) throw new RuleViolationError('You are not carrying that item.');
    const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
    if (!location) throw new Error('The character location is not present in this world version.');
    const target = (location.interactables ?? []).find((candidate) => candidate.id === command.payload.targetId);
    if (!target) throw new RuleViolationError('That is not a usable target in this room.');
    const interaction = (location.itemUses ?? []).find((candidate) =>
      candidate.itemId === item.id && candidate.targetId === target.id,
    );
    if (!interaction) {
      throw new RuleViolationError(`You cannot use the ${item.label.toLocaleLowerCase()} on the ${target.label.toLocaleLowerCase()} here.`);
    }
    if (
      interaction.requiredVisitedLocationId &&
      !character.visitedLocationIds.includes(interaction.requiredVisitedLocationId)
    ) {
      const requiredLocation = context.world.locations.find((candidate) =>
        candidate.id === interaction.requiredVisitedLocationId,
      );
      throw new RuleViolationError(
        `You must first visit ${requiredLocation?.name ?? 'the required place'} before using the ${item.label.toLocaleLowerCase()} here.`,
      );
    }
    const missingPrerequisite = (interaction.requiresInteractionIds ?? []).some((interactionId) =>
      !character.itemUseObservations.some((observation) =>
        observation.interactionId === interactionId && observation.locationId === location.id,
      ),
    );
    if (missingPrerequisite) {
      throw new RuleViolationError(interaction.requiresInteractionMessage ?? 'That interaction is not ready yet.');
    }
    const alreadyUsed = character.itemUseObservations.some((observation) =>
      observation.interactionId === interaction.id && observation.locationId === location.id,
    );
    const payload = {
      characterId: character.characterId,
      locationId: location.id,
      itemId: item.id,
      targetId: target.id,
      interactionId: interaction.id,
      response: alreadyUsed ? interaction.repeatResponse ?? interaction.response : interaction.response,
    };
    CharacterItemUsedEventSchema.shape.payload.parse(payload);
    return {
      streamId: command.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [{ type: 'character.item_used', version: 1, payload }],
    };
  });
}
