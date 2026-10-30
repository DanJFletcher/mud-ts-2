# MUDD feature implementation plan — Single-call event append

**Status:** Implemented behind `MUDD_SINGLE_CALL_APPEND` ([ADR 0039](../adr/0039-single-call-event-append.md)). Optional step 5 (a lazy receipt lookup in the engine) is not done. Source: [round-trip latency audit](../performance/round-trip-latency-audit.md), recommendation 6.

**Goal / user-observable behavior:** Every eligible command commits in one database round trip instead of 9–10. At the measured production latency of about 27 ms per round trip, this removes roughly 220–240 ms from each move and from every other command. Gameplay, receipts and events are unchanged.

**Existing repo findings:**
- `PostgresEventStore.append` ([postgres-event-store.ts:447](../../apps/server/src/persistence/postgres-event-store.ts#L447)) runs one transaction in which every step is its own statement and round trip:
  - `BEGIN`;
  - the command advisory lock, then the receipt lookup;
  - the ordered stream locks, then the head check;
  - the events-and-receipt CTE, then durable effects and side-table writes;
  - the room-state refresh ([postgres-event-store.ts:76](../../apps/server/src/persistence/postgres-event-store.ts#L76));
  - `COMMIT`.

  Production traces counted 9–10 statements per append.
- The lock and the receipt lookup are separate on purpose. A single statement keeps the snapshot it took before waiting on the lock, so it can miss a concurrent duplicate's receipt ([postgres-command-idempotency.md](../../.agents/memory/postgres-command-idempotency.md)).
- `EngineHost.dispatch` also looks up the receipt before running the handler ([engine.ts:351](../../packages/engine-core/src/engine.ts#L351)). That is one more round trip outside the transaction, and `dispatchSystem` does the same ([engine.ts:456](../../packages/engine-core/src/engine.ts#L456)).
- Per-stage append timings (`event_store.append.*`) already exist and give a direct before-and-after measure.
- `postgres-event-store.integration.test.ts` covers idempotency, concurrent duplicates, companions, guards and effects against real PostgreSQL. CI provisions PostgreSQL 16.

**Owning plugin/capability:** The PostgreSQL adapter behind `EventStorePort.append`. No plugin changes are needed. The optional receipt change in step 5 touches `engine-core`.

**Assumptions and deferred scope:**
- **Isolation level.** The function runs under `READ COMMITTED`, the server default. In a `VOLATILE` PL/pgSQL function, each statement takes a fresh snapshot, which preserves lock-then-read ordering. This must be proven with concurrent PostgreSQL tests before the fast path is enabled.
- **Fast-path eligibility.** An append qualifies only if both of these hold:
  - its room-state rows can be computed in the application from a cache that matches the expected version;
  - it contains no side-table events (`character.created`, `character.renamed`, `character.archived`, `character.restored` or `world.object_lifecycle_*`).

  Every other append keeps the current transaction. Moving those side writes into the function is deferred.
- **Unchanged.** `fsync`, `synchronous_commit` and the `game_events` NOTIFY trigger stay as they are. Commit acknowledgment time remains; development has observed write commits of up to 265 ms.

## Contract changes

- Commands, queries and events: none.
- `EventStorePort`: none.
- New SQL function `mudd_append_command_v1`, added by an additive migration.
  - **Inputs** (as `jsonb` parameters): command identity, stream IDs with expected versions, event rows, the receipt, effects and precomputed room-state rows.
  - **Output** (one row): the outcome (`committed`, `duplicate` or `conflict`) and the stream ID, plus the prior receipt and events for duplicates and the observed revisions for conflicts.

## Boundary map

- Core/ports touched: none, except `EngineHost.dispatch` and `dispatchSystem` if step 5 is taken.
- Plugin(s) touched: none.
- Persistence/migration touched: a new manual SQL migration that creates the function. It changes no Drizzle-managed table, but the migration journal must stay consistent ([drizzle-snapshot-discipline.md](../../.agents/memory/drizzle-snapshot-discipline.md)).
- Client SDK / PWA / TTY impact: none.
- Operational / networking impact: one statement per eligible append. An environment flag selects the path.

## Invariants and failure paths

- **Lock order:** the command identity lock comes first, then the stream locks in sorted order, exactly as today.
- **Receipt lookup:** a separate statement after the command lock, so it sees any duplicate that committed while this call waited.
- **Revision checks:** expected revisions for the primary stream, companions and guards are checked after the stream locks. A mismatch returns `conflict` without writing.
- **Atomicity:** events, receipt, effects and room-state rows commit in the function call's single implicit transaction, and any exception rolls everything back. The unique `(world_instance_id, stream_id, stream_version)` index stays as the last guard.
- **Duplicates:** a duplicate returns the original receipt and events. A reused command ID with a different payload returns the existing `INVALID_COMMAND` conflict.
- **Cache updates:** the application updates its stream cache only after a `committed` result, as today.
- **Deploys:** the function is additive. Old code ignores it, and new code can fall back to the transaction path.

## Steps

1. Extend `postgres-event-store.integration.test.ts` so every append case runs against both paths: duplicate, payload conflict, version conflict, guard conflict, companion atomicity, effects deduplication, room-state rows and NOTIFY payloads.
2. Add a concurrency test that races two identical commands through the function. It must assert one committed event set and identical receipts and event IDs. This is the gate the idempotency note requires.
3. Write the migration for `mudd_append_command_v1` as `VOLATILE` and `SECURITY INVOKER`, with a fixed `search_path`.
4. In `PostgresEventStore.append`, add the fast path behind `MUDD_SINGLE_CALL_APPEND=1`. Include the eligibility check, a stage named `event_store.append.single_call` and a fallback counter.
5. Optional: drop the pre-handler receipt lookup on the success path.
   - Look up the receipt only when the handler fails with a rule violation or version conflict, and return the original receipt if one exists.
   - The in-transaction check still catches every duplicate.
   - Add a test that retrying a committed move returns its original receipt.
6. Run the store unit tests, the PostgreSQL integration suite on a temporary database, typecheck and lint. Then compare `?muddTrace=1` traces in development for append statements per move, append stage time and fallback rate.
7. Write the ADR for the server-side append procedure, linking the idempotency note.

## Acceptance criteria

- [ ] Eligible appends issue one statement, confirmed by traced statement counts.
- [ ] Every event-store integration test passes on both paths.
- [ ] Concurrent duplicate commands produce one event set and identical receipts.
- [ ] Durability settings are unchanged.
- [ ] The fallback rate is measured and reported.
- [ ] Disabling the flag restores current behavior without a migration rollback.

## Rollout and rollback

1. Ship the migration and code with the flag off.
2. Enable the flag in development and compare traces.
3. Enable it in production.

Roll back by turning the flag off. The function can stay in place, because nothing calls it while the flag is off.
