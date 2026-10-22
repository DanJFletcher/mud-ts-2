import { describe, expect, it } from 'vitest';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import type {
  LocationGroupCatalogSnapshot,
  LocationGroupCatalogStoragePort,
  LocationGroupDefinition,
} from '@mudd/contracts';
import { CharacterProjectionSchema, LocationGroupsListProjectionSchema } from '@mudd/contracts';
import { EngineHost, InMemoryEventStore } from '@mudd/engine-core';
import { createLocationGroupsPlugin, LocationGroupCatalogService } from './location-groups.js';

class InMemoryLocationGroupStore implements LocationGroupCatalogStoragePort {
  private snapshot?: LocationGroupCatalogSnapshot;

  async initialize(
    packId: string,
    packVersion: string,
    initialGroups: readonly LocationGroupDefinition[],
  ): Promise<void> {
    this.snapshot ??= {
      packId,
      packVersion,
      revision: 0,
      groups: [...structuredClone(initialGroups)],
    };
  }

  async read(packId: string, packVersion: string): Promise<LocationGroupCatalogSnapshot> {
    if (!this.snapshot || this.snapshot.packId !== packId || this.snapshot.packVersion !== packVersion) {
      throw new Error('Catalog not found.');
    }
    return structuredClone(this.snapshot);
  }

  async replace(
    packId: string,
    packVersion: string,
    expectedRevision: number,
    groups: readonly LocationGroupDefinition[],
  ): Promise<LocationGroupCatalogSnapshot | undefined> {
    const current = await this.read(packId, packVersion);
    if (current.revision !== expectedRevision) return undefined;
    this.snapshot = {
      ...current,
      revision: current.revision + 1,
      groups: [...structuredClone(groups)],
    };
    return structuredClone(this.snapshot);
  }
}

async function createCatalog() {
  const catalog = new LocationGroupCatalogService(demoWorld, new InMemoryLocationGroupStore());
  await catalog.initialize();
  return catalog;
}

describe('location-group catalog capability', () => {
  it('supports overlapping memberships and derives the primary qualified room name', async () => {
    const catalog = await createCatalog();

    const bridgeGroups = await catalog.groupsForLocation('glasswater-bridge');
    expect(bridgeGroups.map((group) => group.id).sort()).toEqual([
      'clearwater',
      'glasswater-river',
      'kings-road',
    ]);
    expect(bridgeGroups.find((group) => group.isPrimary)?.id).toBe('clearwater');
    expect(await catalog.qualifiedLocationName('glasswater-bridge')).toEqual({
      shortName: 'Glasswater Bridge',
      qualifiedName: 'Clearwater: Glasswater Bridge',
      primaryLocationGroupId: 'clearwater',
    });
    expect((await catalog.qualifiedLocationName('glasswater-bridge', ' / ')).qualifiedName)
      .toBe('Clearwater / Glasswater Bridge');
  });

  it('creates, updates, and deletes a group without changing room content', async () => {
    const catalog = await createCatalog();
    const created = await catalog.createGroup({
      id: 'south-bank',
      name: 'South Bank',
      type: 'district',
      memberships: [{ locationId: 'glasswater-approach', isPrimary: false }],
      metadata: { ward: 2 },
    }, 0);
    expect(created.revision).toBe(1);
    expect(created.groups.find((group) => group.id === 'south-bank')?.metadata).toEqual({ ward: 2 });

    const updated = await catalog.updateGroup('south-bank', {
      name: 'Lower Bank',
      description: 'The lower streets beside the river.',
    }, 1);
    expect(updated.groups.find((group) => group.id === 'south-bank')).toMatchObject({
      name: 'Lower Bank',
      description: 'The lower streets beside the river.',
    });

    const deleted = await catalog.deleteGroup('south-bank', 2);
    expect(deleted.groups.some((group) => group.id === 'south-bank')).toBe(false);
    expect(demoWorld.locations.some((location) => location.id === 'glasswater-approach')).toBe(true);
  });

  it('moves the primary membership atomically and rejects stale catalog revisions', async () => {
    const catalog = await createCatalog();
    const changed = await catalog.addLocationToGroup('clearwater', 'glasswater-approach', true, 0);

    expect(changed.groups.find((group) => group.id === 'clearwater')?.memberships)
      .toContainEqual({ locationId: 'glasswater-approach', isPrimary: true });
    expect(changed.groups.find((group) => group.id === 'kings-road')?.memberships)
      .toContainEqual({ locationId: 'glasswater-approach', isPrimary: false });
    await expect(catalog.deleteGroup('clearwater', 0)).rejects.toMatchObject({
      code: 'revision-conflict',
    });
  });

  it('rejects memberships to unknown rooms and a primary group without membership', async () => {
    const catalog = await createCatalog();
    await expect(catalog.createGroup({
      id: 'invalid',
      name: 'Invalid',
      type: 'district',
      memberships: [{ locationId: 'missing-room', isPrimary: false }],
    }, 0)).rejects.toMatchObject({ code: 'invalid' });
    await expect(catalog.setPrimaryGroup('glasswater-approach', 'clearwater', 0))
      .rejects.toMatchObject({ code: 'invalid' });
    await expect(catalog.createGroup({
      id: 'competing-primary',
      name: 'Competing Primary',
      type: 'district',
      memberships: [{ locationId: 'glasswater-bridge', isPrimary: true }],
    }, 0)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('serves group queries with current-map visibility filtering', async () => {
    const feature = createLocationGroupsPlugin(demoWorld, new InMemoryLocationGroupStore());
    const engine = new EngineHost(
      [feature.plugin],
      new InMemoryEventStore(),
      {
        canAccessInstance: async () => true,
        ownsCharacter: async () => true,
      },
      demoWorld,
    );
    await engine.start();
    try {
      const character = CharacterProjectionSchema.parse({
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: 'location-group-reader',
        name: 'Reader',
        locationId: 'glasswater-bridge',
        visitedLocationIds: ['glasswater-bridge'],
        revision: 1,
      });
      const result = await engine.query({
        type: 'location.groups.list',
        version: 1,
        queryId: 'groups-at-bridge',
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: character.characterId,
        payload: {},
      }, {
        sessionId: 'location-group-session',
        playerId: 'location-group-player',
        actorId: 'location-group-player',
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        grantedPermissions: [],
        authenticated: true,
      }, { characterProjection: character });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const projection = LocationGroupsListProjectionSchema.parse(result.value);
      expect(projection.groups.find((group) => group.id === 'clearwater')?.locationIds)
        .toEqual(['glasswater-bridge']);
      expect(projection.groups.find((group) => group.id === 'clearwater')?.locationIds)
        .not.toContain('willowrest-inn');
      expect(projection.groups.find((group) => group.id === 'glasswater-river')?.locationIds)
        .toContain('glasswater-west-reach');
    } finally {
      await engine.stop();
    }
  });
});
