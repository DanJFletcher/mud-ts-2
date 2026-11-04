import { z } from 'zod';
import {
  CharacterPostureChangedEventSchema,
  CharacterRestCommandSchema,
  CharacterStandCommandSchema,
  CharacterStaminaRecoverySchema,
  CharacterStaminaSpentEventSchema,
  CharacterVitalRecoverySettledEventSchema,
  FLEE_STAMINA_COST,
  IsoDateTimeSchema,
} from '@mudd/contracts';
import {
  replayCharacter,
  RuleViolationError,
  SYSTEM_ACTOR_ID,
  type EventEffectContext,
  type PluginContext,
} from '@mudd/engine-core';
import { maximumHealthForLevel } from '../character-stats.js';
import {
  assertCharacterAlive,
  isCharacterInActiveCombat,
  isInSharedCombat,
  staminaRecoveryEvent,
  staminaRecoveryEventForCommand,
  vitalRecoveryPausedEvent,
  type CharacterStateCapability,
} from './state.js';

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
    streamKind: 'character',
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

type CharacterRecoveryRegistrations = Pick<
  PluginContext,
  'registerCommand' | 'registerSystemCommand' | 'registerEffect'
>;

export function registerCharacterRecovery(
  { registerCommand, registerSystemCommand, registerEffect }: CharacterRecoveryRegistrations,
  state: CharacterStateCapability,
): void {
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
  const VitalRecoverySystemCommandV2Schema = z.object({
    type: z.literal('character.stamina.recover'),
    version: z.literal(2),
    commandId: z.string().min(1).max(128),
    worldInstanceId: z.string().min(1).max(128),
    characterId: z.string().min(1).max(128),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.object({
      settleAt: IsoDateTimeSchema,
      resetAnchorAt: IsoDateTimeSchema.optional(),
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
      const combatActive = await isCharacterInActiveCombat(context, character);
      if (combatActive) {
        return {
          streamId: character.characterId,
          streamKind: 'character',
          expectedVersion: command.expectedVersion,
          events: [vitalRecoveryPausedEvent(character, context.now())],
        };
      }
      const settledAt = new Date(command.payload.settleAt);
      const settled = command.payload.resetAnchor
        ? undefined
        : staminaRecoveryEvent(character, settledAt);
      const recovery = command.payload.resetAnchor
        ? CharacterStaminaRecoverySchema.parse({
          ...character.staminaRecovery,
          lastSettledAt: settledAt.toISOString(),
          fractionalCarry: 0,
          healthFractionalCarry: 0,
          manaFractionalCarry: 0,
        })
        : settled!.payload.recovery;
      const resources = command.payload.resetAnchor
        ? character.resources
        : settled!.payload.resources;
      const health = command.payload.resetAnchor
        ? character.health ?? {
          current: maximumHealthForLevel(character.advancement?.level ?? 1, character.attributes.constitution),
          maximum: maximumHealthForLevel(character.advancement?.level ?? 1, character.attributes.constitution),
        }
        : settled!.payload.health;
      const payload = CharacterVitalRecoverySettledEventSchema.shape.payload.parse({
        characterId: character.characterId,
        health,
        resources,
        recovery,
        resetAnchor: command.payload.resetAnchor,
      });
      return {
        streamId: character.characterId,
        streamKind: 'character',
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.vital_recovery_settled', version: 1, payload }],
      };
    },
  );

  registerSystemCommand(
    'character.stamina.recover',
    VitalRecoverySystemCommandV2Schema,
    async (command, context) => {
      const character = await state.load(context, command.characterId);
      if (!character || character.archived) {
        throw new RuleViolationError('That character is no longer available.');
      }
      assertCharacterAlive(character);

      if (await isCharacterInActiveCombat(context, character)) {
        return {
          streamId: character.characterId,
          streamKind: 'character',
          expectedVersion: command.expectedVersion,
          events: [vitalRecoveryPausedEvent(character, context.now())],
        };
      }
      const settledAt = new Date(command.payload.settleAt);
      const settled = staminaRecoveryEvent(character, settledAt);
      const resetAnchorAt = command.payload.resetAnchorAt
        ? new Date(command.payload.resetAnchorAt)
        : undefined;
      const settledThrough = settled.payload.recovery.lastSettledAt;
      let recovery = settled.payload.recovery;
      if (resetAnchorAt && !settledThrough) {
        throw new Error('Vital recovery did not produce a settlement anchor.');
      }
      if (resetAnchorAt && settledThrough) {
        recovery = {
          ...recovery,
          lastSettledAt: new Date(Math.max(
            resetAnchorAt.getTime(),
            Date.parse(settledThrough),
          )).toISOString(),
        };
      }
      const payload = CharacterVitalRecoverySettledEventSchema.shape.payload.parse({
        ...settled.payload,
        recovery,
        ...(resetAnchorAt ? { settledAt: settledThrough!, resetAnchor: true } : {}),
      });
      return {
        streamId: character.characterId,
        streamKind: 'character',
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.vital_recovery_settled', version: 1, payload }],
      };
    },
    2,
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
    const settled = await isCharacterInActiveCombat(context, character)
      ? vitalRecoveryPausedEvent(character, context.now())
      : staminaRecoveryEventForCommand(character, context.now(), context.presenceAnchorAt);
    const posture = CharacterPostureChangedEventSchema.shape.payload.parse({
      characterId: character.characterId,
      posture: 'resting',
      locationId: character.locationId,
    });
    return {
      streamId: character.characterId,
      streamKind: 'character',
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
    const settled = await isCharacterInActiveCombat(context, character)
      ? vitalRecoveryPausedEvent(character, context.now())
      : staminaRecoveryEventForCommand(character, context.now(), context.presenceAnchorAt);
    const posture = CharacterPostureChangedEventSchema.shape.payload.parse({
      characterId: character.characterId,
      posture: 'standing',
      locationId: character.locationId,
    });
    return {
      streamId: character.characterId,
      streamKind: 'character',
      expectedVersion: command.expectedVersion,
      events: [
        settled,
        { type: 'character.posture_changed', version: 1, payload: posture },
      ],
    };
  });
}
