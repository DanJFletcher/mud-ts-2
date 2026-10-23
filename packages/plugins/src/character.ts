import { z } from 'zod';
import {
  CharacterCreatedEventV2Schema,
  CharacterStaminaSpentEventSchema,
  DEFAULT_CHARACTER_RESOURCES,
  DEFAULT_CHARACTER_ATTRIBUTES,
  DEFAULT_CHARACTER_HONORS,
  FLEE_STAMINA_COST,
  CharacterSharedItemRelinquishedEventSchema,
  CharacterItemTakenEventSchema,
  CharacterItemDroppedEventSchema,
  CharacterItemUsedEventSchema,
  CharacterEquipmentChangedEventSchema,
  CharacterObjectReadEventSchema,
  CharacterRenamedEventSchema,
  CharacterArchivedEventSchema,
  CharacterRestoredEventSchema,
  RenameCharacterCommandSchema,
  ArchiveCharacterCommandSchema,
  RestoreCharacterCommandSchema,
  CreateCharacterCommandSchema,
  TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema,
  EquipCharacterItemCommandSchema,
  UnequipCharacterItemCommandSchema,
  UseCharacterItemCommandSchema,
  ReadCharacterObjectCommandSchema,
  LocationDescribeQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  LocationProjectionSchema,
  ReadableObjectProjectionSchema,
  ObjectInspectionProjectionSchema,
  locationGroupMembershipsForLocation,
  resolveLocationDisplayName,
  type CapabilityToken,
  WorldCorpseGoldClaimedEventSchema,
  WorldItemClaimedEventSchema,
} from '@mudd/contracts';
import {
  RuleViolationError,
  SYSTEM_ACTOR_ID,
  type EngineCommandContext,
  type EnginePlugin,
  type EventEffectContext,
  type QueryContext,
} from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';
import type { CharacterProjection } from '@mudd/contracts';
import {
  worldItemClaimEffect,
  worldItemDropEffect,
  worldCorpseGoldCreditEffect,
  worldItemsStateCapability,
  worldItemsStreamId,
  type WorldItemsStateCapability,
} from './world-items.js';
import { exitsForLocationState, resolveLocationState } from './location-state.js';
import {
  autonomousNpcStateCapability,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';

export interface CharacterStateCapability {
  load(context: EngineCommandContext | QueryContext, characterId: string): Promise<CharacterProjection | undefined>;
}

export function assertCharacterAlive(character: CharacterProjection): void {
  if (character.combat?.status === 'defeat' || character.health?.current === 0) {
    throw new RuleViolationError('Your character has died. Start a new character to begin again.');
  }
}

export const characterStateCapability = Object.freeze({
  id: 'mudd.character.state.v1',
  version: '1',
}) satisfies CapabilityToken<CharacterStateCapability>;

const TEAM_FLEE_STAMINA_EFFECT = 'mudd.character.team-flee-stamina';
const TeamFleeStaminaEffectSchema = z.object({
  characterId: z.string().min(1).max(128),
  encounterId: z.string().min(1).max(128),
}).strict();

export function teamFleeStaminaEffect(characterId: string, encounterId: string) {
  return {
    type: TEAM_FLEE_STAMINA_EFFECT,
    version: 1,
    payload: { characterId, encounterId },
  };
}

async function spendTeamFleeStamina(
  payload: z.infer<typeof TeamFleeStaminaEffectSchema>,
  context: EventEffectContext,
): Promise<void> {
  const history = await context.store.readStream(context.worldInstanceId, payload.characterId);
  const character = replayCharacter(history);
  if (!character || character.archived) {
    throw new Error('The party combat participant is no longer available.');
  }
  if (history.some((event) =>
    event.type === 'character.stamina_spent' &&
    (event.payload as { cause?: string; causeId?: string }).cause === 'team-flee' &&
    (event.payload as { causeId?: string }).causeId === payload.encounterId,
  )) return;
  const current = character.resources.stamina.current;
  if (current < FLEE_STAMINA_COST) {
    throw new Error('The party flee stamina cost cannot be applied to the current character resources.');
  }
  const eventPayload = CharacterStaminaSpentEventSchema.shape.payload.parse({
    characterId: payload.characterId,
    cause: 'team-flee',
    causeId: payload.encounterId,
    staminaSpent: FLEE_STAMINA_COST,
    resources: {
      ...character.resources,
      stamina: {
        ...character.resources.stamina,
        current: current - FLEE_STAMINA_COST,
      },
    },
  });
  const expectedVersion = history.at(-1)?.aggregateVersion ?? 0;
  const commandId = `team-flee-stamina:${context.effectId}:${expectedVersion}`;
  const payloadHash = `${payload.characterId}:${payload.encounterId}:${FLEE_STAMINA_COST}`;
  const prior = await context.store.lookupCommand(
    context.worldInstanceId,
    SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
  );
  if (prior?.receipt.ok) return;
  if (prior && !prior.receipt.ok && prior.receipt.code !== 'VERSION_CONFLICT') {
    throw new Error('The party flee stamina command could not be applied.');
  }
  const result = await context.store.append({
    worldInstanceId: context.worldInstanceId,
    streamId: payload.characterId,
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion,
    events: [{
      type: 'character.stamina_spent',
      version: 1,
      payload: eventPayload,
    }],
  });
  if (!result.receipt.ok) {
    throw new Error('Could not apply stamina spending for the party flee.');
  }
}

export const characterPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.character',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: ['mudd.character.state.v1'],
    requiredPlugins: { 'mudd.world-items': '^1.0.0' },
    eventSchemaVersions: {
      'character.created': 2,
      'character.stamina_spent': 1,
      'character.equipment_changed': 1,
      'character.shared_item_received': 1,
      'character.shared_item_relinquished': 1,
      'character.corpse_gold_received': 1,
      'character.respawned': 1,
    },
  },
  register({ registerCommand, registerQuery, registerEffect, provideCapability, requireCapability, optionalCapability }) {
    const worldItems = requireCapability<WorldItemsStateCapability>(worldItemsStateCapability);
    const autonomousNpcs = optionalCapability<AutonomousNpcStateCapability>(autonomousNpcStateCapability);
    const state: CharacterStateCapability = {
      async load(context, characterId) {
        if ('characterProjection' in context && context.characterProjection?.characterId === characterId) {
          return context.characterProjection;
        }
        return replayCharacter(await context.store.readStream(context.worldInstanceId, characterId));
      },
    };
    provideCapability(characterStateCapability, state);
    registerEffect(
      TEAM_FLEE_STAMINA_EFFECT,
      1,
      TeamFleeStaminaEffectSchema,
      spendTeamFleeStamina,
    );

    registerCommand('character.create', CreateCharacterCommandSchema, async (command, context) => {
      const name = command.payload.name.trim();
      if (!name || name.length > 48) throw new RuleViolationError('Choose a character name between 1 and 48 characters.');
      const startingLocation = context.world.locations[0];
      if (!startingLocation) throw new Error('This world has no starting location.');
      const characterId = context.makeId();
      const payload = {
        characterId,
        playerId: context.session.playerId,
        name,
        startingLocationId: startingLocation.id,
        ...(startingLocation.defaultStateId ? { startingStateId: startingLocation.defaultStateId } : {}),
        attributes: DEFAULT_CHARACTER_ATTRIBUTES,
        honors: DEFAULT_CHARACTER_HONORS,
        resources: DEFAULT_CHARACTER_RESOURCES,
        ...(context.world.currency
          ? {
            wallet: {
              currencyId: context.world.currency.id,
              balance: context.world.currency.startingBalance,
            },
          }
          : {}),
      };
      CharacterCreatedEventV2Schema.shape.payload.parse(payload);
      return {
        streamId: characterId,
        expectedVersion: 0,
        events: [{ type: 'character.created', version: 2, payload }],
      };
    });

    registerCommand('character.take', TakeCharacterItemCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      if (character.inventory.some((item) => item.id === command.payload.itemId)) {
        throw new RuleViolationError('You are already carrying that item.');
      }
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const sharedState = await worldItems.load(context);
      const sharedItem = sharedState.items.find((entry) => entry.worldItemId === command.payload.itemId);
      if (sharedItem) {
        if (sharedItem.locationId !== character.locationId) {
          throw new RuleViolationError('That item is not available to take here.');
        }
        const eventPayload = {
          worldItemId: sharedItem.worldItemId,
          characterId: character.characterId,
          locationId: character.locationId,
        };
        WorldItemClaimedEventSchema.shape.payload.parse(eventPayload);
        return {
          streamId: worldItemsStreamId(context.worldInstanceId),
          expectedVersion: sharedState.revision,
          events: [{ type: 'world.item_claimed', version: 1, payload: eventPayload }],
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
        !corpse.goldClaimed,
      );
      if (corpseWithGold) {
        const currency = context.world.currency;
        if (
          !currency ||
          currency.id !== corpseWithGold.currencyId ||
          !character.wallet ||
          character.wallet.currencyId !== currency.id
        ) {
          throw new RuleViolationError('This character’s wallet is not ready to collect that currency.');
        }
        if (character.wallet.balance > 2_147_483_647 - corpseWithGold.currencyAmount) {
          throw new RuleViolationError('Your wallet cannot hold that much currency.');
        }
        const eventPayload = {
          corpseId: corpseWithGold.corpseId,
          characterId: character.characterId,
          locationId: character.locationId,
          currencyId: currency.id,
          amount: corpseWithGold.currencyAmount,
        };
        WorldCorpseGoldClaimedEventSchema.shape.payload.parse(eventPayload);
        return {
          streamId: worldItemsStreamId(context.worldInstanceId),
          expectedVersion: sharedState.revision,
          events: [{ type: 'world.corpse_gold_claimed', version: 1, payload: eventPayload }],
          effects: [worldCorpseGoldCreditEffect({
            characterId: character.characterId,
            corpseId: corpseWithGold.corpseId,
            currencyId: currency.id,
            amount: corpseWithGold.currencyAmount,
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
      const questBound = item.questBound === true || context.world.locations.some((worldLocation) =>
        worldLocation.takeables?.some((candidate) => candidate.id === item.id && candidate.questBound === true),
      );
      const inventoryItem = questBound ? { ...item, questBound: true } : item;
      const payload = {
        characterId: character.characterId,
        locationId: character.locationId,
        ...(containerItem && authoredContainer ? { containerId: authoredContainer.id } : {}),
        item: {
          id: inventoryItem.id,
          label: inventoryItem.label,
          description: inventoryItem.description,
          ...(inventoryItem.questBound ? { questBound: true } : {}),
          ...(inventoryItem.consumable ? { consumable: inventoryItem.consumable } : {}),
          ...(inventoryItem.equipment ? { equipment: inventoryItem.equipment } : {}),
        },
      };
      CharacterItemTakenEventSchema.shape.payload.parse(payload);
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.item_taken', version: 1, payload }],
      };
    });

    registerCommand('character.drop', DropCharacterItemCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
      if (!item) throw new RuleViolationError('You are not carrying that item.');
      const questBound = item.questBound === true || context.world.locations.some((worldLocation) =>
        worldLocation.takeables?.some((candidate) => candidate.id === item.id && candidate.questBound === true),
      );
      if (questBound) throw new RuleViolationError('Quest items cannot be dropped.');
      if (character.equipment.weaponItemId === item.id || character.equipment.armorItemId === item.id) {
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
        expectedVersion: command.expectedVersion,
        events: [{
          type: 'character.item_dropped',
          version: 1,
          payload: { characterId: character.characterId, locationId: character.locationId, item },
        }],
      };
    });

    registerCommand('character.equip', EquipCharacterItemCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      if (character.combat?.status === 'active') {
        throw new RuleViolationError('You cannot change equipment during an active encounter.');
      }
      const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
      if (!item) throw new RuleViolationError('You are not carrying that item.');
      if (!item.equipment) throw new RuleViolationError(`${item.label} cannot be equipped.`);
      const { slot } = item.equipment;
      const currentItemId = slot === 'weapon'
        ? character.equipment.weaponItemId
        : character.equipment.armorItemId;
      if (currentItemId === item.id) throw new RuleViolationError(`${item.label} is already equipped.`);
      const payload = { characterId: character.characterId, slot, itemId: item.id };
      CharacterEquipmentChangedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.equipment_changed', version: 1, payload }],
      };
    });

    registerCommand('character.unequip', UnequipCharacterItemCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      if (character.combat?.status === 'active') {
        throw new RuleViolationError('You cannot change equipment during an active encounter.');
      }
      const currentItemId = command.payload.slot === 'weapon'
        ? character.equipment.weaponItemId
        : character.equipment.armorItemId;
      if (!currentItemId) throw new RuleViolationError(`You have no ${command.payload.slot} equipped.`);
      const payload = { characterId: character.characterId, slot: command.payload.slot, itemId: null };
      CharacterEquipmentChangedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.equipment_changed', version: 1, payload }],
      };
    });

    registerCommand('character.use', UseCharacterItemCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
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
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.item_used', version: 1, payload }],
      };
    });

    registerCommand('character.read', ReadCharacterObjectCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const readable = (location.readables ?? []).find((item) => item.id === command.payload.objectId);
      if (!readable) throw new RuleViolationError('That object is not readable from here.');
      const payload = {
        characterId: character.characterId,
        locationId: character.locationId,
        objectId: readable.id,
        label: readable.label,
        text: readable.text,
      };
      CharacterObjectReadEventSchema.shape.payload.parse(payload);
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.object_read', version: 1, payload }],
      };
    });

    registerCommand('character.rename', RenameCharacterCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const name = command.payload.name.trim();
      if (!name || name.length > 48) throw new RuleViolationError('Choose a character name between 1 and 48 characters.');
      CharacterRenamedEventSchema.shape.payload.parse({ characterId: character.characterId, name });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.renamed', version: 1, payload: { characterId: command.characterId, name } }],
      };
    });

    registerCommand('character.archive', ArchiveCharacterCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      CharacterArchivedEventSchema.shape.payload.parse({ characterId: character.characterId });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.archived', version: 1, payload: { characterId: command.characterId } }],
      };
    });

    registerCommand('character.restore', RestoreCharacterCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || !character.archived) throw new RuleViolationError('That archived character is no longer available.');
      CharacterRestoredEventSchema.shape.payload.parse({ characterId: character.characterId });
      return {
        streamId: command.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.restored', version: 1, payload: { characterId: command.characterId } }],
      };
    });

    registerQuery('location.describe', LocationDescribeQuerySchema, async (query, context) => {
      const character = await state.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const requestedLocationId = query.payload.locationId;
      if (requestedLocationId && requestedLocationId !== character.locationId) {
        throw new RuleViolationError('You can only inspect your current location.');
      }
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const roomNpcs = autonomousNpcs
        ? await autonomousNpcs.atLocation(context, location.id)
        : location.npcs ?? [];
      const locationState = resolveLocationState(location, character.locationStateId);
      const availableExits = exitsForLocationState(location, locationState?.id);
      const sharedState = await worldItems.load(context);
      const sharedItems = sharedState.items
        .filter((item) => item.locationId === character.locationId);
      const roomCorpses = sharedState.corpses
        .filter((corpse) => corpse.locationId === character.locationId)
        .map((corpse) => {
          const contents = sharedItems
            .filter((item) => item.containerId === corpse.corpseId)
            .map(({ worldItemId, item }) => ({
              id: worldItemId,
              label: item.label,
              description: item.description,
            }));
          if (!corpse.goldClaimed && corpse.goldItemId && corpse.currencyAmount > 0) {
            const currencyName = context.world.currency?.name ?? 'coins';
            contents.push({
              id: corpse.goldItemId,
              label: `${corpse.currencyAmount} ${currencyName}`,
              description: `${corpse.currencyAmount} ${currencyName} left by ${corpse.opponentName}.`,
            });
          }
          return { corpse, contents };
        });
      const trackedItemIds = new Set(character.itemLocations.map((entry) => entry.item.id));
      const visibleContainers = (location.containers ?? []).map((container) => ({
        ...container,
        contents: container.contents.filter((item) =>
          !character.claimedContainerItemIds.includes(item.id) && !trackedItemIds.has(item.id),
        ),
      }));
      const roomTakeables = [
        ...(location.takeables ?? []).filter((item) => !trackedItemIds.has(item.id)),
        ...character.itemLocations
          .filter((entry) => entry.locationId === location.id)
          .map(({ item }) => item),
      ];
      const roomDescriptionByItemId = new Map(
        context.world.locations.flatMap((worldLocation) =>
          (worldLocation.takeables ?? []).map(({ id, roomDescription }) => [id, roomDescription] as const),
        ),
      );
      const roomItemDescriptions = roomTakeables.flatMap((item) => {
        const roomDescription = roomDescriptionByItemId.get(item.id);
        return roomDescription ? [roomDescription] : [];
      });
      const sharedItemDescriptions = sharedItems
        .filter((item) => !item.containerId)
        .map(({ item }) => `${item.label} lies here.`);
      const containerDescriptions = visibleContainers.map((container) => {
        const roomDescription = container.roomDescription ?? `${container.label} is here.`;
        const contents = container.contents.length
          ? ` It contains ${container.contents.map((item) => item.label).join(', ')}.`
          : ' It is empty.';
        return `${roomDescription}${contents}`;
      });
      const corpseDescriptions = roomCorpses.map(({ corpse, contents }) =>
        `${corpse.description}${contents.length
          ? ` It contains ${contents.map((item) => item.label).join(', ')}.`
          : ' It is empty.'}`,
      );
      const includeNpcDescriptions = query.payload.includeNpcDescriptions === true;
      const roomNpcDescriptions = roomNpcs.map(({ name, description, activityDescription }) =>
        includeNpcDescriptions
          ? `${name} is here. ${description}`
          : `${name} is here${activityDescription ? `, ${activityDescription}` : ''}.`,
      );
      const interactableRoomDescriptions = (location.interactables ?? []).flatMap(({ roomDescription }) =>
        roomDescription ? [roomDescription] : [],
      );
      const innCurrency = location.inn ? context.world.currency : undefined;
      if (location.inn && !innCurrency) {
        throw new Error('An authored inn requires configured world currency.');
      }
      const shortName = locationState?.name ?? location.name;
      const locationGroups = locationGroupMembershipsForLocation(
        context.world.locationGroups,
        location.id,
      );
      const displayName = resolveLocationDisplayName(shortName, locationGroups);
      return LocationProjectionSchema.parse({
        worldInstanceId: context.worldInstanceId,
        locationId: location.id,
        ...(locationState ? { locationStateId: locationState.id } : {}),
        revision: character.revision,
        title: displayName.qualifiedName,
        shortName: displayName.shortName,
        qualifiedName: displayName.qualifiedName,
        locationGroups,
        description: [
          locationState?.description ?? location.description,
          ...roomItemDescriptions,
          ...sharedItemDescriptions,
          ...containerDescriptions,
          ...corpseDescriptions,
          ...interactableRoomDescriptions,
          ...roomNpcDescriptions,
        ].join('\n\n'),
        exits: availableExits.map((exit) => ({
          id: exit.id,
          label: exit.label,
          direction: exit.direction,
          available: !exit.requiredInteractionId || character.itemUseObservations.some((observation) =>
            observation.interactionId === exit.requiredInteractionId && observation.locationId === location.id,
          ),
          roadId: exit.roadId,
        })),
        objects: [
          ...(location.readables ?? []).map(({ id, label, description }) => ({
            id, label, description, readable: true, takeable: false,
          })),
          ...roomTakeables.map(({ id, label, description }) => ({
              id, label, description, readable: false, takeable: true,
          })),
          ...visibleContainers.flatMap((container) => [
            {
              id: container.id,
              label: container.label,
              description: container.description,
              readable: false,
              takeable: false,
              containerKind: container.kind,
              contents: container.contents.map(({ id, label, description }) => ({ id, label, description })),
            },
            ...container.contents.map(({ id, label, description }) => ({
              id,
              label,
              description,
              readable: false,
              takeable: true,
              containerId: container.id,
            })),
          ]),
          ...sharedItems.filter((item) => !item.containerId).map(({ worldItemId, item }) => ({
            id: worldItemId,
            label: item.label,
            description: item.description,
            readable: false,
            takeable: true,
          })),
          ...roomCorpses.flatMap(({ corpse, contents }) => [
            {
              id: corpse.corpseId,
              label: corpse.label,
              description: corpse.description,
              readable: false,
              takeable: false,
              containerKind: 'corpse' as const,
              contents,
            },
            ...contents.map((content) => ({
              ...content,
              readable: false,
              takeable: true,
              containerId: corpse.corpseId,
            })),
          ]),
          ...(location.interactables ?? []).map(({ id, label, description }) => ({
            id, label, description, readable: false, takeable: false,
          })),
        ],
        occupants: [],
        ...(location.inn && innCurrency ? {
          inn: {
            ...location.inn,
            currency: {
              id: innCurrency.id,
              name: innCurrency.name,
              symbol: innCurrency.symbol,
            },
          },
        } : {}),
        ...(roomNpcs.length
          ? {
            npcs: roomNpcs.map(({ id, name, description, activityDescription, combatProfile, shop }) => ({
              id,
              name,
              ...(activityDescription ? { activityDescription } : {}),
              ...(includeNpcDescriptions ? { description } : {}),
              canChallenge: Boolean(combatProfile),
              canShop: Boolean(shop),
            })),
          }
          : {}),
      });
    });

    registerQuery('object.read', ObjectReadQuerySchema, async (query, context) => {
      const character = await state.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const readable = (location.readables ?? []).find((item) => item.id === query.payload.objectId);
      if (!readable) throw new RuleViolationError('That object is not readable from here.');
      return ReadableObjectProjectionSchema.parse({
        id: readable.id,
        label: readable.label,
        text: readable.text,
      });
    });

    registerQuery('object.inspect', ObjectInspectQuerySchema, async (query, context) => {
      const character = await state.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const trackedItemIds = new Set(character.itemLocations.map((entry) => entry.item.id));
      const visibleContainers = (location.containers ?? []).map((container) => ({
        ...container,
        contents: container.contents.filter((item) =>
          !character.claimedContainerItemIds.includes(item.id) && !trackedItemIds.has(item.id),
        ),
      }));
      const roomContainers = visibleContainers.map((container) => ({
        id: container.id,
        label: container.label,
        description: [
          container.description,
          container.contents.length
            ? `It contains ${container.contents.map((item) => item.label).join(', ')}.`
            : 'It is empty.',
        ].join(' '),
      }));
      const sharedState = await worldItems.load(context);
      const sharedItems = sharedState.items
        .filter((item) => item.locationId === character.locationId);
      const roomCorpses = sharedState.corpses
        .filter((corpse) => corpse.locationId === character.locationId)
        .map(({ corpseId, label, description, opponentName, currencyAmount, currencyId, goldItemId, goldClaimed }) => {
          const contents = sharedItems
            .filter((item) => item.containerId === corpseId)
            .map(({ worldItemId, item }) => ({
              id: worldItemId,
              label: item.label,
              description: item.description,
            }));
          if (!goldClaimed && goldItemId && currencyAmount > 0) {
            const currencyName = context.world.currency?.name ?? 'coins';
            contents.push({
              id: goldItemId,
              label: `${currencyAmount} ${currencyName}`,
              description: `${currencyAmount} ${currencyName} left by ${opponentName}.`,
            });
          }
          return {
            id: corpseId,
            label,
            description: [
              description,
              contents.length
                ? `It contains ${contents.map((item) => item.label).join(', ')}.`
                : 'It is empty.',
            ].join(' '),
            contents,
            currencyId,
          };
        });
      const roomCorpseObjects = roomCorpses.map(({ id, label, description }) => ({ id, label, description }));
      const objectInRoom = [
        ...(location.readables ?? []),
        ...(location.takeables ?? []).filter((item) => !trackedItemIds.has(item.id)),
        ...(location.interactables ?? []),
        ...roomContainers,
        ...roomCorpseObjects,
        ...visibleContainers.flatMap((container) => container.contents),
        ...character.itemLocations
          .filter((entry) => entry.locationId === location.id)
          .map(({ item }) => item),
        ...sharedItems.map(({ worldItemId, item }) => ({
          ...item,
          id: worldItemId,
        })),
      ].find((item) => item.id === query.payload.objectId);
      const objectInPack = character.inventory.find((item) => item.id === query.payload.objectId);
      const object = objectInRoom ?? objectInPack;
      if (!object) throw new RuleViolationError('That object is not here or in your pack.');
      return ObjectInspectionProjectionSchema.parse({
        id: object.id,
        label: object.label,
        description: object.description,
      });
    });
  },
};
