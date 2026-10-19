---
name: Current-area map visibility
description: The user's intended separation of overworld, dungeon, and floor maps.
---

Dungeon rooms must not appear on the main overworld map, even after discovery.
The map follows the character's current area and floor; descending into a
basement shows its discovered rooms, and returning restores the overworld view.
Previously discovered rooms stay remembered rather than becoming undiscovered.

**Why:** The user wants future dungeons to have their own maps instead of
cluttering the overworld.

**How to apply:** Keep map membership server-authoritative and test travel in
both directions. Independent dungeons must not share a map merely because they
have the same depth. See ADR 0008 for the authoring and compatibility decision.
