---
name: PostgreSQL command idempotency
description: Snapshot visibility when serializing command receipts with transaction advisory locks.
---

Keep the command-receipt lookup in a separate SQL statement issued after acquiring the transaction advisory lock. A single statement that acquires the lock in a CTE and joins the receipt can keep the statement snapshot from before it waited for a concurrent transaction, then miss the receipt that transaction committed.

**Why:** A concurrent duplicate command exposed this PostgreSQL snapshot behavior; separating lock acquisition from receipt lookup preserved the original successful receipt and event set.

**How to apply:** Preserve lock-then-read ordering, or use a different primitive only after proving its snapshot semantics with concurrent tests against PostgreSQL.
