---
name: World runtime capabilities
description: Runtime setup rules for optional world services and shared event effects.
---

World packs may omit optional services such as currency, so server routes must not assume every character has a wallet. Shared effects emitted by generic plugins need handlers in every runtime and must read content from the active world context rather than a demo-world constant.

**Why:** Orraveth has no configured currency, and its world runtime initially lacked a handler for a shared location-entry effect. Both assumptions prevented a clean world session.

**How to apply:** When registering a world, check optional pack capabilities against server initialization paths, and verify that every shared effect producer has a handler in every runtime that uses it.
