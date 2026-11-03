# Design

## Context

See [proposal.md](./proposal.md) for motivation. At proposal time, the source survey found 93 TypeScript files, 79 directly under the server source root. The [entry point](../../../apps/server/src/index.ts) contained 1,484 lines and the former NPC-named HTTP integration suite contained 3,541 lines, exercising much more than NPC announcements. The implementation's [scenario map](../../../docs/server-structure.md#http-scenario-destinations) records that suite's destinations.

The existing monorepo already separates contracts, engine authority, first-party plugins, world content, and the client SDK. This change reorganizes the server application within that boundary. Preserve the accepted [room-chat transaction boundary](../../../docs/adr/0003-room-chat-persistence-boundary.md), [room read models](../../../docs/adr/0034-room-read-model-and-realtime-invalidations.md), and [realtime invalidation protocol](../../../docs/adr/0035-typed-realtime-transport-and-recovery.md).

The main OpenSpec capability inventory is empty. This change sets `skip_specs: true` because it changes implementation structure rather than product behavior. The acceptance criteria below define completion of the refactor.

## Goals / Non-Goals

**Goals:** Make feature ownership discoverable; keep executable composition separate from reusable application construction; give HTTP and realtime explicit shared context dependencies; retain existing behavior and coverage while enabling focused integration suites.

**Non-Goals:** New workspaces or services, plugin API changes, engine/persistence rewrites, transport or gameplay changes, schema migrations, a dependency injection framework, global barrel exports, a file-size quota, or a new graceful-drain/restartability guarantee.

## Decisions

### 1. Group by collaborating responsibilities inside the server app

Use the following target layout. Ordinary tests remain colocated; the names of extracted internal modules can be refined without changing their ownership.

```text
src/
  index.ts
  app/
    create-app.ts
    bootstrap.ts
    http.ts
    request-security.ts
    server-config.ts
    web-serving.ts
    performance.ts
    middleware/clerk-proxy-middleware.ts
    __tests__/
  auth/
    session-service.ts
    request-identity-cache.ts
    character-authorization.ts
    e2e-auth-mode.ts
    request-context.ts
  worlds/
    world-registry.ts
    world-entry.ts
    world-activity.ts
    world-wallet-policy.ts
    world-query-schema.ts
    world-map-projection.ts
    location-group-store.ts
    location-group-projection.ts
    woodcutting-room-projection.ts
    game-snapshot.ts
    routes/
  rooms/
    room-chat-service.ts
    room-presence-service.ts
    room-presence-projection.ts
    combat-presence-plugin.ts
    world-event-effects-plugin.ts
    durable-effect-contracts.ts
    npc-announcer.ts
    npc-chat-reactor.ts
    routes.ts
  realtime/
    realtime-gateway.ts
    realtime-notifications.ts
    subscription-views.ts
  jobs/
    autonomous-npc-scheduler.ts
    stamina-recovery-scheduler.ts
    object-lifecycle-scheduler.ts
    effect-processing.ts
    interaction-maintenance.ts
  benchmarks/
    latency-benchmark.ts
    read-only-db-benchmark.ts
    room-read-benchmark.ts
  db/
  persistence/
```

Keep database/schema/migration files and the event-store adapter in their existing directories. Map the existing middleware to the project's kebab-case filename convention. Rename only the demo event-effects filename/imports: its exported `worldEventEffectsPlugin` already serves all registered worlds; preserve the manifest ID and behavior.

Global `services`, `projections`, and `plugins` buckets were rejected because room or world changes would still require navigating several unrelated folders. Moving everything without decomposing the entry point is useful as the first stage, but is not completion of this change. Moving features into shared packages is deferred until actual reuse or ownership warrants it.

### 2. Separate reusable application construction from process execution

Keep `src/index.ts` as the stable executable. It invokes runtime composition and owns process signal registration. It must not contain feature handlers, snapshot assembly, subscription view resolution, or worker loop implementations.

`app/create-app.ts` constructs the Express application from explicit dependencies and registers middleware/routes; it does not import the executable, start world runtimes or worker loops, attach PostgreSQL LISTEN, bind an HTTP listener, or install process signal handlers on import. Use narrow typed parameter objects and ordinary functions, not a general container.

`app/bootstrap.ts` wires real configuration, database adapters, worlds, HTTP/realtime, and background jobs. Separate construction from the existing startup sequence and expose its cleanup operation for explicit invocation by tests. Keep dependency instances and caches shared at their current runtime scope rather than reconstructing them per route or request.

The existing database module validates `DATABASE_URL` and creates a pool at import time; metrics also owns process-scoped instrumentation. Keep real database imports in production composition and inject substitutes into isolated HTTP tests. Document metrics' existing process scope rather than promising all transitive imports are side-effect-free. Do not accidentally create a metrics monitor, cache, pool, scheduler, or notification listener per feature registration.

Preserve database warmup, world registration/startup, scheduler eligibility, effect wakeups, polling intervals, overlap guards, retry policies, notification setup, and listener readiness ordering as observed before extraction. Move existing cleanup calls with their resource owner. Signal handling remains executable-owned and invokes the same runtime cleanup path used explicitly by the harness.

The current readiness sequence is configuration validation, database warmup, room-state rebuilding, world startup, worker wiring/startup, HTTP/realtime assembly, then listening. Earlier readiness failure must still prevent listening. Preserve the world registry's existing rollback of previously started worlds on a later world startup failure. Reseed activity from fresh sessions before starting autonomous NPC scheduling; retain stamina's immediate recovery pass, object-lifecycle construction/start timing, effect startup/fallback/wakeup passes, and interaction startup maintenance before polling. Keep port precedence and E2E loopback binding unchanged.

This extraction does not assert stronger shutdown behavior than currently exists. The survey identified incomplete cleanup of interaction polling/activity subscriptions, and a lack of awaited HTTP/worker draining; those operational fixes require a separately scoped follow-up. Do not encode these gaps as required product behavior or claim that extracting a factory resolves them.

### 3. Extract cohesive handlers without changing authority

Move route registration in the current clusters: worlds and characters, active world membership, game reads, room chat, interactions, commands, and queries. Keep world-facing clusters under `worlds/routes` and chat handlers with `rooms`; place health/metrics and common HTTP setup with `app`. Retain methods, paths, registration order, validation, safe errors, status codes, rate limits, and response projections.

Extract account identity resolution and request-context coordination under `auth`. Account identity and world membership remain distinct: use the existing world-entry/session dependencies, and preserve world/character ownership checks and cache invalidations. HTTP and realtime consume this context boundary; they do not import each other's route handlers.

Move wallet initialization, location enrichment, game snapshots, command settlement, and command-response projection assembly out of the entry point into cohesive world application modules. Keep authoritative commands and state transitions in the engine/plugins. Do not move gameplay rules into transport handlers.

Realtime subscription views receive the existing world/room/context dependencies explicitly. Notifications remain invalidation hints; authoritative commands, reads, and reconnect recovery continue over HTTP. Preserve notification-to-cache invalidation and effect wakeup wiring.

Dependency direction remains explicit: executable/composition wires adapters and feature modules; route modules invoke application services; services use existing engine/plugin/storage interfaces. Reusable modules never import the executable or bootstrap. Avoid new runtime cycles and catch-all shared utility modules. These are application-internal extractions, not new public package dependencies, so no separate ADR is needed unless implementation expands an accepted architectural boundary.

### 4. Decompose integration coverage around a shared harness

Split the broad NPC-named suite into application integration suites for authentication/security, world/character sessions, game/commands/queries, chat/NPC behavior, realtime, and jobs/metrics as appropriate. Preserve each existing scenario and assertion while moving it; do not substitute narrower mocks for the behavior an integration assertion currently covers.

The harness calls the application factory and runtime startup/cleanup explicitly with test-owned dependencies. Replace dynamic imports of `index.ts`, process-listener discovery, and global timer interception where injection gives the same coverage. Keep one executable startup/signal-wiring smoke test where process integration itself is the subject. Only those tests should need to observe process-level behavior.

Give test helpers an explicit test-only home and exclude ordinary helper `.ts` files from the production build if they live under `src`. Vitest's existing recursive test discovery already covers nested `.test.ts` suites. Keep the large Orraveth gameplay/content suite and event-store implementation outside this decomposition unless a moved import requires adjustment; their deeper ownership changes are separate work.

### 5. Preserve location-dependent execution

- Preserve `src/index.ts`, compiled `dist/index.js`, and every existing compiled database runner path used by deployment scripts. Keep the Drizzle schema location and relative SQL resolution stable.
- Production web serving resolves assets from the caller-supplied module URL. Pass the stable executable URL or explicitly resolved asset location through composition; do not substitute a deeper bootstrap module's URL without adjusting and testing resolution.
- Update NodeNext `.js` import specifiers, literal mock targets, benchmark package scripts, test URL fixtures, and benchmark documentation together with moved files. Preserve benchmark CLI detection and read-only/safety gates; do not run benchmarks against production for this refactor.
- Keep public plugin identifiers, wire schemas, persistent event types, and database object names unchanged.

## Acceptance Criteria

1. Source modules and their tests have the owners shown above; the root executable composes startup and signals without embedded feature handlers or job loops. A short module map documents the dependency rules and extension points.
2. Importing reusable application construction starts no world runtime, job loop, notification listener, HTTP listener, or signal handler. HTTP suites can use the factory without importing the executable or constructing the real database pool.
3. Startup invokes the same configured worlds, jobs, notification bridges, and HTTP routes once per production runtime in the preserved order. Explicit cleanup and signal-driven cleanup reach the same extracted existing cleanup operation.
4. Existing authentication, authorization, active session, cache invalidation, command idempotency/concurrency, room transaction, response projection, realtime recovery, and scheduler scenarios still pass. No request/response or authority boundary changes are introduced.
5. Split suites retain the original integration assertions; fixtures and mocks have explicit ownership, and test helpers are absent from production output.
6. The production build retains executable/database artifacts, serves the PWA from the correct location, and retains API/SPA fallback behavior. Benchmark runner tests verify updated source paths and safety checks without live production traffic.
7. Server tests/typecheck, repository lint, production build/artifact checks, and the available existing real-PostgreSQL integration suites pass. Record environment-dependent skips or unavailable checks rather than treating skipped database suites as passed.

## Risks / Trade-offs

- [Large import churn obscures behavior changes] -> Make mechanical moves first, then extract one responsibility at a time with targeted tests; keep SQL and event-store decomposition out of scope.
- [Changed construction order duplicates or prematurely starts resources] -> Keep one runtime composition owner, preserve scopes, and cover construction versus startup with injected test dependencies.
- [A shared context module becomes a new monolith] -> Keep identity/context resolution separate from route registration, snapshot assembly, and subscription view building.
- [Mock/test migration weakens integration coverage] -> Map original scenarios to their destination suites and preserve assertions before removing the old harness.
- [Moved files break URL-relative assets or executable detection] -> Cover production web resolution and benchmark runners using emitted/source locations as appropriate.
- [A passing mocked suite conceals database regressions] -> Use isolated PostgreSQL for the full suite; some notification tests require `DATABASE_URL` even where other suites gate on `MUDD_TEST_DATABASE_URL`.
- [Factory extraction is mistaken for complete resource disposal] -> State the existing process-scoped resources and cleanup limitations, and defer broader lifecycle guarantees.

## Migration Plan

1. Capture the existing route/scenario and startup ownership baseline. Run focused tests in the available environment and record database prerequisites.
2. Move existing modules/tests into their responsibility folders, updating path consumers together. Preserve executable and database locations.
3. Extract construction, request context, snapshots, route registration, realtime wiring, and background orchestration incrementally. Keep the executable thin and current startup/cleanup behavior intact.
4. Replace the broad HTTP harness with explicit construction/startup/cleanup and split suites by responsibility without losing assertions.
5. Document the resulting boundaries; run focused checks throughout and full integration/build/artifact validation at the end.

No schema or data migration is required. Deploy as a normal server build; revert each stage with its imports/scripts/tests as one unit if needed. Rollback must not require data repair or changes to clients, wire contracts, or plugin IDs. Preserve unrelated web-client OpenSpec changes.
