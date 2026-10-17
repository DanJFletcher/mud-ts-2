import type { Meta, StoryObj } from '@storybook/react';
import { Panel } from './Panel.js';

const meta = { title: 'Foundation/Panel', component: Panel, args: { title: 'A quiet place', eyebrow: 'World notes', children: 'The clearing is calm beneath the canopy.' } } satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithoutHeading: Story = { args: { title: undefined, eyebrow: undefined } };
