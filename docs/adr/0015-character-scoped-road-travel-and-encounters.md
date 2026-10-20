# ADR 0015: Character-scoped road travel and encounters

- **Status:** Accepted for the first playable road-travel slice
- **Date:** 2026-10-20

## Context

The world currently models travel as direct exits between locations. The game needs authored roads of different lengths, with random encounters possible while traversing them. Character location, combat, and inventory are already event-sourced on the character stream. Shared party and world state use separate aggregates.

## Decision

- A road is immutable world-pack content: a stable ID, ordered location IDs (endpoints and one or more traversable road segments), an encounter chance per segment, and a pool of authored combatants.
- Road segments are ordinary locations, so look, map discovery, exits, and text-only navigation continue to use existing location projections and commands.
- Exits that are part of a road are marked with their road ID. The client sends a road-step command for those exits; the server verifies that the exit advances exactly one adjacent segment on that authored road.
- A successful road step appends the ordinary character movement event and, when the server-side random roll selects an encounter, a combat-start event in one character-stream append. The event records the selected combatant and the resolved outcome; replay never rerolls.
- Road definitions, encounter pools, and encounter probability are shared immutable world content. Journey position and any resulting combat state belong to the individual character stream. Two characters may independently encounter different outcomes on the same road.
- The road-travel feature does not create shared road occupancy, shared encounter health, or party-wide encounter state. Cooperative roadside encounters require a separate party-aggregate design.
- Existing one-active-character-per-world-session behavior is unchanged. Active combat blocks further road steps, using the existing flee/resolve rules.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Store road progress in a shared world aggregate | Could support traffic and contested roadside situations | Unneeded for the first slice and would introduce cross-character concurrency and ownership rules |
| Keep a whole trip as one command | Fewer actions | Does not make longer roads have more playable segments or clear interruption points |
| Put random outcomes in client state | Simple client flow | Rejected because clients cannot authoritatively roll, start combat, or recover encounters after reconnect |

## Consequences and trade-offs

- **Positive:** Road length is visible and playable; movement and an encounter are atomic and replayable; existing character-scoped combat rules remain authoritative.
- **Negative:** Encounter outcomes are independent for each character, including party members. Shared party ambushes are out of scope.
- **Compatibility:** Roads are optional world-pack content. Legacy packs without roads and legacy character event streams replay unchanged. No relational schema migration is required.
- **Security:** The server resolves road membership, adjacency, encounter chance, and combatant stats from validated world content; clients submit only the road exit ID.
- **Open question:** Whether later party travel should resolve a roadside encounter once for the party or independently for each character.
