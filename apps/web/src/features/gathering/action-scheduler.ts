export interface SchedulerTiming {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

/**
 * A single action owns a scheduler. Advance returns the next authoritative due
 * time, or undefined to pause. Disposal is permanent, including across awaits.
 */
export class ActionScheduler {
  private timer: unknown;
  private disposed = false;
  private running = false;
  private nextDue: number | undefined;
  constructor(
    private readonly advance: () => Promise<number | undefined>,
    private readonly timing: SchedulerTiming,
    private readonly minimumDelayMs = 100,
  ) {}

  scheduleAt(due: number): void {
    if (this.disposed) return;
    this.nextDue = due;
    if (this.timer !== undefined) this.timing.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) return;
    this.timer = this.timing.setTimeout(() => {
      this.timer = undefined;
      void this.trigger();
    }, Math.max(this.minimumDelayMs, due - this.timing.now()));
  }

  async trigger(): Promise<void> {
    if (this.disposed || this.running) return;
    if (this.timer !== undefined) this.timing.clearTimeout(this.timer);
    this.timer = undefined;
    this.nextDue = undefined;
    this.running = true;
    let due: number | undefined;
    try {
      due = await this.advance();
    } catch {
      // An unconfirmed action pauses. A later authoritative update may schedule it.
    } finally {
      this.running = false;
      if (!this.disposed) {
        const next = this.nextDue ?? due;
        if (next !== undefined) this.scheduleAt(next);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) this.timing.clearTimeout(this.timer);
    this.timer = undefined;
    this.nextDue = undefined;
  }
}
