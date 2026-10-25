import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type LocationDefinition,
  type WorldPackDraft,
  type WorldPackDraftInput,
} from '@mudd/contracts';

const draft = {
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
  locations: [
    {
      id: 'mossgate-clearing',
      name: 'Mossgate Clearing',
      mapPosition: { x: 0, y: 0 },
      description:
        'A circle of pale stones breaks through the moss. Roads leave north toward Glasswater Bridge and west toward Stillwater Fountain. A weathered marker points east toward the western approach to the Old Bell Tower.',
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
                response: 'Read the marker, follow it to the tower’s western approach, enter the Old Bell Tower, and come back to tell me what you found.',
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
      exits: [
        { id: 'clearing-to-stillwater-path', fromLocationId: 'mossgate-clearing', toLocationId: 'stillwater-path', label: 'West along Willowshade Track', direction: 'west', roadId: 'willowshade-track' },
        { id: 'clearing-to-glasswater-road', fromLocationId: 'mossgate-clearing', toLocationId: 'glasswater-approach', label: 'North along Glasswater Road', direction: 'north', roadId: 'glasswater-road' },
        { id: 'clearing-to-bellwarden-track', fromLocationId: 'mossgate-clearing', toLocationId: 'bellwarden-track', label: 'East along Bellwarden Road', direction: 'east', roadId: 'bellwarden-road' },
        { id: 'clearing-to-bracken-road', fromLocationId: 'mossgate-clearing', toLocationId: 'bracken-road', label: 'South along Bracken Road', direction: 'south', roadId: 'bracken-road' },
      ],
    },
    {
      id: 'bell-tower-west',
      name: 'West of Old Bell Tower',
      mapPosition: { x: 2, y: 0 },
      description:
        'A worn track meets the western foot of the Old Bell Tower. Its low entrance stands to the east beneath the cracked bell’s frame; Bellwarden Road leads west toward Mossgate Clearing.',
      exits: [
        { id: 'bell-tower-west-to-bellwarden-track', fromLocationId: 'bell-tower-west', toLocationId: 'bellwarden-track', label: 'West along Bellwarden Road', direction: 'west', roadId: 'bellwarden-road' },
        { id: 'bell-tower-west-to-tower', fromLocationId: 'bell-tower-west', toLocationId: 'bell-tower', label: 'East into the Old Bell Tower', direction: 'east' },
      ],
    },
    {
      id: 'stillwater-fountain',
      name: 'Stillwater Fountain',
      mapPosition: { x: -2, y: 0, terrain: 'cobblestone' },
      description: 'A low stone court opens beneath willow branches. In its middle, a clear fountain spills into a shallow round basin, its steady water carrying the quiet of the grove. A track leads east toward Mossgate Clearing.',
      interactables: [
        {
          id: 'stillwater-fountain-basin',
          label: 'Stone fountain',
          description: 'Water wells from a carved stone bowl and runs through a narrow channel into the moss.',
          roomDescription: 'The fountain stands at the center of the court, its water bright against the dark stone.',
        },
      ],
      exits: [
        { id: 'fountain-to-stillwater-path', fromLocationId: 'stillwater-fountain', toLocationId: 'stillwater-path', label: 'East along Willowshade Track', direction: 'east', roadId: 'willowshade-track' },
      ],
    },
    {
      id: 'glasswater-bridge',
      name: 'Glasswater Bridge',
      mapPosition: { x: 0, y: 2 },
      defaultStateId: 'on',
      states: [
        { id: 'on' },
        {
          id: 'under',
          name: 'Under Glasswater Bridge',
          description: 'The Glasswater current passes beneath the stone arches. The bridge deck rumbles overhead as the river runs east and west.',
        },
      ],
      description:
        'A low stone bridge crosses clear water. Reeds stir below it. Glasswater Road leads south toward Mossgate Clearing, and Reedbank Road continues north toward the stalls.',
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
      exits: [
        { id: 'bridge-to-glasswater-road', fromLocationId: 'glasswater-bridge', toLocationId: 'glasswater-approach', label: 'South along Glasswater Road', direction: 'south', fromStateId: 'on', roadId: 'glasswater-road' },
        { id: 'bridge-to-reedbank-road', fromLocationId: 'glasswater-bridge', toLocationId: 'reedbank-road', label: 'North along Reedbank Road', direction: 'north', fromStateId: 'on', roadId: 'reedbank-road' },
        { id: 'bridge-under-to-west-reach', fromLocationId: 'glasswater-bridge', toLocationId: 'glasswater-west-reach', label: 'West along Glasswater River', direction: 'west', fromStateId: 'under', mapLineGapAtLocationId: 'glasswater-bridge' },
        { id: 'bridge-under-to-east-reach', fromLocationId: 'glasswater-bridge', toLocationId: 'glasswater-east-reach', label: 'East along Glasswater River', direction: 'east', fromStateId: 'under', mapLineGapAtLocationId: 'glasswater-bridge' },
      ],
    },
    {
      id: 'bell-tower',
      name: 'Old Bell Tower',
      mapPosition: { x: 4, y: 0, terrain: 'building' },
      requiredVisitedLocationId: 'bell-tower-west',
      description:
        'The tower’s shadowed ground floor is empty except for a narrow stone stair that winds up toward the bell. The western entrance opens onto the tower’s outer approach.',
      exits: [
        { id: 'tower-to-west-approach', fromLocationId: 'bell-tower', toLocationId: 'bell-tower-west', label: 'West to West of Old Bell Tower', direction: 'west' },
        { id: 'tower-to-belfry', fromLocationId: 'bell-tower', toLocationId: 'bell-tower-belfry', label: 'Up to the belfry', direction: 'up' },
      ],
    },
    {
      id: 'bell-tower-belfry',
      name: 'Old Bell Tower Belfry',
      mapAreaId: 'bell-tower',
      mapPosition: { x: 0, y: 0, z: 1, terrain: 'building' },
      requiredVisitedLocationId: 'bell-tower',
      description:
        'The stair opens into the belfry. A cracked bronze bell hangs from its weathered frame, its long fracture visible beneath a brass inscription plate.',
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
      exits: [
        { id: 'belfry-to-tower', fromLocationId: 'bell-tower-belfry', toLocationId: 'bell-tower', label: 'Down to the tower floor', direction: 'down' },
        {
          id: 'tower-to-underhollow',
          fromLocationId: 'bell-tower-belfry',
          toLocationId: 'bell-underhollow',
          label: 'Down into the Underhollow',
          direction: 'down',
          requiredInteractionId: 'answer-tower-bell-with-reed',
        },
      ],
    },
    {
      id: 'bell-underhollow',
      name: 'The Underhollow',
      mapAreaId: 'bell-tower',
      mapPosition: { x: 1, y: 0, z: -1, terrain: 'building' },
      description: 'A low stone chamber rests beneath the tower. The bell’s second note hums in the walls. A dry stair leads back up to the belfry, and a locked iron door is set into the eastern wall.',
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
      exits: [
        {
          id: 'underhollow-to-belfry',
          fromLocationId: 'bell-underhollow',
          toLocationId: 'bell-tower-belfry',
          label: 'Up to the belfry',
          direction: 'up',
        },
        {
          id: 'underhollow-to-service-hall',
          fromLocationId: 'bell-underhollow',
          toLocationId: 'bell-tower-service-hall',
          label: 'East through the iron door',
          direction: 'east',
          requiredInteractionId: 'unlock-underhollow-door-with-key',
        },
      ],
    },
    {
      id: 'bell-tower-service-hall',
      name: 'Bell Tower Service Hall',
      mapAreaId: 'bell-tower',
      mapPosition: { x: 2, y: 0, z: -1, terrain: 'building' },
      description: 'The opened door reveals a narrow hallway cut through the bedrock beneath the tower. At its far end, an old stone arch is sealed by a bronze lock worked into the lintel. A cold draft slips through the arch, carrying the smell of rain-wet stone and a faint scratching from below.',
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
      exits: [
        {
          id: 'service-hall-to-underhollow',
          fromLocationId: 'bell-tower-service-hall',
          toLocationId: 'bell-underhollow',
          label: 'West back to the Underhollow',
          direction: 'west',
        },
        {
          id: 'service-hall-to-undercrypt-entry',
          fromLocationId: 'bell-tower-service-hall',
          toLocationId: 'undercrypt-entry-passage',
          label: 'East into the undercrypt',
          direction: 'east',
          requiredInteractionId: 'open-service-hall-arch-with-key',
        },
      ],
    },
    {
      id: 'undercrypt-entry-passage',
      name: 'Undercrypt Entry Passage',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 3, y: 0, z: 0, terrain: 'building' },
      description: 'The stone arch opens into a low entry passage. Scratches in the dust lead north toward a wider corridor; the service hall waits behind you.',
      exits: [
        {
          id: 'undercrypt-entry-to-service-hall',
          fromLocationId: 'undercrypt-entry-passage',
          toLocationId: 'bell-tower-service-hall',
          label: 'West back to the service hall',
          direction: 'west',
        },
        {
          id: 'undercrypt-entry-to-rattle-run',
          fromLocationId: 'undercrypt-entry-passage',
          toLocationId: 'undercrypt-rattle-run',
          label: 'North into the maze',
          direction: 'north',
        },
      ],
    },
    {
      id: 'undercrypt-echo-gallery',
      name: 'Echo Gallery',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 2, y: 2, z: 0, terrain: 'building' },
      description: 'A concealed side gallery branches west from the Crossway. A shallow bowl sits beneath a split bronze pipe, and a barred door blocks the way north. A pale stone and a hollow reed rest in a niche beside the entrance.',
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
      exits: [
        {
          id: 'echo-gallery-to-crossway',
          fromLocationId: 'undercrypt-echo-gallery',
          toLocationId: 'undercrypt-crossway',
          label: 'East back to the Crossway',
          direction: 'east',
        },
        {
          id: 'echo-gallery-to-west-passage',
          fromLocationId: 'undercrypt-echo-gallery',
          toLocationId: 'undercrypt-west-passage',
          label: 'North through the raised bar into a hidden passage',
          direction: 'north',
          requiredInteractionId: 'send-first-echo',
        },
      ],
    },
    {
      id: 'undercrypt-rattle-run',
      name: 'Rattle Run',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 3, y: 1, z: 0, terrain: 'building' },
      description: 'A long corridor carries the sound of loose chain links along its ceiling. Small, deep tracks cross the dust and vanish toward the junction to the north.',
      exits: [
        {
          id: 'rattle-run-to-entry-passage',
          fromLocationId: 'undercrypt-rattle-run',
          toLocationId: 'undercrypt-entry-passage',
          label: 'South back to the entry passage',
          direction: 'south',
        },
        {
          id: 'rattle-run-to-crossway',
          fromLocationId: 'undercrypt-rattle-run',
          toLocationId: 'undercrypt-crossway',
          label: 'North to the Crossway',
          direction: 'north',
          roadId: 'undercrypt-east-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-crossway',
      name: 'The Crossway',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 3, y: 2, z: 0, terrain: 'building' },
      description: 'The corridor widens into a junction. A dark passage runs west, while the more heavily tracked route turns east. The rattle from behind you is joined by a slower scrape somewhere ahead.',
      exits: [
        {
          id: 'crossway-to-rattle-run',
          fromLocationId: 'undercrypt-crossway',
          toLocationId: 'undercrypt-rattle-run',
          label: 'South back to Rattle Run',
          direction: 'south',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'crossway-to-echo-gallery',
          fromLocationId: 'undercrypt-crossway',
          toLocationId: 'undercrypt-echo-gallery',
          label: 'West into the concealed Echo Gallery',
          direction: 'west',
        },
        {
          id: 'crossway-to-east-bend',
          fromLocationId: 'undercrypt-crossway',
          toLocationId: 'undercrypt-east-bend',
          label: 'East into the upper corridors',
          direction: 'east',
          roadId: 'undercrypt-east-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-west-bend',
      name: 'West Bend',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 3, y: 3, z: 0, terrain: 'building' },
      description: 'A narrow corridor bends around a thick stone pier. Claw marks stripe the lower blocks; the route continues north and west.',
      exits: [
        {
          id: 'west-bend-to-west-passage',
          fromLocationId: 'undercrypt-west-bend',
          toLocationId: 'undercrypt-west-passage',
          label: 'West along the hidden passage',
          direction: 'west',
          roadId: 'undercrypt-west-rat-run',
        },
        {
          id: 'west-bend-to-west-turn',
          fromLocationId: 'undercrypt-west-bend',
          toLocationId: 'undercrypt-west-turn',
          label: 'North toward the joined corridors',
          direction: 'north',
          roadId: 'undercrypt-west-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-west-passage',
      name: 'West Passage',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 2, y: 3, z: 0, terrain: 'building' },
      description: 'A straight, close-walled corridor runs north before joining the wider route. The same small tracks cross and recross the dust.',
      exits: [
        {
          id: 'west-passage-to-echo-gallery',
          fromLocationId: 'undercrypt-west-passage',
          toLocationId: 'undercrypt-echo-gallery',
          label: 'South back to the Echo Gallery',
          direction: 'south',
        },
        {
          id: 'west-passage-to-west-bend',
          fromLocationId: 'undercrypt-west-passage',
          toLocationId: 'undercrypt-west-bend',
          label: 'East to West Bend',
          direction: 'east',
          roadId: 'undercrypt-west-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-east-bend',
      name: 'East Bend',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 4, y: 2, z: 0, terrain: 'building' },
      description: 'The eastern corridor turns around a square column. A smear of dark fur catches on one edge, and a narrow passage leads north.',
      exits: [
        {
          id: 'east-bend-to-crossway',
          fromLocationId: 'undercrypt-east-bend',
          toLocationId: 'undercrypt-crossway',
          label: 'West back to the Crossway',
          direction: 'west',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'east-bend-to-east-passage',
          fromLocationId: 'undercrypt-east-bend',
          toLocationId: 'undercrypt-east-passage',
          label: 'North along the east passage',
          direction: 'north',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'east-bend-to-drainage-niche',
          fromLocationId: 'undercrypt-east-bend',
          toLocationId: 'undercrypt-drainage-niche',
          label: 'East into the drainage niche',
          direction: 'east',
        },
      ],
    },
    {
      id: 'undercrypt-drainage-niche',
      name: 'Drainage Niche',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 5, y: 2, z: 0, terrain: 'building' },
      description: 'The corridor ends at a dry drain carved with a row of shallow circles. Dust has gathered in each one, except for a single smooth groove.',
      exits: [
        {
          id: 'drainage-niche-to-east-bend',
          fromLocationId: 'undercrypt-drainage-niche',
          toLocationId: 'undercrypt-east-bend',
          label: 'West back to East Bend',
          direction: 'west',
        },
      ],
    },
    {
      id: 'undercrypt-east-passage',
      name: 'East Passage',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 4, y: 3, z: 0, terrain: 'building' },
      description: 'A narrow run continues east toward a close-walled turn. Scratches in the dust overlap until they form a beaten track.',
      exits: [
        {
          id: 'east-passage-to-east-bend',
          fromLocationId: 'undercrypt-east-passage',
          toLocationId: 'undercrypt-east-bend',
          label: 'South back to East Bend',
          direction: 'south',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'east-passage-to-east-crawl',
          fromLocationId: 'undercrypt-east-passage',
          toLocationId: 'undercrypt-east-crawl',
          label: 'East through the low crawl',
          direction: 'east',
          roadId: 'undercrypt-east-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-east-crawl',
      name: 'East Crawl',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 5, y: 3, z: 0, terrain: 'building' },
      description: 'The passage narrows until the stone nearly meets your shoulders. Scraping sounds echo from the short climb north.',
      exits: [
        {
          id: 'east-crawl-to-east-passage',
          fromLocationId: 'undercrypt-east-crawl',
          toLocationId: 'undercrypt-east-passage',
          label: 'West back to East Passage',
          direction: 'west',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'east-crawl-to-east-turn',
          fromLocationId: 'undercrypt-east-crawl',
          toLocationId: 'undercrypt-east-turn',
          label: 'North through the low turn',
          direction: 'north',
          roadId: 'undercrypt-east-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-east-turn',
      name: 'East Turn',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 5, y: 4, z: 0, terrain: 'building' },
      description: 'The low passage opens into a square landing where two stone routes meet. The northern door is still ahead.',
      exits: [
        {
          id: 'east-turn-to-east-crawl',
          fromLocationId: 'undercrypt-east-turn',
          toLocationId: 'undercrypt-east-crawl',
          label: 'South back through the crawl',
          direction: 'south',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'east-turn-to-north-junction',
          fromLocationId: 'undercrypt-east-turn',
          toLocationId: 'undercrypt-north-junction',
          label: 'West to the North Junction',
          direction: 'west',
          roadId: 'undercrypt-east-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-west-turn',
      name: 'West Turn',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 3, y: 4, z: 0, terrain: 'building' },
      description: 'The western passage climbs to a broad stone turning. From here the route joins the northern junction.',
      exits: [
        {
          id: 'west-turn-to-west-bend',
          fromLocationId: 'undercrypt-west-turn',
          toLocationId: 'undercrypt-west-bend',
          label: 'South back to West Bend',
          direction: 'south',
          roadId: 'undercrypt-west-rat-run',
        },
        {
          id: 'west-turn-to-north-junction',
          fromLocationId: 'undercrypt-west-turn',
          toLocationId: 'undercrypt-north-junction',
          label: 'East to the North Junction',
          direction: 'east',
          roadId: 'undercrypt-west-rat-run',
        },
      ],
    },
    {
      id: 'undercrypt-north-junction',
      name: 'North Junction',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 4, y: 4, z: 0, terrain: 'building' },
      description: 'The two maze routes meet beneath a cracked stone lintel. Beyond it, water laps softly against a door to the north.',
      exits: [
        {
          id: 'north-junction-to-west-turn',
          fromLocationId: 'undercrypt-north-junction',
          toLocationId: 'undercrypt-west-turn',
          label: 'West back through the low corridors',
          direction: 'west',
          roadId: 'undercrypt-west-rat-run',
        },
        {
          id: 'north-junction-to-east-turn',
          fromLocationId: 'undercrypt-north-junction',
          toLocationId: 'undercrypt-east-turn',
          label: 'East back through the low crawl',
          direction: 'east',
          roadId: 'undercrypt-east-rat-run',
        },
        {
          id: 'north-junction-to-flooded-archive',
          fromLocationId: 'undercrypt-north-junction',
          toLocationId: 'undercrypt-flooded-archive',
          label: 'North into the Flooded Archive',
          direction: 'north',
        },
      ],
    },
    {
      id: 'undercrypt-flooded-archive',
      name: 'Flooded Archive',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 4, y: 5, z: 0, terrain: 'building' },
      description: 'Ankle-deep water covers the archive floor. A dry balance scale stands beside a water-filled plinth, and a stone door waits to the east. A silver weight and a mirrored shard lie on a shelf above the waterline.',
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
      exits: [
        {
          id: 'flooded-archive-to-north-junction',
          fromLocationId: 'undercrypt-flooded-archive',
          toLocationId: 'undercrypt-north-junction',
          label: 'South back to the North Junction',
          direction: 'south',
        },
        {
          id: 'flooded-archive-to-reliquary-approach',
          fromLocationId: 'undercrypt-flooded-archive',
          toLocationId: 'undercrypt-reliquary-approach',
          label: 'East through the stone door into the final passage',
          direction: 'east',
          requiredInteractionId: 'set-archive-reflection',
        },
      ],
    },
    {
      id: 'undercrypt-reliquary-approach',
      name: 'Reliquary Approach',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 5, y: 5, z: 0, terrain: 'building' },
      description: 'The passage beyond the archive door is dry and quiet. A single stone doorway opens east into a small chamber where something metal catches the light.',
      exits: [
        {
          id: 'reliquary-approach-to-archive',
          fromLocationId: 'undercrypt-reliquary-approach',
          toLocationId: 'undercrypt-flooded-archive',
          label: 'West back to the Flooded Archive',
          direction: 'west',
        },
        {
          id: 'reliquary-approach-to-reliquary',
          fromLocationId: 'undercrypt-reliquary-approach',
          toLocationId: 'undercrypt-bellwright-reliquary',
          label: 'East into the Bellwright Reliquary',
          direction: 'east',
        },
      ],
    },
    {
      id: 'undercrypt-bellwright-reliquary',
      name: 'Bellwright Reliquary',
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 6, y: 5, z: 0, terrain: 'building' },
      description: 'The reliquary is quiet and dry. A black stone plinth stands at its center, holding a finely made sword whose narrow fuller catches the light like a distant bell tone.',
      takeables: [
        {
          id: 'undercrypt-echoedge',
          label: 'Echoedge',
          description: 'A balanced steel sword forged by the bellwrights. Its resonant fuller carries a clean, steady note; the blade grants +2 attack power when equipped.',
          roomDescription: 'Echoedge rests on the black stone plinth.',
          equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
        },
      ],
      exits: [
        {
          id: 'reliquary-to-reliquary-approach',
          fromLocationId: 'undercrypt-bellwright-reliquary',
          toLocationId: 'undercrypt-reliquary-approach',
          label: 'West back to the final passage',
          direction: 'west',
        },
      ],
    },
    {
      id: 'reedbank-stalls',
      name: 'Reedbank Stalls',
      mapPosition: { x: 0, y: 4 },
      description: 'A row of canvas awnings faces the river. The air smells of waxed rope and lamp oil; Reedbank Road runs south toward Glasswater Bridge, and a lane leads east to Willowrest Inn.',
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
      exits: [
        { id: 'reedbank-to-reedbank-road', fromLocationId: 'reedbank-stalls', toLocationId: 'reedbank-road', label: 'South along Reedbank Road', direction: 'south', roadId: 'reedbank-road' },
        { id: 'reedbank-to-willowrest-lane', fromLocationId: 'reedbank-stalls', toLocationId: 'willowrest-lane', label: 'East along Willowrest Lane', direction: 'east', roadId: 'willowrest-lane' },
      ],
    },
    {
      id: 'fernshade-road',
      name: 'Fernshade Road',
      mapPosition: { x: -1, y: 1, terrain: 'dirt' },
      description: 'A narrow dirt track passes beneath arching ferns. Fresh boot prints cross the damp earth.',
      exits: [
        { id: 'fernshade-road-to-stillwater-path', fromLocationId: 'fernshade-road', toLocationId: 'stillwater-path', label: 'South toward Willowshade Track', direction: 'south', roadId: 'fernshade-road' },
        { id: 'fernshade-road-to-fork', fromLocationId: 'fernshade-road', toLocationId: 'fernshade-fork', label: 'West to Fernshade Fork', direction: 'west', roadId: 'fernshade-road' },
      ],
    },
    {
      id: 'fernshade-fork',
      name: 'Fernshade Fork',
      mapPosition: { x: -2, y: 1, terrain: 'forest' },
      description: 'The track opens into a small fern-ringed clearing. A low cottage stands to the west; Fernshade Road runs east toward Willowshade Track.',
      exits: [
        { id: 'fernshade-fork-to-road', fromLocationId: 'fernshade-fork', toLocationId: 'fernshade-road', label: 'East along Fernshade Road', direction: 'east', roadId: 'fernshade-road' },
        { id: 'fernshade-fork-to-cottage', fromLocationId: 'fernshade-fork', toLocationId: 'fernshade-cottage', label: 'West to Fernshade Cottage', direction: 'west' },
      ],
    },
    {
      id: 'fernshade-cottage',
      name: 'Fernshade Cottage',
      mapPosition: { x: -3, y: 1, terrain: 'building' },
      description: 'A low cottage of pale timber and woven fern panels sits in the quiet clearing. Its worn front door faces east toward Fernshade Fork.',
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
                id: 'nim-ask-baskets',
                label: 'Ask about the baskets',
                response: 'Fernshade fronds bend without splitting once they have dried by the hearth.',
                progressFlagId: 'nim-asked-baskets',
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
      exits: [
        { id: 'fernshade-cottage-to-fork', fromLocationId: 'fernshade-cottage', toLocationId: 'fernshade-fork', label: 'East to Fernshade Fork', direction: 'east' },
      ],
    },
    {
      id: 'bracken-road',
      name: 'Bracken Road',
      mapPosition: { x: 0, y: -1 },
      description: 'A rutted road descends through bracken and wet grass. Mossgate Clearing lies north; Bracken Road continues west toward Sedgewatch.',
      exits: [
        { id: 'bracken-road-to-clearing', fromLocationId: 'bracken-road', toLocationId: 'mossgate-clearing', label: 'North to Mossgate Clearing', direction: 'north', roadId: 'bracken-road' },
        { id: 'bracken-road-to-mile', fromLocationId: 'bracken-road', toLocationId: 'bracken-mile', label: 'West along Bracken Road', direction: 'west', roadId: 'bracken-road' },
      ],
    },
    {
      id: 'bracken-mile',
      name: 'Bracken Mile',
      mapPosition: { x: -1, y: -1 },
      description: 'A milepost leans beside the road, its lettering softened by rain. The road continues west through the reeds to Sedgewatch.',
      readables: [
        {
          id: 'bracken-milepost',
          label: 'Leaning milepost',
          description: 'A rain-worn milepost stands at the edge of the road.',
          text: 'SEDGEWATCH — ONE MILE',
        },
      ],
      exits: [
        { id: 'bracken-mile-to-road', fromLocationId: 'bracken-mile', toLocationId: 'bracken-road', label: 'East along Bracken Road', direction: 'east', roadId: 'bracken-road' },
        { id: 'bracken-mile-to-sedgewatch', fromLocationId: 'bracken-mile', toLocationId: 'sedgewatch', label: 'West to Sedgewatch', direction: 'west', roadId: 'bracken-road' },
      ],
    },
    {
      id: 'sedgewatch',
      name: 'Sedgewatch',
      mapPosition: { x: -2, y: -1 },
      description: 'A raised patch of ground overlooks a broad bed of reeds. A reed-thatched cottage stands to the west; Bracken Road runs east through Bracken Mile toward Mossgate.',
      exits: [
        { id: 'sedgewatch-to-mile', fromLocationId: 'sedgewatch', toLocationId: 'bracken-mile', label: 'East along Bracken Road', direction: 'east', roadId: 'bracken-road' },
        { id: 'sedgewatch-to-cottage', fromLocationId: 'sedgewatch', toLocationId: 'sedgewatch-cottage', label: 'West to Sedgewatch Cottage', direction: 'west' },
      ],
    },
    {
      id: 'sedgewatch-cottage',
      name: 'Sedgewatch Cottage',
      mapPosition: { x: -3, y: -1, terrain: 'building' },
      description: 'A modest reed-thatch home stands on firmer ground beside the wetland. Its east-facing door opens toward Sedgewatch.',
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
                id: 'talla-ask-gauge',
                label: 'Ask about the waterline gauge',
                response: 'It is carved into the bridge pier beneath the arch. The high notch tells me whether the river is close to the reed beds.',
                progressFlagId: 'talla-asked-gauge',
              },
              {
                id: 'accept-sedgewatch-waterline',
                label: 'I will check the bridge',
                response: 'Read the stone waterline gauge beneath Glasswater Bridge, then come back and report what it says.',
                progressFlagId: 'talla-accepted-waterline',
                questAction: { type: 'accept', questId: 'sedgewatch-waterline' },
              },
              {
                id: 'report-sedgewatch-waterline',
                label: 'Report the waterline',
                response: 'Only the lowest notch is wet. The middle and high marks are dry. Take five moss marks for the trouble.',
                progressFlagId: 'talla-reported-waterline',
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
      exits: [
        { id: 'sedgewatch-cottage-to-sedgewatch', fromLocationId: 'sedgewatch-cottage', toLocationId: 'sedgewatch', label: 'East to Sedgewatch', direction: 'east' },
      ],
    },
    {
      id: 'willowrest-inn',
      name: 'Willowrest Inn',
      safeResting: true,
      mapPosition: { x: 2, y: 4, terrain: 'building' },
      description: 'A warm timber inn stands at the edge of Reedbank, its windows bright against the river mist. A painted sign promises a full night’s rest for five moss marks. A lamp-lit lane leads west to Reedbank Stalls.',
      inn: {
        id: 'willowrest-inn-service',
        name: 'Willowrest Inn',
        restPrice: 5,
      },
      exits: [
        { id: 'willowrest-to-lane', fromLocationId: 'willowrest-inn', toLocationId: 'willowrest-lane', label: 'West along Willowrest Lane', direction: 'west', roadId: 'willowrest-lane' },
      ],
    },
    {
      id: 'stillwater-path',
      name: 'Willowshade Track',
      mapPosition: { x: -1, y: 0, terrain: 'forest' },
      description: 'Willow branches arch over a narrow track between the fountain court and Mossgate Clearing.',
      exits: [
        { id: 'stillwater-path-to-clearing', fromLocationId: 'stillwater-path', toLocationId: 'mossgate-clearing', label: 'East to Mossgate Clearing', direction: 'east', roadId: 'willowshade-track' },
        { id: 'stillwater-path-to-fountain', fromLocationId: 'stillwater-path', toLocationId: 'stillwater-fountain', label: 'West to Stillwater Fountain', direction: 'west', roadId: 'willowshade-track' },
        { id: 'stillwater-path-to-fernshade-road', fromLocationId: 'stillwater-path', toLocationId: 'fernshade-road', label: 'North along Fernshade Road', direction: 'north', roadId: 'fernshade-road' },
      ],
    },
    {
      id: 'glasswater-approach',
      name: 'Glasswater Approach',
      mapPosition: { x: 0, y: 1, terrain: 'gravel' },
      description: 'The northbound road narrows along a low stone embankment. Mossgate Clearing lies south; Glasswater Bridge lies north.',
      exits: [
        { id: 'glasswater-approach-to-clearing', fromLocationId: 'glasswater-approach', toLocationId: 'mossgate-clearing', label: 'South to Mossgate Clearing', direction: 'south', roadId: 'glasswater-road' },
        { id: 'glasswater-approach-to-bridge', fromLocationId: 'glasswater-approach', toLocationId: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north', roadId: 'glasswater-road' },
      ],
    },
    {
      id: 'bellwarden-track',
      name: 'Bellwarden Track',
      mapPosition: { x: 1, y: 0, terrain: 'pasture' },
      description: 'A grassy track skirts the old clearing stones. It runs east to the tower’s western approach and west to Mossgate.',
      exits: [
        { id: 'bellwarden-track-to-clearing', fromLocationId: 'bellwarden-track', toLocationId: 'mossgate-clearing', label: 'West to Mossgate Clearing', direction: 'west', roadId: 'bellwarden-road' },
        { id: 'bellwarden-track-to-tower-west', fromLocationId: 'bellwarden-track', toLocationId: 'bell-tower-west', label: 'East to West of Old Bell Tower', direction: 'east', roadId: 'bellwarden-road' },
      ],
    },
    {
      id: 'reedbank-road',
      name: 'Reedbank Road',
      mapPosition: { x: 0, y: 3, terrain: 'dirt' },
      description: 'The packed earth road follows a broad bed of reeds. It runs north toward Reedbank Stalls and south toward Glasswater Bridge.',
      exits: [
        { id: 'reedbank-road-to-bridge', fromLocationId: 'reedbank-road', toLocationId: 'glasswater-bridge', label: 'South to Glasswater Bridge', direction: 'south', roadId: 'reedbank-road' },
        { id: 'reedbank-road-to-stalls', fromLocationId: 'reedbank-road', toLocationId: 'reedbank-stalls', label: 'North to Reedbank Stalls', direction: 'north', roadId: 'reedbank-road' },
      ],
    },
    {
      id: 'willowrest-lane',
      name: 'Willowrest Lane',
      mapPosition: { x: 1, y: 4 },
      description: 'A lamp-lit lane runs east from Reedbank Stalls to the timber inn, with canvas awnings behind you.',
      exits: [
        { id: 'willowrest-lane-to-reedbank', fromLocationId: 'willowrest-lane', toLocationId: 'reedbank-stalls', label: 'West to Reedbank Stalls', direction: 'west', roadId: 'willowrest-lane' },
        { id: 'willowrest-lane-to-inn', fromLocationId: 'willowrest-lane', toLocationId: 'willowrest-inn', label: 'East to Willowrest Inn', direction: 'east', roadId: 'willowrest-lane' },
      ],
    },
    {
      id: 'glasswater-west-reach',
      name: 'Glasswater West Reach',
      mapPosition: { x: -1, y: 2, terrain: 'river', visibleWhenUnvisited: true },
      description: 'The river current runs west from beneath Glasswater Bridge.',
      exits: [
        { id: 'glasswater-west-reach-to-bridge-under', fromLocationId: 'glasswater-west-reach', toLocationId: 'glasswater-bridge', label: 'East beneath Glasswater Bridge', direction: 'east', toStateId: 'under', mapLineGapAtLocationId: 'glasswater-bridge' },
        { id: 'glasswater-west-reach-to-willow-reach', fromLocationId: 'glasswater-west-reach', toLocationId: 'glasswater-willow-reach', label: 'West along Glasswater River', direction: 'west' },
      ],
    },
    {
      id: 'glasswater-east-reach',
      name: 'Glasswater East Reach',
      mapPosition: { x: 1, y: 2, terrain: 'river', visibleWhenUnvisited: true },
      description: 'The Glasswater current emerges from beneath the bridge and continues east.',
      exits: [
        { id: 'glasswater-east-reach-to-bridge-under', fromLocationId: 'glasswater-east-reach', toLocationId: 'glasswater-bridge', label: 'West beneath Glasswater Bridge', direction: 'west', toStateId: 'under', mapLineGapAtLocationId: 'glasswater-bridge' },
      ],
    },
    {
      id: 'glasswater-willow-reach',
      name: 'Glasswater Willow Reach',
      mapPosition: { x: -2, y: 2, terrain: 'river', visibleWhenUnvisited: true },
      description: 'Clear water slips past the willow roots along the western bank.',
      exits: [
        { id: 'glasswater-willow-reach-to-west-reach', fromLocationId: 'glasswater-willow-reach', toLocationId: 'glasswater-west-reach', label: 'East along Glasswater River', direction: 'east' },
        { id: 'glasswater-willow-reach-to-far-reach', fromLocationId: 'glasswater-willow-reach', toLocationId: 'glasswater-far-reach', label: 'West along Glasswater River', direction: 'west' },
      ],
    },
    {
      id: 'glasswater-far-reach',
      name: 'Glasswater Far Reach',
      mapPosition: { x: -3, y: 2, terrain: 'river', visibleWhenUnvisited: true },
      description: 'The current continues west beyond the mapped stretch.',
      exits: [
        { id: 'glasswater-far-reach-to-willow-reach', fromLocationId: 'glasswater-far-reach', toLocationId: 'glasswater-willow-reach', label: 'East along Glasswater River', direction: 'east' },
      ],
    },
  ],
  locationGroups: [
    {
      id: 'clearwater',
      name: 'Clearwater',
      type: 'settlement',
      description: 'A small riverside settlement of market awnings, a timber inn, and a low stone bridge.',
      memberships: [
        { locationId: 'glasswater-bridge', isPrimary: true },
        { locationId: 'reedbank-stalls', isPrimary: true },
        { locationId: 'willowrest-inn', isPrimary: true },
      ],
      metadata: { settlementKind: 'riverside-trading-town' },
    },
    {
      id: 'glasswater-river',
      name: 'Glasswater River',
      type: 'river',
      description: 'The navigable watercourse running beneath the bridge and along its banks.',
      memberships: [
        { locationId: 'glasswater-bridge' },
        { locationId: 'glasswater-west-reach' },
        { locationId: 'glasswater-east-reach' },
        { locationId: 'glasswater-willow-reach' },
        { locationId: 'glasswater-far-reach' },
      ],
    },
    {
      id: 'kings-road',
      name: "King's Road",
      type: 'road',
      description: 'The established route from Glasswater Approach across the bridge to Reedbank.',
      memberships: [
        { locationId: 'glasswater-approach', isPrimary: true },
        { locationId: 'glasswater-bridge' },
        { locationId: 'reedbank-road', isPrimary: true },
        { locationId: 'reedbank-stalls' },
        { locationId: 'willowrest-lane', isPrimary: true },
      ],
      metadata: { routeClass: 'main-road' },
    },
  ],
  roads: [
    {
      id: 'willowshade-track',
      name: 'Willowshade Track',
      locationIds: ['mossgate-clearing', 'stillwater-path', 'stillwater-fountain'],
      encounterChancePercent: 5,
      encounters: [
        {
          id: 'willowshade-track-stray',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'glasswater-road',
      name: 'Glasswater Road',
      locationIds: ['mossgate-clearing', 'glasswater-approach', 'glasswater-bridge'],
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'glasswater-road-thief',
          name: 'Roadside Thief',
          combatProfile: { maxHealth: 5, attackDamage: 1, style: 'heavy' },
        },
      ],
    },
    {
      id: 'bellwarden-road',
      name: 'Bellwarden Road',
      locationIds: ['mossgate-clearing', 'bellwarden-track', 'bell-tower-west'],
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwarden-road-hound',
          name: 'Track Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'reedbank-road',
      name: 'Reedbank Road',
      locationIds: ['glasswater-bridge', 'reedbank-road', 'reedbank-stalls'],
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'reedbank-road-raider',
          name: 'Reedbank Raider',
          combatProfile: { maxHealth: 5, attackDamage: 1, style: 'heavy' },
        },
      ],
    },
    {
      id: 'willowrest-lane',
      name: 'Willowrest Lane',
      locationIds: ['reedbank-stalls', 'willowrest-lane', 'willowrest-inn'],
      encounterChancePercent: 5,
      encounters: [
        {
          id: 'willowrest-lane-stray',
          name: 'Lantern Fox',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'fernshade-road',
      name: 'Fernshade Road',
      locationIds: ['stillwater-path', 'fernshade-road', 'fernshade-fork'],
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'fernshade-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'bracken-road',
      name: 'Bracken Road',
      locationIds: ['mossgate-clearing', 'bracken-road', 'bracken-mile', 'sedgewatch'],
      encounterChancePercent: 20,
      encounters: [
        {
          id: 'bracken-road-trail-thief',
          name: 'Trail Thief',
          combatProfile: { maxHealth: 5, attackDamage: 1, style: 'heavy' },
        },
      ],
    },
    {
      id: 'undercrypt-west-rat-run',
      name: 'Undercrypt West Corridors',
      locationIds: [
        'undercrypt-west-passage',
        'undercrypt-west-bend',
        'undercrypt-west-turn',
        'undercrypt-north-junction',
      ],
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'undercrypt-west-giant-rat',
          name: 'Giant Rat',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'undercrypt-east-rat-run',
      name: 'Undercrypt East Corridors',
      locationIds: [
        'undercrypt-rattle-run',
        'undercrypt-crossway',
        'undercrypt-east-bend',
        'undercrypt-east-passage',
        'undercrypt-east-crawl',
        'undercrypt-east-turn',
        'undercrypt-north-junction',
      ],
      encounterChancePercent: 15,
      encounters: [
        {
          id: 'undercrypt-east-giant-rat',
          name: 'Giant Rat',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
  ],
} satisfies WorldPackDraftInput;

export const demoWorld: WorldPackDraft = WorldPackDraftSchema.parse(draft);
const graphErrors = validateDraftWorldGraph(demoWorld);
if (graphErrors.length > 0) throw new Error(`Invalid demo world: ${graphErrors.join('; ')}`);

export const DEMO_WORLD_INSTANCE_ID = 'mudd-demo-instance';
export const STARTING_LOCATION_ID = 'mossgate-clearing';

export function getLocation(locationId: string): LocationDefinition | undefined {
  return demoWorld.locations.find((location) => location.id === locationId);
}
