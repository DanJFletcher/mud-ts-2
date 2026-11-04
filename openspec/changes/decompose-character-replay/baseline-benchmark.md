# Character replay baseline benchmark

- Date: 2026-11-04
- Runtime revision: `991f31ebedd5dfaeef53bf62c17565b8df072cf1`
- Working tree at run: only replay characterization tests and OpenSpec tracking were changed; `replay.ts` and `incremental-projection.ts` were unmodified.
- Database: disposable local PostgreSQL 16.10 on `127.0.0.1:55439`, database `mudd_latency_test`; migrations ran against this temporary database. It was shut down and removed after the benchmark.
- Fixture: 100-event short and 2,000-event long character histories; 30 samples per action and policy, warmed catalog/history; look, move, combat, plus recovery ticks. Encounter chance was disabled only in the benchmark process.
- Benchmark command: `DATABASE_URL=postgresql://runner@127.0.0.1:55439/mudd_latency_test MUDD_BENCHMARK_LOCAL=1 npx tsx apps/server/src/benchmarks/latency-benchmark.ts`
- Comparison policy: `before` emulates the previous 512 KiB event-array retention policy and always replays the read events; `after` uses the current immutable replay checkpoints. Both use the same current command/plugin code. These are local handler measurements, not HTTP or production latency.

Snapshot reducer timing in milliseconds, p50 / p95:

| History | Policy | Look | Move | Combat |
| ---: | --- | ---: | ---: | ---: |
| 100 | before | 1.87 / 5.18 | 2.91 / 4.60 | 4.47 / 9.29 |
| 100 | after | 0.04 / 0.04 | 0.19 / 0.23 | 0.19 / 0.43 |
| 2,000 | before | 41.30 / 51.10 | 39.98 / 51.39 | 45.56 / 51.52 |
| 2,000 | after | 0.04 / 0.06 | 0.19 / 0.27 | 0.18 / 0.30 |

The candidate run must use the same local database setup, fixture lengths, sample count, actions, and policy labels. Record its runtime revision and timings below after the refactor; these baseline values are local observations, not performance guarantees.

## Candidate run

Not run yet.
