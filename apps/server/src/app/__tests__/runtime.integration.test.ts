import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { useServerHarness } from './server-harness.js';

describe('runtime through the server', () => {
  const harness = useServerHarness();
  it('closes the HTTP server through explicit runtime cleanup', async () => {
    expect(harness.shutdown).toBeTypeOf('function');
    const closed = once(harness.server, 'close');
    await harness.shutdown();
    await closed;
    expect(harness.server.listening).toBe(false);
  });
});
