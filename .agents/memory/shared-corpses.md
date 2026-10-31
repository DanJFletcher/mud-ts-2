---
name: Shared PvE corpses and loot
description: Ownership and transfer rules for corpses created when PvE opponents are defeated.
---

PvE and team-combat victories create a world-instance corpse snapshot with authored item and currency loot. The shared world-item aggregate owns the corpse, item availability, and one-time currency claim; character streams remain authoritative for carried items and wallet balance. Item claims reserve the world item before crediting a character, and gold claims reserve the corpse amount before wallet credit. Room corpse contents are display summaries; full equipment metadata is available after a successful claim into character inventory. Player-death drops can be owner-tagged shared corpses created through the PvP outcome flow. Keep all effect IDs and transfer receipts retry-safe.

**Why:** A corpse is visible and searchable by all players, so storing its inventory in one character stream would create inconsistent or duplicable loot. The acting player's PvE/team command must settle corpse creation before building its location projection; room announcements remain asynchronous, and PvP outcome application remains a separate background flow.

**How to apply:** Route PvE and team-combat victory paths through the shared corpse creation effect and settle it before projecting the actor's updated room. Invalidate the shared world-item snapshot before that projection. Keep PvP outcome effects and room announcements asynchronous unless their response contract is deliberately changed. Preserve per-character combat outcomes and do not mutate authored NPC state.
