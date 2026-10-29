import type { Meta, StoryObj } from '@storybook/react';
import { WorldCardSkeleton } from './WorldCardSkeleton.js';

const meta = {
  title: 'Lobby/WorldCardSkeleton',
  component: WorldCardSkeleton,
} satisfies Meta<typeof WorldCardSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DiscoveryCard: Story = {};
export const MobileWorldGrid: Story = {
  render: () => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.75rem' }}>
    <WorldCardSkeleton />
    <WorldCardSkeleton />
  </div>,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const DarkTheme: Story = {
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
