# ADR 0039 — Game projections in command responses

- **Status:** Accepted
- **Date:** 2026-10-30
- **Owners:** Engine and game client
- **Amends:** [ADR 0004](0004-durable-event-effects.md)
- **Related tasks:** [Round-trip latency audit](../performance/round-trip-latency-audit.md), quick win 2; [implementation plan](../implementation-plans/command-response-projections.md)

## Context

After most actions, the web client fetches the full `/api/game` snapshot. That costs an HTTP round trip and about seven database statements at production latency. Moves avoid it, because their command response carries the projection.

Returning the projection with every command was deferred, because some commands finish through durable effects that run after the response:

- a shared-item take adds the item to the pack;
- a shared-item drop puts the item on the floor;
- a gold pickup credits the wallet.

A projection built right after the commit would miss those changes. For a drop, no realtime invalidation would follow either, because the realtime view tracks only the character revision.

Installed PWAs can run older SDK builds, so any change to responses must be opt-in.

## Decision

- Clients opt in per request by sending `x-mudd-command-projection: game` with `POST /api/commands`. The SDK sends it when the client is created with `commandProjection: 'game'`. Servers that predate this ignore the header.
- For an opted-in request, a successful world command returns `gameProjection`. It is the same projection that moves return, built by the code behind `GET /api/game`, and opted-in moves use the same field. Requests without the header get the responses they did before, including `movementProjection` for moves.
- A plugin registers an effect with `completesCommand: true` when its handler finishes the acting character's own outcome of the command. To start with, these are `world-item.claim`, `world-item.drop` and `world-corpse.gold-credit`.
- Before projecting, the server runs the completing effects that the command queued, through `EngineHost.settleCommandEffects`.
  - They run under the same lease, retry and dead-letter rules as in the background worker.
  - The claim covers only effects queued by that actor's command.
  - All other effects stay in the background.
- In these cases the response has no projection, and the client fetches the snapshot as before:
  - settlement can't finish, because another worker holds an effect, a handler failed, or the store can't claim by command;
  - the command is a duplicate other than a move.
- The client applies a returned projection unless the socket already reports a newer character revision. Later hints still trigger refetches, as in [ADR 0038](0038-realtime-revision-hints.md).

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Project at once and let realtime correct any gaps | No extra work in the request | Nothing ever corrects a drop, and a take briefly shows the item in neither place |
| Return no projection for commands with effects | Simplest server change | Keeps take and drop on two requests, though their snapshot most often shows a partial result |
| Run every effect the command queued before responding | No classification of effects | Moves and combat rounds pay for announcements and party-quest progress that the projection doesn't show |
| Wait for the background worker to finish the effects | No new claim path | The wait has no bound, and the worker serves every world |
| Keep a server-side list of effect types to settle | No plugin API change | Couples the server to plugin internals, and silently misses new effects |

## Consequences and trade-offs

- **Positive:** current clients send one fewer HTTP request per action, and take and drop show their finished result in a single response.
- **Negative:** take, drop and gold-pickup responses now include the effect's own work, 13 or more round trips that the worker used to do just after the response. In exchange, the client no longer needs the follow-up snapshot, or the refetch that corrected it.
- **Negative:** an opted-in command still pays for its projection, about 4 round trips, when the client ignores it, as the web client does for party and interaction commands.
- **Compatibility/migration:** fully backward compatible, with no data migration. Plugins that don't pass the new option behave as before.
- **Security/abuse/trust:**
  - The projection covers only the requesting player's own world session, and it is built from committed state. HTTP stays authoritative.
  - Settlement runs only server-authored effects of that actor's own command, under the existing idempotency rules.
- **Performance/operational:** new trace stages `commandEffects` and `commandProjection`. The `command_projection_deferred` and `command_projection_unavailable` logs show how often clients fall back.
- **Rollback/reversibility:** stop sending the header from the client. The server keeps serving both response shapes.

## Verification

- **Engine tests:** completing effects are counted and settled inline, and other effects are left for the worker. Settlement reports failure when an effect is held elsewhere or fails.
- **Store tests:** the claim covers only the actor's command and the given types. This is tested in memory, as rendered SQL, and against PostgreSQL where it is configured.
- **Plugin tests:** a shared-item take and drop each settle to the finished state.
- **Server tests:** opted-in responses carry `gameProjection`. Unsettled effects and duplicates omit it. Responses to requests without the header are unchanged.
- **SDK and web tests:** the header is sent only when configured, and projections are applied without a snapshot request. A missing projection or a newer revision hint falls back to the snapshot.

## Follow-up / revisit trigger

- Room item changes still produce no realtime invalidation for other players in the room. A room-level revision in the realtime view would close that gap.
- Revisit the completing set if an effect handler turns out to be slow. The `commandEffects` stage shows settlement time.
- Remove `movementProjection` once installed clients have updated.
