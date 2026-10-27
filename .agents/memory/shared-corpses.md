---
name: Shared PvE corpses and loot
description: Ownership and transfer rules for corpses created when PvE opponents are defeated.
---

PvE victories create a world-instance corpse snapshot with authored item and currency loot. The shared world-item aggregate owns the corpse, item availability, and one-time currency claim; character streams remain authoritative for carried items and wallet balance. Item claims reserve the world item before crediting a character, and gold claims reserve the corpse amount before wallet credit. Room corpse contents are display summaries; full equipment metadata is available after a successful claim into character inventory. Keep all effect IDs and transfer receipts retry-safe. Player-death drops remain loose shared room items unless their ownership model is deliberately revised.

**Why:** A corpse is visible and searchable by all players, so storing its inventory in one character stream would create inconsistent or duplicable loot. The existing world-item stream already serializes shared claims without a new database aggregate.

**How to apply:** Route all PvE victory paths, including road and party encounters, through the shared corpse creation effect. Preserve per-character combat outcomes and do not mutate authored NPC state.
