import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices, bulletinTopic } from '../dialogue.js';
import { tomasJobs, darricJobs } from '../daily-jobs.js';
export const bellwoldCommerce = {
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
          choices: smallTalkChoices({
            npcId: 'tomas-innkeeper',
            identity: '“Tomas. I keep the rooms and common table at the Kindly Roof.”',
            activity: '“I’m tending the inn and listening for travelers’ news. I try to keep what I hear separate from what I know.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is a place where the roads bring fresh faces through, but most of the work is still done by the people who live here.”' },
            additionalQuestions: [
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
            ]
          }),
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
            ...smallTalkChoices({
              npcId: 'anwen-marr',
              identity: '“Anwen Marr. I run this shop and keep notes on measurements that do not quite add up.”',
              activity: '“I’m checking a scale against its weights and recording the readings before I draw any conclusions.”',
              town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold gets by on practical exchange. That makes honest measures and clear records important, even when they raise more questions.”' },
              additionalQuestions: [
                {
                  id: 'scale-readings',
                  label: 'What do the scale readings tell you?',
                  response: '“They repeat often enough to deserve attention. That tells me the pattern is real; it does not tell me what causes it.”',
                },
              ]
            }),
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
          choices: smallTalkChoices({
            npcId: 'ilya-fen',
            identity: '“Ilya Fen. I tend this workroom and help with the ordinary aches and cuts people bring through the door.”',
            activity: '“I’m sorting plants and preparing clean cloth. I keep track of what I have actually tried.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is neighborly in a practical way. People bring one another news, herbs, and a hand when work piles up.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'darric-holt',
            identity: '“Darric Holt. I mend tools, hinges, blades, and whatever else survives the forge.”',
            activity: '“I’m repairing a farm fitting. It is easier to find the fault while the metal is still warm.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold holds together because people repair what they have. New work matters, but so does keeping a gate on its hinges.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'rell-soven',
            identity: '“Rell Soven. My family has made and mended wheels here for as long as I can remember.”',
            activity: '“I’m checking a cart wheel for a wobble before I fit it back to the axle.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold’s lanes are rough on carts. That keeps my yard busy, and it means the village can keep moving its goods.”' },
            additionalQuestions: [
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
            ]
          }),
        },
      },
    ],
  }
} satisfies WorldPackContent['locationContent'];
