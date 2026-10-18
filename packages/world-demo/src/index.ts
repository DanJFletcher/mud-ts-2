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
      mapPosition: { x: 0, y: 0 },
      description:
        'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.',
      readables: [
        {
          id: 'mossgate-marker',
          label: 'Weathered marker',
          description: 'A weathered stone marker, its carved arrow worn but still pointing east.',
          text: 'OLD BELL TOWER — EAST',
        },
      ],
      takeables: [
        {
          id: 'mossgate-loose-stone',
          label: 'Loose stone',
          description: 'A smooth, palm-sized stone with a pale stripe running through it.',
          roomDescription: 'One loose stone bears a pale stripe.',
        },
      ],
      npcs: [
        {
          id: 'mara-waykeeper',
          name: 'Mara',
          description: 'A path keeper stands beside the weathered marker, watching the northern trail.',
          greeting: 'The north bridge is open. The marker points east to the Old Bell Tower.',
          dialogue: {
            prompt: 'The old paths still have their stories. What would you like to ask?',
            choices: [
              {
                id: 'ask-marker',
                label: 'Ask about the marker',
                response: 'The marker points east to the Old Bell Tower. Its direction is still true.',
                progressFlagId: 'mara-asked-marker',
              },
              {
                id: 'ask-tower',
                label: 'Ask about the bell tower',
                response: 'The bell has been silent for years. I still hope to hear it ring again.',
                progressFlagId: 'mara-asked-tower',
              },
            ],
          },
          topics: [
            {
              id: 'marker',
              keywords: ['marker', 'sign', 'east'],
              response: 'The marker is old, but the carving still points east toward the Old Bell Tower.',
            },
            {
              id: 'tower',
              keywords: ['tower', 'bell'],
              response: 'The bell has not rung in years. The tower stands east of this clearing.',
            },
          ],
          unknownTopicResponse: 'Ask me about the marker or the bell tower.',
          announcements: [
            'The north bridge is open to travelers.',
            'The marker still points east to the Old Bell Tower.',
          ],
        },
      ],
      exits: [
        { id: 'clearing-to-bridge', fromLocationId: 'mossgate-clearing', toLocationId: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north' },
        { id: 'clearing-to-tower', fromLocationId: 'mossgate-clearing', toLocationId: 'bell-tower', label: 'East to the Old Bell Tower', direction: 'east' },
      ],
    },
    {
      id: 'glasswater-bridge',
      name: 'Glasswater Bridge',
      mapPosition: { x: 0, y: 1 },
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
      mapPosition: { x: 1, y: 0 },
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
