---
name: Client design priorities
description: User direction for MUDD's gameplay UI, navigation, and mobile priority.
---

- Mobile is the most important layout.
- The game should have a tight, focused UI around what the player is doing and the actions they can take, not feel like a marketing website.
- Traveler info and Field notes should be separate screens the player navigates to.
- Marketing language can be reserved for the main home or login page, not gameplay.
- Play uses one terminal: show only the current room name above the transcript, emit default `look` output on room entry, scroll the transcript independently, dock the command field, keep Available paths separate and compact, and show no message counts.
- Quick commands should stay compact: the main page has no visible Quick label and offers Look, Read, Drop, and Go; a second page offers Take and Help. Quick Look and Take list only items still in the current room. After a quick action submits, return to the main page.
- Initial `read` support targets signs and markers in the character’s current room; inventory items are not readable yet.
- Targeted `look [at] <object>` describes a visible object’s appearance; `read <object>` returns its written text. Both are limited to the current room.

**Why:** The user rejected marketing-like gameplay copy and asked for a terminal-focused Play view. Room descriptions should come from default `look` output rather than duplicate static text; quick controls should center on actions, not event counts. The user asked for compact quick-action pages, with Take and Help on a second page, no visible Quick label on the first, no quick targeting of items already picked up, room descriptions that omit items after pickup, and quick actions that return to the main page after submission.

**How to apply:** Prioritize mobile gameplay; keep the room name as context, put room descriptions and command results in the transcript, make only the transcript scrollable, dock commands at the bottom, omit activity counts, keep Available paths as a compact touchable grid, derive Go options from current open exits, keep Take and Help on the second quick-action page, return to the first page after executing a quick action but not after opening a selector, limit quick Look and Take targets to objects still present in the current room, include takeable-item room descriptions only while those items are in that room, and resolve typed `look [at] <target>` and `read <target>` against their supported objects.
