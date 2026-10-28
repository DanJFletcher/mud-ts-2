import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MerchantCatalogDefinitionSchema,
} from '../dist/src/index.js';

const listing = (overrides = {}) => ({
  id: 'healing-herb',
  item: {
    id: 'healing-herb',
    typeId: 'herb',
    label: 'Healing herb',
    description: 'A restorative leaf.',
  },
  price: 3,
  ...overrides,
});

test('merchant catalogs default listings to non-repeatable and reject duplicate listing IDs', () => {
  const parsed = MerchantCatalogDefinitionSchema.parse({
    listings: [listing()],
  });
  assert.equal(parsed.listings[0].repeatable, false);
  assert.equal(MerchantCatalogDefinitionSchema.safeParse({
    listings: [listing(), listing({ price: 5 })],
  }).success, false);
  assert.equal(MerchantCatalogDefinitionSchema.safeParse({
    listings: [listing(), listing({ id: 'dried-fish' })],
  }).success, true);
});
