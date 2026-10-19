---
name: Consent-based PvP
description: MUDD PvP consent and character ownership invariants.
---

Player-versus-player combat is opt-in: one player challenges another, and the recipient must accept before combat begins. Keep one active character per world session. Shared encounter state may coordinate turns and temporary combat values, but character health, gear, and consumables remain owned by each character stream. Death returns a character to the world's configured respawn point and drops one random eligible item at the death location; quest-bound and equipped items are protected. Keep PvP consent independent from party membership. See ADR 0012 for the interaction lifecycle and consistency boundary.

**Why:** The user explicitly requires consent and a single selected character per world session, then replaced permanent death with a world respawn point and a death-drop rule.

**How to apply:** Preserve these boundaries when adding PvP actions, rewards, matchmaking, group combat, or new interaction kinds.
