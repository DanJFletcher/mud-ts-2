import { describe, expect, it } from 'vitest';
import { validateDraftWorldGraph } from '@mudd/contracts';
import { orravethWorld, ORRAVETH_WORLD_INSTANCE_ID } from './index.js';

describe('Orraveth world pack', () => {
  it('has a valid world graph and stable world identity', () => {
    expect(validateDraftWorldGraph(orravethWorld)).toEqual([]);
    expect(ORRAVETH_WORLD_INSTANCE_ID).toBe('orraveth-bellwold-instance');
  });

  it('keeps the authored Bellwold gathering and woodcutting content connected', () => {
    expect(orravethWorld.locations.some((location) => location.id === 'bellwold-market-square')).toBe(true);
    expect(orravethWorld.dailyBoards.some((board) => board.locationId === 'bellwold-south-common')).toBe(true);
    expect(orravethWorld.woodcuttingTrees?.some((tree) => tree.locationId === 'bellwold-southbound-track')).toBe(true);
  });
});
