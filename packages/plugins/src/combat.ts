import {
  CombatActionCommandSchema,
  CombatActionResolvedEventSchema,
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
    eventSchemaVersions: { 'character.combat_action_resolved': 1 },
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
          damageDealt = Math.min(attackDamage, opponentHealth);
          opponentHealth -= damageDealt;
        }

        if (opponentHealth === 0) {
          status = 'victory';
          narration = `You defeat ${npc.name}. The practice ends without lasting injury.`;
        } else if (action === 'defend') {
          narration = `You guard against ${npc.name}'s padded strike and take no damage.`;
        } else {
          damageTaken = Math.min(Math.max(0, npc.combatProfile.attackDamage - damageReduction), playerHealth);
          playerHealth -= damageTaken;
          if (playerHealth === 0) {
            status = 'defeat';
            narration = `${npc.name} lands a padded strike. You are down; the practice ends without lasting injury.`;
          } else {
            narration = `You deal ${damageDealt} damage to ${npc.name}. It strikes back for ${damageTaken}${damageReduction ? ` after your armor absorbs ${damageReduction}` : ''}.`;
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
      CombatActionResolvedEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{ type: 'character.combat_action_resolved', version: 1, payload }],
      };
    });
  },
};
