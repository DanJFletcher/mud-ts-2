# Daily town jobs and supplies

## Decision

Town boards are authored in the world pack. Each slot rotates through authored variants
using the absolute UTC day number. A posting's identity is world instance + board +
UTC date + template ID. No random selection, scheduler, mutable global claim, or
query-side write is needed. Content releases may change the catalogue; maintain stable
IDs and do not remove a published posting during a cycle. Accepted jobs record their
terms so later edits to quantity or rewards do not change an existing agreement.

Characters own acceptance, completion, material collection limits, gold and experience.
Every character, including guest characters, may complete each posting once per UTC day.
The midnight UTC reset expires unfinished postings without removing carried items.
Supply collection is six units per authored source per character per day in Bellwold.
There is deliberately no spoilage model; "freshly caught" describes fish, not an expiry timer.

Physical items have an optional authored `typeId`, distinct from their unique instance
ID. Delivery matches type IDs and consumes exact physical instances, never labels.
Bound or equipped items cannot be delivered. Shared corpse loot retains its type through
pickup and drop. Consumption of shared loot is a terminal world-item event, committed
as a companion write atomically with the character's delivery and rewards.

Delivery records the resolved cycle, consumed instance IDs, reward amounts and resulting
level/maximum health. Replay does not consult today's clock or reroll rewards. Optimistic
character and world-item revisions plus command-ID deduplication protect retries and
concurrent deliveries. Existing combat level thresholds and constitution health rules apply.
The board query uses the host's injected clock, just like commands.

## Compatibility and limits

All added authoring/projection fields default to empty; old worlds, characters and quest
events still replay. Old one-time and party quests do not share daily completion flags.
The daily ledger retains its latest acted-on cycle; older unfinished entries may remain
visible as expired until the next board action. Historical facts remain in the event log.

This is not a full crafting/fishing or renewable-world economy system. Hunting uses
existing road encounters and shared corpse loot. Collection is an explicit, bounded
server action on a land room; it never requires entering river water.
