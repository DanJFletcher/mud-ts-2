import type { Meta, StoryObj } from '@storybook/react';
import { NavigationControls } from './NavigationControls.js';

const meta = { title: 'Exploration/NavigationControls', component: NavigationControls, args: {
  exits: [
    { id: 'bridge', direction: 'north', label: 'North to Glasswater Bridge', available: true },
    { id: 'clearing', direction: 'south', label: 'South to Mossgate Clearing', available: true },
    { id: 'tower', direction: 'east', label: 'East to the Old Bell Tower', available: true },
    { id: 'belfry', direction: 'up', label: 'Up to the belfry', available: true },
  ],
  onMove: (exitId: string) => console.info('Move requested:', exitId),
  onAmbiguousDirection: (direction: string) => console.info('Choose a destination:', direction),
} } satisfies Meta<typeof NavigationControls>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Moving: Story = { args: { pendingExitId: 'bridge', disabled: true } };
export const NoExits: Story = { args: { exits: [] } };
export const AmbiguousNorth: Story = { args: { exits: [
  { id: 'bridge', direction: 'north', label: 'North to Glasswater Bridge', available: true },
  { id: 'ridge', direction: 'north', label: 'North to the ridge', available: true },
] } };
