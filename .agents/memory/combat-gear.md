---
name: Character-owned combat state
description: Ownership and event boundaries for equipment, health, consumables, and combat progression.
---

Keep equipment, current/max health, consumables, combat outcomes, and advancement owned by the character aggregate. Item attributes and NPC/shop definitions remain immutable authored content. Combat resolves health changes; item use records consumption on that same character stream. Read `docs/adr/0006-character-scoped-pve-combat.md` before extending this model.

**Why:** The user chose health persistence between fights, so combat injuries and potion healing must replay consistently without introducing shared-world ownership or cross-aggregate writes.

**How to apply:** Preserve character-stream authority for personal equipment, health, consumables, and progression. Revisit the ADR before adding resting/regeneration, shared loot, shared NPC health, party combat, or world-owned items.
