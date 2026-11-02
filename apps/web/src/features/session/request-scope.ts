export interface RequestEpoch {
  readonly busy: boolean;
  capture(): number;
}
/** Latest-read-wins within one lifecycle and foreground epoch. */
export class RequestScope {
  private sequence = 0;
  private active = true;
  constructor(private readonly gate: RequestEpoch) {}
  get alive() { return this.active; }
  activate() { this.active = true; this.sequence++; }
  dispose() { this.active = false; this.sequence++; }
  invalidate() { this.sequence++; }
  begin(allowBusy = false): (() => boolean) | undefined {
    if (!this.active || (this.gate.busy && !allowBusy)) return;
    const sequence = ++this.sequence;
    const epoch = this.gate.capture();
    return () => this.active && sequence === this.sequence &&
      epoch === this.gate.capture() && (allowBusy || !this.gate.busy);
  }
}
