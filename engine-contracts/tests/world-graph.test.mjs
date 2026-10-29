import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPackDraftSchema } from '../dist/src/index.js';

const combatProfile = { maxHealth: 8, attackDamage: 2 };
const mobileNpc = (id, movement, extra = {}) => ({
  id,
  name: id,
  description: 'A traveler.',
  greeting: 'Hello.',
  topics: [],
  unknownTopicResponse: 'I do not know.',
  movement,
  ...extra,
});

const road = (locationIds) => ({
  id: 'road',
  name: 'Old road',
  locationIds,
  encounterChancePercent: 10,
  encounters: [
    { id: 'bandit', name: 'Bandit', combatProfile },
    { id: 'bandit', name: 'Another bandit', combatProfile },
  ],
});

test('world pack validation reports cross-reference and uniqueness failures together', () => {
  const species = {
    id: 'trout',
    name: 'Trout',
    itemTypeId: 'trout-item',
    weightPercent: 10,
    sizeBands: [{
      rarity: 'common',
      weightPercent: 100,
      minLengthCm: 10,
      maxLengthCm: 20,
      minWeightGrams: 5,
      maxWeightGrams: 50,
    }],
  };
  const recipe = {
    id: 'leather-gloves',
    outputTypeId: 'gloves',
    outputLabel: 'Leather gloves',
    outputDescription: 'A pair of leather gloves.',
    requiredLevel: 1,
    experience: 13.8,
    toolTypeIds: ['needle'],
    ingredients: [{ typeId: 'leather', label: 'Leather', quantityPerCraft: 1 }],
  };
  const tree = {
    id: 'pine',
    locationId: 'outside',
    label: 'Pine tree',
    roomDescription: 'A pine tree stands beside the road.',
    stumpDescription: 'A pine stump remains here.',
    logTypeId: 'pine-log',
    logLabel: 'Pine log',
    logDescription: 'A length of pine.',
    maximumLogs: 5,
    respawnSeconds: 60,
    experiencePerLog: 1,
  };
  const invalidWorld = {
    formatVersion: 1,
    packId: 'validation-coverage',
    packVersion: '1',
    displayName: 'Validation coverage',
    respawn: { locationId: 'outside' },
    craftingWorkbenchLocationIds: ['room-a', 'room-a', 'outside'],
    craftingRecipes: [recipe, recipe],
    woodcuttingTrees: [tree, { ...tree, locationId: 'room-a' }],
    fishingSpots: [
      {
        id: 'river',
        locationId: 'outside',
        stateId: 'missing-state',
        label: 'River',
        species: [species],
      },
      {
        id: 'river',
        locationId: 'room-a',
        stateId: 'missing-state',
        label: 'River',
        species: [species],
      },
    ],
    locationGroups: [
      {
        id: 'district',
        name: 'District',
        type: 'town',
        memberships: [
          { locationId: 'room-a', isPrimary: true },
          { locationId: 'room-a', isPrimary: true },
          { locationId: 'outside', isPrimary: true },
        ],
      },
      {
        id: 'district',
        name: 'Another district',
        type: 'town',
        memberships: [{ locationId: 'room-a', isPrimary: true }],
      },
    ],
    roads: [road(['room-a', 'room-b', 'room-c']), road(['room-a', 'outside', 'room-a'])],
    locations: [
      {
        id: 'room-a',
        name: 'Room A',
        description: 'A room.',
        states: [{ id: 'day' }, { id: 'day' }],
        defaultStateId: 'missing-state',
        exits: [
          {
            id: 'bad-exit',
            fromLocationId: 'wrong-room',
            toLocationId: 'missing-room',
            label: 'Passage',
            fromStateId: 'missing-state',
            toStateId: 'missing-state',
            mapLineGapAtLocationId: 'outside',
            roadId: 'missing-road',
          },
          {
            id: 'non-adjacent-road-exit',
            fromLocationId: 'room-a',
            toLocationId: 'room-c',
            label: 'Road',
            roadId: 'road',
          },
        ],
        npcs: [
          mobileNpc('mobile', {
            strategy: 'wander',
            intervalMs: 60_000,
            allowedLocationIds: ['outside', 'room-b'],
          }),
          mobileNpc('guard', {
            strategy: 'wander',
            intervalMs: 60_000,
            allowedLocationIds: ['room-a', 'room-b'],
          }, { combatProfile }),
          mobileNpc('bandit'),
        ],
      },
      {
        id: 'room-b',
        name: 'Room B',
        description: 'Another room.',
        exits: [],
        npcs: [
          mobileNpc('mobile', {
            strategy: 'route',
            intervalMs: 60_000,
            routeLocationIds: ['room-b', 'room-a'],
          }),
        ],
      },
      {
        id: 'room-c',
        name: 'Room C',
        description: 'A third room.',
        exits: [],
      },
    ],
  };

  const result = WorldPackDraftSchema.safeParse(invalidWorld);
  assert.equal(result.success, false);
  const messages = result.error.issues.map(({ message }) => message);
  for (const expected of [
    'The respawn location must be included in the world pack.',
    'Crafting workbench locations must be unique.',
    'Crafting workbench location must exist in this world.',
    'Crafting recipe IDs must be unique.',
    'Woodcutting tree IDs must be unique.',
    'Fishing spot IDs must be unique.',
    'Duplicate location group ID district.',
    'Road road cannot visit the same location more than once.',
    'Mobile NPC ID mobile must be unique in the world.',
    'Combatant NPC guard cannot have autonomous movement.',
    'Location room-a has duplicate state IDs.',
    'Exit bad-exit must start at its containing location.',
    'Exit bad-exit references missing location missing-room.',
    'Exit bad-exit references missing road missing-road.',
    'Exit non-adjacent-road-exit must connect adjacent locations on road road.',
  ]) {
    assert.ok(messages.includes(expected), `Expected world validation to report: ${expected}`);
  }
});
