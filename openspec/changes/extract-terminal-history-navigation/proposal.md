# Proposal

## Why

Terminal reading and scroll-position behavior is split between `WorldClient` and `PlayScreen`: the composition owns the refs and state, while the screen owns the DOM scroll handler. This keeps presentation-specific state in the application coordinator and requires a large prop bundle for one cohesive interaction.

## What Changes

- Move terminal follow-latest state, reading anchors, scroll-position preservation, scroll availability, synchronization with history-window changes, and return-to-latest behavior into a focused terminal-history navigation hook.
- Keep the hook alive at the persistent world-client composition level so its reading position survives switching away from and back to the play screen; pass its focused navigation API to `PlayScreen`.
- Preserve the existing `ActivityHistory` store, `ActivityHistoryWindow` behavior, live announcement behavior, and all visible navigation semantics.
- Keep quick-action modeling, room-event reconciliation, and other feature-controller ownership unchanged.

## Capabilities

### New Capabilities

None. This is an internal refactor with no new player-facing behavior.

### Modified Capabilities

None. Existing history and navigation behavior must remain unchanged; no behavior requirement is being changed.

This change sets `skip_specs: true` because it is a pure refactor.

## Impact

- Affected code: `apps/web/src/world/WorldClient.tsx`, `apps/web/src/world/screens/PlayScreen.tsx`, and a new history-navigation module with focused tests.
- Internal component props become narrower; no public API, persistence, server, or gameplay changes.
- The existing `refactor-world-client` change remains untouched and on hold.
