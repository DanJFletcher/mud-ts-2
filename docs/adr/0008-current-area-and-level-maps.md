# ADR 0008: Maps are scoped to the current area and Z level

## Status
Accepted.

## Context
The map previously combined every visited location, including rooms reached by
stairs. Dungeons must not appear on the overworld, and separate dungeons at the
same depth must not appear on each other's maps.

## Decision
Location definitions may specify `mapAreaId` and an integer `mapPosition.z`.
Omitted values mean `overworld` and level `0`, preserving existing content.
Map coordinates are local to an area and level; rooms on different maps may
reuse X/Y coordinates.

The server derives the active map from the character's authoritative current
location. It returns only visited locations with the same area ID and Z level,
and only connections whose two endpoints are on that map. Up/down transitions
remain available as room exits but do not draw cross-level paths.

Entering a dungeon or changing floors automatically switches maps. Returning
restores that map's previously discovered locations; discovery history is never
deleted. Authors must give independent dungeons distinct area IDs and reuse an
area ID across their floors, distinguishing floors with Z.

The Underhollow is authored in the `bell-tower` map area at Z -1. The tower
entrance remains on the default overworld at Z 0.

## Boundaries and compatibility
This is a read-only projection/content change, not a movement rule or new
aggregate. Character movement and visited-location events remain unchanged, as
do ownership, authorization, and the one-active-character-per-world-session rule.
There is no persistence migration or event rewrite.

The existing map response shape is retained. The SDK, compact/full-screen map,
and accessible visited-place list all receive the same server-filtered projection.
Clients neither calculate map membership nor cache a combined overworld map.

## Verification
Cover down/up travel through public movement commands, retention after returning,
multiple rooms on a dungeon floor, undiscovered-room hiding, other areas at the
same depth, other levels in the same area, and omission of cross-map edges.
UI tests must verify both the visual SVG and accessible list follow changed map
projections in compact and full-screen modes.
