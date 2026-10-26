---
name: Performance benchmarking
description: Default to development traces for iterative performance optimization rather than repeatedly publishing to production.
---

Use development traces and isolated local PostgreSQL tests as the benchmark for iterative performance work. Do not publish to production after every optimization step.

**Why:** The user asked to use development as the benchmark going forward instead of repeatedly deploying to production.

**How to apply:** Capture a repeatable development baseline, change one measured bottleneck, and rerun the same workload. Use production validation only after a meaningful development improvement or when the user explicitly asks.
