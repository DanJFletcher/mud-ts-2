import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './Skeleton.js';

const meta = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  args: { variant: 'text' },
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextLine: Story = { args: { width: '14rem' } };
export const Block: Story = { args: { variant: 'block', width: '12rem', height: '5rem' } };
export const Avatar: Story = { args: { variant: 'circle', width: '3rem', height: '3rem' } };
export const DarkTheme: Story = {
  args: { variant: 'block', width: '12rem', height: '5rem' },
  decorators: [(StoryComponent) => <div data-theme="dark" style={{ padding: '1rem', background: 'var(--mudd-bg)' }}><StoryComponent /></div>],
};
