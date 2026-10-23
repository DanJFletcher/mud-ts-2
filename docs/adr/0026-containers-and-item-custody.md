# ADR 0026: Authored containers and item custody

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

Worlds need objects such as sacks, chests, and corpses that can hold takeable
items. Containers must not hold other containers. Existing authored room loot is
character-instanced: each character can take their own copy, and the character
stream records item ownership changes.

## Decision

- A container definition belongs to immutable world content and is attached to
  one location. Its kind is descriptive (`sack`, `chest`, `corpse`, or `other`).
- A container's contents are ordinary authored takeable item definitions. The
  schema has no nested-container field, and strict validation rejects unknown
  nested content.
- Taking an item from a container remains a character-owned event. The event
  records the source container, and the character projection remembers that the
  item has been claimed so consumed or dropped contents do not reappear in that
  character's authored container.
- Container definitions and contents are character-instanced just like existing
  authored room loot; this ADR does not create shared stock, mutable shared
  containers, or a new shared-world aggregate.
- Authored NPC and road-combatant loot is an optional list of item templates and
  an optional currency amount. A combat victory creates a corpse snapshot in the
  existing world-instance item stream, including an empty corpse when no loot
  was authored. Corpse contents are instantiated with unique shared item IDs
  and the defeated opponent's name and location are recorded.
- Dynamic corpses, their contents, and unclaimed currency are shared world
  state, not character inventory or mutable NPC state. The world-item stream is
  the single writer: item claims reserve the item there before a durable effect
  credits the character stream; currency claims reserve the corpse's currency
  there before a durable effect credits the character wallet. Stable encounter
  and effect IDs make retries idempotent, and concurrent claims have one winner.
- Corpse inspection exposes currently available contents. Items are taken
  individually through the existing shared-item claim flow; available currency
  is collected through the same take interaction. Claimed loot disappears from
  the corpse for every player.
- Corpse is also a supported kind for authored content. Player-death corpses
  and moving character death-dropped items into a corpse remain deferred; the
  existing player-death drop remains loose shared room loot.

## Consequences

- No database migration is required. The shared world-item stream is extended
  with corpse creation and currency-claim events.
- Container contents can be inspected in the current-room projection and taken
  using the existing take command.
- Container opening/locking, putting items into containers, capacity, and
  player-death corpse generation are not introduced here.

## Verification

- Contract tests accept supported container kinds and reject nested containers
  and duplicate content IDs.
- Engine tests verify contents appear in the room projection, can be taken only
  from the current location, and remain removed for that character after use.
- Combat tests verify victory creates one shared corpse, item and currency
  claims are visible and single-winner, retries do not duplicate loot, and
  character wallets are credited once.
