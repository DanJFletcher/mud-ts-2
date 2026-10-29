import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TeamCombatActionCommandSchema,
  TeamCombatantSchema,
} from '../dist/src/index.js';

const combatant = (overrides = {}) => ({
  participantId: 'participant-1',
  teamId: 'team-1',
  kind: 'player',
  characterId: 'character-1',
  playerId: 'player-1',
  displayName: 'Rowan',
  health: 10,
  maximumHealth: 10,
  defending: false,
  status: 'active',
  ...overrides,
});

const command = (payload) => ({
  type: 'team.combat.action',
  version: 1,
  commandId: 'command-1',
  worldInstanceId: 'world-1',
  characterId: 'character-1',
  expectedVersion: 1,
  payload,
});

test('team combatants enforce player and NPC identity boundaries', () => {
  assert.equal(TeamCombatantSchema.safeParse(combatant()).success, true);
  assert.equal(TeamCombatantSchema.safeParse(combatant({
    kind: 'npc',
    npcId: 'bandit-1',
    characterId: undefined,
    playerId: undefined,
  })).success, true);
  assert.equal(TeamCombatantSchema.safeParse(combatant({
    characterId: undefined,
    playerId: undefined,
  })).success, false);
  assert.equal(TeamCombatantSchema.safeParse(combatant({
    kind: 'npc',
    npcId: 'bandit-1',
  })).success, false);
});

test('team combat actions require matching item, ability, and target fields', () => {
  const validPayloads = [
    { encounterId: 'encounter-1', action: 'attack', targetParticipantId: 'bandit-1' },
    { encounterId: 'encounter-1', action: 'ability', abilityId: 'heavy-strike', targetParticipantId: 'bandit-1' },
    { encounterId: 'encounter-1', action: 'use-item', itemId: 'healing-potion' },
    { encounterId: 'encounter-1', action: 'defend' },
  ];
  for (const payload of validPayloads) {
    assert.equal(TeamCombatActionCommandSchema.safeParse(command(payload)).success, true);
  }

  const invalidPayloads = [
    { encounterId: 'encounter-1', action: 'ability' },
    { encounterId: 'encounter-1', action: 'attack', abilityId: 'heavy-strike' },
    { encounterId: 'encounter-1', action: 'use-item' },
    { encounterId: 'encounter-1', action: 'defend', itemId: 'healing-potion' },
    { encounterId: 'encounter-1', action: 'flee', targetParticipantId: 'bandit-1' },
  ];
  for (const payload of invalidPayloads) {
    assert.equal(TeamCombatActionCommandSchema.safeParse(command(payload)).success, false);
  }
});
