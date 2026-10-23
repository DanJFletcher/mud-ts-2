# ADR 0029: Online vital recovery and unrestricted free rest

- **Status:** Accepted
- **Date:** 2026-10-23
- **Owners:** Engine and game client
- **Supersedes:** The safe-location restriction and stamina-only recovery policy in [ADR 0028](0028-online-stamina-recovery-and-safe-resting.md)
- **Related:** [ADR 0027: Character-owned stamina and mana](0027-character-stamina-and-mana.md), [ADR 0007: Character-scoped paid inn rest](0007-character-scoped-paid-inn-rest.md)

## Context

Free recovery should support exploration throughout both worlds, not only rooms marked safe. Health and mana should recover with stamina while a character is online. The change must preserve the character aggregate as authority, the live-session boundary, paid inn service, existing death/drop/respawn behavior, and consent-based PvP.

## Decision

- Free `character.rest` is available to a living character in any valid room, including road and dungeon locations. It is refused during an active solo, team, or consent-based PvP encounter. It remains an explicit posture change; travel and offensive combat actions require a successful `character.stand`.
- Each vital uses its own maximum and independent fractional carry. Standing recovers 2% of each maximum per two seconds (1% per second); resting recovers 6% per two seconds (3% per second). Recovery is capped independently and never revives a character.
- Only a fresh world-session heartbeat permits recovery. Settlement stops at the last confirmed heartbeat, unanchored stale sessions do not accrue recovery, and reconnect resets the anchor. The server clock is authoritative; queries remain read-only.
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
- **Negative:** online characters with any missing vital continue to produce periodic character-stream settlement events.
- **Compatibility:** historical stamina-only event replay is unchanged; legacy characters keep their default resources and begin recovery with no offline catch-up.
- **Security/trust:** only trusted server commands supply settlement timestamps and resulting values; ordinary queries never write events.
- **Combat limits:** double damage applies only on a path that already targets a resting character. No rest action can coexist with a newly initiated encounter, and no unsolicited attack is added.
- **Rollback:** retain all event schemas and replay branches after recovery events have been persisted.

## Verification

- Verify all three rates and independent fractional carries, including low health maxima, clamping, maximum changes, and clock rollback.
- Verify fresh/stale/reconnected session boundaries, duplicate commands, concurrent character writes, and no recovery after death.
- Verify rest in ordinary rooms, roads, and dungeons in both worlds; refuse rest during solo, team, and PvP combat; preserve movement and combat restrictions while resting.
- Verify paid inn price and immediate full restoration are unchanged and historical stamina-only events do not restore health or mana.
