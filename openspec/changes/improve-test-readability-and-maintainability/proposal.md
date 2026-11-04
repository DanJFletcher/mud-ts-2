# Proposal

## Why

Several test suites obscure the behavior being checked behind shared mutable fixtures, repeated gameplay preparation, permissive casts, and query-order-dependent fakes. Building on the existing WorldClient harness migration will make scenarios easier to understand and failures easier to diagnose while preserving behavioral coverage.

## What Changes

- Continue adopting fresh, typed WorldClient scenarios and replace positional boolean fixture arguments with named options.
- Extract repeated SDK combat preparation into focused package-local helpers while retaining representative journey coverage.
- Separate independent quest validation rules into individually named cases.
- Replace positional query and insert controls in the PostgreSQL append fake with named operation or table-aware controls.
- Type the character plugin registration harness and valid event builders.
- Replace job-start polling with explicit synchronization and guarantee cleanup of engine presence state after failures.
- Preserve regression assertions, test ownership boundaries, integration guarantees, and existing quality budgets throughout incremental migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a behavior-preserving test refactor; `.openspec.yaml` declares `skip_specs: true`. No runtime requirements change.

## Impact

- Web: `apps/web/src/world/WorldClient.test.tsx`, existing `test-support` fixtures, focused destination suites, and the existing test-ownership inventory.
- SDK: `packages/client-sdk/src/combat.test.ts` and package-local test helpers.
- Contracts: `engine-contracts/tests/quests.test.mjs`.
- Server: `apps/server/src/persistence/postgres-event-store.unit.test.ts` and `apps/server/src/app/__tests__/jobs-metrics.integration.test.ts`.
- Plugins and engine: `packages/plugins/src/character-state.test.ts` and `packages/engine-core/src/engine.test.ts`.
- No production behavior, API, database schema, dependency, framework, or coverage-policy changes are intended. Coordinate web edits with `refactor-world-client` and continue rather than reopen the completed harness change.
