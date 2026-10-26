---
name: Engine integration tests
description: Build reliable end-to-end tests for world content through the MUDD engine host.
---

Exercise authored content through the engine's real command and query pipeline, with its declared plugin dependencies and a correctly scoped test session. A host assembled with an incomplete plugin set can fail before reaching the gameplay behavior under test.

For HTTP route tests that mock package modules, prefer partial mocks that retain the real package exports and override only the behavior the test needs. Handwritten placeholder schemas can break discriminated-union construction or become stale when packages add exports, causing failures before the route runs.

**Why:** Content-flow tests can fail before reaching gameplay when the host lacks runtime dependencies or uses the wrong authorization callback shape. Route-test mocks can likewise fail during module initialization if they replace real schemas with stale placeholders. Unrelated travel can exhaust character resources before a focused command test reaches its target.

**How to apply:** For world-pack integration tests, mirror the registered runtime's relevant plugin set and use the engine authorization contract to scope the test to that world's instance. For HTTP tests, use `importActual` as the base mock and narrowly override external services or stateful adapters. For a location-specific command test, start the fixture near its target; only traverse a route when movement is part of what the test verifies, and account for resource costs.
