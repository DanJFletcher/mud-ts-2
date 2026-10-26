---
name: Ephemeral PostgreSQL tests
description: Isolate database integration tests with a temporary local PostgreSQL instance in the Nix development container.
---

Run mutating PostgreSQL integration tests only against a dedicated temporary test database; do not substitute the regular `DATABASE_URL` to bypass the suite's test-database guard.

**Why:** The integration suite intentionally scopes and cleans its fixtures, and the container's PostgreSQL default socket path may point to a missing `/run/postgresql` directory.

**How to apply:** Initialize a temporary data directory, start PostgreSQL with its Unix socket directory set to that same writable temp directory, migrate the isolated database, run the integration test, then stop the server and remove the temp directory.
