import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices } from '../dialogue.js';
export const rillford = {
  'rillford-crossing': {
    requiresWaterTravel: true,
    defaultStateId: 'stage',
    states: [
      { id: 'stage', requiresWaterTravel: false },
      {
        id: 'water',
        requiresWaterTravel: true,
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
          choices: smallTalkChoices({
            npcId: 'rillford-customs-clerk',
            identity: '“A clerk of the customs house. I write down what crosses the quay.”',
            activity: '“Copying today’s declarations. Every line has to match the bill.”',
            town: { key: 'rillford', name: 'Rillford', response: '“Busy. Boats in, boats out, and everyone sure their cargo is the one that matters.”' },
            additionalQuestions: [
              {
                id: 'cargo-notice',
                label: 'What does the cargo notice ask for?',
                response: '“Goods, quantity, owner, and the boat or cart carrying them. Bring me those and you’re done here.”',
              },
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'selda-rook',
            identity: '“Selda Rook. I speak for the merchants who want river commerce run by agreed rules. Not all of them, mind.”',
            activity: '“Checking bills of lading. If a boat goes over, I want to know what it carried before anyone tells me why.”',
            town: { key: 'rillford', name: 'Rillford', response: '“A crossing town. Warehouses, customs, a livestock market each week, and more opinions about the river than boats on it.”' },
            additionalQuestions: [
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
            ]
          }),
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
          { id: 'ferry', keywords: ['ferry guild', 'ferry dispute', 'guild', 'rights', 'exclusive', 'dispute'], response: '“The guild calls it regulation. To me it looks like a fence round the river with their name on the gate. Rules written by the biggest boats tend to suit the biggest boats.”' },
          { id: 'silverfin', keywords: ['Silverfin', 'Old Silverfin', 'sprite', 'overturned', 'capsized'], response: '“Some crews say it’s a warning. Some say it’s bad loading. A few reckon someone’s tipping boats on purpose to settle the ferry fight. I’ve not seen it myself, so I won’t tell you which.”' },
          { id: 'passage', keywords: ['passage', 'crossing', 'boat', 'across', 'ferry stage', 'ferry'], response: '“Crossing’s arranged boat by boat. Nobody’s carrying passengers off this quay just now.”' },
          { id: 'river', keywords: ['river', 'Rill', 'Lower Rill', 'current'], response: '“Watch the current, not the stories. It changes with the weather, and it doesn’t care who holds the rights.”' },
        ],
        unknownTopicResponse: '“I know boats and this stretch of water. Ask about those.”',
        dialogue: {
          prompt: '“If you’re from the guild, I’ve said my piece. If not, sit down.”',
          choices: smallTalkChoices({
            npcId: 'rillford-independent-boatman',
            identity: '“I work my own boat. No guild, no exclusive rights, and I’d like to keep it that way.”',
            activity: '“Splicing rope. A frayed line costs more than a slow afternoon.”',
            town: { key: 'rillford', name: 'Rillford', response: '“Good water, crowded quay, and everyone arguing over who gets to carry what.”' },
            additionalQuestions: [
              {
                id: 'crossing',
                label: 'Can you take me across?',
                response: '“Not from here, not now. Who carries whom across is half of what the guild fight is about.”',
              },
            ]
          }),
        },
      },
    ],
  }
} satisfies WorldPackContent['locationContent'];
