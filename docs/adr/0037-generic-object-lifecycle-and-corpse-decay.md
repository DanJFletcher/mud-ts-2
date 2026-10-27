# ADR 0037 — Generic object lifecycle and corpse decay

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** MUDD core
- **Related work:** Persistent world-object expiration and corpse lifecycle
- **Supersedes:** The loose death-drop presentation in ADR 0013; its item-selection and ownership rules remain in force.

## Context

Shared world objects need reliable expiration that survives process restarts and works across multiple server workers. Corpse behavior also needs NPC and player policies, searchable contents, expiry descriptions, and player-loot recovery without moving world authority into the PWA.

## Decision

- Keep expiration generic in the core plugin boundary. Each object has its own lifecycle stream with scheduled, rescheduled, cancelled, expiring, and expired events. The event stream is authoritative.
- Maintain a PostgreSQL `world_object_lifecycles` projection with a due-time index and expiring leases. This is a rebuildable scheduler index, not a second source of gameplay truth. Workers claim rows with `FOR UPDATE SKIP LOCKED`, then dispatch a trusted system command.
- Keep corpses and their contents in the existing shared `world-items` stream. A separate corpse-lifecycle plugin responds to object expiration and atomically writes corpse removal, lifecycle completion, and owner recovery in the affected character stream.
- Preserve the existing player death penalty: select one carried, non-equipped, non-quest-bound item. Place it inside an owner-associated player corpse; return unclaimed contents to that owner when the corpse expires. Claimed items remain with their claimant.
- Use these world defaults: ordinary NPC corpses 300 seconds, boss corpses 900 seconds, player corpses 1,800 seconds, and empty corpses at most 60 seconds. NPC corpses default to destruction; player corpses default to recovery storage. NPC definitions and road encounters may override category, lifetime, and valid NPC expiration policies.
- Record drop-policy currency as a separate room-held currency drop so it remains claimable after its corpse disappears. Drop-policy items likewise become loose shared world items.
- Hide expired corpses from room and inspection queries, reject claims after expiry, and use sensory decay-stage text while the corpse remains visible.
- Send creation and expiration announcements through the existing durable room-message path. The client’s existing terminal-event channel displays them; no new WebSocket protocol is introduced.
- Legacy corpse events may omit lifecycle metadata. They remain replayable and are not assigned invented timestamps during replay.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Scan all world-item events on a timer | No extra table | Expiration work grows with full event history and does not provide a bounded due queue. |
| Treat the SQL row as the source of truth | Simple scheduler reads | Could diverge from replayable gameplay state and weaken event-sourced authority. |
| Put lifecycle events in the single shared world-item stream | Fewer streams | Unrelated objects contend on one aggregate and lifecycle history is coupled to corpse contents. |
| Delete player drops at corpse expiry | Simple cleanup | Loses items the player never had a chance to recover. |
| Add a new socket event protocol for announcements | Direct push semantics | Duplicates existing durable room-chat delivery and reconnect handling. |

## Consequences and trade-offs

- Positive: Due work is indexed, leased, restart-safe, replayable, and independently owned per object.
- Positive: Shared loot, character inventory, and lifecycle transitions remain server-authoritative and idempotent.
- Negative: A corpse expiration may need atomic companion writes across the lifecycle, world-item, and owner-character streams. Conflicts cause a retry rather than partial loss.
- Compatibility/migration: Existing corpse payloads remain valid because lifecycle metadata is optional. New events use explicit versions. Migration 0010 creates the scheduler projection; it is safe when the earlier room-state table already exists.
- Security/abuse/trust: Players cannot call the system expiration command. Existing command authorization, corpse item reservations, and event idempotency remain unchanged.
- Performance/operational: Workers query only due rows for their world and claim them with leases. A failed effect remains retryable. The 10-second scheduler interval bounds expiry delay without polling full event streams.
- Rollback/reversibility: Old corpse events continue to replay. Disabling the scheduler pauses expiration without deleting corpse state. Do not remove lifecycle history or shared-item records as a rollback strategy.

## Verification

- Unit tests cover lifecycle transitions and corpse-expiry projections, including loose currency after a drop-policy expiry.
- Integration tests cover player corpse contents, one-winner item claims, NPC corpse loot, terminal announcements, and room-query visibility.
- Development migration 0010 applied successfully; `world_object_lifecycles` exists and begins empty.
- Full workspace checks are recorded with the implementation delivery.

## Revisit trigger

Add object-type-specific lifecycle handlers before scheduling non-corpse objects. Add database-backed restart/lease recovery tests before operating more than one production worker.
