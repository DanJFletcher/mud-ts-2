import assert from 'node:assert/strict';
import test from 'node:test';
import { CharacterHealthSchema } from '../dist/src/health.js';

test('character health accepts bounded values and rejects invalid current/max combinations', () => {
  assert.deepEqual(CharacterHealthSchema.parse({ current: 8, maximum: 10 }), {
    current: 8,
    maximum: 10,
  });
  assert.deepEqual(CharacterHealthSchema.parse({ current: 0, maximum: 1 }), {
    current: 0,
    maximum: 1,
  });
  assert.throws(
    () => CharacterHealthSchema.parse({ current: 11, maximum: 10 }),
    /Current health exceeds maximum health/,
  );
  assert.throws(() => CharacterHealthSchema.parse({ current: -1, maximum: 10 }));
  assert.throws(() => CharacterHealthSchema.parse({ current: 1, maximum: 0 }));
  assert.throws(() => CharacterHealthSchema.parse({ current: 1, maximum: 10, extra: true }));
});
