import { afterEach, describe, expect, it, vi } from 'vitest';
import { startInteractionMaintenance } from './interaction-maintenance.js';

function fixture(readStream = vi.fn(async (_world: string, _stream: string) => [])) {
  return {
    readStream,
    dependencies: {
      db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
      store: { readStream },
      worldActivity: { isActive: (id: string) => id === 'active' },
      worldRuntimes: new Map(['active', 'idle'].map((id) => [id, { worldInstanceId: id }])),
      timers: { setInterval, clearInterval, setTimeout, clearTimeout },
    } as unknown as Parameters<typeof startInteractionMaintenance>[0],
  };
}

describe('interaction maintenance scheduling', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('visits all worlds at startup and only active worlds on two-second polls', async () => {
    vi.useFakeTimers();
    const { dependencies, readStream } = fixture();
    startInteractionMaintenance(dependencies);
    await vi.advanceTimersByTimeAsync(0);
    expect(readStream.mock.calls.map((call) => call[0])).toEqual(['active', 'idle']);
    readStream.mockClear();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(readStream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(readStream.mock.calls.map((call) => call[0])).toEqual(['active']);
  });

  it('does not overlap a startup pass with scheduled maintenance', async () => {
    vi.useFakeTimers();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readStream = vi.fn(async (_world: string, _stream: string) => { await gate; return []; });
    const { dependencies } = fixture(readStream);
    startInteractionMaintenance(dependencies);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(readStream).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(readStream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(readStream).toHaveBeenCalledTimes(3);
  });
});
