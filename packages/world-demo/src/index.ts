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
  currency: {
    id: 'moss-mark',
    name: 'moss mark',
    symbol: 'm',
    startingBalance: 12,
  },
  quests: [
    {
      id: 'mara-wayfinding',
      version: '1.0.0',
      title: 'The Waystone Path',
      summary: 'Read the marker, visit the Old Bell Tower, and report back to Mara.',
      giverNpcId: 'mara-waykeeper',
      turnInNpcId: 'mara-waykeeper',
      objectives: [
        {
          id: 'read-marker',
          label: 'Read the weathered marker',
          type: 'read-object',
          objectId: 'mossgate-marker',
          locationId: 'mossgate-clearing',
        },
        {
          id: 'visit-bell-tower',
          label: 'Visit the Old Bell Tower',
          type: 'visit-location',
          locationId: 'bell-tower',
        },
      ],
    },
    {
      id: 'eddas-bell-echo',
      version: '1.0.0',
      title: "The Bell's Second Note",
      summary: 'Restore the tower bell’s two-note pattern and discover what the bellwrights kept below.',
      giverNpcId: 'edda-bellwright',
      turnInNpcId: 'edda-bellwright',
      objectives: [
        {
          id: 'read-bell-inscription',
          label: 'Find the bell’s inscription',
          type: 'read-object',
          objectId: 'tower-bell-inscription',
          locationId: 'bell-tower',
        },
        {
          id: 'strike-bell-with-stone',
          label: 'Sound the bell’s first note',
          type: 'perform-interaction',
          interactionId: 'ring-tower-bell-with-stone',
          locationId: 'bell-tower',
        },
        {
          id: 'answer-bell-with-reed',
          label: 'Find the bell’s second note',
          type: 'perform-interaction',
          interactionId: 'answer-tower-bell-with-reed',
          locationId: 'bell-tower',
        },
        {
          id: 'visit-underhollow',
          label: 'Follow the echo below',
          type: 'visit-location',
          locationId: 'bell-underhollow',
        },
      ],
    },
  ],
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
            questResponses: [
              {
                questId: 'mara-wayfinding',
                status: 'active',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: ['read-marker'],
                response: 'I’ll mark the way for you. Read the weathered marker beside me to start.',
              },
              {
                questId: 'mara-wayfinding',
                status: 'active',
                requiresCompletedObjectiveIds: ['read-marker'],
                requiresIncompleteObjectiveIds: ['visit-bell-tower'],
                response: 'You read the marker. Its arrow points east to the Old Bell Tower. Visit the tower, then come back and tell me what you found.',
              },
              {
                questId: 'mara-wayfinding',
                status: 'active',
                requiresCompletedObjectiveIds: ['read-marker', 'visit-bell-tower'],
                requiresIncompleteObjectiveIds: [],
                response: 'You reached the Old Bell Tower. Tell me what you found when you are ready to report.',
              },
              {
                questId: 'mara-wayfinding',
                status: 'completed',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: [],
                response: 'You brought back the story of the path. Thank you; I will remember it.',
              },
            ],
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
                questCondition: {
                  questId: 'mara-wayfinding',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-marker'],
                  requiresIncompleteObjectiveIds: [],
                },
              },
              {
                id: 'accept-wayfinding-quest',
                label: "I'll follow the marker",
                response: 'Read the marker, visit the Old Bell Tower, and come back to tell me what you found.',
                progressFlagId: 'mara-accepted-wayfinding',
                questAction: { type: 'accept', questId: 'mara-wayfinding' },
              },
              {
                id: 'report-wayfinding-quest',
                label: 'I visited the Old Bell Tower',
                response: 'You followed the marker all the way to the tower. Thank you for bringing back the story of the path.',
                progressFlagId: 'mara-reported-wayfinding',
                questAction: { type: 'turn-in', questId: 'mara-wayfinding' },
              },
            ],
          },
          topics: [
            {
              id: 'marker',
              keywords: ['marker', 'sign', 'east'],
              response: 'The marker is old, but the carving still points east toward the Old Bell Tower.',
              questResponses: [
                {
                  questId: 'mara-wayfinding',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-marker'],
                  requiresIncompleteObjectiveIds: [],
                  response: 'You’ve read the marker now. Its arrow points east to the Old Bell Tower.',
                },
                {
                  questId: 'mara-wayfinding',
                  status: 'completed',
                  requiresCompletedObjectiveIds: ['read-marker'],
                  requiresIncompleteObjectiveIds: [],
                  response: 'You read the marker and followed its direction all the way to the Old Bell Tower.',
                },
              ],
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
          roomChatReactions: [
            {
              keywords: ['marker', 'sign'],
              response: 'The marker is old, but its arrow still points east.',
            },
            {
              keywords: ['bell tower', 'tower', 'bell'],
              response: 'The bell has been quiet for years. The Old Bell Tower stands east of here.',
            },
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
      takeables: [
        {
          id: 'glasswater-reed',
          label: 'Hollow reed',
          description: 'A dry green reed with a hollow stem, light enough to bend but not break.',
          roomDescription: 'A hollow reed rests between the bridge stones.',
        },
      ],
      npcs: [
        {
          id: 'edda-bellwright',
          name: 'Edda',
          description: 'A bellwright with a grease-stained ledger studies the old tower; she wants to hear whether its cracked bell can still be tuned.',
          greeting: 'I repair bells. This one may still know the way below.',
          dialogue: {
            prompt: 'The bell was meant to open a tuning room below. I want to know whether it can still sound its proper note. Ask me for a hint if you want one.',
            questResponses: [
              {
                questId: 'eddas-bell-echo',
                status: 'active',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: ['read-bell-inscription'],
                response: 'Start at the tower. The inscription is the bellwrights’ account of how the mechanism works.',
              },
              {
                questId: 'eddas-bell-echo',
                status: 'active',
                requiresCompletedObjectiveIds: ['read-bell-inscription'],
                requiresIncompleteObjectiveIds: ['strike-bell-with-stone'],
                response: 'The inscription distinguishes the pale from the hollow. Look closely at what you have found; the bell has not yet answered.',
              },
              {
                questId: 'eddas-bell-echo',
                status: 'active',
                requiresCompletedObjectiveIds: ['read-bell-inscription', 'strike-bell-with-stone'],
                requiresIncompleteObjectiveIds: ['answer-bell-with-reed'],
                response: 'The first note has sounded. A hollow answer from the river remains.',
              },
              {
                questId: 'eddas-bell-echo',
                status: 'active',
                requiresCompletedObjectiveIds: [
                  'read-bell-inscription',
                  'strike-bell-with-stone',
                  'answer-bell-with-reed',
                ],
                requiresIncompleteObjectiveIds: ['visit-underhollow'],
                response: 'The bell has answered. Follow the echo down the stair beneath the tower.',
              },
              {
                questId: 'eddas-bell-echo',
                status: 'active',
                requiresCompletedObjectiveIds: [
                  'read-bell-inscription',
                  'strike-bell-with-stone',
                  'answer-bell-with-reed',
                  'visit-underhollow',
                ],
                requiresIncompleteObjectiveIds: [],
                response: 'You found the Underhollow. Come back when you are ready to report what lies below.',
              },
              {
                questId: 'eddas-bell-echo',
                status: 'completed',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: [],
                response: 'The bell has a second note now, and the Underhollow is no longer a rumor.',
              },
            ],
            choices: [
              {
                id: 'accept-bell-echo',
                label: 'Investigate the bell puzzle',
                response: 'The old inscription is still legible. It speaks of something pale and a hollow voice from the river; I found a reed near the bridge.',
                progressFlagId: 'edda-accepted-bell-echo',
                questAction: { type: 'accept', questId: 'eddas-bell-echo' },
              },
              {
                id: 'report-bell-echo',
                label: 'I found the Underhollow',
                response: 'The two notes opened the way below. I found the Underhollow.',
                progressFlagId: 'edda-reported-bell-echo',
                questCondition: {
                  questId: 'eddas-bell-echo',
                  status: 'active',
                  requiresCompletedObjectiveIds: [
                    'read-bell-inscription',
                    'strike-bell-with-stone',
                    'answer-bell-with-reed',
                    'visit-underhollow',
                  ],
                  requiresIncompleteObjectiveIds: [],
                },
                questAction: { type: 'turn-in', questId: 'eddas-bell-echo' },
              },
            ],
          },
          topics: [
            {
              id: 'bell-puzzle',
              keywords: ['bell', 'tower', 'inscription', 'reed', 'underhollow'],
              response: 'The inscription below the bell gives a two-part clue: something pale first, then a hollow answer from the river. Ask me for a hint if you want a nudge.',
            },
            {
              id: 'bell-hint',
              keywords: ['hint', 'hints', 'clue', 'stuck', 'help'],
              response: 'I can offer a hint about the bell puzzle.',
              questResponses: [
                {
                  questId: 'eddas-bell-echo',
                  status: 'active',
                  requiresCompletedObjectiveIds: [],
                  requiresIncompleteObjectiveIds: ['read-bell-inscription'],
                  response: 'Hint 1: Look beneath the bell. The brass plate there records the bellwrights’ instructions.',
                },
                {
                  questId: 'eddas-bell-echo',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-bell-inscription'],
                  requiresIncompleteObjectiveIds: ['strike-bell-with-stone'],
                  response: 'Hint 2: “Pale” describes the smooth, striped stone. The cracked bell is the thing named in the inscription.',
                },
                {
                  questId: 'eddas-bell-echo',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-bell-inscription', 'strike-bell-with-stone'],
                  requiresIncompleteObjectiveIds: ['answer-bell-with-reed'],
                  response: 'Hint 3: The reed’s hollow stem fits the river’s “hollow voice.” Use it on the bell after the first note.',
                },
                {
                  questId: 'eddas-bell-echo',
                  status: 'active',
                  requiresCompletedObjectiveIds: [
                    'read-bell-inscription',
                    'strike-bell-with-stone',
                    'answer-bell-with-reed',
                  ],
                  requiresIncompleteObjectiveIds: ['visit-underhollow'],
                  response: 'Hint: The second note opened a stair. Check the available exits for a way down.',
                },
              ],
            },
          ],
          unknownTopicResponse: 'Ask me about the bell, its inscription, or the Underhollow.',
        },
      ],
      exits: [
        { id: 'bridge-to-clearing', fromLocationId: 'glasswater-bridge', toLocationId: 'mossgate-clearing', label: 'South to Mossgate Clearing', direction: 'south' },
        { id: 'bridge-to-tower', fromLocationId: 'glasswater-bridge', toLocationId: 'bell-tower', label: 'East to the Old Bell Tower', direction: 'east' },
        { id: 'bridge-to-reedbank', fromLocationId: 'glasswater-bridge', toLocationId: 'reedbank-stalls', label: 'Southeast to Reedbank Stalls', direction: 'southeast' },
      ],
    },
    {
      id: 'bell-tower',
      name: 'Old Bell Tower',
      mapPosition: { x: 1, y: 0 },
      description:
        'The roofless tower stands quiet above the trees. Its cracked bell hangs still; paths lead west to the clearing and north to the bridge.',
      readables: [
        {
          id: 'tower-bell-inscription',
          label: 'Bell inscription',
          description: 'A short verse is cut into a brass plate beneath the bell.',
          text: 'Pale first, hollow second. Set the stone to the cracked mouth; let the river reed carry the answer. When the tower echoes below, descend.',
        },
      ],
      interactables: [
        {
          id: 'tower-cracked-bell',
          label: 'Cracked bell',
          description: 'A heavy bronze bell hangs from a weathered frame. A long crack runs down its side.',
        },
      ],
      itemUses: [
        {
          id: 'ring-tower-bell-with-stone',
          itemId: 'mossgate-loose-stone',
          targetId: 'tower-cracked-bell',
          response: 'You strike the cracked bell with the smooth stone. A low, uneven note rolls through the tower.',
          repeatResponse: 'You strike the bell again. Its low note echoes through the stonework.',
        },
        {
          id: 'answer-tower-bell-with-reed',
          itemId: 'glasswater-reed',
          targetId: 'tower-cracked-bell',
          response: 'You lay the hollow reed against the bell’s crack and tap it with the stone. A clear second note sounds; a narrow stair opens beneath the bell.',
          repeatResponse: 'The reed shapes the bell’s second note again. A soft echo rises from the open stair below.',
          requiresInteractionIds: ['ring-tower-bell-with-stone'],
          requiresInteractionMessage: 'The bell gives a dull click. Its first note is still missing; the inscription says pale first.',
        },
      ],
      exits: [
        { id: 'tower-to-clearing', fromLocationId: 'bell-tower', toLocationId: 'mossgate-clearing', label: 'West to Mossgate Clearing', direction: 'west' },
        { id: 'tower-to-bridge', fromLocationId: 'bell-tower', toLocationId: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north' },
        {
          id: 'tower-to-underhollow',
          fromLocationId: 'bell-tower',
          toLocationId: 'bell-underhollow',
          label: 'Down the stair',
          direction: 'down',
          requiredInteractionId: 'answer-tower-bell-with-reed',
        },
      ],
    },
    {
      id: 'bell-underhollow',
      name: 'The Underhollow',
      mapPosition: { x: 1, y: -1 },
      description: 'A low stone chamber rests beneath the tower. The bell’s second note hums in the walls; a dry stair leads back up.',
      readables: [
        {
          id: 'underhollow-bellwright-ledger',
          label: 'Bellwright’s ledger',
          description: 'A narrow slate ledger is tucked into a niche beside the stair.',
          text: 'The lower chamber was our tuning room. We steadied the cracked bell with the pale stone, then laid a hollow reed across its fracture. When the tower answered with a second note, the stair was safe to open.',
        },
      ],
      exits: [
        {
          id: 'underhollow-to-tower',
          fromLocationId: 'bell-underhollow',
          toLocationId: 'bell-tower',
          label: 'Up to the Old Bell Tower',
          direction: 'up',
        },
      ],
    },
    {
      id: 'reedbank-stalls',
      name: 'Reedbank Stalls',
      mapPosition: { x: 1, y: 2 },
      description: 'A row of canvas awnings faces the river. The air smells of waxed rope and lamp oil; the bridge leads west.',
      npcs: [
        {
          id: 'sella-reedbank-merchant',
          name: 'Sella',
          description: 'A careful trader sorts travel goods into a neat row beneath a green awning.',
          greeting: 'Welcome to Reedbank. Look over the goods, and ask if you need the price explained.',
          topics: [
            {
              id: 'reedbank-wares',
              keywords: ['wares', 'goods', 'shop', 'prices', 'price'],
              response: 'The lantern is eight moss marks; the waxed cord is five. Each traveler has their own allotment.',
            },
          ],
          unknownTopicResponse: 'Ask me about the wares or use the shop command to browse.',
          shop: {
            listings: [
              {
                id: 'reedbank-brass-lantern',
                item: {
                  id: 'item-reedbank-brass-lantern',
                  label: 'Brass lantern',
                  description: 'A compact brass lantern with a sliding shutter and a soot-dark wick.',
                },
                price: 8,
              },
              {
                id: 'reedbank-waxed-cord',
                item: {
                  id: 'item-reedbank-waxed-cord',
                  label: 'Waxed cord',
                  description: 'A coil of tough linen cord sealed with beeswax against damp.',
                },
                price: 5,
              },
            ],
          },
        },
      ],
      exits: [
        { id: 'reedbank-to-bridge', fromLocationId: 'reedbank-stalls', toLocationId: 'glasswater-bridge', label: 'Northwest to Glasswater Bridge', direction: 'northwest' },
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
