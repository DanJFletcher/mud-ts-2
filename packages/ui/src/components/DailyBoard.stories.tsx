import type { Meta, StoryObj } from '@storybook/react';
import { DailyBoard } from './DailyBoard.js';

const meta = {
  title: 'Gameplay/DailyBoard',
  component: DailyBoard,
  args: {
    name: 'Reedbank Notice Board',
    cycle: '2026-10-23',
    resetsAt: '2026-10-24T00:00:00.000Z',
    jobs: [
      { id: 'herbs', poster: 'Sella, riverside trader', title: 'Gather river mint', supplyTypeId: 'river-mint', supplyLabel: 'River mint', quantity: 3, carried: 1, gold: 18, experience: 12, status: 'active' },
      { id: 'reeds', poster: 'Keeper Olan', title: 'Bundle fresh reeds', supplyTypeId: 'fresh-reed', supplyLabel: 'Fresh reeds', quantity: 2, carried: 0, gold: 14, experience: 9, status: 'available' },
      { id: 'lamp-oil', poster: 'Mira at the ferry', title: 'Bring lamp oil', supplyTypeId: 'lamp-oil', supplyLabel: 'Lamp oil', quantity: 1, carried: 1, gold: 11, experience: 7, status: 'completed' },
    ],
    onAccept: () => undefined,
    onDeliver: () => undefined,
  },
} satisfies Meta<typeof DailyBoard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compact: Story = {};
export const Busy: Story = { args: { pendingJobId: 'herbs' } };
export const Loading: Story = { args: { loading: true } };
export const ErrorWithRetry: Story = { args: { error: 'The notice board could not be reached.', onRetry: () => undefined } };
export const Narrow: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
