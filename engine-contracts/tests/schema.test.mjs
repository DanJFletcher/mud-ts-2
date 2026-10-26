import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MoveCharacterCommandSchema, CharacterMovedEventSchema, CommandReceiptSchema,
  RoadStepCommandSchema,
  PluginManifestSchema, LocationDescribeQuerySchema, ObjectReadQuerySchema, ObjectInspectQuerySchema, TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema, InventoryItemProjectionSchema, WorldPackDraftSchema,
  QuestDefinitionSchema, validateDraftWorldGraph, MapPositionSchema, WorldMapProjectionSchema,
} from '../dist/src/index.js';

test('map terrain is open-ended and developer colors are validated', () => {
  assert.equal(MapPositionSchema.safeParse({
    x: 4, y: 2, terrain: 'wheat-field', mapColor: '#C89B45',
  }).success, true);
  assert.equal(MapPositionSchema.safeParse({
    x: 4, y: 2, terrain: 'wheat field',
  }).success, false);
  assert.equal(MapPositionSchema.safeParse({
    x: 4, y: 2, terrain: 'wheat-field', mapColor: 'gold',
  }).success, false);
  assert.equal(MapPositionSchema.safeParse({
    x: 4, y: 2, terrain: 'river', mapColor: '#C89B45',
  }).success, false);

  assert.equal(WorldMapProjectionSchema.safeParse({
    worldInstanceId: 'world',
    packId: 'pack',
    packVersion: '1.0.0',
    currentLocationId: 'field',
    locations: [{
      id: 'field',
      name: 'Wheat Field',
      shortName: 'Wheat Field',
      qualifiedName: 'Wheat Field',
      locationGroupIds: [],
      x: 4,
      y: 2,
      terrain: 'wheat-field',
      mapColor: '#C89B45',
    }],
    locationGroups: [],
    connections: [],
    exitStubs: [{ locationId: 'field', direction: 'north', oneWay: false }],
  }).success, true);

  assert.equal(WorldMapProjectionSchema.safeParse({
    worldInstanceId: 'world',
    packId: 'pack',
    packVersion: '1.0.0',
    currentLocationId: 'field',
    locations: [{
      id: 'field',
      name: 'Wheat Field',
      shortName: 'Wheat Field',
      qualifiedName: 'Wheat Field',
      locationGroupIds: [],
      x: 4,
      y: 2,
    }],
    locationGroups: [],
    connections: [],
    exitStubs: [{ locationId: 'field', direction: 'north', oneWay: false, toLocationId: 'hidden-room' }],
  }).success, false);
});

test('quest currency rewards are positive and limited to character-scoped quests', () => {
  const quest = {
    id: 'waterline',
    version: '1.0.0',
    title: 'The Waterline Mark',
    summary: 'Read the gauge and report back.',
    giverNpcId: 'talla',
    turnInNpcId: 'talla',
    reward: { currencyId: 'moss-mark', amount: 5 },
    objectives: [{ id: 'read-gauge', label: 'Read the gauge', type: 'visit-location', locationId: 'bridge' }],
  };

  assert.equal(QuestDefinitionSchema.safeParse(quest).success, true);
  assert.equal(QuestDefinitionSchema.safeParse({ ...quest, reward: { currencyId: 'moss-mark', amount: 0 } }).success, false);
  assert.equal(QuestDefinitionSchema.safeParse({ ...quest, scope: 'party' }).success, false);
});

const move = { type: 'character.move', version: 1, commandId: 'cmd1', worldInstanceId: 'world1', characterId: 'char1', expectedVersion: 2, payload: { exitId: 'north' } };

test('movement command accepts validated player intent, not supplied actorId', () => {
  assert.equal(MoveCharacterCommandSchema.safeParse(move).success, true);
  assert.equal(MoveCharacterCommandSchema.safeParse({ ...move, actorId: 'admin' }).success, false);
  assert.equal(MoveCharacterCommandSchema.safeParse({ ...move, payload: { exitId: '' } }).success, false);
});

test('movement event requires committed metadata', () => {
  assert.equal(CharacterMovedEventSchema.safeParse({
    type: 'character.moved', version: 1, eventId: 'e1', worldInstanceId: 'world1', aggregateId: 'char1',
    aggregateVersion: 3, causationCommandId: 'cmd1', actorId: 'player1', occurredAt: '2026-10-17T15:00:00Z', tick: 4,
    payload: { characterId: 'char1', fromLocationId: 'r1', toLocationId: 'r2', exitId: 'north' },
  }).success, true);
});

test('road travel uses a validated one-exit command', () => {
  assert.equal(RoadStepCommandSchema.safeParse({
    type: 'character.road.step',
    version: 1,
    commandId: 'road-step',
    worldInstanceId: 'world1',
    characterId: 'char1',
    expectedVersion: 3,
    payload: { exitId: 'road-to-segment' },
  }).success, true);
  assert.equal(RoadStepCommandSchema.safeParse({
    type: 'character.road.step',
    version: 1,
    commandId: 'road-step',
    worldInstanceId: 'world1',
    characterId: 'char1',
    expectedVersion: 3,
    payload: { exitId: 'road-to-segment', encounterRoll: 1 },
  }).success, false);
});

test('world roads require adjacent authored locations and valid road-tagged exits', () => {
  const roadPack = {
    formatVersion: 1,
    packId: 'road-pack',
    packVersion: '1.0.0',
    displayName: 'Road Pack',
    locations: [
      { id: 'start', name: 'Start', description: 'Start.', exits: [{ id: 'start-to-road', fromLocationId: 'start', toLocationId: 'segment', label: 'Road', roadId: 'long-road' }] },
      { id: 'segment', name: 'Segment', description: 'Road.', exits: [{ id: 'segment-to-end', fromLocationId: 'segment', toLocationId: 'end', label: 'Onward', roadId: 'long-road' }] },
      { id: 'end', name: 'End', description: 'End.', exits: [] },
    ],
    roads: [{
      id: 'long-road',
      name: 'Long Road',
      locationIds: ['start', 'segment', 'end'],
      encounterChancePercent: 25,
      encounters: [{ id: 'road-enemy', name: 'Road Enemy', combatProfile: { maxHealth: 4, attackDamage: 1 } }],
    }],
  };
  assert.equal(WorldPackDraftSchema.safeParse(roadPack).success, true);
  assert.equal(WorldPackDraftSchema.safeParse({
    ...roadPack,
    roads: [{ ...roadPack.roads[0], locationIds: ['start', 'end', 'segment'] }],
  }).success, false);
});

test('receipt is a success/error discriminated union', () => {
  assert.equal(CommandReceiptSchema.safeParse({ ok: true, commandId: 'cmd1', eventIds: ['e1'], newAggregateVersion: 3 }).success, true);
  assert.equal(CommandReceiptSchema.safeParse({ ok: false, commandId: 'cmd1', code: 'VERSION_CONFLICT', message: 'stale', retryable: true }).success, true);
  assert.equal(CommandReceiptSchema.safeParse({ ok: false, commandId: 'cmd1', code: 'BANANA', message: 'invalid', retryable: false }).success, false);
});

test('plugin manifest has coherent versioned shape', () => {
  assert.equal(PluginManifestSchema.safeParse({ id: 'org.mudd.movement', version: '0.1.0', apiVersion: '1', category: 'core' }).success, true);
  assert.equal(PluginManifestSchema.safeParse({ id: 'movement', version: '0.1.0', apiVersion: '1', category: 'core' }).success, false);
});

test('look is a read-only query with no client actor field', () => {
  assert.equal(LocationDescribeQuerySchema.safeParse({ type: 'location.describe', version: 1, queryId: 'q1', worldInstanceId: 'world1', characterId: 'char1', payload: {} }).success, true);
});

test('reading a world object is a validated read-only query', () => {
  assert.equal(ObjectReadQuerySchema.safeParse({
    type: 'object.read', version: 1, queryId: 'q2', worldInstanceId: 'world1',
    characterId: 'char1', payload: { objectId: 'marker' },
  }).success, true);
  assert.equal(ObjectReadQuerySchema.safeParse({
    type: 'object.read', version: 1, queryId: 'q2', worldInstanceId: 'world1',
    characterId: 'char1', payload: { objectId: '' },
  }).success, false);
});

test('inspecting an object is a validated read-only query', () => {
  assert.equal(ObjectInspectQuerySchema.safeParse({
    type: 'object.inspect', version: 1, queryId: 'q3', worldInstanceId: 'world1',
    characterId: 'char1', payload: { objectId: 'pebble' },
  }).success, true);
  assert.equal(ObjectInspectQuerySchema.safeParse({
    type: 'object.inspect', version: 1, queryId: 'q3', worldInstanceId: 'world1',
    characterId: 'char1', payload: { objectId: '' },
  }).success, false);
});

test('taking a room item is a versioned character command', () => {
  assert.equal(TakeCharacterItemCommandSchema.safeParse({
    type: 'character.take', version: 1, commandId: 'take1', worldInstanceId: 'world1',
    characterId: 'char1', expectedVersion: 1, payload: { itemId: 'mossgate-stone' },
  }).success, true);
  assert.equal(TakeCharacterItemCommandSchema.safeParse({
    type: 'character.take', version: 1, commandId: 'take1', worldInstanceId: 'world1',
    characterId: 'char1', expectedVersion: 1, payload: {},
  }).success, false);
});

test('dropping a carried item is a versioned character command', () => {
  assert.equal(DropCharacterItemCommandSchema.safeParse({
    type: 'character.drop', version: 1, commandId: 'drop1', worldInstanceId: 'world1',
    characterId: 'char1', expectedVersion: 2, payload: { itemId: 'mossgate-stone' },
  }).success, true);
  assert.equal(DropCharacterItemCommandSchema.safeParse({
    type: 'character.drop', version: 1, commandId: 'drop1', worldInstanceId: 'world1',
    characterId: 'char1', expectedVersion: 2, payload: {},
  }).success, false);
});

test('inventory items accept quest and equipment metadata', () => {
  const item = { id: 'quest-stone', label: 'Quest stone', description: 'A marked stone.' };
  assert.equal(InventoryItemProjectionSchema.safeParse(item).success, true);
  assert.equal(InventoryItemProjectionSchema.safeParse({ ...item, questBound: true }).success, true);
  assert.equal(InventoryItemProjectionSchema.safeParse({ ...item, questBound: 'yes' }).success, false);
  assert.equal(InventoryItemProjectionSchema.safeParse({
    ...item,
    equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
  }).success, true);
  assert.equal(InventoryItemProjectionSchema.safeParse({
    ...item,
    equipment: { slot: 'weapon', attackBonus: 0, defenseBonus: 1 },
  }).success, false);
});

test('world takeables retain authored equipment metadata', () => {
  const world = WorldPackDraftSchema.parse({
    formatVersion: 1,
    packId: 'authored-equipment',
    packVersion: '1.0.0',
    displayName: 'Authored Equipment',
    locations: [{
      id: 'equipment-room',
      name: 'Equipment Room',
      description: 'A test room.',
      takeables: [
        {
          id: 'room-sword',
          label: 'Room sword',
          description: 'A test weapon.',
          equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
        },
        {
          id: 'room-armor',
          label: 'Room armor',
          description: 'A test armor piece.',
          equipment: { slot: 'armor', attackBonus: 0, defenseBonus: 1 },
        },
      ],
      exits: [],
    }],
  });
  assert.deepEqual(world.locations[0].takeables[0].equipment, {
    slot: 'weapon',
    attackBonus: 2,
    defenseBonus: 0,
  });
  assert.deepEqual(world.locations[0].takeables[1].equipment, {
    slot: 'armor',
    attackBonus: 0,
    defenseBonus: 1,
  });
  assert.equal(WorldPackDraftSchema.safeParse({
    ...world,
    locations: [{
      ...world.locations[0],
      takeables: [{
        id: 'invalid-equipment',
        label: 'Invalid equipment',
        description: 'Weapons cannot provide armor.',
        equipment: { slot: 'weapon', attackBonus: 0, defenseBonus: 1 },
      }],
    }],
  }).success, false);
});

test('containers accept ordinary items and reject nested containers', () => {
  const base = {
    formatVersion: 1,
    packId: 'container-test',
    packVersion: '1.0.0',
    displayName: 'Container Test',
    locations: [{
      id: 'room',
      name: 'Room',
      description: 'A test room.',
      containers: [{
        id: 'old-sack',
        kind: 'sack',
        label: 'Old sack',
        description: 'A worn canvas sack.',
        contents: [{
          id: 'brass-key',
          label: 'Brass key',
          description: 'A small brass key.',
          consumable: { effect: 'heal', amount: 2 },
        }],
      }],
      exits: [],
    }],
  };
  const parsed = WorldPackDraftSchema.parse(base);
  assert.equal(parsed.locations[0].containers[0].kind, 'sack');
  assert.deepEqual(parsed.locations[0].containers[0].contents[0].consumable, { effect: 'heal', amount: 2 });
  assert.equal(parsed.locations[0].containers[0].capacity, undefined);
  assert.deepEqual(validateDraftWorldGraph(parsed), []);
  const stackableContainer = WorldPackDraftSchema.parse({
    ...base,
    locations: [{
      ...base.locations[0],
      containers: [{
        ...base.locations[0].containers[0],
        capacity: 3,
        contents: [{
          id: 'herb-bundle',
          label: 'Herb bundle',
          description: 'Three bundles tied together.',
          stackable: true,
          quantity: 3,
        }],
      }],
    }],
  });
  assert.equal(stackableContainer.locations[0].containers[0].capacity, 3);
  assert.equal(stackableContainer.locations[0].containers[0].contents[0].quantity, 3);
  assert.equal(WorldPackDraftSchema.safeParse({
    ...base,
    locations: [{
      ...base.locations[0],
      containers: [{
        ...base.locations[0].containers[0],
        capacity: 2,
        contents: [{
          id: 'herb-bundle',
          label: 'Herb bundle',
          description: 'Three bundles tied together.',
          stackable: true,
          quantity: 3,
        }],
      }],
    }],
  }).success, false);
  assert.equal(WorldPackDraftSchema.safeParse({
    ...base,
    locations: [{
      ...base.locations[0],
      containers: [{
        ...base.locations[0].containers[0],
        containers: [{
          id: 'nested-chest',
          kind: 'chest',
          label: 'Nested chest',
          description: 'A chest inside a sack.',
          contents: [],
        }],
      }],
    }],
  }).success, false);
  assert.equal(WorldPackDraftSchema.safeParse({
    ...base,
    locations: [{
      ...base.locations[0],
      containers: [{
        ...base.locations[0].containers[0],
        kind: 'barrel',
      }],
    }],
  }).success, false);
  assert.equal(WorldPackDraftSchema.safeParse({
    ...base,
    locations: [{
      ...base.locations[0],
      containers: [{
        ...base.locations[0].containers[0],
        contents: [{
          ...base.locations[0].containers[0].contents[0],
          equipment: { slot: 'weapon', attackBonus: 1, defenseBonus: 0 },
        }],
      }],
    }],
  }).success, false);
});

test('combat loot accepts ordinary items and currency but rejects quest-bound loot', () => {
  const pack = {
    formatVersion: 1,
    packId: 'combat-loot-test',
    packVersion: '1.0.0',
    displayName: 'Combat Loot Test',
    currency: { id: 'gold', name: 'gold piece', symbol: 'G', startingBalance: 0 },
    locations: [{
      id: 'room',
      name: 'Room',
      description: 'A test room.',
      exits: [],
      npcs: [{
        id: 'rat',
        name: 'Giant Rat',
        description: 'A large rat.',
        greeting: 'The rat squeaks.',
        topics: [],
        unknownTopicResponse: 'The rat squeaks again.',
        combatProfile: { maxHealth: 2, attackDamage: 1 },
        loot: {
          items: [{ id: 'rat-whisker', label: 'Rat whisker', description: 'A stiff whisker.' }],
          currencyAmount: 2,
        },
      }],
    }],
  };
  const parsed = WorldPackDraftSchema.parse(pack);
  assert.equal(parsed.locations[0].npcs[0].loot.currencyAmount, 2);
  assert.deepEqual(validateDraftWorldGraph(parsed), []);
  assert.equal(WorldPackDraftSchema.safeParse({
    ...pack,
    locations: [{
      ...pack.locations[0],
      npcs: [{
        ...pack.locations[0].npcs[0],
        loot: {
          items: [{
            id: 'quest-map',
            label: 'Quest map',
            description: 'A quest map.',
            questBound: true,
          }],
        },
      }],
    }],
  }).success, false);
  assert.equal(validateDraftWorldGraph({
    ...parsed,
    currency: undefined,
  }).some((error) => error.includes('requires configured world currency')), true);
});

test('draft content checks graph references', () => {
  const pack = WorldPackDraftSchema.parse({ formatVersion: 1, packId: 'starter', packVersion: '0.1.0', displayName: 'Starter', locations: [
    { id: 'r1', name: 'Crossroads', description: 'Paths branch', readables: [{ id: 'marker', label: 'Marker', description: 'A painted wooden sign.', text: 'North to the forest' }], takeables: [{ id: 'pebble', label: 'Pebble', description: 'A smooth pebble.', questBound: true }], interactables: [{ id: 'bell', label: 'Bell', description: 'A small brass bell.' }], itemUses: [{ id: 'ring-bell', itemId: 'pebble', targetId: 'bell', requiredVisitedLocationId: 'r1', response: 'A chime rings.' }], exits: [{ id: 'north', fromLocationId: 'r1', toLocationId: 'r2', label: 'North' }] },
    { id: 'r2', name: 'Forest', description: 'Old trees', requiredVisitedLocationId: 'r1', exits: [] },
  ] });
  assert.deepEqual(validateDraftWorldGraph(pack), []);
  assert.equal(pack.locations[0].takeables[0].questBound, true);
  assert.equal(validateDraftWorldGraph({ ...pack, locations: pack.locations.slice(0, 1) }).length, 1);
  assert.equal(validateDraftWorldGraph({
    ...pack,
    locations: pack.locations.map((location) => location.id === 'r2'
      ? { ...location, requiredVisitedLocationId: 'missing-location' }
      : location),
  }).some((error) => error.includes('Location r2 requires missing visited location')), true);
  assert.equal(validateDraftWorldGraph({
    ...pack,
    locations: pack.locations.map((location) => location.id === 'r1'
      ? { ...location, itemUses: location.itemUses.map((interaction) => ({
          ...interaction,
          requiredVisitedLocationId: 'missing-location',
        })) }
      : location),
  }).some((error) => error.includes('Item-use interaction ring-bell requires missing visited location')), true);
});

const topicReplyWorld = WorldPackDraftSchema.parse({
  formatVersion: 1,
  packId: 'topic-replies',
  packVersion: '0.1.0',
  displayName: 'Topic Replies',
  locations: [{
    id: 'r1',
    name: 'Crossroads',
    description: 'Paths branch',
    exits: [],
    readables: [{ id: 'marker', label: 'Marker', description: 'A painted wooden sign.', text: 'North to the forest' }],
    npcs: [{
      id: 'guide',
      name: 'Guide',
      description: 'A helpful traveler.',
      greeting: 'Hello.',
      topics: [{
        id: 'directions',
        keywords: ['directions'],
        response: 'The forest is north.',
        questResponses: [{
          questId: 'forest-marker',
          status: 'active',
          requiresCompletedObjectiveIds: ['read-marker'],
          response: 'You read the marker.',
        }],
      }],
      unknownTopicResponse: 'I do not know.',
    }],
  }],
  quests: [{
    id: 'forest-marker',
    version: '1',
    title: 'Read the marker',
    summary: 'Find out what the marker says.',
    giverNpcId: 'guide',
    turnInNpcId: 'guide',
    objectives: [{
      id: 'read-marker',
      label: 'Read the marker',
      type: 'read-object',
      objectId: 'marker',
      locationId: 'r1',
    }],
  }],
});

function withTopicQuestResponse(response) {
  const [location] = topicReplyWorld.locations;
  const [npc] = location.npcs;
  const [topic] = npc.topics;

  return {
    ...topicReplyWorld,
    locations: [{
      ...location,
      npcs: [{
        ...npc,
        topics: [{ ...topic, questResponses: [response] }],
      }],
    }],
  };
}

test('topic quest replies validate references to existing quests and objectives', () => {
  assert.deepEqual(validateDraftWorldGraph(topicReplyWorld), []);
});

test('topic quest replies reject unknown quest IDs', () => {
  const errors = validateDraftWorldGraph(withTopicQuestResponse({
    ...topicReplyWorld.locations[0].npcs[0].topics[0].questResponses[0],
    questId: 'missing-quest',
  }));

  assert.ok(errors.includes('NPC guide dialogue response references missing quest missing-quest'));
});

test('topic quest replies reject unknown objective IDs', () => {
  const errors = validateDraftWorldGraph(withTopicQuestResponse({
    ...topicReplyWorld.locations[0].npcs[0].topics[0].questResponses[0],
    requiresCompletedObjectiveIds: ['missing-objective'],
  }));

  assert.ok(errors.includes(
    'NPC guide dialogue response references missing objective missing-objective in quest forest-marker',
  ));
});
