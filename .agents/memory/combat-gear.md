---
name: Character-owned combat gear
description: Ownership and event boundaries for character equipment and combat effects.
---

Keep equipment owned by the character aggregate: item attributes are immutable authored content, equipment changes are character events, and combat consumes equipped stats and records resolved outcomes on the same character stream. Read `docs/adr/0006-character-scoped-pve-combat.md` before extending this model.

**Why:** Character-scoped ownership avoids introducing cross-aggregate consistency for gear while combat remains independent per character.

**How to apply:** Preserve character-stream authority for personal equipment and progression. Revisit the ADR before adding shared loot, shared NPC health, party combat, or world-owned items.
