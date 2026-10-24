import { describe, expect, it } from 'vitest';
import { createIncrementalProjection } from './incremental-projection.js';
import { retainCharacterReplayPrefix } from './replay.js';
import type { StoredGameEvent } from './types.js';

const event = (n: number) => ({ type: 'test', payload: { n } }) as unknown as StoredGameEvent;
describe('incremental shared projection', () => {
  it('reduces only the appended tail, isolates callers, and rebuilds independent arrays', () => {
    let reductions = 0;
    const project = createIncrementalProjection(() => ({ sum: 0 }), (state, e: StoredGameEvent) => {
      reductions++; state.sum += Number(e.payload.n);
    });
    const initial = [event(1), event(2)];
    retainCharacterReplayPrefix(initial);
    expect(project(initial).sum).toBe(3);
    project(initial).sum = -100;
    expect(project(initial).sum).toBe(3);
    expect(reductions).toBe(2);
    const next = [...initial, event(4)];
    retainCharacterReplayPrefix(next, initial);
    expect(project(next).sum).toBe(7);
    expect(reductions).toBe(3);
    expect(project([...next]).sum).toBe(7);
    expect(reductions).toBe(6);
  });
  it('never caches mutable histories', () => {
    const project = createIncrementalProjection(() => ({ sum: 0 }), (state, e: { n: number }) => { state.sum += e.n; });
    const history = [{ n: 1 }];
    expect(project(history).sum).toBe(1);
    history[0]!.n = 3;
    expect(project(history).sum).toBe(3);
  });
});
