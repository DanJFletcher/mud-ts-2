---
name: Orraveth Codex separation
description: Project constraint keeping Orraveth lore separate from MUDD's existing demo world.
---

Orraveth is lore for a new, separate world. Keep its canon and gameplay state separate from the existing MUDD Waystone demo. Characters are bound to one world instance; an account can have a separate character and session in each world. See ADR 0022 for the ownership model.

**Why:** the user clarified that Orraveth is a new world, then asked accounts to play multiple worlds without transferring an existing character between them.

**How to apply:** Keep Orraveth articles and its world pack standalone. Route commands, sessions, and durable effects through the selected world instance; never merge character streams or transfer character progress between worlds.
