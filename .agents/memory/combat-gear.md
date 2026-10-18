---
name: Character-owned combat state
description: Ownership and event boundaries for equipment, health, consumables, and combat progression.
---

Keep equipment, current/max health, consumables, combat outcomes, and advancement owned by the character aggregate. Item attributes and NPC/shop definitions remain immutable authored content. Combat resolves health changes; item use records consumption on that same character stream. Read `docs/adr/0006-character-scoped-pve-combat.md` before extending this model.

**Why:** The user chose health persistence between fights and established that reaching zero health is permanent death: the game ends and the player must start again with a new character.

**How to apply:** Preserve character-stream authority for personal equipment, health, consumables, and progression. Never revive a defeated character; starting over creates a new character. Revisit the ADR before changing death rules, adding regeneration, shared loot, shared NPC health, party combat, or world-owned items.
