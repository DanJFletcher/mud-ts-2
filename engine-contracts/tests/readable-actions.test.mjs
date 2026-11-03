import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadActionSchema, ReadableObjectDefinitionSchema, WorldPackDraftSchema,
  composeWorldPackDraft, validateDraftWorldGraph } from '../dist/src/index.js';

const readable = { id: 'notice', label: 'Notice', description: 'A notice.', text: 'Static fallback.' };
const action = { type: 'daily-board', boardId: 'jobs' };
const job = { poster: 'Cook', title: 'Fish', supplyTypeId: 'fish', quantity: 2, gold: 5, experience: 8 };
const board = { id: 'jobs', name: 'Jobs', locationId: 'room', slots: [[{ ...job, id: 'a' }, { ...job, id: 'b' }]] };
const pack = (boards = [board]) => WorldPackDraftSchema.parse({
  formatVersion: 1, packId: 'read-test', packVersion: '1.0.0', displayName: 'Read test',
  locations: [{ id: 'room', name: 'Room', description: 'A room.', exits: [],
    readables: [{ ...readable, readAction: action }] },
  { id: 'elsewhere', name: 'Elsewhere', description: 'Elsewhere.', exits: [] }], dailyBoards: boards,
});

test('read action is optional and bounded; text remains required', () => {
  assert.deepEqual(ReadableObjectDefinitionSchema.parse(readable), readable);
  assert.deepEqual(ReadActionSchema.parse(action), action);
  for (const invalid of [{ type: 'execute', boardId: 'jobs' }, { type: 'daily-board' },
    { ...action, boardId: '' }, { ...action, query: 'anything' }]) {
    assert.equal(ReadActionSchema.safeParse(invalid).success, false);
  }
  assert.equal(ReadableObjectDefinitionSchema.safeParse({ ...readable, text: undefined, readAction: action }).success, false);
});

test('world graph validates exact local read targets and reports missing, duplicate and remote boards', () => {
  assert.deepEqual(validateDraftWorldGraph(pack()), []);
  for (const [boards, error] of [[[], /notice.*missing.*jobs/], [[board, board], /notice.*duplicate.*jobs/],
    [[{ ...board, locationId: 'elsewhere' }], /notice.*jobs.*another location/]]) {
    assert.ok(validateDraftWorldGraph(pack(boards)).some((message) => error.test(message)));
  }
});

test('map/content composition and parsing preserve the authored association', () => {
  const parsed = pack();
  const { readables, ...layout } = parsed.locations[0];
  const composed = composeWorldPackDraft({
    locations: { formatVersion: 1, packId: parsed.packId, locations: [layout] },
    locationGroups: { formatVersion: 1, packId: parsed.packId, locationGroups: [] },
    roads: { formatVersion: 1, packId: parsed.packId, roads: [] },
  }, { formatVersion: 1, packId: parsed.packId, packVersion: '1.0.0', displayName: 'Test',
    dailyBoards: [board], locationContent: { room: { readables } }, roadRules: {} });
  const result = WorldPackDraftSchema.parse(composed);
  assert.deepEqual(result.locations[0].readables[0].readAction, action);
  assert.deepEqual(validateDraftWorldGraph(result), []);
});
