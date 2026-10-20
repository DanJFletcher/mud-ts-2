# ADR 0016: Shared party roadside encounters

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Road travel currently resolves each character's movement and random encounter on that character's stream. Cooperative PvE combat already snapshots eligible party members into the separate `world-team-combat` aggregate, while health, inventory, and progression remain character-owned. A roadside ambush needs to interrupt the party together without moving or damaging characters through a shared world aggregate.

## Decision

- A road step with a successful encounter roll starts one shared team PvE encounter only when at least two eligible, online party members are in the source room. The existing party roster policy supplies a fixed participant snapshot; later party membership or presence changes do not alter it.
- The ambush and its authored road-step destination are recorded on the `world-team-combat` stream. The initiating character stays at the source location while combat is active. Other party members remain in their own character streams and may only act through the captured encounter.
- On victory, an idempotent outcome effect applies health, consumed items, advancement, and—only for surviving participants—the recorded one-segment road movement to each character's own stream. Flee or defeat does not advance the party. Death/respawn takes precedence over road movement.
- Each movement is appended with an expected character-stream revision and a deterministic command ID. A retry must not duplicate a movement or its location-entry effects. The shared team stream never owns durable character health, inventory, or location.
- When no party is available, or fewer than two party members are eligible in the room, keep the existing individual road-encounter behavior. Normal non-road cooperative combat remains unchanged.
- The server resolves the chance roll, encounter selection, roster, source/destination, and exit from trusted world and server state. The client only requests the road exit.
- Keep the one-active-character-per-world-session rule and consent-based PvP unchanged.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Move every party member as soon as the initiating road step succeeds | Simple travel presentation | Other characters would be moved before the encounter resolves and concurrent commands could split combat location from durable character location |
| Store shared health and location in a party or world aggregate | One shared state transition | Violates the existing character-state ownership model and complicates health, inventory, respawn, and character-session rules |
| Keep all road encounters independent | No cross-aggregate outcome handling | Does not provide the requested shared party PvE encounter |

## Consequences and trade-offs

- **Positive:** One road roll produces one party ambush; party members fight the same opponent and advance together only after victory. Room-entry announcements use one stable arrival key across the captured party, preventing duplicate NPC broadcasts for the same group arrival.
- **Negative:** Starting an ambush writes to the team-combat aggregate, and finishing it uses idempotent per-character effects to apply the resolved outcome and movement. Character updates may be briefly asynchronous while the effect is processed. The engine does not provide a cross-aggregate compare-and-append, so a concurrent character mutation can race the roster snapshot even though participant state is revalidated immediately before the team event is planned.
- **Compatibility:** Existing road events and character-owned road encounters continue to replay unchanged. The new team road-start event is versioned separately from ordinary team combat events. No database schema change is required.
- **Security and consistency:** The roster is captured at encounter start; clients cannot choose the participants or route result. Each character update uses its own stream revision and deterministic idempotency key.
- **Open questions:** Whether future party travel should reserve a road step for the full party before any member initiates it; and whether the engine should add a multi-aggregate transaction or reservation contract to eliminate concurrent character changes during shared encounter startup. This ADR supports a shared ambush after one member requests a road step; it does not introduce party-wide travel commands.
