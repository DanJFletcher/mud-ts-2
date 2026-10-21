---
name: Water travel
description: The intended access rule for river locations in MUDD.
---

River nodes must connect to one another through directional exits. They are accessible from land by boat when a land location has an exit connecting to the river.

Bridge contexts such as `on` and `under` are independent per character and do not change the location's map coordinates or Z level.

**Why:** the user stated the intended river-travel rule and chose per-character bridge context.

**How to apply:** keep context in the character's position, link adjacent river locations with exits, and show those links before discovery. When land-to-river travel is implemented, require boat access and an authored exit from land to river.
