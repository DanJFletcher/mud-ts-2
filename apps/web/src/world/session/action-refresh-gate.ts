/** Reject background results that cross an action boundary, even after it ends. */
export class ActionRefreshGate {
  private epoch = 0;
  busy = false;
  capture() { return this.epoch; }
  begin() { this.busy = true; this.epoch++; }
  end() { this.busy = false; }
  accepts(epoch: number) { return !this.busy && epoch === this.epoch; }
}
