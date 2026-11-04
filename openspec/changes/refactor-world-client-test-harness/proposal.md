# Proposal

## Why

`WorldClient.test.tsx` has grown into a 9,000-line suite with 244 cases, dozens of shared mutable fixture values, and one large fake API implementation. As feature behavior has moved into focused controllers, keeping most scenarios in this shared full-client harness makes failures harder to isolate and test setup increasingly fragile. This change improves test boundaries without changing player-facing behavior.

## What Changes

- Keep a small set of `WorldClient` composition tests for behavior that crosses feature boundaries.
- Move feature-owned behavior tests to focused suites alongside their controllers and screen modules.
- Replace the shared all-features API fake with typed, scenario-scoped fixtures and reusable test helpers.
- Preserve existing behavioral coverage while reducing cross-test state and assertions coupled to raw transport calls.

## Capabilities

### New Capabilities

None. This is a test-infrastructure refactor and does not introduce runtime behavior.

### Modified Capabilities

None.

This change opts out of capability specs because it does not change system behavior.

## Impact

- Primarily `apps/web/src/world/WorldClient.test.tsx` and focused tests under `apps/web/src/world`.
- May add app-local test fixture helpers and adjust web test configuration if needed.
- No production code, API, database, or runtime dependency changes are intended.
