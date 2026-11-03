import type { ActivityEntry } from "@mudd/ui";
export const SETTLED_HISTORY_LIMIT = 1000;
export type HistorySnapshot = {
  entries: readonly ActivityEntry[];
  announcement?: { sequence: number; text: string };
};

/** One mounted world/character owns this store and at most one optimistic group. */
export class ActivityHistory {
  private snapshot: HistorySnapshot = { entries: [] };
  private listeners = new Set<() => void>();
  private pinned = new Set<string>();
  private owner?: string;
  private collecting = false;
  private sequence = 0;
  constructor(readonly limit = SETTLED_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("History needs a positive retention limit.");
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(entries: readonly ActivityEntry[], announcement = this.snapshot.announcement) {
    let excess = entries.filter((entry) => !this.pinned.has(entry.id)).length - this.limit;
    const retained = entries.filter((entry) => this.pinned.has(entry.id) || excess-- <= 0);
    this.snapshot = { entries: retained, announcement };
    this.listeners.forEach((listener) => listener());
  }
  append(entry: ActivityEntry) {
    if (this.collecting) this.pinned.add(entry.id);
    const existing = this.snapshot.entries.some((current) => current.id === entry.id);
    const entries = existing ? this.snapshot.entries.map((current) => current.id === entry.id ? entry : current)
      : [...this.snapshot.entries, entry];
    this.update(entries, existing ? this.snapshot.announcement : { sequence: ++this.sequence, text: entry.text });
  }
  replace(id: string, replacement: ActivityEntry) {
    this.update(this.snapshot.entries.map((entry) => entry.id === id ? { ...replacement, id } : entry));
  }
  remove(ids: readonly string[]) {
    const removed = new Set(ids);
    ids.forEach((id) => this.pinned.delete(id));
    this.update(this.snapshot.entries.filter((entry) => !removed.has(entry.id)));
  }
  beginOptimistic(owner: string) {
    if (this.owner && this.owner !== owner) throw new Error("Only one optimistic travel may own history.");
    this.owner = owner;
    this.collecting = true;
  }
  endOptimisticCreation() { this.collecting = false; }
  settle(owner: string) {
    if (owner !== this.owner) return;
    this.owner = undefined;
    this.collecting = false;
    this.pinned.clear();
    this.update(this.snapshot.entries);
  }
  rollback(owner: string) {
    if (owner !== this.owner) return;
    const ids = [...this.pinned];
    this.remove(ids);
    this.settle(owner);
  }
  reset() {
    this.owner = undefined;
    this.collecting = false;
    this.pinned.clear();
    this.snapshot = { entries: [] };
    this.listeners.forEach((listener) => listener());
  }
}
