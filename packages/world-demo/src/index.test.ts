import { describe, expect, it } from 'vitest';
import { validateDraftWorldGraph } from '@mudd/contracts';
import { demoWorld, getLocation, STARTING_LOCATION_ID } from './index.js';

describe('demo world pack', () => {
  it('is a valid connected world with a resolvable starting location', () => {
    expect(validateDraftWorldGraph(demoWorld)).toEqual([]);
    expect(getLocation(STARTING_LOCATION_ID)?.id).toBe(STARTING_LOCATION_ID);
  });

  it('returns undefined when a location ID is not in the pack', () => {
    expect(getLocation('missing-location')).toBeUndefined();
  });
});
