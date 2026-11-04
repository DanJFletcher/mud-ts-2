# Design

## Context

See `proposal.md` for the motivation. `CommandPlan`, `StreamWrite`, and `AppendRequest` currently identify streams only by ID. The PostgreSQL adapter infers character streams from UUID-shaped IDs, while a separate event-type set selects the transaction path for character-directory and object-lifecycle writes.

The single-call function already accepts the caller-computed room-state rows and performs the event, receipt, effect, and room-state writes atomically. It requires `READ COMMITTED`; its post-lock command-receipt lookup must remain a separate statement. The transaction path also updates character and object-lifecycle tables for a small set of events.

## Goals / Non-Goals

**Goals:**

- Make character versus non-character stream identity explicit for primary and companion writes.
- Make transaction-only event materialization and fast-path exclusion one policy.
- Keep both append paths, their locking and idempotency behavior, and the SQL function's input/output contract.
- Make the route decision and cross-path behavior directly testable.

**Non-Goals:**

- Moving more work into `mudd_append_command_v1`, removing either append path, or changing the production flag.
- Changing stored events, database tables, room-state semantics, or gameplay behavior.
- Decomposing the broader `EventStorePort` effect-queue responsibilities.

## Decisions

### 1. Put a required storage role on every planned stream write

Add `streamKind: 'character' | 'non-character'` to `CommandPlan`, `StreamWrite`, and the resulting `AppendRequest` representation. The engine passes it through for both player and system dispatch. Every companion write carries its own kind; guards remain read-only and do not need one.

The PostgreSQL adapter uses `character` to select streams for room-state reconstruction and `non-character` to omit them. It no longer treats ID syntax as semantic identity. These two values describe the storage behavior relevant to this adapter rather than enumerating every plugin's aggregate types; custom plugin streams use `non-character` unless they participate in the core character projection.

The field is required and validated at dispatch. Missing or invalid metadata must fail visibly rather than silently omit a character room-state update. Since the host checks an exact plugin `apiVersion`, this required command-plan contract is a breaking plugin API change: bump the host API version and update bundled plugin manifests in the same release. Do not add a compatibility path that retains UUID inference.

**Alternative considered:** a database lookup or server-maintained stream registry could avoid changing command plans, but would add lookup/cache synchronization complexity and leave stream identity outside the command that declares the write.

### 2. Couple side-table policy to its materializer

Replace the standalone side-table event set and append-time event switch with a PostgreSQL materializer registry. Each entry identifies the event type, declares that it requires the transaction path, and performs that event's table write inside the existing append transaction. The route selector derives transaction-only eligibility from this registry; there is no separate list to update.

Keep the registry PostgreSQL-specific. Do not make plugin command plans declare database table operations, and do not send materializer metadata to the SQL function. The function continues to receive only the common append data and prepared room-state rows.

**Alternative considered:** moving rare side-table writes into a new SQL-function version would make all appends eligible for one call, but enlarges the database function and changes its deployment contract without a demonstrated need.

### 3. Make routing a pure, inspectable decision

Represent eligibility as a route decision with a stable reason, such as feature disabled, unsupported batch shape, stale or missing character cache, transaction-only materializer, or eligible. Keep the environment flag as the top-level switch. The route decision must not change ordering, sorted stream locks, guard checks, receipt lookup, or the atomic boundary.

The explicit `streamKind` is consumed in TypeScript when preparing room-state rows. It does not need to be added to the PostgreSQL function's JSON request, so the SQL function contract remains unchanged.

**Alternative considered:** leaving eligibility checks inline would preserve current behavior but make the policy harder to unit test and easier to let drift from materializer behavior.

### 4. Verify parity without replacing concurrency tests

Keep existing idempotency, lock-order, cross-path race, stale-guard, and rollback coverage. Add:

- engine tests proving player and system dispatch propagate the primary and companion kinds;
- adapter tests proving UUID-shaped non-character streams do not produce character room rows and character streams do;
- route-policy tests proving each registered materializer forces the transaction path;
- PostgreSQL conformance tests that execute equivalent eligible requests through the single-call and transaction paths and compare receipts, events, effects, room rows, and applicable materialized tables.

The parity suite supplements rather than replaces the existing concurrency tests; it does not assert that implementation details are identical.

## Risks / Trade-offs

- **Bundled and external plugins must adopt the new required field** → bump and validate the plugin host API version; update every bundled command plan and fail clearly for stale plugin contracts.
- **A character write is mislabeled non-character** → require metadata in the type contract and validate representative command and companion-write paths in both dispatch modes.
- **A side-table event is added without a materializer** → keep all append-time table writes inside the registry, and test each registered table-backed event's routing and write behavior.
- **The two append implementations can still diverge in common append semantics** → keep the PostgreSQL parity suite and all existing cross-path concurrency tests.

## Migration Plan

1. Update engine contracts, dispatch propagation, and all bundled plugin plans together; bump the plugin host API version.
2. Replace inferred stream identity and the split side-table classification/write logic with explicit metadata and the materializer registry.
3. Run unit tests and the PostgreSQL integration suite with the single-call flag both disabled and enabled. Confirm the existing one-statement test still passes.
4. Deploy the application and bundled plugins together. No database migration or event-history rewrite is required.
5. If the fast path misbehaves after deployment, disable `MUDD_SINGLE_CALL_APPEND` to route appends through the transaction path. To roll back the contract change, roll back the host and bundled plugin release together.
