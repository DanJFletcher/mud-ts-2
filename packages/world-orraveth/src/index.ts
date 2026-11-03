import {
  WorldPackDraftSchema,
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
  composeWorldPackDraft,
  validateDraftWorldGraph,
  type WorldPackDraft,
  type WorldPackContent,
} from '@mudd/contracts';
import locations from './map/locations.json' with { type: 'json' };
import locationGroups from './map/location-groups.json' with { type: 'json' };
import roads from './map/roads.json' with { type: 'json' };
import { orravethClassCatalog } from './classes.js';
import { dailyBoards } from './content/daily-jobs.js';
import { supplySources, woodcuttingTrees, fishingSpots } from './content/gathering.js';
import { craftingWorkbenchLocationIds, craftingRecipes } from './content/crafting.js';
import { quests } from './content/quests.js';
import { roadRules } from './content/encounters.js';
import { harrowfen } from './content/settlements/harrowfen.js';
import { waterways } from './content/settlements/waterways.js';
import { mosswake } from './content/settlements/mosswake.js';
import { thornmere } from './content/settlements/thornmere.js';
import { ashcombe } from './content/settlements/ashcombe.js';
import { bellwoldLandmarks } from './content/settlements/bellwold-landmarks.js';
import { bellwoldCommerce } from './content/settlements/bellwold-commerce.js';
import { bellwoldResidences } from './content/settlements/bellwold-residences.js';
import { rillford } from './content/settlements/rillford.js';
import { mergeLocationContent } from './content/locations.js';

export { orravethClassCatalog } from './classes.js';

export const ORRAVETH_WORLD_INSTANCE_ID = 'orraveth-bellwold-instance';

const content = {
  formatVersion: 1,
  packId: 'orraveth.bellwold',
  packVersion: '1.21.1',
  movementStaminaCost: 2,
  displayName: 'Orraveth: Bellwold',
  dailyBoards,
  supplySources,
  woodcuttingTrees,
  craftingWorkbenchLocationIds,
  craftingRecipes,
  fishingSpots,
  classCatalog: orravethClassCatalog,
  currency: {
    id: 'gold',
    name: 'gold piece',
    symbol: 'g',
    startingBalance: 0,
  },
  locationContent: mergeLocationContent(
    harrowfen, waterways, mosswake, thornmere, ashcombe,
    bellwoldLandmarks, bellwoldCommerce, bellwoldResidences, rillford,
  ),
  roadRules,
  quests,
} satisfies WorldPackContent;

export const orravethWorld: WorldPackDraft = WorldPackDraftSchema.parse(composeWorldPackDraft({
  locations: WorldLocationsFileSchema.parse(locations),
  locationGroups: WorldLocationGroupsFileSchema.parse(locationGroups),
  roads: WorldRoadsFileSchema.parse(roads),
}, content));
const graphErrors = validateDraftWorldGraph(orravethWorld);
if (graphErrors.length > 0) {
  throw new Error(`Invalid Orraveth world graph:\n${graphErrors.map((error) => `- ${error}`).join('\n')}`);
}

export const ORRAVETH_WORLD_SUMMARY = 'Explore Bellwold, a frontier settlement with local residents, the silent old bell, roads beyond town, and a maze beneath the abandoned church.';
