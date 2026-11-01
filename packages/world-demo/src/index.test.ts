import { describe, expect, it } from 'vitest';
import { validateDraftWorldGraph } from '@mudd/contracts';
import { demoWorld, getLocation, STARTING_LOCATION_ID } from './index.js';

describe('demo world pack', () => {
  it('marks open river reaches and the submerged bridge context as requiring water travel', () => {
    for (const id of ['glasswater-west-reach', 'glasswater-east-reach', 'glasswater-willow-reach', 'glasswater-far-reach']) {
      expect(getLocation(id)?.requiresWaterTravel).toBe(true);
    }
    const bridge = getLocation('glasswater-bridge');
    expect(bridge?.requiresWaterTravel).toBeUndefined();
    expect(bridge?.states?.find(({ id }) => id === 'under')?.requiresWaterTravel).toBe(true);
    expect(bridge?.states?.find(({ id }) => id === 'on')?.requiresWaterTravel).toBeUndefined();
  });

  it('is a valid connected world with a resolvable starting location', () => {
    expect(validateDraftWorldGraph(demoWorld)).toEqual([]);
    expect(getLocation(STARTING_LOCATION_ID)?.id).toBe(STARTING_LOCATION_ID);
  });

  it('returns undefined when a location ID is not in the pack', () => {
    expect(getLocation('missing-location')).toBeUndefined();
  });
});
