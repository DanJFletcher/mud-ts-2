import type { WorldPackContent } from '@mudd/contracts';
import { smallTalkChoices } from '../dialogue.js';
export const mosswake = {
  'mosswake-channel': { requiresWaterTravel: true },
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
          choices: smallTalkChoices({
            npcId: 'tavin-reed',
            identity: '“Tavin Reed. I make and repair boats here. My family has navigated these wetlands for a long time; I am still earning my own standing.”',
            activity: '“Checking this hull against the batten. It needs to sit right in shallow channels, not just look fair on the blocks.”',
            town: { key: 'mosswake', name: 'Mosswake', response: '“Mosswake is an independent community. Fishing, reeds, plants and boats keep us in touch with our neighbours. The people who use the causeway keep it passable.”' },
            additionalQuestions: [
              { id: 'shallow-hulls', label: 'What does shallow water ask of a hull?', response: '“A hull has to suit the channel, and a repair has to last through use. I would rather look at the water with the person taking the boat than guess from here.”' },
              { id: 'dredging', label: 'Has the dredging proposal been agreed?', response: '“No settled agreement that I can give you. The consortium sees deposits and possible contracts; people here also see fishing grounds and changing channels. I want those concerns heard together.”' },
              { id: 'fish', label: 'Why are there fewer fish?', response: '“I do not know. Some families report poorer catches. A report about a catch is not proof of its cause.”' },
            ]
          }),
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
          choices: smallTalkChoices({
            npcId: 'mosswake-herbalist',
            identity: '“A herbalist here in Mosswake. I sort and gather plants; I am not a guide to every part of the marsh.”',
            activity: '“Separating the damp leaves before they spoil the dry bundle.”',
            town: { key: 'mosswake', name: 'Mosswake', response: '“We live above wet ground and keep our own paths and platforms. Different families have different knowledge of the places beyond them.”' },
            additionalQuestions: [
              { id: 'plants', label: 'Are these plants always available?', response: '“No. Water and season matter. We trade herbs, reeds and fish, but a trading list is not a promise of an unlimited supply.”' },
              { id: 'territories', label: 'What lies beyond the last planks?', response: '“Water that some families recognise as sprite territory. That recognition is not one boundary I can draw for everyone, and there is no marked passage from here.”' },
              { id: 'fish', label: 'What have you heard about the fish?', response: '“Poorer catches in some parts, according to neighbours who fish there. How far the decline goes, and why, are still disputed.”' },
            ]
          }),
        },
      }],
  },
  'mosswake-open-water': {
    requiresWaterTravel: true,
    readables: [{
        id: 'mosswake-dredging-survey-notice',
        label: 'Dredging survey notice',
        description: 'A public notice tied above the waterline, its lower corners curled with damp.',
        text: 'Proposal for a survey of deposits beneath the water. The commercial consortium seeks discussion of possible dredging. This notice records a proposal, not permission to dredge or enter recognised sprite territories. Residents raise concerns about fisheries and channels; others raise possible income and work. No agreement or explanation for the reported fish decline is recorded here.',
      }],
  }
} satisfies WorldPackContent['locationContent'];
