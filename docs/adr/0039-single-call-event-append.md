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
- The application still generates event IDs and timestamps, and computes room read models from its cached history. The function writes a room row only for a stream that is a character in that world.
- Only some appends are eligible. These keep the existing transaction:
  - appends with side-table events (character create, rename, archive or restore; object lifecycle);
  - appends with a character stream whose cache doesn't match its expected version;
  - malformed batches.
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
- **Compatibility/migration:** migration 0011 adds the function; migration 0014 gives isolation mismatches the stable `MU001` SQLSTATE. The store checks function availability and isolation once per process, then permanently uses the transaction path if readiness fails or the function reports `42883`/`MU001`.
- **Security/abuse/trust:** the function runs with `SECURITY INVOKER` and a fixed `search_path`. It performs the same checks as the transaction path.
- **Performance/operational:** commit acknowledgment time doesn't change. Development has observed write commits of up to 265 ms. The `event_store.append.single_call` stage shows which path served a request.
- **Rollback/reversibility:** unset `MUDD_SINGLE_CALL_APPEND`. The function can stay in place.

Production startup must not execute DDL. Keep `MUDD_SINGLE_CALL_APPEND` unset until the function is installed and verified through an approved database migration flow. Missing-function and isolation failures use the existing transaction append path.

## Verification

- Unit tests cover:
  - flag off;
  - the request payload (lock set, check order, event versions, effect dedupe keys);
  - outcome mapping;
  - the room read model computed from cache;
  - fallbacks.
- PostgreSQL tests (`single-call-append.integration.test.ts`) cover:
  - one statement per eligible append, with a current room read model;
  - concurrent duplicates producing one event set and identical receipts;
  - the same command racing across both paths;
  - competing writers;
  - stale guards and command-ID reuse;
  - rollback when an effect insert fails.

## Follow-up / revisit trigger

- Enable the flag in development and compare `?muddTrace=1` traces. Keep it unset in production until the database function is installed and verified; a running deployment only receives environment changes after republishing.
- Fold the side-table writes into a v2 function if the remaining transaction appends matter.
