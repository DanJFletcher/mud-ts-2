import type { Meta, StoryObj } from '@storybook/react';
import { NpcDialogueDialog } from './NpcDialogueDialog.js';

const meta = {
  title: 'Gameplay/NpcDialogueDialog',
  component: NpcDialogueDialog,
  args: {
    npcName: 'Mara',
    dialogue: 'The old paths still have their stories. What would you like to ask?',
    choices: [
      { id: 'marker', label: 'Ask about the marker' },
      { id: 'tower', label: 'Ask about the bell tower' },
    ],
    onSelect: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof NpcDialogueDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Conversation: Story = {};
