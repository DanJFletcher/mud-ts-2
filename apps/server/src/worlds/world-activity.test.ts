import { describe, expect, it, vi } from 'vitest';
import { createWorldActivityTracker, WORLD_ACTIVITY_WINDOW_MS } from './world-activity.js';

describe('world activity tracker', () => {
  it('is active only within the presence window', () => {
    let now = 1_000_000;
    const tracker = createWorldActivityTracker(() => now);
    expect(tracker.isActive('world-a')).toBe(false);

    tracker.record('world-a');
    expect(tracker.isActive('world-a')).toBe(true);
    expect(tracker.isActive('world-b')).toBe(false);

    now += WORLD_ACTIVITY_WINDOW_MS;
    expect(tracker.isActive('world-a')).toBe(true);
    now += 1;
    expect(tracker.isActive('world-a')).toBe(false);
    expect(tracker.isActive('world-a', WORLD_ACTIVITY_WINDOW_MS + 10_000)).toBe(true);
  });

  it('never moves presence backward and notifies listeners only on newer activity', () => {
    const now = 1_000_000;
    const tracker = createWorldActivityTracker(() => now);
    const listener = vi.fn();
    const unsubscribe = tracker.onActivity(listener);

    tracker.record('world-a', new Date(now));
    tracker.record('world-a', new Date(now - 60_000));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('world-a');
    expect(tracker.isActive('world-a')).toBe(true);

    unsubscribe();
    tracker.record('world-a', now + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
