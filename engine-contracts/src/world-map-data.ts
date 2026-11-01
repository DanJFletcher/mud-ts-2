import { z } from 'zod';
import { IdSchema } from './ids.js';
import { LocationGroupDefinitionSchema } from './location-groups.js';
import {
  LocationDefinitionSchema,
  RoadDefinitionSchema,
  type WorldPackDraftInput,
} from './world.js';

const LocationLayoutSchema = LocationDefinitionSchema.pick({
  id: true,
  name: true,
  description: true,
  regionId: true,
  mapAreaId: true,
  mapPosition: true,
  exits: true,
});

const RoadLayoutSchema = RoadDefinitionSchema.pick({
  id: true,
  name: true,
  locationIds: true,
});

export const WorldLocationsFileSchema = z.object({
  formatVersion: z.literal(1),
  packId: IdSchema,
  locations: z.array(LocationLayoutSchema),
}).strict();

export const WorldLocationGroupsFileSchema = z.object({
  formatVersion: z.literal(1),
  packId: IdSchema,
  locationGroups: z.array(LocationGroupDefinitionSchema).max(500),
}).strict();

export const WorldRoadsFileSchema = z.object({
  formatVersion: z.literal(1),
  packId: IdSchema,
  roads: z.array(RoadLayoutSchema),
}).strict();

export type WorldLocationsFile = z.infer<typeof WorldLocationsFileSchema>;
export type WorldLocationGroupsFile = z.infer<typeof WorldLocationGroupsFileSchema>;
export type WorldRoadsFile = z.infer<typeof WorldRoadsFileSchema>;

export type WorldPackContent = Omit<WorldPackDraftInput, 'locations' | 'locationGroups' | 'roads'> & {
  locationContent: Record<string, Omit<
    z.input<typeof LocationDefinitionSchema>, keyof z.input<typeof LocationLayoutSchema>
  >>;
  roadRules: Record<string, Omit<
    z.input<typeof RoadDefinitionSchema>, keyof z.input<typeof RoadLayoutSchema>
  >>;
};

export interface WorldMapData {
  locations: WorldLocationsFile;
  locationGroups: WorldLocationGroupsFile;
  roads: WorldRoadsFile;
}

export function composeWorldPackDraft(map: WorldMapData, content: WorldPackContent): WorldPackDraftInput {
  const { locationContent, roadRules, ...packContent } = content;
  for (const file of [map.locations, map.locationGroups, map.roads]) {
    if (file.packId !== content.packId) {
      throw new Error(`Map file packId ${file.packId} does not match content packId ${content.packId}`);
    }
  }

  const locationIds = new Set<string>();
  for (const location of map.locations.locations) {
    if (locationIds.has(location.id)) {
      throw new Error(`Duplicate location ID ${location.id} in map locations`);
    }
    locationIds.add(location.id);
  }
  for (const locationId of Object.keys(locationContent)) {
    if (!locationIds.has(locationId)) {
      throw new Error(`Location content references unknown map location ${locationId}`);
    }
  }

  const roadIds = new Set(map.roads.roads.map((road) => road.id));
  for (const roadId of Object.keys(roadRules)) {
    if (!roadIds.has(roadId)) {
      throw new Error(`Road rules reference unknown map road ${roadId}`);
    }
  }
  const roads = map.roads.roads.map((road) => {
    const rules = Object.hasOwn(roadRules, road.id) ? roadRules[road.id] : undefined;
    if (!rules) {
      throw new Error(`Map road ${road.id} has no road rules`);
    }
    return { ...road, ...rules };
  });

  return {
    ...packContent,
    locations: map.locations.locations.map((location) => ({
      ...location,
      ...(Object.hasOwn(locationContent, location.id) ? locationContent[location.id] : {}),
    })),
    locationGroups: map.locationGroups.locationGroups,
    roads,
  };
}
