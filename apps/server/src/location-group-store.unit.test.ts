import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationGroupDefinition } from '@mudd/contracts';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('./db/client.js', () => ({ db: mockDb }));

import { PostgresLocationGroupCatalogStore } from './location-group-store.js';

function queryResult(rows: unknown[]) {
  const query: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'groupBy']) {
    query[method] = () => query;
  }
  query.limit = async () => rows;
  query.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return query;
}

function setTransaction(tx: Record<string, unknown>) {
  mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
}

const initialGroups: LocationGroupDefinition[] = [{
  id: 'south-common',
  name: 'South Common',
  type: 'district',
  description: 'The southern commons.',
  memberships: [{ locationId: 'market-square', isPrimary: true }],
  metadata: { mapColor: 'green' },
}];

describe('PostgresLocationGroupCatalogStore unit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a catalog and its groups only on the first initialization', async () => {
    const insertedValues: unknown[] = [];
    let insertCall = 0;
    const tx = {
      insert: vi.fn(() => {
        insertCall += 1;
        return {
          values: (values: unknown) => {
            insertedValues.push(values);
            return insertCall === 1
              ? { onConflictDoNothing: () => ({ returning: async () => [{ packId: 'orraveth' }] }) }
              : Promise.resolve();
          },
        };
      }),
    };
    setTransaction(tx);
    const store = new PostgresLocationGroupCatalogStore();

    await store.initialize('orraveth', '1.0.0', initialGroups);
    expect(insertedValues).toHaveLength(3);
    expect(insertedValues[0]).toEqual({ packId: 'orraveth', packVersion: '1.0.0', revision: 0 });
    expect(insertedValues[1]).toEqual([{
      packId: 'orraveth',
      packVersion: '1.0.0',
      id: 'south-common',
      name: 'South Common',
      type: 'district',
      description: 'The southern commons.',
      metadata: { mapColor: 'green' },
    }]);
    expect(insertedValues[2]).toEqual([{
      packId: 'orraveth',
      packVersion: '1.0.0',
      groupId: 'south-common',
      locationId: 'market-square',
      isPrimary: true,
    }]);

    insertCall = 0;
    insertedValues.length = 0;
    tx.insert.mockImplementation(() => {
      insertCall += 1;
      return {
        values: (values: unknown) => {
          insertedValues.push(values);
          return { onConflictDoNothing: () => ({ returning: async () => [] }) };
        },
      };
    });
    await store.initialize('orraveth', '1.0.0', initialGroups);
    expect(insertedValues).toHaveLength(1);
  });

  it('reuses a snapshot at the same revision and reloads it after a revision change', async () => {
    const refreshedGroups = [{
      id: 'south-common',
      name: 'South Common',
      type: 'district',
      description: 'The renewed commons.',
      metadata: { mapColor: 'copper' },
    }];
    mockDb.select
      .mockImplementationOnce(() => queryResult([{ revision: 1 }]))
      .mockImplementationOnce(() => queryResult([{
        id: 'south-common',
        name: 'South Common',
        type: 'district',
        description: 'The southern commons.',
        metadata: { mapColor: 'green' },
      }]))
      .mockImplementationOnce(() => queryResult([{
        groupId: 'south-common',
        locationId: 'market-square',
        isPrimary: true,
      }]))
      .mockImplementationOnce(() => queryResult([{ revision: 1 }]))
      .mockImplementationOnce(() => queryResult([{ revision: 2 }]))
      .mockImplementationOnce(() => queryResult(refreshedGroups))
      .mockImplementationOnce(() => queryResult([{
        groupId: 'south-common',
        locationId: 'mill-road',
        isPrimary: false,
      }]));
    const store = new PostgresLocationGroupCatalogStore();

    const first = await store.read('orraveth', '1.0.0');
    const cached = await store.read('orraveth', '1.0.0');
    const refreshed = await store.read('orraveth', '1.0.0');

    expect(cached).toBe(first);
    expect(refreshed).toEqual({
      packId: 'orraveth',
      packVersion: '1.0.0',
      revision: 2,
      groups: [{
        ...refreshedGroups[0],
        memberships: [{ locationId: 'mill-road', isPrimary: false }],
      }],
    });
    expect(mockDb.select).toHaveBeenCalledTimes(7);
  });

  it('fails clearly when the requested catalog has not been initialized', async () => {
    mockDb.select.mockImplementationOnce(() => queryResult([]));

    await expect(new PostgresLocationGroupCatalogStore().read('missing-pack', '0.0.1'))
      .rejects.toThrow('Location group catalog missing-pack@0.0.1 has not been initialized.');
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it('uses revision compare-and-swap and does not replace groups after a stale write', async () => {
    const returning = vi.fn(async () => []);
    const update = vi.fn(() => ({
      set: () => ({
        where: () => ({ returning }),
      }),
    }));
    const deleteFn = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const insert = vi.fn();
    const tx = { update, delete: deleteFn, insert };
    setTransaction(tx);

    const stale = await new PostgresLocationGroupCatalogStore()
      .replace('orraveth', '1.0.0', 3, initialGroups);

    expect(stale).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    expect(deleteFn).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('replaces groups after a matching revision and normalizes optional fields', async () => {
    const replacementGroups: LocationGroupDefinition[] = [{
      id: 'mill-quarter',
      name: 'Mill Quarter',
      type: 'district',
      memberships: [],
    }];
    const insertValues = vi.fn(async () => undefined);
    const tx = {
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({ returning: async () => [{ revision: 4 }] }),
        }),
      })),
      delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      insert: vi.fn(() => ({ values: insertValues })),
    };
    setTransaction(tx);

    const result = await new PostgresLocationGroupCatalogStore()
      .replace('orraveth', '1.0.0', 3, replacementGroups);

    expect(result).toEqual({
      packId: 'orraveth',
      packVersion: '1.0.0',
      revision: 4,
      groups: replacementGroups,
    });
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith([{
      packId: 'orraveth',
      packVersion: '1.0.0',
      id: 'mill-quarter',
      name: 'Mill Quarter',
      type: 'district',
      description: null,
      metadata: null,
    }]);
  });

  it('evicts the oldest cached catalog after reaching the cache limit', async () => {
    mockDb.select.mockImplementation(() => queryResult([{ revision: 1 }]));
    const store = new PostgresLocationGroupCatalogStore();

    for (let index = 0; index < 33; index += 1) {
      await store.read(`pack-${index}`, '1.0.0');
    }
    await store.read('pack-0', '1.0.0');

    // The first catalog was evicted, so it needs fresh group and membership reads.
    expect(mockDb.select).toHaveBeenCalledTimes(102);
  });
});
