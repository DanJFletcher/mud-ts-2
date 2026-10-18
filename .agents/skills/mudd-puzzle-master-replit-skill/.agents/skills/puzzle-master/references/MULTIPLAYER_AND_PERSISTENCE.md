# Shared-world puzzle design and persistence

## Scope table (specify per puzzle)

| Scope | Typical state | Confidentiality | Reset expectation |
| --- | --- | --- | --- |
| Character | Discovered clue, private hint stage | Visible only to character/authorized GM | Persist until explicit reset/version change |
| Party | Shared gathered tokens or coordinated contribution | Party members only | Persist safely across group disconnects |
| World instance | Gate open, bridge moved, apparatus rotation | Queryable by authorized viewers in that instance | Explicit instance lifecycle/reset |
| Global world | A permanent civic monument repaired | Potentially visible world-wide | Rare, governed by persistent-world design |
| Session | Ephemeral UI affordance/draft selection | Do not trust as game authority | May disappear on reconnect |

**Do not conflate ownership with visibility.** A public solved gate can be visible to everyone, while who learned the underlying secret remains private.

## Concurrency cases

- Two players submit the final alignment command at once: exactly one authoritative transition should win; the other gets current-state feedback, no duplicate reward.
- User retries a command after a network interruption: stable idempotency key; no double-advance or double consumption.
- Two party members change shared levers in quick succession: define ordering/version checks, ensure projections are consistent.
- A player leaves with an essential item: avoid unbounded griefing; provide respawn/recovery/public replicas or scope items per party.
- A new player joins after puzzle completion: current projection shows gate open; secrets not automatically shared.
- A world restarts between steps: event replay or snapshot reconstructs the same result; do not re-roll or reinterpret a previous valid answer.
- World content upgrades: content version and migration/reset plan preserve or intentionally retire old state; never silently reinterpret existing event payloads.

## Cooperative puzzles without forced simultaneity

Prefer complementary roles, independently gatherable clues and turn-based cooperative actions over exact-real-time button presses. Make a reasonable solo-accessibility fallback if the environment supports solo players. If a simultaneous action is core to the intended multiplayer experience, define disconnect handling, party size, authoritative turn/time window, and fair re-entry.

## Anti-spoiler and anti-grief rules

Public chat and location descriptions must not reveal hidden canonical solution states by default. Server authorship/admin APIs require authorization. Never include GM secrets in general WebSocket events merely because UI hides them. Specify moderation and grief protections for repeat activations, resetting progress and hoarding required objects.
