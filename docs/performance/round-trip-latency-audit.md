# Round-trip latency audit — 2026-10-30

## Summary

Production gameplay latency is dominated by sequential PostgreSQL round trips,
not by load, replay or serialization. The 2026-10-26 production trace recorded a
move at 21.6 SQL statements and 574 ms mean server time, and a snapshot at 7.3
statements and 206 ms. Because nearly all of those statements run one after
another, each costs roughly 27 ms. The development database answers `SELECT 1`
in 0.3 ms at p50, which is why the same code feels fast in development.

A single player does not avoid this cost, because it is paid on every request.
Low traffic adds to it: idle pool connections close and must be reopened, and
realtime sockets reconnect about once a minute and trigger a full refresh.

In order of impact, the other contributors are:

1. Post-commit refetch fan-out.
2. Cold pool connections.
3. Periodic realtime resyncs.
4. Background writes to the player's own character stream, which cause
   version-conflict retries.
5. Idle background polling.
6. CPU work on the event loop.

## Scope and method

- Static trace of the HTTP, realtime and scheduler paths at commit `4f55a10`.
- Cross-checked against the existing telemetry in
  [production-vs-development-commands.md](production-vs-development-commands.md),
  [production-action-latency.md](production-action-latency.md) and
  [gameplay-latency.md](gameplay-latency.md).
- Public documentation for classic MUD engines and the hosting stack (see
  Sources).
- No production queries, writes, load tests or deployments.
- No local reproduction: the audit machine had no PostgreSQL available.

## Hosting topology

Replit's documentation gives three relevant facts:

- Since 2025-12-04, development databases have run on Replit's own Helium
  service, alongside the app.
- Production databases are provisioned through Neon, which offers only AWS
  regions.
- Replit's own infrastructure runs on Google Cloud.

Production queries therefore most likely cross between clouds. This is an
inference: neither region is documented. It is consistent with the measured gap
of about 27 ms per simple statement in production versus under 1 ms in
development.

## How MUD servers keep commands fast

- **In-memory world, one process.** DikuMUD descendants keep all world and
  player state in memory. tbaMUD runs 10 loop passes per second and ROM runs 4.
  Each pass:
  - reads sockets with `select()`;
  - runs at most one queued command per player, honoring wait states;
  - runs timers such as combat rounds and zone resets;
  - flushes output.
- **Disk only at set moments.** State is loaded at boot and saved at
  checkpoints: on quit, and on autosave (every 5 minutes in tbaMUD). A command
  costs network time plus at most one loop pass. The crash-loss window is one
  autosave interval.
- **The same pattern in other engines.**
  - LPMud drivers run `heart_beat()` and `call_out` timers over in-memory
    objects and persist with `save_object()`.
  - Ranvier (Node.js) keeps players and areas in memory and saves to JSON
    files.
  - Evennia writes through its ORM, but its idmapper cache turns reads into
    memory lookups.
- **Durable systems use a single writer.** LMAX journals each input and applies
  it to in-memory state on one thread. Akka Persistence persists an event, then
  applies it, with one active instance per entity. Either way, a command costs
  one durable write and no database reads.

This codebase keeps a durable event log, which suits its idempotency and audit
guarantees. However, it sends every read back to PostgreSQL to confirm
freshness. The rule requiring that is recorded in
[gameplay-replay-policy.md](../../.agents/memory/gameplay-replay-policy.md).

## Where a move spends its time

The table below estimates the sequential round trips for `POST /api/commands`
with `character.move` at `4f55a10`. Parallel branches count once.

| Stage | Round trips | Notes |
|---|---:|---|
| Account identity | 1 | Guest session or Clerk profile lookup |
| Active world session | 1 | |
| Command guards | 2 | Stream revisions, then batched tails; team-combat info runs in parallel |
| Receipt pre-check | 1 | Repeated inside the append transaction |
| Plugin reads | 0–2 | Revision checks on any shared streams the handler reads |
| Append transaction | 9–10 | `BEGIN`, command lock, receipt, stream locks, heads, events and receipt, effects, room state, `COMMIT` |
| Movement projection | 2–3 | Describe reads in parallel, catalog revision, then occupants |
| **Total** | **16–20** | **About 430–540 ms at 27 ms per round trip** |

The 2026-10-26 production build measured about 22 statements per move. Later
commits removed one or two sequential reads (see below). The append transaction
and the per-read revision checks still account for most of the time.

## Findings

| # | Problem | Where | Effect |
|---|---|---|---|
| 1 | Every stream read checks the database revision first, even on a cache hit. The append runs 9–10 statements in one transaction. Identity, session, receipt and location-group catalog lookups run on every request. | [postgres-event-store.ts:263](../../apps/server/src/persistence/postgres-event-store.ts#L263), [postgres-event-store.ts:447](../../apps/server/src/persistence/postgres-event-store.ts#L447), [engine.ts:351](../../packages/engine-core/src/engine.ts#L351), [location-group-store.ts:51](../../apps/server/src/location-group-store.ts#L51), [index.ts:342](../../apps/server/src/index.ts#L342), [index.ts:370](../../apps/server/src/index.ts#L370) | Most of a move's server time |
| 2 | Every commit fans out (see the sequence below). | [index.ts:396](../../apps/server/src/index.ts#L396), [App.tsx:1041](../../apps/web/src/App.tsx#L1041), [App.tsx:1044](../../apps/web/src/App.tsx#L1044), [App.tsx:1224](../../apps/web/src/App.tsx#L1224) | About 30 extra statements per action, competing with the player's next action |
| 3 | The pool uses node-postgres defaults: idle clients close after 10 s, `min` is 0, TCP keepalive is off and there is no connection timeout. Reopening a connection costs about 6–7 round trips (TCP, TLS, startup and SCRAM authentication). There is no `pool.on('error')` listener, and the LISTEN connection permanently holds one of the 10 clients. | [db/client.ts:15](../../apps/server/src/db/client.ts#L15), [realtime-notifications.ts:10](../../apps/server/src/realtime-notifications.ts#L10) | Likely source of the 170–300 ms "pool wait" logged while the pool was not saturated; an error on an idle client can terminate the process |
| 4 | Realtime sockets close when their view expires. For guests that is 60 s after the last refresh; for signed-in players it is when the Clerk session token captured at upgrade expires (about a minute). Each reconnect sends `resync_required`, which marks every client watcher dirty. | [index.ts:423](../../apps/server/src/index.ts#L423), [realtime-gateway.ts:70](../../apps/server/src/realtime-gateway.ts#L70), [realtime.ts:63](../../packages/client-sdk/src/realtime.ts#L63) | About six HTTP refetches (roughly 40–60 statements, including the gateway's own read) per connected player per minute |
| 5 | After each heartbeat, if any vital is below maximum, the stamina scheduler appends `character.vital_recovery_settled` to the online character's stream. A player command sent with the previous revision then fails with `VERSION_CONFLICT`. Moves and road steps retry up to three times, each retry costing a snapshot and a full command, and the move handler fetches one more snapshot after a final conflict. Movement already settles recovery itself when it runs. | [stamina-recovery-scheduler.ts:70](../../apps/server/src/stamina-recovery-scheduler.ts#L70), [client-sdk index.ts:1067](../../packages/client-sdk/src/index.ts#L1067), [App.tsx:2324](../../apps/web/src/App.tsx#L2324), [movement.ts:88](../../packages/plugins/src/movement.ts#L88) | Intermittent: about 0.8 s per retry, and up to about 3 s of server time for a move that exhausts its retries |
| 6 | With no players online, the schedulers make about 16 database round trips per second. Each empty effects check is a three-statement transaction, per world, every second. Room chat waits for an effects pass across every world. | [index.ts:213](../../apps/server/src/index.ts#L213), [index.ts:253](../../apps/server/src/index.ts#L253), [postgres-event-store.ts:788](../../apps/server/src/persistence/postgres-event-store.ts#L788), [index.ts:871](../../apps/server/src/index.ts#L871) | Constant pool occupancy and database load |
| 7 | CPU on the request path: every look and snapshot deep-copies the world's full item state with `structuredClone`. A changed item stream is re-projected from its full history. Full projections are schema-parsed more than once per snapshot. | [world-items.ts:560](../../packages/plugins/src/world-items.ts#L560), [index.ts:473](../../apps/server/src/index.ts#L473), [index.ts:560](../../apps/server/src/index.ts#L560) | Event-loop delay of 31–47 ms at p95 in production logs |

The fan-out in finding 2 runs as follows:

1. The `game_events` trigger notifies the realtime gateway, which reruns about
   10–14 queries for each affected socket.
2. The client refetches `/api/game` on the `character` invalidation, even
   though moves already return that projection.
3. The client sends a heartbeat on the `presence` invalidation and refetches
   chat.
4. Non-movement actions also fetch a snapshot explicitly after the command,
   then fetch again when the invalidation arrives.

Lower priority: the realtime trigger compares `character_id::text` with the
stream ID
([0009_realtime_wakeups.sql:28](../../apps/server/drizzle/0009_realtime_wakeups.sql#L28)).
The cast prevents use of the primary-key index, so each character event scans
the world's room-state rows. That cost grows with every character created,
including guests.

## Ruled out

- **Replay:** under 2 ms at p95 in the production slow-request logs.
- **JSON serialization:** about 1 ms.
- **Nagle's algorithm:** Node's HTTP server, `ws` and `pg` all set
  `TCP_NODELAY`.
- **Neon scale-to-zero during play:** Neon suspends after 5 minutes without
  activity by default, and the schedulers query the database every second.

## Changes since the measured production build

The 94 commits from `4bad2dc` to `4f55a10` were reviewed for effects on this
audit:

- `readStreams` now fetches the tails of several streams in one query. It still
  runs the revision query first.
- `location.describe` loads NPC positions, shared items and temporary campfires
  in parallel. This removes one or two sequential reads from each look and
  snapshot.
- The append now records per-stage timings (`event_store.append.*`), which will
  help verify the changes below.
- Moves and road steps now retry version conflicts up to three times. The move
  handler also refetches a snapshot after a final conflict (finding 5).
- A development sample observed a 265 ms write `COMMIT` with under 1 ms of pool
  wait
  ([performance-benchmarking.md](../../.agents/memory/performance-benchmarking.md)).
  Reducing the statement count does not remove commit acknowledgment time.

None of these commits changes the pool configuration, the append statement
count, the per-read revision checks, the realtime fan-out or the stamina writer.

## Recommendations

Measure each change with the existing `?muddTrace=1` traces against the
development database before publishing.

### Quick wins

1. **Pool configuration.** Change [db/client.ts](../../apps/server/src/db/client.ts)
   to use:
   - an idle timeout of several minutes;
   - a `min` of 2–4;
   - `keepAlive: true`;
   - a connection timeout;
   - a `pool.on('error')` listener.

   Move LISTEN to a dedicated client outside the pool. First, confirm the
   cold-connection hypothesis by logging each pool `connect` event with a
   timestamp.
2. **Duplicate refetches.** Include the character revision in the `character`
   invalidation, so the client can skip `/api/game` when it already has that
   revision. Return the projection with every command response, as moves
   already do.
3. **Two fewer lookups.** Cache the location-group catalog in memory, since this
   process is its only writer. Start the occupants query alongside the describe
   and stats queries instead of after them.
4. **Effects worker.** Claim effects with a single `UPDATE … RETURNING`
   statement and wake the worker with NOTIFY instead of polling. Stop making
   chat wait for an effects pass across every world.
5. **`CLERK_JWT_KEY`.** Set it so session tokens are verified without network
   access. Without it, Clerk refetches its signing keys after each idle gap of 5
   minutes or more.

### Larger changes

6. **Single-call append.** Move the append transaction into one PL/pgSQL
   function call, reducing 9–10 round trips to 1. Under `READ COMMITTED`, a
   volatile function takes a fresh snapshot for each statement, so the
   post-lock receipt lookup still sees concurrent commits. Commit durability is
   unchanged.
7. **Single-writer stream cache.**
   - Hold a session advisory lock as a writer lease.
   - Evict cache entries using the existing NOTIFY payloads.
   - Fall back to today's revision checks when the lease is not held.

   The append still verifies revisions under lock, so a stale cache can cause a
   retry but not a lost update. This requires revising the rule in
   `gameplay-replay-policy.md`.
8. **Identity and session caching.** Cache per player. Invalidate on world
   entry, world exit and guest-account claim.
9. **Socket re-authentication.** Let clients refresh credentials over the open
   socket, or resume with their last-known channel state, instead of a full
   resync every minute.
10. **Lazy vital recovery.** Stop timer-driven settle writes. Commands settle
    recovery when they run, as movement already does. The client projects
    current vitals from `lastSettledAt` using the shared
    `resolveVitalRecovery`.

With items 6–9 in place, a move should need about 2–3 round trips: roughly
50–80 ms of server time at the current database latency, compared with about
575 ms measured.

### Structural direction

- Run one authoritative in-memory world per process.
- Append one durable event batch per command.
- Serve reads from memory.
- Push state over the WebSocket instead of invalidating and refetching.

If the code changes are not sufficient, the remaining option is a PostgreSQL
instance in the same cloud and region as the application server. That is an
infrastructure change and needs its own review.

## Verification and limits

- Statement counts and timings come from existing telemetry and static tracing.
  No local reproduction was run.
- Check the following in Replit before acting:
  - The production database host and region.
  - Whether `DATABASE_URL` uses a `-pooler` endpoint. Neon's PgBouncer pooler
    runs in transaction mode and does not support LISTEN/NOTIFY.
  - The Reserved VM size. A shared fractional vCPU would amplify finding 7.
  - Whether `CLERK_JWT_KEY` is set.
  - The publishing geography, which cannot be changed after publishing.
- The cold-connection explanation for pool wait is an inference.
- Pool options and hosting details come from vendor documentation, not from
  inspecting the installed packages.
- No production database queries, writes, load tests or publishing actions were
  performed.

## Data retention

The event log has no deletion path, so guest histories and chat are kept
indefinitely. A retention plan is advisable. The usual approach for event stores
is to encrypt personal data per subject and delete the key when the data must be
erased.

## Sources

- tbaMUD loop and timers:
  [structs.h](https://raw.githubusercontent.com/tbamud/tbamud/master/src/structs.h),
  [comm.c](https://raw.githubusercontent.com/tbamud/tbamud/master/src/comm.c),
  [config.c](https://raw.githubusercontent.com/tbamud/tbamud/master/src/config.c)
- ROM 2.4:
  [merc.h](https://raw.githubusercontent.com/MUDOmnibus/Rom24b6-for-GCC4/master/src/merc.h),
  [update.c](https://raw.githubusercontent.com/MUDOmnibus/Rom24b6-for-GCC4/master/src/update.c)
- LPC driver cycle:
  [Intermediate LPC, chapter 2](https://www.lysator.liu.se/~cardeci/export/html/lpc-man/intermediate/chapter2),
  [MudOS save_object](https://lysator.liu.se/mud/MudOS-doc/efuns/filesystem/save_object.3)
- Evennia:
  [Typeclasses](https://www.evennia.com/docs/latest/Components/Typeclasses.html),
  [Async process](https://www.evennia.com/docs/latest/Concepts/Async-Process.html)
- Ranvier:
  [PlayerManager](https://raw.githubusercontent.com/RanvierMUD/core/master/src/PlayerManager.js)
- Single writer:
  [LMAX architecture](https://www.martinfowler.com/articles/lmax.html),
  [Akka Persistence](https://doc.akka.io/libraries/akka/current/typed/persistence.html)
- Replit:
  [production databases](https://docs.replit.com/cloud-services/storage-and-databases/production-databases.md),
  [database upgrade (Helium)](https://docs.replit.com/cloud-services/storage-and-databases/database-upgrade),
  [deployments](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments.md),
  [publishing geography](https://docs.replit.com/features/publishing/publishing-geography.md)
- Neon:
  [regions](https://neon.com/docs/introduction/regions),
  [scale to zero](https://neon.com/docs/introduction/scale-to-zero),
  [connection pooling](https://neon.com/docs/connect/connection-pooling),
  [connection latency](https://neon.com/docs/connect/connection-latency)
- node-postgres: [pool](https://node-postgres.com/apis/pool)
- Clerk:
  [authenticateRequest](https://clerk.com/docs/reference/backend/authenticate-request)
- PostgreSQL:
  [function volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html),
  [PL/pgSQL](https://www.postgresql.org/docs/current/plpgsql-overview.html)
