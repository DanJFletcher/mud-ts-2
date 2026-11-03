import type { WorldPackContent } from '@mudd/contracts';
export const quests = [
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
] satisfies WorldPackContent['quests'];
