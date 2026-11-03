import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ shutdown: vi.fn(), server: {}, start: vi.fn(), signals: vi.fn() }));
vi.mock('../bootstrap.js', () => ({ startServer: fixture.start }));
vi.mock('../process-signals.js', () => ({ installProcessSignals: fixture.signals }));

it('starts the runtime with the executable URL and wires its cleanup to process signals', async () => {
  fixture.start.mockResolvedValue({ server: fixture.server, shutdown: fixture.shutdown });
  const executable = await import('../../index.js');
  expect(fixture.start).toHaveBeenCalledOnce();
  expect(fixture.start).toHaveBeenCalledWith(new URL('../../index.ts', import.meta.url).href);
  expect(executable.server).toBe(fixture.server);
  expect(fixture.signals).toHaveBeenCalledExactlyOnceWith(fixture.shutdown);
});
