import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEffectProcessing } from './effect-processing.js';

function fixture(processPendingEffects = vi.fn(async () => 0)) {
  const dependencies = {
    worldRuntimes: new Map([['world', { worldInstanceId: 'world', engine: { processPendingEffects } }]]),
    store: { withoutCommandReadCache: <T>(run: () => T) => run() },
    timers: { setInterval, clearInterval, setTimeout, clearTimeout },
  } as unknown as Parameters<typeof startEffectProcessing>[0];
  return { effects: startEffectProcessing(dependencies), processPendingEffects };
}

describe('durable effect orchestration timing', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('runs an initial pass, debounces world wakeups for 50ms, and cancels owned timers', async () => {
    vi.useFakeTimers();
    const { effects, processPendingEffects } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingEffects).toHaveBeenCalledExactlyOnceWith(25, 'world');
    effects.wakeEffectBatch('world');
    effects.wakeEffectBatch('world');
    effects.wakeEffectBatch('unknown');
    await vi.advanceTimersByTimeAsync(49);
    expect(processPendingEffects).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processPendingEffects).toHaveBeenCalledTimes(2);
    effects.wakeEffectBatch('world');
    effects.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(processPendingEffects).toHaveBeenCalledTimes(2);
  });

  it('limits each batch to eight passes and retains the five-second fallback', async () => {
    vi.useFakeTimers();
    const { effects, processPendingEffects } = fixture(vi.fn(async () => 25));
    await vi.advanceTimersByTimeAsync(0);
    expect(processPendingEffects).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(processPendingEffects).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(processPendingEffects).toHaveBeenCalledTimes(16);
    effects.stop();
  });
});
