---
name: Production data migrations
description: Safely run one-time production data changes when schema publication and Drizzle migration history differ.
---

Production's Drizzle migration journal can lag the schema applied by Replit Publish. Do not run the general Drizzle migrator at app startup to perform a data-only production cleanup; isolate the data migration and guard it with a persistent database marker.

**Why:** Applying the full pending migration sequence at startup could run unrelated schema migrations against production even though the published schema already contains later changes.

**How to apply:** Publish marker-table schema changes first, then let deployment startup run only the targeted data migration in a transaction with an advisory lock and durable applied marker.
