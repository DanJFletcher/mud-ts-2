import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices } from '../dialogue.js';
export const ashcombe = {
  'ashcombe-kest-workshop': {
    npcs: [{
        id: 'oren-kest',
        name: 'Oren Kest',
        description: 'A man holds two shaped pieces of wood together above the bench, checking the seam against the light.',
        activityDescription: 'checking a fitted wooden joint',
        greeting: '“Tell me where the timber came from before you tell me how straight it is.”',
        topics: [
          { id: 'stands', keywords: ['stands', 'timber', 'wood', 'refusal'], response: '“There are stands I will not take timber from. My suppliers know my refusal; it is not a public map of everyone’s rights. How a tree was taken matters to me as much as the board it yields.”' },
          { id: 'concessions', keywords: ['concession', 'concessions', 'Heskar', 'permits'], response: '“Officials have granted larger concessions. Some neighbours see reliable work; others dispute which stands those grants can include. A grant does not settle every older practice or obligation.”' },
          { id: 'oak', keywords: ['oak', 'sap', 'voices', 'rumour'], response: '“Workers said the old oak wept clear sap, and some reported voices in the lumber. I have heard the accounts. I do not know whether a sprite lived there or what caused the sounds.”' },
        ],
        unknownTopicResponse: '“I can answer for the wood I accept and the work on this bench. I do not speak for all the woods.”',
        dialogue: {
          prompt: '“The joint can wait a moment. What did you want to ask?”',
          choices: smallTalkChoices({
            npcId: 'oren-kest',
            identity: '“Oren Kest. A carpenter here in Ashcombe. I make wooden fittings and other work the yards and households need.”',
            activity: '“Checking this joint before I shape the next piece. Good wood is wasted by a poor fit.”',
            town: { key: 'ashcombe', name: 'Ashcombe', response: '“Ashcombe is within Heskar. Timber, charcoal, carts and carpentry feed households here and trade beyond us. People disagree about how far the new concessions should reach.”' },
            additionalQuestions: [
              { id: 'stands', label: 'Why refuse timber from some stands?', response: '“A straight board is not the whole account of a harvest. I consider where and how the tree was taken. My refusal is my own; it does not settle every neighbour’s view.”' },
              { id: 'concessions', label: 'Do the concessions settle access to the woods?', response: '“No. They are grants issued by officials, and people dispute which stands they can include. Some welcome steadier orders; others worry what will remain for future households.”' },
              { id: 'oak', label: 'What do you know about the felled oak?', response: '“I heard workers describe clear sap and voices in the lumber. Others call the sounds settling wood or a rumour. I cannot turn those reports into an explanation.”' },
            ]
          }),
        },
      }],
  },
  'ashcombe-cart-yard': {
    npcs: [{
        id: 'ashcombe-cartwright',
        name: 'Cartwright',
        description: 'A person braces a wooden wheel against a trestle, tapping its rim with a mallet. An unfinished axle lies nearby.',
        activityDescription: 'tapping a wheel rim beside a trestle',
        greeting: '“Give the wheel a little room. I need to hear where the rim sits loose.”',
        topics: [
          { id: 'loads', keywords: ['cart', 'carts', 'loads', 'road'], response: '“Heavy timber loads punish wheels. The hauling track takes them toward Bellwold, but a road under a cart does not tell you who may cut every stand beside it.”' },
          { id: 'orders', keywords: ['orders', 'concessions', 'work'], response: '“Some of us welcome more orders from the concessions. Work keeps a household going. That is my concern; it does not settle the arguments about which trees the grants cover.”' },
        ],
        unknownTopicResponse: '“Try Oren about the boards he refuses. I can talk about wheels and loads.”',
        dialogue: {
          prompt: '“I can talk while the wheel is on the trestle.”',
          choices: smallTalkChoices({
            npcId: 'ashcombe-cartwright',
            identity: '“A cartwright here. These wheels and axles are my work.”',
            activity: '“Listening for the loose part of this rim before another heavy load finds it.”',
            town: { key: 'ashcombe', name: 'Ashcombe', response: '“Timber, charcoal and wooden goods keep this place busy. The road brings work, and the concessions bring arguments as well as orders.”' },
            additionalQuestions: [
              { id: 'loads', label: 'What does the timber road carry?', response: '“Heavy loads toward the regional markets, including Bellwold. A wheel has to hold whether the cart carries boards or charcoal.”' },
              { id: 'orders', label: 'Do all the workers oppose the concessions?', response: '“No. Some see work they need. Others worry about the stands and the future. I welcome orders, but I cannot give you everyone’s consent.”' },
            ]
          }),
        },
      }],
  }
} satisfies WorldPackContent['locationContent'];
