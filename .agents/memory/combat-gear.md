---
name: Character-owned combat state
description: Ownership and event boundaries for equipment, health, consumables, and combat progression.
---

Keep equipment, current/max health, consumables, combat outcomes, and advancement owned by the character aggregate. Item attributes and NPC/shop definitions remain immutable authored content. Combat resolves health changes; item use records consumption on that same character stream. Read `docs/adr/0006-character-scoped-pve-combat.md` before extending this model.

**Why:** The user chose health persistence between fights and established that reaching zero health is permanent death: the game ends and the player must start again with a new character.

**How to apply:** Preserve character-stream authority for personal equipment, health, consumables, and progression. Never revive a defeated character; starting over creates a new character. Revisit the ADR before changing death rules, adding regeneration, shared loot, shared NPC health, party combat, or world-owned items.

While combat is active, the client shows dedicated combat controls only; hide the regular quick-action menu and free-text terminal input.

**Why:** The user wants the battle interface focused on the actions available in combat.

**How to apply:** Add future in-battle actions as explicit combat controls backed by authoritative combat commands; do not expose general exploration commands during a fight.

In battle, the Use control opens a menu of currently available combat items instead of placing each item directly in the main action grid.

**Why:** The user requested that combat item selection be grouped behind the Use action.

**How to apply:** Keep the combat controls compact; list only items valid for combat in the menu and hide Use when no items can currently be used.
