# MUDD architecture and vocabulary

## Vision and system qualities

MUDD is a **framework for persistent, multiplayer, MUD-inspired games**, not one hardcoded D&D campaign. Text play is a core capability. The initial proof of concept deliberately uses a **mobile-first, touch-friendly PWA**; the architecture must also support TTY, voice, GUI and future 2D/3D views of the same authoritative game.

Priorities, in order: (1) playable integrated slice; (2) correct domain boundaries; (3) recovery and replay; (4) stable plugin extension; (5) more clients and game systems; (6) production scale/peer-host distribution. Avoid turning a prototype into speculative microservices.

## Module taxonomy

- **Kernel / engine-core:** orchestrates commands, plugin registration/lifecycle, registry of capabilities, permissions, scheduling interfaces and world context. Contains no domain-specific rules.
- **Core plugin:** built-in functionality needed by the game host (networking, persistence, player/character, combat/turn coordinator, RNG, movement, chat, time). Enabled/configured by host; no UI coupling.
- **First-party plugin:** optional official features: gathering, crafting, settlement, economy, housing, quests, NPC AI, world generation, MUD-Lang.
- **Ruleset plugin:** optional domain-specific action semantics and mechanics, such as D&D-inspired tests/turns. A plugin can attach rule data to characters/creatures without changing engine-core.
- **World/content pack:** validated serializable definitions (locations, objects, dialogs, spawns, encounters, event triggers). Data isn't an executable game engine.
- **Transport adapter:** WebSocket, Telnet, SSH, in-process/offline; transforms I/O to the same validated protocol.
- **Client plugin:** independent front-end using the client SDK (web PWA, TTY, voice, 2D/3D).
- **ServiceConnector:** optional port to outside services (e.g. LLM NPC, economic feed, integrations), never an engine assumption.

## Context identities: keep separate

- **Account/player:** authenticated human/controller identity; owns characters/permissions; may connect multiple devices.
- **Character:** in-world role with attributes, inventory, location, ruleset state; not the network connection.
- **World:** content/system boundary, potentially containing regions, settlements and resources.
- **Campaign / world instance:** a particular persistent simulation based on a world/content pack.
- **Session:** authenticated active connection/participation and presence, scoped to world instance/character.
- **Location:** graph node (room/area/cell) with exits and local visibility; geography is not necessarily a 2D tile map.
- **Entity/instance:** uniquely identified occurrence of an object, monster, player character or resource in a world instance.
- **Definition:** versioned template from content pack, separate from runtime instance and mutable state.

Consider `worldId`, `instanceId`, `actorId`, `characterId` and `sessionId` as separate typed IDs. Don't use an IP address, WebSocket connection or display name as an authoritative identity.

## Dependency direction

```text
   apps/web ──> client-sdk ──> contracts <── engine-core
   clients/tty ───────────────┘                ↑
                                      engine-state + engine-net (ports)
                                              ↑
      plugins/core + plugins/first-party + ruleset plugins
                              ↓
               adapters (Postgres, browser local, WS, Telnet)
                              ↓
                       apps/server wiring
```

This is conceptual: concrete arrows in code should honor clean dependency direction. Composition root instantiates dependencies; domain services only see ports. Plugin packages import stable public APIs and may depend on core-provided capabilities, not each other's internals.

**Don't import:** React in game rules; Drizzle models in domain logic; plugin source into engine-core; database access in UI; network sockets in reducers; Replit secrets/environment in shared contracts.

## Authoritative topology

### Stage A: local browser prototype

```text
React PWA ── Client Facade/SDK ── In-process command host
                                   ├── same domain handlers/plugins
                                   ├── injected clock/RNG
                                   └── browser storage adapter (e.g. IndexedDB)
```

No third-party identity needed for local-only mode. Label it explicitly **local demo**, isolate each local world's state, persist meaningfully, and demonstrate offline behavior. Do not treat browser local identity as secure for remote multiplayer.

### Stage B: server-backed multiplayer

```text
PWA client ── HTTPS / WSS ─┐
TTY/Telnet transport ─────┼── Auth/transport adapters ── authoritative host
future client ────────────┘                             ├── command pipeline
                                                       ├── plugin registry
                                                       ├── Postgres event store
                                                       ├── projections/read models
                                                       └── event broadcast/outbox
```

Two authenticated players can connect concurrently, and only the authoritative host commits state transitions. Web deployment security should use TLS and restrictive CORS/origin checks as appropriate; raw Telnet is plaintext and must not be promoted as a secure internet-facing option. Prefer SSH or TLS-wrapped Telnet when sensitive auth is used.

### Stage C: authorized peer hosting

One participating host acts as authoritative server for an instance, with explicit trust and authorization, reconnect behavior, state transfer, and consistent event ordering. 'Peer hosting' is a **hosting/discovery option**, not a claim that all clients can write arbitrary world state. Replicated or federated world states require a separate design/ADR.

## Time, simulation and events

- **Simulation time:** logical world time/time ticks; deterministic given recorded inputs.
- **Wall time:** clock reading used for scheduling real-time triggers; record authoritative tick decisions as events.
- **Combat time:** ordered turn/round states; the combat core coordinates turn transitions, ruleset determines available actions/effects.
- **Event streams:** scoped to instance and aggregate, totally ordered within the chosen concurrency boundary. A global ordering scheme is optional; be explicit if unavailable.
- **Projections:** read-optimized views. May be eventually consistent unless updated transactionally. Acknowledge commands separately from projection visibility.

## Extension seams to preserve, not prematurely build

- Resources: typed harvestable entities with quantities, ownership and regeneration policy.
- Crafting: declarative recipes, material consumption as atomic transitions, item ownership.
- Land/towns: versioned claims and permission checks, geographic or graph parcels.
- Economy: transactions / ledgers and simulated supply/demand as separate plugins, not in player inventory logic.
- MUD-Lang: sandboxed and resource-bounded hook dispatcher, DSL parser/runtime, identity/capability checks, script versioning.
- NPC AI: scheduling and decision service produces commands under scoped NPC capabilities. LLM providers optional behind ServiceConnector.
- Procedural generation: seeded content generation with reproducible definitions and schema versions.

A proposed extension belongs in the kernel **only** when it represents generic orchestration all games need. Otherwise prefer an optional plugin and a capability.

## Decision policy

Make an ADR when introducing/removing dependency relationships, committing to a message format or event version, changing authoritative state boundaries, choosing a persistence strategy, or changing plugin trust policies. Choose a modular monolith before microservices; a queue or task runner should be adopted to solve a measured reliability/throughput problem, not as boilerplate.
