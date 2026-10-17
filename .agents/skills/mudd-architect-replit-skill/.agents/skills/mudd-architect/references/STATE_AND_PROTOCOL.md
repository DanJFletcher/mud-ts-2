# Authoritative commands, protocol and replay

## Contracts

The public protocol separates:

- **Command** — requested state change, e.g. `character.move.v1`, with `commandId`, `actorId` determined by trusted session, `worldInstanceId`, validated payload, and optional `expectedVersion`.
- **Query** — read-only state request, e.g. `location.describe.v1`, with viewer scope and cursor/page options.
- **Domain event** — immutable factual outcome, e.g. `character.moved.v1`; contains entity/stream, version, server timestamp/logical tick and the meaningful resulting fact.
- **Receipt/error** — command acceptance/commit result or typed failure with retryability information.
- **Notification** — delivery of authorized projected changes, with subscription scope, sequence/cursor and event/version identifiers.

Use common envelope fields with explicit schema/protocol versions. Do not trust actor identity, role, location or roll result supplied by the client. Client-supplied IDs may be hints; the server resolves actor/character ownership via validated session.

## Command lifecycle

1. Transport authenticates connection and creates validated `SessionContext`.
2. Decode/size-limit/validate wire envelope and payload using Zod.
3. Enforce command rate limits, authorization, ownership, instance membership and required capabilities.
4. Load the affected aggregate state/revision at the correct consistency boundary.
5. Execute domain handler and plugin policy using injected clock/RNG with explicit transaction/retry semantics.
6. Atomically check `expectedVersion`, check command idempotency, and append one or more domain events; record command receipt.
7. Commit transaction; advance projections synchronously if required or enqueue to a transactional outbox for async update.
8. Publish only viewer-authorized events/projections. Return receipt/typed error to caller.

**Retries:** On a repeated `commandId` + same actor/world scope, return the original committed receipt; do not re-execute. A reused ID with a different payload should fail with a conflict. Optimistic concurrency conflict returns actual version or opaque retry advice; do not automatically reroll chance-based operations without careful semantics.

## Event sourcing and replay

Use immutable append-only event records and query projections. Snapshot aggregates if necessary as an optimization. Rebuild state by replaying ordered events from genesis or a compatible snapshot. Stable recorded RNG outcomes and logical timestamps make replay deterministic; external API responses that alter game state must be recorded as facts first.

Separately track:

- aggregate sequence (for optimistic concurrency);
- event store event ID/global insertion order if used;
- per-subscriber cursor/offset (for reconnect);
- event payload schema version;
- idempotency record keyed by actor/instance/command ID.

A globally ordered event feed is **not guaranteed** by independent aggregate versions; define explicit semantics before promising global ordering. Projections may lag; expose a processed cursor/version or wait-for-revision API to avoid clients observing stale reads after a committed command.

## Transport / live sync

- Prefer HTTP/HTTPS for bootstrap/login/queries and WSS for live events/commands; an all-WS implementation is acceptable if protocol boundaries remain independent.
- Frame types: `hello` (protocol negotiation), `command`, `receipt`, `error`, `subscribe`, `snapshot`, `event`, `ack`, `heartbeat`, `resume`.
- Client reconnect: retain last acknowledged cursor, resubscribe/replay or receive fresh scoped snapshot, then live events. Avoid missing updates between snapshot and subscription; use consistent cursor boundaries.
- Use backpressure policies (bounded outgoing buffers, resync required on overflow). Do not send secret/hidden room events to other players by default.
- TTY adapter maps text input to the same commands and formats projected results; it is not its own rules engine. Telnet must be treated as plaintext unless protected by an appropriate secure transport.

## Example `move` outcome

`MoveCharacter` request: character belongs to actor; current location allows exit; movement rule/policy permits move; no incompatible turn constraint; append `CharacterMoved { characterId, fromLocationId, toLocationId, exitId, movementCost }` + updated revision. Observers receive authorized location/occupancy updates. A duplicate request returns original receipt; a concurrent stale move fails predictably.

`look` / `location.describe` is a query: return a viewer-filtered location description, exits, visible objects and participants with no event append. This distinction is a useful architectural litmus test.

## Time and RNG

- Inject `ClockPort` exposing simulation tick and wall time; tests use fake clock.
- Inject `RngPort` with deterministic seeded test implementation. Persist any authoritative roll result/events and never reroll during projection rebuild.
- Combat, resource regen and scheduled effects produce events on executed ticks. Distributed schedulers require lease/idempotency handling before scale-out.
- Turn manager owns sequencing/participant windows, rulesets own action legality and effects.

## Error taxonomy

Use a stable discriminated union: `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_COMMAND`, `UNKNOWN_COMMAND`, `NOT_FOUND`, `VERSION_CONFLICT`, `RULE_VIOLATION`, `RATE_LIMITED`, `PROJECTION_NOT_READY`, `INTERNAL_ERROR`. Internal errors must not leak connection strings, private entity data or stack traces to clients.

## Required integration scenarios

- Disconnect/reconnect with missed events and correct resume.
- Duplicate command after lost receipt cannot duplicate move/attack/item grant.
- Two concurrent moves from the same revision cannot both commit.
- Restart server and rebuild the same character location/HP/inventory from history.
- Unauthorized observer never receives hidden/other-instance entity data.
- Seeded test yields repeatable simulation and persisted roll outcome.
