---
name: Performance benchmarking
description: Default to development traces for iterative performance optimization rather than repeatedly publishing to production.
---

Use development traces and the development PostgreSQL database as the benchmark for iterative performance work. The user has approved the development database for test data. Do not publish to production after every optimization step.

**Why:** The user asked to use development as the benchmark going forward instead of repeatedly deploying to production, and explicitly approved the development database for tests.

**How to apply:** Capture a repeatable development baseline, change one measured bottleneck, and rerun the same workload against the development database. Use production validation only after a meaningful development improvement or when the user explicitly asks.
