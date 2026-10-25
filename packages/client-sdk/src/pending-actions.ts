export type PendingActionState =
  | "sending"
  | "acknowledged"
  | "confirmed"
  | "rejected"
  | "failed"
  | "uncertain";

export type PendingActionScope = Readonly<{
  worldInstanceId: string;
  characterId?: string;
  sessionId?: string;
  roomId?: string;
}>;

export type PendingActionDetails =
  | Readonly<{
      kind: "chat.send";
      roomId: string;
      clientMessageId: string;
      text: string;
      speakerName: string;
    }>
  | Readonly<{
      kind: "character.move";
      fromLocationId: string;
      exitId: string;
      direction: string;
    }>
  | Readonly<{
      kind: "pvp.challenge";
      recipientCharacterId: string;
      recipientName: string;
      priorRequestIds: readonly string[];
    }>
  | Readonly<{
      kind: "pvp.respond";
      requestId: string;
      response: "accept" | "decline";
      otherCharacterName: string;
    }>;

export type PendingAction = Readonly<{
  id: string;
  scope: PendingActionScope;
  details: PendingActionDetails;
  state: PendingActionState;
  message?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}>;

export type BeginPendingAction = Readonly<{
  id: string;
  scope: PendingActionScope;
  details: PendingActionDetails;
}>;

type Listener = () => void;
type CoordinatorOptions = Readonly<{
  now?: () => number;
  maxActions?: number;
}>;

const STATE_LIFETIMES: Readonly<Record<PendingActionState, number>> = {
  sending: 30_000,
  acknowledged: 30_000,
  uncertain: 120_000,
  confirmed: 4_000,
  rejected: 8_000,
  failed: 8_000,
};

const TERMINAL_STATES = new Set<PendingActionState>(["confirmed", "rejected", "failed"]);

/**
 * Framework-neutral presentation state for commands that are still being
 * confirmed by the authoritative host. It never changes game projections.
 */
export class PendingActionCoordinator {
  private readonly now: () => number;
  private readonly maxActions: number;
  private readonly actions = new Map<string, PendingAction>();
  private readonly listeners = new Set<Listener>();
  private snapshot: readonly PendingAction[] = Object.freeze([]);
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: CoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxActions = Math.max(1, options.maxActions ?? 100);
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly PendingAction[] => this.snapshot;

  begin(input: BeginPendingAction): PendingAction {
    if (!input.id.trim() || !input.scope.worldInstanceId.trim()) {
      throw new Error("Pending actions require an ID and world scope.");
    }
    const existing = this.actions.get(input.id);
    if (existing) {
      if (!sameScope(existing.scope, input.scope)) {
        throw new Error("A pending action ID cannot be reused in another scope.");
      }
      if (JSON.stringify(existing.details) !== JSON.stringify(input.details)) {
        throw new Error("A pending action ID cannot be reused for different action details.");
      }
      if (existing.state === "uncertain" || existing.state === "acknowledged") {
        return this.transition(input.id, "sending") ?? existing;
      }
      return existing;
    }

    const now = this.now();
    const action: PendingAction = Object.freeze({
      id: input.id,
      scope: Object.freeze({ ...input.scope }),
      details: Object.freeze({ ...input.details }) as PendingActionDetails,
      state: "sending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + STATE_LIFETIMES.sending,
    });
    this.actions.set(action.id, action);
    this.enforceBound();
    this.publish();
    return this.actions.get(action.id) ?? action;
  }

  acknowledge(id: string, message?: string): PendingAction | undefined {
    return this.transition(id, "acknowledged", message);
  }

  confirm(id: string): PendingAction | undefined {
    return this.transition(id, "confirmed");
  }

  reject(id: string, message?: string): PendingAction | undefined {
    return this.transition(id, "rejected", message);
  }

  fail(id: string, message?: string): PendingAction | undefined {
    return this.transition(id, "failed", message);
  }

  markUncertain(id: string, message?: string): PendingAction | undefined {
    return this.transition(id, "uncertain", message);
  }

  clearWhere(predicate: (action: PendingAction) => boolean): void {
    let changed = false;
    for (const [id, action] of this.actions) {
      if (predicate(action)) {
        this.actions.delete(id);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  clearOutsideScope(scope: PendingActionScope): void {
    this.clearWhere((action) => !scopeMatches(action.scope, scope));
  }

  private transition(
    id: string,
    state: PendingActionState,
    message?: string,
  ): PendingAction | undefined {
    const current = this.actions.get(id);
    if (!current || TERMINAL_STATES.has(current.state)) return current;
    const now = this.now();
    const updated: PendingAction = Object.freeze({
      ...current,
      state,
      ...(message ? { message } : { message: undefined }),
      updatedAt: now,
      expiresAt: now + STATE_LIFETIMES[state],
    });
    this.actions.set(id, updated);
    this.publish();
    return updated;
  }

  private expire(): void {
    this.cleanupTimer = undefined;
    const now = this.now();
    let changed = false;
    for (const [id, action] of this.actions) {
      if (action.expiresAt > now) continue;
      if (action.state === "sending" || action.state === "acknowledged") {
        this.actions.set(id, Object.freeze({
          ...action,
          state: "uncertain",
          message: "The server has not confirmed the result yet.",
          updatedAt: now,
          expiresAt: now + STATE_LIFETIMES.uncertain,
        }));
      } else {
        this.actions.delete(id);
      }
      changed = true;
    }
    if (changed) this.publish();
    else this.scheduleCleanup();
  }

  private enforceBound(): void {
    while (this.actions.size > this.maxActions) {
      const oldestSettled = [...this.actions.values()].find((action) =>
        TERMINAL_STATES.has(action.state) || action.state === "uncertain");
      const oldest = oldestSettled ?? this.actions.values().next().value as PendingAction | undefined;
      if (!oldest) return;
      this.actions.delete(oldest.id);
    }
  }

  private publish(): void {
    this.snapshot = Object.freeze([...this.actions.values()]);
    this.scheduleCleanup();
    this.listeners.forEach((listener) => listener());
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    if (!this.actions.size) return;
    const nextExpiry = Math.min(...[...this.actions.values()].map((action) => action.expiresAt));
    this.cleanupTimer = setTimeout(() => this.expire(), Math.max(0, nextExpiry - this.now()));
  }
}

function sameScope(left: PendingActionScope, right: PendingActionScope): boolean {
  return left.worldInstanceId === right.worldInstanceId &&
    left.characterId === right.characterId &&
    left.sessionId === right.sessionId &&
    left.roomId === right.roomId;
}

function scopeMatches(actionScope: PendingActionScope, currentScope: PendingActionScope): boolean {
  return (Object.keys(currentScope) as Array<keyof PendingActionScope>)
    .every((key) => actionScope[key] === currentScope[key]);
}
