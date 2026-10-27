import {
  CharacterRespawnedEventSchema,
  CharacterPvpOutcomeAppliedEventSchema,
  CharacterPostureChangedEventSchema,
  PvpCombatActionCommandSchema,
  PvpEncounterProjectionSchema,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EventEffectContext,
  PluginContext,
  ProposedDomainEvent,
  ProposedEventEffect,
} from '@mudd/engine-core';
import { RuleViolationError, replayCharacter, SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import { z } from 'zod';
import { assertCharacterAlive, type CharacterStateCapability } from './character.js';
import {
  interactionPolicyRegistry,
  interactionStreamId,
  type InteractionPolicyRegistry,
} from './interactions.js';
import { prepareCharacterRespawn } from './respawn.js';
import { worldItemDropEffect } from './world-items.js';
import { characterAttackDamage, characterDefenseReduction, maximumHealthForLevel } from './character-stats.js';
import { assertCharacterStanding } from './character.js';
import { classAdoptionGuards, classCombatPolicyCapability, type ClassCombatPolicy } from './classes.js';

const PVP_CHALLENGE_KIND = 'pvp.challenge';
const PVP_OUTCOME_EFFECT = 'pvp.apply_outcome';
const MAX_LEVEL = 10;

const PrivateParticipantSchema = z.object({
  characterId: z.string(),
  characterHealthAnchor: z.number().int().nonnegative().optional(),
  attackDamage: z.number().int().nonnegative(),
  defenseReduction: z.number().int().nonnegative(),
  consumables: z.array(z.object({
    itemId: z.string(),
    amount: z.number().int().positive(),
  }).strict()),
  consumedItemIds: z.array(z.string()),
}).strict();

const PrivateEncounterSchema = z.object({
  encounter: PvpEncounterProjectionSchema,
  participants: z.tuple([PrivateParticipantSchema, PrivateParticipantSchema]),
  guardingCharacterId: z.string().nullable(),
}).strict();

const OutcomeEffectSchema = z.object({
  interactionStreamId: z.string(),
  encounter: PvpEncounterProjectionSchema,
  consumedItemIdsByCharacter: z.record(z.string(), z.array(z.string())),
  healthDeltaByCharacter: z.record(z.string(), z.number().int()).optional(),
  respawnsByCharacter: z.record(z.string(), z.unknown()),
}).strict();

function maximumHealth(character: Awaited<ReturnType<CharacterStateCapability['load']>>): number {
  const level = character?.advancement?.level ?? 1;
  return character?.health?.maximum ?? maximumHealthForLevel(
    Math.min(level, MAX_LEVEL),
    character?.attributes.constitution ?? 10,
  );
}

function latestPrivateEncounter(
  events: readonly { type: string; payload: Readonly<Record<string, unknown>> }[],
): z.infer<typeof PrivateEncounterSchema> | undefined {
  let current: z.infer<typeof PrivateEncounterSchema> | undefined;
  for (const event of events) {
    if (event.type === 'pvp.encounter.started' || event.type === 'pvp.action.resolved') {
      const parsed = PrivateEncounterSchema.safeParse(event.payload);
      if (parsed.success) current = parsed.data;
    } else if (event.type === 'pvp.outcome.applied' && current) {
      const parsed = PvpEncounterProjectionSchema.safeParse(event.payload.encounter);
      if (parsed.success && parsed.data.encounterId === current.encounter.encounterId) {
        current = { ...current, encounter: parsed.data };
      }
    }
  }
  return current;
}

async function streamState(context: EngineCommandContext) {
  const streamId = interactionStreamId(context.worldInstanceId);
  const events = await context.store.readStream(context.worldInstanceId, streamId);
  return { streamId, events, version: events.at(-1)?.aggregateVersion ?? 0 };
}

function activeEncounterForCharacter(
  events: readonly { type: string; payload: Readonly<Record<string, unknown>> }[],
  characterId: string,
) {
  const state = latestPrivateEncounter(events);
  return state?.encounter.status !== 'completed' &&
    state?.encounter.participants.some((participant) => participant.characterId === characterId)
    ? state
    : undefined;
}

function event(type: string, payload: Record<string, unknown>): ProposedDomainEvent {
  return { type, version: 1, payload };
}

function createEncounter(
  requestId: string,
  locationId: string,
  left: NonNullable<Awaited<ReturnType<CharacterStateCapability['load']>>>,
  right: NonNullable<Awaited<ReturnType<CharacterStateCapability['load']>>>,
  now: Date,
  makeId: () => string,
): z.infer<typeof PrivateEncounterSchema> {
  const getStats = (character: typeof left) => {
    const max = maximumHealth(character);
    return {
      projection: {
        characterId: character.characterId,
        name: character.name,
        health: Math.min(character.health?.current ?? max, max),
        maximumHealth: max,
      },
      private: {
        characterId: character.characterId,
        characterHealthAnchor: Math.min(character.health?.current ?? max, max),
        attackDamage: characterAttackDamage(character),
        defenseReduction: characterDefenseReduction(character),
        consumables: character.inventory
          .filter((item) => item.consumable && !item.equipment)
          .map((item) => ({ itemId: item.id, amount: item.consumable!.amount })),
        consumedItemIds: [],
      },
    };
  };
  const a = getStats(left);
  const b = getStats(right);
  const projection = PvpEncounterProjectionSchema.parse({
    encounterId: makeId(),
    requestId,
    locationId,
    participants: [a.projection, b.projection],
    turnCharacterId: a.projection.characterId,
    round: 0,
    status: 'active',
    lastNarration: `${a.projection.name} and ${b.projection.name} enter a duel. ${a.projection.name} acts first.`,
    updatedAt: now.toISOString(),
  });
  return PrivateEncounterSchema.parse({
    encounter: projection,
    participants: [a.private, b.private],
    guardingCharacterId: null,
  });
}

async function applyPvpOutcome(
  raw: z.infer<typeof OutcomeEffectSchema>,
  context: EventEffectContext,
) {
  const effectIdBase = `pvp-outcome:${raw.encounter.encounterId}`;
  for (const participant of raw.encounter.participants) {
    const characterId = participant.characterId;
    const baseCommandId = `${effectIdBase}:${characterId}`;
    const consumedItemIds = raw.consumedItemIdsByCharacter[characterId] ?? [];
    const priorEvents = await context.store.readStream(context.worldInstanceId, characterId);
    const outcomeAlreadyApplied = priorEvents.some((stored) =>
      stored.type === 'character.pvp_outcome_applied' &&
      (stored.payload as { encounterId?: string }).encounterId === raw.encounter.encounterId);
    const respawnCandidate = raw.respawnsByCharacter[characterId];
    const respawnPayload = respawnCandidate === undefined
      ? undefined
      : CharacterRespawnedEventSchema.shape.payload.parse(respawnCandidate);
    const respawnAlreadyApplied = priorEvents.some((stored) =>
      stored.type === 'character.respawned' &&
      (stored.payload as { encounterId?: string }).encounterId === raw.encounter.encounterId);
    if (outcomeAlreadyApplied && (!respawnPayload || respawnAlreadyApplied)) continue;
    const character = replayCharacter(priorEvents);
    if (!character || (character.health?.maximum ?? participant.maximumHealth) !== participant.maximumHealth) {
      throw new Error('PvP participant state changed before the outcome could be applied.');
    }
    const healthDelta = raw.healthDeltaByCharacter?.[characterId];
    const healthCurrent = participant.health === 0 || respawnCandidate !== undefined
      ? 0
      : healthDelta === undefined
        ? participant.health
        : Math.max(0, Math.min(
          participant.maximumHealth,
          (character.health?.current ?? participant.maximumHealth) + healthDelta,
        ));
    const eventPayload = {
      characterId,
      encounterId: raw.encounter.encounterId,
      health: { current: healthCurrent, maximum: participant.maximumHealth },
      consumedItemIds,
    };
    CharacterPvpOutcomeAppliedEventSchema.shape.payload.parse(eventPayload);
    const commandId = outcomeAlreadyApplied
      ? `pvp-respawn:${raw.encounter.encounterId}:${characterId}`
      : baseCommandId;
    const payloadHash = outcomeAlreadyApplied
      ? `pvp-respawn:${raw.encounter.encounterId}:${characterId}`
      : `pvp-outcome:${raw.encounter.encounterId}:${characterId}`;
    const duplicate = await context.store.lookupCommand(
      context.worldInstanceId,
      SYSTEM_ACTOR_ID,
      commandId,
      payloadHash,
    );
    if (duplicate && (!respawnPayload || respawnAlreadyApplied)) continue;
    const events: ProposedDomainEvent[] = outcomeAlreadyApplied
      ? []
      : [event('character.pvp_outcome_applied', eventPayload)];
    const effects: ProposedEventEffect[] = [];
    if (respawnPayload && !respawnAlreadyApplied) {
      events.push(event('character.respawned', respawnPayload));
      if (respawnPayload.droppedItem) {
        effects.push(worldItemDropEffect({
          worldItemId: respawnPayload.droppedItem.item.id,
          fromCharacterId: characterId,
          locationId: respawnPayload.deathLocationId,
          item: respawnPayload.droppedItem.item,
        }));
      }
    }
    const applied = await context.store.append({
      worldInstanceId: context.worldInstanceId,
      streamId: characterId,
      actorId: SYSTEM_ACTOR_ID,
      commandId,
      payloadHash,
      expectedVersion: priorEvents.at(-1)?.aggregateVersion ?? 0,
      events,
      ...(effects.length ? { effects } : {}),
    });
    if (!applied.receipt.ok) throw new Error('Could not append the PvP outcome to a character stream.');
  }

  const streamId = raw.interactionStreamId;
  const interactionEvents = await context.store.readStream(context.worldInstanceId, streamId);
  const state = latestPrivateEncounter(interactionEvents);
  if (!state || state.encounter.encounterId !== raw.encounter.encounterId) {
    throw new Error('The PvP encounter changed before outcome finalization.');
  }
  if (state.encounter.status === 'completed') return;
  const completed = {
    ...state.encounter,
    status: 'completed' as const,
    turnCharacterId: null,
    lastNarration: `${state.encounter.lastNarration} The result is settled.`,
    updatedAt: new Date().toISOString(),
  };
  const commandId = `${effectIdBase}:complete`;
  const payloadHash = `${effectIdBase}:complete`;
  if (await context.store.lookupCommand(context.worldInstanceId, SYSTEM_ACTOR_ID, commandId, payloadHash)) return;
  const result = await context.store.append({
    worldInstanceId: context.worldInstanceId,
    streamId,
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion: interactionEvents.at(-1)?.aggregateVersion ?? 0,
    events: [event('pvp.outcome.applied', { encounter: completed })],
  });
  if (!result.receipt.ok) throw new Error('Could not finalize the PvP encounter.');
}

export function registerPvpCombat(
  pluginContext: PluginContext,
  characterState: CharacterStateCapability,
) {
  const { registerCommand, registerEffect, requireCapability, optionalCapability } = pluginContext;
  const policies = requireCapability<InteractionPolicyRegistry>(interactionPolicyRegistry);
  policies.register(PVP_CHALLENGE_KIND, {
    async prepareRequest({ initiatorCharacterId, recipientCharacterId }, context) {
      const [initiator, recipient] = await Promise.all([
        characterState.load(context, initiatorCharacterId),
        characterState.load(context, recipientCharacterId),
      ]);
      if (!initiator || initiator.archived || !recipient || recipient.archived) {
        throw new RuleViolationError('That player is not available.');
      }
      assertCharacterAlive(initiator);
      assertCharacterAlive(recipient);
      assertCharacterStanding(initiator);
      assertCharacterStanding(recipient);
      if (initiator.locationId !== recipient.locationId) {
        throw new RuleViolationError('You can only challenge someone in the same room.');
      }
      if (initiator.combat?.status === 'active' || recipient.combat?.status === 'active') {
        throw new RuleViolationError('A player already has an active encounter.');
      }
      const { events } = await streamState(context);
      if (latestPrivateEncounter(events)?.encounter.status !== undefined &&
        latestPrivateEncounter(events)?.encounter.status !== 'completed') {
        throw new RuleViolationError('A PvP encounter is already active in this world.');
      }
      if (
        activeEncounterForCharacter(events, initiatorCharacterId) ||
        activeEncounterForCharacter(events, recipientCharacterId)
      ) throw new RuleViolationError('A player is already in a PvP encounter.');
      return { initiatorName: initiator.name, recipientName: recipient.name };
    },
    async prepareAcceptance(request, context) {
      const [initiator, recipient] = await Promise.all([
        characterState.load(context, request.initiatorCharacterId),
        characterState.load(context, request.recipientCharacterId),
      ]);
      if (!initiator || !recipient || initiator.archived || recipient.archived) {
        throw new RuleViolationError('A player is no longer available.');
      }
      assertCharacterAlive(initiator);
      assertCharacterAlive(recipient);
      assertCharacterStanding(initiator);
      assertCharacterStanding(recipient);
      if (initiator.locationId !== recipient.locationId) {
        throw new RuleViolationError('You must both remain in the same room to begin.');
      }
      if (initiator.combat?.status === 'active' || recipient.combat?.status === 'active') {
        throw new RuleViolationError('A player already has an active encounter.');
      }
      const { events } = await streamState(context);
      if (latestPrivateEncounter(events)?.encounter.status !== undefined &&
        latestPrivateEncounter(events)?.encounter.status !== 'completed') {
        throw new RuleViolationError('A PvP encounter is already active in this world.');
      }
      if (
        activeEncounterForCharacter(events, initiator.characterId) ||
        activeEncounterForCharacter(events, recipient.characterId)
      ) throw new RuleViolationError('A player is already in a PvP encounter.');
      const state = createEncounter(
        request.requestId,
        initiator.locationId,
        initiator,
        recipient,
        context.now(),
        context.makeId,
      );
      const started = [event('pvp.encounter.started', state as unknown as Record<string, unknown>)];
      if (!context.world.classCatalog) return started;
      return { events: started, guards: [
        { streamId: initiator.characterId, expectedVersion: initiator.revision },
        { streamId: recipient.characterId, expectedVersion: recipient.revision },
        ...await classAdoptionGuards(context, initiator.characterId),
        ...await classAdoptionGuards(context, recipient.characterId),
      ] };
    },
  });

  registerCommand('pvp.action', PvpCombatActionCommandSchema, async (command, context) => {
    const { streamId, events, version } = await streamState(context);
    const state = latestPrivateEncounter(events);
    if (!state || state.encounter.encounterId !== command.payload.encounterId || state.encounter.status !== 'active') {
      throw new RuleViolationError('That PvP encounter is no longer active.');
    }
    const actorIndex = state.encounter.participants.findIndex((participant) =>
      participant.characterId === command.characterId);
    if (actorIndex < 0) throw new RuleViolationError('You are not part of that encounter.');
    const participantCharacters = await Promise.all(state.encounter.participants.map((participant) =>
      characterState.load(context, participant.characterId),
    ));
    const actingCharacter = participantCharacters[actorIndex];
    if (!actingCharacter || actingCharacter.archived) {
      throw new RuleViolationError('That character is no longer available.');
    }
    assertCharacterStanding(actingCharacter);
    if (state.encounter.turnCharacterId !== command.characterId) {
      throw new RuleViolationError('Wait for your turn.');
    }
    const participants = [...state.encounter.participants] as unknown as typeof state.encounter.participants;
    const privateParticipants = [...state.participants] as unknown as typeof state.participants;
    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index]!;
      const privateParticipant = privateParticipants[index]!;
      const projection = participantCharacters[index];
      if (!projection || projection.archived) throw new RuleViolationError('A PvP participant is no longer available.');
      const currentHealth = Math.min(projection.health?.current ?? participant.maximumHealth, participant.maximumHealth);
      const anchor = privateParticipant.characterHealthAnchor ?? currentHealth;
      if (privateParticipant.characterHealthAnchor !== undefined) {
        participant.health = Math.max(0, Math.min(
          participant.maximumHealth,
          participant.health + currentHealth - anchor,
        ));
      }
      privateParticipants[index] = {
        ...privateParticipant,
        characterHealthAnchor: currentHealth,
      };
    }
    const opponentIndex = actorIndex === 0 ? 1 : 0;
    const actor = participants[actorIndex]!;
    const opponent = participants[opponentIndex]!;
    const privateActor = privateParticipants[actorIndex]!;
    const privateOpponent = privateParticipants[opponentIndex]!;
    let guardingCharacterId = state.guardingCharacterId;
    let status: 'active' | 'resolving' = 'active';
    let turnCharacterId: string | null = opponent.characterId;
    const round = state.encounter.round + 1;
    let narration: string;
    let restingTarget: Awaited<ReturnType<CharacterStateCapability['load']>> | undefined;
    const character = command.payload.action === 'ability'
      ? await characterState.load(context, command.characterId) : undefined;
    const guards = participantCharacters.flatMap((projection) => projection
      ? [{ streamId: projection.characterId, expectedVersion: projection.revision }]
      : []);
    if (context.world.classCatalog) {
      guards.push(...await classAdoptionGuards(context, command.characterId, streamId));
    }
    const ability = command.payload.action === 'ability' ? (() => {
      const policy = optionalCapability<ClassCombatPolicy>(classCombatPolicyCapability);
      if (!policy || !character || character.archived || character.combat?.status === 'active' ||
          character.locationId !== state.encounter.locationId) {
        throw new RuleViolationError('ABILITY_UNAVAILABLE: This character cannot use a class action here.');
      }
      assertCharacterAlive(character);
      return policy.resolve(character, command.payload.abilityId, state.encounter.encounterId, context.commandId);
    })() : undefined;

    if (command.payload.action === 'attack' || command.payload.action === 'ability') {
      const guarded = guardingCharacterId === opponent.characterId ? 2 : 0;
      restingTarget = await characterState.load(context, opponent.characterId);
      const incomingMultiplier = restingTarget?.staminaRecovery.posture === 'resting' ? 2 : 1;
      const damage = Math.min(
        opponent.health,
        Math.max(0, (ability?.damage ?? privateActor.attackDamage) - privateOpponent.defenseReduction - guarded) *
          incomingMultiplier,
      );
      participants[opponentIndex] = { ...opponent, health: opponent.health - damage };
      guardingCharacterId = null;
      narration = `${actor.name} strikes ${opponent.name} for ${damage} damage.${incomingMultiplier === 2 ? ' The blow catches them resting.' : ''}`;
      if (participants[opponentIndex]!.health === 0) {
        status = 'resolving';
        turnCharacterId = null;
        narration = `${actor.name} defeats ${opponent.name}.`;
      }
    } else if (command.payload.action === 'defend') {
      guardingCharacterId = actor.characterId;
      narration = `${actor.name} takes a guarded stance.`;
    } else if (command.payload.action === 'flee') {
      status = 'resolving';
      turnCharacterId = null;
      narration = `${actor.name} retreats. The duel ends.`;
    } else {
      const itemId = command.payload.itemId!;
      const character = await characterState.load(context, command.characterId);
      const item = character?.inventory.find((candidate) => candidate.id === itemId);
      if (
        !item?.consumable ||
        item.equipment ||
        !privateActor.consumables.some((candidate) => candidate.itemId === itemId) ||
        privateActor.consumedItemIds.includes(itemId)
      ) throw new RuleViolationError('That item cannot be used during this encounter.');
      if (actor.health >= actor.maximumHealth) throw new RuleViolationError('You are already at full health.');
      const healing = Math.min(item.consumable.amount, actor.maximumHealth - actor.health);
      participants[actorIndex] = { ...actor, health: actor.health + healing };
      privateParticipants[actorIndex] = {
        ...privateActor,
        consumedItemIds: [...privateActor.consumedItemIds, itemId],
      };
      narration = `${actor.name} uses ${item.label} and recovers ${healing} health.`;
    }

    const encounter = PvpEncounterProjectionSchema.parse({
      ...state.encounter,
      participants,
      turnCharacterId,
      round,
      status,
      lastNarration: narration,
      updatedAt: context.now().toISOString(),
    });
    const nextState = PrivateEncounterSchema.parse({
      encounter,
      participants: privateParticipants,
      guardingCharacterId,
    });
    const effects = status === 'resolving'
      ? [{
        type: PVP_OUTCOME_EFFECT,
        version: 1,
        payload: OutcomeEffectSchema.parse({
          interactionStreamId: streamId,
          encounter,
          consumedItemIdsByCharacter: Object.fromEntries(
            privateParticipants.map((participant) => [participant.characterId, participant.consumedItemIds]),
          ),
          healthDeltaByCharacter: Object.fromEntries(
            participants.map((participant, index) => [
              participant.characterId,
              participant.health - (privateParticipants[index]?.characterHealthAnchor ?? participant.health),
            ]),
          ),
          respawnsByCharacter: await preparePvpRespawns(
            encounter,
            privateParticipants,
            characterState,
            context,
          ),
        }),
      }]
      : undefined;
    const restingTargetStandEvent = restingTarget?.staminaRecovery.posture === 'resting'
      ? {
        type: 'character.posture_changed',
        version: 1,
        payload: CharacterPostureChangedEventSchema.shape.payload.parse({
          characterId: restingTarget.characterId,
          posture: 'standing',
          locationId: restingTarget.locationId,
        }),
      }
      : undefined;
    const companions = [];
    if (ability && character) {
      companions.push({
        streamId: character.characterId,
        expectedVersion: character.revision,
        events: [ability.event],
      });
    }
    if (restingTargetStandEvent && restingTarget) {
      companions.push({
        streamId: restingTarget.characterId,
        expectedVersion: restingTarget.revision,
        events: [restingTargetStandEvent],
      });
    }
    return {
      streamId,
      expectedVersion: version,
      events: [event('pvp.action.resolved', nextState as unknown as Record<string, unknown>)],
      ...(effects ? { effects } : {}),
      guards,
      ...(companions.length ? { companions } : {}),
    };
  });

  registerEffect(PVP_OUTCOME_EFFECT, 1, OutcomeEffectSchema, async (payload, context) => {
    await applyPvpOutcome(payload, context);
  });
}

async function preparePvpRespawns(
  encounter: z.infer<typeof PvpEncounterProjectionSchema>,
  privateParticipants: readonly z.infer<typeof PrivateParticipantSchema>[],
  characterState: CharacterStateCapability,
  context: EngineCommandContext,
): Promise<Record<string, unknown>> {
  const respawns: Record<string, unknown> = {};
  for (const participant of encounter.participants) {
    if (participant.health > 0) continue;
    const character = await characterState.load(context, participant.characterId);
    if (!character) throw new RuleViolationError('A player who fell in combat is no longer available.');
    const privateParticipant = privateParticipants.find((candidate) =>
      candidate.characterId === participant.characterId);
    const respawn = prepareCharacterRespawn(
      character,
      context,
      'pvp',
      encounter.encounterId,
      encounter.locationId,
      privateParticipant?.consumedItemIds ?? [],
      participant.maximumHealth,
    );
    if (respawn) {
      respawns[participant.characterId] = respawn.event.payload;
    }
  }
  return respawns;
}

