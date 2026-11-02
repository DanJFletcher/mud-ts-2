import { MuddCommandError, type CommandResponse, type GameSnapshot } from "@mudd/client-sdk";
import { ActionScheduler, type SchedulerTiming } from "./action-scheduler.js";

export type GatheringState = { id: string; dueAt: number };
export interface GatheringRunPorts {
  read(): Promise<GameSnapshot>;
  select(snapshot: GameSnapshot): GatheringState | undefined;
  advance(snapshot: GameSnapshot, id: string): Promise<CommandResponse>;
  reconcile(snapshot: GameSnapshot, response: CommandResponse, accepts: () => boolean): Promise<GameSnapshot>;
  apply(snapshot: GameSnapshot): void;
  narrate(response: CommandResponse, before: GameSnapshot): void;
  report(error: unknown): void;
  gate: { readonly busy: boolean; capture(): number; accepts(epoch: number): boolean };
}

/** One action generation; an obsolete generation can never resume after an await. */
export class GatheringRun {
  private disposed = false;
  private readonly scheduler: ActionScheduler;
  constructor(
    readonly id: string,
    private readonly ports: GatheringRunPorts,
    private readonly timing: SchedulerTiming,
  ) {
    this.scheduler = new ActionScheduler(() => this.advance(), timing, 250);
  }
  schedule(state: GatheringState) {
    if (state.id === this.id) this.scheduler.scheduleAt(state.dueAt);
  }
  dispose() { this.disposed = true; this.scheduler.dispose(); }

  private async advance(): Promise<number | undefined> {
    if (this.disposed) return;
    if (this.ports.gate.busy) return this.timing.now() + 250;
    const epoch = this.ports.gate.capture();
    const accepts = () => !this.disposed && this.ports.gate.accepts(epoch);
    try {
      const current = await this.ports.read();
      if (!accepts()) return;
      const state = this.ports.select(current);
      if (state?.id !== this.id) { this.ports.apply(current); return; }
      if (state.dueAt > this.timing.now()) {
        this.ports.apply(current);
        return state.dueAt;
      }
      const result = await this.ports.advance(current, this.id);
      if (!accepts()) return;
      const next = await this.ports.reconcile(current, result, accepts);
      if (!accepts()) return;
      this.ports.narrate(result, current);
      const remaining = this.ports.select(next);
      return remaining?.id === this.id ? remaining.dueAt : undefined;
    } catch (error) {
      if (!accepts()) return;
      try {
        const recovered = await this.ports.read();
        if (!accepts()) return;
        this.ports.apply(recovered);
        const state = this.ports.select(recovered);
        const conflict = error instanceof MuddCommandError && error.code === "VERSION_CONFLICT";
        const waitingForTick = state !== undefined && state.dueAt > this.timing.now();
        if (state?.id === this.id) {
          if (!conflict && !waitingForTick) this.ports.report(error);
          return Math.max(this.timing.now() + 250, state.dueAt);
        }
        if (!conflict) this.ports.report(error);
      } catch {
        if (accepts()) this.ports.report(error);
        // Failed authoritative recovery pauses until a subsequent valid snapshot.
      }
    }
  }
}

export const browserGatheringTiming: SchedulerTiming = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (timer) => window.clearTimeout(timer as number),
};
