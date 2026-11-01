import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
} from '@mudd/contracts';
import { orravethWorld } from './index.js';

describe('Orraveth map data', () => {
  it('has no placeholder location descriptions', () => {
    expect(orravethWorld.locations.filter((location) => location.description.startsWith('TODO: describe'))).toEqual([]);
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
