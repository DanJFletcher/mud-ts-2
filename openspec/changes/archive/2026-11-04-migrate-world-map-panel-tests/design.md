# Design

## Context

See [proposal.md](./proposal.md) for motivation. `WorldMapPanel` owns its collapsed state, while full-screen state is controlled through the `fullscreen` prop and `onFullscreenChange` callback. Its focused suite already tests collapsing and expanding the map. `WorldClient.test.tsx` also tests that panel flow, alongside separate behaviors that require the full play-screen composition.

## Goals / Non-Goals

**Goals:**

- Give map collapse and collapsed-to-fullscreen interaction coverage to `WorldMapPanel.test.tsx`.
- Preserve WorldClient coverage for the terminal swipe gesture and travel/map projection wiring.
- Keep the test suite's existing behavioral and accessibility assertions.

**Non-Goals:**

- Changing `WorldMapPanel`, `WorldClient`, or play-screen runtime behavior.
- Reworking the shared WorldClient API fixture or migrating other feature tests.

## Decisions

### 1. Exercise the controlled full-screen contract in the panel suite

Extend the focused `WorldMapPanel` tests to collapse the panel, activate its full-screen control, rerender with `fullscreen={true}`, then close and verify the callback and collapsed state. Use the component's public props rather than introducing a new test wrapper or another shared fixture.

**Alternative considered:** Keep the full flow only in `WorldClient.test.tsx`. Rejected because that keeps component-owned collapse and button behavior in the large composition suite.

### 2. Retain composition tests for parent-owned behavior

Keep the WorldClient test that opens the map from a swipe on terminal output and closes it with a swipe or Escape. Keep the minimap projection and travel-reconciliation tests there as well. Remove only the direct collapse/fullscreen-button test after equivalent focused assertions pass.

**Alternative considered:** Move every map-related WorldClient test to `WorldMapPanel.test.tsx`. Rejected because map projection and terminal gesture wiring cross screen/session boundaries.

## Risks / Trade-offs

- [Moving the test could leave the parent callback unverified] → Retain the terminal-swipe WorldClient regression, which exercises the same full-screen state handler, and assert the panel's button callback directly in its focused suite.
- [Fullscreen closing uses an animation delay] → Wait for the controlled close transition in the panel test instead of relying on synchronous DOM removal.

## Migration Plan

1. Add the collapsed-to-fullscreen interaction to the focused `WorldMapPanel` suite.
2. Remove the redundant panel-level case from `WorldClient.test.tsx`, leaving composition and projection coverage intact.
3. Update the existing test-ownership inventory to record the moved case and revised WorldClient count.
4. Run the focused suites, web test suite, typecheck, lint, and relevant coverage check; verify no user-facing or production-code changes.
