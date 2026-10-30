# MUDD feature implementation plan — Command-response game projections

**Status:** Implemented. Source: [round-trip latency audit](../performance/round-trip-latency-audit.md), quick win 2 (the deferred second half). Decision record: [ADR 0039](../adr/0039-command-response-projections.md). Line references are to commit `2b76db9`.

**Goal / user-observable behavior:** A client that opts in receives the authoritative game projection with every successful world command, so it no longer requests `GET /api/game` after an action. Take and drop show their finished result in that same response: the item in the pack, or on the floor. Each action saves one HTTP round trip, plus the identity and session lookups that a separate snapshot repeats. Older clients see no change.

**Existing repo findings:**

- **Movement already does this.** `POST /api/commands` builds the projection with `buildGameProjection` for `character.move` and `character.road.step` only, and returns it as `movementProjection` ([index.ts:1143](../../apps/server/src/index.ts#L1143)). If the projection fails, the move still succeeds and the server logs `movement_projection_unavailable`.
- **The web client refetches after other actions.** `App.tsx` calls `client.getGame()` at 42 call sites, 6 of them through `refreshAfterMutation` ([App.tsx:1236](../../apps/web/src/App.tsx#L1236)). Only the move handler uses a command-response projection ([App.tsx:2301](../../apps/web/src/App.tsx#L2301)).
- **Some commands finish through durable effects.** The command commits one half of its outcome and queues an effect for the other half ([ADR 0004](../adr/0004-durable-event-effects.md)). The worker runs the effect after the response is sent ([index.ts:1135](../../apps/server/src/index.ts#L1135)).
  - Taking a shared item commits `world.item_claimed` to the world-items stream. The `world-item.claim` effect then adds the item to the taker's character stream ([character.ts:559](../../packages/plugins/src/character.ts#L559), [world-items.ts:448](../../packages/plugins/src/world-items.ts#L448)).
  - Taking corpse or loose gold commits `world.corpse_gold_claimed`. The `world-corpse.gold-credit` effect then credits the wallet ([character.ts:620](../../packages/plugins/src/character.ts#L620)).
  - Dropping a shared item commits `character.shared_item_relinquished`. The `world-item.drop` effect then puts the item on the floor ([character.ts:705](../../packages/plugins/src/character.ts#L705), [world-items.ts:362](../../packages/plugins/src/world-items.ts#L362)).
- **Realtime does not cover every effect.** The gateway's `character` channel hashes only the character revision ([index.ts:465](../../apps/server/src/index.ts#L465)).
  - A character-stream change reaches protocol 2 clients as a newer revision hint, and they refetch.
  - A world-items change, such as a dropped item reaching the floor, changes no channel hash, so no invalidation is sent ([0009_realtime_wakeups.sql:26](../../apps/server/drizzle/0009_realtime_wakeups.sql#L26)).
  - A new corpse is announced in room chat, and the client refreshes the room when the announcement arrives ([App.tsx:675](../../apps/web/src/App.tsx#L675)).
- **The follow-up snapshot races the worker today.** Each of the claim, drop and gold-credit effects takes 13 or more database round trips. That is usually longer than the client's follow-up `GET /api/game` takes to read the same streams, so production take and drop usually show a partial result first.
  - A take is corrected when the effect's revision hint arrives.
  - A drop used to be corrected by chance, by the refetch that its own revision hint triggered. Protocol 2 now skips that refetch, so nothing corrects the floor until the next unrelated snapshot.
- **Effects already carry their command's identity.** Each queued effect stores its causation command ID and the dedupe key `command:<world>:<actor>:<commandId>:<index>` ([postgres-event-store.ts:601](../../apps/server/src/persistence/postgres-event-store.ts#L601)). A claim leases one due row in a single `FOR UPDATE SKIP LOCKED` statement ([postgres-event-store.ts:788](../../apps/server/src/persistence/postgres-event-store.ts#L788)).
- **The command handler reads through a request-scoped cache.** Reads of the acting character's stream reuse the snapshot taken by the command guards, until an append inside the same scope invalidates it ([postgres-event-store.ts:155](../../apps/server/src/persistence/postgres-event-store.ts#L155)). An effect that runs outside that scope does not invalidate it.

**Owning plugin/capability:**

- engine-core: effect settlement and its store port;
- the `mudd.world-items` plugin: which of its effects complete a command;
- the server's command wiring;
- the client SDK and the PWA.

**Assumptions and deferred scope:**

- The projection has exactly the shape that moves already return (`MovementResultProjectionSchema`). The client keeps `player` and `currency` from its existing snapshot.
- HTTP stays the only authority. The same code that serves `GET /api/game` builds the projection, for the requesting player's own world session.
- Pushing projections over the socket is out of scope ([ADR 0035](../adr/0035-typed-realtime-transport-and-recovery.md)).
- Deferred:
  - realtime invalidation of room items for *other* players in the room;
  - the `read` and `use` handlers, because their SDK methods return derived values rather than the command response.

## Command-by-command decisions

An effect *completes* a command when its handler finishes the acting character's own outcome, the result the actor expects to see from that action. Only those effects are settled before the response. Effects that announce something, change shared objects for others, or advance party state stay in the background. Their results reach the client through realtime, exactly as they do after a snapshot.

| Command | Durable effects it can queue | Missing from an immediate projection | Decision |
|---|---|---|---|
| `character.take`, shared item | `world-item.claim` | The item in the pack. The room already shows it gone. | Settle, then project |
| `character.take`, corpse or loose gold | `world-corpse.gold-credit` | The wallet credit | Settle, then project |
| `character.take`, authored item | none | — | Project |
| `character.drop`, shared item | `world-item.drop` | The item on the floor. No realtime signal would follow. | Settle, then project |
| `character.drop`, other items; `character.put` | none | — | Project |
| `combat.action` | Party-quest progress; `world-corpse.create` on a kill | The corpse, until its room announcement refreshes the room | Project; the corpse stays in the background |
| `team.combat.start`, `team.combat.action` | `team-combat.apply-outcomes`; corpses | Rewards and respawns, which arrive as newer revision hints | Project |
| `pvp.action` | `pvp.apply_outcome`; corpses | Rewards and respawns, which arrive as newer revision hints | Project |
| `character.move`, `character.road.step` | `world.location.entered`; `combat.hostile-npc-entry`; party-quest progress | A hostile NPC's attack, which arrives as a newer revision hint | Project, as today |
| `campfire.*` | Room announcements | Nothing; announcements are chat | Project |
| `character.use`, `character.read` | Party-quest progress | Nothing; the party journal is not in the projection | Project |
| Every other world command: equipment, rest and stand, inn rest, crafting, merchant, dialogue, daily jobs, gathering, fishing, woodcutting, parties and interactions | None, or background effects outside the projection | — | Project |
| `character.create`, `rename`, `archive`, `restore` and `class.choose` | — | These run without a world session | No projection, as today |

The alternative, leaving effect-driven commands out, would keep take and drop on two requests. Those are the actions whose follow-up snapshot most often shows a partial result. Settling the three completing effects adds each effect's own work, 13 or more round trips that the worker would otherwise do just after the response. It removes the follow-up snapshot and the refetch that used to correct it.

## Contract changes

- **Request header:** `x-mudd-command-projection: game` on `POST /api/commands`, exported from `@mudd/contracts` as `COMMAND_PROJECTION_HEADER` and `GAME_COMMAND_PROJECTION`. Servers that predate it ignore the header.
- **Response field:** `gameProjection` (`MovementResultProjectionSchema`) on successful world commands from clients that opt in. Their move responses carry `gameProjection` instead of `movementProjection`. Clients that don't opt in still get `movementProjection` for moves, and no projection for other commands.
- **SDK:** `ClientOptions.commandProjection: 'game'` sends the header, and `CommandResponse.gameProjection` is parsed.
- **Plugin API:** `registerEffect(type, version, schema, handler, { completesCommand: true })`. The option is additive.
- **Engine:**
  - `DispatchResult.completingEffects` counts the completing effects that a commit queued. The server does not send it to clients.
  - `EngineHost.settleCommandEffects(session, result)` runs those effects.
- **Store port:** an optional `claimCommandEffect(leaseMs, scope)`. It claims one due effect queued by one actor's command, of the given types.
- **Events:** none. **Persistence:** no migration.

## Boundary map

- **Core/ports touched:** `EventStorePort.claimCommandEffect` (optional), `DispatchResult.completingEffects`, `EngineHost.settleCommandEffects`, and the options argument of `PluginContext.registerEffect`.
- **Plugin(s) touched:** world-items marks `world-item.claim`, `world-item.drop` and `world-corpse.gold-credit` as completing.
- **Persistence/migration touched:** `PostgresEventStore.claimCommandEffect`, served by the existing pending-effects index. The in-memory store implements the same claim. No schema change.
- **Client SDK / PWA / TTY impact:**
  - The SDK gains the option and the response field.
  - The PWA opts in, and applies projections in `refreshAfterMutation` and the high-traffic handlers.
  - A TTY client can opt in the same way.
- **Operational / networking impact:**
  - One fewer HTTP request per action.
  - New trace stages: `commandEffects` and `commandProjection`.
  - New logs: `command_projection_deferred` and `command_projection_unavailable`.

## Design

- **Server flow** for a successful world command, meaning one with an active world session:
  1. Dispatch as today.
  2. If the client opted in, or the command is a move, settle the command's completing effects with `settleCommandEffects`. This runs outside the request-scoped read cache, like the background worker. A command that queued none skips this step without a query.
  3. If effects ran, invalidate the scoped cache of the actor's character stream, because their appends happened outside that scope.
  4. Start the background effect batch, as today. Starting it after settlement keeps the worker from claiming the command's own effects first.
  5. Only if settlement succeeded, build the projection with `buildGameProjection`. Return it as `gameProjection` if the client opted in, or as `movementProjection` for a move from a client that didn't.
- **Settlement** (`EngineHost.settleCommandEffects`):
  - `dispatch` reports how many completing effects it queued, so settlement knows what to expect.
  - It claims all of them before running any, so the worker can't take the second effect while the first one runs.
  - It runs each effect through the same code as the worker: schema check, retry with backoff, and dead-lettering.
  - It returns false if it claimed fewer than expected, if a handler failed, if more than 4 effects are queued, or if the store can't claim by command. An effect can be missing from the claim because another worker holds it or because it waits for a retry. The server then omits the projection and logs `command_projection_deferred`, and the client falls back to `GET /api/game`.
  - A duplicate can't report which effects its original commit queued. The server therefore projects a duplicate only when it is a move, as today; moves queue no completing effects.
- **Claim scope.** The PostgreSQL claim matches the world, the causation command ID, the effect types, and the dedupe-key prefix that names the actor. Another player's command with the same ID is never settled in this request.
- **Client:**
  - The web client creates its world client with `commandProjection: 'game'`.
  - A pure helper, `commandResultProjection`, returns the response's projection. It returns nothing if the socket's character revision hint is newer than the projection, and the handler then fetches a snapshot.
  - The protocol 2 watcher still compares later hints with the applied revision. Effects and other writers that land after the response therefore still trigger a refetch.
  - The PWA adopts projections in `refreshAfterMutation` (daily jobs, gathering, take, campfire, drop and put), and in these handlers: movement, take all, loot, equipment, rest and stand, inn rest, combat and class actions, PvP actions, crafting, merchant purchases, dialogue, and fishing and woodcutting.

## Invariants and failure paths

- The server builds the projection from committed state, for the requesting player's own world session. The client never derives game state.
- A response projection never misses a completing effect of its own command, because it is built only after those effects commit. Background effects may land later, and reach the client as revision hints or room announcements.
- Every effect that settlement claims runs before the request ends, so no lease is left to expire.
- A settlement failure never fails the command. The response still carries the receipt and events, without a projection.
- The projection is at least as fresh as a snapshot requested at the same moment. It carries the character revision that protocol 2 hints are compared with.
- Rate limits, authorization and validation are unchanged. Logs contain request IDs, command IDs, command types and reason codes, never payloads.

## Steps

1. Write this plan and ADR 0039.
2. Engine:
   - the effect option, `completingEffects` and `settleCommandEffects`;
   - the optional store claim, in the in-memory and PostgreSQL stores;
   - tests for each.
3. World-items: mark the three effects as completing, and test a shared-item take and drop end to end through the engine.
4. Server:
   - the opt-in header, settlement and cache invalidation;
   - the generalized projection, with its logs and trace stages;
   - tests in the mocked HTTP suite.
5. SDK: the option, the header and the response field, with tests.
6. Web: opt in, add the helper, and adopt it in the handlers listed above. Test:
   - an applied projection;
   - the snapshot fallback;
   - the newer-hint fallback.
7. Update the audit's quick-win status.
8. Compare `?muddTrace=1` traces in development. An action should log one command request and no snapshot request, with the `commandEffects` and `commandProjection` stages.

## Acceptance criteria

- [ ] With the opt-in, take, drop, equipment, combat, crafting and gathering update the view without a `GET /api/game`.
- [ ] The command response shows a taken shared item in the pack, and a dropped shared item on the floor.
- [ ] If a command's effects can't be settled, the response has no projection and the client falls back to a snapshot.
- [ ] A revision hint newer than the returned projection still causes a refetch.
- [ ] Clients that don't opt in get exactly the responses they did before.
- [ ] The engine, plugin, SDK, server and web suites pass. The PostgreSQL claim test passes where `MUDD_TEST_DATABASE_URL` is set.

## Rollout and rollback

The server change does nothing until a client sends the header. To roll back, remove `commandProjection` from the web client; the server keeps serving both response shapes. Removing the server support afterwards is also safe, because the web client fetches a snapshot whenever a response has no `gameProjection`.
