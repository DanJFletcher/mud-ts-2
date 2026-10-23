import type { Meta, StoryObj } from '@storybook/react';
import { StaminaStatus } from './StaminaStatus.js';

const meta = {
  title: 'Game/StaminaStatus',
  component: StaminaStatus,
  args: {
    current: 72,
    maximum: 100,
    posture: 'standing',
    onRest: () => undefined,
    onStand: () => undefined,
  },
} satisfies Meta<typeof StaminaStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SafeAndStanding: Story = {};
export const Resting: Story = { args: { posture: 'resting', current: 84 } };
export const Busy: Story = { args: { disabled: true } };
