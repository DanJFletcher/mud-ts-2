import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorldCorpseRecordSchema,
  WorldCurrencyDropRecordSchema,
  WorldItemRecordSchema,
  TakeableObjectDefinitionSchema,
} from '../dist/src/index.js';

const item = (overrides = {}) => ({
  id: 'world-item-1',
  sharedItemId: 'world-item-1',
  typeId: 'healing-herb',
  label: 'Healing herb',
  description: 'A fragrant green leaf.',
  ...overrides,
});

const takeable = (overrides = {}) => ({
  id: 'room-item-1',
  label: 'Leather gloves',
  description: 'A pair of soft leather gloves.',
  ...overrides,
});

const worldItem = (overrides = {}) => ({
  worldItemId: 'world-item-1',
  item: item(),
  locationId: 'market-square',
  holderCharacterId: null,
  ...overrides,
});

const corpse = (overrides = {}) => ({
  corpseId: 'corpse-1',
  encounterId: 'encounter-1',
  opponentId: 'bandit-1',
  opponentName: 'Bandit',
  label: 'Bandit corpse',
  description: 'A fallen bandit lies still.',
  locationId: 'south-road',
  currencyAmount: 0,
  goldClaimed: false,
  ...overrides,
});

test('a shared world item has one owner and keeps its stable item ID', () => {
  assert.equal(WorldItemRecordSchema.safeParse(worldItem()).success, true);
  assert.equal(WorldItemRecordSchema.safeParse(worldItem({
    locationId: null,
    holderCharacterId: 'character-1',
  })).success, true);
  assert.equal(WorldItemRecordSchema.safeParse(worldItem({
    worldItemId: 'different-world-id',
  })).success, false);
  assert.equal(WorldItemRecordSchema.safeParse(worldItem({
    locationId: null,
  })).success, false);
  assert.equal(WorldItemRecordSchema.safeParse(worldItem({
    holderCharacterId: 'character-1',
  })).success, false);
});

test('room takeables enforce stack, charge, and item-role constraints', () => {
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable()).success, true);
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable({
    stackable: true,
    quantity: 3,
  })).success, true);
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable({
    quantity: 3,
  })).success, false);
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable({
    stackable: true,
  })).success, false);
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable({
    stackable: true,
    quantity: 3,
    usesRemaining: 2,
  })).success, false);
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable({
    consumable: { effect: 'heal', amount: 2 },
    equipment: { slot: 'gloves' },
  })).success, false);
  assert.equal(TakeableObjectDefinitionSchema.safeParse(takeable({
    woodcuttingAxe: { requiredLevel: 1, power: 1 },
    equipment: { slot: 'weapon', attackBonus: 1 },
  })).success, false);
});

test('corpse currency, lifetime, and recovery-storage fields remain consistent', () => {
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse()).success, true);
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse({
    currencyAmount: 12,
    currencyId: 'gold',
    goldItemId: 'corpse-gold-1',
    goldClaimed: false,
  })).success, true);
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse({
    currencyAmount: 12,
  })).success, false);
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse({
    createdAt: '2026-10-27T12:00:00Z',
    expiresAt: '2026-10-27T12:00:00Z',
  })).success, false);
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse({
    createdAt: '2026-10-27T12:00:00Z',
    expiresAt: '2026-10-27T12:01:00Z',
    expirationPolicy: 'destroy',
  })).success, true);
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse({
    expirationPolicy: 'recovery-storage',
  })).success, false);
  assert.equal(WorldCorpseRecordSchema.safeParse(corpse({
    ownerCharacterId: 'character-1',
    expirationPolicy: 'recovery-storage',
  })).success, true);
});

test('currency drop records require a positive amount and explicit world ownership', () => {
  const drop = {
    dropId: 'gold-drop-1',
    corpseId: 'corpse-1',
    locationId: 'south-road',
    currencyId: 'gold',
    amount: 5,
  };
  assert.equal(WorldCurrencyDropRecordSchema.safeParse(drop).success, true);
  assert.equal(WorldCurrencyDropRecordSchema.safeParse({ ...drop, amount: 0 }).success, false);
});
