---
name: World contract boundaries
description: User-approved ownership for authored, runtime, and shared world contracts.
---

Keep authored world definitions, pack input/parsed types, and graph validation in `world.ts`. Put runtime queries, commands, presence, and projections in `world-runtime.ts`; keep only cross-lifecycle schemas in `world-shared.ts`. `world.ts` re-exports runtime/shared contracts to preserve existing imports.

**Why:** The user chose to keep authoring in `world.ts` rather than move it into a separate content module, preserving the lifecycle split with less file movement.

**How to apply:** Add new authored contracts and their validation to `world.ts`; keep runtime modules independent of `world.ts` to avoid cycles.
