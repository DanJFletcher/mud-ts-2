import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MoveCharacterCommandSchema, CharacterMovedEventSchema, CommandReceiptSchema,
  RoadStepCommandSchema,
  PluginManifestSchema, LocationDescribeQuerySchema, ObjectReadQuerySchema, ObjectInspectQuerySchema, TakeCharacterItemCommandSchema,
  DropCharacterItemCommandSchema, InventoryItemProjectionSchema, WorldPackDraftSchema,
  validateDraftWorldGraph,
} from '../dist/src/index.js';

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

test('inventory items accept an optional quest-bound marker', () => {
  const item = { id: 'quest-stone', label: 'Quest stone', description: 'A marked stone.' };
  assert.equal(InventoryItemProjectionSchema.safeParse(item).success, true);
  assert.equal(InventoryItemProjectionSchema.safeParse({ ...item, questBound: true }).success, true);
  assert.equal(InventoryItemProjectionSchema.safeParse({ ...item, questBound: 'yes' }).success, false);
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
