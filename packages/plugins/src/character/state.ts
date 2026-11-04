import {
  CharacterStaminaRecoverySchema,
  CharacterVitalRecoverySettledEventSchema,
  resolveVitalRecovery,
  type CapabilityToken,
  type CharacterProjection,
} from '@mudd/contracts';
import { RuleViolationError, type EngineCommandContext, type QueryContext } from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';
import { maximumHealthForLevel } from '../character-stats.js';
import { interactionStreamId } from '../interactions.js';

export interface CharacterStateCapability {
  load(context: EngineCommandContext | QueryContext, characterId: string): Promise<CharacterProjection | undefined>;
}

export function assertCharacterAlive(character: CharacterProjection): void {
  if (character.combat?.status === 'defeat' || character.health?.current === 0) {
    throw new RuleViolationError('Your character has died. Start a new character to begin again.');
  }
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

const VITAL_RECOVERY_PRESENCE_WINDOW_MS = 45_000;

export function staminaRecoveryEventForCommand(
  character: CharacterProjection,
  commandAt: Date,
  presenceAnchorAt?: Date,
) {
  if (!Number.isFinite(commandAt.getTime())) throw new Error('Invalid vital recovery command time.');
  if (presenceAnchorAt && !Number.isFinite(presenceAnchorAt.getTime())) {
    throw new Error('Invalid vital recovery presence anchor.');
  }
  const settlementLimit = presenceAnchorAt ??
    (character.staminaRecovery.lastSettledAt
      ? new Date(character.staminaRecovery.lastSettledAt)
      : commandAt);
  if (
    presenceAnchorAt &&
    commandAt.getTime() - presenceAnchorAt.getTime() <= VITAL_RECOVERY_PRESENCE_WINDOW_MS
  ) {
    return staminaRecoveryEvent(character, commandAt);
  }

  const settled = staminaRecoveryEvent(character, settlementLimit);
  const settledThrough = settled.payload.recovery.lastSettledAt;
  if (!settledThrough) throw new Error('Vital recovery did not produce a settlement anchor.');
  const resetAt = new Date(Math.max(commandAt.getTime(), Date.parse(settledThrough)));
  return {
    ...settled,
    payload: CharacterVitalRecoverySettledEventSchema.shape.payload.parse({
      ...settled.payload,
      settledAt: settledThrough,
      recovery: {
        ...settled.payload.recovery,
        lastSettledAt: resetAt.toISOString(),
      },
      resetAnchor: true,
    }),
  };
}

export function vitalRecoveryPausedEvent(
  character: CharacterProjection,
  pausedAt: Date,
) {
  if (!Number.isFinite(pausedAt.getTime())) throw new Error('Invalid vital recovery pause time.');
  const recoveryAt = new Date(Math.max(
    pausedAt.getTime(),
    character.staminaRecovery.lastSettledAt
      ? Date.parse(character.staminaRecovery.lastSettledAt)
      : pausedAt.getTime(),
  ));
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
  const payload = CharacterVitalRecoverySettledEventSchema.shape.payload.parse({
    characterId: character.characterId,
    health,
    resources: character.resources,
    recovery: CharacterStaminaRecoverySchema.parse({
      ...character.staminaRecovery,
      lastSettledAt: recoveryAt.toISOString(),
      fractionalCarry: 0,
      healthFractionalCarry: 0,
      manaFractionalCarry: 0,
    }),
    resetAnchor: true,
  });
  return { type: 'character.vital_recovery_settled', version: 1, payload };
}

export async function isCharacterInActiveCombat(
  context: Pick<EngineCommandContext, 'store' | 'worldInstanceId'>,
  character: Pick<CharacterProjection, 'characterId' | 'combat'>,
): Promise<boolean> {
  return character.combat?.status === 'active' ||
    await isInSharedCombat(context, character.characterId);
}

export async function isInSharedCombat(
  context: Pick<EngineCommandContext, 'store' | 'worldInstanceId'>,
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

export async function activeSharedCombatCharacterIds(
  context: Pick<EngineCommandContext, 'store' | 'worldInstanceId'>,
): Promise<ReadonlySet<string>> {
  const [teamEvents, pvpEvents] = await Promise.all([
    context.store.readStream(context.worldInstanceId, 'world-team-combat'),
    context.store.readStream(
      context.worldInstanceId,
      interactionStreamId(context.worldInstanceId),
    ),
  ]);
  const teamEncounters = new Map<string, {
    status: string;
    participants: { characterId?: string; status?: string }[];
  }>();
  for (const event of teamEvents) {
    if (!['team.combat_started', 'team.road_encounter_started', 'team.combat_action_resolved'].includes(event.type)) continue;
    const encounter = (event.payload as {
      encounter?: {
        encounterId?: string;
        status?: string;
        participants?: { characterId?: string; status?: string }[];
      };
    }).encounter;
    if (encounter?.encounterId && encounter.status && encounter.participants) {
      teamEncounters.set(encounter.encounterId, {
        status: encounter.status,
        participants: encounter.participants,
      });
    }
  }
  const active = new Set<string>();
  for (const encounter of teamEncounters.values()) {
    if (encounter.status !== 'active') continue;
    for (const participant of encounter.participants) {
      if (participant.characterId && participant.status === 'active') active.add(participant.characterId);
    }
  }
  let latestPvp: { status?: string; participants?: { characterId?: string }[] } | undefined;
  for (const event of pvpEvents) {
    if (!['pvp.encounter.started', 'pvp.action.resolved', 'pvp.outcome.applied'].includes(event.type)) continue;
    const encounter = (event.payload as {
      encounter?: { status?: string; participants?: { characterId?: string }[] };
    }).encounter;
    if (encounter?.status && encounter.participants) latestPvp = encounter;
  }
  if (latestPvp?.status && latestPvp.status !== 'completed') {
    for (const participant of latestPvp.participants ?? []) {
      if (participant.characterId) active.add(participant.characterId);
    }
  }
  return active;
}

export const characterStateCapability = Object.freeze({
  id: 'mudd.character.state.v1',
  version: '1',
}) satisfies CapabilityToken<CharacterStateCapability>;
