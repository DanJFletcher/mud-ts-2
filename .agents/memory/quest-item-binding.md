---
name: Quest-bound items
description: Product rule for quest item drop and transfer restrictions.
---

Quest items are untradable and undroppable.

**Why:** the user asked.

**How to apply:** Enforce the restriction on the authoritative server for dropping and every future trade or transfer path.

For a quest item that is handed in and returned as a reward, keep the same character-owned item instance. Validate that the character carries it and record the return in the character reward event; do not mint a duplicate or add NPC custody state for an immediate return.

**Why:** the church-sword quest returns the unique sword the player found.

**How to apply:** Use character-scoped possession objectives and reward item IDs for already-carried items. Define separate ownership rules before supporting newly created item rewards or NPC custody across commands.
