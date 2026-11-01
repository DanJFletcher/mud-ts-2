import {
  WorldPackDraftSchema,
  WorldLocationsFileSchema,
  WorldLocationGroupsFileSchema,
  WorldRoadsFileSchema,
  composeWorldPackDraft,
  validateDraftWorldGraph,
  type WorldPackDraft,
  type WorldPackContent,
  type NpcDailyJobResponseDefinition,
  type FishingSpeciesDefinition,
} from '@mudd/contracts';
import locations from './map/locations.json' with { type: 'json' };
import locationGroups from './map/location-groups.json' with { type: 'json' };
import roads from './map/roads.json' with { type: 'json' };
import { orravethClassCatalog } from './classes.js';
export { orravethClassCatalog } from './classes.js';

export const ORRAVETH_WORLD_INSTANCE_ID = 'orraveth-bellwold-instance';

function bulletinResponses(
  jobIds: string[], active: string, completed: string,
): NpcDailyJobResponseDefinition[] {
  return jobIds.flatMap((jobId) => [
    { boardId: 'bellwold-notice-board', jobId, status: 'active' as const, response: active },
    { boardId: 'bellwold-notice-board', jobId, status: 'completed' as const, response: completed },
  ]);
}
const seliJobs = bulletinResponses(
  ['seli-hide', 'seli-hides'],
  '“You took my hide notice? Bring the hides to the South Common board when you have them. I have the torn seams ready.”',
  '“Those hides you delivered today will mend a good few seams. Thank you for seeing to my notice.”',
);
const tomasJobs = [
  ...bulletinResponses(
    ['tomas-fish', 'tomas-fish-basket'],
    '“Thank you for taking the fish notice. Deliver them at the South Common board; there is room in the supper pot.”',
    '“Your fish arrived from the board today. Supper will be better for it—thank you.”',
  ),
  ...bulletinResponses(
    ['tomas-wood'],
    '“You are bringing pine logs for the kitchen? Leave them through the South Common board when you are ready.”',
    '“The kitchen has the pine logs you delivered today. That is one less worry before supper. Thank you.”',
  ),
];
const darricJobs = bulletinResponses(
  ['darric-wood'],
  '“You took the pine-log job. Good. Deliver the logs at the South Common board when you have enough.”',
  '“Your pine logs came through today. Useful work for the forge. Thank you.”',
);
function bulletinTopic(dailyJobResponses: NpcDailyJobResponseDefinition[]) {
  return {
    id: 'bulletin-jobs', keywords: ['job', 'jobs', 'bulletin', 'notice'],
    response: '“Check the South Common bulletin board for today’s jobs. Accept and deliver there.”',
    dailyJobResponses,
  };
}

function bellwoldSmallTalkChoices(
  npcId: string,
  identity: string,
  activity: string,
  town: string,
  additionalQuestions: Array<{
    id: string;
    label: string;
    response: string;
    requiresProgressFlagIds?: string[];
    hideAfterProgressFlagIds?: string[];
  }> = [],
  hideInitialChoicesAfterProgressFlagIds: string[] = [],
  requireInitialChoicesAfterProgressFlagIds: string[] = [],
  townName = 'Bellwold',
) {
  const initialChoiceVisibility = {
    hideAfterProgressFlagIds: hideInitialChoicesAfterProgressFlagIds.length
      ? hideInitialChoicesAfterProgressFlagIds
      : [`${npcId}-asked-about-town`],
    ...(requireInitialChoicesAfterProgressFlagIds.length
      ? { requiresProgressFlagIds: requireInitialChoicesAfterProgressFlagIds }
      : {}),
  };
  return [
    {
      id: `${npcId}-who-are-you`,
      label: 'Who are you?',
      response: identity,
      progressFlagId: `${npcId}-asked-who`,
      ...initialChoiceVisibility,
    },
    {
      id: `${npcId}-what-are-you-doing`,
      label: 'What are you doing?',
      response: activity,
      progressFlagId: `${npcId}-asked-activity`,
      ...initialChoiceVisibility,
    },
    {
      id: `${npcId}-about-${townName.toLowerCase()}`,
      label: `What is ${townName} like?`,
      response: town,
      progressFlagId: `${npcId}-asked-about-town`,
      ...initialChoiceVisibility,
    },
    ...additionalQuestions.map(({ id, label, response, requiresProgressFlagIds, hideAfterProgressFlagIds }) => {
      const required = [...new Set([
        ...(requiresProgressFlagIds ?? [`${npcId}-asked-about-town`]),
        ...requireInitialChoicesAfterProgressFlagIds,
      ])];
      return {
        id: `${npcId}-${id}`,
        label,
        response,
        progressFlagId: `${npcId}-asked-${id}`,
        ...(required.length ? { requiresProgressFlagIds: required } : {}),
        ...(hideAfterProgressFlagIds?.length ? { hideAfterProgressFlagIds } : {}),
      };
    }),
  ];
}

function banditEncounter(id: string): WorldPackContent['roadRules'][string]['encounters'][number] {
  return {
    id,
    name: 'Bandit',
    combatProfile: { maxHealth: 6, attackDamage: 1, style: 'steady' },
    loot: {
      items: [],
      chanceItems: [{
        item: {
          id: 'bandit-knife-template',
          typeId: 'bandit-knife',
          label: 'Bandit knife',
          description: 'A narrow knife with a worn wooden grip and a nicked steel edge.',
          equipment: { slot: 'weapon', attackBonus: 1 },
        },
        chancePercent: 5,
      }],
      currencyAmount: 3,
      currencyChancePercent: 50,
    },
  };
}

const lowerRillFishSpecies = [
  {
    id: 'smallmouth-bass',
    name: 'Smallmouth bass',
    itemTypeId: 'river-fish',
    weightPercent: 50,
    sizeBands: [
      { rarity: 'common', weightPercent: 35, minLengthCm: 15, maxLengthCm: 25, minWeightGrams: 100, maxWeightGrams: 300 },
      { rarity: 'uncommon', weightPercent: 59, minLengthCm: 25, maxLengthCm: 40, minWeightGrams: 300, maxWeightGrams: 1200 },
      { rarity: 'rare', weightPercent: 5, minLengthCm: 45, maxLengthCm: 55, minWeightGrams: 1800, maxWeightGrams: 3000 },
      { rarity: 'trophy', weightPercent: 1, minLengthCm: 56, maxLengthCm: 69, minWeightGrams: 3001, maxWeightGrams: 5410 },
    ],
  },
  {
    id: 'common-carp',
    name: 'Common carp',
    itemTypeId: 'river-fish',
    weightPercent: 45,
    sizeBands: [
      { rarity: 'common', weightPercent: 35, minLengthCm: 25, maxLengthCm: 40, minWeightGrams: 500, maxWeightGrams: 2000 },
      { rarity: 'uncommon', weightPercent: 59, minLengthCm: 45, maxLengthCm: 75, minWeightGrams: 2000, maxWeightGrams: 7000 },
      { rarity: 'rare', weightPercent: 5, minLengthCm: 90, maxLengthCm: 110, minWeightGrams: 15000, maxWeightGrams: 25000 },
      { rarity: 'trophy', weightPercent: 1, minLengthCm: 111, maxLengthCm: 129, minWeightGrams: 40000, maxWeightGrams: 50000 },
    ],
  },
  {
    id: 'rainbow-trout',
    name: 'Rainbow trout',
    itemTypeId: 'river-fish',
    weightPercent: 5,
    sizeBands: [
      { rarity: 'common', weightPercent: 35, minLengthCm: 20, maxLengthCm: 30, minWeightGrams: 100, maxWeightGrams: 300 },
      { rarity: 'uncommon', weightPercent: 59, minLengthCm: 30, maxLengthCm: 50, minWeightGrams: 300, maxWeightGrams: 1500 },
      { rarity: 'rare', weightPercent: 5, minLengthCm: 60, maxLengthCm: 85, minWeightGrams: 3000, maxWeightGrams: 8000 },
      { rarity: 'trophy', weightPercent: 1, minLengthCm: 86, maxLengthCm: 107, minWeightGrams: 8001, maxWeightGrams: 21770 },
    ],
  },
] satisfies FishingSpeciesDefinition[];

const content = {
  formatVersion: 1,
  packId: 'orraveth.bellwold',
  packVersion: '1.20.0',
  displayName: 'Orraveth: Bellwold',
  dailyBoards: [{
    id: 'bellwold-notice-board', locationId: 'bellwold-south-common', name: 'South Common bulletin board',
    slots: [
      [
        { id: 'seli-hide', poster: 'Seli Tor', title: 'A hide for repairs', supplyTypeId: 'deer-hide', quantity: 1, gold: 5, experience: 8 },
        { id: 'seli-hides', poster: 'Seli Tor', title: 'Hides for winter stitching', supplyTypeId: 'deer-hide', quantity: 2, gold: 9, experience: 12 },
      ],
      [
        { id: 'tomas-fish', poster: 'Tomas', title: 'Fish for the supper pot', supplyTypeId: 'river-fish', quantity: 2, gold: 4, experience: 8 },
        { id: 'tomas-fish-basket', poster: 'Tomas', title: 'Fill the fish basket', supplyTypeId: 'river-fish', quantity: 3, gold: 6, experience: 10 },
      ],
      [
        { id: 'darric-wood', poster: 'Darric Holt', title: 'Pine logs for the forge', supplyTypeId: 'pine-logs', quantity: 2, gold: 3, experience: 6 },
        { id: 'tomas-wood', poster: 'Tomas', title: 'Pine logs for the kitchen hearth', supplyTypeId: 'pine-logs', quantity: 3, gold: 5, experience: 8 },
      ],
    ],
  }],
  supplySources: [],
  woodcuttingTrees: [{
    id: 'bellwold-southbound-pine',
    locationId: 'bellwold-southbound-track',
    label: 'pine',
    roomDescription: 'A pine tree stands beside the packed road, its resin scent sharp in the air.',
    stumpDescription: 'The stump of a pine stands beside the packed road.',
    logTypeId: 'pine-logs',
    logLabel: 'Pine Logs',
    logDescription: 'A bundled set of fresh pine logs, still carrying a sharp resin scent.',
    maximumLogs: 5,
    respawnSeconds: 60,
    experiencePerLog: 25,
    baseChancePercent: 10,
  }],
  craftingWorkbenchLocationIds: ['bellwold-milepost-workshop'],
  craftingRecipes: [
    { id: 'leather-gloves', outputTypeId: 'leather-gloves', outputLabel: 'Leather gloves', outputDescription: 'A small pair of soft, hand-stitched leather gloves. They grant +1 defense when equipped.', equipment: { slot: 'gloves', defenseBonus: 1 }, requiredLevel: 1, experience: 13.8, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
    { id: 'leather-boots', outputTypeId: 'leather-boots', outputLabel: 'Leather boots', outputDescription: 'A pair of sturdy leather boots, cut and stitched by hand. They grant +1 defense when equipped.', equipment: { slot: 'boots', defenseBonus: 1 }, requiredLevel: 1, experience: 16.25, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
    { id: 'leather-cowl', outputTypeId: 'leather-cowl', outputLabel: 'Leather cowl', outputDescription: 'A close-fitting leather cowl with a simple stitched edge. It grants +1 defense when equipped.', equipment: { slot: 'cowl', defenseBonus: 1 }, requiredLevel: 1, experience: 18.5, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
    { id: 'leather-body', outputTypeId: 'leather-body', outputLabel: 'Leather body', outputDescription: 'A plain leather vest, pieced together with close, even stitches. It grants +2 defense when equipped.', equipment: { slot: 'body', defenseBonus: 2 }, requiredLevel: 1, experience: 25, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
    { id: 'leather-chaps', outputTypeId: 'leather-chaps', outputLabel: 'Leather chaps', outputDescription: 'A pair of leather leg guards with a narrow stitched seam. They grant +1 defense when equipped.', equipment: { slot: 'chaps', defenseBonus: 1 }, requiredLevel: 1, experience: 27, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
    { id: 'leather-vambraces', outputTypeId: 'leather-vambraces', outputLabel: 'Leather vambraces', outputDescription: 'A pair of leather forearm guards, neatly secured at the wrist. They grant +1 defense when equipped.', equipment: { slot: 'vambraces', defenseBonus: 1 }, requiredLevel: 11, experience: 22, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
    { id: 'leather-shield', outputTypeId: 'leather-shield', outputLabel: 'Leather shield', outputDescription: 'A small leather-covered shield with a reinforced rim. It grants +2 defense when equipped.', equipment: { slot: 'shield', defenseBonus: 2 }, requiredLevel: 19, experience: 30, toolTypeIds: ['crafting-needle'], ingredients: [{ typeId: 'tanned-deer-hide', label: 'tanned deer hide', quantityPerCraft: 1 }, { typeId: 'spool-of-thread', label: 'Spool of Thread', quantityPerCraft: 1, consumeUses: true }] },
  ],
  fishingSpots: [{
    id: 'bellwold-south-bridge-fishing',
    locationId: 'bellwold-river-bridge',
    stateId: 'on',
    label: 'Lower Rill Bridge',
    tickSeconds: 1,
    species: lowerRillFishSpecies,
  }, {
    id: 'rill-towpath-mooring-fishing',
    locationId: 'rill-towpath-mooring-posts',
    label: 'Towpath mooring posts',
    tickSeconds: 1,
    species: lowerRillFishSpecies,
  }, {
    id: 'mosswake-landing-fishing',
    locationId: 'mosswake-landing',
    label: 'Mosswake landing',
    tickSeconds: 5,
    species: lowerRillFishSpecies,
  }],
  classCatalog: orravethClassCatalog,
  currency: {
    id: 'gold',
    name: 'gold piece',
    symbol: 'g',
    startingBalance: 0,
  },
  locationContent: {
    'mosswake-boat-sheds': {
      npcs: [{
        id: 'tavin-reed',
        name: 'Tavin Reed',
        description: 'A young man kneels beside a shallow hull, a wooden batten held against its curve. Fine shavings cling to his cuffs.',
        activityDescription: 'checking the curve of a shallow hull',
        greeting: '“Mind that batten. A little change in the curve makes a difference in shallow water.”',
        topics: [
          { id: 'hulls', keywords: ['hull', 'boats', 'work', 'channels'], response: '“I fit hulls for these channels and patch them after a hard season. My family knows the marsh, but they do not all read the same water in the same way.”' },
          { id: 'dredging', keywords: ['dredging', 'consortium', 'Veyl'], response: '“The consortium wants to dredge the deposits beneath the water. There could be contracts in it, but a changed channel changes our work too. I want marsh knowledge heard before anyone calls the proposal settled.”' },
          { id: 'fish', keywords: ['fish', 'decline'], response: '“People bring in fewer fish from some stretches. I hear different accounts of how far that goes. I cannot tell you why it is happening.”' },
        ],
        unknownTopicResponse: '“I can speak about hulls and the channels I use. I do not speak for every household.”',
        dialogue: {
          prompt: '“Keep clear of the hull supports. What would you like to know?”',
          choices: bellwoldSmallTalkChoices(
            'tavin-reed',
            '“Tavin Reed. I make and repair boats here. My family has navigated these wetlands for a long time; I am still earning my own standing.”',
            '“Checking this hull against the batten. It needs to sit right in shallow channels, not just look fair on the blocks.”',
            '“Mosswake is an independent community. Fishing, reeds, plants and boats keep us in touch with our neighbours. The people who use the causeway keep it passable.”',
            [
              { id: 'shallow-hulls', label: 'What does shallow water ask of a hull?', response: '“A hull has to suit the channel, and a repair has to last through use. I would rather look at the water with the person taking the boat than guess from here.”' },
              { id: 'dredging', label: 'Has the dredging proposal been agreed?', response: '“No settled agreement that I can give you. The consortium sees deposits and possible contracts; people here also see fishing grounds and changing channels. I want those concerns heard together.”' },
              { id: 'fish', label: 'Why are there fewer fish?', response: '“I do not know. Some families report poorer catches. A report about a catch is not proof of its cause.”' },
            ], [], [], 'Mosswake',
          ),
        },
      }],
    },
    'mosswake-herb-platform': {
      npcs: [{
        id: 'mosswake-herbalist',
        name: 'Herbalist',
        description: 'A person in rolled sleeves separates narrow leaves over a woven tray. Damp stems lie in a basket at their feet.',
        activityDescription: 'sorting leaves on a woven tray',
        greeting: '“Leave the damp bundle apart from the dry ones, please. What are you looking for?”',
        topics: [
          { id: 'plants', keywords: ['herbs', 'plants', 'work'], response: '“We gather medicinal plants when the wetland conditions allow it. A traded bundle does not mean there is an endless supply, or that every household gathers in the same place.”' },
          { id: 'territories', keywords: ['territory', 'territories', 'sprites', 'edge'], response: '“Some families recognise sprite territories beyond those reeds. There is no complete map everyone agrees on. I would not turn a path ending here into permission to go farther.”' },
          { id: 'fish', keywords: ['fish', 'decline'], response: '“Some neighbours say their catches are smaller. I can repeat what they report; I cannot give you a cause.”' },
        ],
        unknownTopicResponse: '“Ask about the plants or the paths I know. Other households may give you another account.”',
        dialogue: {
          prompt: '“These bundles need sorting. I can talk while I do it.”',
          choices: bellwoldSmallTalkChoices(
            'mosswake-herbalist',
            '“A herbalist here in Mosswake. I sort and gather plants; I am not a guide to every part of the marsh.”',
            '“Separating the damp leaves before they spoil the dry bundle.”',
            '“We live above wet ground and keep our own paths and platforms. Different families have different knowledge of the places beyond them.”',
            [
              { id: 'plants', label: 'Are these plants always available?', response: '“No. Water and season matter. We trade herbs, reeds and fish, but a trading list is not a promise of an unlimited supply.”' },
              { id: 'territories', label: 'What lies beyond the last planks?', response: '“Water that some families recognise as sprite territory. That recognition is not one boundary I can draw for everyone, and there is no marked passage from here.”' },
              { id: 'fish', label: 'What have you heard about the fish?', response: '“Poorer catches in some parts, according to neighbours who fish there. How far the decline goes, and why, are still disputed.”' },
            ], [], [], 'Mosswake',
          ),
        },
      }],
    },
    'mosswake-open-water': {
      readables: [{
        id: 'mosswake-dredging-survey-notice',
        label: 'Dredging survey notice',
        description: 'A public notice tied above the waterline, its lower corners curled with damp.',
        text: 'Proposal for a survey of deposits beneath the water. The commercial consortium seeks discussion of possible dredging. This notice records a proposal, not permission to dredge or enter recognised sprite territories. Residents raise concerns about fisheries and channels; others raise possible income and work. No agreement or explanation for the reported fish decline is recorded here.',
      }],
    },
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
            choices: bellwoldSmallTalkChoices(
              'linnet-reed',
              '“I’m Linnet Reed. I run errands around town and usually find someone to talk to along the way.”',
              '“I’m carrying a few things between the square and the well. I have not decided which I’ll reach first.”',
              '“Bellwold is small enough that an errand can turn into a conversation, then another errand. I like that about it.”',
              [
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
              ],
            ),
          },
          movement: {
            strategy: 'wander',
            intervalMs: 60_000,
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
            choices: bellwoldSmallTalkChoices(
              'taren-voss',
              '“Taren Voss. I watch the village roads and crossings.”',
              '“I’m making my circuit through the square and the public lanes. I look for trouble before it reaches someone’s door.”',
              '“Bellwold is a working village near a frontier. Most days are quiet, but quiet roads still need watching.”',
              [
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
              ['taren-voss-asked-about-town'],
            ),
          },
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
              ...bellwoldSmallTalkChoices(
                'orin-vale',
                '“Orin Vale. I have spent more of my life beside the river than I planned to.”',
                '“I walk between the square and the south bridge, watching the current and checking the line when I can.”',
                '“Bellwold suits me. The river is close, and there is usually someone in the square who will share a word.”',
                [
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
                [],
                ['received-old-fishing-rod'],
              ),
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
            intervalMs: 60_000,
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
    'kindly-roof-inn': {
      safeResting: true,
      npcs: [
        {
          id: 'tomas-innkeeper',
          name: 'Tomas',
          dailyJobResponses: tomasJobs,
          description: 'Behind the common-room counter, Tomas turns from one traveler to the next, listening as low voices drift around the tables.',
          activityDescription: 'listening to travelers in the common room',
          greeting: '“Come in and warm yourself. If you want the road news, ask who saw it and when.”',
          topics: [
            bulletinTopic(tomasJobs),
            { id: 'road', keywords: ['road', 'travel'], response: '“The tower road leaves from the square. The mill is farther along. I can tell you what travelers report, not what waits for you there.”' },
            { id: 'elira', keywords: ['elira', 'professor', 'scholar'], response: '“Professor Elira Venn was investigating the old bell and disappeared near Bellwold. I have no reliable account of what happened after.”' },
            { id: 'bell-history', keywords: ['seventeen villagers', 'storm warnings', 'bell history'], response: '“The older account says the bell warned of storms, then rang without stopping while seventeen villagers disappeared. It records the terrible sequence, not its cause.”' },
            { id: 'beyond-bellwold', keywords: ['Merefall League', 'Veyrun Concord', 'Sareth Cantons', 'Rillward Freeholds'], response: '“Travelers describe a continent of different arrangements: guild-influenced city-states in Merefall, temple and civic authority in Veyrun, mountain assemblies in Sareth, and negotiated river rights in Rillward. I repeat what they tell me; I have not walked every road myself.”' },
          ],
          unknownTopicResponse: '“I keep rooms and hear travelers. I don’t claim to know every answer.”',
          dialogue: {
            prompt: '“Come in and warm yourself. If you want the road news, ask who saw it and when.”',
            choices: bellwoldSmallTalkChoices(
              'tomas-innkeeper',
              '“Tomas. I keep the rooms and common table at the Kindly Roof.”',
              '“I’m tending the inn and listening for travelers’ news. I try to keep what I hear separate from what I know.”',
              '“Bellwold is a place where the roads bring fresh faces through, but most of the work is still done by the people who live here.”',
              [
                {
                  id: 'traveler-reports',
                  label: 'What do travelers say about the wider world?',
                  response: '“Different things, depending on which road they came by. I can repeat their accounts, but I haven’t walked those places myself.”',
                },
                {
                  id: 'professor-venn',
                  label: 'What happened to Professor Venn?',
                  response: '“She was studying the old bell, then disappeared near Bellwold. I’ve heard no reliable account of what happened after. I won’t dress a gap in the story as an answer.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'harrowfen-weigh-house': {
      readables: [
        {
          id: 'harrowfen-yield-tallies',
          label: 'Yield tallies',
          description: 'A board of chalked columns beside the beam scale.',
          text: 'The columns record seed sown, the weather and the sacks weighed, season by season. The recent columns are shorter than the older ones, though the weather notes for those seasons read “fair” and “good”. A line at the foot asks next season’s tellers to note which field each load came from. The tallies do not say why the yields have fallen.',
        },
      ],
      npcs: [
        {
          id: 'maela-thorn',
          name: 'Reeve Maela Thorn',
          description: 'Maela Thorn stands by the beam scale with a stub of chalk, comparing this season’s sacks against last year’s marks.',
          activityDescription: 'checking sacks against the tallies',
          greeting: '“If you’ve come about the fields, tell me what you’ve seen. I’ve heard plenty of guesses already.”',
          topics: [
            { id: 'harvest', keywords: ['harvest', 'harvests', 'yield', 'yields', 'grain', 'crops'], response: '“Yields are down, and the weather’s been fair. Some blame tired soil, some the drainage, some Resonance. I don’t know yet, and I won’t pretend to.”' },
            { id: 'land', keywords: ['land', 'landholders', 'nobles', 'owners', 'tenants'], response: '“Most of these fields belong to noble families. Tenants, hired hands and smallholders do the work, and they don’t all want the same thing from me.”' },
            { id: 'reeve', keywords: ['reeve', 'office', 'election'], response: '“The village chose me to speak for the farmers. That gives me a voice with the landholders. It doesn’t give me their deeds.”' },
            { id: 'grain-offer', keywords: ['offer', 'bargain', 'cheap grain', 'Veyl', 'extraction'], response: '“Someone has offered cheap grain if we let them set up a Veyl extraction operation here. Some want the food and the work. Others ask who would consent, and what it would cost the land. Nobody has shown me what it would really do.”' },
            { id: 'trade', keywords: ['Bellwold', 'Rillford', 'trade', 'flax'], response: '“Our food and flax go toward Bellwold, and plenty more moves on through Rillford. When a season is short, everyone down the road feels it.”' },
            { id: 'tools', keywords: ['tools', 'smith', 'forge', 'repairs'], response: '“We’ve no forge here. A broken share goes to whoever can mend it, and the fields wait.”' },
          ],
          unknownTopicResponse: '“Ask me about the fields, the harvest or the people who work them.”',
          dialogue: {
            prompt: '“If you’ve come about the fields, tell me what you’ve seen. I’ve heard plenty of guesses already.”',
            choices: [
              ...bellwoldSmallTalkChoices(
                'maela-thorn',
                '“Maela Thorn, reeve of Harrowfen. I worked these fields before the village chose me to speak for the people who farm them.”',
                '“I’m checking this season’s sacks against last year’s marks. The numbers keep coming up short.”',
                '“A hundred fields and a lot of opinions. The land mostly belongs to noble families; the work belongs to everyone else.”',
                [
                  {
                    id: 'falling-yields',
                    label: 'Why are the harvests falling?',
                    response: '“I don’t know. Tired soil, the drainage, Resonance: I’ve heard them all. Until we keep better field records, they’re guesses.”',
                  },
                  {
                    id: 'grain-bargain',
                    label: 'What is this offer of cheap grain?',
                    response: '“Cheap grain in exchange for letting someone set up a Veyl extraction operation. It would feed people this year. Nobody can tell me what it would do after that.”',
                  },
                ],
                [],
                [],
                'Harrowfen',
              ),
              {
                id: 'maela-publish-conversion-table',
                label: 'Publish a conversion table',
                response: '“A public table would let both towns check the next handoff without pretending the two scales are the same. I’ll try it with the next load.”',
                progressFlagId: 'maela-thorn-publish-conversion-table',
                requiresProgressFlagIds: ['maela-thorn-asked-about-town'],
                questCondition: {
                  questId: 'orraveth-measure-between-towns',
                  status: 'active',
                  branchId: 'compare-records',
                  requiresCompletedObjectiveIds: ['read-anwen-scale-note', 'read-harrowfen-yield-tallies'],
                },
                questAction: {
                  type: 'choose',
                  questId: 'orraveth-measure-between-towns',
                  choiceId: 'choose-conversion-table',
                },
              },
              {
                id: 'maela-record-both-measures',
                label: 'Record both measures side by side',
                response: '“Keeping both marks visible would make the difference plain at each handoff. I’ll use that record for the next load.”',
                progressFlagId: 'maela-thorn-record-both-measures',
                requiresProgressFlagIds: ['maela-thorn-asked-about-town'],
                questCondition: {
                  questId: 'orraveth-measure-between-towns',
                  status: 'active',
                  branchId: 'compare-records',
                  requiresCompletedObjectiveIds: ['read-anwen-scale-note', 'read-harrowfen-yield-tallies'],
                },
                questAction: {
                  type: 'choose',
                  questId: 'orraveth-measure-between-towns',
                  choiceId: 'choose-dual-record',
                },
              },
              {
                id: 'maela-report-measure-recommendation',
                label: 'Report the measure recommendation',
                response: '“I’ve entered the method beside the tallies. You kept the records separate from any guess about the harvest.”',
                progressFlagId: 'maela-thorn-report-measure-recommendation',
                requiresProgressFlagIds: ['maela-thorn-asked-about-town'],
                questCondition: {
                  questId: 'orraveth-measure-between-towns',
                  status: 'active',
                  requiresCompletedObjectiveIds: ['read-anwen-scale-note', 'read-harrowfen-yield-tallies'],
                },
                questAction: { type: 'turn-in', questId: 'orraveth-measure-between-towns' },
              },
            ],
            questResponses: [
              {
                questId: 'orraveth-measure-between-towns',
                status: 'active',
                branchId: 'compare-records',
                requiresIncompleteObjectiveIds: ['read-anwen-scale-note'],
                response: '“The tallies are here. Read Anwen Marr’s scale note in Bellwold too; these records do not explain why the yields fell.”',
              },
              {
                questId: 'orraveth-measure-between-towns',
                status: 'active',
                branchId: 'compare-records',
                requiresIncompleteObjectiveIds: ['read-harrowfen-yield-tallies'],
                response: '“I still need my yield tallies read alongside Anwen’s scale note. Then we can decide how to record a future load.”',
              },
              {
                questId: 'orraveth-measure-between-towns',
                status: 'active',
                branchId: 'compare-records',
                requiresCompletedObjectiveIds: ['read-anwen-scale-note', 'read-harrowfen-yield-tallies'],
                response: '“We have both records now. Ask what Harrowfen is like, then tell me which method you recommend for the next grain handoff.”',
              },
              {
                questId: 'orraveth-measure-between-towns',
                status: 'active',
                outcomeId: 'conversion-table',
                response: '“The next load will use a public conversion table. That gives both towns a way to check the handoff; it does not explain the falling yields.”',
              },
              {
                questId: 'orraveth-measure-between-towns',
                status: 'active',
                outcomeId: 'dual-records',
                response: '“The next load will record both measures side by side. The difference will stay visible, though its cause remains unknown.”',
              },
              {
                questId: 'orraveth-measure-between-towns',
                status: 'completed',
                requiresCompletedObjectiveIds: ['read-anwen-scale-note', 'read-harrowfen-yield-tallies'],
                response: '“The recommendation is entered with the tallies. We still need more seasons of careful records to understand the harvest.”',
              },
            ],
          },
        },
      ],
    },
    'marrs-general-goods': {
      takeables: [{
        id: 'marr-starter-bronze-axe',
        typeId: 'bronze-axe',
        label: 'Bronze Axe',
        description: 'A serviceable bronze axe for woodcutters of level 1 or higher, left near the counter for travelers who need to cut their own firewood.',
        woodcuttingAxe: { requiredLevel: 1, power: 1 },
      }],
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
          shop: {
            listings: [
              {
                id: 'marr-iron-axe',
                item: {
                  id: 'iron-axe',
                  typeId: 'iron-axe',
                  label: 'Iron Axe',
                  description: 'A balanced iron axe. Requires Woodcutting level 10.',
                  woodcuttingAxe: { requiredLevel: 10, power: 2 },
                },
                price: 20,
              },
              {
                id: 'marr-steel-axe',
                item: {
                  id: 'steel-axe',
                  typeId: 'steel-axe',
                  label: 'Steel Axe',
                  description: 'A keen steel axe. Requires Woodcutting level 20.',
                  woodcuttingAxe: { requiredLevel: 20, power: 3 },
                },
                price: 50,
              },
              {
                id: 'marr-crafting-needle',
                item: {
                  id: 'crafting-needle',
                  typeId: 'crafting-needle',
                  label: 'Crafting Needle',
                  description: 'A small, reusable needle for stitching leather at a workbench.',
                },
                price: 4,
              },
              {
                id: 'marr-spool-of-thread',
                item: {
                  id: 'spool-of-thread',
                  typeId: 'spool-of-thread',
                  label: 'Spool of Thread',
                  description: 'A tightly wound spool of strong thread, with five uses.',
                  usesRemaining: 5,
                },
                price: 2,
                repeatable: true,
              },
            ],
          },
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
              ...bellwoldSmallTalkChoices(
                'anwen-marr',
                '“Anwen Marr. I run this shop and keep notes on measurements that do not quite add up.”',
                '“I’m checking a scale against its weights and recording the readings before I draw any conclusions.”',
                '“Bellwold gets by on practical exchange. That makes honest measures and clear records important, even when they raise more questions.”',
                [
                  {
                    id: 'scale-readings',
                    label: 'What do the scale readings tell you?',
                    response: '“They repeat often enough to deserve attention. That tells me the pattern is real; it does not tell me what causes it.”',
                  },
                ],
              ),
              {
                id: 'ask-anwen-about-mill',
                label: 'Ask about the watermill',
                response: '“The mill has been abandoned, but there are reports of its wheel moving when the channel is low. There is a ledger inside. Would you read the last entries and bring me what they actually say?”',
                progressFlagId: 'asked-anwen-about-mill',
                hideAfterProgressFlagIds: ['anwen-marr-asked-about-town'],
                questAction: { type: 'accept', questId: 'bellwold-mill-observations' },
              },
              {
                id: 'ask-anwen-about-church-sword',
                label: 'Ask about the abandoned church',
                response: '“There is a locked annex beneath the abandoned church. A brass key is behind the tally cabinet in the Old Grain House. A sword is sealed beyond that door. Bring it to me; I will pay you 20 gold, inspect the blade, and return it to you.”',
                progressFlagId: 'accepted-church-sword-recovery',
                hideAfterProgressFlagIds: ['anwen-marr-asked-about-town'],
                questAction: { type: 'accept', questId: 'bellwold-church-sword' },
              },
              {
                id: 'report-mill-ledger',
                label: 'Report what the ledger says',
                response: '“Good. Keep the record separate from the explanation. One tells us what was observed; the other still needs work.”',
                progressFlagId: 'reported-mill-ledger-to-anwen',
                hideAfterProgressFlagIds: ['anwen-marr-asked-about-town'],
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
                hideAfterProgressFlagIds: ['anwen-marr-asked-about-town'],
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
    'bellwold-south-common': {
      readables: [{
        id: 'bellwold-daily-notice', label: 'Bulletin board',
        description: 'A broad plank board holds handwritten notices in uneven rows.',
        text: 'Residents post daily jobs and requests here. Read the bulletin to see current postings and rewards. Accept a posting, then follow its instructions to complete it. New postings appear with each daily refresh.',
      }],
    },
    'green-mortar': {
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
          dialogue: {
            prompt: '“Tell me what you noticed and when. A careful account is a better beginning than a guess.”',
            choices: bellwoldSmallTalkChoices(
              'ilya-fen',
              '“Ilya Fen. I tend this workroom and help with the ordinary aches and cuts people bring through the door.”',
              '“I’m sorting plants and preparing clean cloth. I keep track of what I have actually tried.”',
              '“Bellwold is neighborly in a practical way. People bring one another news, herbs, and a hand when work piles up.”',
              [
                {
                  id: 'herb-knowledge',
                  label: 'How do you know which herbs help?',
                  response: '“I keep notes on what I have used and what changed. A plant’s reputation is not proof, so I won’t promise more than I have seen.”',
                },
                {
                  id: 'new-healing',
                  label: 'What are healers trying elsewhere?',
                  response: '“I hear researchers are testing plant, mineral, and cooperative approaches that use less Essence. Some results sound promising, but they are costly and still uncertain.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'blackwater-forge': {
      npcs: [
        {
          id: 'darric-holt',
          name: 'Darric Holt',
          dailyJobResponses: darricJobs,
          description: 'Darric turns a half-mended iron fitting beside the forge, coal smoke darkening the sleeve of his work shirt.',
          activityDescription: 'repairing a farm fitting at the forge',
          greeting: '“If something is broken, show me where it failed. If it is only a rumor, I have work to finish.”',
          topics: [
            bulletinTopic(darricJobs),
            { id: 'repairs', keywords: ['repair', 'repairs', 'forge', 'smith', 'tools'], response: '“Most days it is hinges, blades, and cart fittings. Keeping a place working is less dramatic than building it from scratch.”' },
            { id: 'bell', keywords: ['bell', 'tower'], response: '“I know how metal wears. I do not know why the tower bell went silent.”' },
            { id: 'sevenfold-workshop', keywords: ['Sevenfold Workshop', 'divine artisans', 'craft and creation'], response: '“Some people speak of creation as a workshop shaped by seven artisans. I understand the metaphor; it does not tell me which faith is right, or why the bell went quiet.”' },
            { id: 'heskar-property', keywords: ['Heskar property law', 'boundary mark', 'land claim'], response: '“A boundary mark can matter as much as a fence under Heskar law. A smith can mend the hinge; settling the claim is someone else’s work.”' },
          ],
          unknownTopicResponse: '“Ask about the work here. I am not a keeper of every local story.”',
          dialogue: {
            prompt: '“If something is broken, show me where it failed. If it is only a rumor, I have work to finish.”',
            choices: bellwoldSmallTalkChoices(
              'darric-holt',
              '“Darric Holt. I mend tools, hinges, blades, and whatever else survives the forge.”',
              '“I’m repairing a farm fitting. It is easier to find the fault while the metal is still warm.”',
              '“Bellwold holds together because people repair what they have. New work matters, but so does keeping a gate on its hinges.”',
              [
                {
                  id: 'silent-bell',
                  label: 'What do you know about the silent bell?',
                  response: '“I know how metal wears. I don’t know why that bell fell silent while Professor Venn was measuring it.”',
                },
                {
                  id: 'sevenfold-workshop',
                  label: 'What is the Sevenfold Workshop?',
                  response: '“Some tell creation as a workshop shaped by seven artisans. It is a story about craft, not an answer to every question about the world.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'sovens-wheelwright-yard': {
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
          dialogue: {
            prompt: '“A wheel tells you where it is failing if you watch it turn.”',
            choices: bellwoldSmallTalkChoices(
              'rell-soven',
              '“Rell Soven. My family has made and mended wheels here for as long as I can remember.”',
              '“I’m checking a cart wheel for a wobble before I fit it back to the axle.”',
              '“Bellwold’s lanes are rough on carts. That keeps my yard busy, and it means the village can keep moving its goods.”',
              [
                {
                  id: 'mill-wheel',
                  label: 'Have you worked on the old mill wheel?',
                  response: '“No. I can tell you what a wheel should sound like, but I haven’t inspected that one. I won’t pretend a familiar shape explains why it might move.”',
                },
                {
                  id: 'trade-routes',
                  label: 'How do goods travel beyond Bellwold?',
                  response: '“By whatever route can carry them. I hear river communities negotiate access together, while guilds shape a lot of trade in Merefall.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'tallow-end-cottage': {
      npcs: [
        {
          id: 'seli-tor',
          name: 'Seli Tor',
          dailyJobResponses: seliJobs,
          description: 'Seli draws a pale thread taut through a strip of cloth at the loom by the window.',
          activityDescription: 'weaving cloth at her loom',
          greeting: '“Mind the loose thread by the door. It has already caught two sleeves today.”',
          topics: [
            bulletinTopic(seliJobs),
            { id: 'weaving', keywords: ['weaving', 'cloth', 'loom', 'mending'], response: '“A torn sack is a small problem until the road is long. Most of my work keeps ordinary things useful a little longer.”' },
            { id: 'wattle-row', keywords: ['wattle', 'row', 'homes', 'neighbors'], response: '“The lane is close, but people keep their own hours. You learn who is awake by the sound of their work.”' },
            { id: 'travelers-and-customs', keywords: ['customs', 'travelers', 'farther roads'], response: '“People passing through carry different ways of wrapping, mending, and marking their things. I ask what a pattern means before I assume it belongs to a faith or a family.”' },
          ],
          unknownTopicResponse: '“I am happy to talk, but the loom will not wait forever.”',
          dialogue: {
            prompt: '“Mind the loose thread by the door. It has already caught two sleeves today.”',
            choices: bellwoldSmallTalkChoices(
              'seli-tor',
              '“Seli Tor. I weave cloth and mend the things people need to carry or wear.”',
              '“I’m working a length of cloth at the loom. If I stop halfway through, I lose the line.”',
              '“Bellwold’s lanes are close, so people notice one another’s work. Most neighbors are willing to lend a hand when it is needed.”',
              [
                {
                  id: 'wattle-row',
                  label: 'What is Wattle Row like?',
                  response: '“Close-set doors and everyone keeping their own hours. You can usually tell who is awake by the sound of their work.”',
                },
                {
                  id: 'traveling-patterns',
                  label: 'What do travelers teach you about cloth?',
                  response: '“They bring different ways to wrap, mend, and mark their belongings. I ask what a pattern means before I decide it belongs to a family or a faith.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'old-grain-house': {
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
          dialogue: {
            prompt: '“If you need the store, tell me what you are looking for. I keep the tally, not the harvest.”',
            choices: bellwoldSmallTalkChoices(
              'aven-rusk',
              '“Aven Rusk. I keep the grain store’s tally and check what comes in and goes out.”',
              '“I’m comparing the chalk marks on these bins with the ledger before I update the count.”',
              '“Bellwold shares stores when it has to. Clear records help us know what is here without pretending to predict what comes next.”',
              [
                {
                  id: 'grain-tally',
                  label: 'How do you keep the grain tally?',
                  response: '“The chalk marks sort bins by season, not by owner. I record what comes in and what leaves; the tally cannot tell me what next season will bring.”',
                },
                {
                  id: 'regional-records',
                  label: 'Do other places keep different records?',
                  response: '“That is what I hear. Guilds weigh heavily on accounts in Merefall; along the Rillward rivers, communities record agreements about access.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'bellwold-common-house': {
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
          dialogue: {
            prompt: '“The notes are public. If something is missing, tell me what you saw and when.”',
            choices: [
              ...bellwoldSmallTalkChoices(
                'enna-pell',
                '“Enna Pell. I keep the Common House records and copy notices people bring in.”',
                '“I’m writing down the wording of a public notice so the next meeting can check it.”',
                '“Bellwold is held together by small agreements. I try to record what people actually decided, not what I think they meant.”',
                [
                  {
                    id: 'common-house-meetings',
                    label: 'What gets discussed at the Common House?',
                    response: '“Repairs, water use, and market-day concerns. The notes record what was agreed, not what everyone hoped would be agreed.”',
                  },
                  {
                    id: 'bell-account',
                    label: 'What do the records say about the old bell?',
                    response: '“One account says it rang without stopping while seventeen villagers disappeared. It gives no cause, and I won’t write one into the minutes.”',
                  },
                ],
              ),
              {
                id: 'enna-offer-measure-between-towns',
                label: 'Ask about the grain records',
                response: '“Anwen’s scale note is in her Bellwold shop; Maela keeps Harrowfen’s yield tallies. Read both, then ask Maela how she wants the next handoff recorded. The records do not prove why yields have fallen.”',
                progressFlagId: 'enna-pell-offer-measure-between-towns',
                requiresProgressFlagIds: ['enna-pell-asked-about-town'],
                questAction: { type: 'accept', questId: 'orraveth-measure-between-towns' },
              },
            ],
            questResponses: [
              {
                questId: 'orraveth-measure-between-towns',
                status: 'active',
                branchId: 'compare-records',
                response: '“Read Anwen’s scale note and Maela’s yield tallies, then keep each record’s limits clear. The notes show what was measured, not why the harvest changed.”',
              },
            ],
          },
        },
      ],
    },
    'bellwold-nettlemere-house': {
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
          dialogue: {
            prompt: '“Come in out of the lane. Just mind the kettle.”',
            choices: bellwoldSmallTalkChoices(
              'sella-nettlemere',
              '“Sella Nettlemere. I keep this house and bake when there is flour to spare.”',
              '“I’m kneading a little dough and keeping an ear on the kettle. It tends to complain before it boils over.”',
              '“Bellwold is a place where a warm loaf can bring half the lane to the door. People share what they can.”',
              [
                {
                  id: 'shared-meals',
                  label: 'What do people eat around here?',
                  response: '“Flour comes through the market, and folks add what their gardens have. More often than not, someone brings a dish because a neighbor needs help.”',
                },
                {
                  id: 'lane-neighbors',
                  label: 'Do you know the people on this lane?',
                  response: '“Well enough to know whose door to knock on when a roof leaks or a pot goes missing. We manage to return most things.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'bellwold-upper-row-house': {
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
          dialogue: {
            prompt: '“If you’re here about the cloth, give me a moment to finish this row.”',
            choices: bellwoldSmallTalkChoices(
              'tovin-ashdown',
              '“Tovin Ashdown. I weave cloth here and patch it when it wears through.”',
              '“I’m working the shuttle across the loom. I need to finish this row before I can check the loose thread.”',
              '“Bellwold’s houses grew around the jobs people had to do. The lanes are practical, even if they can be hard to navigate at first.”',
              [
                {
                  id: 'cloth-use',
                  label: 'What do you make with the cloth?',
                  response: '“Mostly repairs: clothes, sacks, and covers for goods on the road. A sturdy patch can save someone a long walk back to town.”',
                },
                {
                  id: 'town-lanes',
                  label: 'Why are the lanes laid out this way?',
                  response: '“People put doors close to their work. The paths followed those needs, not some grand plan, so a few turns lead nowhere special.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'bellwold-lower-row-house': {
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
          dialogue: {
            prompt: '“Close the door behind you; the sawdust gets everywhere.”',
            choices: bellwoldSmallTalkChoices(
              'renna-kell',
              '“Renna Kell. I mend boards, shutters, and the small things that keep a house dry.”',
              '“I’m trimming a warped plank so it will sit straight against the frame.”',
              '“Bellwold’s lower lanes are full of people fixing one another’s roofs and doors. A good board is worth more than a grand promise.”',
              [
                {
                  id: 'common-repairs',
                  label: 'What do people ask you to repair?',
                  response: '“Loose steps and split shutters, mostly. Best to mend them before the next rain makes a small fault expensive.”',
                },
                {
                  id: 'lower-row',
                  label: 'What is Lower Row like?',
                  response: '“Quiet until someone starts fixing something. Then the whole lane has an opinion, and someone usually brings a second pair of hands.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'bellwold-south-lane-cottage': {
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
          dialogue: {
            prompt: '“There’s enough room by the table if you need to sit.”',
            choices: bellwoldSmallTalkChoices(
              'pella-wren',
              '“Pella Wren. I grow herbs in pots and trade what I can spare.”',
              '“I’m sorting thyme for drying. It keeps its scent better if I handle it gently.”',
              '“Bellwold has room for little gardens between the houses. People trade cuttings and stories over the fence.”',
              [
                {
                  id: 'garden-herbs',
                  label: 'What grows in your pots?',
                  response: '“Thyme, mostly, and a few other useful plants. I’ll tell you what I’ve tried myself; the rest I leave to better notes.”',
                },
                {
                  id: 'neighborly-life',
                  label: 'What is daily life like in Bellwold?',
                  response: '“Someone borrows a tool, forgets to return it, then helps mend the fence anyway. It’s not grand, but it works.”',
                },
              ],
            ),
          },
        },
      ],
    },
    'bellwold-jail': {
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
          dialogue: {
            prompt: '“If you have a concern, state what happened and when. I keep the record plain.”',
            choices: bellwoldSmallTalkChoices(
              'sergeant-nera-vail',
              '“Sergeant Nera Vail. I oversee this jail and keep its records.”',
              '“I’m checking the keys and making sure the holding cell is in order.”',
              '“Bellwold needs a watch, but a claim is not proof. I keep the record clear and let the facts speak for themselves.”',
              [
                {
                  id: 'holding-cell',
                  label: 'What is the holding cell for?',
                  response: '“To keep someone safe while a matter is heard. It is not a sentence, and I don’t decide a dispute without a record.”',
                },
                {
                  id: 'street-watch',
                  label: 'Who watches the streets?',
                  response: '“Taren covers the public routes. I keep this room and its keys. The jobs overlap when someone needs help, but they aren’t the same.”',
                },
              ],
            ),
          },
        },
      ],
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
            choices: bellwoldSmallTalkChoices(
              'mira-dell',
              '“Mira Dell. I care for the library and help readers find the records they need.”',
              '“I’m sorting pamphlets and putting the copied records back where readers can find them.”',
              '“Bellwold’s past is scattered across notes, tallies, and people’s memories. This library keeps the pieces available without pretending they make one complete story.”',
              [
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
              ],
            ),
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
    'bellwold-river-bridge': {
      defaultStateId: 'on',
      states: [
        { id: 'on' },
        {
          id: 'under',
          name: 'Under Lower Rill Bridge',
          description: 'The river moves beneath the stone arches. The road bridge rumbles overhead as the current passes east and west.',
        },
      ],
    },
    'rillford-crossing': {
      defaultStateId: 'stage',
      states: [
        { id: 'stage' },
        {
          id: 'water',
          name: 'Beside the Ferry Stage',
          description: 'The current pulls past the tarred piles of Rillford’s ferry stage. Towpath Reach is east; the river runs on west.',
        },
      ],
      readables: [
        {
          id: 'rillford-crew-slate',
          label: 'Crew slate',
          description: 'A slate nailed to one of the piles, chalked over in several hands.',
          text: 'Crews leave notices for one another here: a loose mooring ring, a snag below the stage, a boat wanted for hire. Beneath them, three entries in different hands each record a boat overturned near the crossing. One lists grain, one lists hides and one names no cargo at all. Someone has chalked “Silverfin?” beside the last, and someone else has rubbed it out.',
        },
      ],
    },
    'rillford-customs-house': {
      readables: [
        {
          id: 'rillford-cargo-notice',
          label: 'Cargo notice',
          description: 'A notice pinned beside the customs-house door.',
          text: 'Cargo landed or loaded at the Rillford quay is to be declared at this house before it moves on. A declaration names the goods, their quantity, their owner and the boat or cart that carries them. The notice sets out no rates and says nothing about who may carry passengers.',
        },
      ],
      npcs: [
        {
          id: 'rillford-customs-clerk',
          name: 'Customs Clerk',
          description: 'A customs clerk copies a cargo declaration into a ledger, checking each line against the bill beside it.',
          activityDescription: 'copying cargo declarations into a ledger',
          greeting: '“Declaring cargo? The notice by the door says what I need. Otherwise, mind the ledgers.”',
          topics: [
            { id: 'declarations', keywords: ['cargo', 'declare', 'declaration', 'declarations', 'ledger'], response: '“Whatever comes off a boat or goes onto one gets written here: goods, quantity, owner, boat. That’s the job.”' },
            { id: 'crown', keywords: ['Crown', 'Heskar', 'customs'], response: '“The Crown wants to know what moves through the crossing. Some merchants think that keeps things fair. Others think it’s our business only when it suits us.”' },
            { id: 'fees', keywords: ['fee', 'fees', 'toll', 'tolls', 'tax', 'duty', 'rate', 'rates'], response: '“I record cargo. If you want to talk money, talk to someone who can set it. I won’t quote you a number.”' },
            { id: 'silverfin', keywords: ['Silverfin', 'Old Silverfin', 'sprite', 'overturned'], response: '“I record what boats declare. I’ve heard the crews’ stories like everyone else. None of them is in my ledger.”' },
          ],
          unknownTopicResponse: '“I keep the declarations. Ask the guild or the crews about the rest.”',
          dialogue: {
            prompt: '“Declaring cargo? The notice by the door says what I need. Otherwise, mind the ledgers.”',
            choices: bellwoldSmallTalkChoices(
              'rillford-customs-clerk',
              '“A clerk of the customs house. I write down what crosses the quay.”',
              '“Copying today’s declarations. Every line has to match the bill.”',
              '“Busy. Boats in, boats out, and everyone sure their cargo is the one that matters.”',
              [
                {
                  id: 'cargo-notice',
                  label: 'What does the cargo notice ask for?',
                  response: '“Goods, quantity, owner, and the boat or cart carrying them. Bring me those and you’re done here.”',
                },
              ],
              [],
              [],
              'Rillford',
            ),
          },
        },
      ],
    },
    'rillford-guild-hall': {
      npcs: [
        {
          id: 'selda-rook',
          name: 'Guildmistress Selda Rook',
          description: 'Selda Rook stands over a bill of lading at the long table, marking each cargo line before she signs.',
          activityDescription: 'checking bills of lading',
          greeting: '“If you’ve business on the river, it starts with a record. What are you carrying?”',
          topics: [
            { id: 'regulation', keywords: ['rules', 'regulation', 'guild', 'commerce', 'procedures'], response: '“Agreed rules for loading, passage and disputes protect the small trader as much as the big house. Without them, whoever shouts loudest sets the terms.”' },
            { id: 'ferry-dispute', keywords: ['ferry', 'boatmen', 'dispute', 'rights', 'passage'], response: '“The ferry guild wants exclusive rights. The independent boatmen say rules will become a fence. I want regulation, but I don’t speak for every merchant on this quay, and I won’t pretend to.”' },
            { id: 'silverfin', keywords: ['Silverfin', 'Old Silverfin', 'sprite', 'overturned', 'capsized'], response: '“Crews say Old Silverfin has been overturning boats with certain cargoes. Which cargoes? Every account I hear is different. Until we write down what each boat carried and where it went over, I won’t name a cause.”' },
            { id: 'records', keywords: ['cargo', 'cargoes', 'records', 'bills', 'lading'], response: '“Write down what was loaded, who loaded it and where the boat was bound. Then compare. A pattern you can check is worth more than a story you like.”' },
            { id: 'customs', keywords: ['customs', 'Crown', 'Heskar'], response: '“The customs house wants the crossing legible to the Crown. Some here welcome that. Others don’t.”' },
            { id: 'trade', keywords: ['Bellwold', 'Harrowfen', 'trade', 'market'], response: '“Bellwold’s goods come down the towpath and go out on our boats. Harrowfen’s grain moves through here too. When one place is short, the others hear about it.”' },
          ],
          unknownTopicResponse: '“Ask me about the river trade, the guild or the crossing.”',
          dialogue: {
            prompt: '“If you’ve business on the river, it starts with a record. What are you carrying?”',
            choices: bellwoldSmallTalkChoices(
              'selda-rook',
              '“Selda Rook. I speak for the merchants who want river commerce run by agreed rules. Not all of them, mind.”',
              '“Checking bills of lading. If a boat goes over, I want to know what it carried before anyone tells me why.”',
              '“A crossing town. Warehouses, customs, a livestock market each week, and more opinions about the river than boats on it.”',
              [
                {
                  id: 'ferry-dispute',
                  label: 'What is the ferry dispute?',
                  response: '“The ferry guild wants exclusive rights to carry across. The independent boatmen think that would shut them out. I support regulation, and I know not everyone trusts the people who’d write it.”',
                },
                {
                  id: 'old-silverfin',
                  label: 'What about Old Silverfin?',
                  response: '“Some crews call it a warning. Some blame poor loading, and some think someone wants boats to sink. I want the cargoes written down before anyone decides.”',
                },
              ],
              [],
              [],
              'Rillford',
            ),
          },
        },
      ],
    },
    'rillford-inn': {
      safeResting: true,
    },
    'rillford-warehouse-row': {
      npcs: [
        {
          id: 'rillford-independent-boatman',
          name: 'Independent Boatman',
          description: 'A boatman sits on an upturned hull, splicing a rope end and keeping half an eye on the warehouse doors.',
          activityDescription: 'splicing rope between loads',
          greeting: '“If you’re from the guild, I’ve said my piece. If not, sit down.”',
          topics: [
            { id: 'ferry', keywords: ['ferry', 'guild', 'rights', 'exclusive', 'dispute'], response: '“The guild calls it regulation. To me it looks like a fence round the river with their name on the gate. Rules written by the biggest boats tend to suit the biggest boats.”' },
            { id: 'silverfin', keywords: ['Silverfin', 'Old Silverfin', 'sprite', 'overturned', 'capsized'], response: '“Some crews say it’s a warning. Some say it’s bad loading. A few reckon someone’s tipping boats on purpose to settle the ferry fight. I’ve not seen it myself, so I won’t tell you which.”' },
            { id: 'passage', keywords: ['passage', 'crossing', 'boat', 'across', 'ferry stage'], response: '“Crossing’s arranged boat by boat. Nobody’s carrying passengers off this quay just now.”' },
            { id: 'river', keywords: ['river', 'Rill', 'Lower Rill', 'current'], response: '“Watch the current, not the stories. It changes with the weather, and it doesn’t care who holds the rights.”' },
          ],
          unknownTopicResponse: '“I know boats and this stretch of water. Ask about those.”',
          dialogue: {
            prompt: '“If you’re from the guild, I’ve said my piece. If not, sit down.”',
            choices: bellwoldSmallTalkChoices(
              'rillford-independent-boatman',
              '“I work my own boat. No guild, no exclusive rights, and I’d like to keep it that way.”',
              '“Splicing rope. A frayed line costs more than a slow afternoon.”',
              '“Good water, crowded quay, and everyone arguing over who gets to carry what.”',
              [
                {
                  id: 'crossing',
                  label: 'Can you take me across?',
                  response: '“Not from here, not now. Who carries whom across is half of what the guild fight is about.”',
                },
              ],
              [],
              [],
              'Rillford',
            ),
          },
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
            choices: bellwoldSmallTalkChoices(
              'nessa-rill',
              '“Nessa Rill. I live in the loft above the bench and make my living repairing carts, handles, and wooden fittings.”',
              '“I’m truing this cartwheel. The rim was loose enough to send a load skidding if I left it.”',
              '“Bellwold is the nearest place to trade and see familiar faces. I go in when I need supplies or news.”',
              [
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
              ],
            ),
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
    },
  },
  roadRules: {
    'mosswake-causeway': {
      encounterChancePercent: 6,
      encounters: [
        { id: 'mosswake-causeway-reedback-boar', name: 'Reedback Boar', combatProfile: { maxHealth: 7, attackDamage: 2, style: 'steady' } },
        { id: 'mosswake-causeway-stray-hound', name: 'Stray Hound', combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' } },
      ],
    },
    'bellwold-mile-west-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-mile-west-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        banditEncounter('bellwold-mile-west-road-bandit'),
      ],
    },
    'bellwold-south-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-south-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        {
          id: 'bellwold-road-deer', name: 'Roadside Deer',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
          loot: { items: [{ id: 'deer-hide-template', typeId: 'deer-hide', label: 'Deer hide',
            description: 'A brown deer hide with a pale underside.' }] },
        },
        banditEncounter('bellwold-south-road-bandit'),
      ],
    },
    'bellwold-east-mill-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-east-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        banditEncounter('bellwold-east-mill-road-bandit'),
      ],
    },
    'bellwold-north-church-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-north-church-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        banditEncounter('bellwold-north-church-road-bandit'),
      ],
    },
    'bellwold-west-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'bellwold-west-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        banditEncounter('bellwold-west-road-bandit'),
      ],
    },
    'harrowfen-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'harrowfen-road-ditch-fox',
          name: 'Ditch Fox',
          combatProfile: { maxHealth: 3, attackDamage: 1, style: 'steady' },
        },
        {
          id: 'harrowfen-road-reedback-boar',
          name: 'Reedback Boar',
          combatProfile: { maxHealth: 7, attackDamage: 2, style: 'steady' },
        },
        {
          id: 'harrowfen-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'rill-towpath': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'rill-towpath-reedback-boar',
          name: 'Reedback Boar',
          combatProfile: { maxHealth: 7, attackDamage: 2, style: 'steady' },
        },
        {
          id: 'rill-towpath-ditch-fox',
          name: 'Ditch Fox',
          combatProfile: { maxHealth: 3, attackDamage: 1, style: 'steady' },
        },
        {
          id: 'rill-towpath-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
      ],
    },
    'rillford-south-lane-road': {
      encounterChancePercent: 10,
      encounters: [
        {
          id: 'rillford-south-lane-road-stray-hound',
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        },
        {
          id: 'rillford-south-lane-road-ditch-fox',
          name: 'Ditch Fox',
          combatProfile: { maxHealth: 3, attackDamage: 1, style: 'steady' },
        },
      ],
    },
  },
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
    {
      id: 'orraveth-measure-between-towns',
      version: '1.0.0',
      title: 'A Measure Between Towns',
      summary: 'Read Anwen Marr’s scale note in Bellwold and Harrowfen’s yield tallies, then help Reeve Maela choose how a future grain handoff will be recorded. Neither record establishes why the yields have fallen.',
      scope: 'character',
      giverNpcId: 'enna-pell',
      turnInNpcId: 'maela-thorn',
      reward: { currencyId: 'gold', amount: 12 },
      objectives: [
        {
          id: 'read-anwen-scale-note',
          label: 'Read Anwen Marr’s scale note in Bellwold',
          type: 'read-object',
          objectId: 'anwen-scale-note',
          locationId: 'marrs-general-goods',
        },
        {
          id: 'read-harrowfen-yield-tallies',
          label: 'Read Harrowfen’s yield tallies at the weigh-house',
          type: 'read-object',
          objectId: 'harrowfen-yield-tallies',
          locationId: 'harrowfen-weigh-house',
        },
      ],
      branching: {
        startBranchId: 'compare-records',
        branches: [
          {
            id: 'compare-records',
            label: 'Compare the records',
            summary: 'Read the two records before recommending how future grain handoffs should be recorded.',
            objectiveIds: ['read-anwen-scale-note', 'read-harrowfen-yield-tallies'],
            choices: [
              {
                id: 'choose-conversion-table',
                label: 'Publish a conversion table',
                npcId: 'maela-thorn',
                toBranchId: 'conversion-table',
                requires: [{ type: 'visited-location', locationId: 'harrowfen-weigh-house' }],
                worldOutcome: {
                  key: 'orraveth-grain-measure-policy',
                  value: 'published-conversion',
                  label: 'Publish a conversion table for the next grain handoff.',
                },
              },
              {
                id: 'choose-dual-record',
                label: 'Record both measures side by side',
                npcId: 'maela-thorn',
                toBranchId: 'dual-records',
                requires: [{ type: 'visited-location', locationId: 'harrowfen-weigh-house' }],
                worldOutcome: {
                  key: 'orraveth-grain-measure-policy',
                  value: 'dual-recording',
                  label: 'Record both local measures at each grain handoff.',
                },
              },
            ],
          },
          {
            id: 'conversion-table',
            label: 'Publish a conversion table',
            summary: 'The next grain handoff will use a public conversion table shared by Bellwold and Harrowfen.',
            outcomeId: 'conversion-table',
          },
          {
            id: 'dual-records',
            label: 'Record both measures',
            summary: 'The next grain handoff will record each town’s measure side by side.',
            outcomeId: 'dual-records',
          },
        ],
        outcomes: [
          {
            id: 'conversion-table',
            label: 'Conversion table published',
            summary: 'Bellwold and Harrowfen will use a shared conversion table for the next grain handoff.',
          },
          {
            id: 'dual-records',
            label: 'Both measures recorded',
            summary: 'The next grain handoff will preserve each town’s local measure side by side.',
          },
        ],
      },
    },
  ],
} satisfies WorldPackContent;

export const orravethWorld: WorldPackDraft = WorldPackDraftSchema.parse(composeWorldPackDraft({
  locations: WorldLocationsFileSchema.parse(locations),
  locationGroups: WorldLocationGroupsFileSchema.parse(locationGroups),
  roads: WorldRoadsFileSchema.parse(roads),
}, content));
const graphErrors = validateDraftWorldGraph(orravethWorld);
if (graphErrors.length > 0) {
  throw new Error(`Invalid Orraveth world graph:\n${graphErrors.map((error) => `- ${error}`).join('\n')}`);
}

export const ORRAVETH_WORLD_SUMMARY =
  'Explore Bellwold, a frontier settlement with local residents, the silent old bell, roads beyond town, and a maze beneath the abandoned church.';
