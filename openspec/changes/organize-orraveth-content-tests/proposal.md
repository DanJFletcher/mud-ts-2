# Proposal

## Why

The Phase 3 Orraveth regression suite combines settlement structure, NPC identities, content restrictions, topology, and package metadata in broad scenarios. Organizing these by durable content invariant will make canon regressions easier to locate and maintain without changing the world.

## What Changes

- Reorganize `phase-3.test.ts` into clearly named invariant groups and individual cases.
- Use named rows for genuinely repeated settlement, route, or river-reach checks while retaining explicit unique restrictions.
- Preserve exact canon assertions, negative restrictions, ordering guarantees, map values, pack version, and starting location.
- Keep all edits independent of `refactor-pr-quality-test-readability` and `improve-test-readability-and-maintainability`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This behavior-preserving test refactor declares `skip_specs: true`; no lore, mechanics, or runtime requirements change.

## Impact

Implementation owns only `packages/world-orraveth/src/phase-3.test.ts`, plus this change's planning artifacts. Prefer cohesive groups within that file; additional files are unnecessary for its current size. No content data, production authoring modules, baseline JSON, shared fixtures, other tests, manifests, runner configuration, policy/ledgers, or other change artifacts may be modified.
