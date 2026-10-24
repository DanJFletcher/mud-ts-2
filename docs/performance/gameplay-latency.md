# Gameplay latency investigation

## What was found

The event-array cache did not cache character projections: every caller still
validated and parsed the entire history. Streams above 512 KiB were not retained.
The one-second recovery tick read/replayed saved offline sessions before checking
whether they needed recovery. Independent browser refresh loops also competed
with actions and could apply an older snapshot after movement.

The fixes use immutable incremental projection checkpoints, bounded larger event
caches (including empty histories), final offline settlement tracking, and
action-aware background refreshes. No history is deleted or rewritten. Database
head checks, command locks, expected revisions, receipts and companion guards remain.

## Repeatable local comparison

Run the migrations against a dedicated **localhost test database**, then:

```sh
DATABASE_URL=postgresql://runner@127.0.0.1:55439/mudd_latency_test \
MUDD_BENCHMARK_LOCAL=1 npx tsx apps/server/src/latency-benchmark.ts
```

The script rejects non-local hosts, databases not ending `_test`, and missing
explicit opt-in. It creates and cleans up its own character fixtures. Do not aim
it at a development or production database. Its test-world encounter profile
and no-random-encounter settings exist only inside the benchmark process.

Measured 2026-10-24, PostgreSQL 16.15 on the development container. Thirty samples
per action/policy/history size, warmed catalogs, no competing test run. The 2,000
event fixture exceeds the previous 512 KiB limit. Movement/combat append events
and then fetch a location projection, exercising the growing-history path.

**Important:** “before” emulates the previous stream-read/replay policy with the
current command/plugin code. It is not a build of the entire former application.
Current append bookkeeping is shared by both modes, making this a conservative
comparison for append serialization savings. These are handler-level measurements
using real PostgreSQL, not HTTP, mobile rendering, remote database RTT, or
production measurements. Authentication/session HTTP overhead and autonomous
background world schedulers are not part of these action timings.

### Action + follow-up snapshot

Milliseconds; p95 is the nearest upper sample, not a confidence interval.

| Initial events | Action | Before p50 / p95 | After p50 / p95 | p95 reduction | SQL queries before → after |
|---|---|---:|---:|---:|---:|
| 100 | Look | 7.84 / 24.65 | 2.07 / 2.99 | 88% | 7 → 4 |
| 100 | Move | 26.55 / 40.99 | 9.49 / 15.75 | 62% | 20 → 16 |
| 100 | Combat | 32.60 / 70.69 | 9.84 / 15.89 | 78% | 20 → 16 |
| 2,000 | Look | 68.79 / 106.24 | 1.92 / 2.31 | 98% | 8 → 4 |
| 2,000 | Move | 142.98 / 157.96 | 9.30 / 15.01 | 90% | 21 → 16 |
| 2,000 | Combat | 147.92 / 184.64 | 8.98 / 12.66 | 93% | 21 → 16 |

All local warm p95 action timings meet the <500 ms and ≥50% reduction targets.
This does **not** establish those targets in the published application.

### Long-history stage measurements

| Stage (p95 ms) | Look before → after | Move before → after | Combat before → after |
|---|---:|---:|---:|
| Snapshot reducer only | 71.69 → 0.09 | 54.06 → 0.25 | 65.63 → 0.29 |
| Snapshot history read + reducer | 90.15 → 0.74 | 81.79 → 1.63 | 84.60 → 1.12 |
| Cumulative connection acquisition | 0.64 → 0.26 | 0.76 → 0.46 | 1.06 → 0.54 |
| Cumulative SQL time | 45.39 → 2.23 | 40.96 → 12.74 | 50.71 → 9.43 |
| Event-loop delay | 89.19 → 12.80 | 75.30 → 11.46 | 81.00 → 10.40 |

Cumulative query time can exceed wall time when queries overlap. Reducer timing
here covers the follow-up snapshot, not every internal command replay.

### Recovery and request activity

Thirty ticks per fixture, using the real PostgreSQL event store and fixture
session listings. The online fixture uses the real clock (not simulated future
timestamps); this is primarily an idle-recovery overhead test, not a 30-second
regeneration throughput test.

| Fixture | Before p50 / p95 ms | After p50 / p95 ms | Stream reads before → after |
|---|---:|---:|---:|
| Short, active | 7.59 / 16.72 | 0.50 / 0.94 | 30 → 30 |
| Short, offline | 6.54 / 19.12 | 0 / 0.01 | 30 → 1 |
| Long, active | 72.48 / 140.98 | 0.44 / 0.95 | 30 → 30 |
| Long, offline | 66.99 / 101.94 | 0 / 0.01 | 30 → 1 |

Long offline SQL count drops from 60 to 1 across those ticks. Active characters
still check the database head; they no longer reconstruct the whole projection.
Recovery integration tests separately cover settlement cutoff, retries, death,
full vitals and legacy anchors.

The benchmark invokes one query for look, or one command plus one snapshot query
for move/combat. Those are handler-step counts, **not measured browser requests**.
In the client, idle no-party polling intervals change from party 3s / team 2s
to party 9s / team approximately 6s. Over 90 steady-state seconds this removes
about 50 requests (75 → 25) per idle client, excluding startup calls and other
pollers. This count is derived from configured intervals, not a captured trace.
Active party/team cadence stays responsive. Action-overlapping results are
rejected; hidden chat polling stops and resumes on visibility.

## Diagnostics for the next published check

Slow HTTP logs now include account/session, route replay, location/stats,
command and response-serialization stages; SQL count/time; accumulated pool
acquisition time (rather than just the queue at response completion); and
process event-loop p95/max. No query text, parameters, chat, names or credentials
are added. Stage coverage is route-level; plugin replay is included inside the
command duration, not individually attributed. Event-loop histograms are
process-wide and reset every minute, not per-request measurements.

Browser Performance entries named `mudd:action-visible:<action>` span action
start through the React commit that clears its pending state. They are local
diagnostics, not automatic telemetry uploads or a measured production percentile.

After the user publishes, compare real look/move/combat request p50/p95 and
browser action-visible timings. If SQL dominates, the next optimization should
reduce round trips or address database/network placement; do not increase pool
size without evidence of acquisition delay. If cold history dominates, consider
compatible persisted projection checkpoints. Current histories over 8 MiB and
startup offline reconciliation can still require a full replay.

## Verification and limits

- Full automated test suite passed, with the PostgreSQL suites actually enabled
  on the temporary database rather than skipped.
- Large-history warm reads, cross-writer tail reads, stale expected versions,
  eviction/rebuild, receipt idempotency and companion atomicity are checked.
- Client tests cover a delayed pre-movement snapshot and hidden chat polling.
- Production build and TypeScript checks passed.
- Repository lint remains blocked by the existing unused `busy` destructuring in
  `packages/ui/src/components/DailyBoard.tsx`; no unrelated UI change was made.
- No production database writes, production load tests, authentication bypass or
  automatic publishing were performed. The signed-in rendered UI was not verified
  by the unauthenticated screenshot capture.
