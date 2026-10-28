import { describe, expect, it, vi } from 'vitest';
import type { WorldRuntime } from './world-registry.js';
import { startWorldRuntimes, stopWorldRuntimes } from './world-registry.js';

function runtime(start: () => Promise<void>, stop: () => Promise<void>): WorldRuntime {
  return { engine: { start, stop } } as unknown as WorldRuntime;
}

describe('world runtime lifecycle', () => {
  it('stops previously started runtimes when a later runtime fails to start', async () => {
    const startFailure = new Error('Second world failed to start.');
    const firstStop = vi.fn(async () => {
      throw new Error('Cleanup failure should not replace the startup error.');
    });
    const first = runtime(vi.fn(async () => undefined), firstStop);
    const second = runtime(vi.fn(async () => {
      throw startFailure;
    }), vi.fn(async () => undefined));

    await expect(startWorldRuntimes(new Map([
      ['first', first],
      ['second', second],
    ]))).rejects.toBe(startFailure);
    expect(firstStop).toHaveBeenCalledTimes(1);
  });

  it('stops runtimes in reverse startup order', async () => {
    const stopOrder: string[] = [];
    const first = runtime(
      vi.fn(async () => undefined),
      vi.fn(async () => { stopOrder.push('first'); }),
    );
    const second = runtime(
      vi.fn(async () => undefined),
      vi.fn(async () => { stopOrder.push('second'); }),
    );

    await stopWorldRuntimes(new Map([
      ['first', first],
      ['second', second],
    ]));
    expect(stopOrder).toEqual(['second', 'first']);
  });
});
