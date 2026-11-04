type ImmutableHistory = readonly object[];

const immutableHistories = new WeakSet<ImmutableHistory>();
const historyParents = new WeakMap<ImmutableHistory, WeakRef<ImmutableHistory>>();

export function isImmutableHistory<T extends object>(events: readonly T[]): boolean {
  return immutableHistories.has(events);
}

export function immutableHistoryParent<T extends object>(events: readonly T[]): readonly T[] | undefined {
  return historyParents.get(events)?.deref() as readonly T[] | undefined;
}

function freezeHistoryValue(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeHistoryValue(nested);
  Object.freeze(value);
}

function hasMatchingPrefix<T extends object>(next: readonly T[], previous?: readonly T[]): boolean {
  return Boolean(previous && isImmutableHistory(previous) && next.length > previous.length &&
    next[previous.length - 1] === previous.at(-1));
}

function matchingHistoryParent<T extends object>(next: readonly T[], previous?: readonly T[]) {
  return hasMatchingPrefix(next, previous) ? previous : undefined;
}

function freezeHistoryTail<T extends object>(next: readonly T[], parent?: readonly T[]): void {
  const start = parent?.length ?? 0;
  for (let index = start; index < next.length; index++) freezeHistoryValue(next[index]);
  Object.freeze(next);
}

function prepareImmutableHistory<T extends object>(next: readonly T[], parent?: readonly T[]): void {
  if (parent) historyParents.set(next, new WeakRef(parent));
  freezeHistoryTail(next, parent);
  immutableHistories.add(next);
}

function registerHistory<T extends object>(next: readonly T[], previous?: readonly T[]) {
  const parent = matchingHistoryParent(next, previous);
  prepareImmutableHistory(next, parent);
  return parent;
}

export function retainImmutableHistoryPrefix<T extends object>(next: readonly T[], previous?: readonly T[]) {
  return isImmutableHistory(next) ? undefined : registerHistory(next, previous);
}
