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
          description: 'A path keeper stands beside the weathered marker, watching the northern trail.',
          greeting: 'The north bridge is open. The marker points east toward the western approach to the Old Bell Tower.',
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
          greeting: 'The practice sentinel clicks into a ready stance.',
          topics: [],
          unknownTopicResponse: 'The sentinel answers with a wooden click.',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        {
          id: 'mossgate-practice-mauler',
          name: 'Practice Mauler',
          description: 'A weighted wooden sparring dummy pivots slowly, telegraphing each broad, heavy swing.',
          greeting: 'The practice mauler raises both padded arms, then begins a slow wind-up.',
          topics: [],
          unknownTopicResponse: 'The mauler creaks as its arms begin to swing.',
          combatProfile: { maxHealth: 6, attackDamage: 2, style: 'heavy' },
        },
        {
          id: 'mossgate-practice-guardian',
          name: 'Practice Guardian',
          description: 'A broad wooden figure keeps a round shield angled toward the trail, guarding its center.',
          greeting: 'The practice guardian settles behind its shield.',
          topics: [],
          unknownTopicResponse: 'The guardian answers with a firm tap of wood against wood.',
          combatProfile: { maxHealth: 6, attackDamage: 1, style: 'guardian', defense: 1 },
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
      mapPosition: { x: -2, y: 0 },
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
        { id: 'bridge-under-to-west-reach', fromLocationId: 'glasswater-bridge', toLocationId: 'glasswater-west-reach', label: 'West along Glasswater River', direction: 'west', fromStateId: 'under' },
        { id: 'bridge-under-to-east-reach', fromLocationId: 'glasswater-bridge', toLocationId: 'glasswater-east-reach', label: 'East along Glasswater River', direction: 'east', fromStateId: 'under' },
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
      description: 'The opened door reveals a narrow hallway cut through the bedrock beneath the tower. At its far end, an old stone arch is sealed shut; a cold draft slips through a hairline crack, hinting at passages beyond.',
      interactables: [
        {
          id: 'service-hall-sealed-arch',
          label: 'Sealed stone arch',
          description: 'The arch is blocked by a fitted stone slab with no handle or visible keyhole. It cannot be opened from this side.',
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
          description: 'A careful trader sorts travel goods into a neat row beneath a green awning.',
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
      mapPosition: { x: -1, y: 1 },
      description: 'A narrow dirt track passes beneath arching ferns. Fresh boot prints cross the damp earth.',
      exits: [
        { id: 'fernshade-road-to-stillwater-path', fromLocationId: 'fernshade-road', toLocationId: 'stillwater-path', label: 'South toward Willowshade Track', direction: 'south', roadId: 'fernshade-road' },
        { id: 'fernshade-road-to-fork', fromLocationId: 'fernshade-road', toLocationId: 'fernshade-fork', label: 'West to Fernshade Fork', direction: 'west', roadId: 'fernshade-road' },
      ],
    },
    {
      id: 'fernshade-fork',
      name: 'Fernshade Fork',
      mapPosition: { x: -2, y: 1 },
      description: 'The track opens into a small fern-ringed clearing. Fernshade Road runs east toward Willowshade Track.',
      exits: [
        { id: 'fernshade-fork-to-road', fromLocationId: 'fernshade-fork', toLocationId: 'fernshade-road', label: 'East along Fernshade Road', direction: 'east', roadId: 'fernshade-road' },
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
      description: 'A raised patch of ground overlooks a broad bed of reeds. Bracken Road runs east through Bracken Mile toward Mossgate.',
      exits: [
        { id: 'sedgewatch-to-mile', fromLocationId: 'sedgewatch', toLocationId: 'bracken-mile', label: 'East along Bracken Road', direction: 'east', roadId: 'bracken-road' },
      ],
    },
    {
      id: 'willowrest-inn',
      name: 'Willowrest Inn',
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
      mapPosition: { x: -1, y: 0 },
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
      mapPosition: { x: 0, y: 1 },
      description: 'The northbound road narrows along a low stone embankment. Mossgate Clearing lies south; Glasswater Bridge lies north.',
      exits: [
        { id: 'glasswater-approach-to-clearing', fromLocationId: 'glasswater-approach', toLocationId: 'mossgate-clearing', label: 'South to Mossgate Clearing', direction: 'south', roadId: 'glasswater-road' },
        { id: 'glasswater-approach-to-bridge', fromLocationId: 'glasswater-approach', toLocationId: 'glasswater-bridge', label: 'North to Glasswater Bridge', direction: 'north', roadId: 'glasswater-road' },
      ],
    },
    {
      id: 'bellwarden-track',
      name: 'Bellwarden Track',
      mapPosition: { x: 1, y: 0 },
      description: 'A grassy track skirts the old clearing stones. It runs east to the tower’s western approach and west to Mossgate.',
      exits: [
        { id: 'bellwarden-track-to-clearing', fromLocationId: 'bellwarden-track', toLocationId: 'mossgate-clearing', label: 'West to Mossgate Clearing', direction: 'west', roadId: 'bellwarden-road' },
        { id: 'bellwarden-track-to-tower-west', fromLocationId: 'bellwarden-track', toLocationId: 'bell-tower-west', label: 'East to West of Old Bell Tower', direction: 'east', roadId: 'bellwarden-road' },
      ],
    },
    {
      id: 'reedbank-road',
      name: 'Reedbank Road',
      mapPosition: { x: 0, y: 3 },
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
        { id: 'glasswater-west-reach-to-bridge-under', fromLocationId: 'glasswater-west-reach', toLocationId: 'glasswater-bridge', label: 'East beneath Glasswater Bridge', direction: 'east', toStateId: 'under' },
        { id: 'glasswater-west-reach-to-willow-reach', fromLocationId: 'glasswater-west-reach', toLocationId: 'glasswater-willow-reach', label: 'West along Glasswater River', direction: 'west' },
      ],
    },
    {
      id: 'glasswater-east-reach',
      name: 'Glasswater East Reach',
      mapPosition: { x: 1, y: 2, terrain: 'river', visibleWhenUnvisited: true },
      description: 'The Glasswater current emerges from beneath the bridge and continues east.',
      exits: [
        { id: 'glasswater-east-reach-to-bridge-under', fromLocationId: 'glasswater-east-reach', toLocationId: 'glasswater-bridge', label: 'West beneath Glasswater Bridge', direction: 'west', toStateId: 'under' },
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
