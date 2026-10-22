import {
  LocationGroupCatalogSnapshotSchema,
  LocationGroupDefinitionSchema,
  LocationGroupUpdateSchema,
  LocationGroupsListProjectionSchema,
  LocationGroupsListQuerySchema,
  WorldPackDraftSchema,
  locationGroupMembershipsForLocation,
  projectVisibleLocationGroups,
  resolveLocationDisplayName,
  type CapabilityToken,
  type LocationGroupCatalogCapability,
  type LocationGroupCatalogSnapshot,
  type LocationGroupCatalogStoragePort,
  type LocationGroupDefinition,
  type LocationGroupDefinitionInput,
  type LocationGroupUpdateInput,
} from '@mudd/contracts';
import { RuleViolationError } from '@mudd/engine-core';
import type { WorldPackDraft } from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';

export const locationGroupCatalogCapability = Object.freeze({
  id: 'mudd.location-groups.catalog.v1',
  version: '1',
}) satisfies CapabilityToken<LocationGroupCatalogCapability>;

export type LocationGroupCatalogErrorCode =
  | 'not-found'
  | 'already-exists'
  | 'invalid'
  | 'revision-conflict';

export class LocationGroupCatalogError extends Error {
  constructor(
    readonly code: LocationGroupCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocationGroupCatalogError';
  }
}

export class LocationGroupCatalogService implements LocationGroupCatalogCapability {
  private readonly locationsById: Map<string, WorldPackDraft['locations'][number]>;

  constructor(
    private readonly world: WorldPackDraft,
    private readonly storage: LocationGroupCatalogStoragePort,
  ) {
    this.locationsById = new Map(world.locations.map((location) => [location.id, location]));
  }

  async initialize(): Promise<void> {
    await this.storage.initialize(
      this.world.packId,
      this.world.packVersion,
      this.world.locationGroups,
    );
  }

  async read(): Promise<LocationGroupCatalogSnapshot> {
    return LocationGroupCatalogSnapshotSchema.parse(
      await this.storage.read(this.world.packId, this.world.packVersion),
    );
  }

  async createGroup(
    group: LocationGroupDefinitionInput,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot> {
    const parsed = LocationGroupDefinitionSchema.parse(group);
    return this.mutate(expectedRevision, (groups) => {
      if (groups.some((candidate) => candidate.id === parsed.id)) {
        throw new LocationGroupCatalogError('already-exists', `Location group ${parsed.id} already exists.`);
      }
      return [...groups, parsed];
    });
  }

  async updateGroup(
    groupId: string,
    update: LocationGroupUpdateInput,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot> {
    const parsedUpdate = LocationGroupUpdateSchema.parse(update);
    return this.mutate(expectedRevision, (groups) => {
      const index = groups.findIndex((group) => group.id === groupId);
      if (index < 0) throw new LocationGroupCatalogError('not-found', `Location group ${groupId} was not found.`);

      const existing = groups[index]!;
      const next: Record<string, unknown> = { ...existing, ...parsedUpdate, id: existing.id };
      if (parsedUpdate.description === null) delete next.description;
      if (parsedUpdate.metadata === null) delete next.metadata;
      groups[index] = LocationGroupDefinitionSchema.parse(next);
      return groups;
    });
  }

  async deleteGroup(groupId: string, expectedRevision: number): Promise<LocationGroupCatalogSnapshot> {
    return this.mutate(expectedRevision, (groups) => {
      if (!groups.some((group) => group.id === groupId)) {
        throw new LocationGroupCatalogError('not-found', `Location group ${groupId} was not found.`);
      }
      return groups.filter((group) => group.id !== groupId);
    });
  }

  async addLocationToGroup(
    groupId: string,
    locationId: string,
    isPrimary: boolean,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot> {
    this.assertKnownLocation(locationId);
    return this.mutate(expectedRevision, (groups) => {
      const groupIndex = groups.findIndex((group) => group.id === groupId);
      if (groupIndex < 0) throw new LocationGroupCatalogError('not-found', `Location group ${groupId} was not found.`);
      const alreadyMember = groups[groupIndex]!.memberships.some((membership) =>
        membership.locationId === locationId,
      );
      const nextGroups = groups.map((group) => ({
        ...group,
        memberships: group.memberships.map((membership) => ({
          ...membership,
          ...(isPrimary && membership.locationId === locationId ? { isPrimary: false } : {}),
        })),
      }));
      const target = nextGroups[groupIndex]!;
      if (alreadyMember) {
        target.memberships = target.memberships.map((membership) =>
          membership.locationId === locationId ? { ...membership, isPrimary } : membership,
        );
      } else {
        target.memberships = [...target.memberships, { locationId, isPrimary }];
      }
      return nextGroups;
    });
  }

  async removeLocationFromGroup(
    groupId: string,
    locationId: string,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot> {
    return this.mutate(expectedRevision, (groups) => {
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group) throw new LocationGroupCatalogError('not-found', `Location group ${groupId} was not found.`);
      if (!group.memberships.some((membership) => membership.locationId === locationId)) {
        throw new LocationGroupCatalogError('not-found', `Location ${locationId} is not in group ${groupId}.`);
      }
      return groups.map((candidate) => candidate.id === groupId
        ? {
            ...candidate,
            memberships: candidate.memberships.filter((membership) => membership.locationId !== locationId),
          }
        : candidate);
    });
  }

  async setPrimaryGroup(
    locationId: string,
    groupId: string | null,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot> {
    this.assertKnownLocation(locationId);
    return this.mutate(expectedRevision, (groups) => {
      if (groupId !== null) {
        const target = groups.find((group) => group.id === groupId);
        if (!target) throw new LocationGroupCatalogError('not-found', `Location group ${groupId} was not found.`);
        if (!target.memberships.some((membership) => membership.locationId === locationId)) {
          throw new LocationGroupCatalogError(
            'invalid',
            `Location ${locationId} must belong to group ${groupId} before it can be primary.`,
          );
        }
      }
      return groups.map((group) => ({
        ...group,
        memberships: group.memberships.map((membership) =>
          membership.locationId === locationId
            ? { ...membership, isPrimary: group.id === groupId }
            : membership,
        ),
      }));
    });
  }

  async groupsForLocation(locationId: string) {
    const { groups } = await this.read();
    return locationGroupMembershipsForLocation(groups, locationId);
  }

  async locationsInGroup(groupId: string): Promise<string[]> {
    const { groups } = await this.read();
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new LocationGroupCatalogError('not-found', `Location group ${groupId} was not found.`);
    return group.memberships.map((membership) => membership.locationId);
  }

  async qualifiedLocationName(locationId: string, separator = ': ') {
    const location = this.locationsById.get(locationId);
    if (!location) throw new LocationGroupCatalogError('not-found', `Location ${locationId} was not found.`);
    const memberships = await this.groupsForLocation(locationId);
    return resolveLocationDisplayName(location.name, memberships, separator);
  }

  private async mutate(
    expectedRevision: number,
    update: (groups: LocationGroupDefinition[]) => LocationGroupDefinition[],
  ): Promise<LocationGroupCatalogSnapshot> {
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new LocationGroupCatalogError(
        'revision-conflict',
        `Location group catalog revision is ${current.revision}; expected ${expectedRevision}.`,
      );
    }
    let groups: LocationGroupDefinition[];
    try {
      const candidate = update(current.groups.map((group) => structuredClone(group)));
      groups = WorldPackDraftSchema.parse({
        ...this.world,
        locationGroups: candidate,
      }).locationGroups;
    } catch (error) {
      if (error instanceof LocationGroupCatalogError) throw error;
      throw new LocationGroupCatalogError(
        'invalid',
        error instanceof Error ? error.message : 'The location group catalog is invalid.',
      );
    }
    const saved = await this.storage.replace(
      this.world.packId,
      this.world.packVersion,
      expectedRevision,
      groups,
    );
    if (!saved) {
      throw new LocationGroupCatalogError(
        'revision-conflict',
        'The location group catalog changed while this update was being saved.',
      );
    }
    return LocationGroupCatalogSnapshotSchema.parse(saved);
  }

  private assertKnownLocation(locationId: string): void {
    if (!this.locationsById.has(locationId)) {
      throw new LocationGroupCatalogError('not-found', `Location ${locationId} was not found in this world pack.`);
    }
  }
}

function visibleLocationIds(world: WorldPackDraft, character: {
  locationId: string;
  visitedLocationIds?: string[];
}): Set<string> {
  const current = world.locations.find((location) => location.id === character.locationId);
  if (!current) throw new RuleViolationError('The current location is not part of this world pack.');
  const areaId = current.mapAreaId ?? 'overworld';
  const level = current.mapPosition?.z ?? 0;
  const visited = new Set(character.visitedLocationIds ?? []);
  visited.add(character.locationId);
  return new Set(world.locations.flatMap((location) => {
    if (location.id === character.locationId) return [location.id];
    const position = location.mapPosition;
    if (!position || (location.mapAreaId ?? 'overworld') !== areaId || (position.z ?? 0) !== level) return [];
    return visited.has(location.id) || position.visibleWhenUnvisited ? [location.id] : [];
  }));
}

export function createLocationGroupsPlugin(
  world: WorldPackDraft,
  storage: LocationGroupCatalogStoragePort,
): { plugin: EnginePlugin; catalog: LocationGroupCatalogService } {
  const catalog = new LocationGroupCatalogService(world, storage);
  const plugin: EnginePlugin = {
    manifest: {
      id: 'mudd.location-groups',
      version: '1.0.0',
      apiVersion: '1.0',
      category: 'core',
      provides: [locationGroupCatalogCapability.id],
    },
    async initialize() {
      await catalog.initialize();
    },
    register({ provideCapability, registerQuery }) {
      provideCapability(locationGroupCatalogCapability, catalog);
      registerQuery(
        'location.groups.list',
        LocationGroupsListQuerySchema,
        async (query, context) => {
          const character = context.characterProjection;
          if (!character || character.characterId !== query.characterId) {
            throw new RuleViolationError('Location groups can only be queried for the active character.');
          }
          const snapshot = await catalog.read();
          return LocationGroupsListProjectionSchema.parse({
            worldInstanceId: context.worldInstanceId,
            currentLocationId: character.locationId,
            packId: snapshot.packId,
            packVersion: snapshot.packVersion,
            groups: projectVisibleLocationGroups(
              snapshot.groups,
              visibleLocationIds(context.world, character),
            ),
          });
        },
      );
    },
  };
  return { plugin, catalog };
}
