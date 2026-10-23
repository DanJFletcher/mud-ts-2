import type { Meta, StoryObj } from '@storybook/react';
import { WorldHero } from './WorldHero.js';

const meta = {
  title: 'Lobby/WorldHero',
  component: WorldHero,
  args: {
    name: 'Orraveth',
    summary: 'A quiet expanse of salt, old roads, and cities built to watch the horizon.',
    introduction: [
      'The wind has spent centuries smoothing the white plain. Waystones still mark routes between the scattered settlements.',
      'Travelers come carrying maps, questions, and the patience to listen.',
    ],
  },
} satisfies Meta<typeof WorldHero>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Introduction: Story = {};
export const Illustrated: Story = { args: { imageSrc: '/worlds/orraveth.webp' } };
export const FailedImageFallback: Story = { args: { imageSrc: '/missing-world-cover.webp' } };
export const NarrowLongTitle: Story = {
  args: {
    name: 'The Long and Quiet Road Beyond the Shattered Meridian',
    summary: 'A world of far horizons.',
    introduction: ['A long introduction remains readable and wraps without being trapped inside a fixed-height crop. '.repeat(4)],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const DarkTheme: Story = {
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
