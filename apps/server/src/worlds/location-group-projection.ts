import {
  LocationProjectionSchema,
  locationGroupMembershipsForLocation,
  resolveLocationDisplayName,
  type LocationGroupDefinition,
  type LocationProjection,
} from '@mudd/contracts';

export function projectLocationWithGroups(
  location: LocationProjection,
  groups: readonly LocationGroupDefinition[],
): LocationProjection {
  const locationGroups = locationGroupMembershipsForLocation(groups, location.locationId);
  const displayName = resolveLocationDisplayName(location.shortName, locationGroups);
  return LocationProjectionSchema.parse({
    ...location,
    title: displayName.qualifiedName,
    shortName: displayName.shortName,
    qualifiedName: displayName.qualifiedName,
    locationGroups,
  });
}
