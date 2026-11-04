# Design

## Context

See `proposal.md` for the motivation. `PostgresEventStore` currently implements `EventStorePort` and also owns PostgreSQL worker operations for durable effects and expiring world objects. Its append paths write queued effects and lifecycle state in the same transaction as events and receipts; that atomicity is a constraint on the split.

The adapter uses the shared `db` client directly, and server dependencies currently expose the concrete `PostgresEventStore`. Keep that construction pattern and its external methods stable in this refactor.

## Goals / Non-Goals

**Goals:**

- Give durable-effect worker operations and object-lifecycle claims separate internal persistence boundaries.
- Preserve `PostgresEventStore` as the existing `EventStorePort` façade.
- Make the object-lifecycle scheduler depend only on the operations it uses.
- Keep current SQL behavior, transaction boundaries, validation, and lease semantics.

**Non-Goals:**

- Splitting stream reads, caches, room-state projections, or append routing.
- Moving effect creation or lifecycle materialization out of append transactions.
- Changing `EventStorePort`, database schema, migrations, retry policy, or scheduler timing.
- Introducing dependency injection or a new public persistence API.

## Decisions

### Keep the event-store façade and delegate worker methods

Keep `PostgresEventStore` implementing `EventStorePort`. Add internal repositories for durable effects and object lifecycles, and have the façade delegate the corresponding methods. This avoids changing engine callers or server dependency construction.

Alternatives considered:

- Constructing and injecting separate repositories throughout the server would widen the refactor into bootstrap and dependency wiring.
- Making the repositories implement or replace `EventStorePort` would expose persistence details to engine callers without a behavioral need.

### Extract worker operations, not append-side writes

The durable-effect repository owns effect claiming, lease settlement, retry, and dead-letter operations. The object-lifecycle repository owns due-item claiming and claim release. Keep durable-effect inserts and lifecycle materializer updates in the existing append transaction code.

This keeps event rows, command receipts, queued effects, and lifecycle projections atomic. The `commandEffectKeyPrefix` format is used both by append paths and command-scoped claiming, so keep it as a shared internal helper rather than duplicating its logic.

Alternatives considered:

- Moving all table access for each concern would also move append-time writes across a transaction boundary, risking partial commits.
- Extracting append routing at the same time would couple this work to cache and room-state projection behavior and make failures harder to isolate.

### Narrow the object-lifecycle scheduler dependency

Define a small server-side interface for `claimDueObjectLifecycles` and `releaseObjectLifecycleClaim`, and type the scheduler against it. `PostgresEventStore` remains structurally compatible and can continue to be passed by the existing runtime scheduler.

Keep the interface out of engine-core: object-lifecycle leasing is a PostgreSQL server worker concern, not a client-independent engine contract.

### Preserve database access and test the façade

Continue using the shared database client. Keep PostgreSQL integration coverage through `PostgresEventStore` so tests verify repository delegation as well as persistence behavior. Move focused SQL/unit tests into repository-specific test files where that improves ownership; do not replace the existing integration tests for worker leases, retries, and restart recovery.

## Risks / Trade-offs

- **Risk:** A delegation mistake could change a worker method's return value or error behavior. → Keep signatures identical and run existing unit and PostgreSQL integration tests through the façade.
- **Risk:** Append-time effect or lifecycle writes could accidentally move out of their transaction. → Explicitly leave materializers and effect insertion in append code; retain atomicity tests.
- **Risk:** Splitting tests could reduce coverage of interactions. → Preserve integration tests that exercise the complete `PostgresEventStore` path and move only isolated unit assertions.
- **Trade-off:** `PostgresEventStore` remains a façade with several responsibilities and concrete dependencies. → This is an incremental boundary; stream caching, projections, and append strategy remain deliberately out of scope.

## Migration Plan

This is a code-only refactor with no schema or data migration. Deploy through the normal application release process. Rollback is a code revert; persisted data remains compatible because SQL and table layouts do not change.

## Open Questions

None.
