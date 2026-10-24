# Typed client realtime invalidations

## Status
Accepted.

## Context

Polling full snapshots, room chat, active-player presence, invitations, parties,
and cooperative encounters repeats database reads. Replacing HTTP commands or
sending game state from a socket would create a second authority and complicate
idempotency, reconnect ordering, and permission changes.

## Decision

- The SDK owns one authenticated WebSocket per client and multiplexes typed
  channel subscriptions.
- HTTP remains authoritative for every command, initial/current snapshot,
  cursor-based room chat fetch, and recovery after reconnect or a sequence gap.
- A PostgreSQL post-commit notification is only a scoped wakeup. After checking
  the current account/session/character and requested channel, the server sends
  an ordered invalidation with no domain payload. It never executes commands.
- Clients retain polling as a fallback and resume it whenever the socket is
  unhealthy. A reconnect begins with explicit HTTP resynchronization.
- Origin and authenticated-session expiry checks, bounded protocol frames,
  process limits, backpressure handling, and reconnect backoff protect the
  transport.

## Consequences

The transport is replaceable and does not expand engine contracts beyond typed
channel envelopes. Missed notifications cannot lose durable game events because
the client fetches current state and chat cursors over HTTP. Notifications may
coalesce; they signal that state changed rather than preserving every rendered
message. Room chat therefore continues to use its durable HTTP message history.

Each application process needs its own database listener. If a listener drops,
the process reattaches and asks connected clients to recover. Larger fan-out
loads require a measured broker or durable outbox rather than assuming
PostgreSQL notifications provide queue semantics.
