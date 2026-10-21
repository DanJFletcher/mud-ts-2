# ADR 0017: Character-scoped location states

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Some physical places occupy one map node but have distinct contexts, such as the
top of a bridge and the river beneath it. The context changes the room
description and legal exits, but must not move the character to another map
level or change the map coordinates. Multiple characters may occupy different
contexts of the same node at the same time.

Character movement is event-sourced. The character stream currently owns one
`locationId`; room presence and chat are scoped to that location ID.

## Decision

- Keep `locationId` as the map node and add an optional `locationStateId` to the
  character projection. Both fields are owned and replayed by that character's
  event stream; no shared node state is introduced.
- World content may author named location states and a default state. An exit
  may be limited to a source state and may select a destination state. An
  omitted destination state resolves to the destination's default.
- Movement events record nullable source and destination state IDs as additive
  fields. Old movement events without state fields remain valid and replayable.
- Location description queries select the character's current state's title,
  description, and exits. State IDs are generic content identifiers; the
  engine does not encode `on` or `under` as special rules.
- Map positions remain attached to the location node. State does not alter X,
  Y, area, or Z and does not create a second map tile.
- Room presence and chat remain scoped to the underlying location node for this
  slice. State-specific visibility can be added separately if required.
- River nodes may connect to a bridge's `under` state, but this does not add a
  land-to-river entrance. Boat-gated entry remains deferred until the game has a
  boat capability.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Change map Z for the under-bridge room | Reuses existing floor separation | Incorrectly changes the map level and splits one physical map node |
| Give each state a separate location ID | Uses existing location identity | Duplicates one map node and complicates map, presence, and discovery |
| Store state on the shared world node | Simple shared display | Prevents characters from independently being on or under the bridge |

## Consequences and trade-offs

- **Positive:** Each character can occupy `on` or `under` independently while
  the map retains one position and one Z level.
- **Negative:** Movement, room queries, replay, and content validation must
  resolve state IDs consistently.
- **Compatibility/migration:** New state fields are optional. Existing streams
  and locations continue to use their current location and exits; no database
  migration or event rewrite is required.
- **Security/abuse/trust:** The server selects state from authored exits and
  validates it against world content; clients cannot set state IDs directly.
- **Performance/operational:** State is replayed with the character stream;
  no additional shared-state lookup or projection is needed.
- **Rollback/reversibility:** Remove authored states and optional event fields
  only after all characters have returned to default contexts; existing
  location IDs remain stable.

## Verification

- Replay legacy movement events without state IDs.
- Enter a stateful location from distinct source exits and resolve the correct
  destination state.
- Verify each state returns its own description and available exits.
- Verify two characters can occupy different states at the same location
  without changing map position or Z.
- Reject exits whose source or destination state is not authored.
- Verify map projection contains one node and does not draw state transitions
  as extra map locations.

## Follow-up / revisit trigger

Add state-specific occupant/chat visibility only if gameplay requires
characters in different contexts of one node to be isolated. Add boat-gated
land-to-river exits when boat access is implemented.
