import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSnapshotSchema, MuddCommandError, type CommandResponse } from "@mudd/client-sdk";
import { ActionRefreshGate } from "../../action-refresh-gate.js";
import { GatheringRun, type GatheringRunPorts } from "./gathering-run.js";
import type { SchedulerTiming } from "./action-scheduler.js";

const timing: SchedulerTiming = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
const snapshot = (active = true) => GameSnapshotSchema.parse({
  player: { id: "player", displayName: "Player" },
  ...(active ? { serverTime: "2026-11-02T00:00:00Z" } : {}),
});
function fixture() {
  const current = snapshot();
  const completed = snapshot(false);
  const gate = new ActionRefreshGate();
  const ports: GatheringRunPorts = {
    gate,
    read: vi.fn(async () => current),
    select: (value) => value.serverTime ? { id: "action", dueAt: Date.now() - 1 } : undefined,
    advance: vi.fn(async () => ({
      receipt: { ok: true as const, commandId: "command", eventIds: [], newAggregateVersion: 1 },
    })),
    reconcile: vi.fn(async () => completed),
    apply: vi.fn(),
    narrate: vi.fn(),
    report: vi.fn(),
  };
  const run = new GatheringRun("action", ports, timing);
  return { current, completed, ports, run, gate };
}
afterEach(() => vi.useRealTimers());

describe("gathering ownership", () => {
  it.each(["fishing", "woodcutting"])("cannot restore %s or retry after cancellation during advance", async () => {
    vi.useFakeTimers();
    const { ports, run } = fixture();
    let finish!: (value: Awaited<ReturnType<GatheringRunPorts["advance"]>>) => void;
    ports.advance = vi.fn(() => new Promise<CommandResponse>((resolve) => { finish = resolve; }));
    run.schedule({ id: "action", dueAt: Date.now() });
    await vi.advanceTimersByTimeAsync(250);
    expect(ports.advance).toHaveBeenCalledOnce();
    run.dispose();
    finish({ receipt: { ok: true, commandId: "command", eventIds: [], newAggregateVersion: 1 } });
    await vi.advanceTimersByTimeAsync(10000);
    expect(ports.reconcile).not.toHaveBeenCalled();
    expect(ports.narrate).not.toHaveBeenCalled();
    expect(ports.advance).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a delayed gathering result across foreground travel, even after travel finishes", async () => {
    vi.useFakeTimers();
    const { ports, run, gate } = fixture();
    let finish!: (value: Awaited<ReturnType<GatheringRunPorts["advance"]>>) => void;
    ports.advance = vi.fn(() => new Promise<CommandResponse>((resolve) => { finish = resolve; }));
    run.schedule({ id: "action", dueAt: Date.now() });
    await vi.advanceTimersByTimeAsync(250);
    gate.begin();
    gate.end();
    finish({ receipt: { ok: true, commandId: "command", eventIds: [], newAggregateVersion: 1 } });
    await vi.advanceTimersByTimeAsync(10000);
    expect(ports.reconcile).not.toHaveBeenCalled();
    expect(ports.narrate).not.toHaveBeenCalled();
    expect(ports.read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses if authoritative recovery fails, and resumes only on a subsequent update", async () => {
    vi.useFakeTimers();
    const { ports, run, current } = fixture();
    ports.advance = vi.fn().mockRejectedValueOnce(new Error("Unknown failure"))
      .mockResolvedValue({ receipt: { ok: true, commandId: "command", eventIds: [], newAggregateVersion: 1 } });
    ports.read = vi.fn().mockResolvedValueOnce(current).mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue(current);
    run.schedule({ id: "action", dueAt: Date.now() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ports.advance).toHaveBeenCalledOnce();
    expect(ports.report).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    run.schedule({ id: "action", dueAt: Date.now() });
    await vi.advanceTimersByTimeAsync(250);
    expect(ports.advance).toHaveBeenCalledTimes(2);
    expect(ports.narrate).toHaveBeenCalledOnce();
  });

  it.each(["New localized wording", "Entirely different explanation"])("recovers conflicts by code rather than wording: %s", async (message) => {
    vi.useFakeTimers();
    const { ports, run } = fixture();
    ports.advance = vi.fn().mockRejectedValueOnce(new MuddCommandError(message, "VERSION_CONFLICT"))
      .mockResolvedValue({ receipt: { ok: true, commandId: "command", eventIds: [], newAggregateVersion: 1 } });
    run.schedule({ id: "action", dueAt: Date.now() });
    await vi.advanceTimersByTimeAsync(500);
    expect(ports.advance).toHaveBeenCalledTimes(2);
    expect(ports.report).not.toHaveBeenCalled();
    expect(ports.narrate).toHaveBeenCalledOnce();
  });

  it("waits for authoritative action timing and stops on terminal/depleted state", async () => {
    vi.useFakeTimers();
    const { ports, run, completed } = fixture();
    const dueAt = Date.now() + 1000;
    ports.select = (value) => value.serverTime ? { id: "action", dueAt } : undefined;
    ports.read = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(completed);
    run.schedule({ id: "action", dueAt: Date.now() });
    await vi.advanceTimersByTimeAsync(250);
    expect(ports.advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    expect(ports.advance).not.toHaveBeenCalled();
    expect(ports.apply).toHaveBeenLastCalledWith(completed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not send a waiting retry after leave and re-entry creates a new owner", async () => {
    vi.useFakeTimers();
    const old = fixture();
    old.run.schedule({ id: "action", dueAt: Date.now() + 1000 });
    old.run.dispose();
    const next = fixture();
    next.run.schedule({ id: "action", dueAt: Date.now() + 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(old.ports.read).not.toHaveBeenCalled();
    expect(next.ports.advance).toHaveBeenCalledOnce();
  });
});
