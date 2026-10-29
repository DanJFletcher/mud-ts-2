import type { Meta, StoryObj } from '@storybook/react';
import { CharacterEntryCardSkeleton } from './CharacterEntryCardSkeleton.js';

const meta = {
  title: 'Lobby/CharacterEntryCardSkeleton',
  component: CharacterEntryCardSkeleton,
  args: { compact: true },
} satisfies Meta<typeof CharacterEntryCardSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RecentCharacters: Story = {
  render: () => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.6rem' }}>
    <CharacterEntryCardSkeleton compact />
    <CharacterEntryCardSkeleton compact />
  </div>,
};
export const SingleColumnRoster: Story = {
  render: () => <div style={{ display: 'grid', gap: '.6rem' }}>
    <CharacterEntryCardSkeleton compact />
    <CharacterEntryCardSkeleton compact />
    <CharacterEntryCardSkeleton compact />
  </div>,
};
export const WorldBoundCharacter: Story = { args: { compact: true, showWorldName: false } };
export const DarkTheme: Story = {
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
