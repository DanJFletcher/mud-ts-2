import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FishingAdvanceCommandSchema,
  FishingCancelCommandSchema,
  FishingCastAdvancedEventSchema,
  FishingCastCommandSchema,
  FishingCastStartedEventSchema,
  FishingCastStateSchema,
  FishingRodDefinitionSchema,
  FishingSizeBandDefinitionSchema,
  FishingSpeciesDefinitionSchema,
  FishingSpotDefinitionSchema,
} from '../dist/src/index.js';

const band = (rarity = 'common', weightPercent = 100, overrides = {}) => ({
  rarity,
  weightPercent,
  minLengthCm: 20,
  maxLengthCm: 35,
  minWeightGrams: 200,
  maxWeightGrams: 800,
  ...overrides,
});

const species = (overrides = {}) => ({
  id: 'river-bass',
  name: 'River bass',
  itemTypeId: 'fish-bass',
  weightPercent: 50,
  sizeBands: [band()],
  ...overrides,
});

const cast = (overrides = {}) => ({
  castId: 'cast-1',
  spotId: 'south-bridge-water',
  locationId: 'south-bridge',
  rodItemId: 'old-rod',
  rodQualityId: 'worn',
  startedAt: '2026-10-27T12:00:00.000Z',
  tickIntervalSeconds: 1,
  ticksRequired: 10,
  ticksCompleted: 0,
  ...overrides,
});

const eventBase = {
  eventId: 'event-1',
  worldInstanceId: 'world-1',
  aggregateId: 'character-1',
  aggregateVersion: 1,
  causationCommandId: 'command-1',
  actorId: 'player-1',
  occurredAt: '2026-10-27T12:00:00.000Z',
  tick: 1,
};

const progressEvent = (status, tickRolls, item) => ({
  ...eventBase,
  type: 'character.fishing_cast_advanced',
  version: 1,
  payload: {
    characterId: 'character-1',
    castId: 'cast-1',
    ticksCompleted: tickRolls.length,
    status,
    tickRolls,
    ...(item ? { item } : {}),
  },
});

const fishItem = {
  id: 'fish-catch-1',
  typeId: 'fish-bass',
  label: 'River bass',
  description: 'A freshly caught bass.',
  fishCatch: {
    speciesId: 'river-bass',
    rarity: 'common',
    lengthCm: 25,
    weightGrams: 400,
  },
};

test('validates rod settings, size ranges, and distinct fish rarity bands', () => {
  assert.deepEqual(FishingRodDefinitionSchema.parse({ qualityId: 'worn' }), {
    qualityId: 'worn',
    biteChancePercent: 10,
    waitSeconds: 10,
  });
  assert.equal(FishingRodDefinitionSchema.safeParse({
    qualityId: 'worn',
    speciesWeightOverrides: { 'river-bass': 1001 },
  }).success, false);

  assert.equal(FishingSizeBandDefinitionSchema.safeParse(band()).success, true);
  assert.equal(FishingSizeBandDefinitionSchema.safeParse(band('common', 100, {
    minLengthCm: 40,
    maxLengthCm: 30,
    minWeightGrams: 900,
    maxWeightGrams: 800,
  })).success, false);
  assert.equal(FishingSpeciesDefinitionSchema.safeParse(species()).success, true);
  assert.equal(FishingSpeciesDefinitionSchema.safeParse(species({
    sizeBands: [band('common', 99)],
  })).success, false);
  assert.equal(FishingSpeciesDefinitionSchema.safeParse(species({
    sizeBands: [band('common', 50), band('common', 50)],
  })).success, false);
});

test('requires unique species per fishing spot and bounded cast progress', () => {
  assert.equal(FishingSpotDefinitionSchema.safeParse({
    id: 'south-bridge-water',
    locationId: 'south-bridge',
    label: 'A quiet bend below the bridge',
    species: [species()],
  }).success, true);
  assert.equal(FishingSpotDefinitionSchema.safeParse({
    id: 'south-bridge-water',
    locationId: 'south-bridge',
    label: 'A quiet bend below the bridge',
    species: [species(), species({ itemTypeId: 'fish-carp' })],
  }).success, false);

  assert.equal(FishingCastStateSchema.safeParse(cast({ ticksCompleted: 10 })).success, true);
  assert.equal(FishingCastStateSchema.safeParse(cast({ ticksCompleted: 11 })).success, false);
  const started = {
    ...eventBase,
    type: 'character.fishing_cast_started',
    version: 1,
    payload: { characterId: 'character-1', cast: cast() },
  };
  assert.equal(FishingCastStartedEventSchema.safeParse(started).success, true);
});

test('requires progress rolls and a final successful roll for fishing catches', () => {
  const miss = { tick: 1, roll: 75, caught: false };
  const catchRoll = { tick: 1, roll: 4, caught: true };
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('waiting', [miss])).success, true);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('caught', [catchRoll], fishItem)).success, true);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('interrupted', [])).success, true);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('caught', [catchRoll])).success, false);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('interrupted', [miss])).success, false);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('waiting', [])).success, false);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('caught', [miss], fishItem)).success, false);
  assert.equal(FishingCastAdvancedEventSchema.safeParse(progressEvent('waiting', [catchRoll])).success, false);
});

test('validates the versioned fishing command forms', () => {
  const commandBase = {
    version: 1,
    commandId: 'command-1',
    worldInstanceId: 'world-1',
    characterId: 'character-1',
    expectedVersion: 2,
  };
  assert.equal(FishingCastCommandSchema.safeParse({
    ...commandBase,
    type: 'fishing.cast',
    payload: { rodItemId: 'old-rod' },
  }).success, true);
  assert.equal(FishingAdvanceCommandSchema.safeParse({
    ...commandBase,
    type: 'fishing.advance',
    payload: { castId: 'cast-1' },
  }).success, true);
  assert.equal(FishingCancelCommandSchema.safeParse({
    ...commandBase,
    type: 'fishing.cancel',
    payload: { castId: 'cast-1' },
  }).success, true);
});
