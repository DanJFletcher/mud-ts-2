# Verification — 2026-11-02

Implementation resumed at 22/31 completed tasks. This session extracted the play
and information views, navigation/theme ownership, and combat execution, then
validated the integrated implementation. Manual tasks remain open; the change
is not ready to archive.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run test --workspace @mudd/web` | Passed: 518 tests, 27 files |
| `npm run test --workspace @mudd/ui` | Passed: 50 tests, 3 files |
| Focused keyboard integration tests | Passed: 8 tests |
| Server E2E auth-mode tests | Passed: 3 tests |
| `npm run typecheck` | Passed across all workspaces |
| `npm run test:e2e` | Passed: 3 Chromium scenarios against production preview and isolated PostgreSQL |
| Normal production web build with E2E auth disabled | Passed; E2E Clerk stub markers absent |
| `npm run typecheck --workspace @mudd/web` | Passed |
| `npm run typecheck --workspace @mudd/ui` | Passed |
| `npm run lint` | Passed with 0 errors and 405 pre-existing warnings outside the edited modules |
| `npm run storybook:build` | Passed; bundle-size warning |
| `npm run build --workspace @mudd/web` | Passed, including PWA service-worker generation; bundle-size warning |
| `openspec validate refactor-world-client --strict` | Passed |
| `git diff --check` | Passed |

The full web suite ran after the final combat-controller extraction. Subsequent
code edits only added the two class-adoption setter dependencies and converted
type-only controller imports; web typechecking and repository lint were repeated.
A targeted class/adoption rerun then passed all 6 selected integration tests.

## Requirement-to-test review

All paths below refer to tests exercised by the passing suites. Automated
coverage does not replace the explicitly required manual checks.

| Requirement / scenario group | Evidence |
| --- | --- |
| Feature results belong to their originating context: character/session replacement, room-specific results, superseded reads | [session tests](../../../apps/web/src/use-game-session.test.tsx), [room controller tests](../../../apps/web/src/features/room-controllers.test.tsx), [social tests](../../../apps/web/src/features/social/use-social-controller.test.tsx) |
| Gathering disposal, in-flight cancellation, coincident triggers, wording-independent recovery, failed recovery, leave/re-entry | [scheduler tests](../../../apps/web/src/features/gathering/action-scheduler.test.ts), [run tests](../../../apps/web/src/features/gathering/gathering-run.test.ts), [controller tests](../../../apps/web/src/features/gathering/controllers.test.tsx) |
| Distinct execution/feedback lifetimes, owner-only release, rapid duplicate submission, uncertain travel command IDs | [execution tests](../../../apps/web/src/features/session/foreground-execution.test.ts), [App integration tests](../../../apps/web/src/App.test.tsx) |
| Selected identity, stale selections, same-named replacements, exact ID precedence, duplicate labels, aliases, help and container syntax | [intent tests](../../../apps/web/src/commands/intents.test.ts), [metadata tests](../../../apps/web/src/commands/metadata.test.ts), [App integration tests](../../../apps/web/src/App.test.tsx) |
| Dialog arrows/Shift-arrows, post-dismissal movement, editable input and gameplay eligibility | [shortcut tests](../../../apps/web/src/features/keyboard/use-movement-shortcuts.test.tsx), [App integration tests](../../../apps/web/src/App.test.tsx); native gameplay focus check still outstanding |
| Finite retention, stable IDs/order, optimistic pins/settlement/rollback, session isolation | [history tests](../../../apps/web/src/features/history/activity-history.test.ts), [App integration tests](../../../apps/web/src/App.test.tsx) |
| Bounded window, older/newer/latest keyboard navigation, retained and evicted anchors, reverse notes, non-live history | [window tests](../../../packages/ui/src/components/ActivityHistoryWindow.test.tsx), [App integration tests](../../../apps/web/src/App.test.tsx); screen-reader check still outstanding |
| Existing game-session-state guarantees: action-crossing refresh rejection, same-room occupants, command projection acceptance and stale-projection fallback | [session tests](../../../apps/web/src/use-game-session.test.tsx), [projection tests](../../../apps/web/src/command-projection.test.ts), [refresh-gate tests](../../../apps/web/src/action-refresh-gate.test.ts), [App integration tests](../../../apps/web/src/App.test.tsx) |

## Browser checks actually performed

- Playwright exercised the production preview and real guest/game APIs against
  a fresh disposable PostgreSQL container bound to localhost. The desktop
  journey covered guest entry, reading an item, NPC dialogue, focus restoration,
  keyboard movement after dialog dismissal, and leaving/re-entering through
  Menu → Characters. A second guest journey obtained a rod from an NPC, traveled
  to the river, started fishing, and cancelled the cast.
- At 390×844, the mobile history journey verified 200 mounted rows, no
  horizontal overflow, stable historical activity while a new entry arrived,
  and no live-region change while navigating older history. Keyboard focus
  restoration and movement eligibility were also checked by browser and
  integration tests. These are automated DOM/browser assertions, not manual
  native keyboard or assistive-technology checks.
- Served the built Storybook on local port 6006. In the narrow history story
  at a 390×844 viewport, focused Older and activated it with Enter. The range
  moved from 801–1000 to 601–800, focus remained on Older, exactly 200 activity
  rows were mounted, the history region had `aria-live="off"`, and the page
  had no horizontal overflow. Keyboard activation of Latest returned to
  801–1000 with 200 rows. This verifies the built component in a browser,
  not the authenticated gameplay integration or actual screen-reader output.
- Native computer-use initialization failed before an app could be selected:
  its runtime could not read the system OpenSSL configuration. VoiceOver was
  not available through that testing surface.

## Remaining checks — no exceptions accepted

- **5.2:** Manually verify native gameplay focus restoration and movement after
  dialogue, interaction, and crafting dialog dismissal. Automated regressions
  and the production-preview focus/movement journey pass; manual native browser
  inspection remains outstanding.
- **6.4:** Verify actual screen-reader announcements for appended activity versus
  history navigation/replacement. The implementation, automated tests, and
  [history documentation](../../../packages/ui/docs/design-system/activity-history.md)
  are present; actual assistive-technology output has not been checked.
- **8.3:** The production-preview journeys now cover world entry, movement,
  dialogue, item selection, fishing cancellation, exit/re-entry, and bounded
  long-session history. Manual scroll-position inspection and actual
  screen-reader checks remain outstanding; the E2E DOM assertions do not replace
  them.

The temporary local preview servers were stopped after testing.
