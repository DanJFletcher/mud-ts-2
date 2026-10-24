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

## Initial post-publish measurement plan

The post-publish endpoint comparison and slow-request review are recorded below.
The logs expose server stages and pool acquisition for comparison with proxy
duration, but do not provide browser resource timing or per-request correlation.
There is also no development endpoint baseline.

## Post-release check — 2026-10-24

Read-only production telemetry was sampled from 2026-10-24 13:33:31 through
15:38:21 UTC, immediately after successful VM build
`95e6befd-ca57-4163-ba1a-569b97120b1a` finished at 13:33:30 UTC. The deployment
was public. Proxy metrics can lag by up to 30 minutes, and this roughly
two-hour window is shorter than the baseline's 24-hour window; treat the
comparison as directional, not as a controlled release experiment.

| Gameplay request path | Requests | p50 | p95 | Previous baseline p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Look query (`/api/queries`; includes other query types) | 387 | 284 ms | 485 ms | Not measured |
| Movement/combat command (`/api/commands`; action types combined) | 48 | 613 ms | 961 ms | 1,539 / 8,094 ms |
| Game snapshot (`/api/game`; supporting refresh, not an action-only route) | 84 | 431 ms | 936 ms | 877 / 4,392 ms |

Compared with the previous endpoint baseline, `/api/commands` was about 60%
faster at p50 and 88% at p95; `/api/game` was about 51% faster at p50 and 79%
at p95. The sample included no proxy-observed 5xx responses (0 for each of
these routes). This demonstrates lower endpoint latency in the sampled window,
but not that this build alone caused the change. Proxy route aggregates cannot
separate movement from combat, and `/api/queries` includes query types beyond
look.

For slow-request logs (only requests at or above the 250 ms logging threshold),
the complete filtered result contained 40 command requests and 52 game
snapshots:

| Logged route/stage | p50 | p95 |
| --- | ---: | ---: |
| Command request duration | 515 ms | 731 ms |
| Command stage | 347 ms | 525 ms |
| Command accumulated SQL time | 502 ms | 718 ms |
| Command accumulated pool acquisition | 0.34 ms | 0.63 ms |
| Game snapshot duration | 386 ms | 508 ms |
| Location projection | 150 ms | 345 ms |
| Stats projection | 28 ms | 264 ms |
| Game accumulated SQL time | 364 ms | 482 ms |
| Game accumulated pool acquisition | 188 ms | 665 ms |

These log percentiles describe only the slow-request subset, not all route
requests. Query time and pool acquisition are accumulated across queries, so
they can exceed wall time when work overlaps. Replay remained negligible in
these logs (under 2 ms at p95), response serialization was about 1 ms or less,
and process event-loop p95 was 31 ms or less in the sampled records. This points
away from replay, JSON serialization, and sustained event-loop delay. The
clearest next code target is the command stage and its high SQL time/query
volume; inspect for redundant query round trips before considering pool-size
changes. For `/api/game`, location projection and accumulated pool acquisition
are the remaining stages to investigate, without treating cumulative wait as
request wall time.

A user confirmed that a subsequent browser capture came from the published
game. These local `mudd:action-visible:<action>` entries span the action start
through the React commit that clears pending state; they are not uploaded and
were not paired with individual server requests.

| Browser action-visible measure | Samples | p50 | Nearest-rank p95 |
| --- | ---: | ---: | ---: |
| Look | 2 | 623 ms | 811 ms |
| Move | 11 | 1,162 ms | 2,113 ms |
| Combat | 2 | 1,490 ms | 1,851 ms |

The small look and combat samples are weak percentile estimates; for all three
actions, nearest-rank p95 is the maximum observed sample. The move and combat
handlers wait for the command and then fetch a game snapshot before clearing
pending state; combat also refreshes team-combat state in parallel. This makes
the browser duration larger than one HTTP request by design. The browser sample
therefore cannot be decomposed into request, network, and React-render time.

Server diagnostics still identify SQL/command work as material: command-stage
p95 was 525 ms and cumulative SQL p95 was 718 ms, while replay was under 2 ms
and serialization about 1 ms. The game snapshot's proxy p95 was 936 ms; its
slow-log location projection p95 was 345 ms and cumulative SQL p95 was 482 ms.
The smallest measured next code target is the sequential post-move snapshot
request: reduce the `/api/game` SQL work or determine whether a smaller
authoritative response can safely replace that full refresh. Do not attribute
the remaining browser time to rendering without paired browser resource
timings, and do not increase the connection pool based only on accumulated
acquisition time.

No production writes, load tests, or publishing actions were performed. The
earlier seven-sample capture from the workspace preview is excluded from these
published-app results.
