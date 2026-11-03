import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices } from '../dialogue.js';
export const thornmere = {
  'thornmere-lake': { requiresWaterTravel: true },
  'thornmere-council-house': {
    npcs: [{
        id: 'nessa-valeen',
        name: 'Nessa Valeen',
        description: 'An elder woman sits beside an open space in the circle of chairs, her hands resting on a folded cloth.',
        activityDescription: 'listening beside the circle of chairs',
        greeting: '“Before we speak of an agreement, who has been heard?”',
        topics: [
          { id: 'agreements', keywords: ['agreement', 'agreements', 'council', 'sprites'], response: '“I help people listen to one another. A promise needs parties who understand its terms, and a way to revisit them. I cannot promise on behalf of a being who has not been heard.”' },
          { id: 'bridge', keywords: ['bridge', 'shared'], response: '“Some neighbours say a sprite shares that bridge. Their accounts are not identical. A shared place does not entitle a visitor to demand an answer.”' },
          { id: 'medicine', keywords: ['medicine', 'healer', 'Veyl', 'child'], response: '“Thornmere prohibits commercial Veyl harvesting. A healer bought essence-based medicine for a critically ill child. We still have to consider urgency, choice and the trust our rules ask of people. I have no settled council decision to give you.”' },
        ],
        unknownTopicResponse: '“I would need to hear the people involved before pretending to settle that.”',
        dialogue: {
          prompt: '“There is room in the circle. What would you like to ask?”',
          choices: smallTalkChoices({
            npcId: 'nessa-valeen',
            identity: '“Nessa Valeen. I mediate disputes here, including agreements between human neighbours and sprites.”',
            activity: '“Listening for what each person thinks was promised. The same words do not always carry the same understanding.”',
            town: { key: 'thornmere', name: 'Thornmere', response: '“Thornmere has its own council. People here keep the woodland path and make agreements about shared places, but no single custom speaks for every household or sprite.”' },
            additionalQuestions: [
              { id: 'agreements', label: 'What makes an agreement last?', response: '“The parties must understand what they are agreeing to, and how they can return to the conversation. I will not make a promise for someone who has not been heard.”' },
              { id: 'bridge', label: 'What does sharing the bridge mean?', response: '“People describe that bridge as shared with a sprite. That does not make an answer something we can require. Listen to the differing accounts without turning them into a summons.”' },
              { id: 'medicine', label: 'Has the council decided about the medicine?', response: '“I have no resolution to announce. A rigid response and an unexamined exception can each harm trust. The healer and the child are not here for a visitor to question.”' },
            ]
          }),
        },
      }],
  }
} satisfies WorldPackContent['locationContent'];
