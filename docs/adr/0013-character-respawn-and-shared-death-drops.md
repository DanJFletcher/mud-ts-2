# ADR 0013: Character respawn and shared death drops

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

The initial combat decision made zero health permanent death. The game now needs a reachable, authored respawn location and a death consequence that removes one carried item and places it at the location of death for other players to recover. Character inventory is character-stream owned, quest items are undroppable, and the existing per-character item-location projection is not shared between players.

## Decision

- A world pack may author a respawn destination. The demo world uses the Stillwater Fountain.
- A newly resolved death records its cause, death location, respawn location, restored maximum health, and selected item (if any) in the character stream. The character's current location becomes the fountain and its resolved combat is cleared. Existing historical death events are not migrated or revived.
- Select uniformly from carried items that are not quest-bound and are not currently equipped. If none qualify, respawn without a drop. Use the injected server RNG and persist the selection and stable shared item ID before any retryable effect runs.
- A dropped item becomes a world-instance shared item. One world-instance item stream is the authority for each item's current location or character holder; all players can see location-held items, and only one character can claim an item.
- Character streams remain authoritative for carried inventory. Durable effects transfer the item between the shared world stream and a character stream, using stable IDs and idempotent receipts. The source character event removes a dropped item before the shared item becomes visible; a claim is reserved in the shared stream before the character receives it.
- Items already marked as shared remain shared when dropped normally. Ordinary personal items retain their current character-instanced drop behavior unless a death makes one shared.
- The first version serializes shared item changes through a single world-instance stream. This is acceptable for the small demo world; partition only if measured contention requires it.

## Consequences

- Death no longer ends a character's journey after this decision is deployed. The same character returns at full current health to the authored fountain; only future deaths use this rule.
- A death drop may be briefly unavailable while the durable transfer effect is pending. Retries must never select a different item, duplicate an item, or permit two claimants.
- Quest-bound and equipped items remain protected, including when the character dies.
- No database migration is required; existing event streams and the durable-effect outbox are sufficient.
- Shared item claims and drops introduce world-instance stream contention and require replay/idempotency tests. Authored takeables remain character-instanced.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Keep death permanent and make the fountain decorative | No change to character state rules | Does not satisfy the requested respawn behavior. |
| Keep death drops private to the dead character | Reuses the existing character-owned item-location projection | Rejected by the user, who chose drops visible and collectible by any player. |
| Write the drop independently to two character streams | No shared item stream | Allows duplicate claims or divergent room state; rejected. |
| Transfer through an idempotent world-item stream and durable effects | One authoritative shared location/holder and retry-safe cross-stream transfer | Adds an eventual-consistency window and a serialized world-item stream. |

## Verification

Tests must cover death and respawn after PvE and PvP, full health and fountain location, no-drop when every item is protected, deterministic selection and retry behavior, shared visibility, one-winner concurrent claims, normal dropping of previously shared items, and unchanged character-local takeables.

## Revisit trigger

Revisit world-item stream partitioning if shared-item contention is measurable. Revisit death penalties, recovery rules, or ownership if introducing item durability, account-bound items, corpse recovery timers, or character deletion.
