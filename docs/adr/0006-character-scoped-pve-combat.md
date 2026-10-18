# ADR 0006: Character-scoped turn-based PvE combat

- **Status:** Accepted for the first playable combat slice
- **Date:** 2026-10-18

## Context

The engine exposes only a draft combat command shape and has no combat runtime, health projection, turn handler, or combat UI. Character state is already event-sourced in a single stream, and the product rule permits one active character per world session. A shared NPC-health aggregate would require coordinated writes between character and world state, which is outside this first slice.

## Decision

- The first encounter is one character against one authored NPC, with the character's combat state stored in that character's event stream.
- Each character receives an independent encounter against the same authored NPC. NPC definitions and combat profiles remain immutable world content; combat does not mutate shared NPC or location state.
- The combat plugin owns encounter validation, turn resolution, and a deterministic starter ruleset. The generic engine core remains rules-agnostic.
- The first ruleset supports attack, defend, and flee. It uses authored opponent health/damage and fixed player values; it does not roll dice or persist combat injuries.
- Equipment is character-owned: inventory, equipped slots, and their changes live in the character event stream. Gear modifiers are immutable item attributes authored in world/merchant content; combat reads only the character's currently equipped items and records resolved damage in the combat event.
- One active encounter is permitted per character. Movement is blocked while it is active; fleeing or resolving the encounter clears that restriction.
- The existing one-active-character-per-world-session rule is unchanged.
- The combat plugin owns victory XP, level thresholds, and max-health rewards. A victory writes the combat result followed by a character advancement event in one character-stream append; leveling increases max health for future encounters.
- The generic engine stores the resulting experience and level but does not calculate advancement rules. Injury remains encounter-local in this slice.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Shared NPC/world encounter aggregate | Shared health and one globally contested opponent | Requires atomic character/world writes, shared turn ownership, and multi-player encounter semantics not needed for the first slice |
| Put combat state in the character aggregate | One atomic stream for the player's actions, versioning, and replay; independent fights per character | NPC health is private to each character until shared encounters are designed |
| Keep combat only in client state | Minimal persistence work | Rejected because clients could fabricate outcomes and reconnects would lose the encounter |

## Consequences and trade-offs

- **Positive:** Commands, outcomes, and replay stay authoritative and character-scoped; retries and concurrent actions use the existing aggregate revision and command receipt behavior.
- **Negative:** Fighting an NPC does not change what another character sees, and the deterministic starter rules are intentionally simple.
- **Compatibility/migration:** Advancement is optional in the character projection so legacy streams replay unchanged. Replay accepts combat event versions 1 and 2; version 1 defaults missing opponent style to `steady`. `character.advancement_awarded` is a new version-1 event. No database migration is required.
- **Security/abuse/trust:** The server resolves the NPC, location, stats, current encounter, damage, and outcome from trusted world content and replayed character state. Client commands express only an action and target.
- **Performance/operational:** Combat is stored in the existing character stream; no new table, aggregate writer, or migration is required.
- **Rollback/reversibility:** Remove the combat plugin and authored combat profile; historical combat events remain readable by replay code. Do not remove their schemas after they have been persisted.

## Addendum: character-owned equipment

- Weapon and armor items remain owned by the character aggregate; equipping is a versioned `character.equipment_changed` event in that same stream.
- The event changes one slot only. Equipping validates that the referenced item is carried and its authored slot matches; dropping an equipped item is rejected until it is unequipped.
- Item definitions remain immutable world content, and their combat bonuses are copied onto the character-owned item when acquired. No shared item/world aggregate or database migration is introduced.
- Combat derives outgoing damage from base attack plus the equipped weapon bonus, and incoming damage from authored opponent damage minus equipped armor reduction (floored at zero). The resolved event persists the result; replay does not recalculate balance rules.

## Addendum: character advancement

- Each victory awards the combat plugin's configured experience reward. The plugin applies cumulative thresholds and caps advancement at its configured maximum level; each level adds max health to future encounters.
- The resolved combat event and its advancement reward are appended atomically to the same character stream. Duplicate command IDs use the engine's existing receipt; replay verifies the reward matches a victory, prevents duplicate encounter rewards, and uses recorded level/experience rather than recalculating thresholds.
- One active character per world session remains unchanged. Progression belongs to the character aggregate, so another character's victories cannot affect it.
- Persistent injuries, healing, loot, shared NPC state, and random rolls remain deferred; injury stays local to an encounter in this slice.

## Addendum: authored opponent styles

- NPC combat profiles may author a `steady`, `heavy`, or `guardian` style. Missing style means `steady`.
- `steady` opponents strike after each player attack as before. `heavy` opponents telegraph on odd-numbered encounter rounds and strike on even-numbered rounds; defending still blocks the strike. `guardian` opponents reduce each incoming player hit by their authored defense value (default 1) and counterattack after attacks.
- The encounter projection snapshots the opponent style. The character-scoped combat event records the resolved damage and narration, so replay never re-runs the style logic. NPC definitions remain immutable shared world content; encounters and health remain character-specific.
- The combat event advances to schema version 2. Replay continues to accept version-1 events and interprets their missing style as `steady`.
- This adds no shared NPC health, random rolls, persistent injuries, or database migration.

## Addendum: combat healing items

- Consumable healing items are character-owned inventory entries with authored healing amounts. A combat `use-item` action requires an active encounter and a carried healing item.
- The combat event records the consumed item and healing amount atomically with the updated encounter. Replay validates ownership and effect limits, then removes the item from inventory and item-location tracking.
- Healing is capped at the active encounter's max health. Using an item consumes the player's turn, so the opponent still responds according to its authored style. At full health, or outside combat, the item is not consumed.
- This heals encounter-local health only; it does not add persistent injuries or change future encounters' starting health. Existing version-1 and version-2 combat events remain readable; consumable combat actions use event version 3.

## Verification

The initial implementation must test invalid targets and locations, attack/defend/flee resolution, victory/defeat, movement lock, replay, stale revisions, duplicate command IDs, and independent encounters for two characters.

## Follow-up / revisit trigger

Revisit this decision before introducing shared NPC health, party combat, PvP, persistent injuries, loot/rewards, or a probabilistic ruleset. Those features need explicit scope and concurrency decisions.
