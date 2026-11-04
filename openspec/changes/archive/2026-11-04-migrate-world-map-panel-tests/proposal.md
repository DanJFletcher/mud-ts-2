# Proposal

## Why

`WorldClient.test.tsx` still contains a panel-level map interaction test inside its shared, 236-case composition suite. The focused `WorldMapPanel.test.tsx` already owns collapse and expand behavior, so moving the remaining collapsed-to-fullscreen assertions there will make test ownership clearer while preserving the WorldClient checks that exercise terminal gestures and map projection.

## What Changes

- Cover collapsing the map, opening it full screen while collapsed, and restoring the collapsed state in the focused `WorldMapPanel` suite.
- Remove the duplicate panel-level assertions from the WorldClient suite.
- Retain WorldClient regressions for terminal swipe integration and travel/map projection behavior.
- Update the existing WorldClient test-ownership inventory to reflect the moved case.
- Preserve the current user-visible behavior and coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a test-only ownership refactor; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `apps/web/src/world/WorldClient.test.tsx`
- `apps/web/src/world/screens/panels/WorldMapPanel.test.tsx`
- `openspec/changes/refactor-world-client-test-harness/test-ownership-inventory.md`
- No production code, API, dependency, or runtime changes.
