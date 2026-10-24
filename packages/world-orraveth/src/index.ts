import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type WorldPackDraft,
} from '@mudd/contracts';
import { orravethClassCatalog } from './classes.js';
export { orravethClassCatalog } from './classes.js';

export const ORRAVETH_WORLD_INSTANCE_ID = 'orraveth-bellwold-instance';

const draft = {
  formatVersion: 1,
  packId: 'orraveth.bellwold',
  packVersion: '1.7.0',
  displayName: 'Orraveth: Bellwold',
  classCatalog: orravethClassCatalog,
  currency: {
    id: 'gold',
    name: 'gold piece',
    symbol: 'g',
    startingBalance: 0,
  },
  locations: [
    {
      id: 'bellwold-market-square',
      name: 'Bellwold Market Square',
      description: 'Stalls and handcarts crowd the open ground. The smell of baked bread drifts from the east side of the square.\n\nThe tower road rises north and South Common lies south. A lane leads west toward the Kindly Roof; Marr’s General Goods is east.',
      mapPosition: { x: 0, y: 0, terrain: 'cobblestone' },
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
          movement: {
            strategy: 'wander',
            intervalMs: 45_000,
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
          movement: {
            strategy: 'route',
            intervalMs: 60_000,
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
      ],
      exits: [
        { id: 'square-to-inn', fromLocationId: 'bellwold-market-square', toLocationId: 'kindly-roof-inn', label: 'west', direction: 'west' },
        { id: 'square-to-shop', fromLocationId: 'bellwold-market-square', toLocationId: 'marrs-general-goods', label: 'east', direction: 'east' },
        { id: 'square-to-tower-road', fromLocationId: 'bellwold-market-square', toLocationId: 'old-bell-tower-approach', label: 'north', direction: 'north' },
        { id: 'square-to-south-common', fromLocationId: 'bellwold-market-square', toLocationId: 'bellwold-south-common', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'kindly-roof-inn',
      name: 'The Kindly Roof',
      safeResting: true,
      description: 'Firelight warms the common room, and low voices drift between the tables. A trace of smoke clings to the rafters. The market square lies east; a narrow road leaves west.',
      mapPosition: { x: -1, y: 0, terrain: 'building' },
      exits: [
        { id: 'inn-to-square', fromLocationId: 'kindly-roof-inn', toLocationId: 'bellwold-market-square', label: 'east', direction: 'east' },
        { id: 'inn-to-west-gate', fromLocationId: 'kindly-roof-inn', toLocationId: 'bellwold-west-gate', label: 'west', direction: 'west' },
      ],
      npcs: [
        {
          id: 'tomas-innkeeper',
          name: 'Tomas',
          description: 'Behind the common-room counter, Tomas turns from one traveler to the next, listening as low voices drift around the tables.',
          activityDescription: 'listening to travelers in the common room',
          greeting: '“Come in and warm yourself. If you want the road news, ask who saw it and when.”',
          topics: [
            { id: 'road', keywords: ['road', 'travel'], response: '“The tower road leaves from the square. The mill is farther along. I can tell you what travelers report, not what waits for you there.”' },
            { id: 'elira', keywords: ['elira', 'professor', 'scholar'], response: '“Professor Elira Venn was investigating the old bell and disappeared near Bellwold. I have no reliable account of what happened after.”' },
            { id: 'bell-history', keywords: ['seventeen villagers', 'storm warnings', 'bell history'], response: '“The older account says the bell warned of storms, then rang without stopping while seventeen villagers disappeared. It records the terrible sequence, not its cause.”' },
            { id: 'beyond-bellwold', keywords: ['Merefall League', 'Veyrun Concord', 'Sareth Cantons', 'Rillward Freeholds'], response: '“Travelers describe a continent of different arrangements: guild-influenced city-states in Merefall, temple and civic authority in Veyrun, mountain assemblies in Sareth, and negotiated river rights in Rillward. I repeat what they tell me; I have not walked every road myself.”' },
          ],
          unknownTopicResponse: '“I keep rooms and hear travelers. I don’t claim to know every answer.”',
        },
      ],
    },
    {
      id: 'bellwold-west-gate',
      name: 'Bellwold West Gate',
      description: 'The western lane passes the last village fences and a simple timber gate. The Kindly Roof is east; the westbound road runs past the hedgerows.',
      mapPosition: { x: -2, y: 0, terrain: 'land' },
      exits: [
        { id: 'west-gate-to-inn', fromLocationId: 'bellwold-west-gate', toLocationId: 'kindly-roof-inn', label: 'east', direction: 'east' },
        { id: 'west-gate-to-track', fromLocationId: 'bellwold-west-gate', toLocationId: 'bellwold-westbound-track', label: 'west', direction: 'west', roadId: 'bellwold-west-road' },
      ],
    },
    {
      id: 'bellwold-westbound-track',
      name: 'Westbound Track',
      description: 'The packed-earth road follows low hedgerows beyond Bellwold’s western fields. The West Gate is east; the rough road end is west.',
      mapPosition: { x: -3, y: 0, terrain: 'dirt' },
      exits: [
        { id: 'westbound-track-to-gate', fromLocationId: 'bellwold-westbound-track', toLocationId: 'bellwold-west-gate', label: 'east', direction: 'east', roadId: 'bellwold-west-road' },
        { id: 'westbound-track-to-end', fromLocationId: 'bellwold-westbound-track', toLocationId: 'bellwold-west-road-end', label: 'west', direction: 'west', roadId: 'bellwold-west-road' },
      ],
    },
    {
      id: 'bellwold-west-road-end',
      name: 'Western Road Verge',
      description: 'The packed track narrows between scrub and open ground before ending in rough grass. West Gate lies back to the east.',
      mapPosition: { x: -4, y: 0, terrain: 'land' },
      exits: [
        { id: 'west-road-end-to-track', fromLocationId: 'bellwold-west-road-end', toLocationId: 'bellwold-westbound-track', label: 'east', direction: 'east', roadId: 'bellwold-west-road' },
      ],
    },
    {
      id: 'marrs-general-goods',
      name: 'Marr’s General Goods',
      description: 'Provision jars line the shelves. Near the counter, a balance scale sits beside an open ledger; a brass weight glints in the window light.',
      mapPosition: { x: 1, y: 0, terrain: 'building' },
      exits: [
        { id: 'shop-to-square', fromLocationId: 'marrs-general-goods', toLocationId: 'bellwold-market-square', label: 'west', direction: 'west' },
      ],
      readables: [
        {
          id: 'anwen-scale-note',
          label: 'Scale note',
          description: 'A short note beside the balance scale.',
          text: 'Anwen has recorded several measurements that do not agree with the weights placed on the scale. She has not decided whether the fault is in the instrument, its surroundings, or the way it is being read.',
        },
      ],
      npcs: [
        {
          id: 'anwen-marr',
          name: 'Anwen Marr',
          description: 'A brass weight rests in Anwen Marr’s palm as she studies the balance scale and makes a note in an open ledger.',
          activityDescription: 'checking a measure beside her ledger',
          greeting: '“Welcome to my shop. If you want to understand a thing, start with what it does—not with what you hope it means.”',
          topics: [
            { id: 'age-of-measures', keywords: ['Age of Measures', 'Glass Collegium', 'natural philosophers'], response: '“People call this the Age of Measures. Scholars are testing the physical world and Resonance with instruments. A repeatable result matters, but it still does not explain itself.”' },
            { id: 'scale', keywords: ['scale', 'measure', 'measurement'], response: '“The readings are repeatable often enough to trouble me. That does not tell us what causes them.”' },
            { id: 'sprite', keywords: ['sprite', 'spirit'], response: '“A sprite is one possibility people raise. It is not an answer I can prove.”' },
            { id: 'bell', keywords: ['bell', 'tower'], response: '“The bell fell silent while Professor Venn was measuring it. The order of events is known; the cause is not.”' },
            { id: 'heskar-frontier', keywords: ['Heskar frontier', 'property law', 'Crown of Heskar'], response: '“Heskar has strict property law and guarded borders. Bellwold is near that frontier; the records I have seen do not settle the village’s exact legal status.”' },
          ],
          unknownTopicResponse: '“I’m working. Ask plainly, and I’ll answer if I know.”',
          dialogue: {
            prompt: 'Anwen sets her pencil beside the ledger. “What would you like to ask?”',
            choices: [
              {
                id: 'ask-anwen-about-mill',
                label: 'Ask about the watermill',
                response: '“The mill has been abandoned, but there are reports of its wheel moving when the channel is low. There is a ledger inside. Would you read the last entries and bring me what they actually say?”',
                progressFlagId: 'asked-anwen-about-mill',
                questAction: { type: 'accept', questId: 'bellwold-mill-observations' },
              },
              {
                id: 'ask-anwen-about-church-sword',
                label: 'Ask about the abandoned church',
                response: '“There is a locked annex beneath the abandoned church. A brass key is behind the tally cabinet in the Old Grain House. A sword is sealed beyond that door. Bring it to me; I will pay you 20 gold, inspect the blade, and return it to you.”',
                progressFlagId: 'accepted-church-sword-recovery',
                questAction: { type: 'accept', questId: 'bellwold-church-sword' },
              },
              {
                id: 'report-mill-ledger',
                label: 'Report what the ledger says',
                response: '“Good. Keep the record separate from the explanation. One tells us what was observed; the other still needs work.”',
                progressFlagId: 'reported-mill-ledger-to-anwen',
                questCondition: {
                  questId: 'bellwold-mill-observations',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-mill-ledger'],
                },
                questAction: { type: 'turn-in', questId: 'bellwold-mill-observations' },
              },
              {
                id: 'return-church-sword-to-anwen',
                label: 'Return the church sword',
                response: '“Anwen checks the blade and its fittings, then places the same sword back in your hands. She counts out 20 gold. ‘Keep it. You found it, and now it is accounted for.’”',
                progressFlagId: 'returned-church-sword-to-anwen',
                questCondition: {
                  questId: 'bellwold-church-sword',
                  status: 'active',
                  requiresCompletedObjectiveIds: [
                    'find-church-key',
                    'unlock-church-annex',
                    'recover-church-sword',
                  ],
                },
                questAction: { type: 'turn-in', questId: 'bellwold-church-sword' },
              },
            ],
          },
        },
      ],
    },
    {
      id: 'bellwold-south-common',
      name: 'Bellwold South Common',
      description: 'Benches stand beside drying lines and a public notice board. Voices and footsteps carry across the grass. The market square is north, the Green Mortar west, Blackwater Forge east, and Well Court south.',
      mapPosition: { x: 0, y: -1, terrain: 'pasture' },
      exits: [
        { id: 'south-common-to-square', fromLocationId: 'bellwold-south-common', toLocationId: 'bellwold-market-square', label: 'north', direction: 'north' },
        { id: 'south-common-to-green-mortar', fromLocationId: 'bellwold-south-common', toLocationId: 'green-mortar', label: 'west', direction: 'west' },
        { id: 'south-common-to-blackwater-forge', fromLocationId: 'bellwold-south-common', toLocationId: 'blackwater-forge', label: 'east', direction: 'east' },
        { id: 'south-common-to-well-court', fromLocationId: 'bellwold-south-common', toLocationId: 'bellwold-well-court', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'green-mortar',
      name: 'The Green Mortar',
      description: 'Bundles of dried plants hang above a workbench; clean cloth is folded near a shallow bowl. The sharp scent of crushed herbs lingers in the air. The open green is east; Wattle Row is south.',
      mapPosition: { x: -1, y: -1, terrain: 'building' },
      exits: [
        { id: 'green-mortar-to-south-common', fromLocationId: 'green-mortar', toLocationId: 'bellwold-south-common', label: 'east', direction: 'east' },
        { id: 'green-mortar-to-wattle-row', fromLocationId: 'green-mortar', toLocationId: 'bellwold-wattle-row', label: 'south', direction: 'south' },
      ],
      npcs: [
        {
          id: 'ilya-fen',
          name: 'Ilya Fen',
          description: 'Ilya sorts dried leaves into shallow trays beside a bowl and a stack of folded cloth.',
          activityDescription: 'sorting plants at her workbench',
          greeting: '“Tell me what you noticed and when. A careful account is a better beginning than a guess.”',
          topics: [
            { id: 'care', keywords: ['care', 'healing', 'hurt', 'medicine'], response: '“Rest, clean water, and a clear description of what changed can matter as much as any remedy. I will not promise more than I know.”' },
            { id: 'plants', keywords: ['plant', 'plants', 'herb', 'herbs'], response: '“I gather what grows nearby, but a plant’s reputation is not proof of what it can do.”' },
            { id: 'learning', keywords: ['Sareth Cantons', 'universities', 'apprenticeship'], response: '“The Sareth Cantons are known for universities, but not every healer studies in one. Much care is taught by practice, observation, and an experienced hand.”' },
            { id: 'unbinding', keywords: ['Unbinding Initiative', 'essence-free healing', 'experimental healing'], response: '“Researchers are testing plant, mineral, and cooperative approaches to healing. They are promising in some cases, but costly and not yet easy to provide everywhere.”' },
          ],
          unknownTopicResponse: '“I can speak about the care I have seen here. Ask me something specific.”',
        },
      ],
    },
    {
      id: 'blackwater-forge',
      name: 'Blackwater Forge',
      description: 'Tongs and hammers hang over a dark stone hearth. Half-mended iron pieces rest on the bench, and coal smoke clings to the beams. South Common lies west.',
      mapPosition: { x: 1, y: -1, terrain: 'building' },
      exits: [
        { id: 'blackwater-forge-to-south-common', fromLocationId: 'blackwater-forge', toLocationId: 'bellwold-south-common', label: 'west', direction: 'west' },
      ],
      npcs: [
        {
          id: 'darric-holt',
          name: 'Darric Holt',
          description: 'Darric turns a half-mended iron fitting beside the forge, coal smoke darkening the sleeve of his work shirt.',
          activityDescription: 'repairing a farm fitting at the forge',
          greeting: '“If something is broken, show me where it failed. If it is only a rumor, I have work to finish.”',
          topics: [
            { id: 'repairs', keywords: ['repair', 'repairs', 'forge', 'smith', 'tools'], response: '“Most days it is hinges, blades, and cart fittings. Keeping a place working is less dramatic than building it from scratch.”' },
            { id: 'bell', keywords: ['bell', 'tower'], response: '“I know how metal wears. I do not know why the tower bell went silent.”' },
            { id: 'sevenfold-workshop', keywords: ['Sevenfold Workshop', 'divine artisans', 'craft and creation'], response: '“Some people speak of creation as a workshop shaped by seven artisans. I understand the metaphor; it does not tell me which faith is right, or why the bell went quiet.”' },
            { id: 'heskar-property', keywords: ['Heskar property law', 'boundary mark', 'land claim'], response: '“A boundary mark can matter as much as a fence under Heskar law. A smith can mend the hinge; settling the claim is someone else’s work.”' },
          ],
          unknownTopicResponse: '“Ask about the work here. I am not a keeper of every local story.”',
        },
      ],
    },
    {
      id: 'bellwold-well-court',
      name: 'Bellwold Well Court',
      description: 'A stone-rimmed well and a broad trough give this quiet court a steady rhythm of buckets, footsteps, and short conversations. A covered storehouse stands to the east; Wattle Row branches west.\n\nSouth Common is north, and the Common House is south.',
      mapPosition: { x: 0, y: -2, terrain: 'cobblestone' },
      exits: [
        { id: 'well-court-to-south-common', fromLocationId: 'bellwold-well-court', toLocationId: 'bellwold-south-common', label: 'north', direction: 'north' },
        { id: 'well-court-to-wattle-row', fromLocationId: 'bellwold-well-court', toLocationId: 'bellwold-wattle-row', label: 'west', direction: 'west' },
        { id: 'well-court-to-grain-house', fromLocationId: 'bellwold-well-court', toLocationId: 'old-grain-house', label: 'east', direction: 'east' },
        { id: 'well-court-to-common-house', fromLocationId: 'bellwold-well-court', toLocationId: 'bellwold-common-house', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-wattle-row',
      name: 'Wattle Row',
      description: 'Low homes and work yards line a narrow lane. Pale new strips weave through the older, darkened reeds of the wattle walls. The Green Mortar is north, Well Court east, a wheelwright’s yard west, and Tallow End Cottage south.',
      mapPosition: { x: -1, y: -2, terrain: 'land' },
      exits: [
        { id: 'wattle-row-to-green-mortar', fromLocationId: 'bellwold-wattle-row', toLocationId: 'green-mortar', label: 'north', direction: 'north' },
        { id: 'wattle-row-to-well-court', fromLocationId: 'bellwold-wattle-row', toLocationId: 'bellwold-well-court', label: 'east', direction: 'east' },
        { id: 'wattle-row-to-sovens-yard', fromLocationId: 'bellwold-wattle-row', toLocationId: 'sovens-wheelwright-yard', label: 'west', direction: 'west' },
        { id: 'wattle-row-to-tallow-cottage', fromLocationId: 'bellwold-wattle-row', toLocationId: 'tallow-end-cottage', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'sovens-wheelwright-yard',
      name: 'Soven’s Wheelwright Yard',
      description: 'A turning frame, wooden spokes, and a rack of finished rims fill this fenced yard. Shavings gather in the corners despite the broom leaning by the gate; the sound of a saw carries from the south.',
      mapPosition: { x: -2, y: -2, terrain: 'building' },
      exits: [
        { id: 'sovens-yard-to-wattle-row', fromLocationId: 'sovens-wheelwright-yard', toLocationId: 'bellwold-wattle-row', label: 'east', direction: 'east' },
        { id: 'sovens-yard-to-hearth-alley', fromLocationId: 'sovens-wheelwright-yard', toLocationId: 'bellwold-hearth-alley', label: 'south', direction: 'south' },
      ],
      npcs: [
        {
          id: 'rell-soven',
          name: 'Rell Soven',
          description: 'Rell turns a cart wheel by its rim, pausing to watch it wobble against the wooden frame.',
          activityDescription: 'checking a cart axle',
          greeting: '“A wheel tells you where it is failing if you watch it turn.”',
          topics: [
            { id: 'wheel-work', keywords: ['wheel', 'wheels', 'cart', 'carpentry', 'work'], response: '“I make the parts that keep a cart straight on a rough road. Most repairs begin with listening for a wobble.”' },
            { id: 'mill', keywords: ['mill', 'watermill'], response: '“I have not worked on the mill wheel. I can describe a wheel; I cannot say what moves one when no one is there.”' },
            { id: 'regional-trade', keywords: ['Merefall League', 'Rillward Freeholds', 'river rights', 'trade routes'], response: '“A cart takes the road it can pass. In the river settlements, access is negotiated with councils; in Merefall, guilds shape much of the trade. The route depends on who has agreed to carry what.”' },
          ],
          unknownTopicResponse: '“Ask me about wheels or the work in this yard.”',
        },
      ],
    },
    {
      id: 'tallow-end-cottage',
      name: 'Tallow End Cottage',
      description: 'A narrow cottage opens onto Wattle Row. A loom stands beside the window, with folded cloth kept clear of the hearth and a basket of mending beside the door.\n\nWattle Row is north; the Common House is east.',
      mapPosition: { x: -1, y: -3, terrain: 'building' },
      exits: [
        { id: 'tallow-cottage-to-wattle-row', fromLocationId: 'tallow-end-cottage', toLocationId: 'bellwold-wattle-row', label: 'north', direction: 'north' },
        { id: 'tallow-cottage-to-common-house', fromLocationId: 'tallow-end-cottage', toLocationId: 'bellwold-common-house', label: 'east', direction: 'east' },
        { id: 'tallow-cottage-to-hearth-alley', fromLocationId: 'tallow-end-cottage', toLocationId: 'bellwold-hearth-alley', label: 'west', direction: 'west' },
      ],
      npcs: [
        {
          id: 'seli-tor',
          name: 'Seli Tor',
          description: 'Seli draws a pale thread taut through a strip of cloth at the loom by the window.',
          activityDescription: 'weaving cloth at her loom',
          greeting: '“Mind the loose thread by the door. It has already caught two sleeves today.”',
          topics: [
            { id: 'weaving', keywords: ['weaving', 'cloth', 'loom', 'mending'], response: '“A torn sack is a small problem until the road is long. Most of my work keeps ordinary things useful a little longer.”' },
            { id: 'wattle-row', keywords: ['wattle', 'row', 'homes', 'neighbors'], response: '“The lane is close, but people keep their own hours. You learn who is awake by the sound of their work.”' },
            { id: 'travelers-and-customs', keywords: ['customs', 'travelers', 'farther roads'], response: '“People passing through carry different ways of wrapping, mending, and marking their things. I ask what a pattern means before I assume it belongs to a faith or a family.”' },
          ],
          unknownTopicResponse: '“I am happy to talk, but the loom will not wait forever.”',
        },
      ],
    },
    {
      id: 'old-grain-house',
      name: 'Old Grain House',
      description: 'A timber storehouse stands on a raised stone sill; narrow vent gaps cut the upper walls. Chalk marks cross the faces of several storage bins. Well Court is west.',
      mapPosition: { x: 1, y: -2, terrain: 'building' },
      exits: [
        { id: 'grain-house-to-well-court', fromLocationId: 'old-grain-house', toLocationId: 'bellwold-well-court', label: 'west', direction: 'west' },
      ],
      takeables: [
        {
          id: 'bellwold-church-annex-key',
          label: 'Old church key',
          description: 'A tarnished brass key with a long, worn bit. It fits the iron door beneath the abandoned church.',
          roomDescription: 'A tarnished brass key lies behind the grain tally cabinet.',
          questBound: true,
        },
      ],
      npcs: [
        {
          id: 'aven-rusk',
          name: 'Aven Rusk',
          description: 'Aven checks the chalk marks on a grain bin, then writes in a narrow ledger.',
          activityDescription: 'checking the grain tally',
          greeting: '“If you need the store, tell me what you are looking for. I keep the tally, not the harvest.”',
          topics: [
            { id: 'stores', keywords: ['grain', 'store', 'stores', 'harvest', 'sacks'], response: '“The chalk marks sort the bins by season, not by owner. I update them when stores are checked; they do not tell us what next season will bring.”' },
            { id: 'regional-ledgers', keywords: ['Merefall guilds', 'river accounts', 'regional records'], response: '“Other places keep different accounts. I hear that guilds weigh heavily on commerce in Merefall, while Rillward communities record agreements over river access. My own tally only speaks for this store.”' },
            { id: 'records', keywords: ['record', 'records', 'tally'], response: '“I write down what comes in and what leaves. A neat ledger is useful, but it cannot explain every loss.”' },
          ],
          unknownTopicResponse: '“Ask about the storehouse or its records, and I will check what I know.”',
        },
      ],
    },
    {
      id: 'bellwold-common-house',
      name: 'Bellwold Common House',
      description: 'A long timber room holds a scuffed table and mismatched benches. Paper notices cover one wall, and fresh ink smells sharp near the record book. Well Court is north, Tallow End Cottage is west, and the south road leaves town beyond the last yards.',
      mapPosition: { x: 0, y: -3, terrain: 'building' },
      exits: [
        { id: 'common-house-to-well-court', fromLocationId: 'bellwold-common-house', toLocationId: 'bellwold-well-court', label: 'north', direction: 'north' },
        { id: 'common-house-to-tallow-cottage', fromLocationId: 'bellwold-common-house', toLocationId: 'tallow-end-cottage', label: 'west', direction: 'west' },
        { id: 'common-house-to-south-gate', fromLocationId: 'bellwold-common-house', toLocationId: 'bellwold-south-gate', label: 'south', direction: 'south' },
        { id: 'common-house-to-library', fromLocationId: 'bellwold-common-house', toLocationId: 'bellwold-library', label: 'east', direction: 'east' },
      ],
      npcs: [
        {
          id: 'enna-pell',
          name: 'Enna Pell',
          description: 'Enna bends over an open record book, copying a line from one of the notices on the wall.',
          activityDescription: 'copying a notice into the village record book',
          greeting: '“The notes are public. If something is missing, tell me what you saw and when.”',
          topics: [
            { id: 'meetings', keywords: ['meeting', 'meetings', 'common house', 'notices'], response: '“People bring repairs, water use, and market-day concerns here. The notes record what was agreed, not what everyone wished had been agreed.”' },
            { id: 'records', keywords: ['record', 'records', 'book', 'ledger'], response: '“I keep the wording close to what people said. A record should help the next person check, not decide for them.”' },
            { id: 'bell-records', keywords: ['seventeen villagers', 'continuous ringing', 'storm bell record'], response: '“One surviving account says the bell rang continuously while seventeen villagers disappeared. It does not give a cause, and I will not add one to the minutes.”' },
            { id: 'founding-and-law', keywords: ['founding date', 'town history', 'Heskar jurisdiction'], response: '“Our public book records decisions and shared work, not a complete founding story. Bellwold lies near Heskar’s frontier, but these minutes do not establish the village’s legal status.”' },
          ],
          unknownTopicResponse: '“Ask about the public notices or the records kept here.”',
        },
      ],
    },
    {
      id: 'bellwold-south-gate',
      name: 'Bellwold South Gate',
      description: 'The last cluster of village yards gives way to a low gate and a packed-earth road. The Common House is north; the southbound track continues south.',
      mapPosition: { x: 0, y: -4, terrain: 'land' },
      exits: [
        { id: 'south-gate-to-common-house', fromLocationId: 'bellwold-south-gate', toLocationId: 'bellwold-common-house', label: 'north', direction: 'north' },
        { id: 'south-gate-to-track', fromLocationId: 'bellwold-south-gate', toLocationId: 'bellwold-southbound-track', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
        { id: 'south-gate-to-jail', fromLocationId: 'bellwold-south-gate', toLocationId: 'bellwold-jail', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-hearth-alley',
      name: 'Hearth Alley',
      description: 'Close-set walls cast a narrow strip of shade across the lane. A cooking fire crackles behind one shutter.',
      mapPosition: { x: -2, y: -3, terrain: 'dirt' },
      exits: [
        { id: 'hearth-alley-to-wheelwright-yard', fromLocationId: 'bellwold-hearth-alley', toLocationId: 'sovens-wheelwright-yard', label: 'north', direction: 'north' },
        { id: 'hearth-alley-to-tallow-cottage', fromLocationId: 'bellwold-hearth-alley', toLocationId: 'tallow-end-cottage', label: 'east', direction: 'east' },
        { id: 'hearth-alley-to-lantern-court', fromLocationId: 'bellwold-hearth-alley', toLocationId: 'bellwold-lantern-court', label: 'west', direction: 'west' },
        { id: 'hearth-alley-to-lower-row', fromLocationId: 'bellwold-hearth-alley', toLocationId: 'bellwold-lower-row', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-lantern-court',
      name: 'Lantern Court',
      description: 'A dented iron lantern hangs above the lane, and rainwater darkens the stones beneath it.',
      mapPosition: { x: -3, y: -3, terrain: 'cobblestone' },
      exits: [
        { id: 'lantern-court-to-hearth-alley', fromLocationId: 'bellwold-lantern-court', toLocationId: 'bellwold-hearth-alley', label: 'east', direction: 'east' },
        { id: 'lantern-court-to-nettlemere-house', fromLocationId: 'bellwold-lantern-court', toLocationId: 'bellwold-nettlemere-house', label: 'west', direction: 'west' },
        { id: 'lantern-court-to-upper-row-house', fromLocationId: 'bellwold-lantern-court', toLocationId: 'bellwold-upper-row-house', label: 'north', direction: 'north' },
        { id: 'lantern-court-to-lower-row-west', fromLocationId: 'bellwold-lantern-court', toLocationId: 'bellwold-lower-row-west', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-nettlemere-house',
      name: 'Nettlemere House',
      description: 'A copper kettle rattles softly above the hearth, and the kitchen smells of warm bread.',
      mapPosition: { x: -4, y: -3, terrain: 'building' },
      exits: [
        { id: 'nettlemere-house-to-lantern-court', fromLocationId: 'bellwold-nettlemere-house', toLocationId: 'bellwold-lantern-court', label: 'east', direction: 'east' },
      ],
      npcs: [
        {
          id: 'sella-nettlemere',
          name: 'Sella Nettlemere',
          description: 'Sella kneads a small round of dough on the kitchen table, flour dusting her sleeves.',
          activityDescription: 'kneading dough at the kitchen table',
          greeting: '“Come in out of the lane. Just mind the kettle.”',
          topics: [
            { id: 'lantern-court', keywords: ['Lantern Court', 'alley', 'neighbors'], response: '“The lane is narrow, but everyone knows whose door to knock on when a roof leaks or a pot goes missing.”' },
            { id: 'bellwold-meals', keywords: ['food', 'bread', 'meals'], response: '“The market brings flour through town, but people still trade favors and whatever their own gardens produce.”' },
          ],
          unknownTopicResponse: '“I can tell you about this lane, if that’s what you came to ask.”',
        },
      ],
    },
    {
      id: 'bellwold-upper-row-house',
      name: 'Upper Row House',
      description: 'A handloom clicks beside a sunlit window. Wool fibers cling to the rough boards.',
      mapPosition: { x: -3, y: -2, terrain: 'building' },
      exits: [
        { id: 'upper-row-house-to-lantern-court', fromLocationId: 'bellwold-upper-row-house', toLocationId: 'bellwold-lantern-court', label: 'south', direction: 'south' },
      ],
      npcs: [
        {
          id: 'tovin-ashdown',
          name: 'Tovin Ashdown',
          description: 'Tovin works a shuttle through the loom, pausing to smooth a loose thread.',
          activityDescription: 'weaving at a handloom',
          greeting: '“If you’re here about the cloth, give me a moment to finish this row.”',
          topics: [
            { id: 'household-work', keywords: ['weaving', 'loom', 'cloth', 'work'], response: '“A good length of cloth takes time. Most of mine goes to mending clothes and covering goods before they travel.”' },
            { id: 'town-lanes', keywords: ['town', 'houses', 'alleys', 'lanes'], response: '“These lanes grew where people needed a door close to their work. They don’t all lead somewhere grand.”' },
          ],
          unknownTopicResponse: '“Ask me about the loom or the people on this row.”',
        },
      ],
    },
    {
      id: 'bellwold-lower-row-west',
      name: 'Lower Row',
      description: 'A loose shutter taps in the breeze; damp earth darkens the packed lane.',
      mapPosition: { x: -3, y: -4, terrain: 'dirt' },
      exits: [
        { id: 'lower-row-west-to-lantern-court', fromLocationId: 'bellwold-lower-row-west', toLocationId: 'bellwold-lantern-court', label: 'north', direction: 'north' },
        { id: 'lower-row-west-to-lower-row', fromLocationId: 'bellwold-lower-row-west', toLocationId: 'bellwold-lower-row', label: 'east', direction: 'east' },
        { id: 'lower-row-west-to-row-house', fromLocationId: 'bellwold-lower-row-west', toLocationId: 'bellwold-lower-row-house', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-lower-row-house',
      name: 'Lower Row House',
      description: 'A saw scrapes across a plank, scattering pale curls over the workbench.',
      mapPosition: { x: -4, y: -4, terrain: 'building' },
      exits: [
        { id: 'lower-row-house-to-lower-row', fromLocationId: 'bellwold-lower-row-house', toLocationId: 'bellwold-lower-row-west', label: 'east', direction: 'east' },
      ],
      npcs: [
        {
          id: 'renna-kell',
          name: 'Renna Kell',
          description: 'Renna trims a warped board against the workbench, then checks its edge with her thumb.',
          activityDescription: 'smoothing a board at the workbench',
          greeting: '“Close the door behind you; the sawdust gets everywhere.”',
          topics: [
            { id: 'repairs', keywords: ['repairs', 'woodwork', 'workbench'], response: '“A loose step or a split shutter is usually easier to mend before the next rain.”' },
            { id: 'lower-row', keywords: ['Lower Row', 'neighbors', 'houses'], response: '“The row is quiet until someone starts fixing something. Then the whole lane has an opinion.”' },
          ],
          unknownTopicResponse: '“If it’s about wood or the lane, ask directly.”',
        },
      ],
    },
    {
      id: 'bellwold-lower-row',
      name: 'South Lower Row',
      description: 'Packed earth gives way to a patch of worn stone. A dog barks behind a fence.',
      mapPosition: { x: -2, y: -4, terrain: 'dirt' },
      exits: [
        { id: 'lower-row-to-hearth-alley', fromLocationId: 'bellwold-lower-row', toLocationId: 'bellwold-hearth-alley', label: 'north', direction: 'north' },
        { id: 'lower-row-to-lower-row-west', fromLocationId: 'bellwold-lower-row', toLocationId: 'bellwold-lower-row-west', label: 'west', direction: 'west' },
        { id: 'lower-row-to-jail', fromLocationId: 'bellwold-lower-row', toLocationId: 'bellwold-jail', label: 'east', direction: 'east' },
        { id: 'lower-row-to-cottage', fromLocationId: 'bellwold-lower-row', toLocationId: 'bellwold-south-lane-cottage', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-south-lane-cottage',
      name: 'South Lane Cottage',
      description: 'A clay pot of thyme sits on the sill; its sharp scent reaches through the open window.',
      mapPosition: { x: -2, y: -5, terrain: 'building' },
      exits: [
        { id: 'south-lane-cottage-to-lower-row', fromLocationId: 'bellwold-south-lane-cottage', toLocationId: 'bellwold-lower-row', label: 'north', direction: 'north' },
      ],
      npcs: [
        {
          id: 'pella-wren',
          name: 'Pella Wren',
          description: 'Pella sorts fresh thyme into a shallow basket beside the window.',
          activityDescription: 'sorting herbs beside the window',
          greeting: '“There’s enough room by the table if you need to sit.”',
          topics: [
            { id: 'herbs', keywords: ['herbs', 'thyme', 'plants'], response: '“I keep a few useful plants close by. I know what I have tried myself, and I leave the rest to people with better notes.”' },
            { id: 'town-life', keywords: ['Bellwold', 'town', 'life'], response: '“People here borrow tools, return them late, and argue about whose turn it is to mend the fence. Then they help anyway.”' },
          ],
          unknownTopicResponse: '“I can tell you what grows in my pots, or what I’ve seen on the lane.”',
        },
      ],
    },
    {
      id: 'bellwold-jail',
      name: 'Bellwold Jail',
      description: 'Iron bars cast thin shadows across the stone floor. Keys clink briefly behind the desk.',
      mapPosition: { x: -1, y: -4, terrain: 'building' },
      exits: [
        { id: 'jail-to-south-gate', fromLocationId: 'bellwold-jail', toLocationId: 'bellwold-south-gate', label: 'east', direction: 'east' },
        { id: 'jail-to-lower-row', fromLocationId: 'bellwold-jail', toLocationId: 'bellwold-lower-row', label: 'west', direction: 'west' },
        { id: 'jail-to-holding-cell', fromLocationId: 'bellwold-jail', toLocationId: 'bellwold-jail-cell', label: 'down to the holding cell', direction: 'down' },
      ],
      npcs: [
        {
          id: 'sergeant-nera-vail',
          name: 'Sergeant Nera Vail',
          description: 'Sergeant Vail sits behind the desk, turning a key ring over in one hand.',
          activityDescription: 'checking the jail keys',
          greeting: '“If you have a concern, state what happened and when. I keep the record plain.”',
          topics: [
            { id: 'jail', keywords: ['jail', 'holding cell', 'detention'], response: '“The cell is for keeping people safely while a matter is heard. It is not a sentence, and I do not decide a dispute without a record.”' },
            { id: 'town-watch', keywords: ['watch', 'guard', 'Taren Voss'], response: '“Taren walks the public routes. I keep this room and its keys; the two jobs overlap only when someone needs help.”' },
            { id: 'records', keywords: ['records', 'charges', 'law'], response: '“I write down what each person says and who witnessed it. A written claim is not the same thing as a proven one.”' },
          ],
          unknownTopicResponse: '“Keep your account specific. I can’t act on a story with no place or time attached.”',
        },
      ],
    },
    {
      id: 'bellwold-jail-cell',
      name: 'Jail Holding Cell',
      description: 'A narrow barred door stands across from the stone wall. Damp straw smells sour in the close air.',
      mapAreaId: 'bellwold-jail',
      mapPosition: { x: -1, y: -4, z: -1, terrain: 'building' },
      exits: [
        { id: 'jail-cell-to-jail', fromLocationId: 'bellwold-jail-cell', toLocationId: 'bellwold-jail', label: 'up to the jail desk', direction: 'up' },
      ],
    },
    {
      id: 'bellwold-library',
      name: 'Bellwold Library',
      description: 'Books and stitched pamphlets fill the shelves around a broad reading table. Dry paper and lamp oil mingle in the air.',
      mapPosition: { x: 1, y: -3, terrain: 'building' },
      exits: [
        { id: 'library-to-common-house', fromLocationId: 'bellwold-library', toLocationId: 'bellwold-common-house', label: 'west', direction: 'west' },
        { id: 'library-to-museum', fromLocationId: 'bellwold-library', toLocationId: 'bellwold-local-museum', label: 'east to the museum', direction: 'east' },
        { id: 'library-to-upper-room', fromLocationId: 'bellwold-library', toLocationId: 'bellwold-library-upper-room', label: 'upstairs', direction: 'up' },
      ],
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
        },
      ],
    },
    {
      id: 'bellwold-library-upper-room',
      name: 'Upper Reading Room',
      description: 'A long window fills the sloped room with pale light. Pages rustle softly in the draft.',
      mapAreaId: 'bellwold-library',
      mapPosition: { x: 1, y: -3, z: 1, terrain: 'building' },
      exits: [
        { id: 'library-upper-room-to-library', fromLocationId: 'bellwold-library-upper-room', toLocationId: 'bellwold-library', label: 'down to the library', direction: 'down' },
      ],
    },
    {
      id: 'bellwold-local-museum',
      name: 'Bellwold Local Museum',
      description: 'Glass-fronted cases stand against the walls. A slate tally board and a faded waterwheel sketch sit beneath a dusty window.',
      mapPosition: { x: 2, y: -3, terrain: 'building' },
      exits: [
        { id: 'museum-to-library', fromLocationId: 'bellwold-local-museum', toLocationId: 'bellwold-library', label: 'west to the library', direction: 'west' },
      ],
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
    {
      id: 'bellwold-southbound-track',
      name: 'Southbound Track',
      description: 'The packed road cuts through open fields between low fence lines. Wind stirs the grass as Bellwold’s roofs recede north. The South Gate is north; the reedbed approach lies south.',
      mapPosition: { x: 0, y: -5, terrain: 'pasture' },
      exits: [
        { id: 'southbound-track-to-gate', fromLocationId: 'bellwold-southbound-track', toLocationId: 'bellwold-south-gate', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
        { id: 'southbound-track-to-reedbed', fromLocationId: 'bellwold-southbound-track', toLocationId: 'bellwold-reedbed-approach', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'bellwold-reedbed-approach',
      name: 'Reedbed Approach',
      description: 'Damp grass brushes the road’s edges, and reeds rustle along the riverbanks. The Southbound Track is north; Bellwold River Bridge is south.',
      mapPosition: { x: 0, y: -6, terrain: 'land' },
      exits: [
        { id: 'reedbed-approach-to-track', fromLocationId: 'bellwold-reedbed-approach', toLocationId: 'bellwold-southbound-track', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
        { id: 'reedbed-approach-to-bridge', fromLocationId: 'bellwold-reedbed-approach', toLocationId: 'bellwold-river-bridge', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'bellwold-river-bridge',
      name: 'Bellwold River Bridge',
      description: 'A low stone bridge carries the south road over a broad river. The current runs east and west beneath its arches. Reedbed Approach is north; Far Bank Track is south.',
      mapPosition: { x: 0, y: -7, terrain: 'land', visibleWhenUnvisited: true },
      defaultStateId: 'on',
      states: [
        { id: 'on' },
        {
          id: 'under',
          name: 'Under Bellwold River Bridge',
          description: 'The river moves beneath the stone arches. The road bridge rumbles overhead as the current passes east and west.',
        },
      ],
      exits: [
        { id: 'river-bridge-to-reedbed', fromLocationId: 'bellwold-river-bridge', toLocationId: 'bellwold-reedbed-approach', label: 'north', direction: 'north', fromStateId: 'on', roadId: 'bellwold-south-road' },
        { id: 'river-bridge-to-far-bank', fromLocationId: 'bellwold-river-bridge', toLocationId: 'bellwold-far-bank-track', label: 'south', direction: 'south', fromStateId: 'on', roadId: 'bellwold-south-road' },
        { id: 'bridge-under-to-west-reach', fromLocationId: 'bellwold-river-bridge', toLocationId: 'bellwold-river-west-reach', label: 'west', direction: 'west', fromStateId: 'under', mapLineGapAtLocationId: 'bellwold-river-bridge' },
        { id: 'bridge-under-to-east-reach', fromLocationId: 'bellwold-river-bridge', toLocationId: 'bellwold-river-east-reach', label: 'east', direction: 'east', fromStateId: 'under', mapLineGapAtLocationId: 'bellwold-river-bridge' },
      ],
    },
    {
      id: 'bellwold-river-west-reach',
      name: 'River West Reach',
      description: 'The current passes the bridge piers and slides west beneath the reeds. The bridge lies east; Willow Reach is west.',
      mapPosition: { x: -1, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'west-reach-to-bridge-under', fromLocationId: 'bellwold-river-west-reach', toLocationId: 'bellwold-river-bridge', label: 'east beneath Bellwold River Bridge', direction: 'east', toStateId: 'under', mapLineGapAtLocationId: 'bellwold-river-bridge' },
        { id: 'west-reach-to-willow-reach', fromLocationId: 'bellwold-river-west-reach', toLocationId: 'bellwold-river-willow-reach', label: 'west along the river', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-river-willow-reach',
      name: 'River Willow Reach',
      description: 'Willow roots trail into the slow water along this stretch. West Reach is east; Far West Reach is west.',
      mapPosition: { x: -2, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'willow-reach-to-west-reach', fromLocationId: 'bellwold-river-willow-reach', toLocationId: 'bellwold-river-west-reach', label: 'east along the river', direction: 'east' },
        { id: 'willow-reach-to-far-west-reach', fromLocationId: 'bellwold-river-willow-reach', toLocationId: 'bellwold-river-far-west-reach', label: 'west along the river', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-river-far-west-reach',
      name: 'River Far West Reach',
      description: 'The river broadens beyond the western reedbeds and bends out of sight. Willow Reach is east.',
      mapPosition: { x: -3, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'far-west-reach-to-willow-reach', fromLocationId: 'bellwold-river-far-west-reach', toLocationId: 'bellwold-river-willow-reach', label: 'east along the river', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-river-east-reach',
      name: 'River East Reach',
      description: 'The current emerges from beneath the bridge and runs east through reeds and shallow stones. The bridge lies west; Alder Reach is east.',
      mapPosition: { x: 1, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'east-reach-to-bridge-under', fromLocationId: 'bellwold-river-east-reach', toLocationId: 'bellwold-river-bridge', label: 'west beneath Bellwold River Bridge', direction: 'west', toStateId: 'under', mapLineGapAtLocationId: 'bellwold-river-bridge' },
        { id: 'east-reach-to-alder-reach', fromLocationId: 'bellwold-river-east-reach', toLocationId: 'bellwold-river-alder-reach', label: 'east along the river', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-river-alder-reach',
      name: 'River Alder Reach',
      description: 'A line of alder trees shadows this stretch of water. East Reach is west; Far East Reach is east.',
      mapPosition: { x: 2, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'alder-reach-to-east-reach', fromLocationId: 'bellwold-river-alder-reach', toLocationId: 'bellwold-river-east-reach', label: 'west along the river', direction: 'west' },
        { id: 'alder-reach-to-far-east-reach', fromLocationId: 'bellwold-river-alder-reach', toLocationId: 'bellwold-river-far-east-reach', label: 'east along the river', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-river-far-east-reach',
      name: 'River Far East Reach',
      description: 'The eastern current continues past the last visible bank and around a long bend. Alder Reach is west.',
      mapPosition: { x: 3, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'far-east-reach-to-alder-reach', fromLocationId: 'bellwold-river-far-east-reach', toLocationId: 'bellwold-river-alder-reach', label: 'west along the river', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-far-bank-track',
      name: 'Far Bank Track',
      description: 'The road climbs away from the bridge onto firmer ground. Bellwold River Bridge is north; the old mile marker is south.',
      mapPosition: { x: 0, y: -8, terrain: 'land' },
      exits: [
        { id: 'far-bank-track-to-bridge', fromLocationId: 'bellwold-far-bank-track', toLocationId: 'bellwold-river-bridge', label: 'north', direction: 'north', toStateId: 'on', roadId: 'bellwold-south-road' },
        { id: 'far-bank-track-to-mile-marker', fromLocationId: 'bellwold-far-bank-track', toLocationId: 'bellwold-south-mile-marker', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'bellwold-south-mile-marker',
      name: 'Old South Mile Marker',
      description: 'A weathered stone marker stands beside the packed road. Most of its face is worn smooth; shallow grooves remain beneath the lichen. Far Bank Track is north; the unfinished road lies south.',
      mapPosition: { x: 0, y: -9, terrain: 'land' },
      exits: [
        { id: 'mile-marker-to-far-bank', fromLocationId: 'bellwold-south-mile-marker', toLocationId: 'bellwold-far-bank-track', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
        { id: 'mile-marker-to-road-end', fromLocationId: 'bellwold-south-mile-marker', toLocationId: 'bellwold-unfinished-road-end', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
      readables: [
        {
          id: 'old-south-mile-marker-inscription',
          label: 'Mile marker inscription',
          description: 'A shallow inscription cut into the marker face.',
          text: 'The surviving inscription records a distance from Bellwold. Its destination name has worn away.',
        },
      ],
    },
    {
      id: 'bellwold-unfinished-road-end',
      name: 'Unfinished South Road',
      description: 'The packed road ends at a shallow cut in the earth. Loose soil and ungraded ground extend beyond it, with no roofs visible. The old mile marker is north.',
      mapPosition: { x: 0, y: -10, terrain: 'land' },
      exits: [
        { id: 'unfinished-road-to-mile-marker', fromLocationId: 'bellwold-unfinished-road-end', toLocationId: 'bellwold-south-mile-marker', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'old-bell-tower-approach',
      name: 'Old Bell Tower Road',
      description: 'The road climbs north, and Bellwold’s roofs drop from view behind a rise. The old tower’s outline stands against the sky. A narrow track branches east, where water glints beside the mill.',
      mapPosition: { x: 0, y: 1, terrain: 'land' },
      exits: [
        { id: 'tower-road-to-square', fromLocationId: 'old-bell-tower-approach', toLocationId: 'bellwold-market-square', label: 'south', direction: 'south' },
        { id: 'tower-road-to-tower', fromLocationId: 'old-bell-tower-approach', toLocationId: 'old-bell-tower', label: 'north', direction: 'north' },
        { id: 'tower-road-to-mill', fromLocationId: 'old-bell-tower-approach', toLocationId: 'abandoned-watermill', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'old-bell-tower',
      name: 'Old Bell Tower',
      description: 'Dust gathers in the seams between the stones. A bronze bell hangs motionless in a weathered frame; its clapper rests against its side.',
      mapPosition: { x: 0, y: 2, terrain: 'building' },
      exits: [
        { id: 'tower-to-road', fromLocationId: 'old-bell-tower', toLocationId: 'old-bell-tower-approach', label: 'south', direction: 'south' },
      ],
      readables: [
        {
          id: 'bellwold-tower-inscription',
          label: 'Tower inscription',
          description: 'A weathered inscription at the tower entrance.',
          text: 'A copied account says the bell was heard before storms. It also records the period when seventeen villagers disappeared while the bell sounded continuously. The account does not explain what connected those events, or why the bell later fell silent.',
        },
      ],
    },
    {
      id: 'abandoned-watermill',
      name: 'Abandoned Watermill',
      description: 'The air by the channel is damp and cool. A slow wooden creak carries from the wheel, and water glints through the channel. A damp work ledger lies open on the desk. The tower road is west; the east track follows the channel.',
      mapPosition: { x: 1, y: 1, terrain: 'land' },
      exits: [
        { id: 'mill-to-tower-road', fromLocationId: 'abandoned-watermill', toLocationId: 'old-bell-tower-approach', label: 'west', direction: 'west' },
        { id: 'mill-to-east-track', fromLocationId: 'abandoned-watermill', toLocationId: 'bellwold-east-mill-track', label: 'east', direction: 'east', roadId: 'bellwold-east-mill-road' },
      ],
      readables: [
        {
          id: 'mill-work-ledger',
          label: 'Mill work ledger',
          description: 'A damp ledger left on the mill desk.',
          text: 'The last entries record the mill wheel moving on nights when the channel ran low. The writer notes the dates, water level, and movement, but gives no explanation.',
        },
      ],
    },
    {
      id: 'bellwold-east-mill-track',
      name: 'East Mill Track',
      description: 'The road leaves the mill and runs east between shallow drainage channels. The abandoned watermill is west; a bend in the track lies east.',
      mapPosition: { x: 2, y: 1, terrain: 'gravel' },
      exits: [
        { id: 'east-mill-track-to-mill', fromLocationId: 'bellwold-east-mill-track', toLocationId: 'abandoned-watermill', label: 'west', direction: 'west', roadId: 'bellwold-east-mill-road' },
        { id: 'east-mill-track-to-bend', fromLocationId: 'bellwold-east-mill-track', toLocationId: 'bellwold-east-road-bend', label: 'east', direction: 'east', roadId: 'bellwold-east-mill-road' },
      ],
    },
    {
      id: 'bellwold-east-road-bend',
      name: 'East Road Bend',
      description: 'The packed track curves around a low rise; the mill channel has vanished from view. A narrower path branches north toward the old church. East Mill Track is west; the road verge is east.',
      mapPosition: { x: 3, y: 1, terrain: 'gravel' },
      exits: [
        { id: 'east-road-bend-to-track', fromLocationId: 'bellwold-east-road-bend', toLocationId: 'bellwold-east-mill-track', label: 'west', direction: 'west', roadId: 'bellwold-east-mill-road' },
        { id: 'east-road-bend-to-verge', fromLocationId: 'bellwold-east-road-bend', toLocationId: 'bellwold-east-road-verge', label: 'east', direction: 'east', roadId: 'bellwold-east-mill-road' },
        { id: 'east-road-bend-to-church-track', fromLocationId: 'bellwold-east-road-bend', toLocationId: 'bellwold-north-church-track', label: 'north toward the abandoned church', direction: 'north', roadId: 'bellwold-north-church-road' },
      ],
    },
    {
      id: 'bellwold-north-church-track',
      name: 'North Church Track',
      description: 'A narrow track climbs north between low banks of grass. Wind combs the grass as the road rises; East Road Bend is south and the church approach is north.',
      mapPosition: { x: 3, y: 2, terrain: 'dirt' },
      exits: [
        { id: 'church-track-to-east-bend', fromLocationId: 'bellwold-north-church-track', toLocationId: 'bellwold-east-road-bend', label: 'south to East Road Bend', direction: 'south', roadId: 'bellwold-north-church-road' },
        { id: 'church-track-to-approach', fromLocationId: 'bellwold-north-church-track', toLocationId: 'bellwold-church-approach', label: 'north to the church approach', direction: 'north', roadId: 'bellwold-north-church-road' },
      ],
    },
    {
      id: 'bellwold-church-approach',
      name: 'Church Approach',
      description: 'The track opens into bare ground before a dark timber doorway. Wind pushes dry leaves across the clearing; the entrance is north and the road returns south.',
      mapPosition: { x: 3, y: 3, terrain: 'land' },
      exits: [
        { id: 'church-approach-to-track', fromLocationId: 'bellwold-church-approach', toLocationId: 'bellwold-north-church-track', label: 'south along the road', direction: 'south', roadId: 'bellwold-north-church-road' },
        { id: 'church-approach-to-church', fromLocationId: 'bellwold-church-approach', toLocationId: 'bellwold-abandoned-church', label: 'north into the church', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-abandoned-church',
      name: 'Abandoned Church',
      description: 'Dust powders the stone floor, and muted light falls through gaps in the roof. A narrow stair climbs toward a frame overhead; worn steps descend below.',
      mapPosition: { x: 3, y: 4, z: 0, terrain: 'building' },
      exits: [
        { id: 'church-to-approach', fromLocationId: 'bellwold-abandoned-church', toLocationId: 'bellwold-church-approach', label: 'south to the church approach', direction: 'south' },
        { id: 'church-to-belfry', fromLocationId: 'bellwold-abandoned-church', toLocationId: 'bellwold-church-belfry', label: 'up to the belfry', direction: 'up' },
        { id: 'church-to-annex', fromLocationId: 'bellwold-abandoned-church', toLocationId: 'bellwold-church-annex', label: 'down to the annex', direction: 'down' },
      ],
    },
    {
      id: 'bellwold-church-belfry',
      name: 'Church Belfry',
      description: 'Wind cuts through the narrow belfry. A weathered frame hangs over the roofline, ringed by empty mounting holes; a cut length of rope taps against it. The stair leads down to the nave.',
      mapAreaId: 'bellwold-abandoned-church',
      mapPosition: { x: 3, y: 4, z: 1, terrain: 'building' },
      exits: [
        { id: 'belfry-to-church', fromLocationId: 'bellwold-church-belfry', toLocationId: 'bellwold-abandoned-church', label: 'down to the church', direction: 'down' },
      ],
    },
    {
      id: 'bellwold-church-annex',
      name: 'Church Annex',
      description: 'The steps descend into a low stone room. Damp darkens the mortar, and shallow shelves run along the walls. A locked iron door stands to the east; the stair leads up.',
      mapAreaId: 'bellwold-abandoned-church',
      mapPosition: { x: 3, y: 4, z: -1, terrain: 'building' },
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
      exits: [
        { id: 'annex-to-church', fromLocationId: 'bellwold-church-annex', toLocationId: 'bellwold-abandoned-church', label: 'up to the church', direction: 'up' },
        {
          id: 'annex-to-crypt-entry',
          fromLocationId: 'bellwold-church-annex',
          toLocationId: 'bellwold-church-crypt-entry',
          label: 'east through the iron door',
          direction: 'east',
          requiredInteractionId: 'unlock-bellwold-church-door',
        },
      ],
    },
    {
      id: 'bellwold-church-crypt-entry',
      name: 'Undercrypt Entry',
      description: 'A low stone corridor begins beyond the iron door. Damp air carries the smell of earth; a shallow recess opens east, the passage runs north, and the annex lies west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 4, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-entry-to-annex', fromLocationId: 'bellwold-church-crypt-entry', toLocationId: 'bellwold-church-annex', label: 'west to the annex', direction: 'west' },
        { id: 'crypt-entry-to-passage', fromLocationId: 'bellwold-church-crypt-entry', toLocationId: 'bellwold-crypt-entry-passage', label: 'north', direction: 'north' },
        { id: 'crypt-entry-to-recess', fromLocationId: 'bellwold-church-crypt-entry', toLocationId: 'bellwold-crypt-entry-recess', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-entry-recess',
      name: 'Entry Recess',
      description: 'The eastern recess ends at bare stone. A smooth layer of dust covers the floor; the corridor returns west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 5, y: 4, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-recess-to-entry', fromLocationId: 'bellwold-crypt-entry-recess', toLocationId: 'bellwold-church-crypt-entry', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-crypt-entry-passage',
      name: 'First Passage',
      description: 'Rough stone presses close on either side, leaving space for two people to pass. Footsteps echo toward a fork north; the entry lies south.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 5, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-passage-to-entry', fromLocationId: 'bellwold-crypt-entry-passage', toLocationId: 'bellwold-church-crypt-entry', label: 'south', direction: 'south' },
        { id: 'crypt-passage-to-fork', fromLocationId: 'bellwold-crypt-entry-passage', toLocationId: 'bellwold-crypt-fork', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-crypt-fork',
      name: 'Three-Way Fork',
      description: 'Three worn corridors meet beneath a cracked arch. Fine grit crunches underfoot; the first passage is south, the central hall north, and narrow branches open east and west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 6, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-fork-to-passage', fromLocationId: 'bellwold-crypt-fork', toLocationId: 'bellwold-crypt-entry-passage', label: 'south', direction: 'south' },
        { id: 'crypt-fork-to-central-hall', fromLocationId: 'bellwold-crypt-fork', toLocationId: 'bellwold-crypt-central-hall', label: 'north', direction: 'north' },
        { id: 'crypt-fork-to-west-blind-passage', fromLocationId: 'bellwold-crypt-fork', toLocationId: 'bellwold-crypt-west-blind-passage', label: 'west', direction: 'west' },
        { id: 'crypt-fork-to-east-bend', fromLocationId: 'bellwold-crypt-fork', toLocationId: 'bellwold-crypt-east-bend', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-west-blind-passage',
      name: 'Blind Passage',
      description: 'The western branch stops at a rough stone wall; loose grit gathers at its base. The fork lies east.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 6, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-blind-passage-to-fork', fromLocationId: 'bellwold-crypt-west-blind-passage', toLocationId: 'bellwold-crypt-fork', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-east-bend',
      name: 'Eastern Bend',
      description: 'Stone walls curve north, where a colder draft threads through the passage. The fork lies west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 5, y: 6, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-east-bend-to-fork', fromLocationId: 'bellwold-crypt-east-bend', toLocationId: 'bellwold-crypt-fork', label: 'west', direction: 'west' },
        { id: 'crypt-east-bend-to-east-corridor', fromLocationId: 'bellwold-crypt-east-bend', toLocationId: 'bellwold-crypt-east-corridor', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-crypt-east-corridor',
      name: 'Eastern Corridor',
      description: 'Bootsteps echo down the straight corridor. The central hall opens west, the passage returns south, and a short branch ends east.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 5, y: 7, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-east-corridor-to-east-bend', fromLocationId: 'bellwold-crypt-east-corridor', toLocationId: 'bellwold-crypt-east-bend', label: 'south', direction: 'south' },
        { id: 'crypt-east-corridor-to-central-hall', fromLocationId: 'bellwold-crypt-east-corridor', toLocationId: 'bellwold-crypt-central-hall', label: 'west', direction: 'west' },
        { id: 'crypt-east-corridor-to-dead-end', fromLocationId: 'bellwold-crypt-east-corridor', toLocationId: 'bellwold-crypt-east-dead-end', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-east-dead-end',
      name: 'Eastern Dead End',
      description: 'The eastern corridor ends at a collapsed stone niche; fine dust lies undisturbed across the floor. The corridor is west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 6, y: 7, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-east-dead-end-to-corridor', fromLocationId: 'bellwold-crypt-east-dead-end', toLocationId: 'bellwold-crypt-east-corridor', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-crypt-central-hall',
      name: 'Central Hall',
      description: 'A square chamber gathers the echoes of four passages. Cold air spills from the northern route; the fork lies south, with cross-corridors west and east.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 7, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-central-hall-to-fork', fromLocationId: 'bellwold-crypt-central-hall', toLocationId: 'bellwold-crypt-fork', label: 'south', direction: 'south' },
        { id: 'crypt-central-hall-to-west-corridor', fromLocationId: 'bellwold-crypt-central-hall', toLocationId: 'bellwold-crypt-west-corridor', label: 'west', direction: 'west' },
        { id: 'crypt-central-hall-to-east-corridor', fromLocationId: 'bellwold-crypt-central-hall', toLocationId: 'bellwold-crypt-east-corridor', label: 'east', direction: 'east' },
        { id: 'crypt-central-hall-to-north-passage', fromLocationId: 'bellwold-crypt-central-hall', toLocationId: 'bellwold-crypt-north-passage', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-crypt-west-corridor',
      name: 'Western Corridor',
      description: 'A narrow passage runs west from the central hall; a stone shelf juts from the northern wall into a shallow recess.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 7, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-west-corridor-to-central-hall', fromLocationId: 'bellwold-crypt-west-corridor', toLocationId: 'bellwold-crypt-central-hall', label: 'east', direction: 'east' },
        { id: 'crypt-west-corridor-to-recess', fromLocationId: 'bellwold-crypt-west-corridor', toLocationId: 'bellwold-crypt-west-recess', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-crypt-west-recess',
      name: 'Western Burial Recess',
      description: 'A stone shelf juts from the wall of this shallow recess; dust gathers along its edge. The passage returns south.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 8, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-west-recess-to-corridor', fromLocationId: 'bellwold-crypt-west-recess', toLocationId: 'bellwold-crypt-west-corridor', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-crypt-north-passage',
      name: 'Northern Passage',
      description: 'Cool air brushes through the straight passage. The central hall lies south; a larger junction waits north.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 8, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-north-passage-to-central-hall', fromLocationId: 'bellwold-crypt-north-passage', toLocationId: 'bellwold-crypt-central-hall', label: 'south', direction: 'south' },
        { id: 'crypt-north-passage-to-upper-junction', fromLocationId: 'bellwold-crypt-north-passage', toLocationId: 'bellwold-crypt-upper-junction', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-crypt-upper-junction',
      name: 'Upper Junction',
      description: 'Stone branches meet beneath an old lintel. Dust shifts in a draft; the northern passage is south, recesses open east and west, and a narrow route continues north.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 9, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-upper-junction-to-north-passage', fromLocationId: 'bellwold-crypt-upper-junction', toLocationId: 'bellwold-crypt-north-passage', label: 'south', direction: 'south' },
        { id: 'crypt-upper-junction-to-west-recess', fromLocationId: 'bellwold-crypt-upper-junction', toLocationId: 'bellwold-crypt-west-burial-recess', label: 'west', direction: 'west' },
        { id: 'crypt-upper-junction-to-east-recess', fromLocationId: 'bellwold-crypt-upper-junction', toLocationId: 'bellwold-crypt-east-burial-recess', label: 'east', direction: 'east' },
        { id: 'crypt-upper-junction-to-north-approach', fromLocationId: 'bellwold-crypt-upper-junction', toLocationId: 'bellwold-crypt-north-approach', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-crypt-west-burial-recess',
      name: 'West Burial Recess',
      description: 'A narrow stone shelf projects from the western wall, its surface dulled by dust. The junction lies east.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 9, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-west-burial-recess-to-junction', fromLocationId: 'bellwold-crypt-west-burial-recess', toLocationId: 'bellwold-crypt-upper-junction', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-east-burial-recess',
      name: 'East Burial Recess',
      description: 'A cracked stone slab rests in the small recess, its surface scored with pale lines. The junction lies west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 5, y: 9, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-east-burial-recess-to-junction', fromLocationId: 'bellwold-crypt-east-burial-recess', toLocationId: 'bellwold-crypt-upper-junction', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-crypt-north-approach',
      name: 'Reliquary Approach',
      description: 'A squared arch rises ahead; cool, still air flows from a chamber to the north. The upper junction lies south.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 10, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-approach-to-junction', fromLocationId: 'bellwold-crypt-north-approach', toLocationId: 'bellwold-crypt-upper-junction', label: 'south', direction: 'south' },
        { id: 'crypt-approach-to-reliquary', fromLocationId: 'bellwold-crypt-north-approach', toLocationId: 'bellwold-church-reliquary', label: 'north', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-church-reliquary',
      name: 'Church Reliquary',
      description: 'Dry, still air hangs in the chamber. A narrow sword rests on a black stone shelf beneath a faded carving of a watchful hand.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 4, y: 11, z: -1, terrain: 'building' },
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
      exits: [
        { id: 'reliquary-to-approach', fromLocationId: 'bellwold-church-reliquary', toLocationId: 'bellwold-crypt-north-approach', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-east-road-verge',
      name: 'Eastern Road Verge',
      description: 'The packed track ends at open ground beyond the bend. Grass pushes through the wheel ruts, and the eastern way is overgrown. The bend lies west.',
      mapPosition: { x: 4, y: 1, terrain: 'land' },
      exits: [
        { id: 'east-road-verge-to-bend', fromLocationId: 'bellwold-east-road-verge', toLocationId: 'bellwold-east-road-bend', label: 'west', direction: 'west', roadId: 'bellwold-east-mill-road' },
      ],
    },
  ],
  roads: [
    {
      id: 'bellwold-south-road',
      name: 'Bellwold South Road',
      locationIds: [
        'bellwold-south-gate',
        'bellwold-southbound-track',
        'bellwold-reedbed-approach',
        'bellwold-river-bridge',
        'bellwold-far-bank-track',
        'bellwold-south-mile-marker',
        'bellwold-unfinished-road-end',
      ],
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-south-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'bellwold-east-mill-road',
      name: 'Bellwold East Mill Road',
      locationIds: [
        'abandoned-watermill',
        'bellwold-east-mill-track',
        'bellwold-east-road-bend',
        'bellwold-east-road-verge',
      ],
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-east-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'bellwold-north-church-road',
      name: 'Bellwold North Church Road',
      locationIds: [
        'bellwold-east-road-bend',
        'bellwold-north-church-track',
        'bellwold-church-approach',
      ],
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-north-church-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    {
      id: 'bellwold-west-road',
      name: 'Bellwold West Road',
      locationIds: [
        'bellwold-west-gate',
        'bellwold-westbound-track',
        'bellwold-west-road-end',
      ],
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-west-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
  ],
  quests: [
    {
      id: 'bellwold-mill-observations',
      version: '1.0.0',
      title: 'The Mill Ledger',
      summary: 'Read the abandoned watermill’s work ledger and report its recorded observations to Anwen. The record does not establish why the wheel moved.',
      giverNpcId: 'anwen-marr',
      turnInNpcId: 'anwen-marr',
      objectives: [
        {
          id: 'read-mill-ledger',
          label: 'Read the work ledger at the abandoned watermill',
          type: 'read-object',
          objectId: 'mill-work-ledger',
          locationId: 'abandoned-watermill',
        },
      ],
    },
    {
      id: 'bellwold-church-sword',
      version: '1.0.0',
      title: 'The Church Reliquary',
      summary: 'Find the old church key in the Old Grain House, open the annex beneath the abandoned church, and recover the reliquary sword. Return it to Anwen for 20 gold; she will inspect it and return the same blade to you.',
      scope: 'character',
      giverNpcId: 'anwen-marr',
      turnInNpcId: 'anwen-marr',
      reward: {
        currencyId: 'gold',
        amount: 20,
        itemIds: ['bellwold-reliquary-sword'],
      },
      objectives: [
        {
          id: 'find-church-key',
          label: 'Find the old church key behind the Old Grain House tally cabinet',
          type: 'possess-item',
          itemId: 'bellwold-church-annex-key',
        },
        {
          id: 'unlock-church-annex',
          label: 'Unlock the iron door in the church annex',
          type: 'perform-interaction',
          interactionId: 'unlock-bellwold-church-door',
          locationId: 'bellwold-church-annex',
        },
        {
          id: 'recover-church-sword',
          label: 'Recover the reliquary sword from the undercrypt',
          type: 'possess-item',
          itemId: 'bellwold-reliquary-sword',
        },
      ],
    },
  ],
} as const;

export const orravethWorld: WorldPackDraft = WorldPackDraftSchema.parse(draft);
const graphErrors = validateDraftWorldGraph(orravethWorld);
if (graphErrors.length > 0) {
  throw new Error(`Invalid Orraveth world graph:\n${graphErrors.map((error) => `- ${error}`).join('\n')}`);
}

export const ORRAVETH_WORLD_SUMMARY =
  'Explore Bellwold, a frontier settlement with local residents, the silent old bell, roads beyond town, and a maze beneath the abandoned church.';
