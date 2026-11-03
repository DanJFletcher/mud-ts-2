# Proposal

## Why

The server source directory mixes account identity, world orchestration, room services, transport, background jobs, and benchmarks at its root. Its executable entry point also contains most HTTP handlers and runtime composition, while a broadly scoped integration suite is named after NPC announcements; these boundaries make navigation, focused changes, and isolated testing unnecessarily difficult.

## What Changes

- Group existing server modules by responsibility: application composition, authentication, worlds, rooms, realtime, background jobs, and benchmarks. Keep ordinary tests beside their subjects.
- Extract application construction and explicit startup/shutdown from the executable entry point; preserve production startup ordering and resource ownership.
- Extract cohesive HTTP route registration, request identity/context resolution, game snapshot assembly, and realtime setup into narrow modules with explicit dependencies.
- Split the broad HTTP integration suite into accurately named suites using a shared application harness, retaining existing assertions and behavior coverage.
- Rename the broadly used demo event-effects module to reflect its world-wide responsibility without changing its plugin manifest identity.
- Preserve public routes, payloads, authorization, transaction boundaries, event ordering, cache scope, scheduling semantics, and executable paths. Document the resulting module map and dependency rules.

## Capabilities

### New Capabilities

None. This is a behavior-preserving structural refactor. The change declares `skip_specs: true`; acceptance criteria and compatibility checks are recorded in the design and tasks rather than introducing a new runtime capability.

### Modified Capabilities

None. The main capability inventory is empty, and the existing web-client changes remain independent.

## Impact

- Primarily affects `apps/server/src`, its integration harness, and server architecture documentation; benchmark scripts, mocks, and documented invocations may need path updates.
- Keep `src/index.ts`, `dist/index.js`, and the existing database/schema/migration entry-point locations stable. Keep the database and event-store implementation boundaries intact.
- No public API, SDK or engine contract change, schema/data migration, new runtime dependency, package extraction, or gameplay change is planned.
- Implementation is staged as module moves, composition/handler extraction, and integration-test decomposition, with targeted checks between stages.
