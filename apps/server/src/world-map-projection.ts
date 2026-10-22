import {
  WorldMapProjectionSchema,
  locationGroupMembershipsForLocation,
  projectVisibleLocationGroups,
  resolveLocationDisplayName,
  type CharacterProjection,
  type LocationGroupDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';

export function projectWorldMap(
  character: CharacterProjection,
  world: WorldPackDraft = demoWorld,
  locationGroups: readonly LocationGroupDefinition[] = world.locationGroups,
) {
  const currentLocation = world.locations.find((location) => location.id === character.locationId);
  if (!currentLocation) throw new Error('Cannot project a map for a location absent from the world.');
  const currentAreaId = currentLocation.mapAreaId ?? 'overworld';
  const currentLevel = currentLocation.mapPosition?.z ?? 0;
  const visitedLocationIds = new Set(character.visitedLocationIds);
  const mapLocations = world.locations.filter((location) =>
    (location.mapAreaId ?? 'overworld') === currentAreaId &&
    (location.mapPosition?.z ?? 0) === currentLevel,
  );
  const visibleLocations = mapLocations.filter((location) =>
    visitedLocationIds.has(location.id) || location.mapPosition?.visibleWhenUnvisited === true,
  );
  const locations = visibleLocations.map((location, index) => {
    const groupMemberships = locationGroupMembershipsForLocation(locationGroups, location.id);
    const displayName = resolveLocationDisplayName(location.name, groupMemberships);
    const verticalExits = [...new Set(location.exits
      .filter((exit) => exit.toLocationId !== location.id)
      .map((exit) => exit.direction)
      .filter((direction): direction is 'up' | 'down' => direction === 'up' || direction === 'down'))];
    return {
      id: location.id,
      name: location.name,
      shortName: displayName.shortName,
      qualifiedName: displayName.qualifiedName,
      locationGroupIds: groupMemberships.map((group) => group.id),
      ...(displayName.primaryLocationGroupId
        ? { primaryLocationGroupId: displayName.primaryLocationGroupId }
        : {}),
      x: location.mapPosition?.x ?? index,
      y: location.mapPosition?.y ?? 0,
      ...(location.mapPosition?.terrain ? { terrain: location.mapPosition.terrain } : {}),
      ...(location.mapPosition?.mapColor ? { mapColor: location.mapPosition.mapColor } : {}),
      ...(verticalExits.length ? { verticalExits } : {}),
    };
  });
  const visibleLocationIds = new Set(locations.map((location) => location.id));
  const seenPaths = new Set<string>();
  const connections = visibleLocations.flatMap((location) => location.exits.flatMap((exit) => {
    if (exit.toLocationId === location.id) return [];
    if (!visibleLocationIds.has(exit.toLocationId)) return [];
    const pathKey = [exit.fromLocationId, exit.toLocationId].sort().join(':');
    if (seenPaths.has(pathKey)) return [];
    seenPaths.add(pathKey);
    const reverseExits = world.locations
      .find((candidate) => candidate.id === exit.toLocationId)
      ?.exits.filter((candidate) => candidate.toLocationId === exit.fromLocationId) ?? [];
    const reverseExitExists = reverseExits.length > 0;
    const mapLineGapAtLocationId = exit.mapLineGapAtLocationId ??
      reverseExits.find((candidate) => candidate.mapLineGapAtLocationId)?.mapLineGapAtLocationId;
    return [{
      fromLocationId: exit.fromLocationId,
      toLocationId: exit.toLocationId,
      direction: exit.direction,
      oneWay: !reverseExitExists,
      ...(mapLineGapAtLocationId ? { mapLineGapAtLocationId } : {}),
    }];
  }));

  return WorldMapProjectionSchema.parse({
    worldInstanceId: character.worldInstanceId,
    packId: world.packId,
    packVersion: world.packVersion,
    currentLocationId: character.locationId,
    locations,
    locationGroups: projectVisibleLocationGroups(locationGroups, visibleLocationIds),
    connections,
  });
}
