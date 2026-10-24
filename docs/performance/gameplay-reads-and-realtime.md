# Gameplay read performance and realtime delivery

## Summary

The slow path was event replay plus database fan-out, not engine command
execution. Chat authorization replayed the player's history on every request;
room presence read many session rows and then replayed each occupant's history.
The solution leaves commands, event ordering, and gameplay state authoritative in
the engine. It adds a transactional room read model, exact-prefix incremental
projections for shared streams, and a client-SDK WebSocket that only signals
when HTTP projections may have changed.

## Baselines and results

Measurements ran on Saturday, 2026-10-24, against an isolated local PostgreSQL
16 test database. They are local service-level results, **not production or
browser latency claims**. The room-read harness uses 30 samples per operation,
2,000-event character histories, and fixtures of 2, 20, and 100 active
characters. Presence fixtures refreshed their heartbeat outside the timed
presence call. They do not model a distributed production database, real user
think-time, or a true concurrent 100-browser load test.

| Local room read | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Chat authorization, 2 characters | 48.7 / 81.8 ms | 3.8 / 7.0 ms |
| Chat authorization, 20 characters | 40.3 / 75.6 ms | 3.7 / 9.3 ms |
| Chat authorization, 100 characters | 51.8 / 88.3 ms | 3.7 / 5.1 ms |
| Presence, 20 characters | 3.1 / 5.8 ms | 1.4 / 2.8 ms |
| Presence, 100 characters | 2,953.7 / 3,514.3 ms | 1.3 / 2.3 ms |

The 100-character baseline presence fixture produced substantial pool and
fan-out pressure; it is a stress-fixture result, not representative of an
ordinary single request in an idle production pool. Post-change presence uses
one SQL query for each room read. The SQL instrumentation's query count was not
reliable for concurrent fan-out in the baseline, so the wall-time measurements
are the comparison used here.

The separate event-history benchmark uses 30 samples at 2,000 events:

| Action + snapshot | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Look | 57.7 / 69.8 ms | 1.8 / 4.5 ms |
| Move | 177.3 / 215.8 ms | 10.3 / 16.1 ms |
| Combat | 197.2 / 249.5 ms | 11.1 / 15.9 ms |
| Offline recovery tick | 57.9 / 93.0 ms | 0 / 0 ms* |

The benchmark's “before” policy deliberately forces the prior full-history
replay behavior; both runs use the same isolated database and action fixture.
The transactionally maintained room model adds write-side work, so production
command latency still needs measurement.
The offline recovery result marked `*` is rounded to whole milliseconds and
used one read total across 30 ticks after the offline session was settled.

### Initial bundle baseline

The attached audit's web-build baseline was **1,044,448 bytes raw JavaScript /
283,782 gzip / 240,318 Brotli**, plus **107,573 raw / 19,766 gzip / 16,879 Brotli
CSS**. The final build measured **1,048,540 raw / 288,030 gzip JavaScript** and
**107,570 raw / 19,820 gzip CSS**. JavaScript grew by 4,092 raw bytes (+0.4%)
and 4,248 gzip bytes (+1.5%) with the realtime SDK integration; Brotli was not
measured after the change. This task did not implement route splitting, lazy
Codex loading, build-time content processing, or new PWA caching policy. The
JavaScript bundle still produces Vite's >500 kB chunk warning.

## Implementation

### Indexed reads and projections

- The new `room_character_states` table stores only the location, archive,
  health, combat-eligibility, identity, and event revision fields needed by
  room checks. It is updated with event commits, rebuilt on startup when stale,
  and checked against the indexed stream head before chat authorization.
- Chat keeps its existing account, session, character ownership, room locking,
  and idempotency protections. It replaces full replay with a revision check and
  minimal room projection.
- Presence joins heartbeat-filtered sessions directly to room state and applies
  the existing same-room, world, TTL, and eligibility rules in SQL.
- Incremental projections only extend adapter-registered immutable histories
  from the exact parent array. Mutable/independent histories still replay from
  the start; callers receive clones or narrowly selected viewer results.
- Interaction inboxes, team encounter lookup, and party activity use
  character/player indexes. Party information now reads the shared group history
  once rather than separately loading it twice.
- Recovery/backfill processes only characters whose model is missing, has an
  unsupported schema version, or trails its event-stream head.

### Realtime transport

- `@mudd/contracts` defines a versioned, strict subscribe/invalidation envelope.
- One SDK transport multiplexes channel watches for chat, presence, interactions,
  parties, cooperative combat, and the active-character snapshot.
- A PostgreSQL trigger emits only post-commit routing metadata for the relevant
  room, character, or shared aggregate. Heartbeat-only updates do not fan out
  invalidations. No domain payload or command is sent over the socket.
- The server re-authenticates on each authorized view refresh, compares only
  subscribed projections, and emits connection-scoped ordered sequence numbers.
- Origin validation, a 1 KiB frame limit, a 500-connection
  process cap, a 64 KiB buffered-output limit, authentication expiry, and
  exponential reconnect backoff are in place.
- Reconnect and sequence gaps force HTTP recovery. Commands, snapshots,
  recovery, and polling fallback remain HTTP. Presence HTTP heartbeat remains
  at 30 seconds to stay inside the 90-second freshness window.

## Tests and verification

- Server: **103 passed, 15 skipped across 20 files** against the isolated
  PostgreSQL database, including event-store, chat, presence, idempotency,
  migration wakeup, and gateway tests.
- Client SDK: **49 tests passed across 7 files**, including realtime transport
  and existing client behavior.
- Engine core: **60 tests passed across 7 files**.
- Core plugins: **14 tests passed across 4 files**.
- TypeScript builds/typechecks passed for contracts, engine core, core plugins,
  SDK, server, and web at the time of the checks.

## Remaining measurement and deployment risks

- No production traffic test or production migration was run as part of the
  benchmark. Compare structured slow-request data after publishing before
  attributing production improvement.
- The complete websocket path was not exercised in an authenticated browser
  session here. Server and SDK protocol tests passed, but account/guest cookie
  authentication, proxied production upgrade behavior, and mobile background
  reconnect still need a live integration check.
- `LISTEN/NOTIFY` is a wakeup mechanism, not a durable queue. On disconnect, the
  gateway requests a resync; multi-process deployment requires one listener per
  process, and scale beyond the process cap needs explicit capacity testing.
- A room-model schema-version change requires a new migration/rebuild policy.
  Old code must not be rolled back while it assumes room-state rows exist.
- The current audit's large initial JS bundle remains assigned to the separate
  route-splitting/Codex/PWA task; no bundle-size reduction is included here.
- Run a true concurrent player load test, production DB index/query-plan review,
  and authenticated guest/signed-in socket checks before relying on the new
  socket path at larger scale.
