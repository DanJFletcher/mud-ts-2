/** Proposed injectable core ports; no authoritative rolls in a networked client. */
export interface ClockPort {
  /** Authoritative UTC wall-clock when a decision is committed. */
  now(): Date;
  /** Logical simulation tick, scoped to a world instance by the host. */
  tick(): number;
}

export interface RngPort {
  /** Returns an integer in [1, sides]. Inject seeded deterministic RNG for tests. */
  roll(sides: number): number;
}

export interface TurnWindow {
  readonly encounterId: string;
  readonly round: number;
  readonly activeParticipantId: string;
  readonly revision: number;
}

/** Turn ownership/sequencing, not D&D-specific action resolution. */
export interface TurnCoordinatorPort {
  getCurrentTurn(encounterId: string): Promise<TurnWindow | null>;
}
