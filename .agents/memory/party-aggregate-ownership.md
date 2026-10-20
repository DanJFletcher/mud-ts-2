---
name: Party aggregate ownership
description: MUDD's ownership boundaries for parties, team encounters, and shared quests.
---

Keep generic group membership, a combat encounter's captured team, party-scoped quest progress, and durable character state in separate aggregates. A party may supply an eligibility policy, but it does not own health, inventory, equipment, or the lifecycle of an encounter. Persist resolved combat outcomes to each character through idempotent effects. Roadside victory may move surviving participants only through those character-owned outcome effects. PvP consent remains independent of group membership. See ADR 0014 and ADR 0016.

**Why:** Shared party behavior must preserve one active character per world session, avoid combat roster changes when membership changes, and keep durable character state authoritative.

**How to apply:** Use this boundary for new group, cooperative-combat, and party-quest features; do not move character-owned state into the group stream.
