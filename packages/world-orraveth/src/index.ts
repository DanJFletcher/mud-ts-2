import {
  WorldPackDraftSchema,
  validateDraftWorldGraph,
  type WorldPackDraft,
} from '@mudd/contracts';

export const ORRAVETH_WORLD_INSTANCE_ID = 'orraveth-bellwold-instance';

const draft = {
  formatVersion: 1,
  packId: 'orraveth.bellwold',
  packVersion: '1.0.0',
  displayName: 'Orraveth: Bellwold',
  locations: [
    {
      id: 'bellwold-market-square',
      name: 'Bellwold Market Square',
      description: 'Bellwold’s market square gathers the village’s trade and daily news. Beyond its stalls, the road leads toward the Kindly Roof, Marr’s shop, and the old tower.',
      mapPosition: { x: 0, y: 0, terrain: 'land' },
      exits: [
        { id: 'square-to-inn', fromLocationId: 'bellwold-market-square', toLocationId: 'kindly-roof-inn', label: 'west', direction: 'west' },
        { id: 'square-to-shop', fromLocationId: 'bellwold-market-square', toLocationId: 'marrs-general-goods', label: 'east', direction: 'east' },
        { id: 'square-to-tower-road', fromLocationId: 'bellwold-market-square', toLocationId: 'old-bell-tower-approach', label: 'north', direction: 'north' },
      ],
      npcs: [
        {
          id: 'anwen-marr',
          name: 'Anwen Marr',
          description: 'A practical merchant keeps one eye on the market and another on the balance scale at her side.',
          greeting: '“Welcome to Bellwold. The market is small, but its roads carry more stories than goods.”',
          topics: [
            { id: 'bellwold', keywords: ['bellwold', 'village'], response: '“We trade with the frontier and keep our own measures. Not every mark means the same thing beyond the next ridge.”' },
            { id: 'old-bell', keywords: ['bell', 'tower'], response: '“The old tower is part of Bellwold’s history. What its bell once meant is still debated.”' },
            { id: 'elira', keywords: ['elira', 'professor', 'scholar'], response: '“Professor Elira Venn came here to study the old records. No one has settled what happened after she disappeared.”' },
          ],
          unknownTopicResponse: '“I can tell you what trade has taught me, but I won’t guess at the rest.”',
        },
      ],
    },
    {
      id: 'kindly-roof-inn',
      name: 'The Kindly Roof',
      description: 'The village inn offers a warm room to travelers. A noticeboard by the entrance carries a careful copy of the current road reports.',
      mapPosition: { x: -1, y: 0, terrain: 'building' },
      exits: [
        { id: 'inn-to-square', fromLocationId: 'kindly-roof-inn', toLocationId: 'bellwold-market-square', label: 'east', direction: 'east' },
      ],
      npcs: [
        {
          id: 'tomas-innkeeper',
          name: 'Tomas',
          description: 'The innkeeper tends to the common room and listens more than he speaks.',
          greeting: '“Come in out of the weather. The road reports are on the board.”',
          topics: [
            { id: 'road', keywords: ['road', 'travel'], response: '“The old mill road is passable. If you go there, mind what you take for an ordinary sound.”' },
            { id: 'elira', keywords: ['elira', 'professor', 'scholar'], response: '“Professor Venn stayed here while studying Bellwold’s records. I have no word of where she went.”' },
          ],
          unknownTopicResponse: '“I keep rooms and hear travelers. I don’t claim to know every answer.”',
        },
      ],
    },
    {
      id: 'marrs-general-goods',
      name: 'Marr’s General Goods',
      description: 'Shelves of everyday provisions line the shop. Anwen’s unusual balance scale rests near the counter; its readings are not always possible.',
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
          id: 'anwen-shop',
          name: 'Anwen Marr',
          description: 'Anwen checks the scale and returns to her ledger.',
          greeting: '“If you want to understand the scale, start with what it does—not with what you hope it means.”',
          topics: [
            { id: 'scale', keywords: ['scale', 'measure', 'measurement'], response: '“The readings are repeatable often enough to trouble me. That does not tell us what causes them.”' },
            { id: 'sprite', keywords: ['sprite', 'spirit'], response: '“A sprite is one possibility people raise. It is not an answer I can prove.”' },
          ],
          unknownTopicResponse: '“I’m working. Ask plainly, and I’ll answer if I know.”',
        },
      ],
    },
    {
      id: 'old-bell-tower-approach',
      name: 'Old Bell Tower Road',
      description: 'The road leaves Bellwold’s market and climbs toward the old tower. The bell has been silent long enough for people to disagree about its history.',
      mapPosition: { x: 0, y: -1, terrain: 'land' },
      exits: [
        { id: 'tower-road-to-square', fromLocationId: 'old-bell-tower-approach', toLocationId: 'bellwold-market-square', label: 'south', direction: 'south' },
        { id: 'tower-road-to-tower', fromLocationId: 'old-bell-tower-approach', toLocationId: 'old-bell-tower', label: 'north', direction: 'north' },
        { id: 'tower-road-to-mill', fromLocationId: 'old-bell-tower-approach', toLocationId: 'abandoned-watermill', label: 'east', direction: 'east' },
      ],
    },
    {
      id: 'old-bell-tower',
      name: 'Old Bell Tower',
      description: 'The old tower stands above the village road. Its bell and the records connected to it have drawn scholars, local stories, and no settled explanation.',
      mapPosition: { x: 0, y: -2, terrain: 'building' },
      exits: [
        { id: 'tower-to-road', fromLocationId: 'old-bell-tower', toLocationId: 'old-bell-tower-approach', label: 'south', direction: 'south' },
      ],
      readables: [
        {
          id: 'bellwold-tower-inscription',
          label: 'Tower inscription',
          description: 'A weathered inscription at the tower entrance.',
          text: 'The worn inscription records a date and the names of three bellwrights. It says nothing about why the bell fell silent.',
        },
      ],
    },
    {
      id: 'abandoned-watermill',
      name: 'Abandoned Watermill',
      description: 'The mill stands quiet beside its channel. Locals say it has continued operating at times when no one was there to turn its wheel; the cause remains uncertain.',
      mapPosition: { x: 1, y: -1, terrain: 'land' },
      exits: [
        { id: 'mill-to-tower-road', fromLocationId: 'abandoned-watermill', toLocationId: 'old-bell-tower-approach', label: 'west', direction: 'west' },
      ],
      readables: [
        {
          id: 'mill-work-ledger',
          label: 'Mill work ledger',
          description: 'A damp ledger left on the mill desk.',
          text: 'The last entries record the mill wheel moving on nights when the channel was low. The writer notes the observation without offering an explanation.',
        },
      ],
    },
  ],
  quests: [
    {
      id: 'bellwold-mill-observations',
      version: '1.0.0',
      title: 'A Note from the Mill',
      summary: 'Visit the abandoned watermill and read its work ledger. The account records an unexplained observation, not a confirmed cause.',
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
  'Explore Bellwold, a frontier village of trade, the silent old bell, unusual measurements, and unresolved local mysteries.';
