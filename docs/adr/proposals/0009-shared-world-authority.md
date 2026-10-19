# ADR proposal 0009: Authority and ownership for shared world state

- **Status:** Proposed; awaiting review. Not accepted.
- **Date:** 2026-10-19
- **Scope:** Ownership boundaries only. No implementation or migration is authorized by this proposal.

## Context

The current engine commits gameplay facts to a character stream. That is a good fit for personal inventory, quest progress, wallet, health, equipment, and character-scoped PvE. It is not sufficient authority for a unique item, shared NPC health, shared stock, or other mutable entity observed by multiple characters: two character streams could independently claim incompatible versions of the same fact.

The existing decisions remain in force:

- One account may manage multiple characters.
- A world session is bound to one character, and at most one character per account may be active in a world instance.
- Current takeables, wallet, combat, and progression remain character-scoped unless a later decision explicitly changes them.
- Room chat stays in its separate feed under ADR 0003.

## Proposed ownership model

| State | Proposed owner | Write authority / projection rule |
|---|---|---|
| World definitions, room layouts, exits, NPC templates, item definitions, shop listings | Versioned immutable world content | Content is validated and selected by the server. Runtime play never edits a definition in place. |
| World instance identity and instance configuration | World-instance record/configuration | Identifies an isolated running copy of content. It does not become one giant event stream for all gameplay facts. |
| Personal character facts | Character aggregate | Character stream remains authoritative for character identity, personal quest progress, personal wallet, health, gear, personal encounters, and intentionally character-instanced items. |
| Unique mutable item instance | A world-instance-scoped item aggregate/stream | One stable instance ID has one authoritative holder state: a location or one character. Pickup/drop are version-checked ownership transitions. Character inventories and room-visible items are read projections of the same item facts, not a second writable ownership record. |
| Shared mutable NPC or other entity state | A separately scoped entity aggregate, if required | A specific NPC instance owns its changing health/state; immutable NPC definitions remain in the world pack. Do not add this state until shared behavior is a product requirement. |
| Current room occupancy | Projection of active world sessions plus committed character locations | Read-only derived state initially. Do not write an independent occupant list that can drift from session and movement facts. |
| Public room chat | Existing `(world instance, room)` feed | Keep the independent durable ordering and membership rules in ADR 0003; chat is not a duplicate of character or item ownership. |

### Command and consistency rule

For a shared item, the item aggregate is the single authority. A pickup command checks the instance ID, current location, world instance, actor's active character/session, and expected item revision, then atomically commits the holder transition and command idempotency receipt. Two characters racing for the same item can produce only one successful transition. The other receives a safe conflict/unavailable result and refreshes its view.

The first implementation should avoid dual-writing the item stream and character stream. A character inventory query may merge personal character-owned items with shared item instances held by that character. If the product later requires a durable per-character inventory index, it must be explicitly rebuildable and non-authoritative.

Commands that genuinely require facts from more than one mutable aggregate need a defined PostgreSQL transaction/locking protocol, stable lock order, idempotency, and a clear failure boundary before implementation. Client-side sequential writes are not an acceptable consistency mechanism.

## Options considered

1. **Per-entity shared aggregates (recommended proposal):** shared item/NPC facts have one authoritative owner and focused contention. Read models join the relevant streams. The store/query layer grows more capable, but command ownership stays clear.
2. **One aggregate for the entire world instance:** simpler global ordering, but unrelated play contends on one stream and replay/locking grows with the world. Not recommended.
3. **Dual-write the world entity and character streams:** convenient projections, but creates cross-stream partial-commit risk unless the database operation is atomic and lock ordering is formalized. Not recommended as the initial model.
4. **Mutate world definitions for live state:** rejected. Static content would become play-state storage and leak changes across instances.
5. **Keep all items character-instanced:** remains the default until shared item behavior is explicitly approved. It is the simplest correct current behavior.

## Benefits, complexity, and migration risk

- **Benefit:** A shared fact has one authoritative event history, so retries and concurrent players cannot create two owners for one item.
- **Complexity:** Commands and reads must address more than one aggregate family; shared inventory and room descriptions need a stable projection strategy; PostgreSQL concurrency tests become mandatory.
- **Migration risk:** Existing item events do not identify globally unique world-owned instances. They must not be silently reinterpreted. A future implementation needs explicit classification of content as personal-instance or unique-shared, stable IDs, and a migration/backfill policy. Existing character event history must remain replayable.
- **Compatibility:** The proposal does not change the current API, persistence model, or gameplay. Any accepted implementation would be separately planned and versioned.

## Decisions still needed before acceptance

1. Which initial content, if any, needs one physical instance shared by all characters in a world instance?
2. Should shared items be modeled as a distinct aggregate per item, or as partitions of a world-instance inventory aggregate?
3. What read consistency is required when a room description combines a character snapshot with shared entity streams?
4. Is room occupancy only a read-time projection from active sessions, or does a later feature require durable presence/expiry semantics?
5. Which store port API supports atomic appends and receipts for these aggregates without changing personal character-stream behavior?

## Non-goals

- No shared item, NPC, economy, combat, presence, party, or world aggregate implementation.
- No change to one-active-character-per-world-session.
- No migration, deletion, or rewriting of existing event data.
- No change to ADRs 0002–0008 unless a later accepted decision supersedes them.
