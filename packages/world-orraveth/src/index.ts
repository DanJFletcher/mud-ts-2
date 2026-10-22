import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type WorldPackDraft,
} from '@mudd/contracts';

export const ORRAVETH_WORLD_INSTANCE_ID = 'orraveth-bellwold-instance';

const draft = {
  formatVersion: 1,
  packId: 'orraveth.bellwold',
  packVersion: '1.5.0',
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
      description: 'Bellwold’s market square anchors a larger frontier settlement. Stalls and handcarts crowd the open ground on busy mornings, while the inn and general shop serve travelers and residents through the day.\n\nThe Kindly Roof lies west, Marr’s General Goods east, the old tower road north, and South Common south.',
      mapPosition: { x: 0, y: 0, terrain: 'land' },
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
      description: 'The Kindly Roof is Bellwold’s working inn, kept by Tomas. The common room holds the warmth of a banked fire and the low murmur of travelers comparing what they have heard on the road.\n\nA place to sleep is also a place to exchange news; Tomas listens without pretending every rumor is true.',
      mapPosition: { x: -1, y: 0, terrain: 'building' },
      exits: [
        { id: 'inn-to-square', fromLocationId: 'kindly-roof-inn', toLocationId: 'bellwold-market-square', label: 'east', direction: 'east' },
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
            ],
          },
        },
      ],
    },
    {
      id: 'bellwold-south-common',
      name: 'Bellwold South Common',
      description: 'The street widens into a practical green where neighbors pause beside benches, drying lines, and a public notice board. Work carries on around it without the market-square bustle.\n\nThe market square is north, the Green Mortar west, Blackwater Forge east, and Well Court south.',
      mapPosition: { x: 0, y: -1, terrain: 'land' },
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
      mapPosition: { x: 0, y: -2, terrain: 'land' },
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
        { id: 'common-house-to-south-gate', fromLocationId: 'bellwold-common-house', toLocationId: 'bellwold-south-gate', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
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
        { id: 'south-gate-to-common-house', fromLocationId: 'bellwold-south-gate', toLocationId: 'bellwold-common-house', label: 'north', direction: 'north', roadId: 'bellwold-south-road' },
        { id: 'south-gate-to-track', fromLocationId: 'bellwold-south-gate', toLocationId: 'bellwold-southbound-track', label: 'south', direction: 'south', roadId: 'bellwold-south-road' },
      ],
    },
    {
      id: 'bellwold-southbound-track',
      name: 'Southbound Track',
      description: 'The packed road runs between open fields and low fence lines, with Bellwold’s roofs receding behind you. The South Gate is north; the reedbed approach lies south.',
      mapPosition: { x: 0, y: -5, terrain: 'land' },
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
        { id: 'bridge-under-to-west-reach', fromLocationId: 'bellwold-river-bridge', toLocationId: 'bellwold-river-west-reach', label: 'west', direction: 'west', fromStateId: 'under' },
        { id: 'bridge-under-to-east-reach', fromLocationId: 'bellwold-river-bridge', toLocationId: 'bellwold-river-east-reach', label: 'east', direction: 'east', fromStateId: 'under' },
      ],
    },
    {
      id: 'bellwold-river-west-reach',
      name: 'River West Reach',
      description: 'The current passes the bridge piers and slides west beneath the reeds. The bridge lies east; Willow Reach is west.',
      mapPosition: { x: -1, y: -7, terrain: 'river', visibleWhenUnvisited: true },
      exits: [
        { id: 'west-reach-to-bridge-under', fromLocationId: 'bellwold-river-west-reach', toLocationId: 'bellwold-river-bridge', label: 'east beneath Bellwold River Bridge', direction: 'east', toStateId: 'under' },
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
        { id: 'east-reach-to-bridge-under', fromLocationId: 'bellwold-river-east-reach', toLocationId: 'bellwold-river-bridge', label: 'west beneath Bellwold River Bridge', direction: 'west', toStateId: 'under' },
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
      description: 'The road climbs north from the market toward Bellwold’s old tower. From here, the village roofs fall behind the rise, and the tower’s outline stands against the open sky.\n\nA track east follows the water toward the abandoned mill.',
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
      description: 'The abandoned watermill stands beside its channel outside Bellwold. The air near the wheel is damp and cool; a slow wooden creak can be heard even when the water runs low.\n\nThe mill’s continued movement is an observation, not an explanation. A work ledger remains on the desk.',
      mapPosition: { x: 1, y: 1, terrain: 'land' },
      exits: [
        { id: 'mill-to-tower-road', fromLocationId: 'abandoned-watermill', toLocationId: 'old-bell-tower-approach', label: 'west', direction: 'west' },
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
  ],
  roads: [
    {
      id: 'bellwold-south-road',
      name: 'Bellwold South Road',
      locationIds: [
        'bellwold-common-house',
        'bellwold-south-gate',
        'bellwold-southbound-track',
        'bellwold-reedbed-approach',
        'bellwold-river-bridge',
        'bellwold-far-bank-track',
        'bellwold-south-mile-marker',
        'bellwold-unfinished-road-end',
      ],
      encounterChancePercent: 0,
      encounters: [
        {
          id: 'bellwold-south-road-stray-hound',
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
  ],
} as const;

export const orravethWorld: WorldPackDraft = WorldPackDraftSchema.parse(draft);
const graphErrors = validateDraftWorldGraph(orravethWorld);
if (graphErrors.length > 0) {
  throw new Error(`Invalid Orraveth world graph:\n${graphErrors.map((error) => `- ${error}`).join('\n')}`);
}

export const ORRAVETH_WORLD_SUMMARY =
  'Explore Bellwold, a growing frontier settlement of workshops, shared spaces, local residents, the silent old bell, and an unfinished south road to a river bridge.';
