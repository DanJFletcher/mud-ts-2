# MUDD feature implementation plan — Single-writer stream cache

**Status:** Proposed; not started. Source: [round-trip latency audit](../performance/round-trip-latency-audit.md), recommendation 7. Once accepted, it supersedes the per-read head check in [ADR 0033](../adr/0033-immutable-character-replay-checkpoints.md).

**Goal / user-observable behavior:** While the server process is the only writer, cached stream reads skip the per-read revision query. That removes about 4–6 round trips from a move and 2–3 from a snapshot: roughly 110–160 ms and 55–80 ms at 27 ms each. Players notice only the speed.

**Existing repo findings:**
- `readStream` always queries the stream head before using the cache ([postgres-event-store.ts:272](../../apps/server/src/persistence/postgres-event-store.ts#L272), via `readStreamRevision` at [postgres-event-store.ts:253](../../apps/server/src/persistence/postgres-event-store.ts#L253)). `readStreams` runs a revisions query first ([postgres-event-store.ts:289](../../apps/server/src/persistence/postgres-event-store.ts#L289)). The only exception is a read already satisfied by the per-command scoped cache.
- ADR 0033 (accepted) states that every stream read checks its indexed head, and that multiple processes always check heads. [gameplay-replay-policy.md](../../.agents/memory/gameplay-replay-policy.md) records the same rule.
- The architect skill already requires a single writer for each world-state aggregate ([SKILL.md](../../.agents/skills/mudd-architect/SKILL.md)).
- Every write in the server goes through `PostgresEventStore.append`. On commit it extends the cache, or evicts companion streams ([postgres-event-store.ts:235](../../apps/server/src/persistence/postgres-event-store.ts#L235)). The schedulers and the effects worker run in the same process.
- The `game_events` trigger sends a post-commit NOTIFY for every insert ([0009_realtime_wakeups.sql](../../apps/server/drizzle/0009_realtime_wakeups.sql)). It carries the world and a routing hint (a character ID, room ID or shared-stream kind). It does not always carry the stream ID, and it never carries the stream version or the writer.
- A second writer can exist briefly. One case is a deploy overlap, which Replit does not document. Another is running the production start command beside the development server against the same database ([deployment-packaging.md](../../.agents/memory/deployment-packaging.md)).

**Owning plugin/capability:** The PostgreSQL adapter and server wiring in `apps/server`. No plugin or contract changes.

**Assumptions and deferred scope:**
- The production `DATABASE_URL` is a direct endpoint, not a pooler. Session advisory locks and LISTEN do not work through Neon's PgBouncer pooler.
- Scaling out to several processes, each owning part of the world, is deferred. This plan makes one writer fast and keeps any other writer correct.
- The location-group catalog cache (audit quick win 3) can reuse the same lease, but it is planned there, not here.

## Contract changes

- Commands, queries, events and the SDK: none.
- NOTIFY payload: add `streamId`, `streamVersion` and `writerId` for every `game_events` insert. The change is additive, and the realtime gateway ignores unknown fields.

## Boundary map

- Core/ports touched: none. The store gains an injected freshness mode, either `trusted` or `verify`.
- Plugin(s) touched: none.
- Persistence/migration touched:
  - a migration updating `mudd_realtime_wakeup()` with the new payload fields;
  - pool connections set `application_name` to a per-process writer ID, which the trigger reads.
- Client SDK / PWA / TTY impact: none.
- Operational / networking impact: one extra dedicated connection per process for the lease. Schedulers run only in the lease holder.

## Design

- **Lease:**
  - At startup, a dedicated `pg.Client` with keepalive, outside the pool, calls `pg_try_advisory_lock` on a fixed lease key. The process that holds the lock is the designated writer.
  - The lock is released automatically if the connection or the process dies.
  - A process without the lease retries on an interval.
  - If a lease cannot be attempted at all (for example, through a pooler), keep today's behavior: verify mode, schedulers on, and an error log.
- **Trusted mode:**
  - Requires both the lease and a healthy LISTEN connection.
  - A cached stream is served without a revision query.
  - A cache miss reads only the rows: one round trip instead of two.
- **Verify mode** is today's behavior. A process enters it whenever it lacks the lease or its LISTEN connection drops, and at that moment it stops trusting every cached entry.
- **Coherence:**
  - On a notification whose `writerId` belongs to another process, the holder evicts that stream from its cache.
  - The holder ignores its own notifications, because `append` has already updated the cache.
- **Schedulers** start only in the lease holder: stamina, NPC, object lifecycle, interactions and effects. This also prevents duplicate scheduler writes during a deploy overlap.

## Invariants and failure paths

- **Commands stay safe with a stale cache.** `append` still re-checks every expected revision under advisory locks. A stale read can cause a `VERSION_CONFLICT` and a retry, but never a lost update.
- **Read staleness is bounded.** It lasts only as long as notification delivery from another writer, and another writer exists only while a second process runs. Queries remain read-only.
- **Room-model checks are unchanged.** They keep their in-SQL head comparison ([ADR 0034](../adr/0034-room-read-model-and-realtime-invalidations.md)).
- **All event inserts go through `append`.** Add a check that fails the build on direct `game_events` inserts outside the adapter and migrations.
- **Loss of lease or LISTEN is handled before the next read.** The process switches to verify mode first and logs the reason.

## Steps

1. Write the ADR. It covers the single-writer lease, the trusted and verify modes, the bounded-staleness rule, and the supersession of ADR 0033's per-read head check. Update `gameplay-replay-policy.md` when the ADR is accepted.
2. Write the migration that extends the NOTIFY payload, and set `application_name` on each pool connection.
3. Implement the lease client and its health tracking in `apps/server`, and start schedulers only when the lease is held.
4. Add the freshness mode to `PostgresEventStore`:
   - skip the revision query for cached streams in trusted mode;
   - read only rows on a cache miss;
   - evict streams on notifications from another writer.
5. Add PostgreSQL integration tests that use two store instances:
   - lease exclusion between the two;
   - a foreign write evicts the holder's entry, and the holder's next read sees it;
   - LISTEN loss and lease loss each fall back to verify mode;
   - a stale cached read followed by a command yields a conflict and no lost update;
   - a cold cache after restart reads correctly.
6. Run the full suite with trusted mode on and off. In development traces, `event_store.stream_revision_lookup` and `event_store.stream_revisions_lookup` should drop to zero for warm moves and snapshots.

## Acceptance criteria

- [ ] Warm moves and snapshots in trusted mode issue no stream revision queries.
- [ ] Two-process integration tests show convergence after a foreign write and no lost updates.
- [ ] Verify mode passes the existing suite unchanged.
- [ ] Schedulers run in exactly one process.
- [ ] The ADR is accepted, and ADR 0033 and the memory note are updated.

## Rollout and rollback

Ship behind `MUDD_TRUSTED_STREAM_CACHE=1`. Without the flag, every process stays in verify mode, which is today's behavior. To roll back, unset the flag; the new payload fields are additive and harmless.
