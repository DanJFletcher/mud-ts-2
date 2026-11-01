import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldPackDraftSchema, movementStaminaCostForWorld } from '../dist/src/index.js';

const pack = { formatVersion: 1, packId: 'cost-test', packVersion: '1.0.0', displayName: 'Cost test',
  locations: [{ id: 'start', name: 'Start', description: 'A room.', exits: [] }] };

test('world movement costs default to five and can explicitly select two', () => {
  assert.equal(movementStaminaCostForWorld(WorldPackDraftSchema.parse(pack)), 5);
  assert.equal(movementStaminaCostForWorld(WorldPackDraftSchema.parse({ ...pack, movementStaminaCost: 2 })), 2);
  for (const movementStaminaCost of [0, -1, 1.5, 101, '2', null]) {
    assert.equal(WorldPackDraftSchema.safeParse({ ...pack, movementStaminaCost }).success, false);
  }
});
