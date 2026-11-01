# ADR 0043 — Explicit water-travel access requirements

- **Status:** Accepted
- **Date:** 2026-11-01
- **Owners:** MUDD contracts and movement plugin
- **Related:** [Location states](0017-character-scoped-location-states.md),
  [map presentation](0025-map-terrain-and-crossing-presentation.md)

## Context

Players must not move through open water without swimming or boat access. Both
capabilities are out of scope. Map terrain is presentation-only under ADR 0025:
a river-coloured tile can include a dry ferry stage, and a land-coloured bridge
can include a water context beneath it. Terrain strings and context names cannot
serve as movement rules.

## Decision

- Add optional boolean `requiresWaterTravel` to location and location-state
  definitions. It is mechanical TypeScript content, not JSON map layout.
- A destination state's explicit boolean overrides its location's boolean.
  Otherwise the location's requirement applies; omission means no requirement.
- The shared movement policy rejects destinations requiring water travel. No
  swimming, boat item, entitlement, inventory-name check or client override is
  introduced. Future ways to satisfy the requirement need their own contracts.
- Apply the same policy to ordinary movement and road-step planning before
  stamina changes, timed-action interruptions, encounter rolls or movement
  events are planned. A rejection leaves the character stream unchanged.
- Mark authored open-water rooms and submerged crossing states in both packs.
  Keep dry bridge decks and Rillford's stage accessible; the stage explicitly
  overrides its water location. Retain all map nodes, directional connections,
  and existing discovery behavior.
- Check the destination only. A character already in water may take an existing
  exit directly to dry ground, but may not continue to another water room.

## Compatibility and verification

The fields are optional and additive. No event schema, database migration or
recorded position is rewritten. Existing worlds with no requirement retain their
movement behavior, regardless of map terrain. The unreleased Orraveth expansion
remains 1.21.0; the demo content increments to 1.1.2. Retire the demo's temporary
pre-migration equality fixture as ADR 0042 directs for subsequent content changes.

Tests cover schema bounds, inheritance and explicit false overrides, dry bridge
and stage access, submerged contexts, land-to-water and water-to-water rejection,
direct dry egress, road commands and unchanged character streams after rejection.
