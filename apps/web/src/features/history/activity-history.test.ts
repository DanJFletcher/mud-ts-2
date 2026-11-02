import { describe, expect, it } from "vitest";
import { ActivityHistory } from "./activity-history.js";
const entry = (id: string) => ({ id, text: id, kind: "narration" as const });
describe("session activity history", () => {
  it("evicts oldest settled entries with stable IDs and ordering", () => {
    const history = new ActivityHistory(3);
    for (const id of ["a", "b", "c", "d", "e"]) history.append(entry(id));
    expect(history.getSnapshot().entries.map((row) => row.id)).toEqual(["c", "d", "e"]);
    history.replace("d", { ...entry("other"), text: "Updated" });
    expect(history.getSnapshot().entries[1]).toMatchObject({ id: "d", text: "Updated" });
  });
  it("pins optimistic entries beyond the budget until reconciliation, then reapplies retention", () => {
    const history = new ActivityHistory(2);
    history.beginOptimistic("move");
    history.append(entry("preview"));
    history.append(entry("room-details"));
    history.endOptimisticCreation();
    for (const id of ["a", "b", "c"]) history.append(entry(id));
    expect(history.getSnapshot().entries.map((row) => row.id)).toEqual(["preview", "room-details", "b", "c"]);
    history.replace("preview", { ...entry("preview"), text: "Confirmed" });
    history.settle("wrong-owner");
    expect(history.getSnapshot().entries).toHaveLength(4);
    history.settle("move");
    expect(history.getSnapshot().entries.map((row) => row.id)).toEqual(["b", "c"]);
  });
  it("rolls back only the owning preview and does not announce historical changes", () => {
    const history = new ActivityHistory(2);
    history.append(entry("before"));
    history.beginOptimistic("move");
    history.append(entry("preview"));
    history.endOptimisticCreation();
    history.append(entry("arrived-while-waiting"));
    const announcement = history.getSnapshot().announcement;
    history.rollback("wrong-owner");
    expect(history.getSnapshot().entries).toHaveLength(3);
    history.rollback("move");
    expect(history.getSnapshot().entries.map((row) => row.id)).toEqual(["before", "arrived-while-waiting"]);
    expect(history.getSnapshot().announcement).toBe(announcement);
  });
  it("isolates new sessions and resets pins and history", () => {
    const old = new ActivityHistory();
    old.beginOptimistic("move"); old.append(entry("old"));
    const next = new ActivityHistory();
    expect(next.getSnapshot().entries).toEqual([]);
    old.reset();
    expect(old.getSnapshot()).toEqual({ entries: [] });
    old.beginOptimistic("new-move");
    old.append(entry("new"));
    expect(old.getSnapshot().entries).toHaveLength(1);
  });
  it("bounds pin ownership to the single foreground travel operation", () => {
    const history = new ActivityHistory(1);
    history.beginOptimistic("one");
    expect(() => history.beginOptimistic("two")).toThrow("Only one");
    history.endOptimisticCreation(); history.settle("one");
    history.beginOptimistic("two");
    history.append(entry("two"));
    expect(history.getSnapshot().entries).toHaveLength(1);
  });
});
