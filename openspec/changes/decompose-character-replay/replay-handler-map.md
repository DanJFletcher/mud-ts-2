# Character replay handler map

The original reducer is a single ordered event-type chain in `replay.ts`.
Accepted versions below are the versions declared by the event schemas parsed
in each branch. Every event family has public replay coverage; `quest.choice_selected`
is exercised by `quest-branching.test.ts` rather than `replay.test.ts`.

| Responsibility | Event branches and accepted versions | Existing public replay coverage |
| --- | --- | --- |
| Character creation and lifecycle | `character.created` v1/v2/v3; `character.renamed` v1; `character.archived` v1; `character.restored` v1 | `replay.test.ts` |
| Travel and place state | `character.moved` v1 | `replay.test.ts` |
| Gathering and timed work | `character.supply_gathered` v1; `character.fishing_cast_started` v1; `character.fishing_cast_advanced` v1; `character.woodcutting_action_started` v1; `character.woodcutting_action_advanced` v1; `character.daily_job_changed` v1 | `replay.test.ts` |
| Resources, posture, and abilities | `character.class_selected` v1; `character.ability_resource_spent` v1; `character.stamina_spent` v1; `character.stamina_recovery_settled` v1; `character.vital_recovery_settled` v1; `character.posture_changed` v1 | `replay.test.ts`, `replay-cache.test.ts` |
| Combat, advancement, and respawn | `character.combat_encounter_started` v1; `character.combat_action_resolved` v1/v2/v3; `character.advancement_awarded` v1/v2; `character.combat_item_used` v1; `character.pvp_outcome_applied` v1; `character.team_combat_outcome_applied` v1; `character.respawned` v1 | `replay.test.ts`, `replay-cache.test.ts` |
| Wallet, commerce, crafting, and rest | `character.wallet_initialized` v1; `character.merchant_item_purchased` v1; `character.crafting_completed` v1; `character.inn_rest_completed` v1/v2; `character.corpse_gold_received` v1 | `replay.test.ts` |
| Inventory, equipment, and shared objects | `character.item_taken` v1; `character.item_granted` v1; `character.item_dropped` v1; `character.item_stored` v1; `character.equipment_changed` v1; `character.item_used` v1; `character.object_read` v1; `character.shared_item_received` v1; `character.shared_item_relinquished` v1 | `replay.test.ts` |
| NPC dialogue and quests | `character.npc_dialogue_choice_made` v1; `character.npc_dialogue_restarted` v1; `quest.accepted` v1; `quest.choice_selected` v1; `quest.completed` v1; `character.quest_rewarded` v1 | `replay.test.ts`, `quest-branching.test.ts` |

The test audit found no uncovered event branch. Existing tests exercise all
families through public replay; focused characterization added cached/cold parity
for forked team defeats, duplicate ability action IDs, and team-victory advancement.
It also pins failure ordering for revision gaps, malformed pre-creation events,
and contiguous unknown types. No behavior changes were needed before extraction.

The extracted handlers must preserve the reducer's order and validation
boundaries: continuity is checked before event dispatch, each branch parses its
stored event schema, creation gates run before branch payload parsing where they
do today, and each successful branch advances the projection revision exactly
once.
