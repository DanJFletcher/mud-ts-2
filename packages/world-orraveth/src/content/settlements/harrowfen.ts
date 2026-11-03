import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices } from '../dialogue.js';

export const harrowfen = {
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
            ...smallTalkChoices({
              npcId: 'maela-thorn',
              identity: '“Maela Thorn, reeve of Harrowfen. I worked these fields before the village chose me to speak for the people who farm them.”',
              activity: '“I’m checking this season’s sacks against last year’s marks. The numbers keep coming up short.”',
              town: { key: 'harrowfen', name: 'Harrowfen', response: '“A hundred fields and a lot of opinions. The land mostly belongs to noble families; the work belongs to everyone else.”' },
              additionalQuestions: [
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
              ]
            }),
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
  }
} satisfies WorldPackContent['locationContent'];
