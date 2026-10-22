# ADR 0023: Character-scoped quest item returns

- **Status:** Accepted
- **Date:** 2026-10-22
- **Owners:** MUDD engine and game team
- **Related decisions:** ADR 0011, ADR 0020

## Context

Quest rewards previously supported currency only. A quest can now require a unique item found in the world, have the player hand it to an NPC, and return that same item as part of the reward. Creating a second copy would violate item identity and quest-item ownership rules; storing the brief handoff in shared NPC or world state would add an unnecessary aggregate.

## Decision

- Add a character-scoped `possess-item` quest objective, projected from the character’s event-sourced inventory. Party quests cannot use personal inventory objectives.
- Extend character quest rewards with optional item IDs. These IDs refer to unique items the character must already carry; the reward represents the NPC returning those submitted items, not creating new inventory instances.
- The NPC turn-in handler validates possession and appends quest completion plus currency and item reward facts to the same character stream. Replay verifies each returned item is present and does not add a duplicate to inventory.
- World validation rejects quest objectives and rewards that reference items absent from the world pack.
- Existing currency-only reward events remain valid. The optional item-ID payload is additive; no database migration or shared-world ownership change is required.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Remove the item on turn-in and grant a new item instance | Models a transfer and reward explicitly | Creates a duplicate instead of returning the same unique sword |
| Store the item in an NPC or world inventory between commands | Models persistent NPC custody | Adds shared aggregate ownership, concurrency, and recovery requirements for an immediate return |
| Validate possession and record the same-item return on the character reward event | Preserves unique identity and atomic quest completion | Does not model a long-lived NPC custody period; that is outside this feature |

## Consequences and trade-offs

- Positive: Item-based quest objectives and same-item return rewards remain character-owned, auditable, and retry-safe.
- Negative: This does not support newly created item rewards or an item held by an NPC across commands.
- Compatibility/migration: New reward item IDs are optional; existing event streams replay without a schema migration.
- Security/abuse/trust: The server resolves reward IDs from authored content and requires the character to carry every returned item.
- Performance/operational: The inventory check is local to the character projection; no additional aggregate or database query is needed.
- Rollback/reversibility: New content can stop using the objective or reward; committed quest reward events remain in the character stream.

## Verification

- Contract and world graph validation cover item references and reject personal inventory objectives for party quests.
- Integration coverage accepts the quest, finds the key, opens the character-specific door, traverses the maze, takes the sword, and turns it in.
- Replay and retry assertions verify the currency and same sword are awarded once without duplicating the item.

## Follow-up / revisit trigger

Define item instance creation and ownership boundaries before supporting quest rewards for items the character does not already carry, or persistent NPC custody between separate commands.
