---
name: Production data migrations
description: Safely run one-time production data changes when schema publication and Drizzle migration history differ.
---

Production's Drizzle migration journal can lag the schema applied by Replit Publish. Do not run the general Drizzle migrator at app startup to perform a data-only production cleanup; isolate the data migration and guard it with a persistent database marker.

**Why:** Applying the full pending migration sequence at startup could run unrelated schema migrations against production even though the published schema already contains later changes.

**How to apply:** Publish marker-table schema changes first, then let deployment startup run only the targeted data migration in a transaction with an advisory lock and durable applied marker.

For the single-call append function, do not install function DDL at app startup or add a custom production migration runner. Keep `MUDD_SINGLE_CALL_APPEND` unset until the function and `READ COMMITTED` isolation are verified; if Publish does not carry the function, the user prefers a reviewed, one-time SQL application from the production database console.

**Why:** The user explicitly approved this rollout boundary; Replit’s publishing documentation does not specify whether PostgreSQL functions are included in schema sync.

**How to apply:** After publishing, check `to_regprocedure('mudd_append_command_v1(jsonb)')` and `current_setting('transaction_isolation')` before enabling the production flag and republishing.
