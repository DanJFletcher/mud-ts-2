---
name: Cross-package error identity
description: Keep error classification reliable when workspace packages may load separate source and compiled module instances.
---

Use a stable structural code or brand marker when an error must be recognized across workspace package boundaries. Do not rely only on `instanceof` for types exported from a package that consumers may resolve from both source and compiled output.

**Why:** test and server import paths can load separate module copies, so equivalent exported error classes may not share constructor identity.

**How to apply:** For errors crossing package boundaries, check an explicit stable discriminator and validate its known value; keep `instanceof` for errors confined to one module instance.
