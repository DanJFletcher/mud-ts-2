import { describe, expect, it } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import {
  calculateCharacterStats,
  characterAttackDamage,
  levelAfterExperience,
  maximumHealthForLevel,
} from './character-stats.js';

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    characterId: 'character-rowan',
    worldInstanceId: 'world-demo',
    name: 'Rowan',
    locationId: 'mossgate-clearing',
    revision: 1,
    ...overrides,
  });
}

describe('character stats', () => {
  it('uses balanced defaults that preserve current baseline combat values', () => {
    const projection = character();

    expect(projection.attributes).toEqual({
      strength: 10,
      intelligence: 10,
      constitution: 10,
      dexterity: 10,
    });
    expect(projection.honors).toEqual({ glory: 0, medals: 0 });
    expect(characterAttackDamage(projection)).toBe(2);
    expect(maximumHealthForLevel(1, projection.attributes.constitution)).toBe(6);
    expect(calculateCharacterStats(projection)).toMatchObject({
      attackPower: 30,
      spellPower: 30,
      damage: 2,
      critChancePercent: 5,
      healthRegen: 0,
      manaRegen: 0,
      staminaRegen: 0,
      armorPercent: 0,
      resiliencePercent: 0,
      dodgePercent: 0,
    });
  });

  it('levels from accumulated experience and stops at the level cap', () => {
    expect(levelAfterExperience(1, 100)).toBe(6);
    expect(levelAfterExperience(1, 10_000)).toBe(10);
  });

  it('uses Strength, Constitution, and equipped gear in derived combat values', () => {
    const projection = character({
      attributes: { strength: 15, intelligence: 12, constitution: 15, dexterity: 14 },
      inventory: [
        {
          id: 'iron-sword',
          label: 'Iron sword',
          description: 'A balanced sword.',
          equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
        },
        {
          id: 'scale-vest',
          label: 'Scale vest',
          description: 'A fitted scale vest.',
          equipment: { slot: 'armor', attackBonus: 0, defenseBonus: 1 },
        },
      ],
      equipment: { weaponItemId: 'iron-sword', armorItemId: 'scale-vest' },
    });

    expect(characterAttackDamage(projection)).toBe(5);
    expect(maximumHealthForLevel(1, projection.attributes.constitution)).toBe(7);
    expect(calculateCharacterStats(projection)).toMatchObject({
      attackPower: 65,
      spellPower: 36,
      damage: 5,
      healthRegen: 1,
      armorPercent: 5,
      resiliencePercent: 1.5,
      dodgePercent: 2,
    });
  });
});
