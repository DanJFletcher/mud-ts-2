export const classDefinition = {
  id: 'fixture.vanguard',
  revision: 1,
  label: 'Vanguard',
  description: 'Strength-led martial combatant.',
  primaryAttribute: 'strength',
  attributes: { strength: 15, intelligence: 10, constitution: 15, dexterity: 10 },
  coreAction: {
    id: 'fixture.heavy-strike',
    revision: 1,
    label: 'Heavy Strike',
    description: 'A single forceful strike.',
    cost: { resource: 'stamina', amount: 20 },
    baseDamage: 3,
    scalingAttribute: 'strength',
    weaponBonus: true,
  },
} as const;

export const classCatalog = {
  id: 'fixture.classes',
  revision: 1,
  classes: [classDefinition],
};
