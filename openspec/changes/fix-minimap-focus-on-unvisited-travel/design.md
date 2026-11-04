# Design

## Context

See `proposal.md` for the reported behavior. The server map projection contains visited rooms and rooms configured as visible while unvisited; an undiscovered destination is represented only by an exit stub. During optimistic travel, `PlayScreen` currently substitutes the destination preview's ID for `map.currentLocationId`. The preview has no map coordinates, and `WorldMapPanel` falls back to the first projected point when it cannot find the requested current room.

## Goals / Non-Goals

**Goals:**
- Keep optimistic map focus valid against the locations currently projected to the player.
- Preserve the minimap's existing optimistic focus for destinations already present in the projection.
- Recenter on a newly visited destination when its authoritative projection arrives.
- Preserve hidden-room visibility boundaries and existing travel rollback behavior.

**Non-Goals:**
- Reveal undiscovered destinations or add coordinates to destination previews.
- Change server map projection rules, travel commands, or the map contract.
- Change focus behavior for full-screen map panning or manual room selection.

## Decisions

- Resolve optimistic focus against the current map projection at the screen boundary. Use the preview destination as the map's current location only when that destination exists in `snapshot.map.locations`; otherwise keep the authoritative map unchanged until the next snapshot includes the destination.
  - This keeps existing optimistic behavior for already represented rooms while preventing an invalid focus ID from reaching the minimap.
  - Adding destination coordinates to the travel preview was rejected because it would disclose map placement for rooms intentionally hidden by fog of war.
  - Changing the minimap's generic first-point fallback alone was rejected as the primary fix: it would mask an invalid optimistic focus rather than preserve the last authoritative room and could produce a different but still arbitrary viewport.
- Add a client regression test around optimistic travel state, not a server projection test only. Verify that a destination absent from `map.locations` leaves focus on the source, that a represented destination can be focused optimistically, and that authoritative arrival moves focus to the destination.

## Risks / Trade-offs

- **[Risk]** The minimap remains centered on the departure room for the short period when an undiscovered destination is pending. **Mitigation:** Keep the known exit stub visible; recenter as soon as the authoritative projection marks the destination visited.
- **[Risk]** Another caller could pass a current location ID absent from the map projection. **Mitigation:** The travel-to-map regression covers this transition; consider a separate generic invalid-projection policy only if another caller is found.

## Migration Plan

No migration or protocol change is required. The source map remains authoritative throughout travel; rollback continues to restore the existing source state.
