import { WorldMapProjectionSchema, type CharacterProjection, type WorldPackDraft } from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';

export function projectWorldMap(character: CharacterProjection, world: WorldPackDraft = demoWorld) {
  const currentLocation = world.locations.find((location) => location.id === character.locationId);
  if (!currentLocation) throw new Error('Cannot project a map for a location absent from the world.');
  const currentAreaId = currentLocation.mapAreaId ?? 'overworld';
  const currentLevel = currentLocation.mapPosition?.z ?? 0;
  const visitedLocationIds = new Set(character.visitedLocationIds);
  const mapLocations = world.locations.filter((location) =>
    (location.mapAreaId ?? 'overworld') === currentAreaId &&
    (location.mapPosition?.z ?? 0) === currentLevel,
  );
  const visitedLocations = mapLocations.filter((location) => visitedLocationIds.has(location.id));
  const visibleLocations = mapLocations.filter((location) =>
    visitedLocationIds.has(location.id) || location.mapPosition?.visibleWhenUnvisited === true,
  );
  const locations = visibleLocations.map((location, index) => {
    const verticalExits = [...new Set(location.exits
      .map((exit) => exit.direction)
      .filter((direction): direction is 'up' | 'down' => direction === 'up' || direction === 'down'))];
    return {
      id: location.id,
      name: location.name,
      x: location.mapPosition?.x ?? index,
      y: location.mapPosition?.y ?? 0,
      ...(location.mapPosition?.terrain ? { terrain: location.mapPosition.terrain } : {}),
      ...(verticalExits.length ? { verticalExits } : {}),
    };
  });
  const visibleLocationIds = new Set(locations.map((location) => location.id));
  const seenPaths = new Set<string>();
  const connections = visitedLocations.flatMap((location) => location.exits.flatMap((exit) => {
    if (!visibleLocationIds.has(exit.toLocationId)) return [];
    const pathKey = [exit.fromLocationId, exit.toLocationId].sort().join(':');
    if (seenPaths.has(pathKey)) return [];
    seenPaths.add(pathKey);
    const reverseExitExists = world.locations
      .find((candidate) => candidate.id === exit.toLocationId)
      ?.exits.some((candidate) => candidate.toLocationId === exit.fromLocationId) ?? false;
    return [{
      fromLocationId: exit.fromLocationId,
      toLocationId: exit.toLocationId,
      direction: exit.direction,
      oneWay: !reverseExitExists,
    }];
  }));

  return WorldMapProjectionSchema.parse({
    worldInstanceId: character.worldInstanceId,
    currentLocationId: character.locationId,
    locations,
    connections,
  });
}
