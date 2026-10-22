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
- Corpse is a supported container kind for authored content. Automatically
  creating corpses from NPC/player death, and moving death-dropped items into
  those containers, are deferred.

## Consequences

- No database migration or shared-item event-stream change is required.
- Container contents can be inspected in the current-room projection and taken
  using the existing take command.
- Container opening/locking, putting items into containers, capacity, and
  shared loot ownership are not introduced here.
- A later shared or dynamically generated container feature must define
  world-instance ownership, atomic item transfers, and concurrency handling
  before changing shared item state.

## Verification

- Contract tests accept supported container kinds and reject nested containers
  and duplicate content IDs.
- Engine tests verify contents appear in the room projection, can be taken only
  from the current location, and remain removed for that character after use.
