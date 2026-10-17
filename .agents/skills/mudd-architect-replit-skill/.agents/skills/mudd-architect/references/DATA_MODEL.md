# Data model, persistence and content

## Persistence adapters

**Server mode:** PostgreSQL + Drizzle ORM schemas/migrations, Zod input validation, transactional event writes. **Browser-local mode:** a storage adapter (prefer IndexedDB for persistence and transactions; memory only for tests) behind the same event-store port. In local mode, explicitly document any weaker transaction guarantees and guard against partial writes.

The domain code must not manipulate Drizzle table objects directly. Keep translation/adapters near persistence composition. Do not store essential game state only in Replit-local filesystem or ephemeral memory.

## Suggested relational tables (not mandated names)

| Entity | Essential fields and constraints |
| --- | --- |
| `players` | `id`, stable auth subject, display name, created/updated at; auth secrets in dedicated identity provider/secured storage |
| `characters` | `id`, `player_id`, `instance_id`, name, ruleset ID, profile, lifecycle state, version; index owner and instance |
| `sessions` | `id`, `player_id`, chosen `character_id?`, `instance_id?`, created/expires/revoked at; avoid persistent raw session tokens |
| `world_definitions` | `id`, version, ruleset association, source/content-pack manifest |
| `world_instances` | `id`, `world_definition_id`, host/authority, lifecycle, current tick, created at |
| `regions` / `locations` / `exits` | versioned world definitions and instance overrides; explicit exit graph and permissions |
| `entity_definitions` | versioned object/creature/item/resource templates with Zod-validated payload |
| `entity_instances` | unique ID, world instance, definition/version, location/owner, dynamic components |
| `inventory` / `item_instances` | owner or container IDs, quantities, custody constraints, indexes; transfer transactional |
| `events` | event ID, instance ID, stream ID, stream version, event type/schema version, JSONB payload, actor, causation/correlation, committed at and logical tick |
| `command_receipts` | unique `(instance_id, actor_id, command_id)` plus payload hash, outcome/committed event range |
| `projection_checkpoints` | consumer name + instance + cursor and schema/rebuild version |
| `outbox` | event to publish, delivery status/retry policy, cursor/version |

Keep sensitive authentication state separate from player profile. Event payloads are often retained indefinitely; minimize PII and avoid credentials/tokens in event history. Apply row-level/application-level instance isolation and least-privilege access.

## Event concurrency constraints

- Enforce unique `(instance_id, stream_id, stream_version)` in the database.
- Enforce unique command idempotency key in the same transaction as event append.
- Do not implement version check as `SELECT` then unconditional `INSERT`; unique constraints or proper transactional locking must prevent races.
- Cross-aggregate commands that affect multiple items/characters require a transaction and a documented ordering/locking policy; avoid cycles.
- Avoid relying on async outbox delivery for correctness of transaction-local invariants.

## Schema typing conventions

- Use stable `uuid` or another documented sortable ID; avoid raw string ambiguity in public code with branded IDs or scoped types where practical.
- Drizzle defines persistence shape; Zod defines trust-boundary payloads and serialized content. Validate JSONB on ingestion and when versions change, not merely by TS assertion.
- Every runtime scoped record includes `instanceId` or a verifiable parent relationship. Define cascades deliberately to avoid world-history loss.
- Add `createdAt`, `updatedAt` where meaningful, and separate business/event times from DB timestamps.
- Migrations are incremental, reviewed, tested against existing data; don't modify applied migrations in place.
- Public DTOs/events are not raw table rows. Version DTO/event shapes and maintain upcasters for persisted event evolution.

## Legacy/contextual schema coexistence

Some earlier project schemas included `nations`, `regions`, `persons`, `sources`, `images`, `tags`, `timelineEntries`. These may belong to content/worldbuilding provenance rather than runtime game state. Preserve them if present; create an explicit mapping/import boundary instead of quietly renaming them to players/characters or duplicating data. Avoid forcing these tables into a new engine without real requirements.

## Content and rules data

Keep **definition** and **instance** separate. Validated world definition files (JSON/YAML or TS literal data) can contain locations, exits, room prose, item templates, creature definitions, NPC schedules, dialogues, encounters and trigger declarations. A loader imports them after schema validation and content version checks. The content pack does not get unrestricted database access.

For optional D&D-like content, track a license/source for every import. Never assume an uploaded proprietary book is licensed for redistribution. Prefer a properly licensed SRD or original example creatures/content; separate game mechanics from protected published adventure expression.

## Suggested projections

- Character view: profile, current location, stats/resources, inventory reference, revision.
- Location view: visible exits, visible objects, occupants, atmosphere and text description (viewer-filtered).
- Combat view: participants, turn order, legal action summary, current round and revision.
- Session/presence view: connected/disconnected state, current character and last seen.
- World map view: discovered locations/regions, not hidden global map by default.

Projections must be rebuildable. Verify by deleting disposable read models, replaying events, and comparing expected state. Provide `rebuild` tooling only if it is safe/necessary at current stage.
