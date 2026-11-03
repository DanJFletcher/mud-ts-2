import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices } from '../dialogue.js';
export const bellwoldLandmarks = {
  'bellwold-market-square': {
    npcs: [
      {
        id: 'linnet-reed',
        name: 'Linnet Reed',
        description: 'A villager crosses the square at an easy pace, glancing between the market stalls and the road to the well.',
        activityDescription: 'walking between the market and shared spaces',
        greeting: '“I was headed to the well. Or the square. I’ll know when I get there.”',
        topics: [
          { id: 'town', keywords: ['town', 'bellwold', 'neighbors'], response: '“There is always someone to meet between the square and the well. You learn more by walking than by asking for a grand account.”' },
          { id: 'market', keywords: ['market', 'square', 'stalls'], response: '“The square is busiest early. By noon, half the people have gone off to their work.”' },
          { id: 'people', keywords: ['Seli Tor', 'Aven Rusk', 'Enna Pell'], response: '“Seli keeps cloth in use, Aven keeps the grain tally, and Enna writes down what people agree to do. They each know a different part of the village.”' },
          { id: 'old-bell', keywords: ['seventeen villagers', 'storm warnings', 'old bell history'], response: '“My family says the bell warned of storms. I heard the account of seventeen people disappearing while it rang, but nobody in my family could tell me why.”' },
        ],
        unknownTopicResponse: '“I’m just on an errand. Try the market or the well if you need directions.”',
        dialogue: {
          prompt: '“I was headed to the well. Or the square. I’ll know when I get there.”',
          choices: smallTalkChoices({
            npcId: 'linnet-reed',
            identity: '“I’m Linnet Reed. I run errands around town and usually find someone to talk to along the way.”',
            activity: '“I’m carrying a few things between the square and the well. I have not decided which I’ll reach first.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is small enough that an errand can turn into a conversation, then another errand. I like that about it.”' },
            additionalQuestions: [
              {
                id: 'market-rhythm',
                label: 'When is the square busiest?',
                response: '“Early, when the stalls are opening. By noon most folk have gone to their own work, and the square belongs to whoever still has an errand.”',
              },
              {
                id: 'people-to-ask',
                label: 'Who should I ask about the village?',
                response: '“Seli knows cloth, Aven knows the grain tally, and Enna keeps the public notes. Ask each what they can show you; none of us sees the whole town.”',
              },
            ]
          }),
        },
        movement: {
          strategy: 'wander',
          intervalMs: 60000,
          stayChancePercent: 20,
          allowedLocationIds: [
            'bellwold-market-square',
            'kindly-roof-inn',
            'marrs-general-goods',
            'old-bell-tower-approach',
            'bellwold-south-common',
            'green-mortar',
            'blackwater-forge',
            'bellwold-well-court',
            'bellwold-wattle-row',
            'old-grain-house',
            'bellwold-common-house',
          ],
          narrative: {
            arrival: 'A villager enters from the {direction}, nodding to a familiar face.',
            departure: 'A villager leaves toward the {direction}, carrying on with a town errand.',
          },
        },
      },
      {
        id: 'taren-voss',
        name: 'Taren Voss',
        description: 'A guard in a weathered coat stands near the square’s edge, scanning the road and nearby crossings.',
        activityDescription: 'watching the square and the road',
        greeting: '“Keep the road clear and let people pass. That is most of the work.”',
        topics: [
          { id: 'patrol', keywords: ['patrol', 'watch', 'guard'], response: '“My circuit runs from the tower road through the square and down to the Common House. I check each crossing as I go.”' },
          { id: 'road', keywords: ['road', 'tower', 'crossing'], response: '“The north road is quiet most days. I still walk it; quiet is not the same as watched.”' },
          { id: 'border-law', keywords: ['border', 'Heskar', 'property law'], response: '“The Crown of Heskar keeps rigid borders and strong property laws. My patrol keeps crossings clear; it does not decide where Bellwold’s jurisdiction begins.”' },
          { id: 'other-regions', keywords: ['Merefall League', 'Sareth Cantons', 'Rillward Freeholds', 'Uncrowned Lands'], response: '“The reports describe different authorities: merchant city-states, mountain assemblies, river councils, and communities beyond centralized rule. I guard this circuit, not the whole continent.”' },
        ],
        unknownTopicResponse: '“I’m on patrol. Keep to the marked paths and speak plainly if there’s trouble.”',
        dialogue: {
          prompt: '“Keep the road clear and let people pass. That is most of the work.”',
          choices: smallTalkChoices({
            npcId: 'taren-voss',
            identity: '“Taren Voss. I watch the village roads and crossings.”',
            activity: '“I’m making my circuit through the square and the public lanes. I look for trouble before it reaches someone’s door.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is a working village near a frontier. Most days are quiet, but quiet roads still need watching.”' },
            additionalQuestions: [
              {
                id: 'patrol-route',
                label: 'Where does your patrol go?',
                response: '“From the tower road through the square, down to the Common House and Well Court, then back along the public lanes. I check crossings as I go.”',
                requiresProgressFlagIds: [],
                hideAfterProgressFlagIds: ['taren-voss-asked-about-town'],
              },
              {
                id: 'beyond-the-frontier',
                label: 'What do you hear about places beyond Bellwold?',
                response: '“Reports speak of merchant city-states, mountain assemblies, river councils, and communities with no central ruler. I guard this circuit; I can’t vouch for every report.”',
                requiresProgressFlagIds: ['taren-voss-asked-about-town'],
              },
            ],
            hideInitialChoicesAfterProgressFlagIds: ['taren-voss-asked-about-town']
          }),
        },
        movement: {
          strategy: 'route',
          intervalMs: 60000,
          routeLocationIds: [
            'bellwold-market-square',
            'bellwold-south-common',
            'bellwold-well-court',
            'bellwold-common-house',
            'bellwold-well-court',
            'bellwold-south-common',
            'bellwold-market-square',
            'old-bell-tower-approach',
          ],
          narrative: {
            arrival: 'The guard enters from the {direction}, eyes alert.',
            departure: 'The guard leaves toward the {direction}, continuing the patrol.',
          },
        },
      },
      {
        id: 'orin-vale',
        name: 'Orin Vale',
        description: 'A broad-hatted angler walks with a folded net under one arm, pausing to study the river whenever the road bends near it.',
        activityDescription: 'walking between the market square and the south bridge',
        greeting: '“The river gives no promises. A patient line and a little luck are all I ever had.”',
        topics: [
          { id: 'fishing', keywords: ['fish', 'fishing', 'river', 'rod', 'angling'], response: '“The current under the south bridge still holds bass, carp, and trout. You need a rod to fish from the bridge.”' },
        ],
        unknownTopicResponse: '“I’m headed back toward the bridge. The river is the only thing I know well.”',
        dialogue: {
          prompt: 'Orin turns a worn fishing rod in his hands. “I’ve no use for this old thing now. Would you like it?”',
          choices: [
            ...smallTalkChoices({
              npcId: 'orin-vale',
              identity: '“Orin Vale. I have spent more of my life beside the river than I planned to.”',
              activity: '“I walk between the square and the south bridge, watching the current and checking the line when I can.”',
              town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold suits me. The river is close, and there is usually someone in the square who will share a word.”' },
              additionalQuestions: [
                {
                  id: 'bridge-fish',
                  label: 'What fish live under the bridge?',
                  response: '“Smallmouth bass, carp, and trout. The river gives no promise that any one of them will take your line.”',
                },
                {
                  id: 'fishing-advice',
                  label: 'Any advice for fishing here?',
                  response: '“Watch where the current slows beside the stones. Then be patient. If you rush the line, you’ll only hear the water laugh at you.”',
                },
              ],
              requireInitialChoicesAfterProgressFlagIds: ['received-old-fishing-rod']
            }),
            {
              id: 'accept-old-rod',
              label: 'Accept the old rod',
              response: '“Here you are. The cork is worn, but the line still holds. Cast from the south bridge and wait for a bite.”',
              progressFlagId: 'received-old-fishing-rod',
              itemReward: {
                id: 'old-fishing-rod',
                typeId: 'fishing-rod',
                label: 'old rod',
                description: 'A weathered fishing rod with a worn cork handle and a serviceable length of line.',
                fishingRod: {
                  qualityId: 'old',
                  biteChancePercent: 10,
                  waitSeconds: 10,
                },
              },
            },
          ],
        },
        movement: {
          strategy: 'route',
          intervalMs: 60000,
          routeLocationIds: [
            'bellwold-market-square',
            'bellwold-south-common',
            'bellwold-well-court',
            'bellwold-common-house',
            'bellwold-south-gate',
            'bellwold-southbound-track',
            'bellwold-reedbed-approach',
            'bellwold-river-bridge',
            'bellwold-reedbed-approach',
            'bellwold-southbound-track',
            'bellwold-south-gate',
            'bellwold-common-house',
            'bellwold-well-court',
            'bellwold-south-common',
          ],
          narrative: {
            arrival: 'Orin arrives from the {direction}, glancing toward the river.',
            departure: 'Orin heads {direction}, his folded net tucked beneath one arm.',
          },
        },
      },
    ],
  },
  'bellwold-south-common': {
    readables: [{
        id: 'bellwold-daily-notice', label: 'Bulletin board',
        readAction: { type: 'daily-board', boardId: 'bellwold-notice-board' },
        description: 'A broad plank board holds handwritten notices in uneven rows.',
        text: 'Residents post daily jobs and requests here. Read the bulletin to see current postings and rewards. Accept a posting, then follow its instructions to complete it. New postings appear with each daily refresh.',
      }],
  },
  'bellwold-library': {
    readables: [
      {
        id: 'bellwold-library-shelf-guide',
        label: 'Shelf guide',
        description: 'A hand-lettered guide fixed to the end of a bookcase.',
        text: '“Village notices and copied minutes: left shelf. Field and mill accounts: center shelves. Travel records and maps: right shelf. Ask before removing a bound volume.”',
      },
    ],
    npcs: [
      {
        id: 'mira-dell',
        name: 'Mira Dell',
        description: 'Mira straightens a stack of stitched booklets, then brushes dust from the table.',
        activityDescription: 'sorting pamphlets at the reading table',
        greeting: '“The shelves are open. If you need a particular record, tell me what it concerns.”',
        topics: [
          { id: 'library', keywords: ['library', 'books', 'records'], response: '“Most of these are copies or working notes. I keep the source with the copy when I can, so readers know what they are looking at.”' },
          { id: 'museum', keywords: ['museum', 'collection', 'exhibits'], response: '“The room behind this one holds objects residents have lent or found nearby. Their labels say what is known—and leave blank what is not.”' },
          { id: 'bellwold-history', keywords: ['Bellwold history', 'town history', 'old records'], response: '“There is no complete town chronicle here. We have notices, tallies, and pieces of older accounts. They do not all answer the same questions.”' },
        ],
        unknownTopicResponse: '“Tell me what you are trying to find. I may know which shelf to check.”',
        dialogue: {
          prompt: '“The shelves are open. If you need a particular record, tell me what it concerns.”',
          choices: smallTalkChoices({
            npcId: 'mira-dell',
            identity: '“Mira Dell. I care for the library and help readers find the records they need.”',
            activity: '“I’m sorting pamphlets and putting the copied records back where readers can find them.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold’s past is scattered across notes, tallies, and people’s memories. This library keeps the pieces available without pretending they make one complete story.”' },
            additionalQuestions: [
              {
                id: 'library-shelves',
                label: 'Where should I look for a record?',
                response: '“Notices and minutes are on the left, field and mill accounts in the center, and travel records and maps on the right. Ask before taking a bound volume.”',
              },
              {
                id: 'museum-collection',
                label: 'What is kept in the museum?',
                response: '“Objects residents lent or found nearby. The labels tell you what is known about each one, and leave the uncertain parts open.”',
              },
            ]
          }),
        },
      },
    ],
  },
  'bellwold-local-museum': {
    readables: [
      {
        id: 'museum-tally-board-label',
        label: 'Tally board label',
        description: 'A paper label beneath a slate board marked with columns of old chalk lines.',
        text: '“Loaned from the Old Grain House. The surviving marks show measured grain totals; the board’s maker and the dates of the entries are not recorded.”',
      },
      {
        id: 'museum-mill-sketch-label',
        label: 'Mill sketch label',
        description: 'A paper label beneath a faded drawing of a waterwheel.',
        text: '“Copied from a page kept at the abandoned watermill. The drawing records a wheel and channel but gives no date or account of who made it.”',
      },
    ],
  },
  'bellwold-south-mile-marker': {
    readables: [
      {
        id: 'old-south-mile-marker-inscription',
        label: 'Mile marker inscription',
        description: 'A shallow inscription cut into the marker face.',
        text: 'The surviving inscription records a distance from Bellwold. Its destination name has worn away.',
      },
    ],
  },
  'bellwold-milepost-workshop': {
    npcs: [
      {
        id: 'nessa-rill',
        name: 'Nessa Rill',
        description: 'Nessa braces a cartwheel against a low stand, pale shavings clinging to her sleeves as she checks its rim for a wobble.',
        activityDescription: 'truing a cartwheel against a wooden brace',
        greeting: '“Mind the shavings; they gather thick around the bench. What brings you this way?”',
        topics: [
          {
            id: 'wheelwright-work',
            keywords: ['work', 'workshop', 'repair', 'repairs', 'wheel', 'tools'],
            response: '“I’m Nessa Rill. I live in the loft above the bench and mend carts, handles, and wooden fittings.”',
          },
          {
            id: 'west-road',
            keywords: ['road', 'mile marker', 'west', 'track'],
            response: '“The track ends here. Wagons can turn around by the bench; beyond the hazel there is no road I can send you along.”',
          },
        ],
        unknownTopicResponse: '“Ask me about the repair work or the road. I’m better with a spoke than a rumor.”',
        dialogue: {
          prompt: '“Mind the shavings; they gather thick around the bench. What brings you this way?”',
          choices: smallTalkChoices({
            npcId: 'nessa-rill',
            identity: '“Nessa Rill. I live in the loft above the bench and make my living repairing carts, handles, and wooden fittings.”',
            activity: '“I’m truing this cartwheel. The rim was loose enough to send a load skidding if I left it.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is the nearest place to trade and see familiar faces. I go in when I need supplies or news.”' },
            additionalQuestions: [
              {
                id: 'repairs',
                label: 'What do you repair?',
                response: '“Mostly cart wheels, handles, and wooden fittings. If the break is metal, I send folks to Darric at the forge.”',
              },
              {
                id: 'road',
                label: 'Why set up here?',
                response: '“The old road brings wagons past my door, and the loft keeps me close to the work. It suits me.”',
              },
            ]
          }),
        },
      },
    ],
  },
  'old-bell-tower': {
    readables: [
      {
        id: 'bellwold-tower-inscription',
        label: 'Tower inscription',
        description: 'A weathered inscription at the tower entrance.',
        text: 'A copied account says the bell was heard before storms. It also records the period when seventeen villagers disappeared while the bell sounded continuously. The account does not explain what connected those events, or why the bell later fell silent.',
      },
    ],
  },
  'abandoned-watermill': {
    takeables: [{
        id: 'mill-copper-axe',
        typeId: 'copper-axe',
        label: 'Copper Axe',
        description: 'A copper axe with a worn handle and a serviceable edge, suitable for chopping wood.',
        roomDescription: 'A copper axe leans against the wall.',
        woodcuttingAxe: { requiredLevel: 1, power: 1 },
      }],
    readables: [
      {
        id: 'mill-work-ledger',
        label: 'Mill work ledger',
        description: 'A damp ledger left on the mill desk.',
        text: 'The last entries record the mill wheel moving on nights when the channel ran low. The writer notes the dates, water level, and movement, but gives no explanation.',
      },
    ],
  },
  'bellwold-church-annex': {
    interactables: [
      {
        id: 'bellwold-church-iron-door',
        label: 'Iron door',
        description: 'A heavy iron door is set into the eastern wall. A narrow keyhole is worn smooth around its edge.',
      },
    ],
    itemUses: [
      {
        id: 'unlock-bellwold-church-door',
        itemId: 'bellwold-church-annex-key',
        targetId: 'bellwold-church-iron-door',
        response: 'The old church key turns with a dry click. The iron door opens onto a low corridor descending beneath the annex.',
        repeatResponse: 'The iron door stands open. The old key still turns in its lock.',
      },
    ],
  },
  'bellwold-church-reliquary': {
    takeables: [
      {
        id: 'bellwold-reliquary-sword',
        label: 'Reliquary sword',
        description: 'A carefully balanced steel sword with a narrow fuller. Its workmanship grants +2 attack power when equipped.',
        roomDescription: 'The reliquary sword rests on the black stone shelf.',
        questBound: true,
        equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
      },
    ],
  }
} satisfies WorldPackContent['locationContent'];
