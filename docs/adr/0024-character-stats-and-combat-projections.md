# ADR 0024: Character stats and combat projections

- Status: Accepted
- Date: 2026-10-22

## Context

The client needs a consistent character sheet for primary attributes, combat ratings, advancement, currency, and honors. Existing character streams already own health, equipment, advancement, and wallet state. Combat is server-authoritative and records resolved outcomes; the client must not calculate gameplay rules.

## Decision

- Primary attributes (`Strength`, `Intelligence`, `Constitution`, `Dexterity`) and honors (`Glory`, `Medals`) belong to the character aggregate. Character creation records balanced attributes of 10 and honors of 0. Replaying older character-created events supplies those same defaults without rewriting stored events.
- The combat plugin provides a read-only `character.stats` query. It derives the displayed combat ratings from the current character projection and equipment; these ratings are not copied into a second persistence aggregate.
- Strength contributes to actual damage in solo PvE, party PvE, and PvP. Damage is `max(1, 2 + floor((Strength - 10) / 5) + weapon attack bonus)`.
- Constitution contributes to maximum health in solo PvE, party PvE, and PvP. Maximum health is `max(1, 6 + 2 × (level - 1) + floor((Constitution - 10) / 5))`.
- A Strength and Constitution of 10 preserve the existing level-one baseline of 2 base damage and 6 health. Existing weapon bonuses and flat armor defense remain in effect.
- The Stats screen displays the complete stat list. Spell power, regeneration, critical chance, resilience, dodge, and honor awards are tracked or projected for future systems; they do not introduce spell, stamina, critical-hit, avoidance, regeneration, or honor-award mechanics in this change. The displayed Armor percentage is a rating derived from equipped armor; current combat continues to apply its established flat defense bonus.
- XP and level continue to come from character advancement. The currency row uses the active world's wallet and currency name, so a world may label it Gold or another currency.
- Combat outcomes remain event facts. Replay does not recalculate historical damage or health from current stat formulas.

## Consequences

- Existing character data remains playable and receives the balanced defaults during replay. No database migration or shared-world aggregate change is required.
- Combat and the Stats screen use one server-side stat calculation, while browser code only renders the returned projection.
- Future attribute allocation, resource pools, new combat rolls, regeneration behavior, and Glory/Medal awards need their own rules and event contracts before they become active.
