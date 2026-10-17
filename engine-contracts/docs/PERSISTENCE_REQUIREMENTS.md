# Proposed PostgreSQL / Drizzle persistence boundary

These are **suggested entities and invariants**, not existing migrations or DB schemas. See the full original `originals/architect/DATA_MODEL.md`.

| Suggested table | Important properties |
| --- | --- |
| `players` | Stable authenticated owner; no auth secrets in game events |
| `characters` | Player owner, instance, name, revision, ruleset-associated state |
| `sessions` | Player, selected character, instance, expiry/revocation; avoid raw session tokens |
| `world_definitions`, `world_instances` | Versioned definition vs authoritative instance |
| `regions`, `locations`, `exits` | Validated graph definitions and instance state overrides |
| `entity_definitions`, `entity_instances` | Immutable template reference vs runtime entity |
| `events` | Event ID, instance, stream, stream revision, type, schema version, payload, actor, causation, tick, time |
| `command_receipts` | Unique `(instance, actor, command_id)` and payload hash; receipt committed atomically with events |
| `projection_checkpoints`, `outbox` | Rebuild/retry and scoped delivery bookkeeping |
| `inventory`, `item_instances` | Only if initial game slice needs items, not necessary for movement-only MVP |

Unique `(instance_id, stream_id, stream_version)` makes concurrent stale appends conflict. Add proper transactional locking/constraints for multi-stream atomicity. Do not use raw Drizzle table objects in domain plugin rules.

Earlier project schemas such as `nations`, `regions`, `persons`, `sources`, `images`, `tags`, and `timelineEntries` might describe historical/worldbuilding data. They are **not automatically** identical to player/runtime entities and should be preserved/mapped deliberately if already present.
