import { WorldMapProjectionSchema, type CharacterProjection } from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';

export function projectWorldMap(character: CharacterProjection) {
  const visitedLocationIds = new Set(character.visitedLocationIds);
  const visitedLocations = demoWorld.locations.filter((location) => visitedLocationIds.has(location.id));
  const locations = visitedLocations.map((location, index) => ({
    id: location.id,
    name: location.name,
    x: location.mapPosition?.x ?? index,
    y: location.mapPosition?.y ?? 0,
  }));
  const visibleLocationIds = new Set(locations.map((location) => location.id));
  const seenPaths = new Set<string>();
  const connections = visitedLocations.flatMap((location) => location.exits.flatMap((exit) => {
    if (!visibleLocationIds.has(exit.toLocationId)) return [];
    const pathKey = [exit.fromLocationId, exit.toLocationId].sort().join(':');
    if (seenPaths.has(pathKey)) return [];
    seenPaths.add(pathKey);
    return [{ fromLocationId: exit.fromLocationId, toLocationId: exit.toLocationId }];
  }));

  return WorldMapProjectionSchema.parse({
    worldInstanceId: character.worldInstanceId,
    currentLocationId: character.locationId,
    locations,
    connections,
  });
}
