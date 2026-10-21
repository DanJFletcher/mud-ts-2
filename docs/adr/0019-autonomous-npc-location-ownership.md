# ADR 0019: Autonomous NPC location ownership

- **Status:** Accepted for the traveling-NPC MVP
- **Date:** 2026-10-21

## Context

NPC definitions are currently authored inside rooms, so their initial presence is static. Autonomous travel needs a durable, authoritative location that is shared by every player in a world instance, survives restarts, and cannot conflict with a second copy of the same NPC state. Players must not own or mutate this state.

The feature must use existing room exits, event storage, durable effects, and room chat. It must not introduce a parallel NPC map, client-owned position, or a second game clock.

## Decision

- Keep NPC identity, initial room, behavior configuration, and narrative text in the world definition.
- For each mobile NPC, store its runtime location and latest movement attempt in a separate event stream scoped by world instance and NPC ID. A single NPC is the aggregate boundary; independent NPCs can move concurrently.
- The committed NPC movement event is authoritative. A projection resolves a mobile NPC to the latest recorded room, or to its authored initial room before the first movement event. Stationary NPCs remain definition-only.
- The engine movement plugin validates each autonomous step against the current room's authored exits, room-state restrictions, destination existence, and per-NPC allowed route/area. Quest- or interaction-gated exits are not traversable by autonomous NPCs.
- Only a trusted server-side system-command entry point can invoke autonomous movement. Player command dispatch cannot invoke system commands.
- Movement behavior choices (wander, stay, or advance along a route) use the engine's injected RNG and produce durable movement/wait events. The game content owns intervals, allowed rooms, and narrative text; the engine owns validation and persistence.
- A committed movement event schedules an at-least-once domain-event effect. The game plugin turns that fact into idempotent departure and arrival messages in the existing room-chat store. The web client receives them through its existing room-chat polling, so its terminal input is not rewritten or displaced.
- Mobile NPCs cannot also be combatants in this MVP. This prevents a combat participant from wandering; explicit movement-during-combat rules remain deferred until shared NPC combat participation is modeled.

## Consequences

- Runtime NPC location is shared world-instance state, unlike character-scoped health, gear, and inventory.
- Replays reconstruct the current location and route position. No schema migration is required because event streams use the existing event store.
- NPC state reads fan out across authored mobile NPCs. This is acceptable for the current small demo world; add a rebuildable index only after measured scale requires it.
- Scheduling runs in the server host, scans only NPCs with movement behavior, and uses a single guarded interval. Multiple hosts may race, but per-NPC expected-version append and idempotent system command IDs prevent duplicate steps.
- Arrival/departure chat is eventually delivered by the existing durable effect worker and becomes visible within the room-chat polling interval.
- A server restart preserves NPC positions and route progress. A new NPC without state starts at its authored room and can move on the next eligible scheduler pass.

## Alternatives considered

- **Store NPC locations in one shared world stream:** rejected because every NPC movement would contend on a single aggregate version.
- **Mutate the static world definition or keep locations only in memory:** rejected because it is not durable or replayable and different players/hosts could disagree.
- **Store NPC location in a player or character stream:** rejected because NPC movement is shared world state and must not depend on a player's presence.
- **Add a new WebSocket notification channel:** deferred; durable room messages and existing polling already meet the first-slice delivery requirement.

## Verification requirements

- NPC location and patrol progress replay correctly after restart.
- Two system runners racing on the same NPC cannot commit duplicate steps; different NPCs can progress independently.
- A system movement cannot use a nonexistent, blocked, state-inactive, or interaction-gated exit.
- Wanderers choose only allowed connected rooms and may persist a stay; patrols advance through their configured ordered route.
- Only players currently in the departure or arrival room receive the matching room-chat message; source-effect retries do not duplicate it.
- Room descriptions, room-local dialogue, and occupant lists reflect the latest NPC location.
- Existing player movement, NPC combat, merchant, and quest behavior remains unchanged.
