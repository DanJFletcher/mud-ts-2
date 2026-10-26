# Production vs. development gameplay latency

**Measurement date:** 2026-10-26  
**Scope:** Read-only production telemetry, current-build server logs, a bounded
development database benchmark, and the latest workspace source. No production
commands, account creation, database writes, load tests, or publishing were run.

## Version and measurement boundaries

| Environment | Revision/build | Evidence |
|---|---|---|
| Workspace | `57d152eb78a47aa1341435bf12dcaf9391d9f13a` | Local Git HEAD |
| Production | Build `e9de5e19-2df6-4fa8-b9db-8f6b4cfa707e`, source commit `74bac94284e1996bcb540beea7ebb2af6fe6fa63` | Deployment build logs; successful VM build finished about 2026-10-26 11:34 UTC |

The deployed commit predates the workspace HEAD. In particular, the latest
workspace's batched command-guard stream read is not present in the serving
revision. The root URL returned HTTP 200 during this investigation. No deployment
revision was inferred from the page HTML.

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

The code change available for this workspace is the already-added batched guard
stream read; it removes one SQL statement in that path but has no demonstrated
end-to-end latency win yet. No speculative transaction rewrite, cache that could
serve stale permissions, pool-size increase, or production setting change was
made. The audit's PostgreSQL idempotency ordering remains intact: acquire the
command advisory lock, then perform the receipt lookup in a separate statement.

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

## Next measurements and recommendations

1. Publish the current workspace revision only when ready; it is not live yet.
   Afterward, gather 20–30 same-device guest movement traces in development and
   production with `?muddTrace=1`, and compare request IDs, command stage,
   movement projection, query count/time, pool acquisition, and browser paint.
2. Continue collecting current-build production traces until there are enough
   commands for useful percentiles. Correlate any multi-second proxy outlier to
   the same app request ID; a server log sample alone does not explain missing
   proxy time.
3. Obtain deployment/database placement and DB-side CPU/query/lock telemetry.
   If the production per-query floor remains 25–30 ms while development stays
   sub-millisecond, prioritize measured region/topology or DB-service causes
   before deeper engine rewrites.
4. With a disposable PostgreSQL test database, investigate reducing batched
   stream-read round trips and projecting only required shared state. Any
   event-store change must retain advisory-lock ordering, separate receipt
   lookup, expected revisions, deterministic locks, companion guards, and
   concurrent duplicate-command tests.

Development benchmark command:

```sh
MUDD_DB_BENCHMARK=1 \
MUDD_DB_BENCHMARK_TARGET=development \
npm run benchmark:db:readonly --workspace @mudd/server
```
