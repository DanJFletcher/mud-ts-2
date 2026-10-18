# ADR 0002: Ownership of world items and shared state

- **Status:** Accepted for the current character-instanced item model; shared item aggregates are deferred.
- **Date:** 2026-10-18

## Context

The current demo treats takeable items as character-owned instances. A character's event stream records taking, dropping, and using its items. This is sufficient for personal exploration, but it does not establish who owns an item when multiple characters in one world can see and take the same physical object.

Changing room content or inventory state to be shared without defining that ownership would allow two character streams to claim the same item, or make a restarted projection disagree with the room.

## Decision

Do not change item ownership or shared world state as part of this audit remediation. The current item behavior remains character-instanced.

Before introducing shared physical items, use the following ownership boundaries:

- An item definition belongs to immutable world content.
- A unique item instance belongs to the world-instance aggregate, with a stable instance ID and a single authoritative holder state: a location or one character.
- Taking and dropping are ownership transitions of that item instance. Character inventory and room-visible items are projections of those transitions, not independent writable state.
- A transition must atomically update the authoritative item stream and its command receipt. Cross-stream consistency must be implemented with a defined transaction boundary or a durable process/outbox; a client-side sequence is not sufficient.
- Character movement and character-owned quest progress remain in their character streams.
- Room chat remains separate from item ownership and character progression.

## Consequences

- No migration or behavior change is made to existing character-instanced items.
- A future shared-item feature requires a separate implementation plan, migration strategy, and PostgreSQL concurrency tests for simultaneous pickup, drop, and retry.
- Existing demo item behavior should not be described as globally shared or unique within a world.

## Alternatives considered

- **Mutate room definitions:** rejected because world content is immutable and would make per-instance play state leak into static definitions.
- **Keep writing item possession only to character streams:** rejected for shared items because two characters could both acquire the same unique item.
- **Implement a complete world aggregate now:** rejected because this audit explicitly excludes new gameplay systems and there is no current shared-item requirement to validate.
