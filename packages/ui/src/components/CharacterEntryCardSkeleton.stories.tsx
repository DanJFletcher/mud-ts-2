import type { Meta, StoryObj } from '@storybook/react';
import { CharacterEntryCard } from './CharacterEntryCard.js';
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
export const LoadingBesideLoadedCard: Story = {
  render: () => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.6rem' }}>
    <CharacterEntryCardSkeleton compact />
    <CharacterEntryCard
      compact
      name="Isaac"
      worldName="Orraveth: Bellwold"
      classLabel="Vanguard"
      level={7}
      actionLabel="Play as Isaac"
      onPlay={() => undefined}
      secondaryActions={<button type="button" aria-label="Manage Isaac" className="mudd-button mudd-button--quiet" style={{ width: 44, height: 44, padding: 0 }}>⋯</button>}
    />
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
