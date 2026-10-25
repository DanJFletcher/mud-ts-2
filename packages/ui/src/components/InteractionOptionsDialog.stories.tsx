import type { Meta, StoryObj } from '@storybook/react';
import { InteractionOptionsDialog } from './InteractionOptionsDialog.js';

const meta = {
  title: 'Gameplay/InteractionOptionsDialog',
  component: InteractionOptionsDialog,
  args: {
    targetLabel: 'Weathered marker',
    options: [
      { id: 'look', label: 'Look' },
      { id: 'read', label: 'Read' },
    ],
    onSelect: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof InteractionOptionsDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReadOrLook: Story = {};
export const ObjectActions: Story = {
  args: {
    targetLabel: 'Practice Sentinel',
    options: [
      { id: 'look', label: 'Look' },
      { id: 'talk', label: 'Talk' },
      { id: 'attack', label: 'Attack' },
    ],
  },
};
