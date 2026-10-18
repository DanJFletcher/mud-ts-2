export class RuleViolationError extends Error {
  readonly kind = 'RULE_VIOLATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RuleViolationError';
  }
}

export function isRuleViolationError(error: unknown): error is RuleViolationError {
  return error instanceof Error &&
    (error instanceof RuleViolationError ||
      (error as Error & { kind?: unknown }).kind === 'RULE_VIOLATION');
}
