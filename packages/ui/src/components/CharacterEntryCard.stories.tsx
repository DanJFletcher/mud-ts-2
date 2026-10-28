import type { Meta, StoryObj } from '@storybook/react';
import { CharacterEntryCard } from './CharacterEntryCard.js';

const meta = {
  title: 'Lobby/CharacterEntryCard',
  component: CharacterEntryCard,
  args: {
    name: 'Mira of the Reedbank',
    worldName: 'The Waystone Path',
    classLabel: 'Wayfinder',
    level: 7,
    statusLabel: 'Ready to continue',
    actionLabel: 'Continue as Mira',
    detailsHref: '/character/mira',
    onPlay: () => undefined,
  },
} satisfies Meta<typeof CharacterEntryCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RecentCharacter: Story = {};
export const CompactRosterRow: Story = {
  args: {
    compact: true,
    worldName: undefined,
    statusLabel: undefined,
    actionLabel: 'Play as Mira',
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const LoadingEntry: Story = { args: { busy: true } };
export const DisabledEntry: Story = { args: { disabled: true, statusLabel: 'Entry unavailable' } };
export const LongNameAndLocation: Story = {
  args: {
    name: 'Mira Who Remembers the Names of Every River',
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const NoClassOrLevel: Story = {
  args: { classLabel: undefined, level: undefined, worldName: undefined, statusLabel: 'New traveler', actionLabel: 'Play as Mira' },
};
export const WithManagementAndFormSlots: Story = {
  args: {
    secondaryActions: <button className="mudd-button mudd-button--quiet" type="button">Manage</button>,
    children: <p className="mudd-text mudd-text--muted">Rename or archive this traveler from the world roster.</p>,
  },
};
export const DarkTheme: Story = {
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
