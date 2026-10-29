import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NpcDefinitionSchema,
  NpcDialogueTopicDefinitionSchema,
  NpcMovementBehaviorSchema,
  NpcPresenceProjectionSchema,
  NpcQuestResponseDefinitionSchema,
} from '../dist/src/index.js';

const npc = (overrides = {}) => ({
  id: 'mara',
  name: 'Mara',
  description: 'A path keeper.',
  greeting: 'The road is open.',
  topics: [],
  unknownTopicResponse: 'I have nothing to add.',
  ...overrides,
});

test('hostile NPC definitions need combat rules while passive NPCs do not', () => {
  assert.equal(NpcDefinitionSchema.safeParse(npc()).success, true);
  assert.equal(NpcDefinitionSchema.safeParse(npc({
    combatDisposition: 'hostile',
  })).success, false);
  assert.equal(NpcDefinitionSchema.safeParse(npc({
    combatDisposition: 'hostile',
    combatProfile: { maxHealth: 10, attackDamage: 2, style: 'steady' },
  })).success, true);
  assert.deepEqual(NpcPresenceProjectionSchema.parse({ id: 'mara', name: 'Mara' }), {
    id: 'mara',
    name: 'Mara',
    canChallenge: false,
    combatDisposition: 'passive',
    canShop: false,
  });
});

test('NPC dialogue quest responses normalize objective lists and reject contradictions', () => {
  const base = {
    questId: 'find-marker',
    status: 'active',
    response: 'You found the trail marker.',
  };
  assert.deepEqual(NpcQuestResponseDefinitionSchema.parse(base), {
    ...base,
    requiresCompletedObjectiveIds: [],
    requiresIncompleteObjectiveIds: [],
  });
  assert.equal(NpcQuestResponseDefinitionSchema.safeParse({
    ...base,
    requiresCompletedObjectiveIds: ['read-marker'],
    requiresIncompleteObjectiveIds: ['read-marker'],
  }).success, false);
  assert.equal(NpcDialogueTopicDefinitionSchema.safeParse({
    id: 'directions',
    keywords: ['road'],
    response: 'The path leads north.',
    questResponses: [base],
  }).success, true);
});

test('NPC movement supports both wandering and repeating routes', () => {
  const wander = NpcMovementBehaviorSchema.parse({
    strategy: 'wander',
    intervalMs: 60_000,
    allowedLocationIds: ['square', 'bridge'],
  });
  assert.equal(wander.stayChancePercent, 10);
  assert.equal(NpcMovementBehaviorSchema.safeParse({
    strategy: 'route',
    intervalMs: 60_000,
    routeLocationIds: ['square', 'bridge'],
    narrative: { arrival: 'Mara returns to the square.' },
  }).success, true);
  assert.equal(NpcMovementBehaviorSchema.safeParse({
    strategy: 'route',
    intervalMs: 4_000,
    routeLocationIds: ['square'],
  }).success, false);
});
