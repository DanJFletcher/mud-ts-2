import type { Meta, StoryObj } from '@storybook/react';
import { ClassAbilityList } from './ClassAbilityList.js';
import type { AvailableClassAction } from './classTypes.js';

const actions: AvailableClassAction[] = [
  { id: 'ember-thread', label: 'Ember thread', description: 'Send a thin line of heat toward your opponent.', cost: { resource: 'mana', amount: 4 }, available: true },
  { id: 'warding-step', label: 'Warding step', description: 'Set your stance and blunt the next incoming strike.', cost: { resource: 'stamina', amount: 3 }, available: false, unavailableReason: 'Not enough stamina.' },
];

const meta = {
  title: 'Game/ClassAbilityList',
  component: ClassAbilityList,
  args: { actions, onUse: () => undefined },
} satisfies Meta<typeof ClassAbilityList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AvailableAndUnavailable: Story = {};
export const Empty: Story = { args: { actions: [] } };
export const Busy: Story = { args: { busyActionId: 'ember-thread', disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const Error: Story = { args: { error: 'Class actions could not be loaded.' } };
export const LongContent: Story = {
  args: {
    actions: [{ ...actions[0]!, description: 'A long description stays readable on a narrow screen and gives the player enough context to make a clear decision before committing this action.' }],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
