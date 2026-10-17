import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type LocationDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';

const draft = {
  formatVersion: 1,
  packId: 'mudd.first-steps',
  packVersion: '1.0.0',
  displayName: 'The Waystone Path',
  locations: [
    {
      id: 'mossgate-clearing',
      name: 'Mossgate Clearing',
      description:
        'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.',
      readables: [
        { id: 'mossgate-marker', label: 'Weathered marker', text: 'OLD BELL TOWER — EAST' },
      ],
      exits: [
        { id: 'clearing-to-bridge', fromLocationId: 'mossgate-clearing', toLocationId: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north' },
        { id: 'clearing-to-tower', fromLocationId: 'mossgate-clearing', toLocationId: 'bell-tower', label: 'East to the Old Bell Tower', direction: 'east' },
      ],
    },
    {
      id: 'glasswater-bridge',
      name: 'Glasswater Bridge',
      description:
        'A low stone bridge crosses clear water. Reeds stir below it, and the path returns south or bends east toward a dark roofline.',
      exits: [
        { id: 'bridge-to-clearing', fromLocationId: 'glasswater-bridge', toLocationId: 'mossgate-clearing', label: 'South to Mossgate Clearing', direction: 'south' },
        { id: 'bridge-to-tower', fromLocationId: 'glasswater-bridge', toLocationId: 'bell-tower', label: 'East to the Old Bell Tower', direction: 'east' },
      ],
    },
    {
      id: 'bell-tower',
      name: 'Old Bell Tower',
      description:
        'The roofless tower stands quiet above the trees. Its cracked bell hangs still; paths lead west to the clearing and north to the bridge.',
      exits: [
        { id: 'tower-to-clearing', fromLocationId: 'bell-tower', toLocationId: 'mossgate-clearing', label: 'West to Mossgate Clearing', direction: 'west' },
        { id: 'tower-to-bridge', fromLocationId: 'bell-tower', toLocationId: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north' },
      ],
    },
  ],
} satisfies WorldPackDraft;

export const demoWorld: WorldPackDraft = WorldPackDraftSchema.parse(draft);
const graphErrors = validateDraftWorldGraph(demoWorld);
if (graphErrors.length > 0) throw new Error(`Invalid demo world: ${graphErrors.join('; ')}`);

export const DEMO_WORLD_INSTANCE_ID = 'mudd-demo-instance';
export const STARTING_LOCATION_ID = 'mossgate-clearing';

export function getLocation(locationId: string): LocationDefinition | undefined {
  return demoWorld.locations.find((location) => location.id === locationId);
}
