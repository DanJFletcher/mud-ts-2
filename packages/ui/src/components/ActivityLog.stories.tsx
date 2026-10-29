import type { Meta, StoryObj } from '@storybook/react';
import { ActivityLog } from './ActivityLog.js';

const meta = { title: 'Exploration/ActivityLog', component: ActivityLog } satisfies Meta<typeof ActivityLog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { args: { entries: [] } };
export const WithEntries: Story = { args: { entries: [
  { id: '1', kind: 'system', text: 'You enter the Waystone Path.' },
  { id: '2', kind: 'narration', text: 'A circle of pale stones breaks through the moss.' },
] } };
export const WithError: Story = { args: { entries: [{ id: '1', kind: 'error', text: 'That path is not open from here.' }] } };
export const WithInteractiveEntities: Story = {
  args: {
    entries: [{
      id: '1',
      kind: 'narration',
      locationId: 'waystone-path',
      text: 'A brown squirrel sits here, anxiously munching on a nut.',
    }],
    currentLocationId: 'waystone-path',
    lookTargets: [
      { id: 'squirrel', label: 'Brown Squirrel' },
      { id: 'nut', label: 'nut' },
    ],
    onLookTarget: (target) => console.info('Look at:', target.label),
  },
};
export const WithUsableTree: Story = {
  args: {
    entries: [{
      id: 'tree-description',
      kind: 'narration',
      locationId: 'southbound-track',
      text: 'A pine tree stands beside the packed road, its resin scent sharp in the air.',
    }],
    currentLocationId: 'southbound-track',
    lookTargets: [{
      id: 'woodcutting-tree:southbound-pine',
      label: 'A pine tree',
      actionDialogTitle: 'Choose an item to use on A pine tree',
      actions: [{ id: 'use-tree:copper-axe', label: 'Copper Axe' }],
    }],
    onLookTarget: (target) => console.info('Choose an item for:', target.label),
  },
};
