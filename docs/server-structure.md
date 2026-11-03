# Server module ownership

## Preservation baseline

The original HTTP integration suite contained 70 scenarios. The checklist below records the source scenarios before decomposition; destination suites are recorded during migration.

- starts a guest session and accepts its cookie on account APIs
- serves health checks and prevents signed-in users from starting guest sessions
- routes guest-session creation failures through standard error handling
- emits structured measurements for an explicitly traced snapshot request
- forwards session-entry and session-leave storage failures to error handling
- lists registered worlds without requiring an account
- lists only the signed-in player’s characters and selected world sessions
- loads a character roster through the event store batch-read API
- rejects unauthenticated, unavailable-world, and malformed chat requests
- rejects room chat reads and writes for a defeated character
- maps chat persistence races to room-changed and message-ID-conflict responses
- validates character command schemas and selected-world ownership before dispatch
- rejects archiving the active character and commands for another player’s character
- returns a request-scoped server error for command dispatch failures
- routes thrown command dispatch errors through the request error handler
- keeps game, chat, and interaction stream read failures behind the request error handler
- routes thrown room-chat submissions through the request error handler
- fails closed when party or team-combat prechecks return invalid projections
- routes party members to cooperative controls instead of solo combat
- keeps a successful move response when its location projection fails or throws
- settles and returns the game projection with world commands only for clients that ask
- includes a settled victory corpse and its loot in the same game projection
- withholds the projection when a command’s own effects cannot be settled
- returns opted-in moves the game projection field and keeps it for older clients
- requires an active world character and rejects chat requests for another room
- validates world-session requests and reports unavailable characters
- rejects world entry for defeated characters and blocks switching while occupied
- returns a game snapshot only after a character enters the world
- clears the cached world session after archiving a character
- reuses a warm world session and invalidates it on membership notifications
- projects room-specific fishing, woodcutting, and bulletin-board options
- initializes a missing wallet when building a snapshot for a currency world
- fails explicitly when a character row has no creation event in its stream
- fails explicitly when an owned character references an unregistered world
- reports unavailable characters and location/stat projection failures in game snapshots
- refreshes an active session heartbeat and removes only the leaving player session
- rejects archived or defeated heartbeat characters and handles stream failures
- returns a conflict when a stale heartbeat cannot re-read its character
- retries stamina-anchor conflicts and safely reports exhaustion
- reports non-conflict stamina-anchor failures without retrying them
- logs durable-effect failures and prevents overlapping batches
- refreshes stale presence and resets recovery when heartbeating or re-entering
- binds world commands to the active character and rejects PvP actions without an encounter
- requires an interaction recipient and rejects players who are not online
- restricts active PvP sessions to PvP actions
- restricts active team combat to combat actions while allowing party departure
- rejects world actions for zero-health and defeated characters
- validates world queries and enriches location descriptions for the active character
- rejects queries for inactive characters and maps engine query errors to HTTP statuses
- uses the current request ID when an internal query error has no correlation ID
- returns safe status codes and request IDs for unexpected route errors
- returns a specific error when JSON request bodies exceed the configured limit
- returns an interaction inbox for the active character
- rejects unsafe real-time origins and closes subscriptions for unavailable worlds
- reuses active world sessions when realtime clients reconnect
- reports autonomous scheduler errors
- lists recovery sessions and reports stamina scheduler failures
- checks registered-world access and character ownership against the account
- reports lifecycle failures with or without a specific world object
- expires and cancels stale interaction requests on the scheduled maintenance tick
- publishes once on entry, shares it with that room, and hides it from other rooms
- routes NPC movement announcements to terminal updates instead of room chat
- lets an NPC answer a matching public room message and shares the reply with room occupants
- rejects cross-origin state-changing requests before they mutate room chat
- returns a bounded request-body error with a request ID
- announces on successful movement into an NPC room and applies the arrival cooldown
- does not announce when movement enters a room without an announcing NPC
- does not re-run NPC entry effects for a successful idempotent movement retry
- deduplicates NPC announcements for a shared party arrival
- closes the server from its SIGTERM handler

## Startup and resource ownership

Configuration validation precedes database warmup, room-state rebuilding, world startup, worker startup, HTTP/realtime assembly, and listening. The executable owns signal wiring; runtime composition owns existing cleanup. Database and metrics modules retain process-scoped resources. Existing shutdown does not promise full worker/HTTP draining, startup rollback beyond the world registry, or repeatable in-process restart.

## Baseline validation

Focused world registry, realtime, scheduler, web serving, and HTTP integration suites: 8 files, 121 tests passed with a local-only configuration URL. Server typecheck passed. The initial run without DATABASE_URL failed during world-registry import; full integration checks require isolated PostgreSQL and both DATABASE_URL and MUDD_TEST_DATABASE_URL.

## Module map and dependency rules

| Directory | Responsibility |
| --- | --- |
| `app` | HTTP middleware, construction, production bootstrap, metrics, executable signal adapter, integration harness |
| `auth` | Account identity, authorization, request context and guest routes |
| `worlds` | World registry/membership, snapshots, maps/catalogs and world/character/game routes |
| `rooms` | Chat, presence, NPC announcements and durable world event effects |
| `realtime` | Socket gateway, subscription views and PostgreSQL invalidation bridge |
| `jobs` | NPC/recovery/lifecycle schedulers, durable effect processing and interaction maintenance |
| `benchmarks` | Explicitly invoked benchmark programs and safety/runner tests |
| `db`, `persistence` | Existing schema, SQL/migration runners and event-store adapter |

The executable composes the runtime. Feature route modules accept narrow explicit dependency objects and never import the executable or bootstrap. HTTP and realtime share the account/world request-context functions; snapshots own game projection assembly, and existing engine/plugins retain command authority. Dependency types are erased; they do not load real database modules when constructing an isolated application. Ordinary tests stay beside their modules.

The executable path remains `src/index.ts` / `dist/index.js`. Database schema and compiled migration/cleanup runner paths stay stable. Production web hosting receives the executable URL; its relative URL is deliberately independent of the deeper application helper location. Metrics are process-scoped and preserve their existing module-level monitor.

## Relocation verification

After mechanical moves: all 51 server suites and 437 tests passed against a disposable PostgreSQL 16 database. A moved production asset helper initially exposed a caller-relative URL regression; retaining the original executable-relative asset URL restored existing behavior. No live production database or benchmark traffic was used.

## HTTP scenario destinations

The original 70 scenarios now run through the shared explicit-startup harness. The final HTTP-close scenario calls runtime cleanup directly; executable signal wiring has separate smoke coverage.

| Original scenario | Destination suite |
| --- | --- |
| starts a guest session and accepts its cookie on account APIs | `auth-security.integration.test.ts` |
| serves health checks and prevents signed-in users from starting guest sessions | `auth-security.integration.test.ts` |
| routes guest-session creation failures through standard error handling | `auth-security.integration.test.ts` |
| emits structured measurements for an explicitly traced snapshot request | `jobs-metrics.integration.test.ts` |
| forwards session-entry and session-leave storage failures to error handling | `world-sessions.integration.test.ts` |
| lists registered worlds without requiring an account | `world-sessions.integration.test.ts` |
| lists only the signed-in player’s characters and selected world sessions | `world-sessions.integration.test.ts` |
| loads a character roster through the event store batch-read API | `world-sessions.integration.test.ts` |
| rejects unauthenticated, unavailable-world, and malformed chat requests | `rooms.integration.test.ts` |
| rejects room chat reads and writes for a defeated character | `rooms.integration.test.ts` |
| maps chat persistence races to room-changed and message-ID-conflict responses | `rooms.integration.test.ts` |
| validates character command schemas and selected-world ownership before dispatch | `game-commands-queries.integration.test.ts` |
| rejects archiving the active character and commands for another player’s character | `game-commands-queries.integration.test.ts` |
| returns a request-scoped server error for command dispatch failures | `game-commands-queries.integration.test.ts` |
| routes thrown command dispatch errors through the request error handler | `game-commands-queries.integration.test.ts` |
| keeps game, chat, and interaction stream read failures behind the request error handler | `game-commands-queries.integration.test.ts` |
| routes thrown room-chat submissions through the request error handler | `rooms.integration.test.ts` |
| fails closed when party or team-combat prechecks return invalid projections | `game-commands-queries.integration.test.ts` |
| routes party members to cooperative controls instead of solo combat | `game-commands-queries.integration.test.ts` |
| keeps a successful move response when its location projection fails or throws | `game-commands-queries.integration.test.ts` |
| settles and returns the game projection with world commands only for clients that ask | `game-commands-queries.integration.test.ts` |
| includes a settled victory corpse and its loot in the same game projection | `game-commands-queries.integration.test.ts` |
| withholds the projection when a command’s own effects cannot be settled | `game-commands-queries.integration.test.ts` |
| returns opted-in moves the game projection field and keeps it for older clients | `game-commands-queries.integration.test.ts` |
| requires an active world character and rejects chat requests for another room | `rooms.integration.test.ts` |
| validates world-session requests and reports unavailable characters | `world-sessions.integration.test.ts` |
| rejects world entry for defeated characters and blocks switching while occupied | `world-sessions.integration.test.ts` |
| returns a game snapshot only after a character enters the world | `game-commands-queries.integration.test.ts` |
| clears the cached world session after archiving a character | `world-sessions.integration.test.ts` |
| reuses a warm world session and invalidates it on membership notifications | `world-sessions.integration.test.ts` |
| projects room-specific fishing, woodcutting, and bulletin-board options | `game-commands-queries.integration.test.ts` |
| initializes a missing wallet when building a snapshot for a currency world | `game-commands-queries.integration.test.ts` |
| fails explicitly when a character row has no creation event in its stream | `world-sessions.integration.test.ts` |
| fails explicitly when an owned character references an unregistered world | `world-sessions.integration.test.ts` |
| reports unavailable characters and location/stat projection failures in game snapshots | `game-commands-queries.integration.test.ts` |
| refreshes an active session heartbeat and removes only the leaving player session | `world-sessions.integration.test.ts` |
| rejects archived or defeated heartbeat characters and handles stream failures | `world-sessions.integration.test.ts` |
| returns a conflict when a stale heartbeat cannot re-read its character | `world-sessions.integration.test.ts` |
| retries stamina-anchor conflicts and safely reports exhaustion | `world-sessions.integration.test.ts` |
| reports non-conflict stamina-anchor failures without retrying them | `world-sessions.integration.test.ts` |
| logs durable-effect failures and prevents overlapping batches | `jobs-metrics.integration.test.ts` |
| refreshes stale presence and resets recovery when heartbeating or re-entering | `world-sessions.integration.test.ts` |
| binds world commands to the active character and rejects PvP actions without an encounter | `game-commands-queries.integration.test.ts` |
| requires an interaction recipient and rejects players who are not online | `game-commands-queries.integration.test.ts` |
| restricts active PvP sessions to PvP actions | `game-commands-queries.integration.test.ts` |
| restricts active team combat to combat actions while allowing party departure | `game-commands-queries.integration.test.ts` |
| rejects world actions for zero-health and defeated characters | `auth-security.integration.test.ts` |
| validates world queries and enriches location descriptions for the active character | `game-commands-queries.integration.test.ts` |
| rejects queries for inactive characters and maps engine query errors to HTTP statuses | `game-commands-queries.integration.test.ts` |
| uses the current request ID when an internal query error has no correlation ID | `game-commands-queries.integration.test.ts` |
| returns safe status codes and request IDs for unexpected route errors | `auth-security.integration.test.ts` |
| returns a specific error when JSON request bodies exceed the configured limit | `auth-security.integration.test.ts` |
| returns an interaction inbox for the active character | `game-commands-queries.integration.test.ts` |
| rejects unsafe real-time origins and closes subscriptions for unavailable worlds | `realtime.integration.test.ts` |
| reuses active world sessions when realtime clients reconnect | `realtime.integration.test.ts` |
| reports autonomous scheduler errors | `jobs-metrics.integration.test.ts` |
| lists recovery sessions and reports stamina scheduler failures | `jobs-metrics.integration.test.ts` |
| checks registered-world access and character ownership against the account | `world-sessions.integration.test.ts` |
| reports lifecycle failures with or without a specific world object | `jobs-metrics.integration.test.ts` |
| expires and cancels stale interaction requests on the scheduled maintenance tick | `jobs-metrics.integration.test.ts` |
| publishes once on entry, shares it with that room, and hides it from other rooms | `game-commands-queries.integration.test.ts` |
| routes NPC movement announcements to terminal updates instead of room chat | `rooms.integration.test.ts` |
| lets an NPC answer a matching public room message and shares the reply with room occupants | `rooms.integration.test.ts` |
| rejects cross-origin state-changing requests before they mutate room chat | `rooms.integration.test.ts` |
| returns a bounded request-body error with a request ID | `game-commands-queries.integration.test.ts` |
| announces on successful movement into an NPC room and applies the arrival cooldown | `rooms.integration.test.ts` |
| does not announce when movement enters a room without an announcing NPC | `rooms.integration.test.ts` |
| does not re-run NPC entry effects for a successful idempotent movement retry | `rooms.integration.test.ts` |
| deduplicates NPC announcements for a shared party arrival | `rooms.integration.test.ts` |
| closes the server from its SIGTERM handler | `runtime.integration.test.ts` |

## Harness usage

Call `useServerHarness()` inside a suite to register setup/reset/teardown. Its getter exposes the bound ephemeral listener URL, and its helpers send real HTTP requests through the application. The fixture injects worker intervals instead of replacing global timers, and explicitly shuts down the runtime and its test-owned intervals. Only executable signal tests inspect signal wiring. Test helpers under `app/__tests__` are excluded from production TypeScript output.

## Construction and lifecycle APIs

- [createApplication](../apps/server/src/app/create-app.ts) builds middleware and routes from injected dependencies. It neither creates a real pool nor starts workers, LISTEN, HTTP listening, or signal handlers. Two constructions share nothing except dependencies deliberately supplied by their owner and existing process-level instrumentation.
- [startServer](../apps/server/src/app/bootstrap.ts) owns production readiness and startup: database warmup, room-state rebuilding, world startup, scheduler reseeding/start, effect and interaction passes, route/realtime assembly, notification bridge, then listening. It returns the HTTP server and existing cleanup operation. Configuration or readiness rejection prevents listening.
- [installProcessSignals](../apps/server/src/app/process-signals.ts) connects SIGTERM/SIGINT to that cleanup. The stable executable alone invokes it in production; tests exercise it separately.
- [Request context](../apps/server/src/auth/request-context.ts) resolves account/world/character identity for HTTP and realtime. [Game snapshots](../apps/server/src/worlds/game-snapshot.ts) own enrichment and response projection assembly.
- [Effect processing](../apps/server/src/jobs/effect-processing.ts) retains the initial pass, 25-item batches, eight-pass cap, 50ms wakeup debounce and five-second fallback. [Interaction maintenance](../apps/server/src/jobs/interaction-maintenance.ts) retains startup coverage of every world, two-second active-world polls and nonoverlap. Both accept timer dependencies for deterministic tests.

Existing production cleanup still does not clear the interaction interval or unsubscribe world activity, and does not await every listener/worker drain. The test harness clears its own injected intervals; this is test resource ownership, not a new production shutdown guarantee. Database pool and metrics instrumentation remain process-scoped.

## Extending the server

Add world/game HTTP behavior under the relevant world route module, or room/chat behavior under room routes, then register it in application construction with the smallest dependency subset it needs. Keep account authorization in request context, projections in snapshot modules, and authoritative transitions in existing engine/plugins. Register additional jobs in bootstrap rather than starting them at feature-module import time. Test a feature beside its module and HTTP integration through the shared harness.
