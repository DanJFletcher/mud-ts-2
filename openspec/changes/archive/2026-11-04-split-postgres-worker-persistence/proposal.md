# Proposal

## Why

`PostgresEventStore` combines event storage with worker-facing persistence for durable effects and expiring world objects, making these responsibilities harder to understand and test independently. Separating the worker operations will clarify the persistence boundaries without changing runtime behavior or the existing event-store contract.

## What Changes

- Extract durable-effect claiming and settlement operations into an internal PostgreSQL repository.
- Extract world-object lifecycle claim and release operations into an internal PostgreSQL repository.
- Keep `PostgresEventStore` as the existing event-store façade and delegate worker operations to the repositories.
- Give the object-lifecycle scheduler a narrow storage interface instead of depending on the concrete event-store class.
- Keep effect insertion, lifecycle materialization, and all other append-related writes inside their current append transactions.
- Preserve current schemas, SQL semantics, lease behavior, retry behavior, and public APIs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a behavior-preserving refactor; `.openspec.yaml` sets `skip_specs: true`.

## Impact

Affected areas are `apps/server/src/persistence/postgres-event-store.ts`, new persistence modules, the object-lifecycle scheduler, and their unit and PostgreSQL integration tests. No engine-core contract, database schema, migration, or dependency changes are planned.
