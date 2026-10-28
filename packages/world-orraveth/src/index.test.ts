import { describe, expect, it, vi } from 'vitest';
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

  it('rejects an authored pack with an invalid world graph', async () => {
    vi.resetModules();
    vi.doMock('@mudd/contracts', async (importOriginal) => ({
      ...await importOriginal<typeof import('@mudd/contracts')>(),
      validateDraftWorldGraph: () => ['missing road connection'],
    }));
    try {
      await expect(import('./index.js')).rejects.toThrow(
        'Invalid Orraveth world graph:\n- missing road connection',
      );
    } finally {
      vi.doUnmock('@mudd/contracts');
      vi.resetModules();
    }
  });
});
