import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyBoardDefinitionSchema, DailyJobCommandSchema, GatherSupplyCommandSchema,
  InventoryItemProjectionSchema, WorldPackDraftSchema, dailyPostings,
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
