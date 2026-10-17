import type { Meta, StoryObj } from '@storybook/react';
import { RoomDescription } from './RoomDescription.js';

const meta = { title: 'Exploration/RoomDescription', component: RoomDescription, args: {
  title: 'Mossgate Clearing',
  description: 'A circle of pale stones breaks through the moss. A narrow path runs north, while a weathered marker points east.',
  exits: [
    { id: 'bridge', direction: 'north', label: 'North to Glasswater Bridge', available: true },
    { id: 'tower', direction: 'east', label: 'East to the Old Bell Tower', available: true },
  ],
} } satisfies Meta<typeof RoomDescription>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const NoExits: Story = { args: { exits: [] } };
