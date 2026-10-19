---
name: Character-owned combat state
description: Ownership and event boundaries for equipment, health, consumables, and combat progression.
---

Keep equipment, current/max health, consumables, combat outcomes, and advancement owned by the character aggregate. Item attributes and NPC/shop definitions remain immutable authored content. Combat resolves health changes; item use records consumption on that same character stream. Read `docs/adr/0006-character-scoped-pve-combat.md` before extending this model.

**Why:** The user chose health persistence between fights. On 2026-10-19, they changed the death rule: the same character respawns at the authored fountain with full health, and one random droppable item becomes shared loot at the death location.

**How to apply:** Preserve character-stream authority for personal equipment, health, consumables, and progression. Keep quest-bound and equipped items protected from death drops; use the world-item aggregate for loot any player may claim. Read `docs/adr/0013-character-respawn-and-shared-death-drops.md` before extending respawn or shared-item behavior.

While combat is active, the client shows dedicated combat controls only; hide the regular quick-action menu and free-text terminal input.

**Why:** The user wants the battle interface focused on the actions available in combat.

**How to apply:** Add future in-battle actions as explicit combat controls backed by authoritative combat commands; do not expose general exploration commands during a fight.

In battle, the Use control opens a menu of currently available combat items instead of placing each item directly in the main action grid.

**Why:** The user requested that combat item selection be grouped behind the Use action.

**How to apply:** Keep the combat controls compact; list only items valid for combat in the menu and hide Use when no items can currently be used.

Paid inn rest belongs to the character stream: the server resolves the authored fee and current health, and records the wallet debit and full restoration atomically. The combat plugin remains the owner of maximum-health policy; see `docs/adr/0007-character-scoped-paid-inn-rest.md`.

**Why:** The user chose paid full-health restoration at inns and the existing rules make health, currency, and death character-scoped.

**How to apply:** Reject rest away from an authored inn, during active combat, at full health, without sufficient currency, or after permanent death. Do not move healing or price authority into the client.
