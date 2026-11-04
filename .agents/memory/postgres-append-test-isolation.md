---
name: PostgreSQL append-path test isolation
description: Keep PostgreSQL integration tests deterministic when the development fast-path flag is enabled.
---

Path-specific PostgreSQL tests should set `singleCallAppend` explicitly instead of inheriting the process-level flag.

**Why:** Development may enable the single-call path globally, while query-count and parity tests need to exercise a particular route. Relying on the environment can silently test a different path.

**How to apply:** Construct stores with explicit path settings and run integration coverage against an isolated temporary database with the flag both disabled and enabled.
