---
name: World runtime capabilities
description: Runtime setup rules for optional world services and shared event effects.
---

World packs may omit optional services such as currency, so server routes must not assume every character has a wallet. Shared effects emitted by generic plugins need handlers in every runtime and must read content from the active world context rather than a demo-world constant.

**Why:** Orraveth initially omitted currency, and its world runtime initially lacked a handler for a shared location-entry effect. Both assumptions prevented a clean world session.

**How to apply:** When registering a world, check optional pack capabilities against server initialization paths, and verify that every shared effect producer has a handler in every runtime that uses it.

Validate world-scoped browser transport against a non-default world, with test fixtures that enforce the selected world rather than accepting every request.

**Why:** NPC movement and announcement-producer tests passed while Orraveth's browser polling silently targeted the default world. Testing producers and consumers separately missed the routing boundary.

**How to apply:** Include explicit non-default-world routing assertions for polling and submissions. Treat both world and room as the identity when resetting cursors or discarding stale responses.
