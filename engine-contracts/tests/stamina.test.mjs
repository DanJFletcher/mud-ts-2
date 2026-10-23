import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStaminaRecovery,
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
