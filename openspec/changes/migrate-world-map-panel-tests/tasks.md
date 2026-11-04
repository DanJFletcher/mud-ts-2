# Tasks

## 1. Move panel-owned behavior

- [x] 1.1 Extend `WorldMapPanel.test.tsx` to cover collapsing the map, opening full screen while collapsed, closing it, and retaining the collapsed state; verify the public callback, accessible controls, and rendered dialog with the focused suite.
- [x] 1.2 Remove the redundant panel-level test from `WorldClient.test.tsx` and update the test-ownership inventory; retain terminal-swipe, travel-projection, and map-reconciliation cases, then verify both focused suites pass.

## 2. Verify coverage and integration

- [x] 2.1 Run the full web test suite with `--maxWorkers=2`, web typecheck, and lint on changed tests; run web coverage with `--coverage --maxWorkers=2` and confirm the migration does not reduce covered source lines.
