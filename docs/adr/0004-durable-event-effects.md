# ADR 0004: Durable, at-least-once event effects

- **Status:** Accepted for the current server-backed engine.
- **Date:** 2026-10-18
- **Owners:** MUDD engine and server

## Context

Committed commands can cause work outside their authoritative event append, such as a room-entry announcement. Room chat is stored separately from character streams, but an accepted player message can also trigger a public NPC reply. Running these effects only in the HTTP request leaves a loss window if the process stops after the source write commits.

## Decision

- A command plan may include versioned `ProposedEventEffect` intents. The event-store adapter commits those intents in the same PostgreSQL transaction as the source events and command receipt.
- The server stores effects in a durable outbox with a stable ID, source command/stream, contract type and version, validated JSON payload, deduplication key, claim lease, attempt count, retry time, and terminal status.
- Effects are delivered at least once. A worker claims records with `FOR UPDATE SKIP LOCKED`, uses a lease token to fence stale workers, retries transient failures with capped backoff, and dead-letters unknown or invalid contracts and exhausted retries.
- Plugins register versioned Zod schemas and handlers through `PluginContext.registerEffect`. Handler code is responsible for idempotency keyed by the stable effect ID; this is not an exactly-once execution guarantee.
- NPC room-entry announcements use a `world.location.entered` effect produced by movement and world-session entry. Player room-chat messages enqueue a `room-chat.player-message` effect in the same transaction as the message. The demo-world plugin consumes both and associates published NPC messages with the source effect ID.
- The current demo app polls pending effects on startup, after state-changing HTTP requests, and on a short interval. No client protocol changes are required.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Keep effects inline after commit | Smallest change and immediate response | A process failure can permanently lose an effect; duplicate command retries are not a reliable recovery mechanism. |
| Run handlers inside the event transaction | No commit-to-effect gap | Long-running or external work would hold aggregate locks and couple game commits to handler availability. |
| Durable outbox with at-least-once delivery | Survives restart, supports retries, and keeps source commits independent of handler uptime | Requires idempotent consumers, lease/retry policy, storage, and future dead-letter operations. |

## Consequences and trade-offs

- **Positive:** Movement announcements and NPC room-chat reactions survive a process restart after the source action commits. Event intent and event append cannot commit separately in PostgreSQL.
- **Positive:** Handler schemas are Zod-validated at delivery, and plugin handlers do not need direct database access.
- **Negative:** Effects may be delivered more than once. Every handler that publishes or mutates data must use the effect ID as an idempotency key.
- **Compatibility/migration:** Adds `durable_effects` and an optional `source_effect_id` on room messages. Existing room messages remain valid; no player, character, or world data is deleted.
- **Security/abuse/trust:** Effect payloads are server-authored and are revalidated before use. Raw handler exception text is not sent to clients or logs.
- **Performance/operational:** Workers use leases and `SKIP LOCKED` for concurrent server instances. Effects that fail 10 delivery attempts become dead-lettered; an operator-facing inspection/replay tool is not included yet.
- **Rollback/reversibility:** The migration is additive. Rollback requires draining or preserving pending effects before removing the table; do not drop it while work is pending.

## Verification

- Engine tests prove command idempotency does not enqueue duplicate effects and a failed handler can be retried.
- PostgreSQL integration tests prove effect and event atomicity, lease exclusion, retry after a new store instance, and idempotent NPC message publication.
- Movement/chat integration tests prove effects still produce the existing room announcements and replies.

## Follow-up / revisit trigger

Add operator visibility and replay controls before relying on effects for critical gameplay progression. Add lease renewal if any handler can exceed the current one-minute lease. Browser-local mode does not provide process-restart durability; the PostgreSQL server mode is the durable adapter.
