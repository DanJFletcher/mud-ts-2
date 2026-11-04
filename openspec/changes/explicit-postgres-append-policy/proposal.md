# Proposal

## Why

The PostgreSQL event store chooses append paths partly by inferring character streams from UUID-shaped IDs and by maintaining a separate list of event types that require transactional side-table writes. These implicit rules can drift as new streams and event materializers are added. The goal is to keep the measured single-call latency benefit while making routing and projection policy explicit and testable.

## What Changes

- Add explicit stream metadata to primary and companion writes in command plans, and propagate it through player and system dispatch to the event store.
- Use that metadata instead of ID shape to decide whether to compute character room-state projections.
- Consolidate transaction-only side-table eligibility and its corresponding writes into a PostgreSQL materializer registry.
- Retain both the single-call append and transaction fallback, preserving idempotency, locking, atomicity, and current event formats.
- Add cross-path parity and policy-completeness tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an internal persistence refactor; no product behavior or durable event format is intended to change.

## Impact

- `packages/engine-core` command-plan and append-request types, including companion writes.
- `apps/server` PostgreSQL event-store routing and side-table materialization.
- Existing single-call append SQL function remains in place unless parity investigation finds a required correction.
- Engine and PostgreSQL persistence tests. No database schema or event-history migration is planned.
