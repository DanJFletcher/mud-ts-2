import type { Meta, StoryObj } from '@storybook/react';
import { Text } from './Text.js';

const meta = { title: 'Foundation/Text', component: Text, args: { children: 'A clear path runs between the old stones.' }, argTypes: { variant: { control: 'radio', options: ['display', 'heading', 'body', 'muted', 'eyebrow'] } } } satisfies Meta<typeof Text>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Body: Story = {};
export const Display: Story = { args: { as: 'h1', variant: 'display', children: 'Find your way' } };
export const Eyebrow: Story = { args: { variant: 'eyebrow', children: 'Current location' } };
