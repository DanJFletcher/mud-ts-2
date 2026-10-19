import {
  CharacterAdvancementAwardedEventV2Schema,
  CharacterCombatItemUsedEventSchema,
  CharacterInnRestCompletedEventSchema,
  CombatActionCommandSchema,
  CombatActionResolvedEventV3Schema,
  InnRestCommandSchema,
} from '@mudd/contracts';
import type { EnginePlugin, ProposedDomainEvent } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import { assertCharacterAlive, characterStateCapability, type CharacterStateCapability } from './character.js';
import { registerPvpCombat } from './pvp-combat.js';
import { interactionPolicyRegistry } from './interactions.js';

const PLAYER_BASE_MAX_HEALTH = 6;
const PLAYER_HEALTH_PER_LEVEL = 2;
const PLAYER_ATTACK_DAMAGE = 2;
const VICTORY_EXPERIENCE_REWARD = 10;
const MAX_LEVEL = 10;

function experienceRequiredForNextLevel(level: number): number {
  return level * 20;
}

function maximumHealthForLevel(level: number): number {
  return PLAYER_BASE_MAX_HEALTH + (level - 1) * PLAYER_HEALTH_PER_LEVEL;
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
      'character.advancement_awarded': 2,
      'character.combat_item_used': 1,
      'character.inn_rest_completed': 1,
    },
  },
  register(pluginContext) {
    const { registerCommand, requireCapability } = pluginContext;
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    requireCapability(interactionPolicyRegistry);
    registerPvpCombat(pluginContext, characterState);

    registerCommand('inn.rest', InnRestCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
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

      const maximum = maximumHealthForLevel(character.advancement?.level ?? 1);
      const current = Math.min(character.health?.current ?? maximum, maximum);
      if (current >= maximum) throw new RuleViolationError('You are already at full health.');
      const healthRestored = maximum - current;
      const payload = {
        characterId: character.characterId,
        locationId: character.locationId,
        innId: inn.id,
        currencyId: currency.id,
        price: inn.restPrice,
        healthRestored,
        health: { current: maximum, maximum },
      };
      CharacterInnRestCompletedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.inn_rest_completed', version: 1, payload }],
      };
    });

    registerCommand('combat.action', CombatActionCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);

      if (command.payload.action === 'use-item' && character.combat?.status !== 'active') {
        if (command.payload.encounterId) {
          throw new RuleViolationError('That combat encounter is no longer active.');
        }
        const item = character.inventory.find((candidate) => candidate.id === command.payload.itemId);
        if (!item) throw new RuleViolationError('You are not carrying that item.');
        if (!item.consumable || item.equipment) {
          throw new RuleViolationError(`${item.label} cannot be used as a healing item.`);
        }
        const maximum = maximumHealthForLevel(character.advancement?.level ?? 1);
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
        const npc = context.world.locations
          .find((location) => location.id === character.locationId)
          ?.npcs?.find((candidate) => candidate.id === targetNpcId && candidate.combatProfile);
        if (!npc?.combatProfile) {
          throw new RuleViolationError('That opponent is not available here.');
        }
        const playerMaxHealth = maximumHealthForLevel(character.advancement?.level ?? 1);
        const playerHealth = Math.min(character.health?.current ?? playerMaxHealth, playerMaxHealth);
        if (playerHealth <= 0) {
          throw new RuleViolationError('You are too hurt to begin another encounter. Use a healing item first.');
        }
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

      const npc = context.world.locations
        .find((location) => location.id === encounter.locationId)
        ?.npcs?.find((candidate) => candidate.id === encounter.opponentNpcId && candidate.combatProfile);
      if (!npc?.combatProfile) throw new RuleViolationError('That opponent is no longer available.');

      const action = command.payload.action;
      const opponentStyle = encounter.opponentStyle ?? npc.combatProfile.style ?? 'steady';
      const weapon = character.inventory.find((item) => item.id === character.equipment.weaponItemId);
      const armor = character.inventory.find((item) => item.id === character.equipment.armorItemId);
      const attackDamage = PLAYER_ATTACK_DAMAGE + (weapon?.equipment?.attackBonus ?? 0);
      const damageReduction = armor?.equipment?.defenseBonus ?? 0;
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

        if (action === 'attack') {
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
        lastNarration: narration,
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
      const events: ProposedDomainEvent[] = [
        { type: 'character.combat_action_resolved', version: 3, payload },
      ];
      if (status === 'victory') {
        const currentAdvancement = character.advancement ?? { experience: 0, level: 1 };
        const totalExperience = currentAdvancement.experience + VICTORY_EXPERIENCE_REWARD;
        let level = currentAdvancement.level;
        while (level < MAX_LEVEL && totalExperience >= experienceRequiredForNextLevel(level)) {
          level += 1;
        }
        const advancementPayload = {
          characterId: character.characterId,
          encounterId: resolvedEncounter.encounterId,
          experienceAwarded: VICTORY_EXPERIENCE_REWARD,
          totalExperience,
          level,
        };
        const advancementWithHealth = {
          ...advancementPayload,
          maximumHealth: maximumHealthForLevel(level),
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
      };
    });
  },
};
