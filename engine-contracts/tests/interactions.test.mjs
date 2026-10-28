import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PvpCombatActionCommandSchema,
} from '../dist/src/index.js';

const command = (action, extra = {}) => ({
  type: 'pvp.action',
  version: 1,
  commandId: 'command-1',
  worldInstanceId: 'world-1',
  characterId: 'character-1',
  payload: {
    encounterId: 'encounter-1',
    action,
    ...extra,
  },
});

test('PvP action commands only accept item and ability IDs for their matching actions', () => {
  assert.equal(PvpCombatActionCommandSchema.safeParse(command('attack')).success, true);
  assert.equal(PvpCombatActionCommandSchema.safeParse(command('use-item', {
    itemId: 'healing-potion',
  })).success, true);
  assert.equal(PvpCombatActionCommandSchema.safeParse(command('ability', {
    abilityId: 'shield-strike',
  })).success, true);

  assert.equal(PvpCombatActionCommandSchema.safeParse(command('attack', {
    abilityId: 'shield-strike',
  })).success, false);
  assert.equal(PvpCombatActionCommandSchema.safeParse(command('ability')).success, false);
  assert.equal(PvpCombatActionCommandSchema.safeParse(command('use-item')).success, false);
  assert.equal(PvpCombatActionCommandSchema.safeParse(command('defend', {
    itemId: 'healing-potion',
  })).success, false);
});
