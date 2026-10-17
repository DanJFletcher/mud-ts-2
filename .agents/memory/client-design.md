---
name: Client design priorities
description: User direction for MUDD's gameplay UI, navigation, and mobile priority.
---

- Mobile is the most important layout.
- The game should have a tight, focused UI around what the player is doing and the actions they can take, not feel like a marketing website.
- Traveler info and Field notes should be separate screens the player navigates to.
- Marketing language can be reserved for the main home or login page, not gameplay.
- Play uses one terminal: show only the current room name above the transcript, emit default `look` output on room entry, scroll the transcript independently, dock the command field, keep Available paths separate, and show no message counts.
- Quick commands should take minimal vertical space. They start with `look`; Walk replaces it with directions available in the current room.

**Why:** The user rejected marketing-like gameplay copy and asked for a terminal-focused Play view. Room descriptions should come from default `look` output rather than duplicate static text; quick controls should center on actions, not event counts.

**How to apply:** Prioritize mobile gameplay; keep the room name as context, put room descriptions and command results in the transcript, make only the transcript scrollable, dock commands at the bottom, omit activity counts, preserve Available paths separately, and derive Walk options from current open exits.
