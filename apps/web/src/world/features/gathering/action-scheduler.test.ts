import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionScheduler, type SchedulerTiming } from "./action-scheduler.js";

const timing: SchedulerTiming = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
afterEach(() => vi.useRealTimers());

describe("action scheduler", () => {
  it("clears the waiting wake-up when its owner is disposed", async () => {
    vi.useFakeTimers();
    const advance = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ActionScheduler(advance, timing);
    scheduler.scheduleAt(Date.now() + 1000);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    await scheduler.trigger();
    expect(advance).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("excludes coincident triggers and ignores a disposed in-flight completion", async () => {
    vi.useFakeTimers();
    let resolve!: (due: number) => void;
    const advance = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const scheduler = new ActionScheduler(advance, timing);
    scheduler.scheduleAt(Date.now() + 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.trigger();
    scheduler.scheduleAt(Date.now() + 2000);
    await scheduler.trigger();
    expect(advance).toHaveBeenCalledOnce();
    scheduler.dispose();
    resolve(Date.now() + 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(advance).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses authoritative due times and enforces a minimum retry delay", async () => {
    vi.useFakeTimers();
    const advance = vi.fn()
      .mockImplementationOnce(async () => Date.now() - 1000)
      .mockResolvedValue(undefined);
    const scheduler = new ActionScheduler(advance, timing, 100);
    scheduler.scheduleAt(Date.now() + 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(advance).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(advance).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses on failed recovery until an authoritative update schedules it", async () => {
    vi.useFakeTimers();
    const advance = vi.fn().mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValue(undefined);
    const scheduler = new ActionScheduler(advance, timing);
    await scheduler.trigger();
    await vi.advanceTimersByTimeAsync(10000);
    expect(advance).toHaveBeenCalledOnce();
    scheduler.scheduleAt(Date.now() + 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("tracks only the latest schedule and accepts an update while advancing", async () => {
    vi.useFakeTimers();
    let resolve!: (due: undefined) => void;
    const advance = vi.fn().mockImplementationOnce(() =>
      new Promise<undefined>((done) => { resolve = done; })).mockResolvedValue(undefined);
    const scheduler = new ActionScheduler(advance, timing);
    scheduler.scheduleAt(Date.now() + 1000);
    scheduler.scheduleAt(Date.now() + 2000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.scheduleAt(Date.now() + 1000);
    resolve(undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
