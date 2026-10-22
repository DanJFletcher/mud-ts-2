import { z } from 'zod';
import { ClientQueryBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema } from './ids.js';

export const LocationGroupTypeSchema = z.string().trim().min(1).max(80);

export const LocationGroupMembershipSchema = z.object({
  locationId: IdSchema,
  isPrimary: z.boolean().default(false),
}).strict();

export const LocationGroupDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(160),
  type: LocationGroupTypeSchema,
  description: z.string().trim().min(1).max(1000).optional(),
  memberships: z.array(LocationGroupMembershipSchema).max(5000).default([]),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export const LocationGroupUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  type: LocationGroupTypeSchema.optional(),
  description: z.string().trim().min(1).max(1000).nullable().optional(),
  memberships: z.array(LocationGroupMembershipSchema).max(5000).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
}).strict().refine((update) => Object.keys(update).length > 0, {
  message: 'A location-group update must change at least one field.',
});

export const LocationGroupCatalogSnapshotSchema = z.object({
  packId: IdSchema,
  packVersion: z.string().min(1).max(80),
  revision: NonNegativeIntSchema,
  groups: z.array(LocationGroupDefinitionSchema).max(500),
}).strict();

export const LocationGroupMembershipProjectionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  type: LocationGroupTypeSchema,
  description: z.string().min(1).max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  isPrimary: z.boolean(),
}).strict();

export const LocationGroupMapProjectionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  type: LocationGroupTypeSchema,
  description: z.string().min(1).max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
  locationIds: z.array(IdSchema).max(5000),
  primaryLocationIds: z.array(IdSchema).max(5000),
}).strict();

export const LocationGroupsListQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('location.groups.list'),
  payload: z.object({}).strict(),
}).strict();

export const LocationGroupsListProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  currentLocationId: IdSchema,
  packId: IdSchema,
  packVersion: z.string().min(1).max(80),
  groups: z.array(LocationGroupMapProjectionSchema).max(500),
}).strict();

export type LocationGroupType = z.infer<typeof LocationGroupTypeSchema>;
export type LocationGroupMembership = z.infer<typeof LocationGroupMembershipSchema>;
export type LocationGroupDefinition = z.infer<typeof LocationGroupDefinitionSchema>;
export type LocationGroupDefinitionInput = z.input<typeof LocationGroupDefinitionSchema>;
export type LocationGroupUpdate = z.infer<typeof LocationGroupUpdateSchema>;
export type LocationGroupUpdateInput = z.input<typeof LocationGroupUpdateSchema>;
export type LocationGroupCatalogSnapshot = z.infer<typeof LocationGroupCatalogSnapshotSchema>;
export type LocationGroupMembershipProjection = z.infer<typeof LocationGroupMembershipProjectionSchema>;
export type LocationGroupMapProjection = z.infer<typeof LocationGroupMapProjectionSchema>;
export type LocationGroupsListQuery = z.infer<typeof LocationGroupsListQuerySchema>;
export type LocationGroupsListProjection = z.infer<typeof LocationGroupsListProjectionSchema>;

/** Storage contract for a pack-versioned catalog; implementations must compare revisions atomically. */
export interface LocationGroupCatalogStoragePort {
  initialize(
    packId: string,
    packVersion: string,
    initialGroups: readonly LocationGroupDefinition[],
  ): Promise<void>;
  read(packId: string, packVersion: string): Promise<LocationGroupCatalogSnapshot>;
  replace(
    packId: string,
    packVersion: string,
    expectedRevision: number,
    groups: readonly LocationGroupDefinition[],
  ): Promise<LocationGroupCatalogSnapshot | undefined>;
}

/** Trusted server/plugin authoring capability. It is intentionally not a player-facing write API. */
export interface LocationGroupCatalogCapability {
  read(): Promise<LocationGroupCatalogSnapshot>;
  createGroup(group: LocationGroupDefinitionInput, expectedRevision: number): Promise<LocationGroupCatalogSnapshot>;
  updateGroup(
    groupId: string,
    update: LocationGroupUpdateInput,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot>;
  deleteGroup(groupId: string, expectedRevision: number): Promise<LocationGroupCatalogSnapshot>;
  addLocationToGroup(
    groupId: string,
    locationId: string,
    isPrimary: boolean,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot>;
  removeLocationFromGroup(
    groupId: string,
    locationId: string,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot>;
  setPrimaryGroup(
    locationId: string,
    groupId: string | null,
    expectedRevision: number,
  ): Promise<LocationGroupCatalogSnapshot>;
  groupsForLocation(locationId: string): Promise<LocationGroupMembershipProjection[]>;
  locationsInGroup(groupId: string): Promise<string[]>;
  qualifiedLocationName(locationId: string, separator?: string): Promise<{
    shortName: string;
    qualifiedName: string;
    primaryLocationGroupId?: string;
  }>;
}

export function locationGroupMembershipsForLocation(
  groups: readonly LocationGroupDefinition[],
  locationId: string,
): LocationGroupMembershipProjection[] {
  return groups.flatMap((group) => {
    const membership = group.memberships.find((candidate) => candidate.locationId === locationId);
    return membership
      ? [{
          id: group.id,
          name: group.name,
          type: group.type,
          ...(group.description ? { description: group.description } : {}),
          ...(group.metadata ? { metadata: group.metadata } : {}),
          isPrimary: membership.isPrimary,
        }]
      : [];
  });
}

export function resolveLocationDisplayName(
  shortName: string,
  memberships: readonly LocationGroupMembershipProjection[],
  separator = ': ',
): { shortName: string; qualifiedName: string; primaryLocationGroupId?: string } {
  const primary = memberships.find((membership) => membership.isPrimary);
  return {
    shortName,
    qualifiedName: primary ? `${primary.name}${separator}${shortName}` : shortName,
    ...(primary ? { primaryLocationGroupId: primary.id } : {}),
  };
}

export function projectVisibleLocationGroups(
  groups: readonly LocationGroupDefinition[],
  visibleLocationIds: ReadonlySet<string>,
): LocationGroupMapProjection[] {
  return groups.flatMap((group) => {
    const memberships = group.memberships.filter((membership) => visibleLocationIds.has(membership.locationId));
    if (memberships.length === 0) return [];
    return [{
      id: group.id,
      name: group.name,
      type: group.type,
      ...(group.description ? { description: group.description } : {}),
      ...(group.metadata ? { metadata: group.metadata } : {}),
      locationIds: memberships.map((membership) => membership.locationId),
      primaryLocationIds: memberships
        .filter((membership) => membership.isPrimary)
        .map((membership) => membership.locationId),
    }];
  });
}
