# Roadmap, vertical slices and verification

## Guiding approach

**Build end-to-end features before broad surface area.** The initial proof of concept is a **mobile-first PWA**, superseding the older idea that TTY must ship first. TTY/transport independence remains a core requirement. The old two-player multiplayer ambition becomes the first server-backed milestone, not an unearned claim about the offline PWA.

For a new repo, propose these milestones; for an existing repo, inspect and adapt rather than restarting completed work.

### M0 — Define the seams

- Workspace, strict TS, lint/format/test/build scripts.
- `contracts` package with Zod command/query/event envelopes.
- Minimal plugin registry and a command dispatcher using injected clock/RNG/storage ports.
- One architecture diagram + decisions recorded as ADRs.

**Accept when:** test can install a plugin and dispatch a validated command; missing deps/errors are typed. No UI/DB framework imported into kernel.

### M1 — Playable local PWA vertical slice

- Local world instance with ~3–5 original linked rooms, a character, an inspectable object and one simple opponent or environmental challenge.
- `look`, `move`, `say`, basic state summary, persisted inventory/character/location.
- In-process authority, browser-backed event log and projections; refresh restores last location and narrative context.
- Mobile-first responsive React/Tailwind v4 UI; installable PWA shell with actual offline-local play if built.

**Accept when:** from a fresh load, user creates/selects character, moves between rooms, inspects an object, acts, refreshes, and sees persistent state. Core has no React imports. State-changing commands pass through event log.

### M2 — Reliable authoritative multiplayer

- Server-side authoritative command host with Postgres/Drizzle persistence and authenticated sessions.
- WebSocket client transport + reconnect/cursors/idempotent command receipts.
- At least two independent clients join the same instance, see scoped presence and chat, and agree on a move/event.
- Transactional concurrency/expected versions; restart and replay.

**Accept when:** concurrent actions produce valid serialized world state, duplicate commands are harmless, replay reconstructs state after restart, and unauthorized commands/views are blocked.

### M3 — Generic ruleset and combat slice

- Ruleset interface, injected RNG, combat/turn manager, one example combat action.
- Creature template and instance separated; original or licensed SRD content only.
- Two clients observe same turn/outcome; recorded roll matches replay.

**Accept when:** turning the ruleset off leaves noncombat movement/chat engine functional; a test ruleset can replace the combat mechanic without editing kernel.

### M4 — Text client and extension ergonomics

- TTY/text client against same command/query contracts; Telnet-compatible adapter with appropriate security posture, optionally SSH.
- Plugin template/scaffold, compatibility guide, examples and client SDK guidance.
- Test third-party demo plugin that adds a room action with no kernel changes.

**Accept when:** PWA and TTY actions yield the same authoritative events; plugin can be enabled/disabled and loaded with compatibility checks.

### M5+ — World richness (incremental)

- Harvesting + crafting as first-party plugins, then land claims/towns, economy, MUD-Lang, procedural content and AI/NPC behaviors. Add each via concrete gameplay slice with command/event/persistence/permissions tests, not an empty scaffold.
- ServiceConnector for any external service. Never place LLM, vendor, payments, crypto or monetization concerns inside core.

## Example minimal vertical slice test

1. Create world instance and two connected rooms (A ⇄ B).
2. Create player P and character C in A. Fetch `look` for C: describes A + B exit.
3. Submit `MoveCharacter(C, A→B)` with command ID K and correct version.
4. Receive committed `CharacterMoved` event with B and incremented stream revision.
5. Query after projection checkpoint; C appears in B, not A.
6. Replay K: receipt is unchanged and there is no second movement event.
7. Submit stale move version: receive `VERSION_CONFLICT` and no event.
8. Reload/restart host: C remains in B after replay.
9. Connect viewer V without permission to see instance: no location/event leakage.
10. Repeat equivalent action through PWA and (once available) TTY; events match.

## Testing pyramid by boundary

| Boundary | Test focus |
| --- | --- |
| Core types/schemas | Zod invalid input, protocol versions, TS compile |
| Plugin system | resolution, lifecycle, conflicts, optional dependencies, unloading |
| RNG/time | seeded deterministic results, fake time, persisted outcomes |
| Game aggregates | legal and illegal transitions, invariants, concurrency |
| Event storage | rollback, unique revisions, idempotency, rebuild, migrations |
| Networking | reauth, subscriptions, event authorization, reconnect/cursor gaps |
| Client SDK | offline/local adapter, retries, typed error handling |
| PWA/TTY | keyboard/touch flows, narrative accessibility, text parity |
| End-to-end | 2 players, shared event, server restart, unauthorized observer |

## Mandatory feature change template

Before implementation, make a concise plan using `assets/IMPLEMENTATION_PLAN_TEMPLATE.md`. Ensure tasks cover contracts, plugin behavior, persistence, client, tests and documentation. For medium/high-risk changes, obtain an ADR and include a migration/rollback note. For small changes, combine plan and summary rather than generating paperwork.

## Architecture review anti-patterns

- **God server:** routes directly mutate game state or instantiate plugins inside HTTP handlers.
- **God plugin:** one gameplay plugin owns networking, persistence, map, combat and UI.
- **UI-as-server:** React click handler computes damage and writes HP directly.
- **Fake event sourcing:** change database row first, emit an event afterward with no atomicity.
- **Unreplayable random:** dice outcome generated on replay instead of recorded.
- **Cross-world data leak:** broadcast presence and secrets to all connected sessions.
- **Plugin isolation illusion:** manifest permissions treated as OS security boundaries.
- **Schema = public API:** clients depend on Drizzle models or DB implementation details.
- **Infinite scaffolding:** dozens of empty adapters/plugins but no working movement/persistence slice.
- **Rules contamination:** global `characterClass`, D&D AC and spell slots required by engine core.
- **Nondeterministic turn code:** unrestricted wall clock and timers in domain reducers.
- **Unsecured 'peer-to-peer':** any peer considered authoritative because it is connected.

## Definition of done for each slice

A slice is complete when: it is usable in the chosen client; all state mutations go through authenticated/authorized commands; successful outcomes appear in durable event history; projections/reconnect behave as designed; relevant schema and plugin versioning is addressed; tests are passing or concrete blockers are reported; docs/ADR reflect actual code; and another client could implement the same feature using contracts alone.
