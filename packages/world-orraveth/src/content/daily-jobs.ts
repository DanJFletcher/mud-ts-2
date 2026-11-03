import type { WorldPackContent } from '@mudd/contracts';
import { bulletinResponses } from './dialogue.js';
export const seliJobs = bulletinResponses(['seli-hide', 'seli-hides'], '“You took my hide notice? Bring the hides to the South Common board when you have them. I have the torn seams ready.”', '“Those hides you delivered today will mend a good few seams. Thank you for seeing to my notice.”');
export const tomasJobs = [
  ...bulletinResponses(['tomas-fish', 'tomas-fish-basket'], '“Thank you for taking the fish notice. Deliver them at the South Common board; there is room in the supper pot.”', '“Your fish arrived from the board today. Supper will be better for it—thank you.”'),
  ...bulletinResponses(['tomas-wood'], '“You are bringing pine logs for the kitchen? Leave them through the South Common board when you are ready.”', '“The kitchen has the pine logs you delivered today. That is one less worry before supper. Thank you.”'),
];
export const darricJobs = bulletinResponses(['darric-wood'], '“You took the pine-log job. Good. Deliver the logs at the South Common board when you have enough.”', '“Your pine logs came through today. Useful work for the forge. Thank you.”');
export const dailyBoards = [{
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
  }] satisfies WorldPackContent['dailyBoards'];
