import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button.js';

const meta = { title: 'Foundation/Button', component: Button, args: { children: 'Take a step' }, argTypes: { variant: { control: 'radio', options: ['primary', 'secondary', 'quiet'] } } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Look around' } };
export const Disabled: Story = { args: { disabled: true, children: 'Unavailable' } };
