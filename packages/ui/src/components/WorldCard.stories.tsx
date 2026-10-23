import type { Meta, StoryObj } from '@storybook/react';
import { WorldCard } from './WorldCard.js';

const meta = {
  title: 'Lobby/WorldCard',
  component: WorldCard,
  args: {
    name: 'The Waystone Path',
    summary: 'A road through old kingdoms, where every mile carries a story.',
    href: '/worlds/waystone',
  },
} satisfies Meta<typeof WorldCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextCover: Story = {};
export const Illustrated: Story = { args: { imageSrc: '/worlds/waystone.webp' } };
export const FailedImageFallback: Story = { args: { imageSrc: '/missing-world-cover.webp' } };
export const NarrowLongCopy: Story = {
  args: {
    name: 'The Far-Ranging Archive of Orraveth',
    summary: 'An old observatory watches the salt flats, keeping the names of vanished rivers and the travelers who still seek them.',
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const DarkTheme: Story = {
  args: { name: 'Orraveth', summary: 'Across the pale salt, distant lights answer one another.' },
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1.5rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
