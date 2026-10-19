---
name: Consent-based PvP
description: MUDD PvP consent and character ownership invariants.
---

Player-versus-player combat is opt-in: one player challenges another, and the recipient must accept before combat begins. Keep one active character per world session. Shared encounter state may coordinate turns and temporary combat values, but character health, gear, and consumables remain owned by each character stream. PvP damage can trigger the existing permanent-death rule; do not introduce revival or PvP rewards without a separate decision. See ADR 0012 for the interaction lifecycle and consistency boundary.

**Why:** The user explicitly requires consent and a single selected character per world session; existing combat rules make character health durable and death permanent.

**How to apply:** Preserve these boundaries when adding PvP actions, rewards, matchmaking, group combat, or new interaction kinds.
