import { describe, expect, it } from "vitest";
import { ActionRefreshGate } from "./action-refresh-gate.js";
import { ForegroundExecution } from "./foreground-execution.js";

describe("foreground execution ownership", () => {
  it("excludes duplicate submissions synchronously", () => {
    const gate = new ActionRefreshGate();
    const actions = new ForegroundExecution(gate);
    const owner = actions.begin("take")!;
    expect(actions.begin("take")).toBeUndefined();
    expect(actions.begin("move")).toBeUndefined();
    expect(gate.busy).toBe(true);
    actions.finish(owner);
    expect(gate.busy).toBe(false);
    expect(actions.begin("take")).toBeDefined();
  });

  it("does not let an old completion release a new execution", () => {
    const gate = new ActionRefreshGate();
    const actions = new ForegroundExecution(gate);
    const first = actions.begin("take")!;
    actions.finish(first);
    const second = actions.begin("talk")!;
    expect(actions.finish(first)).toBe(false);
    expect(gate.busy).toBe(true);
    expect(actions.begin("take")).toBeUndefined();
    actions.finish(second);
    expect(gate.busy).toBe(false);
  });

  it("allows confirmation refreshes while travel feedback still excludes other actions", () => {
    const gate = new ActionRefreshGate();
    const actions = new ForegroundExecution(gate);
    const move = actions.begin("move")!;
    actions.finish(move, true);
    expect(gate.accepts(gate.capture())).toBe(true);
    expect(actions.begin("take")).toBeUndefined();
    const retry = actions.begin("move")!;
    expect(retry).toBeDefined();
    expect(actions.clearFeedback(move)).toBe(false);
    expect(gate.busy).toBe(true);
    actions.finish(retry, true);
    actions.clearFeedback(retry);
    expect(actions.begin("take")).toBeDefined();
  });

  it("keeps execution owned when confirmation arrives before request completion", () => {
    const gate = new ActionRefreshGate();
    const actions = new ForegroundExecution(gate);
    const move = actions.begin("move")!;
    actions.clearFeedback(move);
    expect(gate.busy).toBe(true);
    expect(actions.begin("take")).toBeUndefined();
    actions.finish(move);
    expect(actions.begin("take")).toBeDefined();
  });
});
