import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProcessSignals } from './process-signals.js';

describe('executable signal ownership', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes both signals to the supplied runtime cleanup and removes its own handlers', async () => {
    const shutdown = vi.fn(async () => undefined);
    const previous = new Set(process.listeners('SIGTERM'));
    const remove = installProcessSignals(shutdown);
    try {
      const term = process.listeners('SIGTERM').find((handler) => !previous.has(handler));
      expect(term).toBeTypeOf('function');
      expect(process.listeners('SIGINT')).toContain(term);
      term?.('SIGTERM');
      term?.('SIGINT');
      expect(shutdown).toHaveBeenCalledTimes(2);
    } finally {
      remove();
    }
    expect(process.listeners('SIGTERM')).toEqual([...previous]);
  });
});
