import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocationGroupCatalogStoragePort, LocationGroupDefinition } from '@mudd/contracts';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

integrationDescribe('PostgresLocationGroupCatalogStore', () => {
  const packId = `location-group-test-${randomUUID()}`;
  const packVersion = 'integration-1';
  const locationId = `fixture-room-${randomUUID()}`;
  const initialGroups: LocationGroupDefinition[] = [{
    id: 'initial',
    name: 'Initial Group',
    type: 'district',
    memberships: [{ locationId, isPrimary: true }],
  }];
  let db: typeof import('./db/client.js').db;
  let pool: typeof import('./db/client.js').pool;
  let store: LocationGroupCatalogStoragePort;
  let independentStore: LocationGroupCatalogStoragePort;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    ({ db, pool } = await import('./db/client.js'));
    const { PostgresLocationGroupCatalogStore } = await import('./location-group-store.js');
    store = new PostgresLocationGroupCatalogStore();
    independentStore = new PostgresLocationGroupCatalogStore();
  });

  afterAll(async () => {
    if (!db || !pool) return;
    const { and, eq } = await import('drizzle-orm');
    const { worldLocationGroupCatalogs } = await import('./db/schema.js');
    try {
      await db.delete(worldLocationGroupCatalogs).where(and(
        eq(worldLocationGroupCatalogs.packId, packId),
        eq(worldLocationGroupCatalogs.packVersion, packVersion),
      ));
    } finally {
      await pool.end();
    }
  });

  it('seeds once, persists revisions, rejects stale writes, and rolls back invalid membership state', async () => {
    await store.initialize(packId, packVersion, initialGroups);
    const seeded = await store.read(packId, packVersion);
    expect(seeded).toMatchObject({
      revision: 0,
      groups: initialGroups,
    });

    const { newMeasurements, requestMeasurements } = await import('./performance.js');
    const warmReadMetrics = newMeasurements();
    await requestMeasurements.run(warmReadMetrics, async () => {
      await independentStore.read(packId, packVersion);
      await independentStore.read(packId, packVersion);
    });
    expect(warmReadMetrics.databaseOperations['location_group.catalog_read']).toMatchObject({
      calls: 2,
      queries: 4,
    });

    const editedGroups: LocationGroupDefinition[] = [{
      id: 'renamed',
      name: 'Renamed Group',
      type: 'district',
      memberships: [{ locationId, isPrimary: true }],
      metadata: { persisted: true },
    }];
    const updated = await store.replace(packId, packVersion, 0, editedGroups);
    expect(updated).toMatchObject({ revision: 1, groups: editedGroups });

    const refreshedReadMetrics = newMeasurements();
    await requestMeasurements.run(refreshedReadMetrics, async () => {
      expect(await independentStore.read(packId, packVersion)).toEqual(updated);
      await independentStore.read(packId, packVersion);
    });
    expect(refreshedReadMetrics.databaseOperations['location_group.catalog_read']).toMatchObject({
      calls: 2,
      queries: 4,
    });

    const localWriteReadMetrics = newMeasurements();
    await requestMeasurements.run(localWriteReadMetrics, async () => {
      expect(await store.read(packId, packVersion)).toEqual(updated);
    });
    expect(localWriteReadMetrics.databaseOperations['location_group.catalog_read']).toMatchObject({
      calls: 1,
      queries: 1,
    });

    await store.initialize(packId, packVersion, initialGroups);
    expect(await store.read(packId, packVersion)).toEqual(updated);
    expect(await store.replace(packId, packVersion, 0, [])).toBeUndefined();

    const duplicatePrimaries: LocationGroupDefinition[] = [
      {
        id: 'primary-a',
        name: 'Primary A',
        type: 'district',
        memberships: [{ locationId, isPrimary: true }],
      },
      {
        id: 'primary-b',
        name: 'Primary B',
        type: 'district',
        memberships: [{ locationId, isPrimary: true }],
      },
    ];
    await expect(store.replace(packId, packVersion, 1, duplicatePrimaries)).rejects.toThrow();
    expect(await store.read(packId, packVersion)).toEqual(updated);
  });
});
