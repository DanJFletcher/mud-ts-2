import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type WorldPackDraft,
} from '@mudd/contracts';

export const ORRAVETH_WORLD_INSTANCE_ID = 'orraveth-bellwold-instance';

const draft = {
  formatVersion: 1,
  packId: 'orraveth.bellwold',
  packVersion: '1.6.0',
  displayName: 'Orraveth: Bellwold',
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
      description: 'Bellwold’s market square anchors a larger frontier settlement. Stalls and handcarts crowd the open ground on busy mornings, while the inn and general shop serve travelers and residents through the day.\n\nThe Kindly Roof lies west, Marr’s General Goods east, the old tower road north, and South Common south. The western road begins beyond the inn; the east road passes through the old mill.',
      mapPosition: { x: 0, y: 0, terrain: 'cobblestone' },
      npcs: [
        {
          id: 'linnet-reed',
          name: 'Linnet Reed',
          description: 'Linnet Reed is a Bellwold villager on foot between the market, the well, and the settlement’s shared spaces.',
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
          description: 'Taren Voss is a Bellwold watch guard, keeping an eye on the road, the square, and the southern public lanes.',
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
      description: 'The Kindly Roof is Bellwold’s working inn, kept by Tomas. The common room holds the warmth of a banked fire and the low murmur of travelers comparing what they have heard on the road.\n\nA place to sleep is also a place to exchange news; Tomas listens without pretending every rumor is true. The west road begins outside the inn.',
      mapPosition: { x: -1, y: 0, terrain: 'building' },
      exits: [
        { id: 'inn-to-square', fromLocationId: 'kindly-roof-inn', toLocationId: 'bellwold-market-square', label: 'east', direction: 'east' },
        { id: 'inn-to-west-gate', fromLocationId: 'kindly-roof-inn', toLocationId: 'bellwold-west-gate', label: 'west', direction: 'west' },
      ],
      npcs: [
        {
          id: 'tomas-innkeeper',
          name: 'Tomas',
          description: 'Tomas keeps the Kindly Roof. He gives each traveler his attention, but weighs a story before passing it on.',
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
      description: 'The maintained track thins beside a stretch of scrub and open ground. No marked destination lies farther west yet; the road leads back east toward Bellwold.',
      mapPosition: { x: -4, y: 0, terrain: 'land' },
      exits: [
        { id: 'west-road-end-to-track', fromLocationId: 'bellwold-west-road-end', toLocationId: 'bellwold-westbound-track', label: 'east', direction: 'east', roadId: 'bellwold-west-road' },
      ],
    },
    {
      id: 'marrs-general-goods',
      name: 'Marr’s General Goods',
      description: 'Shelves of everyday provisions line Marr’s General Goods. Near the counter, Anwen’s balance scale waits beside the ledger. Its readings are repeatable often enough to trouble her, but their cause is still unknown.',
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
          description: 'Anwen Marr runs the shop. She checks each measure carefully and keeps her observations close at hand.',
          greeting: '“Welcome. If you want to understand a thing, start with what it does—not with what you hope it means.”',
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
      description: 'The street widens into a practical green where neighbors pause beside benches, drying lines, and a public notice board. Work carries on around it without the market-square bustle.\n\nThe market square is north, the Green Mortar west, Blackwater Forge east, and Well Court south.',
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
      description: 'Bundles of dried plants hang above a workbench, and clean cloth is folded within reach. Ilya keeps the room orderly enough for careful work, though the village brings in mud, rain, and ordinary interruptions.\n\nThe open green is east; Wattle Row is south.',
      mapPosition: { x: -1, y: -1, terrain: 'building' },
      exits: [
        { id: 'green-mortar-to-south-common', fromLocationId: 'green-mortar', toLocationId: 'bellwold-south-common', label: 'east', direction: 'east' },
        { id: 'green-mortar-to-wattle-row', fromLocationId: 'green-mortar', toLocationId: 'bellwold-wattle-row', label: 'south', direction: 'south' },
      ],
      npcs: [
        {
          id: 'ilya-fen',
          name: 'Ilya Fen',
          description: 'Ilya Fen tends Bellwold’s Green Mortar, sorting local plants and practical care from claims that have not been tested.',
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
      description: 'A low forge stands open to the street, its stone hearth dark between jobs. Tongs, hammers, and half-mended farm fittings hang within reach; the smell of coal clings to the beams.\n\nSouth Common is west.',
      mapPosition: { x: 1, y: -1, terrain: 'building' },
      exits: [
        { id: 'blackwater-forge-to-south-common', fromLocationId: 'blackwater-forge', toLocationId: 'bellwold-south-common', label: 'west', direction: 'west' },
      ],
      npcs: [
        {
          id: 'darric-holt',
          name: 'Darric Holt',
          description: 'Darric Holt works at the forge, repairing tools and fittings used around the settlement.',
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
      description: 'Low homes and work yards line a narrow lane, their wattle walls patched with whatever material the season has left to hand. The Green Mortar is north, Well Court east, a wheelwright’s yard west, and Tallow End Cottage south.',
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
      description: 'A turning frame, wooden spokes, and a rack of finished rims fill this fenced yard. Shavings gather in the corners despite the broom leaning by the gate.\n\nWattle Row is east.',
      mapPosition: { x: -2, y: -2, terrain: 'building' },
      exits: [
        { id: 'sovens-yard-to-wattle-row', fromLocationId: 'sovens-wheelwright-yard', toLocationId: 'bellwold-wattle-row', label: 'east', direction: 'east' },
      ],
      npcs: [
        {
          id: 'rell-soven',
          name: 'Rell Soven',
          description: 'Rell Soven builds and repairs wheels, axles, and wooden fittings for Bellwold’s carts.',
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
      ],
      npcs: [
        {
          id: 'seli-tor',
          name: 'Seli Tor',
          description: 'Seli Tor weaves and mends cloth at home, taking on work from neighbors when the loom is free.',
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
      description: 'The timber storehouse is built on a raised stone sill. Vent gaps run high along the walls, and chalk marks divide the bins by season rather than by owner.\n\nWell Court is west.',
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
          description: 'Aven Rusk keeps the grain house’s records and checks that the stored sacks remain dry and accounted for.',
          greeting: '“If you need the store, tell me what you are looking for. I keep the tally, not the harvest.”',
          topics: [
            { id: 'stores', keywords: ['grain', 'store', 'stores', 'harvest', 'sacks'], response: '“The chalk marks show what is stored and when it was checked. They do not tell us what next season will bring.”' },
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
      description: 'The Common House is a plain timber building with a long table, benches, and a wall of notices copied from the market board. Neighbors use it for meetings and shared work rather than ceremony.\n\nWell Court is north, Tallow End Cottage is west, and the south road leaves town beyond the last yards.',
      mapPosition: { x: 0, y: -3, terrain: 'building' },
      exits: [
        { id: 'common-house-to-well-court', fromLocationId: 'bellwold-common-house', toLocationId: 'bellwold-well-court', label: 'north', direction: 'north' },
        { id: 'common-house-to-tallow-cottage', fromLocationId: 'bellwold-common-house', toLocationId: 'tallow-end-cottage', label: 'west', direction: 'west' },
        { id: 'common-house-to-south-gate', fromLocationId: 'bellwold-common-house', toLocationId: 'bellwold-south-gate', label: 'south', direction: 'south' },
      ],
      npcs: [
        {
          id: 'enna-pell',
          name: 'Enna Pell',
          description: 'Enna Pell keeps the Common House notices and copies agreed decisions into the village record book.',
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
      ],
    },
    {
      id: 'bellwold-southbound-track',
      name: 'Southbound Track',
      description: 'The packed road runs between open fields and low fence lines, with Bellwold’s roofs receding behind you. The South Gate is north; the reedbed approach lies south.',
      mapPosition: { x: 0, y: -5, terrain: 'pasture' },
      exits: [
        { id: 'southbound-track-to-gate', fromLocationId: 'bellwold-southbound-track', toLocationId: 'bellwold-south-gate', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
        { id: 'southbound-track-to-reedbed', fromLocationId: 'bellwold-southbound-track', toLocationId: 'bellwold-reedbed-approach', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'bellwold-reedbed-approach',
      name: 'Reedbed Approach',
      description: 'The road dips through damp grass toward a low stone bridge. Reeds line the riverbanks beyond the approach. The Southbound Track is north; Bellwold River Bridge is south.',
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
      description: 'A weathered stone marker stands beside the packed road. Its worn face gives no reliable destination, only a distance from the village. Far Bank Track is north; the unfinished road lies south.',
      mapPosition: { x: 0, y: -9, terrain: 'land' },
      exits: [
        { id: 'mile-marker-to-far-bank', fromLocationId: 'bellwold-south-mile-marker', toLocationId: 'bellwold-far-bank-track', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
        { id: 'mile-marker-to-road-end', fromLocationId: 'bellwold-south-mile-marker', toLocationId: 'bellwold-unfinished-road-end', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'bellwold-unfinished-road-end',
      name: 'Unfinished South Road',
      description: 'The packed road stops at a shallow cut where the ground has been cleared but not graded. No settlement stands beyond this point yet. The only marked route leads north to the old mile marker.',
      mapPosition: { x: 0, y: -10, terrain: 'land' },
      exits: [
        { id: 'unfinished-road-to-mile-marker', fromLocationId: 'bellwold-unfinished-road-end', toLocationId: 'bellwold-south-mile-marker', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'old-bell-tower-approach',
      name: 'Old Bell Tower Road',
      description: 'The road climbs north from the market toward Bellwold’s old tower. From here, the village roofs fall behind the rise, and the tower’s outline stands against the open sky.\n\nThe eastbound mill road follows the water through the abandoned mill and continues beyond it.',
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
      description: 'The old tower rises above Bellwold’s road. Inside, dust settles in the seams of the stonework, and the bell hangs silent where generations of records place it.\n\nThe tower has drawn scholars and local stories. Neither has settled what the bell is or why it stopped ringing.',
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
      description: 'The abandoned watermill stands beside its channel outside Bellwold. The air near the wheel is damp and cool; a slow wooden creak can be heard even when the water runs low.\n\nThe mill’s continued movement is an observation, not an explanation. A work ledger remains on the desk. The road returns west toward the tower and continues east beyond the mill.',
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
      description: 'The track bends around a low rise, with the mill channel now out of sight. East Mill Track is west; the road verge lies east, and a narrower road turns north toward an abandoned church.',
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
      description: 'A narrow track climbs north from East Road Bend between low banks of grass. The bend is south; an open approach before the abandoned church lies north.',
      mapPosition: { x: 3, y: 2, terrain: 'dirt' },
      exits: [
        { id: 'church-track-to-east-bend', fromLocationId: 'bellwold-north-church-track', toLocationId: 'bellwold-east-road-bend', label: 'south to East Road Bend', direction: 'south', roadId: 'bellwold-north-church-road' },
        { id: 'church-track-to-approach', fromLocationId: 'bellwold-north-church-track', toLocationId: 'bellwold-church-approach', label: 'north to the church approach', direction: 'north', roadId: 'bellwold-north-church-road' },
      ],
    },
    {
      id: 'bellwold-church-approach',
      name: 'Church Approach',
      description: 'The track reaches a small open space before the abandoned church. North is the church entrance; the road returns south toward East Road Bend.',
      mapPosition: { x: 3, y: 3, terrain: 'land' },
      exits: [
        { id: 'church-approach-to-track', fromLocationId: 'bellwold-church-approach', toLocationId: 'bellwold-north-church-track', label: 'south along the road', direction: 'south', roadId: 'bellwold-north-church-road' },
        { id: 'church-approach-to-church', fromLocationId: 'bellwold-church-approach', toLocationId: 'bellwold-abandoned-church', label: 'north into the church', direction: 'north' },
      ],
    },
    {
      id: 'bellwold-abandoned-church',
      name: 'Abandoned Church',
      description: 'The abandoned church stands north of the track. Dust has settled over the nave, and weather has darkened the boards beneath the roof. A narrow stair climbs to the belfry; worn stone steps descend to an annex below.',
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
      description: 'The stair opens into a narrow belfry exposed to the wind. A weathered frame hangs above the roofline, but the bell is long gone; only empty mounting bolts and a cut length of rope remain. The stair leads down to the church nave.',
      mapAreaId: 'bellwold-abandoned-church',
      mapPosition: { x: 3, y: 4, z: 1, terrain: 'building' },
      exits: [
        { id: 'belfry-to-church', fromLocationId: 'bellwold-church-belfry', toLocationId: 'bellwold-abandoned-church', label: 'down to the church', direction: 'down' },
      ],
    },
    {
      id: 'bellwold-church-annex',
      name: 'Church Annex',
      description: 'The steps descend into a low stone annex beneath the church. Damp has darkened the mortar, and shallow shelves run along the walls. A locked iron door stands in the eastern wall; the stair leads up to the nave.',
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
      description: 'A low stone corridor begins beyond the iron door. The annex is west, a narrow passage runs north, and a shallow recess opens east.',
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
      description: 'The eastern recess ends at a blank wall. Dust lies smooth on the floor; the corridor returns west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 5, y: 4, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-recess-to-entry', fromLocationId: 'bellwold-crypt-entry-recess', toLocationId: 'bellwold-church-crypt-entry', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-crypt-entry-passage',
      name: 'First Passage',
      description: 'The passage is just wide enough for two people to pass. The entry is south; a fork lies north.',
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
      description: 'Three worn corridors meet beneath a cracked arch. The first passage is south; the central hall is north, with narrow branches to the east and west.',
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
      description: 'The western branch stops at a rough stone wall. The only way back is east to the fork.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 6, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-blind-passage-to-fork', fromLocationId: 'bellwold-crypt-west-blind-passage', toLocationId: 'bellwold-crypt-fork', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-east-bend',
      name: 'Eastern Bend',
      description: 'The eastern branch bends north and joins a longer corridor. The fork is west.',
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
      description: 'A straight corridor meets the central hall to the west, returns south, and ends at a short dead end to the east.',
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
      description: 'The eastern corridor ends at a collapsed niche. The corridor is west.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 6, y: 7, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-east-dead-end-to-corridor', fromLocationId: 'bellwold-crypt-east-dead-end', toLocationId: 'bellwold-crypt-east-corridor', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-crypt-central-hall',
      name: 'Central Hall',
      description: 'A square chamber joins four passages. The fork is south, a cross-corridor runs west and east, and a colder passage continues north.',
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
      description: 'A narrow corridor runs west from the central hall, then ends in a small burial recess to the north.',
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
      description: 'A shallow burial recess ends against stone. The corridor back to the central hall is south.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 8, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-west-recess-to-corridor', fromLocationId: 'bellwold-crypt-west-recess', toLocationId: 'bellwold-crypt-west-corridor', label: 'south', direction: 'south' },
      ],
    },
    {
      id: 'bellwold-crypt-north-passage',
      name: 'Northern Passage',
      description: 'The air grows cooler in this straight passage. The central hall lies south; a larger junction waits north.',
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
      description: 'Three short branches meet beneath an old stone lintel. The northern passage is south, with burial recesses east and west; a narrow route continues north.',
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
      description: 'A narrow stone shelf is set into the western wall. There is no passage onward; the junction is east.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 3, y: 9, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-west-burial-recess-to-junction', fromLocationId: 'bellwold-crypt-west-burial-recess', toLocationId: 'bellwold-crypt-upper-junction', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'bellwold-crypt-east-burial-recess',
      name: 'East Burial Recess',
      description: 'A cracked stone slab rests in this small recess. The corridor returns west to the junction.',
      mapAreaId: 'bellwold-church-undercrypt',
      mapPosition: { x: 5, y: 9, z: -1, terrain: 'building' },
      exits: [
        { id: 'crypt-east-burial-recess-to-junction', fromLocationId: 'bellwold-crypt-east-burial-recess', toLocationId: 'bellwold-crypt-upper-junction', label: 'west', direction: 'west' },
      ],
    },
    {
      id: 'bellwold-crypt-north-approach',
      name: 'Reliquary Approach',
      description: 'A squared arch marks the end of the maze. A quiet chamber lies north; the upper junction is south.',
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
      description: 'The final chamber is dry and still. A narrow sword rests on a black stone shelf beneath a faded carving of a watchful hand.',
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
      description: 'The marked road ends at open ground beyond the bend. No destination is charted farther east yet; the route returns west through the old mill to Bellwold.',
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
