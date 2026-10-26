# Production vs. development gameplay latency

**Initial baseline measurement date:** 2026-10-26  
**Initial scope:** Read-only production telemetry, current-build server logs, a
bounded development database benchmark, and the then-current workspace source.
A later, bounded production guest trace was run after the event/receipt batching
change was published; its results and data impact are recorded at the end.

## Version and measurement boundaries

| Environment | Revision/build | Evidence |
|---|---|---|
| Workspace | `57d152eb78a47aa1341435bf12dcaf9391d9f13a` | Local Git HEAD |
| Production | Build `e9de5e19-2df6-4fa8-b9db-8f6b4cfa707e`, source commit `74bac94284e1996bcb540beea7ebb2af6fe6fa63` | Deployment build logs; successful VM build finished about 2026-10-26 11:34 UTC |

At the initial baseline, the deployed commit predated workspace HEAD. In
particular, the latest workspace's batched command-guard stream read was not
present in that serving revision. The root URL returned HTTP 200 during this
investigation. No deployment revision was inferred from the page HTML.

Production endpoint metrics cover the post-build window
**11:34:03–13:12:59 UTC** and a broader seven-day window. The server-log sample
contains only requests above its 250 ms slow-request threshold; it is not a
random sample. Percentiles are approximate, and cumulative query time can exceed
request duration because operations overlap.

## Baseline

### Production endpoint timings

| Window | Endpoint | Requests | Avg | p50 | p95 | p99 | 4xx / 5xx |
|---|---|---:|---:|---:|---:|---:|---:|
| Current build, 1h 39m | `/api/commands` | 12 | 550 ms | 667 ms | 967 ms | 993 ms | 0 / 0 |
| Current build, 1h 39m | `/api/game` | 39 | 365 ms | 349 ms | 805 ms | 961 ms | 0 / 0 |
| Seven days, multiple builds | `/api/commands` | 267 | 1,065 ms | 720 ms | 4,510 ms | 9,165 ms | 0 / 0 |
| Seven days, multiple builds | `/api/game` | 952 | 897 ms | 586 ms | 3,788 ms | 4,823 ms | 9 / 0 |

The current-build window is small, especially the 12 commands. Its p95 is more
representative of the serving build than the seven-day aggregate, but is not a
stable estimate. The seven-day tail includes earlier revisions and cannot be
attributed to the current build.

### Current-build request stages

The latest-build slow-log sample contained six commands and nine game snapshots.
The longest logged request in that sample was 666 ms for a successful move:

| Stage | Observed time |
|---|---:|
| Full server request | 666 ms |
| Account + active-session stages | 25 ms each |
| Command guard reads | 57 ms |
| Engine command stage | 366 ms |
| Event-store append | 11 queries; 301 ms elapsed, 297 ms cumulative query time |
| Movement projection | 187 ms |
| Total SQL across request | 21 queries; 786 ms cumulative query time |
| Pool acquisition across request | 1.7 ms |

Other current-build movement logs showed 576–602 ms requests, 335–402 ms command
stages, and 302–370 ms append operations. Append consistently used 11 queries.
The per-request operations included four individual stream-revision queries
(about 105–201 ms cumulative in the examples), plus reads for the location-group
catalog, NPC positions, shared items, and room occupants.

The movement projection measured about 89–187 ms in those samples. Individual
location-group catalog reads were about 27–90 ms; NPC-position projection about
32–148 ms; room occupancy about 27–57 ms. These are secondary contributors,
but visible on a user command's critical path.

Some `/api/game` requests showed 209–299 ms of pool acquisition wait, including
an account-profile lookup waiting roughly 179–299 ms for a connection. Pool
wait in the sampled command requests was generally below 4 ms. Pool counts at
request completion were not saturated, so they do not show how many connections
were occupied at the earlier wait.

The sampled replay and response-serialization stages were around 1 ms or less;
process event-loop p95 was about 43–47 ms in most logs. These measurements do not
point to replay or JSON serialization as the main command bottleneck.

### Development database round-trip benchmark

Added an opt-in tool that runs only read-only statements, sequentially, with five
warmups and 30 measured samples. It separately records pool acquisition,
`SELECT 1`, a primary-key lookup in the location-group catalog, and full
sequential sample time. It does not print database identifiers or row values.

| Development measure | Samples | p50 | p95 | Max |
|---|---:|---:|---:|---:|
| Pool acquisition | 30 | 0.0 ms | 0.2 ms | 0.3 ms |
| `SELECT 1` | 30 | 0.3 ms | 0.8 ms | 1.9 ms |
| Indexed catalog lookup | 30 | 0.4 ms | 1.1 ms | 1.1 ms |
| Sequential sample, including read-only transaction boundaries | 30 | 1.4 ms | 2.6 ms | 3.5 ms |

This is a local development DB round-trip measurement, not an action benchmark.
The current-build production logs show simple indexed reads commonly taking
about 25–30 ms each. That large per-query difference, combined with roughly 11
serial statements in the command append, is the strongest evidence for why
production feels slower. It is consistent with higher app-to-database
round-trip/DB service latency in production; available telemetry cannot separate
network distance from database execution time or confirm the region.

Separate development workflow logs also captured two slow heartbeat requests
(302–328 ms) with 18 queries, about 295–321 ms cumulative SQL time, and under
0.2 ms pool wait. Heartbeat/update stages took roughly 129–190 ms. These are not
gameplay-command samples, but they show that write-heavy scheduled/session work
can also produce long operations even though the simple read-only probes are
fast.

After the final development workflow restart, additional activity showed the
same kind of variability: one room-chat history request took 461 ms, with 11
queries and 453 ms cumulative query time (one query took 167 ms); a heartbeat
took 384 ms, including a 286 ms session update. Pool wait was below 0.3 ms for
both. These are not command samples and are not directly comparable to the
production movement route, but they show that slow DB operations can also occur
in development. The sub-millisecond development probe is therefore a baseline
for simple reads only, not proof that every development DB operation is fast.

## Previous development command sample and existing source optimization

A preceding guest movement trace in development recorded a cold move at 201 ms
(25 queries, 189 ms cumulative query time, 17 ms pool wait) and a subsequent warm
move at 25 ms (21 queries). After the workspace changed the preflight guard to
use `readStreams`, a sampled move was 30 ms (25 queries, 25 ms cumulative query
time, 1.8 ms pool wait, 1.2 ms guard stage). In that comparison, stream-revision
reads changed from five statements to four, while total query count did not
decrease. Cache state and request conditions differed, so the elapsed-time
difference is **not** evidence that the change caused a latency win.

The existing change is still a safe reduction of one guard-read round trip in
the PostgreSQL adapter, while preserving engine authorization and authoritative
revision checks. Its duplicate-command behavior was checked earlier against the
development guest path: concurrent retries returned the same committed event
IDs and successful receipt. It is not yet in the production build identified
above.

## Diagnosis and selected actions

1. **Primary: production DB query latency amplified by serial command work.**
   The low development `SELECT 1`/indexed-read times contrast with production
   per-query durations around 25–30 ms. Command append alone takes about 0.3–0.4
   seconds across 11 queries. This is more consistent with DB round-trip/service
   latency than expensive event replay.
2. **Secondary: projection reads and occasional pool waits.** Movement adds
   roughly 90–190 ms of projection work, while some snapshot requests wait
   hundreds of milliseconds for a pool connection. A single human still creates
   parallel browser refreshes, realtime view checks, and scheduled work; “one
   player” does not mean one database operation at a time.
3. **Not established:** whether production's remaining multi-second tail comes
   from deployment/DB placement, transient database load, connection contention,
   or proxy/network delay. The post-build route sample is small, and the
   seven-day aggregate mixes revisions.

At the time of the initial audit, the relevant workspace change was the batched
command-guard stream read. A later focused change also batches event-row and
command-receipt insertion into one statement within the event-store transaction.
It retains the PostgreSQL idempotency ordering: acquire the command advisory
lock, then perform the receipt lookup in a separate statement. The post-publish
measurement below confirms one fewer append statement, but not a latency win.
No stale permission cache, pool-size increase, or production setting change was
made.

## Tests and limitations

- The new benchmark's opt-in, environment-label, production-confirmation, and
  sample-bound safeguards are covered by unit tests.
- The benchmark itself was run only in development: 5 warmups and 30 read-only
  samples; `dataWritten` was false.
- The production telemetry provider returned endpoint aggregates and
  application logs, but global resource/CPU/memory and DB-host metrics were
  unavailable. The production database was not queried directly.
- No matched browser `muddTrace=1` sample from the current build was available.
  Production endpoint measurements do not include first-feedback or
  authoritative-paint timings.
- No production writes, load tests, database changes, or publish actions were
  performed.

## Earlier post-publish check (before event/receipt batching)

The successful production build at that check was `1dbd51fc-e01f-4993-9fc6-e43b4ab3fd7c`,
source commit `1ba1f0cf9b290c8a0992261f56290f4ed827b09d`, reported successful at
**2026-10-26 13:37:21 UTC**. The source commit descends from workspace HEAD
`57d152e`, so this build includes that workspace revision.

The first available post-build window ended at **13:40:58 UTC**, only about
3 minutes 37 seconds after success. It returned no `/api/commands` or `/api/game`
endpoint samples and no gameplay slow logs. The only endpoint aggregate was for
Clerk session-token requests (2 requests); the only revision-scoped slow log was
one successful token request with no database queries. These measurements do not
indicate gameplay improvement or regression. Endpoint telemetry can lag by up to
30 minutes, and the window is too short to assess command latency.

## Next measurements and recommendations

1. Use development guest movement traces as the iterative benchmark. Repeat the
   same route and sample size after each measured change; do not publish to
   production for every optimization.
2. Once a development improvement is repeatable, use one deliberate production
   validation to check whether the change transfers. Correlate any proxy outlier
   to its app request ID; a server log sample alone does not explain missing
   proxy time.
3. Obtain deployment/database placement and DB-side CPU/query/lock telemetry
   before changing production topology or database settings.
4. Any event-store optimization must retain advisory-lock ordering, separate
   post-lock receipt lookup, expected revisions, deterministic locks, companion
   guards, and concurrent duplicate-command tests.

Development benchmark command:

```sh
MUDD_DB_BENCHMARK=1 \
MUDD_DB_BENCHMARK_TARGET=development \
npm run benchmark:db:readonly --workspace @mudd/server
```

## Follow-up production trace after event/receipt batching

### Deployment and test scope

The latest successful build was `3080efc4-0356-4240-920a-d98b05b9759a`,
created at **14:32:19 UTC** and successful at **14:37:44 UTC** on
2026-10-26. Its source revision was
`684babd0305fa6a147513b96a2aef057b21605df`; that revision contains the batched
event/receipt statement and keeps the post-lock receipt lookup separate.

From **14:49:33–14:49:44 UTC**, a guest character made 10 alternating moves
between Bellwold Market Square and The Kindly Roof, with 11 `/api/game`
snapshots. All 21 traced requests returned HTTP 200. The test world session was
closed afterward. The guest, character, and their movement events remain in
production; no production records were deleted.

### Client and server measurements

The direct HTTP client ran from the Replit development container, not the
player's phone or browser:

| Request | Samples | Mean | Median | Range |
|---|---:|---:|---:|---:|
| Movement client round trip | 10 | 591 ms | 551 ms | 491–827 ms |
| Snapshot client round trip | 11 | 239 ms | 227 ms | 183–361 ms |

Production logs matched all 21 trace IDs with complete entries:

| Server measurement | Samples | Mean | Median | Range |
|---|---:|---:|---:|---:|
| Movement request duration | 10 | 574 ms | 536 ms | 479–787 ms |
| Movement command stage | 10 | 352 ms | 344 ms | 300–430 ms |
| Command append SQL statements | 10 | **10 each** | 10 | 10–10 |
| Command append cumulative SQL time | 10 | 315 ms | 302 ms | 268–398 ms |
| Total movement request SQL statements | 10 | 21.6 | 22 | 19–24 |
| Total movement request cumulative SQL time | 10 | 669 ms | 657 ms | 518–853 ms |
| Movement request pool wait | 10 | 20 ms | 2.8 ms | 1.3–177 ms |
| Snapshot server duration | 11 | 206 ms | 176 ms | 166–304 ms |
| Snapshot SQL statements | 11 | 7.3 | 7 | 7–10 |
| Snapshot cumulative SQL time | 11 | 235 ms | 195 ms | 185–412 ms |

### Interpretation

The targeted change achieved its direct goal: command appends used 10 SQL
statements per move, down from 11 in the earlier production sample. It did **not**
demonstrate lower end-to-end latency in this small run: mean server movement
duration was 574 ms versus the earlier 543 ms, while mean append SQL time was
315 ms versus about 301 ms. These samples are not controlled enough to attribute
the difference to the change; the current run also had one 177 ms pool-wait
outlier. Snapshot duration remained about level (206 ms versus 205 ms earlier).

The remaining cost is still substantial: about 10 append statements and roughly
22 total SQL statements per move. Production per-query latency and occasional
pool acquisition waits remain stronger targets than additional speculative
refactoring. The client timings are transport-level checks from the development
container, not browser paint timings on the player's device.

## Development-first command optimization

On **2026-10-26**, a matched, sequential guest trace was run against the
development application and database before and after a focused event-store
change. Each run used one new guest character, alternated between Bellwold
Market Square and The Kindly Roof, and made 10 successful moves with snapshots
between commands. Both world sessions were closed afterward. The development
guest, character, and test events remain in the development database. No
production request or publish was used for this comparison.

### Change

The HTTP command route already verifies the active character and scopes its
read cache to that character. During a primary-character append, the projection
refresh nevertheless issued another `characters` existence query. The
PostgreSQL adapter now skips that redundant read only when the scoped stream
matches the primary append. Unscoped writes and companion streams still verify
the character row in PostgreSQL. Advisory locks, receipt lookup ordering,
expected-version checks, and the atomic event/receipt transaction are
unchanged.

### Before and after

| Development measurement | Before (10 moves) | After (10 moves) |
|---|---:|---:|
| Server movement duration, median | 29 ms | 25 ms |
| Server movement duration, mean | 149 ms | 52 ms |
| Server movement duration, range | 19–406 ms | 22–224 ms |
| Append SQL statements per move | 10 | **9** |
| Append elapsed time, median | 11.8 ms | 10.3 ms |
| Total SQL statements per move, median | 25.5 | 24.5 |
| Development-container movement round trip, median | 39.3 ms | 33.2 ms |
| Snapshot round trip, median | 20.4 ms | 20.1 ms |

The query-count reduction is consistent across every move in the two samples.
The lower median timings are encouraging but the 10-command samples are small
and noisy; they do not establish a production latency improvement. The server
still recorded one append query taking about **201 ms** (fingerprint
`9505cacb7c71`) in the post-change run. A temporary, development-only
fingerprint mapping identified the SQL template as `COMMIT`. The slow request
had zero pool wait, so this was not waiting to acquire a connection and was not
a slow read/insert query plan.

Development PostgreSQL reported `synchronous_commit=on`, `fsync=on`,
`wal_sync_method=fdatasync`, and no configured synchronous standby. Those
settings preserve local commit durability. `track_wal_io_timing` was off, so
`pg_stat_wal` reported zero write/sync time and cannot establish whether the
single slow acknowledgment was a storage flush, database-service scheduling, or
the database response/network path. The setting was not changed.

A subsequent 10-move development trace matched all 21 request IDs. Across its
10 movement requests, the `COMMIT` fingerprint appeared 20 times, with a
2.9 ms median and 4.1 ms maximum; movement server time was 22.5 ms median and
40 ms maximum. During that sample `pg_stat_wal` counters increased by 8 writes
and 7 syncs, but timing remained unavailable. The 201 ms commit did not recur.
This points to an intermittent commit-acknowledgment delay, not a consistently
expensive SQL statement. Do not weaken `fsync` or `synchronous_commit` to mask
it; more WAL I/O timing or database-service telemetry is needed to distinguish
the remaining causes.

The temporary SQL-template logger was removed and the development workflow was
restarted cleanly. No production query, publish, or configuration change was
made.

### Verification and limits

- Server TypeScript check and targeted ESLint passed.
- All 16 PostgreSQL event-store integration tests passed against an isolated,
  temporary local PostgreSQL database.
- The development workflow restarted successfully and completed the full
  application build. The 10 post-change commands and 11 snapshots all returned
  HTTP 200; there were no version-conflict retries.
- Repository-wide ESLint still reports unrelated unused-variable errors in
  `packages/plugins/src/parties.ts`, `packages/plugins/src/team-combat.ts`, and
  `packages/ui/src/components/DailyBoard.tsx`; these files were not changed.
- Client timings were measured by `fetch` from the Replit development
  container, not from a phone/browser. This work was not published, so the
  production impact remains unverified.
