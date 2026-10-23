---
name: Character-owned combat state
description: Ownership and event boundaries for equipment, health, consumables, and combat progression.
---

Keep equipment, current/max health, stamina and mana pools, consumables, combat outcomes, and advancement owned by the character aggregate. Stamina pays for PvE fleeing; mana is tracked until magical actions are designed. Item attributes and NPC/shop definitions remain immutable authored content. Combat resolves health changes; item use records consumption on that same character stream. Read `docs/adr/0006-character-scoped-pve-combat.md` and `docs/adr/0027-character-stamina-and-mana.md` before extending this model.

**Why:** The user chose health persistence between fights and, on 2026-10-22, persistent stamina/mana pools, a 20-stamina PvE flee cost, and full inn recovery. On 2026-10-19, they changed the death rule: the same character respawns at the authored fountain with full health, and one random droppable item becomes shared loot at the death location.

**How to apply:** Preserve character-stream authority for personal equipment, health, stamina, mana, consumables, and progression. Keep quest-bound and equipped items protected from death drops; use the world-item aggregate for loot any player may claim. Read `docs/adr/0013-character-respawn-and-shared-death-drops.md` before extending respawn or shared-item behavior.

Primary attributes and honors also belong to the character aggregate. Derive combat ratings on the server from character attributes and equipped gear instead of persisting a second, potentially stale stat snapshot. Strength affects damage and Constitution affects maximum health in solo, party, and PvP combat; other ratings remain tracked until their mechanics are defined.

**Why:** The Stats screen and combat need one authoritative source while previously recorded combat outcomes remain stable during replay.

**How to apply:** Keep formulas and the `character.stats` query authoritative in the combat plugin. Read `docs/adr/0024-character-stats-and-combat-projections.md` before changing stat ownership, formulas, or activation scope.

While combat is active, the client shows dedicated combat controls only; hide the regular quick-action menu and free-text terminal input.

**Why:** The user wants the battle interface focused on the actions available in combat.

**How to apply:** Add future in-battle actions as explicit combat controls backed by authoritative combat commands; do not expose general exploration commands during a fight.

In battle, the Use control opens a menu of currently available combat items instead of placing each item directly in the main action grid.

**Why:** The user requested that combat item selection be grouped behind the Use action.

**How to apply:** Keep the combat controls compact; list only items valid for combat in the menu and hide Use when no items can currently be used.

Paid inn rest belongs to the character stream: the server resolves the authored fee and current health/resources, and records the wallet debit and full restoration atomically. The combat plugin remains the owner of maximum-health policy; see `docs/adr/0007-character-scoped-paid-inn-rest.md` and `docs/adr/0027-character-stamina-and-mana.md`.

**Why:** The user chose paid full-health restoration at inns and later chose for inns to restore stamina and mana at the existing price. The existing rules make health, resources, currency, and death character-scoped.

**How to apply:** Reject paid inn rest away from an authored inn, during active solo combat, when all three vitals are full, without sufficient currency, or after permanent death. Do not move recovery or price authority into the client.

Free resting should be allowed anywhere and should restore health, stamina, and mana, rather than only stamina at designated safe locations.

**Why:** The user requested resting anywhere and explicitly chose recovery for all three vitals, using Written Realms’ recovery loop as the reference.

**How to apply:** Treat this as the requested free-rest policy, distinct from paid instant inn recovery; check implementation status before claiming the behavior is already available.
