---
name: Performance benchmarking
description: Default to development traces for iterative performance optimization rather than repeatedly publishing to production.
---

Use development traces and the development PostgreSQL database as the benchmark for iterative performance work. The user has approved the development database for test data. Do not publish to production after every optimization step.

**Why:** The user asked to use development as the benchmark going forward instead of repeatedly deploying to production, and explicitly approved the development database for tests.

**How to apply:** Capture a repeatable development baseline, change one measured bottleneck, and rerun the same workload against the development database. Use production validation only after a meaningful development improvement or when the user explicitly asks.

When a slow PostgreSQL query fingerprint maps to `COMMIT`, treat it as commit-acknowledgment latency rather than a query-plan problem. Preserve `fsync` and `synchronous_commit`; aggregate WAL timing alone cannot assign a flush delay to one transaction.

**Why:** A development movement trace had one 201 ms `COMMIT` with no pool wait; a later sample had a 148.8 ms `COMMIT`. Temporary WAL timing showed increased aggregate sync time, but it could not be attributed to the slow transaction.

**How to apply:** Map the fingerprint to its statement template first. If it is `COMMIT`, compare repeated development traces and per-database storage/service metrics; do not optimize indexes or relax durability based on one outlier.
