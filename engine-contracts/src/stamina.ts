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
