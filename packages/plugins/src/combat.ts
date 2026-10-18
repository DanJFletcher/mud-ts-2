import {
  CombatActionCommandSchema,
  CombatActionResolvedEventV2Schema,
} from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import { characterStateCapability, type CharacterStateCapability } from './character.js';

const PLAYER_MAX_HEALTH = 6;
const PLAYER_ATTACK_DAMAGE = 2;

export const combatPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.combat',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requires: [characterStateCapability.id],
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    eventSchemaVersions: { 'character.combat_action_resolved': 2 },
  },
  register({ registerCommand, requireCapability }) {
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);

    registerCommand('combat.action', CombatActionCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');

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
        encounter = {
          encounterId: context.makeId(),
          locationId: character.locationId,
          opponentNpcId: npc.id,
          opponentName: npc.name,
          opponentStyle: npc.combatProfile.style ?? 'steady',
          round: 0,
          playerHealth: PLAYER_MAX_HEALTH,
          playerMaxHealth: PLAYER_MAX_HEALTH,
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
      let opponentHealth = encounter.opponentHealth;
      let playerHealth = encounter.playerHealth;
      let status = encounter.status;
      let narration: string;
      const round = encounter.round + 1;

      if (action === 'flee') {
        status = 'fled';
        narration = `You retreat from ${npc.name}. The encounter ends without lasting injury.`;
      } else {
        if (action === 'attack') {
          const guard = opponentStyle === 'guardian' ? npc.combatProfile.defense ?? 1 : 0;
          damageDealt = Math.min(Math.max(0, attackDamage - guard), opponentHealth);
          opponentHealth -= damageDealt;
        }

        if (opponentHealth === 0) {
          status = 'victory';
          narration = `You defeat ${npc.name}. The practice ends without lasting injury.`;
        } else if (action === 'defend') {
          narration = opponentStyle === 'heavy' && round % 2 === 1
            ? `You hold your guard while ${npc.name} winds up a heavy strike.`
            : opponentStyle === 'heavy'
              ? `You block ${npc.name}'s heavy strike and take no damage.`
              : `You guard against ${npc.name}'s strike and take no damage.`;
        } else if (opponentStyle === 'heavy' && round % 2 === 1) {
          narration = `You deal ${damageDealt} damage to ${npc.name}. It winds up for a heavy strike.`;
        } else {
          const heavyDamage = opponentStyle === 'heavy' ? npc.combatProfile.attackDamage : 0;
          const incomingDamage = heavyDamage || npc.combatProfile.attackDamage;
          damageTaken = Math.min(Math.max(0, incomingDamage - damageReduction), playerHealth);
          playerHealth -= damageTaken;
          if (playerHealth === 0) {
            status = 'defeat';
            narration = `${npc.name} lands a ${opponentStyle === 'heavy' ? 'heavy ' : ''}strike. You are down; the practice ends without lasting injury.`;
          } else {
            const guardText = opponentStyle === 'guardian' ? ' Its guard softens your blow.' : '';
            const strikeText = opponentStyle === 'heavy' ? ' Its heavy strike' : ' It strikes back';
            narration = `You deal ${damageDealt} damage to ${npc.name}.${guardText}${strikeText} for ${damageTaken}${damageReduction ? ` after your armor absorbs ${damageReduction}` : ''}.`;
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
        encounter: resolvedEncounter,
      };
      CombatActionResolvedEventV2Schema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.combat_action_resolved', version: 2, payload }],
      };
    });
  },
};
