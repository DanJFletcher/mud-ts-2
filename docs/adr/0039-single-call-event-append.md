# ADR 0039 — Single-call event append

- **Status:** Accepted
- **Date:** 2026-10-30
- **Owners:** Engine persistence
- **Related tasks:** [Implementation plan](../implementation-plans/single-call-event-append.md), [round-trip latency audit](../performance/round-trip-latency-audit.md)

## Context

`PostgresEventStore.append` committed each command with 9–10 statements in one transaction, each its own round trip. At the roughly 27 ms per round trip measured in production, the append alone costs about 250 ms per command.

The receipt lookup has to run as a separate statement after the command advisory lock. Otherwise it can use a snapshot taken before it waited on the lock and miss a concurrent duplicate's receipt ([postgres-command-idempotency.md](../../.agents/memory/postgres-command-idempotency.md)).

## Decision

- A PL/pgSQL function, `mudd_append_command_v1(p_request jsonb)`, performs the append steps in the same order as the transaction path:
  1. lock the command ID;
  2. look up its receipt;
  3. lock the streams in sorted order;
  4. check guard, companion and primary revisions;
  5. insert the events, receipt, effects and room read models.
- The function is `VOLATILE` and checks that it runs under `READ COMMITTED`. Each statement in it therefore takes a fresh snapshot, and the receipt lookup sees any duplicate that committed while the call waited.
- The store calls the function in autocommit, so one statement is one transaction and one round trip.
- Both paths derive advisory-lock keys from the same strings, so they serialize against each other.
- Every primary and companion write declares `streamKind`. The application computes character room rows only for `character` streams, regardless of the ID's shape; `non-character` streams never become character projections merely because an ID resembles a UUID.
- The application still generates event IDs and timestamps, and computes eligible room read models from its cached history. The function writes the supplied room rows atomically.
- PostgreSQL transaction-only writes are registered with their materializers, so route eligibility and side-table updates cannot drift apart. Character-directory and object-lifecycle materializers stay in the transaction path.
- A pure route decision selects the function or transaction path with a stable reason. Character writes whose cached revision does not match, duplicate or empty write batches, transaction-only materializers, and disabled fast-path settings use the transaction path.
- `MUDD_SINGLE_CALL_APPEND=1` enables the fast path. Tests can choose a path with the store's `singleCallAppend` option.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| One data-modifying CTE | Plain SQL | One snapshot for the whole statement, which breaks the lock-then-read rule |
| Pipelining (pg 8.23 `pipeline: true`) | No new database object | The steps depend on each other's results, so they can't be sent ahead |
| Move side-table writes into the function | Every append takes one round trip | Larger function for rare commands; deferred |

## Consequences and trade-offs

- **Positive:** eligible commands save 8–9 round trips each, about 220–240 ms at production latency.
- **Negative:** append logic now exists in two places, and the paths must be kept in step.
- **Compatibility/migration:** the required `streamKind` field bumps the exact engine host API to 2.0; bundled and external plugins must update their manifests and plans. The SQL function and event format do not change, and no database migration is required for this policy refactor.
- **Security/abuse/trust:** the function runs with `SECURITY INVOKER` and a fixed `search_path`. It performs the same checks as the transaction path.
- **Performance/operational:** commit acknowledgment time doesn't change. Development has observed write commits of up to 265 ms. The `event_store.append.single_call` stage shows which path served a request.
- **Rollback/reversibility:** unset `MUDD_SINGLE_CALL_APPEND`. The function can stay in place.

## Verification

- Unit tests cover:
  - flag off;
  - the request payload (lock set, check order, event versions, effect dedupe keys);
  - outcome mapping;
  - the room read model computed from cache;
  - explicit character/non-character classification, including non-UUID character IDs and UUID-shaped shared IDs;
  - each stable route reason and transaction-only materializer fallback.
- PostgreSQL tests (`single-call-append.integration.test.ts`) cover:
  - one statement per eligible append, with a current room read model;
  - concurrent duplicates producing one event set and identical receipts;
  - the same command racing across both paths;
  - competing writers;
  - stale guards and command-ID reuse;
  - rollback when an effect insert fails;
  - event, receipt, effect, and room-state parity across eligible append paths.

## Follow-up / revisit trigger

- Enable the flag in development and compare `?muddTrace=1` traces, then enable it in production.
- Fold the side-table writes into a v2 function if the remaining transaction appends matter.
