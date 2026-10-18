# ADR 0001 — Generic prerequisites for item interactions

- **Status:** Accepted
- **Date:** 2026-10-18
- **Owners:** MUDD engine and world-content authors
- **Related tasks:** Bell’s Second Note demo quest

## Context

The world content model already supports item-on-target interactions and event-backed quest objectives, but it could not express an ordered interaction or a passage that remains locked until an interaction succeeds. The bell puzzle needs a safe, character-specific sequence without a puzzle-specific command or client-side rule.

## Decision

Extend the existing typed world-content contracts additively:

- An item-use interaction may list prerequisite interaction IDs and a player-facing blocked message.
- An exit may name a required interaction.
- A quest objective may track a completed item-use interaction at a location.

The existing `character.use` and `character.move` server handlers enforce these rules against the character projection. The item-use event stream remains authoritative; projections determine quest progress and whether a gated exit is available. A client projection is informative only—the movement command checks the gate again.

These optional fields preserve existing content. This decision adds no new wire command, event payload, database table, or migration.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Add a bell-specific command or puzzle plugin | Small change for this one puzzle | Couples the engine to one world object and leaves other authored sequences unsupported |
| Make the hidden location freely accessible | No engine change | Removes the puzzle gate and makes puzzle completion non-authoritative |
| Add optional prerequisites to existing interactions and exits | Reuses the typed command/event path and works across clients | Expands a public content contract and requires graph validation plus server checks |

## Consequences and trade-offs

- **Positive:** Authored interactions can require earlier interactions; locked exits are enforced server-side and remain character-scoped.
- **Negative:** Content authors must ensure prerequisite graphs are reachable and not cyclic. The validator checks references and same-location prerequisites; cycle detection is deferred.
- **Compatibility/migration:** Existing content omits the new optional fields and retains its current behavior. Existing event shapes and persisted data remain unchanged.
- **Security/abuse/trust:** Client-supplied availability cannot bypass movement validation. Failed prerequisite checks append no progress event.
- **Performance/operational:** Checks scan small per-character observation lists already used by the game.
- **Rollback/reversibility:** Remove the optional fields from content to restore open exits and unsequenced item use; no persisted-data migration is needed.

## Verification

The SDK integration test uses the engine command path to verify the locked exit, a rejected out-of-order use, the ordered valid uses, the newly available exit, descent, quest progress, and turn-in. The full workspace test suite, typecheck, and lint pass. Human blind playtesting has not been performed.

## Follow-up / revisit trigger

Add cycle validation before authoring long prerequisite chains. Revisit shared party/world puzzle state only when a concrete shared mechanism requires it; this demo puzzle intentionally remains per-character.
