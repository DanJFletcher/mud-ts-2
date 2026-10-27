import { describe, expect, it } from 'vitest';
import { isRuleViolationError, RuleViolationError } from './domain-error.js';

describe('RuleViolationError', () => {
  it('sets its standard error name and stable kind discriminant', () => {
    const error = new RuleViolationError('The action is not allowed.');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RuleViolationError');
    expect(error.message).toBe('The action is not allowed.');
    expect(error.kind).toBe('RULE_VIOLATION');
    expect(isRuleViolationError(error)).toBe(true);
  });

  it('recognizes compatible errors across package boundaries without accepting arbitrary values', () => {
    const compatible = new Error('A rules error from another package copy.') as Error & { kind: string };
    compatible.kind = 'RULE_VIOLATION';
    expect(isRuleViolationError(compatible)).toBe(true);
    expect(isRuleViolationError(new Error('ordinary error'))).toBe(false);
    expect(isRuleViolationError({ kind: 'RULE_VIOLATION' })).toBe(false);
    expect(isRuleViolationError(null)).toBe(false);
  });
});
