import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy, numericRules } from './policy.mjs';
const valid = { version: 1, functions: { complexity: 10, cognitive: 10, depth: 3, lines: 5, parameters: 4 }, coverage: { '@mudd/contracts': { path: 'engine-contracts', lines: 80, branches: 70, functions: 80, statements: 80 } } };
test('policy rejects missing, malformed and out-of-range limits', () => {
  for (const value of [null, {}, { ...valid, functions: {} }, { ...valid, functions: { ...valid.functions, depth: -1 } }, { ...valid, coverage: {} }, { ...valid, coverage: { x: { path: '.', lines: 101 } } }]) assert.throws(() => validatePolicy(value));
  assert.deepEqual(validatePolicy(valid), valid);
});
test('numeric configuration shares all five inclusive limits', () => {
  const rules = numericRules(valid);
  assert.deepEqual(rules.complexity, ['error', 10]);
  assert.deepEqual(rules['sonarjs/cognitive-complexity'], ['error', 10]);
  assert.deepEqual(rules['max-depth'], ['error', 3]);
  assert.equal(rules['max-lines-per-function'][1].max, 5);
  assert.deepEqual(rules['max-params'], ['error', 4]);
});
