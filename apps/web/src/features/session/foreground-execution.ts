type RefreshGate = { begin(): void; end(): void };
export type ExecutionToken = Readonly<{ id: symbol; label: string }>;

/** Execution owns the refresh gate; feedback may outlive the request. */
export class ForegroundExecution {
  private owner?: ExecutionToken;
  private running = false;
  private feedback = false;
  constructor(private readonly gate: RefreshGate) {}

  begin(label: string): ExecutionToken | undefined {
    if (this.running || (this.feedback && !(label === "move" && this.owner?.label === "move"))) return;
    const token = { id: Symbol(label), label };
    this.owner = token;
    this.running = true;
    this.feedback = true;
    this.gate.begin();
    return token;
  }

  finish(token: ExecutionToken, keepFeedback = false): boolean {
    if (token !== this.owner) return false;
    if (this.running) this.gate.end();
    this.running = false;
    this.feedback = keepFeedback && this.feedback;
    if (!this.feedback) this.owner = undefined;
    return true;
  }

  /** Confirmation may clear feedback before the request's finally block runs. */
  clearFeedback(token: ExecutionToken | undefined): boolean {
    if (!token || token !== this.owner) return false;
    this.feedback = false;
    if (!this.running) this.owner = undefined;
    return true;
  }
}
