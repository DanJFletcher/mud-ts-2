# Proposal

## Why

During optimistic travel to an unvisited room, the minimap can jump to the first room in the map instead of staying near the traveler. The destination is intentionally absent from the visited-room map projection until arrival, so the client must not use an unknown destination as the map focus.

## What Changes

- Keep the minimap focused on the last authoritative, visible room while an optimistic destination is absent from the current map projection.
- Focus the destination when the authoritative map includes it after arrival.
- Add regression coverage for travel to both unvisited and already-visited destinations.

## Capabilities

### New Capabilities

- `world-map-focus`: Defines how the map and minimap focus behave during optimistic travel, without revealing undiscovered room locations.

### Modified Capabilities

None.

## Impact

This affects the web client’s travel-to-map handoff and minimap rendering/tests. It does not require changes to the server map projection, client protocol, or undiscovered-room visibility rules.
