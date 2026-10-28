import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterClassCatalogSchema,
  CharacterClassDefinitionSchema,
} from '../dist/src/index.js';

const characterClass = (overrides = {}) => ({
  id: 'warden',
  revision: 1,
  label: 'Warden',
  description: 'A steady defender.',
  primaryAttribute: 'strength',
  attributes: {
    strength: 15,
    intelligence: 10,
    constitution: 15,
    dexterity: 10,
  },
  coreAction: {
    id: 'shield-strike',
    revision: 1,
    label: 'Shield strike',
    description: 'Strike with a guarded blow.',
    cost: { resource: 'stamina', amount: 2 },
    baseDamage: 3,
    scalingAttribute: 'strength',
    weaponBonus: true,
  },
  ...overrides,
});

test('a class catalog requires aligned starter actions, bounded attributes, and unique IDs', () => {
  const valid = {
    id: 'starter-classes',
    revision: 1,
    classes: [characterClass()],
  };
  assert.equal(CharacterClassDefinitionSchema.safeParse(characterClass()).success, true);
  assert.equal(CharacterClassCatalogSchema.safeParse(valid).success, true);

  const invalid = CharacterClassCatalogSchema.safeParse({
    ...valid,
    classes: [
      characterClass({
        attributes: {
          strength: 20,
          intelligence: 20,
          constitution: 20,
          dexterity: 10,
        },
        coreAction: { ...characterClass().coreAction, scalingAttribute: 'dexterity' },
      }),
      characterClass(),
    ],
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.issues.filter((issue) =>
    issue.message === 'A starter core action must scale from its class primary attribute.').length, 1);
  assert.equal(invalid.error.issues.filter((issue) =>
    issue.message === 'Starter attributes may total at most 60.').length, 1);
  assert.equal(invalid.error.issues.filter((issue) =>
    issue.message === 'Class and action IDs must be unique.').length, 2);
});
