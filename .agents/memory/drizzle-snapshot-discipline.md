---
name: Drizzle migration snapshot discipline
description: Prevent generated migrations from repeating schema changes already present in manual SQL migrations.
---

Manual SQL migrations that change Drizzle-managed tables must keep the Drizzle snapshot/journal in sync. Otherwise, a later generated migration can repeat table creation or constraints already present in the database.

**Why:** The development database already had a room-state table from an earlier migration, but the next generated migration attempted to create it again and failed before applying lifecycle storage.

**How to apply:** After writing a manual schema migration, update or regenerate the corresponding Drizzle snapshot, then run migration verification against a database that has the preceding migrations applied. Never solve snapshot drift by dropping existing application tables.
