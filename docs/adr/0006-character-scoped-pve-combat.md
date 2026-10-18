# ADR 0006: Character-scoped turn-based PvE combat

- **Status:** Accepted for the first playable combat slice
- **Date:** 2026-10-18

## Context

The engine exposes only a draft combat command shape and has no combat runtime, health projection, turn handler, or combat UI. Character state is already event-sourced in a single stream, and the product rule permits one active character per world session. A shared NPC-health aggregate would require coordinated writes between character and world state, which is outside this first slice.

## Decision

- The first encounter is one character against one authored NPC, with the character's combat state stored in that character's event stream.
- Each character receives an independent encounter against the same authored NPC. NPC definitions and combat profiles remain immutable world content; combat does not mutate shared NPC or location state.
- The combat plugin owns encounter validation, turn resolution, and a deterministic starter ruleset. The generic engine core remains rules-agnostic.
- The first ruleset supports attack, defend, and flee. It uses authored opponent health/damage and fixed player values; it does not roll dice, change persistent character health, or grant rewards.
- One active encounter is permitted per character. Movement is blocked while it is active; fleeing or resolving the encounter clears that restriction.
- The existing one-active-character-per-world-session rule is unchanged.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Shared NPC/world encounter aggregate | Shared health and one globally contested opponent | Requires atomic character/world writes, shared turn ownership, and multi-player encounter semantics not needed for the first slice |
| Put combat state in the character aggregate | One atomic stream for the player's actions, versioning, and replay; independent fights per character | NPC health is private to each character until shared encounters are designed |
| Keep combat only in client state | Minimal persistence work | Rejected because clients could fabricate outcomes and reconnects would lose the encounter |

## Consequences and trade-offs

- **Positive:** Commands, outcomes, and replay stay authoritative and character-scoped; retries and concurrent actions use the existing aggregate revision and command receipt behavior.
- **Negative:** Fighting an NPC does not change what another character sees, and the deterministic starter rules are intentionally simple.
- **Compatibility/migration:** New optional character projection state and new versioned event types; legacy character streams replay without combat state.
- **Security/abuse/trust:** The server resolves the NPC, location, stats, current encounter, damage, and outcome from trusted world content and replayed character state. Client commands express only an action and target.
- **Performance/operational:** Combat is stored in the existing character stream; no new table, aggregate writer, or migration is required.
- **Rollback/reversibility:** Remove the combat plugin and authored combat profile; historical combat events remain readable by replay code. Do not remove their schemas after they have been persisted.

## Verification

The initial implementation must test invalid targets and locations, attack/defend/flee resolution, victory/defeat, movement lock, replay, stale revisions, duplicate command IDs, and independent encounters for two characters.

## Follow-up / revisit trigger

Revisit this decision before introducing shared NPC health, party combat, PvP, persistent injuries, loot/rewards, or a probabilistic ruleset. Those features need explicit scope and concurrency decisions.
