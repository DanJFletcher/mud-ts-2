import type { Meta, StoryObj } from '@storybook/react';
import { TextInput } from './TextInput.js';

const meta = { title: 'Foundation/TextInput', component: TextInput, args: { id: 'character-name', label: 'Character name', placeholder: 'A name for your traveler', maxLength: 48 } } satisfies Meta<typeof TextInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Up to 48 characters.' } };
export const WithError: Story = { args: { error: 'Enter a name before continuing.' } };
