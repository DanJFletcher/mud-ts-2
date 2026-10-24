import { isImmutableReplayHistory, immutableReplayParent } from './replay.js';

/**
 * Disposable projection checkpoints. Mutable histories always replay from zero.
 * Weak event identities permit tail continuation without trusting revision alone.
 * Results are cloned so a command handler cannot mutate a retained checkpoint.
 */
export function createIncrementalProjection<E extends object, S>(
  initial: () => S,
  reduce: (state: S, event: E) => void,
) {
  const completed = new WeakMap<readonly E[], S>();
  const load = (events: readonly E[]): S => {
    const immutable = isImmutableReplayHistory(events);
    const known = immutable ? completed.get(events) : undefined;
    if (known) return known;
    let state = initial(), start = 0;
    if (immutable) {
      const parent = immutableReplayParent(events) as readonly E[] | undefined;
      const previous = parent && completed.get(parent);
      if (previous) {
        state = structuredClone(previous); start = parent.length;
      }
    }
    for (let i = start; i < events.length; i++) reduce(state, events[i]!);
    if (immutable) {
      completed.set(events, state);
    }
    return state;
  };
  const project = (events: readonly E[]): S => structuredClone(load(events));
  // Selectors are internal read-only projection code, never supplied by clients.
  // Clone only the selected result, not every completed historical encounter.
  project.select = <T>(events: readonly E[], select: (state: Readonly<S>) => T): T =>
    structuredClone(select(load(events)));
  return project;
}
