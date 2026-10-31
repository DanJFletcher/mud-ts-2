# MUDD feature implementation plan — Lazy vital recovery

**Status:** Implemented; development measurements and staged rollout remain pending. Source: [round-trip latency audit](../performance/round-trip-latency-audit.md), finding 5 and recommendation 10. This plan amends [ADR 0029](../adr/0029-online-vital-recovery-and-unrestricted-rest.md).

**Goal / user-observable behavior:** Recovery no longer writes events to an online character's stream on a timer. A lone player's commands stop conflicting with background settlements, so moves no longer pay for up to three snapshot-and-retry cycles. Vitals recover at the same rates, and the display still counts up between actions.

**Existing repo findings:**

- **Timer-driven settlement.** The stamina scheduler ticks once a second per world ([stamina-recovery-scheduler.ts:20](../../apps/server/src/stamina-recovery-scheduler.ts#L20)). For each tracked online session it reads the character stream. It dispatches `character.stamina.recover` ([stamina-recovery-scheduler.ts:73](../../apps/server/src/stamina-recovery-scheduler.ts#L73)) when two conditions hold:
  - a vital is below its maximum;
  - at least 1 s has passed since the last settlement ([stamina-recovery-scheduler.ts:69](../../apps/server/src/stamina-recovery-scheduler.ts#L69)).

  Settlement stops at the session's last heartbeat ([stamina-recovery-scheduler.ts:54](../../apps/server/src/stamina-recovery-scheduler.ts#L54)). So these writes follow heartbeats: every 30 s, plus the heartbeats sent on presence invalidations.
- **Why commands conflict.** Each settlement appends `character.vital_recovery_settled` ([character.ts:151](../../packages/plugins/src/character.ts#L151)). That bumps the revision the client sends as `expectedVersion`. A command sent before the client has refreshed fails with `VERSION_CONFLICT`.
  - Moves retry up to three times, and each retry costs a snapshot and a command ([client-sdk index.ts:1112](../../packages/client-sdk/src/index.ts#L1112)).
  - After a final conflict, the move handler refetches the snapshot once more ([App.tsx:2410](../../apps/web/src/App.tsx#L2410)).
- **Commands settle first.** Commands that change vitals settle recovery before applying their change. That covers movement ([movement.ts:90](../../packages/plugins/src/movement.ts#L90)), combat, team combat, rest and stand: all command-time recovery call sites use the presence-aware helper.
- **Offline-gap characterization.** Before the change, a command after a 60-second gap with no intervening heartbeat settled all 60 seconds (stamina/mana +60 at maximum 100, health +3 at maximum 6). The presence-aware path now caps settlement at the saved heartbeat.
- **ADR 0029 rules to keep:**
  - recovery only with a fresh heartbeat;
  - settlement stops at the last confirmed heartbeat;
  - reconnecting resets the anchor;
  - the server clock is authoritative;
  - queries are read-only.

  The ADR amendment replaces the former periodic-settlement downside.
- **Reconnect.** The recovery reset helper in [index.ts:195](../../apps/server/src/index.ts#L195) now dispatches v2 to settle through the saved heartbeat before resetting the anchor. It is called from world entry ([index.ts:878](../../apps/server/src/index.ts#L878)) and the stale-heartbeat path ([index.ts:919](../../apps/server/src/index.ts#L919)).
- **What the client already has.** The snapshot includes `character.staminaRecovery` (anchor, posture and carries). `resolveVitalRecovery` is a pure, shared function in [engine-contracts/src/stamina.ts](../../engine-contracts/src/stamina.ts).

**Owning plugin/capability:**

- the `mudd.character` plugin (recovery rules);
- server wiring (the presence anchor);
- the stamina scheduler (removal of timed settlement);
- the SDK and UI (display).

**Assumptions and deferred scope:**

- Recovery rates, carries, the rest multiplier, inn rest, and death and respawn rules are unchanged.
- Genuine conflicts from other players or from system combat will still happen, so the SDK keeps its retry. Reducing move retries back to one is a follow-up, once conflict rates have been measured.

## Contract changes

- **Engine command context:** add the session's presence anchor, the last confirmed heartbeat. Player commands get it, as do system commands that act on a session.
- **System command `character.stamina.recover` v2:** settles to a given time and can then reset the anchor, all in one append. v1 stays registered for replay and for in-flight commands.
- **Snapshot:** add `serverTime`, so clients can correct for clock skew when projecting vitals.
- **Events:** none new. `character.vital_recovery_settled` keeps its meaning.

## Boundary map

- **Core/ports touched:** `EngineCommandContext` gains an optional presence anchor.
- **Plugin(s) touched:** character (a settlement-time helper used by all 11 call sites), movement, combat and team combat.
- **Persistence/migration touched:** none.
- **Client SDK / PWA / TTY impact:**
  - The SDK exposes projected vitals, computed from the snapshot's anchor with `resolveVitalRecovery`.
  - The UI renders those projected values between snapshots.
  - TTY clients can request a fresh snapshot instead.
- **Operational / networking impact:** removes the timer-driven character writes, along with the realtime wakeups and snapshot refetches they cause.

## Design

- **Settlement time.** One helper decides how far a command may settle:
  - If the presence anchor is fresh (within the existing 45 s window), settle to the command time. The command itself confirms presence.
  - If the anchor is stale, settle only up to the anchor, and reset it in the same append. This matches the reconnect rule.
- **Reconnect.** The stale-heartbeat path and the world-entry path both use one v2 command. It settles owed recovery up to the previous heartbeat, then resets the anchor.
- **Scheduler.** Stop online settlement and startup reconciliation. Keep the module behind a flag for rollback.
- **Display.**
  - The client projects vitals from the last snapshot's anchor up to now, corrected by `serverTime`, and caps them at their maximum.
  - Projected values are for display only; the next snapshot or command is authoritative.
  - Keep the projected numbers outside the posture live region (`role="status"` in [StaminaStatus.tsx:34](../../packages/ui/src/components/StaminaStatus.tsx#L34)), so screen readers aren't flooded with updates.

## Invariants and failure paths

- Recovery accrues only while a fresh heartbeat or a command confirms presence. There is no offline catch-up.
- Every vital change still settles recovery first, and appends against the current character revision.
- Queries compute projected values but never write.
- Death stops recovery. Respawn rules are unchanged.
- Old snapshots without `serverTime` fall back to the client clock.

## Steps

1. Write characterization tests for the current rules:
   - fresh, stale and reconnected sessions;
   - independent carries;
   - low health maximums;
   - the rest multiplier;
   - death.

   Add the offline-gap test (a command after a gap longer than 45 s with no heartbeat), and record its current result.
2. Write the ADR 0029 amendment, covering:
   - lazy settlement;
   - the presence anchor;
   - settle-then-reset on reconnect;
   - removal of periodic events.
3. Add the presence anchor to the command context, add the settlement-time helper, and switch all 11 call sites to it.
4. Add `character.stamina.recover` v2, and use it on the reconnect and world-entry paths.
5. Add `serverTime` to snapshots, and add projected vitals to the SDK and UI.
6. Disable the scheduler's online settlement behind `MUDD_TIMER_RECOVERY=0`.
7. Measure in development:
   - character-stream events per online hour while vitals regenerate;
   - the `VERSION_CONFLICT` rate on moves;
   - `character` wakeups per minute.

## Acceptance criteria

- [x] With `MUDD_TIMER_RECOVERY=0`, the scheduler performs neither online settlement nor startup reconciliation.
- [x] Recovery totals match the ADR 0029 rules in characterization tests, including no recovery after death.
- [x] There is no offline catch-up, including when a command arrives before the first heartbeat.
- [x] The UI projects vitals between snapshots without making ticking values a live region.
- [ ] Development measurements confirm move conflicts and character wakeups fall to real concurrent changes only.

## Rollout and rollback

1. Ship the context, the helper and the v2 command first. Nothing changes in behavior while the scheduler is still running.
2. Then disable timer settlement.

To roll back, re-enable the scheduler. The v2 command appends the same event type as v1, so replay is unaffected.
