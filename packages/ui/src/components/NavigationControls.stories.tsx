import type { Meta, StoryObj } from '@storybook/react';
import { NavigationControls } from './NavigationControls.js';

const meta = { title: 'Exploration/NavigationControls', component: NavigationControls, args: {
  exits: [
    { id: 'bridge', direction: 'north', label: 'North to Glasswater Bridge', available: true },
    { id: 'tower', direction: 'east', label: 'East to the Old Bell Tower', available: true },
  ],
  onMove: (exitId: string) => console.info('Move requested:', exitId),
} } satisfies Meta<typeof NavigationControls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Moving: Story = { args: { pendingExitId: 'bridge', disabled: true } };
