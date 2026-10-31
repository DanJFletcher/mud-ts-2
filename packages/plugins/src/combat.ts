import {
  CharacterAdvancementAwardedEventV2Schema,
  CharacterCombatEncounterStartedEventSchema,
  CharacterCombatItemUsedEventSchema,
  CharacterInnRestCompletedEventV2Schema,
  CharacterStaminaSpentEventSchema,
  CharacterStatsProjectionSchema,
  CharacterStatsQuerySchema,
  CombatActionCommandSchema,
  CombatActionResolvedEventV3Schema,
  FLEE_STAMINA_COST,
  InnRestCommandSchema,
  WorldLocationEnteredEffectSchema,
} from '@mudd/contracts';
import type { EnginePlugin, EventEffectContext, ProposedDomainEvent, ProposedEventEffect } from '@mudd/engine-core';
import type {
  CombatLootDefinition,
  CorpseLifecycleOverride,
  CharacterProjection,
  NpcCombatProfile,
  RoadEncounterDefinition,
  WorldPackDraft,
} from '@mudd/contracts';
import type { EngineCommandContext } from '@mudd/engine-core';
import { replayCharacter, RuleViolationError, SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import {
  assertCharacterAlive,
  assertCharacterStanding,
  characterStateCapability,
  staminaRecoveryEventForCommand,
  type CharacterStateCapability,
} from './character.js';
import { prepareCharacterRespawn } from './respawn.js';
import { registerPvpCombat } from './pvp-combat.js';
import { interactionPolicyRegistry } from './interactions.js';
import { calculateCharacterStats, characterAttackDamage, characterDefenseReduction, maximumHealthForLevel, levelAfterExperience } from './character-stats.js';
import { createWorldCorpseEffect } from './world-items.js';
import { resolveCombatLoot } from './combat-loot.js';
import { classAdoptionGuards, classCombatPolicyCapability, type ClassCombatPolicy } from './classes.js';
import { z } from 'zod';

const VICTORY_EXPERIENCE_REWARD = 10;

export function createRoadEncounterStartEvent(
  context: EngineCommandContext,
  character: CharacterProjection,
  opponent: RoadEncounterDefinition,
): ProposedDomainEvent {
  const playerMaxHealth = maximumHealthForLevel(
    character.advancement?.level ?? 1,
    character.attributes.constitution,
  );
  const playerHealth = Math.min(character.health?.current ?? playerMaxHealth, playerMaxHealth);
  if (playerHealth <= 0) throw new RuleViolationError('You are too hurt to survive a road encounter.');
  const encounter = {
    encounterId: context.makeId(),
    locationId: character.locationId,
    opponentNpcId: opponent.id,
    opponentName: opponent.name,
    opponentStyle: opponent.combatProfile.style ?? 'steady',
    round: 0,
    playerHealth,
    playerMaxHealth,
    opponentHealth: opponent.combatProfile.maxHealth,
    opponentMaxHealth: opponent.combatProfile.maxHealth,
    status: 'active',
    lastAction: 'encounter',
    lastNarration: `${opponent.name} ambushes you on the road!`,
  };
  const payload = { characterId: character.characterId, encounter };
  CharacterCombatEncounterStartedEventSchema.shape.payload.parse(payload);
  return { type: 'character.combat_encounter_started', version: 1, payload };
}

function findCombatOpponent(
  world: WorldPackDraft,
  locationId: string,
  opponentId: string,
): {
  id: string;
  name: string;
  combatProfile: NpcCombatProfile;
  loot?: CombatLootDefinition;
  corpse?: CorpseLifecycleOverride;
} | undefined {
  const localNpc = world.locations
    .find((location) => location.id === locationId)
    ?.npcs?.find((candidate) => candidate.id === opponentId && candidate.combatProfile);
  if (localNpc?.combatProfile) {
    return {
      id: localNpc.id,
      name: localNpc.name,
      combatProfile: localNpc.combatProfile,
      loot: localNpc.loot,
      ...(localNpc.corpse ? { corpse: localNpc.corpse } : {}),
    };
  }
  for (const road of world.roads) {
    const encounter = road.encounters.find((candidate) => candidate.id === opponentId);
    if (encounter) {
      return {
        id: encounter.id,
        name: encounter.name,
        combatProfile: encounter.combatProfile,
        loot: encounter.loot,
        ...(encounter.corpse ? { corpse: encounter.corpse } : {}),
      };
    }
  }
  return undefined;
}

async function startHostileNpcEncounter(
  payload: z.infer<typeof WorldLocationEnteredEffectSchema>,
  context: EventEffectContext,
) {
  const commandId = `hostile-npc-entry:${context.effectId}`;
  const payloadHash = JSON.stringify({
    effectId: context.effectId,
    characterId: payload.characterId,
    toLocationId: payload.toLocationId,
  });
  const prior = await context.store.lookupCommand(
    context.worldInstanceId,
    SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
  );
  if (prior) {
    if (!prior.receipt.ok) throw new Error('A hostile encounter entry command was reused with a different payload.');
    return;
  }

  const history = await context.store.readStream(context.worldInstanceId, payload.characterId);
  const character = replayCharacter(history);
  if (
    !character ||
    character.archived ||
    character.locationId !== payload.toLocationId ||
    character.combat?.status === 'active'
  ) return;

  const location = context.world.locations.find((candidate) => candidate.id === payload.toLocationId);
  const opponent = location?.npcs?.find((candidate) =>
    candidate.combatDisposition === 'hostile' && candidate.combatProfile,
  );
  if (!opponent?.combatProfile) return;

  const playerMaxHealth = maximumHealthForLevel(
    character.advancement?.level ?? 1,
    character.attributes.constitution,
  );
  const playerHealth = Math.min(character.health?.current ?? playerMaxHealth, playerMaxHealth);
  if (playerHealth <= 0) return;

  const encounter = {
    encounterId: context.effectId,
    locationId: payload.toLocationId,
    opponentNpcId: opponent.id,
    opponentName: opponent.name,
    opponentStyle: opponent.combatProfile.style ?? 'steady',
    round: 0,
    playerHealth,
    playerMaxHealth,
    opponentHealth: opponent.combatProfile.maxHealth,
    opponentMaxHealth: opponent.combatProfile.maxHealth,
    status: 'active',
    lastAction: 'encounter',
    lastNarration: `${opponent.name} rushes you as you enter.`,
  };
  const eventPayload = CharacterCombatEncounterStartedEventSchema.shape.payload.parse({
    characterId: character.characterId,
    encounter,
  });
  const result = await context.store.append({
    worldInstanceId: context.worldInstanceId,
    streamId: character.characterId,
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion: history.at(-1)?.aggregateVersion ?? 0,
    events: [{ type: 'character.combat_encounter_started', version: 1, payload: eventPayload }],
  });
  if (!result.receipt.ok) {
    throw new Error(`Could not start hostile encounter: ${result.receipt.code}.`);
  }
}

export const combatPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.combat',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: [characterStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0', 'mudd.interactions': '^1.0.0' },
    eventSchemaVersions: {
      'character.combat_action_resolved': 3,
      'character.combat_encounter_started': 1,
      'character.advancement_awarded': 2,
      'character.combat_item_used': 1,
      'character.inn_rest_completed': 2,
      'character.stamina_spent': 1,
      'character.respawned': 1,
    },
  },
  register(pluginContext) {
    const { registerCommand, registerQuery, registerEffect, requireCapability, optionalCapability } = pluginContext;
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    registerEffect(
      'combat.hostile-npc-entry',
      1,
      WorldLocationEnteredEffectSchema,
      startHostileNpcEncounter,
    );
    requireCapability(interactionPolicyRegistry);
    registerPvpCombat(pluginContext, characterState);

    registerQuery('character.stats', CharacterStatsQuerySchema, async (query, context) => {
      const character = await characterState.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      return CharacterStatsProjectionSchema.parse(calculateCharacterStats(character));
    });

    registerCommand('inn.rest', InnRestCommandSchema, async (command, context) => {
      const guards = context.world.classCatalog ? await classAdoptionGuards(context, command.characterId) : undefined;
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      assertCharacterStanding(character);
      if (character.combat?.status === 'active') {
        throw new RuleViolationError('You cannot rest while combat is active. Flee first.');
      }

      const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
      const inn = location?.inn;
      if (!inn || inn.id !== command.payload.innId) {
        throw new RuleViolationError('There is no such inn here.');
      }

      const currency = context.world.currency;
      if (!currency) throw new RuleViolationError('This world has no configured currency.');
      if (!character.wallet || character.wallet.currencyId !== currency.id) {
        throw new RuleViolationError('This character’s wallet is not ready yet. Refresh the world and try again.');
      }
      if (character.wallet.balance < inn.restPrice) {
        throw new RuleViolationError(`You need ${inn.restPrice} ${currency.name}${inn.restPrice === 1 ? '' : 's'} to rest.`);
      }

      const maximum = maximumHealthForLevel(
        character.advancement?.level ?? 1,
        character.attributes.constitution,
      );
      const current = Math.min(character.health?.current ?? maximum, maximum);
      const staminaRestored = character.resources.stamina.maximum - character.resources.stamina.current;
      const manaRestored = character.resources.mana.maximum - character.resources.mana.current;
      if (current >= maximum && staminaRestored === 0 && manaRestored === 0) {
        throw new RuleViolationError('Your health, stamina, and mana are already full.');
      }
      const healthRestored = maximum - current;
      const resources = {
        stamina: { ...character.resources.stamina, current: character.resources.stamina.maximum },
        mana: { ...character.resources.mana, current: character.resources.mana.maximum },
      };
      const payload = {
        characterId: character.characterId,
        locationId: character.locationId,
        innId: inn.id,
        currencyId: currency.id,
        price: inn.restPrice,
        healthRestored,
        staminaRestored,
        manaRestored,
        health: { current: maximum, maximum },
        resources,
      };
      CharacterInnRestCompletedEventV2Schema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.inn_rest_completed', version: 2, payload }],
        guards,
      };
    });

    registerCommand('combat.action', CombatActionCommandSchema, async (command, context) => {
      const guards = context.world.classCatalog ? await classAdoptionGuards(context, command.characterId) : undefined;
      const loadedCharacter = await characterState.load(context, command.characterId);
      if (!loadedCharacter || loadedCharacter.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(loadedCharacter);
      assertCharacterStanding(loadedCharacter);
      const recoveryEvent = staminaRecoveryEventForCommand(
        loadedCharacter,
        context.now(),
        context.presenceAnchorAt,
      );
      const character: CharacterProjection = {
        ...loadedCharacter,
        health: recoveryEvent.payload.health,
        resources: recoveryEvent.payload.resources,
        staminaRecovery: recoveryEvent.payload.recovery,
        ...(loadedCharacter.combat?.status === 'active' ? {
          combat: { ...loadedCharacter.combat, playerHealth: recoveryEvent.payload.health.current },
        } : {}),
      };

      if (command.payload.action === 'use-item' && character.combat?.status !== 'active') {
        if (command.payload.encounterId) {
          throw new RuleViolationError('That combat encounter is no longer active.');
        }
        const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
        if (!item) throw new RuleViolationError('You are not carrying that item.');
        if (!item.consumable || item.equipment) {
          throw new RuleViolationError(`${item.label} cannot be used as a healing item.`);
        }
        const maximum = maximumHealthForLevel(
          character.advancement?.level ?? 1,
          character.attributes.constitution,
        );
        const current = Math.min(character.health?.current ?? maximum, maximum);
        if (current >= maximum) throw new RuleViolationError('You are already at full health.');
        const healingDone = Math.min(item.consumable.amount, maximum - current);
        const payload = {
          characterId: character.characterId,
          itemId: item.id,
          healingDone,
          health: { current: current + healingDone, maximum },
        };
        CharacterCombatItemUsedEventSchema.shape.payload.parse(payload);
        return {
          streamId: character.characterId,
          expectedVersion: command.expectedVersion,
          events: [{ type: 'character.combat_item_used', version: 1, payload }],
        };
      }

      let encounter = character.combat;
      if (encounter?.status === 'active') {
        if (command.payload.encounterId !== encounter.encounterId) {
          throw new RuleViolationError('That combat encounter is no longer active. Refresh and try again.');
        }
        if (encounter.locationId !== character.locationId) {
          throw new RuleViolationError('You are no longer at the combat location.');
        }
      } else {
        const targetNpcId = command.payload.targetNpcId;
        if (command.payload.action !== 'attack' || !targetNpcId) {
          throw new RuleViolationError('Choose a combatant here to begin a fight.');
        }
        const npc = findCombatOpponent(context.world, character.locationId, targetNpcId);
        if (!npc?.combatProfile) {
          throw new RuleViolationError('That opponent is not available here.');
        }
        const playerMaxHealth = maximumHealthForLevel(
          character.advancement?.level ?? 1,
          character.attributes.constitution,
        );
        const playerHealth = Math.min(character.health?.current ?? playerMaxHealth, playerMaxHealth);
        encounter = {
          encounterId: context.makeId(),
          locationId: character.locationId,
          opponentNpcId: npc.id,
          opponentName: npc.name,
          opponentStyle: npc.combatProfile.style ?? 'steady',
          round: 0,
          playerHealth,
          playerMaxHealth,
          opponentHealth: npc.combatProfile.maxHealth,
          opponentMaxHealth: npc.combatProfile.maxHealth,
          status: 'active',
          lastAction: 'attack',
          lastNarration: 'The practice begins.',
        };
      }

      const npc = findCombatOpponent(context.world, encounter.locationId, encounter.opponentNpcId);
      if (!npc?.combatProfile) throw new RuleViolationError('That opponent is no longer available.');

      const action = command.payload.action;
      const ability = action === 'ability'
        ? (() => {
          const policy = optionalCapability<ClassCombatPolicy>(classCombatPolicyCapability);
          if (!policy) throw new RuleViolationError('ABILITY_UNSUPPORTED: This world has no class actions.');
          return policy.resolve(character, command.payload.abilityId, encounter.encounterId, context.commandId);
        })() : undefined;
      if (action === 'flee' && character.resources.stamina.current < FLEE_STAMINA_COST) {
        throw new RuleViolationError(`You need ${FLEE_STAMINA_COST} stamina to flee.`);
      }
      const opponentStyle = encounter.opponentStyle ?? npc.combatProfile.style ?? 'steady';
      const attackDamage = ability?.damage ?? characterAttackDamage(character);
      const damageReduction = characterDefenseReduction(character);
      let damageDealt = 0;
      let damageTaken = 0;
      let healingDone = 0;
      let consumedItemId: string | undefined;
      let opponentHealth = encounter.opponentHealth;
      let playerHealth = encounter.playerHealth;
      let status = encounter.status;
      let narration: string;
      const round = encounter.round + 1;
      let healingNarration = '';

      if (action === 'flee') {
        status = 'fled';
        narration = `You retreat from ${npc.name}. The encounter ends.`;
      } else {
        if (action === 'use-item') {
          const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
          if (!item) throw new RuleViolationError('You are not carrying that item.');
          if (!item.consumable || item.equipment) {
            throw new RuleViolationError(`${item.label} cannot be used as a combat item.`);
          }
          const missingHealth = encounter.playerMaxHealth - encounter.playerHealth;
          if (missingHealth <= 0) throw new RuleViolationError('You are already at full health.');
          healingDone = Math.min(item.consumable.amount, missingHealth);
          playerHealth += healingDone;
          consumedItemId = item.id;
          healingNarration = `You use the ${item.label.toLocaleLowerCase()} and recover ${healingDone} health.`;
        }

        if (action === 'attack' || action === 'ability') {
          const guard = opponentStyle === 'guardian' ? npc.combatProfile.defense ?? 1 : 0;
          damageDealt = Math.min(Math.max(0, attackDamage - guard), opponentHealth);
          opponentHealth -= damageDealt;
        }

        if (opponentHealth === 0) {
          status = 'victory';
          narration = `You defeat ${npc.name}.`;
        } else if (action === 'defend') {
          narration = opponentStyle === 'heavy' && round % 2 === 1
            ? `You hold your guard while ${npc.name} winds up a heavy strike.`
            : opponentStyle === 'heavy'
              ? `You block ${npc.name}'s heavy strike and take no damage.`
              : `You guard against ${npc.name}'s strike and take no damage.`;
        } else if (opponentStyle === 'heavy' && round % 2 === 1) {
          const actionNarration = healingNarration || `You deal ${damageDealt} damage to ${npc.name}.`;
          narration = `${actionNarration} ${action === 'attack' ? 'It' : npc.name} winds up for a heavy strike.`;
        } else {
          const incomingDamage = npc.combatProfile.attackDamage;
          damageTaken = Math.min(Math.max(0, incomingDamage - damageReduction), playerHealth);
          playerHealth -= damageTaken;
          if (playerHealth === 0) {
            status = 'defeat';
            narration = `${healingNarration ? `${healingNarration} ` : ''}${npc.name} lands a ${opponentStyle === 'heavy' ? 'heavy ' : ''}strike. You are down.`;
          } else {
            const actionNarration = healingNarration || `You deal ${damageDealt} damage to ${npc.name}.`;
            const guardText = action === 'attack' && opponentStyle === 'guardian' ? ' Its guard softens your blow.' : '';
            const strikeText = opponentStyle === 'heavy' ? ' Its heavy strike' : ' It strikes back';
            narration = `${actionNarration}${guardText}${strikeText} for ${damageTaken}${damageReduction ? ` after your armor absorbs ${damageReduction}` : ''}.`;
          }
        }
      }

      const resolvedEncounter = {
        ...encounter,
        round,
        playerHealth,
        opponentHealth,
        status,
        lastAction: action,
        lastNarration: ability ? `${character.characterClass!.coreAction.label}: ${narration}` : narration,
      };
      const payload = {
        characterId: character.characterId,
        damageDealt,
        damageTaken,
        healingDone,
        ...(consumedItemId ? { consumedItemId } : {}),
        encounter: resolvedEncounter,
      };
      CombatActionResolvedEventV3Schema.shape.payload.parse(payload);
      const events: ProposedDomainEvent[] = [recoveryEvent, {
        type: 'character.combat_action_resolved',
        version: 3,
        payload,
      }];
      if (ability) events.push(ability.event);
      if (action === 'flee') {
        const staminaPayload = CharacterStaminaSpentEventSchema.shape.payload.parse({
          characterId: character.characterId,
          cause: 'solo-flee',
          causeId: resolvedEncounter.encounterId,
          staminaSpent: FLEE_STAMINA_COST,
          resources: {
            ...character.resources,
            stamina: {
              ...character.resources.stamina,
              current: character.resources.stamina.current - FLEE_STAMINA_COST,
            },
          },
        });
        events.push({ type: 'character.stamina_spent', version: 1, payload: staminaPayload });
      }
      let effects: ProposedEventEffect[] = [];
      if (status === 'defeat' && playerHealth === 0) {
        const respawn = prepareCharacterRespawn(
          character,
          context,
          'pve',
          resolvedEncounter.encounterId,
          resolvedEncounter.locationId,
          consumedItemId ? [consumedItemId] : [],
          resolvedEncounter.playerMaxHealth,
        );
        if (respawn) {
          events.push(respawn.event);
          effects = respawn.effects;
        }
      }
      if (status === 'victory') {
        effects.push(createWorldCorpseEffect(context.makeId, {
          encounterId: resolvedEncounter.encounterId,
          opponentId: npc.id,
          opponentName: npc.name,
          locationId: resolvedEncounter.locationId,
          loot: resolveCombatLoot(npc.loot, context.rng),
          createdAt: context.now().toISOString(),
          lifecycleRules: context.world.corpseLifecycle,
          ...(npc.corpse ? { lifecycleOverride: npc.corpse } : {}),
          ...(context.world.currency
            ? {
              currencyId: context.world.currency.id,
              currencyName: context.world.currency.name,
            }
            : {}),
        }));
        const currentAdvancement = character.advancement ?? { experience: 0, level: 1 };
        const totalExperience = currentAdvancement.experience + VICTORY_EXPERIENCE_REWARD;
        const level = levelAfterExperience(currentAdvancement.level, totalExperience);
        const advancementPayload = {
          characterId: character.characterId,
          encounterId: resolvedEncounter.encounterId,
          experienceAwarded: VICTORY_EXPERIENCE_REWARD,
          totalExperience,
          level,
        };
        const advancementWithHealth = {
          ...advancementPayload,
          maximumHealth: maximumHealthForLevel(level, character.attributes.constitution),
        };
        CharacterAdvancementAwardedEventV2Schema.shape.payload.parse(advancementWithHealth);
        events.push({
          type: 'character.advancement_awarded',
          version: 2,
          payload: advancementWithHealth,
        });
      }
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events,
        ...(effects.length ? { effects } : {}),
        guards,
      };
    });
  },
};
