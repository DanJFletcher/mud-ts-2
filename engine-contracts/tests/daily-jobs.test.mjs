import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyBoardDefinitionSchema, DailyJobCommandSchema, GatherSupplyCommandSchema,
  InventoryItemProjectionSchema, WorldPackDraftSchema, dailyPostings,
  NpcDailyJobConditionSchema, NpcDailyJobResponseDefinitionSchema, validateDraftWorldGraph,
} from '../dist/src/index.js';

test('old worlds default to no boards or sources and inventory type IDs are optional', () => {
  const world = WorldPackDraftSchema.parse({
    formatVersion: 1, packId: 'legacy', packVersion: '1.0.0', displayName: 'Legacy',
    locations: [{ id: 'room', name: 'Room', description: 'A room.', exits: [] }],
  });
  assert.deepEqual(world.dailyBoards, []);
  assert.deepEqual(world.supplySources, []);
  const item = { id: 'physical-fish-1', label: 'Fish', description: 'A fish.' };
  assert.equal(InventoryItemProjectionSchema.parse(item).typeId, undefined);
  assert.equal(InventoryItemProjectionSchema.parse({ ...item, typeId: 'river-fish' }).typeId, 'river-fish');
});

test('daily commands require revisions and never accept client identity or rewards', () => {
  const base = { version: 1, commandId: 'command', characterId: 'character', worldInstanceId: 'world' };
  const job = { ...base, type: 'daily.job', expectedVersion: 4,
    payload: { boardId: 'board', cycle: '2026-10-23', jobId: 'job', action: 'deliver' } };
  assert.equal(DailyJobCommandSchema.safeParse(job).success, true);
  assert.equal(DailyJobCommandSchema.safeParse({ ...job, expectedVersion: undefined }).success, false);
  assert.equal(DailyJobCommandSchema.safeParse({ ...job, actorId: 'another-player' }).success, false);
  assert.equal(DailyJobCommandSchema.safeParse({ ...job, payload: { ...job.payload, gold: 100 } }).success, false);
  assert.equal(GatherSupplyCommandSchema.safeParse({ ...base, type: 'supply.gather',
    payload: { sourceId: 'fish', cycle: '2026-10-23' } }).success, false);
});

test('daily variants rotate by UTC calendar day rather than by query or character', () => {
  const job = { poster: 'Cook', title: 'Fish', supplyTypeId: 'fish', quantity: 2, gold: 5, experience: 8 };
  const board = DailyBoardDefinitionSchema.parse({ id: 'board', locationId: 'room', name: 'Jobs',
    slots: [[{ ...job, id: 'a' }, { ...job, id: 'b' }]] });
  assert.deepEqual(dailyPostings(board, '2026-10-23'), dailyPostings(board, '2026-10-23'));
  assert.notDeepEqual(dailyPostings(board, '2026-10-23'), dailyPostings(board, '2026-10-24'));
});

test('daily dialogue conditions are typed and world validation checks board/job references', () => {
  const condition = { boardId: 'board', jobId: 'fish-a', status: 'active' };
  assert.equal(NpcDailyJobConditionSchema.safeParse(condition).success, true);
  assert.equal(NpcDailyJobConditionSchema.safeParse({ ...condition, status: 'available' }).success, false);
  assert.equal(NpcDailyJobConditionSchema.safeParse({ ...condition, cycle: 'yesterday' }).success, false);
  assert.equal(NpcDailyJobResponseDefinitionSchema.safeParse({ ...condition, response: '' }).success, false);
  const job = { poster: 'Cook', title: 'Fish', supplyTypeId: 'fish', quantity: 2, gold: 5, experience: 8 };
  const response = { ...condition, response: 'Thank you for taking my notice.' };
  const world = WorldPackDraftSchema.parse({
    formatVersion: 1, packId: 'dialogue', packVersion: '1.0.0', displayName: 'Dialogue',
    currency: { id: 'gold', name: 'Gold', symbol: 'g', startingBalance: 0 },
    dailyBoards: [{ id: 'board', locationId: 'room', name: 'Jobs',
      slots: [[{ ...job, id: 'fish-a' }, { ...job, id: 'fish-b' }]] }],
    locations: [{ id: 'room', name: 'Room', description: 'A room.', exits: [],
      npcs: [{ id: 'cook', name: 'Cook', description: 'A cook.', greeting: 'Hello.',
        dailyJobResponses: [response], unknownTopicResponse: 'What?',
        topics: [{ id: 'jobs', keywords: ['jobs'], response: 'Read the board.', dailyJobResponses: [response] }] }] }],
  });
  assert.deepEqual(validateDraftWorldGraph(world), []);
  world.locations[0].npcs[0].dailyJobResponses = [{ ...response, boardId: 'missing' }];
  world.locations[0].npcs[0].topics[0].dailyJobResponses = [{ ...response, jobId: 'missing' }];
  assert.match(validateDraftWorldGraph(world).join('\n'), /missing daily board missing/);
  assert.match(validateDraftWorldGraph(world).join('\n'), /missing daily job missing on board board/);
});
