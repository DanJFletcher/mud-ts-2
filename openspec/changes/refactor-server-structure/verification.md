# Verification

Implemented on branch `refactor/server-structure`.

## Delivered boundaries

- The stable [executable](../../../apps/server/src/index.ts) is six lines and delegates runtime composition and signal wiring.
- [Application construction](../../../apps/server/src/app/create-app.ts) accepts explicit dependencies; [bootstrap](../../../apps/server/src/app/bootstrap.ts) owns production readiness and existing startup/cleanup.
- Account/request context, world snapshots/routes, room routes, realtime views, jobs, and benchmarks have explicit owners. The [module map](../../../docs/server-structure.md) documents extension points and process-scoped resources.
- All original 70 HTTP scenarios have destinations in seven focused suites using the explicit-startup shared harness. A structural comparison confirmed 69 original scenario bodies retain their complete assertions; the final HTTP-close scenario now invokes cleanup directly, with separate executable and signal-wiring tests preserving process-boundary coverage.
- Ordinary tests remain colocated, including database integration tests beside the event-store adapter. Test-only helpers are excluded from production output.

## Checks and results

Commands were run from the repository root. Both database URL variables pointed to a disposable local PostgreSQL 16 container; no production database or live production benchmark traffic was used.

| Check | Result |
| --- | --- |
| Focused pre-extraction baseline | 8 suites, 121 tests passed; server typecheck passed |
| Full server suite after mechanical moves | 51 suites, 437 tests passed |
| `npm run test --workspace @mudd/server -- --maxWorkers=4` | 63 suites, 455 tests passed, no skipped suites/tests |
| `npm run typecheck --workspace @mudd/server` | Passed |
| `npm run lint` | Passed, zero errors; 405 warnings reported |
| `npm run build` after removing generated server output | Passed for the complete repository |
| `node --test scripts/production-config.test.mjs` | All 3 checks passed |
| Compiled server output inspection | 65 runtime files; stable executable and database runner paths present, no test/helper modules |
| Production runtime import graph review | 65 source modules; no runtime cycles, no reusable module imports of executable/bootstrap; construction avoids real database/session/world composition |
| `openspec validate refactor-server-structure --strict` | Passed with the intended `skip_specs: true` declaration |

The first baseline invocation without `DATABASE_URL` failed during import-time validation; configuration was then supplied. A full run with 63 parallel workers passed 454 tests but hit the existing five-second limit in the large-history PostgreSQL replay case. The complete suite passed with four workers, without changing test timeouts or dropping assertions. Bounded concurrency avoids local container contention.

## Acceptance review

1. **Module ownership and small executable:** Delivered feature folders, narrow dependencies, and documented extension points; no route handlers or job loops remain in the executable.
2. **Construction versus startup:** Construction tests reject real database/session/world/notification imports and verify that two constructions do not bind a listener, invoke runtime dependencies, or install signals.
3. **Preserved readiness and cleanup wiring:** Bootstrap tests cover ordering, readiness rejection, configured/default ports, E2E/public binding, and existing cleanup ownership. Existing world-registry rollback coverage remains; signal wiring and executable invocation have independent tests.
4. **Authority and behavior compatibility:** All server scenarios pass, including PostgreSQL concurrency/idempotency, chat/presence, response projections, membership invalidation, realtime recovery, and existing schedulers. New deterministic job tests cover debounce, fallback cadence, batch caps, active-world filtering, and overlap prevention.
5. **Integration coverage and test-only output:** Original scenarios retain coverage through real registered HTTP routes and socket subscriptions. Shared fixture setup injects worker intervals without replacing global timers; teardown is explicit. Test helpers are absent from clean production output.
6. **Location-dependent execution:** Source and emitted executable URLs retain production asset resolution; benchmark runner/safety tests pass; existing database/schema/SQL locations and deployment entry points remain stable.
7. **Integrated checks:** Full server tests, typecheck, lint, repository build, production artifacts, and strict OpenSpec validation passed as recorded above.

## Scope retained

Public wire contracts, plugin manifest IDs, SQL schema, engine ownership, transaction boundaries, and existing gameplay behavior are unchanged. Broader production shutdown/draining fixes remain outside this change: the existing interaction interval/activity subscription cleanup gaps and process-scoped metrics/database resources are documented. Unrelated web-client changes were not modified.
