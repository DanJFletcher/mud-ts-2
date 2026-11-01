import test from 'node:test';
import assert from 'node:assert/strict';
import { LocationDefinitionSchema, LocationStateDefinitionSchema, WorldLocationsFileSchema } from '../dist/src/index.js';

test('water access is optional mechanical content on locations and states', () => {
  const location = { id: 'channel', name: 'Channel', description: 'Water.', exits: [] };
  assert.equal(Object.hasOwn(LocationDefinitionSchema.parse(location), 'requiresWaterTravel'), false);
  for (const requiresWaterTravel of [true, false]) {
    assert.equal(LocationDefinitionSchema.parse({ ...location, requiresWaterTravel }).requiresWaterTravel, requiresWaterTravel);
    assert.equal(LocationStateDefinitionSchema.parse({ id: 'context', requiresWaterTravel }).requiresWaterTravel, requiresWaterTravel);
  }
  for (const requiresWaterTravel of ['true', 1, null]) {
    assert.equal(LocationDefinitionSchema.safeParse({ ...location, requiresWaterTravel }).success, false);
    assert.equal(LocationStateDefinitionSchema.safeParse({ id: 'context', requiresWaterTravel }).success, false);
  }
  assert.equal(WorldLocationsFileSchema.safeParse({ formatVersion: 1, packId: 'water-test',
    locations: [{ ...location, requiresWaterTravel: true }] }).success, false);
});
