import type { Meta, StoryObj } from '@storybook/react';
import { CraftingQuantityDialog } from './CraftingQuantityDialog.js';

const meta = {
  title: 'Components/CraftingQuantityDialog',
  component: CraftingQuantityDialog,
  args: {
    itemLabel: 'Leather gloves',
    choices: [
      { quantity: 1 },
      { quantity: 5 },
      { quantity: 10, disabled: true },
    ],
    onSelect: (quantity) => console.info('Craft quantity selected:', quantity),
    onClose: () => console.info('Craft quantity dialog closed'),
  },
} satisfies Meta<typeof CraftingQuantityDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
