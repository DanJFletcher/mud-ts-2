# ADR 0029: Online vital recovery and unrestricted free rest

- **Status:** Accepted; amended 2026-10-30
- **Date:** 2026-10-23
- **Owners:** Engine and game client
- **Supersedes:** The safe-location restriction and stamina-only recovery policy in [ADR 0028](0028-online-stamina-recovery-and-safe-resting.md)
- **Related:** [ADR 0027: Character-owned stamina and mana](0027-character-stamina-and-mana.md), [ADR 0007: Character-scoped paid inn rest](0007-character-scoped-paid-inn-rest.md)

## Context

Free recovery should support exploration throughout both worlds, not only rooms marked safe. Health and mana should recover with stamina while a character is online. The change must preserve the character aggregate as authority, the live-session boundary, paid inn service, existing death/drop/respawn behavior, and consent-based PvP.

## Decision

- Free `character.rest` is available to a living character in any valid room, including road and dungeon locations. It is refused during an active solo, team, or consent-based PvP encounter. It remains an explicit posture change; travel and offensive combat actions require a successful `character.stand`.
- Each vital uses its own maximum and independent fractional carry. Standing recovers 2% of each maximum per two seconds (1% per second); resting recovers 6% per two seconds (3% per second). Recovery is capped independently and never revives a character.
- Recovery accrues only while presence is confirmed by a fresh heartbeat or command. Settlement stops at the last confirmed heartbeat when an anchor is stale; reconnect resets the anchor. The server clock is authoritative; queries remain read-only.
- The existing stamina-only recovery event keeps its historical meaning. A new versioned vital-recovery event records health, stamina, mana, posture, anchor, and all independent carries. Recovery and gameplay actions append against the same character revision so damage, healing, spending, movement, death, and recovery cannot overwrite newer state.
- Standing recovery continues during active combat. Rest cannot be entered during combat. If a currently legal incoming attack reaches a resting character, that attack deals double incoming damage once and forces the character to stand. This does not create an attack path: existing consent, combat-entry, and active-encounter guards remain authoritative.
- Paid `inn.rest` remains an immediate, full restoration at the authored price. Free rest never charges currency and is not a substitute for the inn service.
- Existing `safeResting` world-authoring fields remain valid for compatibility but no longer gate free rest. Health maxima, resource formulas, death penalties, respawn health/posture, and offline recovery are unchanged.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Recover only stamina in marked safe rooms | Preserves the previous policy | Excludes roads/dungeons and does not restore the requested vitals |
| Store each vital's fractional remainder independently | Correctly recovers low-maximum health and avoids rounding loss | Adds small fields to the recovery projection and new event facts |
| Recover offline | Convenient for players | Rejected because recovery is bounded by live presence |

## Consequences and trade-offs

- **Positive:** all three character-owned vitals recover consistently in any room without a schema migration or a new aggregate.
- **Rollout:** timer-driven events remain enabled by default until `MUDD_TIMER_RECOVERY=0` is set in each environment.
- **Compatibility:** historical stamina-only event replay is unchanged; legacy characters keep their default resources and begin recovery with no offline catch-up.
- **Security/trust:** only trusted server commands supply settlement timestamps and resulting values; ordinary queries never write events.
- **Combat limits:** double damage applies only on a path that already targets a resting character. No rest action can coexist with a newly initiated encounter, and no unsolicited attack is added.
- **Rollback:** retain all event schemas and replay branches after recovery events have been persisted.

## Verification

- Verify all three rates and independent fractional carries, including low health maxima, clamping, maximum changes, and clock rollback.
- Verify fresh/stale/reconnected session boundaries, duplicate commands, concurrent character writes, and no recovery after death.
- Verify rest in ordinary rooms, roads, and dungeons in both worlds; refuse rest during solo, team, and PvP combat; preserve movement and combat restrictions while resting.
- Verify paid inn price and immediate full restoration are unchanged and historical stamina-only events do not restore health or mana.

## Amendment: lazy recovery and confirmed-presence anchors (2026-10-30)

This amendment replaces the periodic-settlement policy above; the remaining recovery, rest, combat, death, respawn, and inn rules are unchanged.

- Recovery is settled lazily as part of a state-changing command. Queries stay read-only.
- `EngineCommandContext` may carry the trusted session's last confirmed heartbeat (`presenceAnchorAt`). A fresh anchor, no more than 45 seconds old at the command's server time, permits settlement through command time. A stale anchor permits settlement only through that heartbeat; the same `character.vital_recovery_settled` append then resets the recovery anchor to command time.
- Reconnect and world entry settle through the prior heartbeat before resetting the anchor. The version-2 `character.stamina.recover` system command performs this as one append. Version 1 remains registered for existing in-flight commands; historical event replay is unchanged.
- The event can optionally record `settledAt` when settlement and the later anchor reset occur together. Legacy reset events without this field retain their original no-settlement/clear-carries behavior.
- Periodic online settlement and startup reconciliation are controlled by `MUDD_TIMER_RECOVERY`. It defaults to enabled for rollout compatibility; setting it to `0` disables both while retaining the scheduler for rollback.
- The game snapshot includes authoritative `serverTime`. The SDK uses its observed clock offset and `resolveVitalRecovery` to expose display-only projected vitals; command results and later snapshots remain authoritative. Older snapshots without `serverTime` use the client clock.
- Continuously changing vital numbers are outside live regions. The posture status remains the meaningful announcement surface.

There are no storage migrations or new event types. Recovery events still use the character stream and expected revision. In production, disable the timer only after development measurements verify zero timer writes and the expected reductions in move conflicts and character realtime wakeups.
