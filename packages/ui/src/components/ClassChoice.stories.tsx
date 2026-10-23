import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ClassChoice, type ClassChoiceProps } from './ClassChoice.js';
import type { CharacterClassDefinition } from './classTypes.js';

const classes: CharacterClassDefinition[] = [
  {
    id: 'warden', revision: 1, label: 'Warden',
    description: 'A steady front-line protector, trained to hold ground when the road turns dangerous.',
    primaryAttribute: 'strength',
    attributes: { strength: 14, intelligence: 8, constitution: 13, dexterity: 10 },
    coreAction: { id: 'shield-break', revision: 1, label: 'Shield break', description: 'Drive a measured strike through an opening.', cost: { resource: 'stamina', amount: 3 }, baseDamage: 6, scalingAttribute: 'strength', weaponBonus: true },
  },
  {
    id: 'arcanist', revision: 1, label: 'Arcanist',
    description: 'A careful student of hidden forces who favors distance, patience, and a clear mind.',
    primaryAttribute: 'intelligence',
    attributes: { strength: 8, intelligence: 15, constitution: 9, dexterity: 13 },
    coreAction: { id: 'ember-thread', revision: 1, label: 'Ember thread', description: 'Send a thin line of heat toward your opponent.', cost: { resource: 'mana', amount: 4 }, baseDamage: 7, scalingAttribute: 'intelligence', weaponBonus: false },
  },
];

const meta = {
  title: 'Game/ClassChoice',
  component: ClassChoice,
  args: { classes, onChange: () => undefined },
} satisfies Meta<typeof ClassChoice>;
export default meta;
type Story = StoryObj<typeof meta>;

function InteractiveClassChoice(props: ClassChoiceProps) {
  const [value, setValue] = useState<string>();
  return <ClassChoice {...props} value={value} onChange={setValue} />;
}

export const Unselected: Story = {};
export const Selected: Story = { args: { value: 'warden' } };
export const NarrowLongCopy: Story = {
  args: {
    classes: [{
      ...classes[1]!,
      description: 'A patient and disciplined practitioner whose years of study have prepared them to notice the small signs others miss. They prefer careful preparation and measured action over force.',
      coreAction: { ...classes[1]!.coreAction, description: 'A deliberately extended description demonstrates that action details wrap without clipping or pushing the resource cost out of view.' },
    }],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const Disabled: Story = { args: { disabled: true, value: 'warden' } };
export const Loading: Story = { args: { loading: true } };
export const CatalogError: Story = { args: { error: 'Class choices could not be loaded. Try again.' } };
export const Interactive: Story = {
  render: (args) => <InteractiveClassChoice {...args} />,
};
