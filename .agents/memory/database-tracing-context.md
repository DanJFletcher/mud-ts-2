---
name: Database tracing contexts
description: Preserve operation-level timing attribution for lazy database query thenables.
---

When measuring asynchronous database operations, consume lazy query thenables
inside the async-context scope that owns the operation label. Request-level
query totals can remain correct while nested operation timings silently omit
queries if the thenable starts executing after that scope has exited.

**Why:** Some query builders defer execution until awaited. Returning one
directly from an async-context callback can make query counts visible but lose
the operation label that should own them.

**How to apply:** Wrap the operation callback in an async function that awaits
its result, and test with a lazy thenable to verify both request totals and
per-operation query counts.
