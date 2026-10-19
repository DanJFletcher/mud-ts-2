import test from 'node:test';
import assert from 'node:assert/strict';
import { LocationDefinitionSchema, MapPositionSchema } from '../dist/src/index.js';

const location = { id: 'room', name: 'Room', description: 'A room.', exits: [] };

test('legacy two-dimensional locations remain valid', () => {
  assert.equal(LocationDefinitionSchema.safeParse({ ...location, mapPosition: { x: 0, y: 0 } }).success, true);
  assert.equal(LocationDefinitionSchema.safeParse(location).success, true);
});

test('locations accept explicit map areas and integer levels above and below the surface', () => {
  for (const z of [-2, -1, 0, 1, 2]) {
    assert.equal(LocationDefinitionSchema.safeParse({
      ...location, mapAreaId: 'tower-dungeon', mapPosition: { x: 0, y: 0, z },
    }).success, true);
  }
});

test('map scope rejects empty area IDs and invalid levels', () => {
  assert.equal(LocationDefinitionSchema.safeParse({ ...location, mapAreaId: '' }).success, false);
  for (const z of [0.5, Infinity, -10001, 10001, 'underground']) {
    assert.equal(MapPositionSchema.safeParse({ x: 0, y: 0, z }).success, false);
  }
});
