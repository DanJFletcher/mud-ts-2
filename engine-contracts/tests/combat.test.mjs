import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterCombatEncounterStartedEventSchema,
  CombatActionCommandSchema,
  CombatActionResolvedEventV1Schema,
  CombatActionResolvedEventV2Schema,
  CombatActionResolvedEventV3Schema,
  CombatEncounterProjectionSchema,
  NpcCombatProfileSchema,
} from '../dist/src/index.js';

const encounter = (overrides = {}) => ({
  encounterId: 'encounter-1',
  locationId: 'room-1',
  opponentNpcId: 'wolf-1',
  opponentName: 'Grey Wolf',
  opponentStyle: 'steady',
  round: 0,
  playerHealth: 10,
  playerMaxHealth: 10,
  opponentHealth: 5,
  opponentMaxHealth: 5,
  status: 'active',
  lastAction: 'encounter',
  lastNarration: 'The wolf circles warily.',
  ...overrides,
});

const eventBase = {
  eventId: 'event-1',
  worldInstanceId: 'world-1',
  aggregateId: 'character-1',
  aggregateVersion: 1,
  causationCommandId: 'command-1',
  actorId: 'player-1',
  occurredAt: '2026-10-27T12:00:00.000Z',
  tick: 1,
};

const resolvedEvent = (version, combatEncounter, extra = {}) => ({
  ...eventBase,
  type: 'character.combat_action_resolved',
  version,
  payload: {
    characterId: 'character-1',
    damageDealt: 1,
    damageTaken: 1,
    encounter: combatEncounter,
    ...extra,
  },
});

test('validates combat profiles, encounter health bounds, and encounter-start state', () => {
  assert.equal(NpcCombatProfileSchema.safeParse({ maxHealth: 8, attackDamage: 2, style: 'heavy', defense: 1 }).success, true);
  assert.equal(NpcCombatProfileSchema.safeParse({ maxHealth: 1001, attackDamage: 2 }).success, false);

  const validEncounter = encounter();
  assert.equal(CombatEncounterProjectionSchema.safeParse(validEncounter).success, true);
  assert.equal(CombatEncounterProjectionSchema.safeParse(encounter({ playerHealth: 11 })).success, false);
  assert.equal(CombatEncounterProjectionSchema.safeParse(encounter({ opponentHealth: 6 })).success, false);
  assert.equal(CombatEncounterProjectionSchema.safeParse(encounter({
    status: 'victory',
    opponentHealth: 1,
    lastAction: 'attack',
    round: 1,
  })).success, false);
  assert.equal(CombatEncounterProjectionSchema.safeParse(encounter({
    status: 'defeat',
    playerHealth: 1,
    lastAction: 'attack',
    round: 1,
  })).success, false);

  const started = {
    ...eventBase,
    type: 'character.combat_encounter_started',
    version: 1,
    payload: { characterId: 'character-1', encounter: validEncounter },
  };
  assert.equal(CharacterCombatEncounterStartedEventSchema.safeParse(started).success, true);
  assert.equal(CharacterCombatEncounterStartedEventSchema.safeParse({
    ...started,
    payload: { ...started.payload, encounter: encounter({ round: 1, lastAction: 'attack' }) },
  }).success, false);
});

test('requires combat action targets and matching item and ability fields', () => {
  const command = (payload) => ({
    type: 'combat.action',
    version: 1,
    commandId: 'combat-command',
    worldInstanceId: 'world-1',
    characterId: 'character-1',
    expectedVersion: 1,
    payload,
  });

  assert.equal(CombatActionCommandSchema.safeParse(command({ action: 'attack', targetNpcId: 'wolf-1' })).success, true);
  assert.equal(CombatActionCommandSchema.safeParse(command({ action: 'ability', abilityId: 'heavy-strike', encounterId: 'encounter-1' })).success, true);
  assert.equal(CombatActionCommandSchema.safeParse(command({ action: 'use-item', itemId: 'healing-potion' })).success, true);

  const invalidPayloads = [
    { action: 'ability', encounterId: 'encounter-1' },
    { action: 'attack', targetNpcId: 'wolf-1', abilityId: 'heavy-strike' },
    { action: 'attack' },
    { action: 'defend' },
    { action: 'use-item' },
    { action: 'use-item', itemId: 'healing-potion', targetNpcId: 'wolf-1' },
    { action: 'attack', targetNpcId: 'wolf-1', itemId: 'healing-potion' },
    { action: 'attack', encounterId: 'encounter-1', targetNpcId: 'wolf-1' },
  ];
  for (const payload of invalidPayloads) {
    assert.equal(CombatActionCommandSchema.safeParse(command(payload)).success, false);
  }
});

test('validates resolved combat event versions and records item healing consistently', () => {
  const ordinary = encounter({ round: 1, lastAction: 'attack' });
  assert.equal(CombatActionResolvedEventV1Schema.safeParse(resolvedEvent(1, ordinary)).success, true);
  assert.equal(CombatActionResolvedEventV2Schema.safeParse(resolvedEvent(2, ordinary)).success, true);
  assert.equal(CombatActionResolvedEventV3Schema.safeParse(resolvedEvent(3, ordinary)).success, true);

  const usedItem = encounter({ round: 1, lastAction: 'use-item' });
  assert.equal(CombatActionResolvedEventV3Schema.safeParse(resolvedEvent(3, usedItem, {
    consumedItemId: 'healing-potion',
    healingDone: 4,
  })).success, true);
  assert.equal(CombatActionResolvedEventV3Schema.safeParse(resolvedEvent(3, ordinary, {
    consumedItemId: 'healing-potion',
    healingDone: 4,
  })).success, false);
  assert.equal(CombatActionResolvedEventV3Schema.safeParse(resolvedEvent(3, usedItem)).success, false);
  assert.equal(CombatActionResolvedEventV3Schema.safeParse(resolvedEvent(3, encounter())).success, false);
});
