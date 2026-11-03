# Tasks

## 1. Establish preservation checks

- [x] 1.1 Record the existing route/scenario-to-suite map and startup/resource ownership alongside the implementation documentation, using the design's concrete boundaries; verify it accounts for the broad NPC HTTP suite's auth, sessions, commands, chat, realtime, metrics, and worker assertions, plus current startup/shutdown limitations.
- [x] 1.2 Run the existing focused baseline for world registry, realtime gateway/notifications, schedulers, web serving, and the broad HTTP suite with `npm run test --workspace @mudd/server -- <current-test-paths>` and server typechecking; record results and isolated PostgreSQL prerequisites, distinguishing unavailable/skipped checks from passes.

## 2. Organize existing modules and their path consumers

- [x] 2.1 Move auth, world, room, realtime, and scheduler modules with their colocated tests to the design's responsibility folders; update NodeNext `.js` imports and literal mock targets, and verify with affected suites and `npm run typecheck --workspace @mudd/server`.
- [x] 2.2 Group configuration, security, web serving, performance, and middleware under the application folder; rename the Clerk proxy file to kebab-case and update database/other instrumentation imports while keeping current metrics scope; verify configuration, security, middleware, performance, database-client, and web-serving suites plus server typechecking.
- [x] 2.3 Rename the demo event-effects file and its test to world event effects while preserving exports, manifest ID, and registered-world behavior; verify event-effects and world-registry suites and inspect the identifier diff for accidental runtime changes.
- [x] 2.4 Move benchmark programs/tests and update the package script, CLI detection fixtures, and documented invocations; verify benchmark runner/safety suites and inspect scripts for stale paths, without sending benchmark traffic to production.
- [x] 2.5 Add the server module map and ownership/dependency rules to the architecture documentation, including stable database/executable paths and process-scoped metrics; verify the map against moved files and check for stale server source references in docs/scripts.

## 3. Extract shared request context, snapshots, and HTTP registration

- [x] 3.1 Extract account/request identity and active world/character context coordination with explicit dependencies, preserving cache ownership, invalidation, and authorization; run identity-cache, session, character-authorization, world-entry, and existing HTTP auth/session tests against the new boundary.
- [x] 3.2 Extract wallet/location enrichment, game snapshot assembly, command settlement, and command-response projections into cohesive world modules; verify the existing HTTP game/command/query assertions and affected projection suites still cover response shape and reconciliation behavior.
- [x] 3.3 Extract world/character/membership route registration and room chat registration, preserving middleware order, methods, paths, status codes, validation, rate limits, and transaction authority; verify existing HTTP and room chat/presence tests before removing the original handlers.
- [x] 3.4 Extract game, interaction, command, and query routes with narrow service dependencies; verify existing HTTP gameplay, duplicate/conflicting command, error-response, and projection assertions and server typechecking, then document route/context/snapshot ownership next to the module map.

## 4. Extract runtime composition and background orchestration

- [x] 4.1 Introduce explicit application construction and production bootstrap, keeping the executable/database output paths stable and moving real database acquisition to composition; add focused tests proving reusable construction does not bind HTTP, start worlds/jobs/LISTEN, install process handlers, or require construction of the real database pool through the test dependencies.
- [x] 4.2 Move subscription view loading and realtime wiring out of the entry point, sharing request context without importing route handlers; verify gateway/notification tests and HTTP realtime scenarios cover cache invalidation, effect wakeups, channel scope, and reconnect recovery with one listener/gateway set per runtime.
- [x] 4.3 Extract effect processing and interaction maintenance with current timer injection points, startup passes, intervals/debounce/batch limits, active-world filtering, and nonoverlap guards; use deterministic tests to verify preserved timing and run the existing scheduler/worker scenarios.
- [x] 4.4 Reduce the executable to composition invocation and signal wiring, exposing existing cleanup for explicit harness use; add startup-order/readiness-failure and executable signal-wiring tests, retain world-start rollback coverage, and verify existing cleanup calls reach the same owners without claiming new drain/restartability guarantees.
- [x] 4.5 Preserve production web resolution through a stable entrypoint URL or explicit asset location and retain port/E2E binding behavior; extend the existing web-serving/configuration coverage for the moved caller and verify API-versus-SPA fallback behavior.
- [x] 4.6 Document runtime versus process resource ownership, construction/startup/cleanup entry points, and existing lifecycle gaps; inspect imports for new cycles or executable/bootstrap imports from reusable feature modules and verify the documented boundaries match exports.

## 5. Decompose the HTTP integration harness and suites

- [x] 5.1 Introduce a shared test-owned application harness using explicit construction/startup/cleanup and injectable dependencies; replace executable imports, process-listener discovery, and global timer interception where they are incidental, verifying that HTTP behavior still runs through the real registered application routes and that teardown retains the existing HTTP-close assertion.
- [x] 5.2 Split authentication/security and world/character/session scenarios into accurately named suites; compare them against the scenario map to preserve every moved assertion, then run both extracted suites and related focused auth/world tests.
- [x] 5.3 Split game/command/query and room chat/NPC scenarios into cohesive suites; verify the scenario map accounts for every assertion and run the extracted suites with the existing room and gameplay integration coverage.
- [x] 5.4 Split realtime and jobs/metrics scenarios, retain an executable startup/signal smoke suite, and remove the obsolete broad suite only after all scenarios have destinations; run the new suites together to expose mock, timer, or shared-state leakage.
- [x] 5.5 Ensure shared test helpers are excluded from production output if placed under `src`, retain recursive Vitest discovery, and document harness usage; verify server build output contains no test harness/helper modules and the test runner discovers all destination suites.

## 6. Validate the integrated refactor

- [x] 6.1 Run `npm run test --workspace @mudd/server` with isolated test PostgreSQL configured for both the `DATABASE_URL` consumers and `MUDD_TEST_DATABASE_URL`-gated suites; verify existing persistence, chat/presence, command concurrency/idempotency, realtime, world, and scheduler scenarios pass, recording any environment-dependent skips explicitly.
- [x] 6.2 Run `npm run typecheck --workspace @mudd/server` and `npm run lint`; resolve introduced failures and inspect the final executable, module map, and imports against the design's structural acceptance criteria.
- [x] 6.3 Run `npm run build`, then `node --test scripts/production-config.test.mjs`; verify stable compiled executable/database runner artifacts, correct PWA asset resolution, absence of test helpers from server output, and unchanged deployment entry points.
- [x] 6.4 Run `openspec validate refactor-server-structure --strict`; review each design acceptance criterion against the delivered modules/tests and record results, keeping broader lifecycle fixes and unrelated web-client changes outside this change.
