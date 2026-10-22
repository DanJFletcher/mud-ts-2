# ADR 0022: World selection and character world ownership

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

MUDD currently hosts one registered world, The Waystone Path. Character records and world sessions already carry a `world_instance_id`, but the server, account roster, and client route all assume the single demo world. Orraveth lore exists in the Codex and must become a separate playable world without merging its content or state into the demo world.

Players need to choose a world, manage characters that belong to different worlds, and enter each world with one character at a time. Existing character streams must not be moved, copied, or reinterpreted as characters in another world.

## Decision

- Register each playable world with a stable world-instance ID and immutable content pack.
- A character belongs to exactly one world instance, identified by its existing `world_instance_id`. Character creation is scoped to the selected world; joining a different world requires a different character.
- A player may keep a separate world session for each world. Within one world, the existing unique `(player_id, world_instance_id)` session constraint continues to enforce one active character at a time.
- World choice is client selection, not authority. The server validates the selected registered world, checks character ownership and world binding, and dispatches to that world's engine host.
- Each world host shares the PostgreSQL event store, but claims durable effects only for its own world instance. This prevents a host from interpreting another world's event using the wrong content pack.
- Existing Waystone characters, sessions, and event streams remain untouched. No data migration is required.
- Orraveth content is authored as a distinct pack and begins in Bellwold. The Codex remains lore reference material; only explicit playable content in the Orraveth pack is runtime game state.

## Consequences

- Accounts and guests can maintain separate characters across registered worlds without transferring inventory, quests, location, or progression.
- The same engine plugins and client protocol can serve both worlds while each host receives the correct world pack.
- Adding a world requires registration, content validation, host startup, and client-visible metadata.
- Instance-per-world is the current deployment model. Multiple independently-created instances of one world definition are deferred.
- Existing API clients that omit an explicit world selection continue to target The Waystone Path.

## Alternatives considered

- **Move an existing character to a new world:** rejected because it mixes content-specific progression and state.
- **Use a single engine host with client-selected content:** rejected because the engine's world context is authoritative and must not be client-controlled.
- **Create a database world-definition catalog now:** deferred; the current registry is small and code-defined, while player/world event data remains in PostgreSQL.
