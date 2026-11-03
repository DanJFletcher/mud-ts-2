import { describe, expect, it, vi } from 'vitest';
import { enterWorld } from './world-entry.js';

describe('world entry transaction', () => {
  it('fails explicitly when the new session insert returns no row', async () => {
    const selectRows: unknown[][] = [[{ id: 'character-1' }], []];
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => {
        const query: Record<string, unknown> = {};
        query.from = vi.fn(() => query);
        query.where = vi.fn(() => query);
        query.limit = vi.fn(async () => selectRows.shift() ?? []);
        return query;
      }),
      insert: vi.fn(() => ({
        values: () => ({ returning: async () => [] }),
      })),
    };
    const database = {
      transaction: vi.fn((run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
    };

    await expect(enterWorld(database as never, {
      playerId: 'player-1',
      characterId: 'character-1',
      worldInstanceId: 'world-1',
      locationId: 'start',
    })).rejects.toThrow('Could not start the world session.');

    expect(database.transaction).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledOnce();
  });
});
