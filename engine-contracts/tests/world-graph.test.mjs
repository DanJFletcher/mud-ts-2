import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPackDraftSchema, validateDraftWorldGraph } from '../dist/src/index.js';

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
    'Duplicate authored NPC ID mobile.',
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

function identityWorld() {
  return WorldPackDraftSchema.parse({
    formatVersion: 1, packId: 'npc-identity', packVersion: '1', displayName: 'Identity checks',
    locations: ['a', 'b'].map((id, index) => ({
      id, name: id, description: 'A room.',
      exits: [{ id: `${id}-exit`, fromLocationId: id, toLocationId: index ? 'a' : 'b', label: 'Passage' }],
      npcs: [mobileNpc(`resident-${id}`)],
    })),
  });
}

for (const [firstMobile, secondMobile, sameRoom] of [
  [false, false, false], [false, true, false], [true, false, false],
  [true, true, false], [false, false, true],
]) {
  test(`NPC identity rejects duplicates: mobile=${firstMobile}/${secondMobile}, sameRoom=${sameRoom}`, () => {
    const world = identityWorld();
    const first = world.locations[0].npcs[0];
    const second = world.locations[1].npcs[0];
    second.id = first.id;
    const movement = { strategy: 'wander', intervalMs: 60_000, allowedLocationIds: ['a', 'b'] };
    if (firstMobile) first.movement = structuredClone(movement);
    if (secondMobile) second.movement = structuredClone(movement);
    if (sameRoom) {
      world.locations[0].npcs.push(second);
      world.locations[1].npcs = [];
    }
    const parsed = WorldPackDraftSchema.safeParse(world);
    assert.equal(parsed.success, false);
    const issue = parsed.error.issues.find(({ message }) => message === `Duplicate authored NPC ID ${first.id}.`);
    assert.ok(issue);
    assert.deepEqual(issue.path, ['locations', sameRoom ? 0 : 1, 'npcs', sameRoom ? 1 : 0, 'id']);
    assert.deepEqual(validateDraftWorldGraph(world), [`Duplicate authored NPC ID ${first.id}.`]);
  });
}

test('NPC identity accepts distinct IDs, repeated names, empty rooms and independent packs', () => {
  const world = identityWorld();
  const first = world.locations[0].npcs[0];
  world.locations[1].npcs[0] = { ...structuredClone(first), id: 'different' };
  assert.equal(WorldPackDraftSchema.safeParse(world).success, true);
  assert.deepEqual(validateDraftWorldGraph(world), []);
  const independent = structuredClone(world);
  independent.packId = 'independent-pack';
  assert.equal(WorldPackDraftSchema.safeParse(independent).success, true);
  assert.deepEqual(validateDraftWorldGraph(independent), []);
  world.locations[0].npcs = [];
  delete world.locations[1].npcs;
  assert.equal(WorldPackDraftSchema.safeParse(world).success, true);
  assert.deepEqual(validateDraftWorldGraph(world), []);
});

test('NPC identity retains encounter collision and invalid movement checks', () => {
  const world = identityWorld();
  world.roads = [{ id: 'road', name: 'Road', locationIds: ['a', 'b'], encounterChancePercent: 10,
    encounters: [{ id: 'resident-a', name: 'Encounter', combatProfile }] }];
  world.locations[0].exits[0].roadId = 'road';
  world.locations[0].npcs[0].movement = {
    strategy: 'wander', intervalMs: 60_000, allowedLocationIds: ['a', 'missing'],
  };
  const result = WorldPackDraftSchema.safeParse(world);
  assert.equal(result.success, false);
  const messages = result.error.issues.map(({ message }) => message);
  assert.ok(messages.includes('Road encounter ID resident-a conflicts with an authored NPC ID.'));
  assert.ok(messages.includes('The movement plan for resident-a references a location not present in the world.'));
});
