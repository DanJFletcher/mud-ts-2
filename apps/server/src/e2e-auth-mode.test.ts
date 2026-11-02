import { describe, expect, it } from 'vitest';
import { readE2eAuthMode } from './e2e-auth-mode.js';

describe('readE2eAuthMode', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(readE2eAuthMode({ NODE_ENV: 'test' })).toBe(false);
    expect(readE2eAuthMode({ NODE_ENV: 'development', MUDD_E2E_AUTH: '0' })).toBe(false);
  });

  it('enables the adapter only in the test environment', () => {
    expect(readE2eAuthMode({ NODE_ENV: 'test', MUDD_E2E_AUTH: '1' })).toBe(true);
    expect(() => readE2eAuthMode({ NODE_ENV: 'production', MUDD_E2E_AUTH: '1' }))
      .toThrow('MUDD_E2E_AUTH is only available when NODE_ENV=test.');
  });

  it('rejects invalid flag values', () => {
    expect(() => readE2eAuthMode({ NODE_ENV: 'test', MUDD_E2E_AUTH: 'true' }))
      .toThrow('MUDD_E2E_AUTH must be set to 1 or 0.');
  });
});
