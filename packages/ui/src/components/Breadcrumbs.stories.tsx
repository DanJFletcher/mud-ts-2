import type { Meta, StoryObj } from '@storybook/react';
import { Breadcrumbs } from './Breadcrumbs.js';

const meta = {
  title: 'Navigation/Breadcrumbs',
  component: Breadcrumbs,
  args: {
    items: [
      { label: 'Worlds', href: '/' },
      { label: 'Orraveth: Bellwold', href: '/worlds/orraveth-bellwold-instance' },
      { label: 'Characters', href: '/worlds/orraveth-bellwold-instance/characters' },
      { label: 'Isaac' },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CharacterDetails: Story = {};

export const LongLabelsOnMobile: Story = {
  args: {
    items: [
      { label: 'Worlds', href: '/' },
      { label: 'The Far Country Beyond the Old Salt Road', href: '/worlds/far-country' },
      { label: 'Characters', href: '/worlds/far-country/characters' },
      { label: 'A Traveler With a Long Name' },
    ],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const DarkTheme: Story = {
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
