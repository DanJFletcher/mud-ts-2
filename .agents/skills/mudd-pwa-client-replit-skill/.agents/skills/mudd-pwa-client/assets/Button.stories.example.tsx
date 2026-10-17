// Adapt imports to actual @mudd/ui paths and installed Storybook version.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Travel north', onClick: fn() },
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { isLoading: true, children: 'Moving…' } };
export const LongLabel: Story = {
  args: { children: 'Inspect the ancient ironbound doors at the far end of the corridor' },
};

export const ActivatesWithKeyboard: Story = {
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: 'Travel north' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
