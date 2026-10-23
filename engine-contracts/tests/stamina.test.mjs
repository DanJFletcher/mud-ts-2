import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStaminaRecovery,
  resolveVitalRecovery,
  CharacterStaminaRecoverySchema,
} from '../dist/src/index.js';

const initial = (posture = 'standing', lastSettledAt = '2026-10-23T12:00:00.000Z', fractionalCarry = 0) =>
  CharacterStaminaRecoverySchema.parse({ posture, lastSettledAt, fractionalCarry });
const pool = (current = 0, maximum = 100) => ({ current, maximum });
const at = (milliseconds) => new Date(Date.parse('2026-10-23T12:00:00.000Z') + milliseconds);

test('standing recovery grants exactly one percent per second with fractional carry', () => {
  const first = resolveStaminaRecovery(pool(), initial(), at(500));
  assert.equal(first.stamina.current, 0);
  assert.equal(first.recovery.fractionalCarry, 50_000);
  const second = resolveStaminaRecovery(first.stamina, first.recovery, at(1_000));
  assert.equal(second.stamina.current, 1);
  assert.equal(second.recovery.fractionalCarry, 0);
});

test('resting recovery is three times the standing rate and caps without carry', () => {
  const rested = resolveStaminaRecovery(pool(), initial('resting'), at(1_000));
  assert.equal(rested.stamina.current, 3);
  const capped = resolveStaminaRecovery(pool(99), initial('resting'), at(10_000));
  assert.equal(capped.stamina.current, 100);
  assert.equal(capped.recovery.fractionalCarry, 0);
});

test('backward timestamps cannot reduce the anchor or create recovery', () => {
  const settled = resolveStaminaRecovery(pool(10), initial('standing', at(5_000).toISOString(), 40_000), at(1_000));
  assert.equal(settled.stamina.current, 10);
  assert.equal(settled.recovery.fractionalCarry, 40_000);
  assert.equal(settled.recovery.lastSettledAt, at(5_000).toISOString());
});

test('vital recovery uses independent fractional carry for low health maxima', () => {
  const start = at(0);
  const initialVitals = {
    health: { current: 1, maximum: 6 },
    stamina: { current: 50, maximum: 100 },
    mana: { current: 0, maximum: 100 },
  };
  const base = CharacterStaminaRecoverySchema.parse({
    posture: 'standing', lastSettledAt: start.toISOString(), fractionalCarry: 0,
  });
  const first = resolveVitalRecovery(initialVitals, base, at(1_000));
  assert.equal(first.health.current, 1);
  assert.equal(first.health.maximum, 6);
  assert.equal(first.recovery.healthFractionalCarry, 6_000);
  assert.equal(first.stamina.current, 51);
  assert.equal(first.mana.current, 1);
});

test('resting doubles the elapsed-time amount and caps each vital independently', () => {
  const result = resolveVitalRecovery({
    health: { current: 5, maximum: 6 },
    stamina: { current: 90, maximum: 100 },
    mana: { current: 0, maximum: 20 },
  }, CharacterStaminaRecoverySchema.parse({
    posture: 'resting',
    lastSettledAt: at(0).toISOString(),
    fractionalCarry: 0,
  }), at(6_000));
  assert.deepEqual(result.health, { current: 6, maximum: 6 });
  assert.deepEqual(result.stamina, { current: 100, maximum: 100 });
  assert.deepEqual(result.mana, { current: 3, maximum: 20 });
  assert.equal(result.recovery.healthFractionalCarry, 0);
});

test('keeps health fractional carry when its maximum changes', () => {
  const base = CharacterStaminaRecoverySchema.parse({
    posture: 'standing',
    lastSettledAt: at(0).toISOString(),
    fractionalCarry: 0,
  });
  const first = resolveVitalRecovery({
    health: { current: 1, maximum: 6 },
    stamina: pool(100),
    mana: pool(100),
  }, base, at(1_000));
  const changedMaximum = resolveVitalRecovery({
    health: { current: first.health.current, maximum: 8 },
    stamina: first.stamina,
    mana: first.mana,
  }, first.recovery, at(20_000));
  assert.deepEqual(changedMaximum.health, { current: 2, maximum: 8 });
  assert.equal(changedMaximum.recovery.healthFractionalCarry, 58_000);
});
