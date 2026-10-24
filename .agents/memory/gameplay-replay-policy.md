---
name: Gameplay replay policy
description: Safety and measurement constraints for optimizing character projection and recovery.
---

Cache character projections only for histories an adapter explicitly guarantees
are immutable. Preserve replay-only deduplication metadata with every checkpoint,
and never infer freshness from a local revision without checking the authoritative
database head.

**Why:** Cached event arrays alone do not prevent repeated schema parsing, and a
projection-only snapshot loses outcome/action deduplication needed for safe tail replay.
Mutable authoring/test histories must retain pure replay semantics.

**How to apply:** Treat process caches as disposable optimizations; rebuild on
eviction/restart, clone returned projections, and measure both warm and cold paths.
Keep local history-policy benchmarks distinct from published HTTP/browser latency:
removing replay cost does not establish that remote database/network delay is fixed.
