---
name: Engine integration tests
description: Build reliable end-to-end tests for world content through the MUDD engine host.
---

Exercise authored content through the engine's real command and query pipeline, with its declared plugin dependencies and a correctly scoped test session. A host assembled with an incomplete plugin set can fail before reaching the gameplay behavior under test.

For HTTP route tests that mock package modules, prefer partial mocks that retain the real package exports and override only the behavior the test needs. Handwritten placeholder schemas can break discriminated-union construction or become stale when packages add exports, causing failures before the route runs.

**Why:** A content-flow test initially constructed a host without all runtime-required dependencies, then used an incorrect authorization callback shape. Separately, a route-test mock replaced real Zod schemas with placeholders and omitted newer package exports, so the server failed during module initialization rather than exercising the request.

**How to apply:** For world-pack integration tests, mirror the registered runtime's relevant plugin set and use the engine authorization contract to scope the test to that world's instance. For HTTP tests, use `importActual` as the base mock and narrowly override external services or stateful adapters.
