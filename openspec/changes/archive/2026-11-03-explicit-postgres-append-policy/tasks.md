# Tasks

## 1. Version and propagate explicit stream metadata

- [x] 1.1 Add required `streamKind` metadata to `CommandPlan`, `StreamWrite`, and `AppendRequest`; bump the engine host API version and update bundled plugin manifests. Verify stale or missing metadata is rejected and host/plugin API-version tests pass.
- [x] 1.2 Mark every bundled player-command primary and companion write as `character` or `non-character`. Verify the engine dispatch tests show the metadata reaches the event store unchanged.
- [x] 1.3 Mark every bundled system-command primary and companion write with its stream kind. Verify system dispatch tests cover the primary and companion metadata and the engine typecheck passes.
- [x] 1.4 Update the plugin command-plan contract documentation and migration notes for the API-version change. Verify a plugin author can identify which kind to use for character and custom streams.

## 2. Make PostgreSQL routing and materialization explicit

- [x] 2.1 Remove UUID-shape inference from room-state projection selection and use each write's explicit kind instead. Verify adapter unit tests cover character streams and UUID-shaped non-character streams.
- [x] 2.2 Replace the separate side-table event list and append-time write branches with a registry that couples transaction-only routing to each PostgreSQL materializer. Verify each registered materializer writes its table data in the transaction path and cannot use the single-call path.
- [x] 2.3 Extract and test a pure append-route decision with stable fallback reasons. Verify feature-disabled, unsupported-batch, uncached-character, and transaction-only-materializer cases select the expected route.

## 3. Verify append-path parity

- [x] 3.1 Add PostgreSQL integration coverage that runs equivalent eligible requests through the single-call and transaction paths and compares receipts, events, durable effects, and room-state rows. Verify companion writes are included.
- [x] 3.2 Run the PostgreSQL append integration suite with the fast path both disabled and enabled. Verify the existing one-statement assertion, cross-path concurrency cases, idempotency cases, stale-guard behavior, and rollback tests still pass.
