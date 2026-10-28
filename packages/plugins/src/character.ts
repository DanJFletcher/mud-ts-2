import { z } from 'zod';
import {
  CharacterCreatedEventV2Schema,
  CharacterCreatedEventV3Schema,
  CharacterStaminaSpentEventSchema,
  CharacterVitalRecoverySettledEventSchema,
  CharacterPostureChangedEventSchema,
  CharacterRestCommandSchema,
  CharacterStandCommandSchema,
  CharacterStaminaRecoverySchema,
  resolveVitalRecovery,
  IsoDateTimeSchema,
  DEFAULT_CHARACTER_RESOURCES,
  DEFAULT_CHARACTER_ATTRIBUTES,
  DEFAULT_CHARACTER_HONORS,
  characterHasEquippedItem,
  equipmentItemIdForSlot,
  FLEE_STAMINA_COST,
  CharacterSharedItemRelinquishedEventSchema,
  CharacterItemTakenEventSchema,
  CharacterItemDroppedEventSchema,
  CharacterItemStoredEventSchema,
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
  PutCharacterItemCommandSchema,
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
  type NpcDefinition,
  type WorldPackDraft,
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
import {
  objectLifecycleRescheduledEvent,
  objectLifecycleStreamId,
  projectObjectLifecycle,
} from './object-lifecycle.js';
import { exitsForLocationState, resolveLocationState } from './location-state.js';
import {
  autonomousNpcStateCapability,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';
import { classCombatPolicyCapability, type ClassCombatPolicy } from './classes.js';
import { maximumHealthForLevel } from './character-stats.js';
import { interactionStreamId } from './interactions.js';

export interface CharacterStateCapability {
  load(context: EngineCommandContext | QueryContext, characterId: string): Promise<CharacterProjection | undefined>;
}

export function assertCharacterAlive(character: CharacterProjection): void {
  if (character.combat?.status === 'defeat' || character.health?.current === 0) {
    throw new RuleViolationError('Your character has died. Start a new character to begin again.');
  }
}

type ProjectedWorldCorpse =
  Awaited<ReturnType<WorldItemsStateCapability['load']>>['corpses'][number];

function corpseDecayDescription(
  corpse: ProjectedWorldCorpse,
  now: Date,
  showStages: boolean,
): string {
  if (!showStages || !corpse.createdAt || !corpse.expiresAt) return corpse.description;
  const created = Date.parse(corpse.createdAt);
  const expires = Date.parse(corpse.expiresAt);
  const remaining = expires - now.getTime();
  if (expires <= created || remaining <= 0) return corpse.description;
  const fraction = remaining / (expires - created);
  if (fraction <= 0.25) return `${corpse.description} The remains are fading quickly.`;
  if (fraction <= 0.5) return `${corpse.description} The body is breaking down, its outline softening.`;
  if (fraction <= 0.75) return `${corpse.description} The body has begun to weather and darken.`;
  return corpse.description;
}

async function rescheduleEmptyCorpse(
  context: EngineCommandContext,
  corpse: ProjectedWorldCorpse,
): Promise<{ streamId: string; expectedVersion: number; events: { type: string; version: number; payload: Record<string, unknown> }[] } | undefined> {
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
    expectedVersion: lifecycle.revision,
    events: [objectLifecycleRescheduledEvent({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: corpse.locationId,
      expiresAt,
    })],
  };
}

export function assertCharacterStanding(character: CharacterProjection): void {
  if (character.staminaRecovery.posture === 'resting') {
    throw new RuleViolationError('You are resting. Stand before taking that action.');
  }
}

export function staminaRecoveryEvent(
  character: CharacterProjection,
  settledAt: Date,
) {
  const health = character.health ?? {
    current: maximumHealthForLevel(
      character.advancement?.level ?? 1,
      character.attributes.constitution,
    ),
    maximum: maximumHealthForLevel(
      character.advancement?.level ?? 1,
      character.attributes.constitution,
    ),
  };
  const result = resolveVitalRecovery({
    health,
    stamina: character.resources.stamina,
    mana: character.resources.mana,
  },
    character.staminaRecovery,
    settledAt,
  );
  const payload = CharacterVitalRecoverySettledEventSchema.shape.payload.parse({
    characterId: character.characterId,
    health: result.health,
    resources: {
      stamina: result.stamina,
      mana: result.mana,
    },
    recovery: result.recovery,
  });
  return {
    type: 'character.vital_recovery_settled',
    version: 1,
    payload,
  };
}

export async function isInSharedCombat(
  context: EngineCommandContext,
  characterId: string,
): Promise<boolean> {
  const teamEvents = await context.store.readStream(context.worldInstanceId, 'world-team-combat');
  const teamEncounters = new Map<string, { status: string; participants: { characterId?: string; status?: string }[] }>();
  for (const event of teamEvents) {
    if (!['team.combat_started', 'team.road_encounter_started', 'team.combat_action_resolved'].includes(event.type)) continue;
    const encounter = (event.payload as { encounter?: { encounterId?: string; status?: string; participants?: { characterId?: string; status?: string }[] } }).encounter;
    if (encounter?.encounterId && encounter.status && encounter.participants) {
      teamEncounters.set(encounter.encounterId, {
        status: encounter.status,
        participants: encounter.participants,
      });
    }
  }
  if ([...teamEncounters.values()].some((encounter) =>
    encounter.status === 'active' &&
    encounter.participants.some((participant) =>
      participant.characterId === characterId && participant.status === 'active',
    ),
  )) return true;

  const pvpEvents = await context.store.readStream(
    context.worldInstanceId,
    interactionStreamId(context.worldInstanceId),
  );
  let latestPvp: { status?: string; participants?: { characterId?: string }[] } | undefined;
  for (const event of pvpEvents) {
    if (!['pvp.encounter.started', 'pvp.action.resolved', 'pvp.outcome.applied'].includes(event.type)) continue;
    const raw = event.payload as {
      encounter?: { status?: string; participants?: { characterId?: string }[] };
    };
    const encounter = raw.encounter;
    if (encounter?.status && encounter.participants) latestPvp = encounter;
  }
  return latestPvp?.status !== undefined &&
    latestPvp.status !== 'completed' &&
    Boolean(latestPvp.participants?.some((participant) => participant.characterId === characterId));
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
  validateWorld(world, context) {
    const policy = context.optionalCapability<ClassCombatPolicy>(classCombatPolicyCapability);
    if (Boolean(world.classCatalog) !== Boolean(policy)) {
      throw new Error('A world class catalog requires its class ruleset capability, and vice versa.');
    }
  },
  manifest: {
    id: 'mudd.character',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: ['mudd.character.state.v1'],
    requiredPlugins: { 'mudd.world-items': '^1.0.0' },
    eventSchemaVersions: {
      'character.created': 3,
      'character.stamina_spent': 1,
      'character.stamina_recovery_settled': 1,
      'character.vital_recovery_settled': 1,
      'character.posture_changed': 1,
      'character.equipment_changed': 1,
      'character.shared_item_received': 1,
      'character.shared_item_relinquished': 1,
      'character.corpse_gold_received': 1,
      'character.respawned': 1,
    },
  },
  register({
    registerCommand, registerSystemCommand, registerQuery, registerEffect,
    provideCapability, requireCapability, optionalCapability,
  }) {
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

    const StaminaRecoverySystemCommandSchema = z.object({
      type: z.literal('character.stamina.recover'),
      version: z.literal(1),
      commandId: z.string().min(1).max(128),
      worldInstanceId: z.string().min(1).max(128),
      characterId: z.string().min(1).max(128),
      expectedVersion: z.number().int().nonnegative(),
      payload: z.object({
        settleAt: IsoDateTimeSchema,
        resetAnchor: z.boolean().default(false),
      }).strict(),
    }).strict();

    registerSystemCommand(
      'character.stamina.recover',
      StaminaRecoverySystemCommandSchema,
      async (command, context) => {
        const character = await state.load(context, command.characterId);
        if (!character || character.archived) {
          throw new RuleViolationError('That character is no longer available.');
        }
        assertCharacterAlive(character);
        const settledAt = new Date(command.payload.settleAt);
        const recovery = command.payload.resetAnchor
          ? CharacterStaminaRecoverySchema.parse({
            ...character.staminaRecovery,
            lastSettledAt: settledAt.toISOString(),
            fractionalCarry: 0,
            healthFractionalCarry: 0,
            manaFractionalCarry: 0,
          })
          : staminaRecoveryEvent(character, settledAt).payload.recovery;
        const resources = command.payload.resetAnchor
          ? character.resources
          : staminaRecoveryEvent(character, settledAt).payload.resources;
        const health = command.payload.resetAnchor
          ? character.health ?? {
            current: maximumHealthForLevel(character.advancement?.level ?? 1, character.attributes.constitution),
            maximum: maximumHealthForLevel(character.advancement?.level ?? 1, character.attributes.constitution),
          }
          : staminaRecoveryEvent(character, settledAt).payload.health;
        const payload = CharacterVitalRecoverySettledEventSchema.shape.payload.parse({
          characterId: character.characterId,
          health,
          resources,
          recovery,
          resetAnchor: command.payload.resetAnchor,
        });
        return {
          streamId: character.characterId,
          expectedVersion: command.expectedVersion,
          events: [{ type: 'character.vital_recovery_settled', version: 1, payload }],
        };
      },
    );

    registerCommand('character.rest', CharacterRestCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      if (character.combat?.status === 'active') {
        throw new RuleViolationError('You cannot rest while combat is active.');
      }
      if (character.staminaRecovery.posture === 'resting') {
        throw new RuleViolationError('You are already resting.');
      }
      if (await isInSharedCombat(context, character.characterId)) {
        throw new RuleViolationError('You cannot rest while combat is active.');
      }
      if (!context.world.locations.some((candidate) => candidate.id === character.locationId)) {
        throw new RuleViolationError('Your current location is not available.');
      }
      const settled = staminaRecoveryEvent(character, context.now());
      const posture = CharacterPostureChangedEventSchema.shape.payload.parse({
        characterId: character.characterId,
        posture: 'resting',
        locationId: character.locationId,
      });
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [
          settled,
          { type: 'character.posture_changed', version: 1, payload: posture },
        ],
      };
    });

    registerCommand('character.stand', CharacterStandCommandSchema, async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      if (character.staminaRecovery.posture !== 'resting') {
        throw new RuleViolationError('You are already standing.');
      }
      const settled = staminaRecoveryEvent(character, context.now());
      const posture = CharacterPostureChangedEventSchema.shape.payload.parse({
        characterId: character.characterId,
        posture: 'standing',
        locationId: character.locationId,
      });
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [
          settled,
          { type: 'character.posture_changed', version: 1, payload: posture },
        ],
      };
    });

    registerCommand('character.create', CreateCharacterCommandSchema, async (command, context) => {
      const name = command.payload.name.trim();
      if (!name || name.length > 48) throw new RuleViolationError('Choose a character name between 1 and 48 characters.');
      const startingLocation = context.world.locations[0];
      if (!startingLocation) throw new Error('This world has no starting location.');
      const characterId = context.makeId();
      const classes = optionalCapability<ClassCombatPolicy>(classCombatPolicyCapability);
      if (!classes && command.payload.classId) throw new RuleViolationError('CLASS_UNSUPPORTED: This world does not use classes.');
      const snapshot = classes?.select(command.payload.classId);
      const maximum = snapshot ? maximumHealthForLevel(1, snapshot.attributes.constitution) : undefined;
      const payload = {
        characterId,
        playerId: context.session.playerId,
        name,
        startingLocationId: startingLocation.id,
        ...(startingLocation.defaultStateId ? { startingStateId: startingLocation.defaultStateId } : {}),
        attributes: snapshot?.attributes ?? DEFAULT_CHARACTER_ATTRIBUTES,
        ...(snapshot ? { characterClass: snapshot, health: { current: maximum!, maximum: maximum! } } : {}),
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
      (snapshot ? CharacterCreatedEventV3Schema : CharacterCreatedEventV2Schema).shape.payload.parse(payload);
      return {
        streamId: characterId,
        expectedVersion: 0,
        events: [{ type: 'character.created', version: snapshot ? 3 : 2, payload }],
      };
    });

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
      const measureQuery = <T>(stage: string, run: () => Promise<T>) =>
        context.measureStage
          ? context.measureStage(`location.describe.${stage}`, run)
          : run();
      const character = await measureQuery('characterState', () => state.load(context, query.characterId));
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const requestedLocationId = query.payload.locationId;
      if (requestedLocationId && requestedLocationId !== character.locationId) {
        throw new RuleViolationError('You can only inspect your current location.');
      }
      const location = context.world.locations.find((item) => item.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');
      const locationState = resolveLocationState(location, character.locationStateId);
      const availableExits = exitsForLocationState(location, locationState?.id);
      const projectedLocationIds = [
        location.id,
        ...availableExits.map((exit) => exit.toLocationId),
      ];
      const [roomNpcsByLocation, sharedState] = await Promise.all([
        measureQuery('npcPositions', async () => {
          if (autonomousNpcs) return autonomousNpcs.atLocations(context, projectedLocationIds);
          return new Map(projectedLocationIds.map((locationId) => [
            locationId,
            context.world.locations.find((candidate) => candidate.id === locationId)?.npcs ?? [],
          ]));
        }),
        measureQuery('sharedItems', () => worldItems.load(context)),
      ]);
      const roomNpcsFor = (room: WorldPackDraft['locations'][number]): readonly NpcDefinition[] =>
        roomNpcsByLocation.get(room.id) ?? room.npcs ?? [];
      const roomNpcs = roomNpcsFor(location);
      const sharedItemsByLocation = new Map<string, Array<(typeof sharedState.items)[number]>>();
      for (const item of sharedState.items) {
        if (!item.locationId) continue;
        const items = sharedItemsByLocation.get(item.locationId) ?? [];
        items.push(item);
        sharedItemsByLocation.set(item.locationId, items);
      }
      const corpsesByLocation = new Map<string, Array<(typeof sharedState.corpses)[number]>>();
      for (const corpse of sharedState.corpses) {
        const corpses = corpsesByLocation.get(corpse.locationId) ?? [];
        corpses.push(corpse);
        corpsesByLocation.set(corpse.locationId, corpses);
      }
      const currencyDropsByLocation = new Map<string, Array<(typeof sharedState.currencyDrops)[number]>>();
      for (const drop of sharedState.currencyDrops) {
        const drops = currencyDropsByLocation.get(drop.locationId) ?? [];
        drops.push(drop);
        currencyDropsByLocation.set(drop.locationId, drops);
      }
      const trackedItemIds = new Set(character.itemLocations.map((entry) => entry.item.id));
      const claimedContainerItemIds = new Set(character.claimedContainerItemIds);
      const characterItemsByLocation = new Map<string, Array<(typeof character.itemLocations)[number]>>();
      for (const entry of character.itemLocations) {
        if (!entry.locationId) continue;
        const items = characterItemsByLocation.get(entry.locationId) ?? [];
        items.push(entry);
        characterItemsByLocation.set(entry.locationId, items);
      }
      const roomDescriptionByItemId = new Map(
        context.world.locations.flatMap((worldLocation) =>
          (worldLocation.takeables ?? []).map(({ id, roomDescription }) => [id, roomDescription] as const),
        ),
      );
      const includeNpcDescriptions = query.payload.includeNpcDescriptions === true;
      const projectRoomContents = (
        room: WorldPackDraft['locations'][number],
        npcs: readonly NpcDefinition[],
        includeLongNpcDescriptions: boolean,
        includeObjects = true,
      ) => {
        const itemsInRoom = sharedItemsByLocation.get(room.id) ?? [];
        const now = context.now();
        const corpsesInRoom = (corpsesByLocation.get(room.id) ?? [])
          .filter((corpse) => !corpse.expiresAt || Date.parse(corpse.expiresAt) > now.getTime())
          .map((corpse) => {
            const contents = itemsInRoom
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
            contents.push(...(characterItemsByLocation.get(room.id) ?? [])
              .filter((entry) => entry.containerId === corpse.corpseId)
              .map(({ item }) => ({
                id: item.id,
                label: item.label,
                description: item.description,
              })));
            return {
              corpse: {
                ...corpse,
                description: corpseDecayDescription(
                  corpse,
                  now,
                  context.world.corpseLifecycle.showDecayStages,
                ),
              },
              contents,
            };
          });
        const visibleContainers = (room.containers ?? []).map((container) => ({
          ...container,
          contents: [
            ...container.contents.filter((item) =>
              !claimedContainerItemIds.has(item.id) && !trackedItemIds.has(item.id),
            ),
            ...(characterItemsByLocation.get(room.id) ?? [])
              .filter((entry) => entry.containerId === container.id)
              .map(({ item }) => item),
          ],
        }));
        const roomTakeables = [
          ...(room.takeables ?? []).filter((item) => !trackedItemIds.has(item.id)),
          ...(characterItemsByLocation.get(room.id) ?? [])
            .filter((entry) => !entry.containerId)
            .map(({ item }) => item),
        ];
        const roomItemDescriptions = roomTakeables.flatMap((item) => {
          const roomDescription = roomDescriptionByItemId.get(item.id);
          return roomDescription ? [roomDescription] : [];
        });
        const sharedItemDescriptions = itemsInRoom
          .filter((item) => !item.containerId)
          .map(({ item }) => `${item.label} lies here.`);
        const currencyDropObjects = (currencyDropsByLocation.get(room.id) ?? []).map((drop) => {
          const currencyName = context.world.currency?.name ?? 'coins';
          return {
            id: drop.dropId,
            label: `${drop.amount} ${currencyName}`,
            description: `${drop.amount} ${currencyName} lies here.`,
            readable: false,
            takeable: true,
          };
        });
        const containerDescriptions = visibleContainers.map((container) => {
          const roomDescription = container.roomDescription ?? `${container.label} is here.`;
          const contents = container.contents.length
            ? ` It contains ${container.contents.map((item) => item.label).join(', ')}.`
            : ' It is empty.';
          return `${roomDescription}${contents}`;
        });
        const corpseDescriptions = corpsesInRoom.map(({ corpse, contents }) =>
          `${corpse.description}${contents.length
            ? ` It contains ${contents.map((item) => item.label).join(', ')}.`
            : ' It is empty.'}`,
        );
        const npcDescriptions = npcs.map(({ name, description, activityDescription }) =>
          includeLongNpcDescriptions
            ? `${name} is here. ${description}`
            : `${name} is here${activityDescription ? `, ${activityDescription}` : ''}.`,
        );
        const interactableRoomDescriptions = (room.interactables ?? []).flatMap(({ roomDescription }) =>
          roomDescription ? [roomDescription] : [],
        );
        const objects = includeObjects ? [
          ...(room.readables ?? []).map(({ id, label, description }) => ({
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
          ...itemsInRoom.filter((item) => !item.containerId).map(({ worldItemId, item }) => ({
            id: worldItemId,
            label: item.label,
            description: item.description,
            readable: false,
            takeable: true,
          })),
            ...currencyDropObjects,
          ...corpsesInRoom.flatMap(({ corpse, contents }) => [
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
          ...(room.interactables ?? []).map(({ id, label, description }) => ({
            id, label, description, readable: false, takeable: false,
          })),
        ] : [];
        const npcProjections = npcs.map((npc) => ({
          id: npc.id,
          name: npc.name,
          ...(npc.activityDescription ? { activityDescription: npc.activityDescription } : {}),
          ...(includeLongNpcDescriptions ? { description: npc.description } : {}),
          canChallenge: Boolean(npc.combatProfile),
          combatDisposition: npc.combatDisposition ?? 'passive',
          canShop: Boolean(npc.shop),
        }));
        return {
          roomDetails: [
            ...roomItemDescriptions,
            ...sharedItemDescriptions,
            ...currencyDropObjects.map(({ description }) => description),
            ...containerDescriptions,
            ...corpseDescriptions,
            ...interactableRoomDescriptions,
            ...npcDescriptions,
          ].join('\n\n'),
          objects,
          npcs: npcProjections,
        };
      };
      const roomContents = projectRoomContents(location, roomNpcs, includeNpcDescriptions);
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
      return measureQuery('assembleProjection', async () => LocationProjectionSchema.parse({
        worldInstanceId: context.worldInstanceId,
        locationId: location.id,
        ...(locationState ? { locationStateId: locationState.id } : {}),
        revision: character.revision,
        safeResting: location.safeResting ?? false,
        title: displayName.qualifiedName,
        shortName: displayName.shortName,
        qualifiedName: displayName.qualifiedName,
        locationGroups,
        description: [
          locationState?.description ?? location.description,
          roomContents.roomDetails,
        ].filter(Boolean).join('\n\n'),
        exits: availableExits.map((exit) => {
          const destination = context.world.locations.find((candidate) =>
            candidate.id === exit.toLocationId,
          );
          const interactionAvailable = !exit.requiredInteractionId ||
            character.itemUseObservations.some((observation) =>
              observation.interactionId === exit.requiredInteractionId &&
              observation.locationId === location.id,
            );
          const destinationAvailable = Boolean(destination) &&
            (!destination?.requiredVisitedLocationId ||
              character.visitedLocationIds.includes(destination.requiredVisitedLocationId));
          const isAvailable = interactionAvailable && destinationAvailable;
          const destinationState = destination
            ? resolveLocationState(destination, exit.toStateId)
            : undefined;
          const destinationShortName = destinationState?.name ?? destination?.name;
          const destinationGroups = destination
            ? locationGroupMembershipsForLocation(context.world.locationGroups, destination.id)
            : [];
          const destinationDisplayName = destinationShortName
            ? resolveLocationDisplayName(destinationShortName, destinationGroups)
            : undefined;
          const destinationNpcs = destination ? roomNpcsFor(destination) : [];
          const destinationContents = isAvailable && destination
            ? projectRoomContents(destination, destinationNpcs, false, false)
            : undefined;
          const previewRoomDetails = destinationContents?.roomDetails;
          const cappedPreviewRoomDetails = previewRoomDetails && previewRoomDetails.length > 20_000
            ? `${previewRoomDetails.slice(0, 19_999)}…`
            : previewRoomDetails;

          return {
            id: exit.id,
            label: exit.label,
            direction: exit.direction,
            available: isAvailable,
            roadId: exit.roadId,
            ...(isAvailable && destination && destinationDisplayName ? {
              destinationPreview: {
                locationId: destination.id,
                ...(destinationState ? { locationStateId: destinationState.id } : {}),
                title: destinationDisplayName.qualifiedName,
                shortName: destinationDisplayName.shortName,
                qualifiedName: destinationDisplayName.qualifiedName,
                description: destinationState?.description ?? destination.description,
                ...(cappedPreviewRoomDetails ? { roomDetails: cappedPreviewRoomDetails } : {}),
                npcs: destinationNpcs.slice(0, 200).map((npc) => ({
                  id: npc.id,
                  name: npc.name,
                  mobile: Boolean(npc.movement),
                })),
              },
            } : {}),
          };
        }),
        objects: roomContents.objects,
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
        ...(roomContents.npcs.length ? { npcs: roomContents.npcs } : {}),
      }));
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
      const characterItemsAtLocation = character.itemLocations.filter((entry) =>
        entry.locationId === location.id,
      );
      const visibleContainers = (location.containers ?? []).map((container) => ({
        ...container,
        contents: [
          ...container.contents.filter((item) =>
            !character.claimedContainerItemIds.includes(item.id) && !trackedItemIds.has(item.id),
          ),
          ...characterItemsAtLocation
            .filter((entry) => entry.containerId === container.id)
            .map(({ item }) => item),
        ],
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
        .filter((corpse) => corpse.locationId === character.locationId &&
          (!corpse.expiresAt || Date.parse(corpse.expiresAt) > context.now().getTime()))
        .map((corpse) => {
          const {
            corpseId,
            label,
            opponentName,
            currencyAmount,
            currencyId,
            goldItemId,
            goldClaimed,
          } = corpse;
          const description = corpseDecayDescription(
            corpse,
            context.now(),
            context.world.corpseLifecycle.showDecayStages,
          );
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
          contents.push(...characterItemsAtLocation
            .filter((entry) => entry.containerId === corpseId)
            .map(({ item }) => ({
              id: item.id,
              label: item.label,
              description: item.description,
            })));
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
      const roomCurrencyDrops = sharedState.currencyDrops
        .filter((drop) => drop.locationId === character.locationId)
        .map((drop) => {
          const currencyName = context.world.currency?.name ?? 'coins';
          return {
            id: drop.dropId,
            label: `${drop.amount} ${currencyName}`,
            description: `${drop.amount} ${currencyName} lies here.`,
          };
        });
      const roomCorpseObjects = roomCorpses.map(({ id, label, description }) => ({ id, label, description }));
      const objectInRoom = [
        ...(location.readables ?? []),
        ...(location.takeables ?? []).filter((item) => !trackedItemIds.has(item.id)),
        ...(location.interactables ?? []),
        ...roomContainers,
        ...roomCorpseObjects,
        ...roomCurrencyDrops,
        ...visibleContainers.flatMap((container) => container.contents),
        ...roomCorpses.flatMap((corpse) => corpse.contents),
        ...characterItemsAtLocation
          .filter((entry) => !entry.containerId)
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
