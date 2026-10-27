# MUDD feature implementation plan — Generic object lifecycle and corpse decay

**Goal / user-observable behavior:** Corpses decay on authored schedules; expired NPC loot is destroyed or left in the room according to policy, and unclaimed player death drops return to their owner. Players receive room and terminal updates.
**Existing repo findings:** Corpses and shared items already use the `world-items` stream. Character inventory remains character-stream owned. Durable effects support idempotent cross-stream receipts. Realtime room refreshes and terminal room events already exist.
**Owning plugin/capability:** Core `objectLifecyclePlugin` owns per-object lifecycle state; `corpseLifecyclePlugin` owns corpse expiry policy; `worldItemsPlugin` remains authoritative for shared corpse contents.
**Assumptions and deferred scope:** Legacy corpses without timestamps remain unexpired and replay unchanged. The indexed SQL table is only a projection. No additional temporary object type is scheduled in this change.

## Contract changes

- New trusted system command: `world.object.expire` v1; only the scheduler may dispatch it.
- Queries: existing room and object inspection projections hide expired corpses and return decay-stage descriptions.
- Events: per-object lifecycle schedule/reschedule/cancel/expiring/expired events; shared corpse expiration event; all outcomes are persisted and replayable.
- World content: optional lifecycle defaults and NPC/road-encounter overrides with validated timing and policies.

## Boundary map

- Core/ports touched: event-store companion writes and system-command dispatch.
- Plugin(s) touched: generic lifecycle, corpse lifecycle, shared world items, character room/take projections.
- Persistence/migration touched: indexed due-work projection with leases; migration 0010.
- Client SDK / PWA / TTY impact: no command API changes; existing terminal-event delivery receives lifecycle announcements.
- Operational / networking impact: server scheduler polls indexed due rows, with leased claims and retries; no new socket protocol.

## Invariants and failure paths

- Aggregate/version/transaction boundary: lifecycle is per object; corpse content stays in the shared world-items stream; player recovery is an atomic companion character-stream write.
- Duplicate/retry and disconnect behavior: stable effect IDs, event-store command receipts, item claim reservations, and lease recovery prevent duplicate loot or announcements.
- RNG/clock/replay considerations: timestamps are authored by server command context and stored in events; no replay-time clock or random calls.
- Abuse/authorization and hidden-info boundaries: expiration is a system-only command; expired corpses and their contents disappear from player queries and cannot be claimed.

## Steps

1. Define lifecycle and corpse schemas and transition tests. **Done**
2. Implement generic lifecycle and separate corpse policy plugins. **Done**
3. Add the indexed persistence projection, leased scheduler, and migration. **Done**
4. Wire corpse creation/expiration announcements into existing room chat and terminal-event delivery. **Done**
5. Cover replay, corpse contents, currency drop, concurrency, and room visibility; run checks. **In progress**
6. Update architecture docs and ADR. **Done**

## Acceptance criteria

- [x] Player death preserves the existing one-item penalty and places the item in a player corpse.
- [x] NPC corpse lifetime defaults and world/creature overrides are server-authoritative.
- [x] Empty corpses receive the shorter expiry when their last loot is taken.
- [x] Destroy, drop, and recovery-storage policies preserve the expected item/currency outcome.
- [x] Due work is persisted in the indexed database projection and claimed through leases.
- [ ] PostgreSQL-backed worker restart and expired-lease recovery are verified by integration tests.
- [x] Expired corpses cannot be inspected or looted; visible corpses show decay stages.
- [x] Corpse creation and expiry are announced through existing room and terminal delivery.
- [x] Build, tests, type checks, and development migration are reported.
