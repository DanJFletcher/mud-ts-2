import type { CombatLootDefinition } from '@mudd/contracts';

export type CombatLootRandomSource = Readonly<{ roll: (sides: number) => number }>;

function winsChance(chancePercent: number, rng: CombatLootRandomSource): boolean {
  if (chancePercent >= 100) return true;
  if (chancePercent <= 0) return false;
  return rng.roll(100) <= chancePercent;
}

/**
 * Resolve authored chance drops once during the victory command.
 * The returned, guaranteed loot is what the shared corpse event records.
 */
export function resolveCombatLoot(
  loot: CombatLootDefinition | undefined,
  rng: CombatLootRandomSource,
): CombatLootDefinition | undefined {
  if (!loot) return undefined;

  const items = [
    ...loot.items,
    ...(loot.chanceItems ?? [])
      .filter((drop) => winsChance(drop.chancePercent, rng))
      .map((drop) => drop.item),
  ];
  const currencyAmount = loot.currencyAmount !== undefined &&
    (loot.currencyChancePercent === undefined || winsChance(loot.currencyChancePercent, rng))
    ? loot.currencyAmount
    : undefined;

  return {
    items,
    ...(currencyAmount !== undefined ? { currencyAmount } : {}),
  };
}
