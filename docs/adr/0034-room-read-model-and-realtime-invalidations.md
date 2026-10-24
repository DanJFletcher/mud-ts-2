# Transactional room read models and realtime invalidations

## Status
Accepted.

## Context

Chat authorization and presence lookup replayed entire character streams. Shared
interaction, party, and cooperative-combat queries also repeatedly projected
long immutable event histories. HTTP polling amplified these reads, but replacing
it with a socket carrying authoritative state would weaken the engine boundary,
event ordering, and recovery guarantees.

## Decision

- Maintain a minimal, rebuildable character-room read model in the same
  transaction as its event append. It contains only fields needed for room
  authorization and occupant eligibility. It is never the source of truth.
- Verify a room model against the indexed event-stream head before using it for
  authorization. Missing, mismatched, or unsupported models fail closed.
- Keep history reconstruction and command handling in the event-sourced engine.
  Incremental projections are keyed only to adapter-registered immutable event
  arrays, extend from exact known prefixes, and are disposable.
- Treat PostgreSQL `NOTIFY` as a post-commit, payload-free routing wakeup. A
  gateway re-authenticates and compares only channels requested by that
  connection. It emits an ordered, scoped invalidation, never a command or game
  state. The current HTTP read endpoints recover the state and chat cursor.
- Use one additive-subscription WebSocket per SDK client. Origin checks, bounded
  frames, backpressure closes, authentication expiry, scoped subscriptions, and
  reconnect backoff limit the transport. HTTP remains the fallback whenever the
  socket is not healthy, and reconnects explicitly request HTTP resynchronization.

## Consequences

- Room chat and presence avoid character-event replay, and room presence is a
  single indexed query rather than a fan-out over all recently active players.
- Shared projections can extend from the exact immutable prefix and indexed
  reads avoid copying unrelated requests, group activity, and encounters.
- The room table can be rebuilt from the event log. It must not be used to
  mutate gameplay, authorize commands without checking stream freshness, or
  replace engine-owned projections.
- Notifications are deliberately ephemeral: clients recover from authoritative
  HTTP state after gaps or reconnects. They are not a durable event feed.
- Multi-process deployments must give each process its own PostgreSQL `LISTEN`
  client; database notifications carry invalidation hints across instances.

## Verification

The disposable PostgreSQL integration suite covers stale-model fail-closed and
rebuild behavior, post-commit wakeup payloads, and the existing command
idempotency/concurrency cases. SDK and gateway tests cover scope, ordering gaps,
invalid frames, reconnect recovery, and HTTP fallback.
