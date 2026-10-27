import { describe, expect, it, vi } from 'vitest';
import { resolveCombatLoot } from './combat-loot.js';

const guaranteedItem = {
  id: 'bandit-token',
  label: 'Bandit token',
  description: 'A dull brass token.',
};
const knife = {
  id: 'bandit-knife-template',
  typeId: 'bandit-knife',
  label: 'Bandit knife',
  description: 'A narrow knife with a worn wooden grip.',
  equipment: { slot: 'weapon' as const, attackBonus: 1, defenseBonus: 0 },
};

describe('resolveCombatLoot', () => {
  it('includes successful chance drops and records no chance metadata in the corpse payload', () => {
    const rng = { roll: vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(50) };
    const resolved = resolveCombatLoot({
      items: [guaranteedItem],
      chanceItems: [{ item: knife, chancePercent: 5 }],
      currencyAmount: 3,
      currencyChancePercent: 50,
    }, rng);

    expect(resolved).toEqual({ items: [guaranteedItem, knife], currencyAmount: 3 });
    expect(rng.roll).toHaveBeenNthCalledWith(1, 100);
    expect(rng.roll).toHaveBeenNthCalledWith(2, 100);
  });

  it('omits failed chance drops while preserving guaranteed loot', () => {
    const rng = { roll: vi.fn().mockReturnValueOnce(6).mockReturnValueOnce(51) };
    const resolved = resolveCombatLoot({
      items: [guaranteedItem],
      chanceItems: [{ item: knife, chancePercent: 5 }],
      currencyAmount: 3,
      currencyChancePercent: 50,
    }, rng);

    expect(resolved).toEqual({ items: [guaranteedItem] });
  });

  it('does not roll for guaranteed or impossible drops', () => {
    const rng = { roll: vi.fn() };
    const resolved = resolveCombatLoot({
      items: [],
      chanceItems: [
        { item: { ...knife, id: 'always-knife' }, chancePercent: 100 },
        { item: { ...knife, id: 'never-knife' }, chancePercent: 0 },
      ],
      currencyAmount: 2,
      currencyChancePercent: 100,
    }, rng);

    expect(resolved).toEqual({
      items: [{ ...knife, id: 'always-knife' }],
      currencyAmount: 2,
    });
    expect(rng.roll).not.toHaveBeenCalled();
  });
});
