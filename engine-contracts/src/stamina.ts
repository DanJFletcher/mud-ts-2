import type { CharacterResourcePool } from './character.js';
import type { CharacterStaminaRecovery } from './character.js';

export const MOVEMENT_STAMINA_COST = 5;
export const STAMINA_RECOVERY_DENOMINATOR = 100_000;

export function resolveStaminaRecovery(
  stamina: CharacterResourcePool,
  recovery: CharacterStaminaRecovery,
  settledAt: Date,
): Readonly<{
  stamina: CharacterResourcePool;
  recovery: CharacterStaminaRecovery;
}> {
  if (!Number.isFinite(settledAt.getTime())) throw new Error('Invalid stamina recovery time.');
  const previousAt = recovery.lastSettledAt ? Date.parse(recovery.lastSettledAt) : settledAt.getTime();
  const nextAt = Math.max(previousAt, settledAt.getTime());
  const elapsedMs = Math.max(0, nextAt - previousAt);
  const multiplier = recovery.posture === 'resting' ? 3 : 1;
  const numerator = BigInt(elapsedMs) * BigInt(stamina.maximum) * BigInt(multiplier) +
    BigInt(recovery.fractionalCarry);
  const denominator = BigInt(STAMINA_RECOVERY_DENOMINATOR);
  const earned = numerator / denominator;
  const remaining = BigInt(stamina.maximum - stamina.current);
  const reachesMaximum = earned >= remaining;
  const current = reachesMaximum
    ? stamina.maximum
    : stamina.current + Number(earned);
  const carry = reachesMaximum
    ? 0
    : Number(numerator % denominator);
  return {
    stamina: { ...stamina, current },
    recovery: {
      ...recovery,
      lastSettledAt: new Date(nextAt).toISOString(),
      fractionalCarry: carry,
    },
  };
}

export function resolveVitalRecovery(
  vitals: Readonly<{
    health: Readonly<{ current: number; maximum: number }>;
    stamina: CharacterResourcePool;
    mana: CharacterResourcePool;
  }>,
  recovery: CharacterStaminaRecovery,
  settledAt: Date,
): Readonly<{
  health: Readonly<{ current: number; maximum: number }>;
  stamina: CharacterResourcePool;
  mana: CharacterResourcePool;
  recovery: CharacterStaminaRecovery;
}> {
  if (!Number.isFinite(settledAt.getTime())) throw new Error('Invalid vital recovery time.');
  const previousAt = recovery.lastSettledAt ? Date.parse(recovery.lastSettledAt) : settledAt.getTime();
  const nextAt = Math.max(previousAt, settledAt.getTime());
  const elapsedMs = Math.max(0, nextAt - previousAt);
  const multiplier = recovery.posture === 'resting' ? 3 : 1;

  const recover = (
    pool: Readonly<{ current: number; maximum: number }>,
    fractionalCarry: number,
  ) => {
    const numerator = BigInt(elapsedMs) * BigInt(pool.maximum) * BigInt(multiplier) +
      BigInt(fractionalCarry);
    const denominator = BigInt(STAMINA_RECOVERY_DENOMINATOR);
    const earned = numerator / denominator;
    const remaining = BigInt(pool.maximum - pool.current);
    const reachesMaximum = earned >= remaining;
    return {
      pool: {
        ...pool,
        current: reachesMaximum ? pool.maximum : pool.current + Number(earned),
      },
      fractionalCarry: reachesMaximum ? 0 : Number(numerator % denominator),
    };
  };

  const health = recover(vitals.health, recovery.healthFractionalCarry);
  const stamina = recover(vitals.stamina, recovery.fractionalCarry);
  const mana = recover(vitals.mana, recovery.manaFractionalCarry);
  return {
    health: health.pool,
    stamina: stamina.pool,
    mana: mana.pool,
    recovery: {
      ...recovery,
      lastSettledAt: new Date(nextAt).toISOString(),
      fractionalCarry: stamina.fractionalCarry,
      healthFractionalCarry: health.fractionalCarry,
      manaFractionalCarry: mana.fractionalCarry,
    },
  };
}
