# ADR 0029: Show exits without exposing undiscovered locations

- **Status:** Accepted
- **Date:** 2026-10-23
- **Owners:** MUDD engine and client
- **Related decisions:** ADR 0008 (map areas and floors), ADR 0025 (map terrain and crossings)

## Context

The map projection includes explored locations and authored locations explicitly visible before discovery. It previously omitted connections when the destination was not among those locations, so players could not see a known room exit until after exploring its destination. Showing the destination as a full node would reveal its name, terrain, and other map details prematurely.

## Decision

The server projection includes an `exitStubs` entry for each cardinal exit leaving a visible location whose destination is not represented on the current map. Each stub contains only the source location ID, cardinal direction, and one-way status. The client draws a short line from the room tile in that direction, without creating a destination node or exposing destination identity or content.

Vertical exits continue to use the existing up/down markers. Map area and floor filtering remain unchanged.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Add undiscovered destinations as map locations | Reuses existing connection rendering | Reveals room identity, terrain, and a clickable map node before discovery. |
| Hide the exit until destination discovery | Requires no contract or client change | Leaves authored exits invisible and makes the map less useful for navigation. |
| Project directional exit stubs | Shows known paths without revealing destination details | Adds a small optional field to the map projection and dedicated rendering. |

## Consequences and trade-offs

- Positive: known exits appear on the full map and minimap before destination discovery.
- Negative: the map indicates an exit exists but does not identify its destination.
- Compatibility/migration: no persistence change or data migration. The optional projection field is additive; strict server and client schemas should be deployed together.
- Security/abuse/trust: destination IDs, names, terrain, and content are not included in a stub.
- Performance/operational: projection work is bounded by authored exits from visible locations.
- Rollback/reversibility: remove the optional field and its rendering; no saved character exploration state changes.

## Verification

Contract tests validate the stub shape and reject destination IDs. Server projection tests verify hidden destination omission, and web map tests verify the line appears without a room tile in both full map and minimap.

## Follow-up / revisit trigger

Revisit only if map design requires distinguishing multiple undiscovered exits sharing one direction or exposing more destination details before discovery.
