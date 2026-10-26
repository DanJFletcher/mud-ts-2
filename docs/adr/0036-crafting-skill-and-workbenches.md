# ADR 0036 — Server-authoritative crafting skill and workbenches

- **Status:** Accepted
- **Date:** 2026-10-26
- **Owners:** MUDD core
- **Related tasks:** Initial leather crafting feature

## Context

Crafting adds world-authored recipes, a character skill, tool and material checks, item consumption, and created inventory items. The engine must remain modular and authoritative: clients may request crafting, but may not decide eligibility, consume resources, or award skill experience.

## Decision

- Implement crafting as the first-party `mudd.crafting` plugin. Worlds declare recipe definitions and workbench locations.
- Register a read-only crafting catalog query and an idempotent craft command. The server validates location, character state, skill level, tools, materials, and quantity before appending a character event.
- Store each completed craft in the character event stream with a recipe snapshot, exact material consumption, created item instances, and crafting experience. Store fractional experience in hundredths so the authored awards remain exact during replay.
- Reuse the existing skill progression curve: each next level requires an additional `25 × current level²` experience.
- Model the Spool of Thread as a non-stackable item with remaining uses. Repeated merchant listings create distinct spool instances so players can purchase replacement spools.
- Keep the initial leather outputs as ordinary inventory items. Do not add equipment behavior or tanning in this slice.
- Keep the client responsible for command entry, quantity selection, terminal feedback, and displaying the character’s crafting skill.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Add crafting directly to the character plugin | Fewer runtime plugins | Mixes recipe gameplay with character ownership and makes the engine less modular. |
| Store recipes only in client code | Easy to show recipe choices | Client-authored eligibility would weaken the server authority boundary and make worlds harder to extend. |
| Use whole-number XP | Simpler representation | Loses the requested 13.8 and 16.25 XP awards. |
| Represent thread uses as a stack quantity | Reuses existing item counts | Makes a single spool look like five separate spools in inventory. |

## Consequences and trade-offs

- Positive: Recipe content is world-specific; replay remains deterministic; repeated actions use the existing command idempotency boundary.
- Negative: Craft completion events include recipe and output snapshots, so event payloads are larger than a minimal recipe-ID event.
- Compatibility/migration: Crafting skill and item-use fields are optional on older character projections. Existing merchant listings remain one-time unless explicitly marked repeatable. No database schema migration is required.
- Security/abuse/trust: The server alone validates the workbench, level, materials, tools, and batch size. Output items are constrained to inventory-only metadata for this release.
- Performance/operational: Crafting uses the character stream and world pack data; it introduces no global per-craft database query.
- Rollback/reversibility: Content can be changed in a later world-pack version. Existing craft events remain replayable from their recipe snapshots and should not be deleted.

## Verification

The crafting integration test covers shop purchases, repeatable spools, workbench enforcement, material and use consumption, batch idempotency, inventory-only output, and skill XP/level replay. UI tests cover the accessible quantity dialog.

## Follow-up / revisit trigger

Add deer-hide tanning as a separate gameplay system before making the leather recipes practically obtainable. Add equipment slots and combat effects only in a later feature if crafted leather items should become wearable.
