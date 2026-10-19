# ADR 0011: Quest-bound character items

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Takeable items are character-owned instances recorded in character event streams. Characters can currently drop carried items, which can remove a quest-critical item from the player's inventory. The current game has no player-trade or merchant-sale command.

## Decision

- World takeable definitions and inventory item contracts may carry an optional `questBound` marker. An absent marker means the item is not bound.
- Taking a marked world item copies the marker into the character's `character.item_taken` event. Merchant listings use the same inventory-item contract so a marked item retains the flag when purchased.
- The character plugin rejects drops of quest-bound items. For items already carried before this marker was added, the drop check also consults the authored world takeable definition by item ID.
- Character event replay rejects a drop event for an item marked quest-bound.
- Any future sale, trade, or transfer command must reject quest-bound items at its authoritative boundary. No trade or sale system is added in this decision.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Infer binding from every item-use or quest objective reference | Avoids repeated content annotations | Puzzle item use does not always mean an item is quest-critical; the inference would be ambiguous. |
| Hard-code protected item IDs in the drop handler | Minimal schema change | Couples engine behavior to one world and does not help future transfer commands. |
| Add an explicit optional marker to world and inventory item contracts | Clear authoring intent; compatible with existing unmarked items | Content authors must mark each quest item explicitly. |

## Consequences and trade-offs

- Positive: Quest-critical items cannot be discarded, and the binding travels with character-owned item state.
- Negative: Content authors must mark quest takeables explicitly.
- Compatibility/migration: No database migration is needed. The optional field is backward-compatible with existing event payloads; the drop handler checks world content for legacy carried takeables.
- Security/abuse/trust: The server plugin enforces the rule; the client only hides unavailable drop actions and gives immediate feedback.
- Performance/operational: The fallback lookup scans authored takeables when handling a drop; the current world is small.
- Rollback/reversibility: Removing the rule requires a contract/content change and a deliberate decision about items already carried.

## Verification

Regression tests cover taking and rejecting a drop for quest items, ordinary-item dropping, invalid replayed drop events, and schema compatibility for marked and unmarked items.

## Follow-up / revisit trigger

When player trading, item selling, or another ownership-transfer feature is introduced, enforce `questBound` in that command's server-side validation and add transfer-specific tests.
