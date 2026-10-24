# Production Action Latency — 2026-10-24

## Production baseline

Read-only deployment telemetry covered 2026-10-23 12:20:54 through 2026-10-24
12:20:54 UTC. The deployment was a public VM with a successful current build.
The proxy metrics may lag by up to 30 minutes.

| Endpoint / measure | Requests | Average | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/api/commands` | 81 | 2,036 ms | 1,539 ms | 8,094 ms | 10,000 ms (telemetry ceiling) |
| `/api/game` | 463 | 1,364 ms | 877 ms | 4,392 ms | 4,924 ms |
| Deployment-wide | 3,611 | 944 ms | — | — | — |

There were 78 proxy-observed 4xx responses and no proxy-observed 5xx responses.
Application logs contain startup failures and health-check errors around failed
builds earlier in this window, followed by successful builds. The available
aggregate metrics do not connect those startup interruptions to the measured
slow successful requests.

## Limits of this baseline

Production resource metric queries failed, and hourly endpoint samples were too
sparse to locate the cause. There is no development comparison, route-by-time
breakdown, request trace, database timing, or pre-change local benchmark here.
Consequently, these figures establish production latency but do not establish
whether the cause is application replay, database contention, VM saturation, or
another deployment-side delay.

## Changes made for the next measurement

- Server logs now emit structured `slow_http_request` records for requests over
  250 ms, including request ID, route, status, elapsed server time, and safe
  aggregate database pool counts. No request body or credentials are logged.
- `/api/game` runs its independent location, stats, and location-catalog reads
  concurrently; room-presence projection still follows the location query.
- Successful commands no longer wait for durable-effect processing across
  every world. Effects remain persisted atomically with the command and are
  handled by the existing background processor.
- The client still refreshes room presence every three seconds, but fetches the
  larger full-game snapshot every fifteen seconds rather than after each
  heartbeat. Actions still refresh their snapshots through their existing flow.

## Verification still required after publish

Compare the same production endpoint percentiles after a user-approved publish.
The new slow-request logs should show server handling time and pool pressure,
which can be compared with proxy-observed duration. Database wait, replay CPU,
effect delay, browser request duration, response size, and a development
baseline still need direct measurements before choosing a snapshot or database
pool redesign.
