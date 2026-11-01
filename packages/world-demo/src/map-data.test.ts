import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
} from '@mudd/contracts';
import { demoWorld } from './index.js';

describe('demo map data migration', () => {
  it('strictly equals the pre-migration pack, including every array order', () => {
    const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/pre-migration-pack.json', import.meta.url), 'utf8'));
    assert.deepEqual(demoWorld, fixture);
  });

  it('has no placeholder location descriptions', () => {
    expect(demoWorld.locations.filter((location) => location.description.startsWith('TODO: describe'))).toEqual([]);
  });

  it('contains exactly the three layout files', () => {
    const files = readdirSync(new URL('./map/', import.meta.url));
    expect(new Set(files)).toEqual(new Set(['locations.json', 'location-groups.json', 'roads.json']));
  });

  for (const [file, schema] of [
    ['locations.json', WorldLocationsFileSchema],
    ['location-groups.json', WorldLocationGroupsFileSchema],
    ['roads.json', WorldRoadsFileSchema],
  ] as const) {
    it(`validates ${file} with its layout schema`, () => {
      const data = JSON.parse(readFileSync(new URL(`./map/${file}`, import.meta.url), 'utf8'));
      expect(schema.parse(data)).toStrictEqual(data);
    });
  }
});
