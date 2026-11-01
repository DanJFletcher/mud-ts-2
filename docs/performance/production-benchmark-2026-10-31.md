# Production benchmark — 2026-10-31

## Summary

A serial, single-client benchmark against the published game measured moves at
270 ms and snapshots at 187 ms (median). That is about half the 574 ms mean
move time in the 2026-10-26 trace cited by the
[round-trip latency audit](round-trip-latency-audit.md). Single-player latency
is no longer the main engine risk.

The largest remaining measured cost is NPC-position resolution and location
projection, about 113–115 ms per request. Database pool wait is low.

## Method

- Build `cf9a1ee8-2155-47dc-91dd-0016baab2d92`, measured on 2026-10-31.
- The single-call append fast path was enabled (`MUDD_SINGLE_CALL_APPEND=1`,
  [ADR 0039](../adr/0039-single-call-event-append.md)).
- One client, one request at a time.
- 30 game snapshots, 30 `location.describe` queries and 26 successful moves.
- The 27th move was rejected with a `RULE_VIOLATION` receipt, and the run
  stopped there. Heartbeat and rename samples were not taken.

## Results

| Request | Samples | Median | p95 |
| --- | ---: | ---: | ---: |
| Game snapshot | 30 | 187 ms | 217 ms |
| `location.describe` | 30 | 187 ms | 287 ms |
| Successful move | 26 | 270 ms | 312 ms |

Server traces for the same run:

- NPC-position resolution and location projection took about 113–115 ms per
  request. This is the largest remaining measured stage.
- Pool wait was about 3 ms for snapshots and 6 ms for moves. Pool sizing is not
  the first thing to optimize.
- `location.describe` averaged 182 ms in the available telemetry.

## Comparison with earlier measurements

| Request | 2026-10-24 post-release (proxy p50 / p95) | 2026-10-26 trace (mean server time) | 2026-10-31 (median / p95) |
| --- | ---: | ---: | ---: |
| Move | 613 / 961 ms (all commands) | 574 ms | 270 / 312 ms |
| Game snapshot | 431 / 936 ms | 206 ms | 187 / 217 ms |

The methods differ. The 2026-10-24 figures are proxy aggregates of real traffic
and mix action types, the 2026-10-26 figures are means, and this run is a
scripted single client. Read the table as direction, not as a controlled
comparison.

An earlier 2026-10-31 run of the same benchmark on a previous build reported
medians 89–93% higher than these. Its raw results are not recorded here, the
build and time window differed, and it may include a cold start, so it is not
used as the baseline.

## What this does not show

- **Concurrency.** One serial client cannot show contention between players on
  the shared world streams (`world-interactions`, `world-team-combat`,
  `world-groups`, `world-items`). Measure that with several clients: cooperative
  combat, two simultaneous duels and contested loot.
- **Scaling with world size.** NPC-position cost probably grows with the number
  of NPCs in a world. That is an inference; this run did not vary the NPC count.
  If it holds, an indexed room-occupancy read model would remove most of the
  per-request cost.
- **Rejected moves.** Only successful moves were timed.
- **The multi-statement append path.** With the fast path enabled, this run
  does not measure the fallback path used when the flag is unset.

## Next measurement

- Choose each move from the exits in the current snapshot, so a rejected move
  does not end the run, and include heartbeat and rename samples.
- Keep recording the `MUDD_SINGLE_CALL_APPEND` setting with each run.
- Add a multi-client profile before the shared-stream partitioning work.
