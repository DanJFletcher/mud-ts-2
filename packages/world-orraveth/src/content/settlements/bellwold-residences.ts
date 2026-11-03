import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices, bulletinTopic } from '../dialogue.js';
import { seliJobs } from '../daily-jobs.js';
export const bellwoldResidences = {

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
          choices: smallTalkChoices({
            npcId: 'seli-tor',
            identity: '“Seli Tor. I weave cloth and mend the things people need to carry or wear.”',
            activity: '“I’m working a length of cloth at the loom. If I stop halfway through, I lose the line.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold’s lanes are close, so people notice one another’s work. Most neighbors are willing to lend a hand when it is needed.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'aven-rusk',
            identity: '“Aven Rusk. I keep the grain store’s tally and check what comes in and goes out.”',
            activity: '“I’m comparing the chalk marks on these bins with the ledger before I update the count.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold shares stores when it has to. Clear records help us know what is here without pretending to predict what comes next.”' },
            additionalQuestions: [
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
            ]
          }),
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
            ...smallTalkChoices({
              npcId: 'enna-pell',
              identity: '“Enna Pell. I keep the Common House records and copy notices people bring in.”',
              activity: '“I’m writing down the wording of a public notice so the next meeting can check it.”',
              town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is held together by small agreements. I try to record what people actually decided, not what I think they meant.”' },
              additionalQuestions: [
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
              ]
            }),
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
          choices: smallTalkChoices({
            npcId: 'sella-nettlemere',
            identity: '“Sella Nettlemere. I keep this house and bake when there is flour to spare.”',
            activity: '“I’m kneading a little dough and keeping an ear on the kettle. It tends to complain before it boils over.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold is a place where a warm loaf can bring half the lane to the door. People share what they can.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'tovin-ashdown',
            identity: '“Tovin Ashdown. I weave cloth here and patch it when it wears through.”',
            activity: '“I’m working the shuttle across the loom. I need to finish this row before I can check the loose thread.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold’s houses grew around the jobs people had to do. The lanes are practical, even if they can be hard to navigate at first.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'renna-kell',
            identity: '“Renna Kell. I mend boards, shutters, and the small things that keep a house dry.”',
            activity: '“I’m trimming a warped plank so it will sit straight against the frame.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold’s lower lanes are full of people fixing one another’s roofs and doors. A good board is worth more than a grand promise.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'pella-wren',
            identity: '“Pella Wren. I grow herbs in pots and trade what I can spare.”',
            activity: '“I’m sorting thyme for drying. It keeps its scent better if I handle it gently.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold has room for little gardens between the houses. People trade cuttings and stories over the fence.”' },
            additionalQuestions: [
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
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'sergeant-nera-vail',
            identity: '“Sergeant Nera Vail. I oversee this jail and keep its records.”',
            activity: '“I’m checking the keys and making sure the holding cell is in order.”',
            town: { key: 'bellwold', name: 'Bellwold', response: '“Bellwold needs a watch, but a claim is not proof. I keep the record clear and let the facts speak for themselves.”' },
            additionalQuestions: [
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
            ]
          }),
        },
      },
    ],
  }
} satisfies WorldPackContent['locationContent'];
