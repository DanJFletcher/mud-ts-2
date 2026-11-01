import {
  WorldPackDraftSchema,
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
  composeWorldPackDraft,
  validateDraftWorldGraph,
  type LocationDefinition,
  type WorldPackDraft,
  type WorldPackContent,
} from '@mudd/contracts';
import locations from './map/locations.json' with { type: 'json' };
import locationGroups from './map/location-groups.json' with { type: 'json' };
import roads from './map/roads.json' with { type: 'json' };

const content = {
  formatVersion: 1,
  packId: 'mudd.first-steps',
  packVersion: '1.1.1',
  displayName: 'The Waystone Path',
  respawn: { locationId: 'stillwater-fountain' },
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
      summary: 'Read the marker, follow its path to the tower’s western approach, visit the Old Bell Tower, and report back to Mara.',
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
          locationId: 'bell-tower-belfry',
        },
        {
          id: 'strike-bell-with-stone',
          label: 'Sound the bell’s first note',
          type: 'perform-interaction',
          interactionId: 'ring-tower-bell-with-stone',
          locationId: 'bell-tower-belfry',
        },
        {
          id: 'answer-bell-with-reed',
          label: 'Find the bell’s second note',
          type: 'perform-interaction',
          interactionId: 'answer-tower-bell-with-reed',
          locationId: 'bell-tower-belfry',
        },
        {
          id: 'visit-underhollow',
          label: 'Follow the echo below',
          type: 'visit-location',
          locationId: 'bell-underhollow',
        },
      ],
    },
    {
      id: 'mossgate-cooperative-drill',
      version: '1.0.0',
      scope: 'party',
      title: 'Mossgate Cooperative Drill',
      summary: 'Work together to defeat the Practice Sentinel at Mossgate Clearing.',
      giverNpcId: 'mara-waykeeper',
      turnInNpcId: 'mara-waykeeper',
      objectives: [
        {
          id: 'defeat-practice-sentinel',
          label: 'Defeat the Practice Sentinel together',
          type: 'defeat-npc',
          npcId: 'mossgate-training-sentinel',
          requiredCount: 1,
        },
      ],
    },
    {
      id: 'sedgewatch-waterline',
      version: '1.0.0',
      scope: 'character',
      title: 'The Waterline Mark',
      summary: 'Read the gauge beneath Glasswater Bridge and report whether the high mark is wet.',
      giverNpcId: 'talla-sedgewatch',
      turnInNpcId: 'talla-sedgewatch',
      reward: { currencyId: 'moss-mark', amount: 5 },
      objectives: [
        {
          id: 'read-waterline',
          label: 'Read the waterline gauge beneath Glasswater Bridge',
          type: 'read-object',
          objectId: 'glasswater-waterline-gauge',
          locationId: 'glasswater-bridge',
        },
      ],
    },
  ],
  locationContent: {
    'mossgate-clearing': {
      readables: [
        {
          id: 'mossgate-marker',
          label: 'Weathered marker',
          description: 'A weathered stone marker, its carved arrow worn but still pointing east toward the western approach to the Old Bell Tower.',
          text: 'OLD BELL TOWER — EAST',
        },
      ],
      takeables: [
        {
          id: 'mossgate-loose-stone',
          label: 'Loose stone',
          description: 'A smooth, palm-sized stone with a pale stripe running through it.',
          roomDescription: 'One loose stone bears a pale stripe.',
          questBound: true,
        },
      ],
      npcs: [
        {
          id: 'mara-waykeeper',
          name: 'Mara',
          description: 'Mara stands beside the weathered marker, one hand resting on its rain-smoothed edge as she watches the northern trail.',
          activityDescription: 'watching the northern trail',
          greeting: 'I keep the paths around here. The north bridge is open, and the marker points east toward the western approach to the Old Bell Tower.',
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
                response: 'You read the marker. Its arrow points east to the tower’s western approach. Follow the path there, enter the tower, then come back and tell me what you found.',
              },
              {
                questId: 'mara-wayfinding',
                status: 'active',
                requiresCompletedObjectiveIds: ['read-marker', 'visit-bell-tower'],
                requiresIncompleteObjectiveIds: [],
                response: 'You reached the Old Bell Tower by its western approach. Tell me what you found when you are ready to report.',
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
                response: 'The marker points east toward the Old Bell Tower’s western approach. Its direction is still true.',
                progressFlagId: 'mara-asked-marker',
              },
              {
                id: 'ask-marker-bearing',
                label: 'How do you know the marker still points true?',
                response: 'I check its carved line against the road as it rises east. The tower approach follows that bearing.',
                progressFlagId: 'mara-explained-marker-bearing',
                requiresProgressFlagIds: ['mara-asked-marker'],
              },
              {
                id: 'ask-tower',
                label: 'Ask about the bell tower',
                response: 'The bell has been silent for years. I still hope to hear it ring again.',
                progressFlagId: 'mara-asked-tower',
                requiresProgressFlagIds: ['mara-asked-marker'],
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
                response: 'Read the marker, follow it to the tower’s western approach, enter the Old Bell Tower, and come back to tell me what you found.',
                progressFlagId: 'mara-accepted-wayfinding',
                hideAfterProgressFlagIds: ['mara-asked-marker'],
                questAction: { type: 'accept', questId: 'mara-wayfinding' },
              },
              {
                id: 'report-wayfinding-quest',
                label: 'I visited the Old Bell Tower',
                response: 'You followed the marker all the way to the tower. Thank you for bringing back the story of the path.',
                progressFlagId: 'mara-reported-wayfinding',
                hideAfterProgressFlagIds: ['mara-asked-marker'],
                questAction: { type: 'turn-in', questId: 'mara-wayfinding' },
              },
            ],
          },
          topics: [
            {
              id: 'marker',
              keywords: ['marker', 'sign', 'east'],
              response: 'The marker is old, but the carving still points east toward the western approach to the Old Bell Tower.',
              questResponses: [
                {
                  questId: 'mara-wayfinding',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-marker'],
                  requiresIncompleteObjectiveIds: [],
                  response: 'You’ve read the marker now. Its arrow points east to the tower’s western approach.',
                },
                {
                  questId: 'mara-wayfinding',
                  status: 'completed',
                  requiresCompletedObjectiveIds: ['read-marker'],
                  requiresIncompleteObjectiveIds: [],
                  response: 'You read the marker and followed its direction through the western approach into the Old Bell Tower.',
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
            'The marker still points east toward the western approach to the Old Bell Tower.',
          ],
          roomChatReactions: [
            {
              keywords: ['marker', 'sign'],
              response: 'The marker is old, but its arrow still points east toward the tower’s western approach.',
            },
            {
              keywords: ['bell tower', 'tower', 'bell'],
              response: 'The bell has been quiet for years. The Old Bell Tower stands east of here.',
            },
          ],
        },
        {
          id: 'mossgate-training-sentinel',
          name: 'Practice Sentinel',
          description: 'A knee-high wooden sentinel waits beside the trail. Its padded arms lift in a steady, even rhythm.',
          activityDescription: 'lifting its padded arms in a steady rhythm',
          greeting: 'The practice sentinel clicks into a ready stance.',
          topics: [],
          unknownTopicResponse: 'The sentinel answers with a wooden click.',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        {
          id: 'mossgate-practice-mauler',
          name: 'Practice Mauler',
          description: 'A weighted wooden sparring dummy pivots slowly, telegraphing each broad, heavy swing.',
          activityDescription: 'pivoting slowly through a broad sparring swing',
          greeting: 'The practice mauler raises both padded arms, then begins a slow wind-up.',
          topics: [],
          unknownTopicResponse: 'The mauler creaks as its arms begin to swing.',
          combatProfile: { maxHealth: 6, attackDamage: 2, style: 'heavy' },
        },
        {
          id: 'mossgate-practice-guardian',
          name: 'Practice Guardian',
          description: 'A broad wooden figure keeps a round shield angled toward the trail, guarding its center.',
          activityDescription: 'holding a round shield over its center',
          greeting: 'The practice guardian settles behind its shield.',
          topics: [],
          unknownTopicResponse: 'The guardian answers with a firm tap of wood against wood.',
          combatProfile: { maxHealth: 6, attackDamage: 1, style: 'guardian', defense: 1 },
        },
        {
          id: 'mossgate-wandering-villager',
          name: 'Wandering Villager',
          description: 'A villager strolls by, hands clasped behind their back.',
          activityDescription: 'walking by with hands clasped behind their back',
          greeting: 'The villager offers a quiet nod.',
          topics: [],
          unknownTopicResponse: 'The villager smiles and continues on their way.',
          movement: {
            strategy: 'wander',
            intervalMs: 60_000,
            stayChancePercent: 20,
            allowedLocationIds: ['mossgate-clearing', 'glasswater-approach', 'glasswater-bridge'],
            narrative: {
              arrival: 'A villager enters from the {direction}, hands clasped behind their back.',
              departure: 'A villager leaves toward the {direction}, hands clasped behind their back.',
            },
          },
        },
        {
          id: 'mossgate-patrolling-guard',
          name: 'Patrolling Guard',
          description: 'A town guard marches through, surveying the surroundings.',
          activityDescription: 'patrolling with eyes on the surroundings',
          greeting: 'The guard gives a brief nod before continuing the patrol.',
          topics: [],
          unknownTopicResponse: 'The guard remains focused on the patrol.',
          movement: {
            strategy: 'route',
            intervalMs: 60_000,
            routeLocationIds: [
              'mossgate-clearing',
              'bellwarden-track',
              'bell-tower-west',
              'bellwarden-track',
            ],
            narrative: {
              arrival: 'A town guard enters from the {direction}, eyes alert.',
              departure: 'The guard leaves toward the {direction}, eyes alert.',
            },
          },
        },
      ],
    },
    'stillwater-fountain': {
      interactables: [
        {
          id: 'stillwater-fountain-basin',
          label: 'Stone fountain',
          description: 'Water wells from a carved stone bowl and runs through a narrow channel into the moss.',
          roomDescription: 'The fountain stands at the center of the court, its water bright against the dark stone.',
        },
      ],
    },
    'glasswater-bridge': {
      defaultStateId: 'on',
      states: [
        { id: 'on' },
        {
          id: 'under',
          name: 'Under Glasswater Bridge',
          description: 'The Glasswater current passes beneath the stone arches. The bridge deck rumbles overhead as the river runs east and west.',
        },
      ],
      readables: [
        {
          id: 'glasswater-waterline-gauge',
          label: 'Stone waterline gauge',
          description: 'Three shallow notches are cut into the bridge pier beneath the arch.',
          text: 'The lowest notch is wet. The middle and high notches are dry.',
        },
      ],
      takeables: [
        {
          id: 'glasswater-reed',
          label: 'Hollow reed',
          description: 'A dry green reed with a hollow stem, light enough to bend but not break.',
          roomDescription: 'A hollow reed rests between the bridge stones.',
          questBound: true,
        },
      ],
      npcs: [
        {
          id: 'edda-bellwright',
          name: 'Edda',
          description: 'Edda studies a grease-stained ledger, tracing one line with a soot-darkened finger.',
          activityDescription: 'studying a grease-stained ledger',
          greeting: 'I repair bells. This one may still know the way below.',
          dialogue: {
            prompt: 'The bell was meant to open a tuning room below. I want to know whether it can still sound its proper note. Ask me for a hint if you want one.',
            questResponses: [
              {
                questId: 'eddas-bell-echo',
                status: 'active',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: ['read-bell-inscription'],
                response: 'Take Glasswater Road south from the bridge to Mossgate Clearing, then follow Bellwarden Road east to the tower’s western approach. Enter the tower and climb its inner stair to the bell and inscription.',
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
                id: 'edda-who-are-you',
                label: 'Who are you?',
                response: 'I’m Edda, a bellwright. I listen for the parts of a note that a ledger cannot explain.',
                progressFlagId: 'edda-asked-who',
                hideAfterProgressFlagIds: ['edda-asked-tuning'],
              },
              {
                id: 'edda-ask-tuning',
                label: 'What do you listen for when tuning a bell?',
                response: 'A clear note should settle instead of rattling against its frame. I compare what I hear with the old records before I decide what needs adjusting.',
                progressFlagId: 'edda-asked-tuning',
              },
              {
                id: 'edda-ask-records',
                label: 'How do the old records help?',
                response: 'They show what the bell sounded like before it fell silent. A difference gives me something to test, not an explanation by itself.',
                progressFlagId: 'edda-asked-records',
                requiresProgressFlagIds: ['edda-asked-tuning'],
              },
              {
                id: 'accept-bell-echo',
                label: 'Investigate the bell puzzle',
                response: 'The old inscription is still legible. It speaks of something pale and a hollow voice from the river; I found a reed near the bridge.',
                progressFlagId: 'edda-accepted-bell-echo',
                hideAfterProgressFlagIds: ['edda-asked-tuning'],
                questAction: { type: 'accept', questId: 'eddas-bell-echo' },
              },
              {
                id: 'report-bell-echo',
                label: 'I found the Underhollow',
                response: 'The two notes opened the way below. I found the Underhollow.',
                progressFlagId: 'edda-reported-bell-echo',
                hideAfterProgressFlagIds: ['edda-asked-tuning'],
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
                  response: 'Hint 1: Climb the tower’s inner stair to the belfry. A brass plate beneath the bell records the bellwrights’ instructions.',
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
    },
    'bell-tower': {
      requiredVisitedLocationId: 'bell-tower-west',
    },
    'bell-tower-belfry': {
      requiredVisitedLocationId: 'bell-tower',
      takeables: [
        {
          id: 'bellwright-underhollow-key',
          label: 'Bellwright’s iron key',
          description: 'A narrow black iron key worn smooth at the bow. Its teeth are cut for an old lock below the tower.',
          roomDescription: 'A black iron key rests in a notch behind the bell’s frame.',
          questBound: true,
        },
      ],
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
          requiredVisitedLocationId: 'bell-tower-west',
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
    },
    'bell-underhollow': {
      readables: [
        {
          id: 'underhollow-bellwright-ledger',
          label: 'Bellwright’s ledger',
          description: 'A narrow slate ledger is tucked into a niche beside the stair.',
          text: 'The lower chamber was our tuning room. We steadied the cracked bell with the pale stone, then laid a hollow reed across its fracture. When the tower answered with a second note, the stair was safe to open.',
        },
      ],
      interactables: [
        {
          id: 'underhollow-iron-door',
          label: 'Iron door',
          description: 'A heavy iron door is set into the eastern wall. A narrow keyhole is worn smooth around its edge; the lock has not turned in years.',
        },
      ],
      itemUses: [
        {
          id: 'unlock-underhollow-door-with-key',
          itemId: 'bellwright-underhollow-key',
          targetId: 'underhollow-iron-door',
          response: 'The bellwright’s key turns with a dry click. The iron door groans open onto a narrow stone hallway.',
          repeatResponse: 'The iron door stands open. The key turns freely in its lock.',
        },
      ],
    },
    'bell-tower-service-hall': {
      interactables: [
        {
          id: 'service-hall-sealed-arch',
          label: 'Sealed stone arch',
          description: 'A bronze keyhole is set into the arch’s lintel. The stone door has no handle on this side.',
        },
      ],
      itemUses: [
        {
          id: 'open-service-hall-arch-with-key',
          itemId: 'bellwright-underhollow-key',
          targetId: 'service-hall-sealed-arch',
          response: 'The bellwright’s key turns in the bronze lock. The stone arch lifts with a groan, opening onto a dark gallery.',
          repeatResponse: 'The stone arch stands open. Beyond it, the undercrypt descends into the hill.',
        },
      ],
    },
    'undercrypt-echo-gallery': {
      readables: [
        {
          id: 'echo-gallery-rubbing',
          label: 'Stone rubbing',
          description: 'A clear inscription beside the barred door.',
          text: 'THE LOW NOTE MUST REST BEFORE THE HOLLOW NOTE CAN TRAVEL. Set the pale stone in its bowl first; then lay the reed across the split pipe. The second note will lift the northern bar.',
        },
      ],
      takeables: [
        {
          id: 'undercrypt-pale-stone',
          label: 'Pale tuning stone',
          description: 'A smooth, palm-sized stone that fits the shallow bowl in the gallery.',
          roomDescription: 'A pale tuning stone rests in the niche.',
          questBound: true,
        },
        {
          id: 'undercrypt-hollow-reed',
          label: 'Undercrypt reed',
          description: 'A dry hollow reed, cut to fit the split bronze pipe.',
          roomDescription: 'A dry hollow reed lies beside the pale stone.',
          questBound: true,
        },
      ],
      interactables: [
        {
          id: 'echo-gallery-stone-bowl',
          label: 'Stone bowl',
          description: 'The bowl bears a pale circular mark. The tuning stone fits its hollow exactly.',
        },
        {
          id: 'echo-gallery-split-pipe',
          label: 'Split bronze pipe',
          description: 'A narrow split in the pipe is shaped to hold a hollow reed.',
        },
      ],
      itemUses: [
        {
          id: 'anchor-echo-bowl',
          itemId: 'undercrypt-pale-stone',
          targetId: 'echo-gallery-stone-bowl',
          response: 'The pale stone settles into the bowl. A low tone passes through the floor, and the bronze pipe begins to hum.',
          repeatResponse: 'The pale stone is already seated in the bowl.',
        },
        {
          id: 'send-first-echo',
          itemId: 'undercrypt-hollow-reed',
          targetId: 'echo-gallery-split-pipe',
          response: 'The reed carries a clear note through the pipe. The northern bar rises into the ceiling.',
          repeatResponse: 'The northern bar is already raised.',
          requiresInteractionIds: ['anchor-echo-bowl'],
          requiresInteractionMessage: 'The pipe gives no answer yet. The inscription says the low note must rest first.',
        },
      ],
    },
    'undercrypt-flooded-archive': {
      readables: [
        {
          id: 'archive-ledger-clue',
          label: 'Archive ledger',
          description: 'A waxed page fixed above the waterline.',
          text: 'THE DRY PAN ANSWERS TO WEIGHT; THE DROWNED PAN ANSWERS TO REFLECTION. Set the silver weight on the dry scale first, then lay the mirror shard face-up on the water plinth. Balance before reflection opens the eastern door.',
        },
      ],
      takeables: [
        {
          id: 'undercrypt-silver-weight',
          label: 'Silver balance weight',
          description: 'A small silver weight, shaped to sit in the dry scale’s round pan.',
          roomDescription: 'A silver balance weight rests on the shelf.',
          questBound: true,
        },
        {
          id: 'undercrypt-mirror-shard',
          label: 'Mirror shard',
          description: 'A polished shard with a flat back and a bright, uncracked face.',
          roomDescription: 'A mirror shard catches the light above the waterline.',
          questBound: true,
        },
        {
          id: 'undercrypt-bellwright-seal',
          label: 'Bellwright’s silver seal',
          description: 'A silver maker’s seal bearing the mark of the old bellwrights.',
          roomDescription: 'A silver seal sits in a dry niche beside the archive door.',
        },
        {
          id: 'undercrypt-bellwright-vest',
          label: 'Bellwright’s scale vest',
          description: 'A close-fitting vest of small bronze scales, still sound despite its age. It grants +1 defense when equipped.',
          roomDescription: 'A bronze-scaled vest hangs from a peg above the waterline.',
          equipment: { slot: 'armor', attackBonus: 0, defenseBonus: 1 },
        },
      ],
      interactables: [
        {
          id: 'archive-dry-scale',
          label: 'Dry balance scale',
          description: 'The empty pan has a round hollow sized for the silver weight.',
        },
        {
          id: 'archive-water-plinth',
          label: 'Water plinth',
          description: 'A flat stone surface sits just beneath the water, with a groove for a mirror shard.',
        },
      ],
      itemUses: [
        {
          id: 'set-archive-weight',
          itemId: 'undercrypt-silver-weight',
          targetId: 'archive-dry-scale',
          response: 'The silver weight settles into the dry pan. A counterweight clicks behind the eastern door.',
          repeatResponse: 'The silver weight is already set on the dry scale.',
        },
        {
          id: 'set-archive-reflection',
          itemId: 'undercrypt-mirror-shard',
          targetId: 'archive-water-plinth',
          response: 'The shard rests face-up on the plinth. Light ripples across the ceiling, and the eastern stone door opens.',
          repeatResponse: 'The eastern stone door stands open.',
          requiresInteractionIds: ['set-archive-weight'],
          requiresInteractionMessage: 'The water plinth remains dark. The ledger says the dry scale must be balanced first.',
        },
      ],
    },
    'undercrypt-bellwright-reliquary': {
      takeables: [
        {
          id: 'undercrypt-echoedge',
          label: 'Echoedge',
          description: 'A balanced steel sword forged by the bellwrights. Its resonant fuller carries a clean, steady note; the blade grants +2 attack power when equipped.',
          roomDescription: 'Echoedge rests on the black stone plinth.',
          equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
        },
      ],
    },
    'reedbank-stalls': {
      npcs: [
        {
          id: 'sella-reedbank-merchant',
          name: 'Sella',
          description: 'Sella sorts travel goods into a neat row beneath a green awning.',
          activityDescription: 'sorting travel goods beneath a green awning',
          greeting: 'Welcome to Reedbank. Look over the goods, and ask if you need the price explained.',
          topics: [
            {
              id: 'reedbank-wares',
              keywords: ['wares', 'goods', 'shop', 'prices', 'price'],
              response: 'The lantern is eight moss marks and the waxed cord is five. I also have a practice blade and padded vest for five marks each, plus a small healing draught for three. Each traveler has their own allotment.',
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
              {
                id: 'reedbank-practice-blade',
                item: {
                  id: 'item-reedbank-practice-blade',
                  label: 'Practice blade',
                  description: 'A balanced ashwood blade wrapped in soft leather for safe sparring.',
                  equipment: { slot: 'weapon', attackBonus: 1, defenseBonus: 0 },
                },
                price: 5,
              },
              {
                id: 'reedbank-padded-vest',
                item: {
                  id: 'item-reedbank-padded-vest',
                  label: 'Padded vest',
                  description: 'A quilted vest that softens the force of practice blows.',
                  equipment: { slot: 'armor', attackBonus: 0, defenseBonus: 1 },
                },
                price: 5,
              },
              {
                id: 'reedbank-healing-draught',
                item: {
                  id: 'item-reedbank-healing-draught',
                  label: 'Small healing draught',
                  description: 'A stoppered green glass vial of herbal tonic. Drink it during or between encounters to recover up to 3 health.',
                  consumable: { effect: 'heal', amount: 3 },
                },
                price: 3,
              },
            ],
          },
        },
      ],
    },
    'fernshade-cottage': {
      npcs: [
        {
          id: 'nim-fernshade',
          name: 'Nim',
          description: 'Nim sorts long fern fronds beside the cottage hearth, setting the sound ones apart from the brittle.',
          activityDescription: 'sorting fern fronds beside the cottage hearth',
          greeting: 'Mind the drying fronds by the door. They take a full day to soften.',
          dialogue: {
            prompt: 'Nim pauses their work. What would you like to ask?',
            choices: [
              {
                id: 'nim-who-are-you',
                label: 'Who are you?',
                response: 'I’m Nim. I gather and sort fern fronds before weaving them into things people can carry.',
                progressFlagId: 'nim-asked-who',
                hideAfterProgressFlagIds: ['nim-asked-baskets'],
              },
              {
                id: 'nim-what-are-you-doing',
                label: 'What are you doing?',
                response: 'Sorting the fronds by feel. The brittle ones split; the sound ones can be softened by the hearth.',
                progressFlagId: 'nim-asked-work',
                hideAfterProgressFlagIds: ['nim-asked-baskets'],
              },
              {
                id: 'nim-ask-baskets',
                label: 'Ask about the baskets',
                response: 'Fernshade fronds bend without splitting once they have dried by the hearth.',
                progressFlagId: 'nim-asked-baskets',
              },
              {
                id: 'nim-ask-frond-preparation',
                label: 'How do you know when a frond is ready?',
                response: 'It bends around a finger without creasing white or cracking at the edge. If it springs back too sharply, it needs more time by the hearth.',
                progressFlagId: 'nim-explained-frond-preparation',
                requiresProgressFlagIds: ['nim-asked-baskets'],
              },
            ],
          },
          topics: [
            {
              id: 'fern-baskets',
              keywords: ['basket', 'baskets', 'fronds'],
              response: 'I weave the young fern fronds into carrying baskets. The older fronds crack too easily.',
            },
            {
              id: 'fernshade-path',
              keywords: ['path', 'fork', 'road'],
              response: 'The fork outside joins Fernshade Road to the east. Bracken Road is the quicker route back toward the village.',
            },
          ],
          unknownTopicResponse: 'Ask me about the baskets or the paths through the ferns.',
        },
      ],
    },
    'bracken-mile': {
      readables: [
        {
          id: 'bracken-milepost',
          label: 'Leaning milepost',
          description: 'A rain-worn milepost stands at the edge of the road.',
          text: 'SEDGEWATCH — ONE MILE',
        },
      ],
    },
    'sedgewatch-cottage': {
      npcs: [
        {
          id: 'talla-sedgewatch',
          name: 'Talla',
          description: 'Talla ties roof bundles beside a small stone gauge, checking a reed for damp.',
          activityDescription: 'checking a reed bundle for damp',
          greeting: 'I thatch roofs with reeds. The river has been rising, and I need to know whether it has reached the high notch beneath the bridge.',
          dialogue: {
            prompt: 'Talla looks up from the reeds. What would you like to ask?',
            questResponses: [
              {
                questId: 'sedgewatch-waterline',
                status: 'active',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: ['read-waterline'],
                response: 'The gauge is cut into the stone pier beneath Glasswater Bridge. Read the notches, then come back and tell me what is wet.',
              },
              {
                questId: 'sedgewatch-waterline',
                status: 'active',
                requiresCompletedObjectiveIds: ['read-waterline'],
                requiresIncompleteObjectiveIds: [],
                response: 'You found the gauge. Report its marks when you are ready.',
              },
              {
                questId: 'sedgewatch-waterline',
                status: 'completed',
                requiresCompletedObjectiveIds: [],
                requiresIncompleteObjectiveIds: [],
                response: 'Thank you. I can leave the roof bundles where they are; the high mark is still dry.',
              },
            ],
            choices: [
              {
                id: 'talla-who-are-you',
                label: 'Who are you?',
                response: 'I’m Talla. I thatch roofs with reeds and watch the river so the lower beds are not caught by surprise.',
                progressFlagId: 'talla-asked-who',
                hideAfterProgressFlagIds: ['talla-asked-gauge'],
              },
              {
                id: 'talla-what-are-you-doing',
                label: 'What are you doing?',
                response: 'Checking the reed bundles for damp and watching the stone gauge beneath the bridge.',
                progressFlagId: 'talla-asked-work',
                hideAfterProgressFlagIds: ['talla-asked-gauge'],
              },
              {
                id: 'talla-ask-gauge',
                label: 'Ask about the waterline gauge',
                response: 'It is carved into the bridge pier beneath the arch. The high notch tells me whether the river is close to the reed beds.',
                progressFlagId: 'talla-asked-gauge',
              },
              {
                id: 'talla-ask-high-notch',
                label: 'What if the high notch gets wet?',
                response: 'Then I would clear a channel through the clogged sedge before the water reaches the lower beds. That is why I check it early.',
                progressFlagId: 'talla-explained-high-notch',
                requiresProgressFlagIds: ['talla-asked-gauge'],
              },
              {
                id: 'accept-sedgewatch-waterline',
                label: 'I will check the bridge',
                response: 'Read the stone waterline gauge beneath Glasswater Bridge, then come back and report what it says.',
                progressFlagId: 'talla-accepted-waterline',
                hideAfterProgressFlagIds: ['talla-asked-gauge'],
                questAction: { type: 'accept', questId: 'sedgewatch-waterline' },
              },
              {
                id: 'report-sedgewatch-waterline',
                label: 'Report the waterline',
                response: 'Only the lowest notch is wet. The middle and high marks are dry. Take five moss marks for the trouble.',
                progressFlagId: 'talla-reported-waterline',
                hideAfterProgressFlagIds: ['talla-asked-gauge'],
                questCondition: {
                  questId: 'sedgewatch-waterline',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-waterline'],
                  requiresIncompleteObjectiveIds: [],
                },
                questAction: { type: 'turn-in', questId: 'sedgewatch-waterline' },
              },
            ],
          },
          topics: [
            {
              id: 'waterline',
              keywords: ['water', 'river', 'gauge', 'notch'],
              response: 'The stone gauge is beneath Glasswater Bridge. Its high mark tells me whether the reed beds need to be cleared.',
              questResponses: [
                {
                  questId: 'sedgewatch-waterline',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-waterline'],
                  requiresIncompleteObjectiveIds: [],
                  response: 'You have read the gauge. The high notch is the one I was worried about.',
                },
              ],
            },
          ],
          unknownTopicResponse: 'Ask me about the waterline or the roof reeds.',
        },
      ],
    },
    'willowrest-inn': {
      safeResting: true,
      inn: {
        id: 'willowrest-inn-service',
        name: 'Willowrest Inn',
        restPrice: 5,
      },
    },
  },
  roadRules: {
    'willowshade-track': {
      encounterChancePercent: 5,
      encounters: [
        {
          id: 'willowshade-track-stray',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'glasswater-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'glasswater-road-thief',
          name: 'Roadside Thief',
          combatProfile: { maxHealth: 5, attackDamage: 1, style: 'heavy' },
        },
      ],
    },
    'bellwarden-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwarden-road-hound',
          name: 'Track Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'reedbank-road': {
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'reedbank-road-raider',
          name: 'Reedbank Raider',
          combatProfile: { maxHealth: 5, attackDamage: 1, style: 'heavy' },
        },
      ],
    },
    'willowrest-lane': {
      encounterChancePercent: 5,
      encounters: [
        {
          id: 'willowrest-lane-stray',
          name: 'Lantern Fox',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'fernshade-road': {
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'fernshade-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'bracken-road': {
      encounterChancePercent: 20,
      encounters: [
        {
          id: 'bracken-road-trail-thief',
          name: 'Trail Thief',
          combatProfile: { maxHealth: 5, attackDamage: 1, style: 'heavy' },
        },
      ],
    },
    'undercrypt-west-rat-run': {
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'undercrypt-west-giant-rat',
          name: 'Giant Rat',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'undercrypt-east-rat-run': {
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'undercrypt-east-giant-rat',
          name: 'Giant Rat',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
  },
} satisfies WorldPackContent;

export const demoWorld: WorldPackDraft = WorldPackDraftSchema.parse(composeWorldPackDraft({
  locations: WorldLocationsFileSchema.parse(locations),
  locationGroups: WorldLocationGroupsFileSchema.parse(locationGroups),
  roads: WorldRoadsFileSchema.parse(roads),
}, content));
const graphErrors = validateDraftWorldGraph(demoWorld);
if (graphErrors.length > 0) throw new Error(`Invalid demo world: ${graphErrors.join('; ')}`);

export const DEMO_WORLD_INSTANCE_ID = 'mudd-demo-instance';
export const STARTING_LOCATION_ID = 'mossgate-clearing';

export function getLocation(locationId: string): LocationDefinition | undefined {
  return demoWorld.locations.find((location) => location.id === locationId);
}
