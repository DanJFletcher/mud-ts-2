# WorldClient test ownership inventory

## Baseline

- `npm run test --workspace @mudd/web -- --maxWorkers=2`: 29 files passed, 541 tests passed.
- `apps/web/src/world/WorldClient.test.tsx`: 274 expanded test cases in one top-level suite, as measured by the baseline run for the current test-readability change.
- All 274 cases render `WorldClient` and exercise its composition boundary. Most still use the shared API fake; the class adoption/ability scenarios now use fresh typed harness instances.

## Existing focused boundaries

Focused suites already cover pure helpers, controller behavior, and standalone screen behavior:

- Commands: intents, metadata, and read dispatch.
- Feature logic: gathering scheduler/run/controllers, activity history, action selectors, keyboard shortcuts, room controllers, and social state.
- Screens: dialog focus, NPC farewell, terminal, room chat, world map, terminal history navigation, and class presentation in StatsScreen.
- Session: action refresh gate, command projections, foreground execution, and game-session lifecycle.

These suites are candidates for owning feature-local invariants. Their presence does not replace the WorldClient tests that verify the corresponding behavior is wired into the live session and UI.

## Assertions that must remain at composition level

- Session replacement, stale responses, projection-versus-snapshot reconciliation, optimistic travel and rollback.
- Command identity and retry behavior as it crosses UI selection, SDK request, and server response.
- Cross-feature cases such as gathering while room events arrive, or travel announcing a combat encounter.
- History-window behavior shared between terminal output and Field notes.
- Navigation, modal, responsive-screen, and realtime behavior that depends on WorldClient wiring.

## Migration rule

Move only assertions that can be exercised through a focused public feature or screen interface without losing a composition guarantee. Retain a composition regression for each cross-feature behavior. The 274 expanded-case count is the exhaustive WorldClient inventory; further classification is by behavior owner during migration, not by pretending these are already unit tests.

## Current migration

- The typed scenario harness is validated independently, including a real `WorldClient` render and isolated endpoint override, deferred-response, and failure cases.
- `StatsScreen.test.tsx` owns class-presentation states; WorldClient retains adoption command/snapshot wiring, transport failures, and solo/team ability routing after PvP.
- Keyboard filtering and navigation menu/theme behavior now have focused feature/screen tests; duplicate full-client cases were removed.
- Fishing and woodcutting single-flight cases are covered at the shared scheduler boundary, so their duplicated full-client polling tests were removed. Other gathering UI and event-recovery composition tests remain.
- The six expanded class adoption/ability scenarios now use fresh typed harness instances instead of the global fetch fixture. The former 235 shared-fake count predates later test additions and is no longer a reliable current count; continue recording owners as each group migrates.
- Map collapse and collapsed-to-fullscreen control behavior is owned by `WorldMapPanel.test.tsx`; terminal-swipe opening and map projection/travel reconciliation remain WorldClient composition coverage.

## Terminal panel migration

- Terminal swipe open/close and Escape dismissal are owned by the focused `TerminalPanel` suite, including focus restoration to the launcher.
- The `WorldClient` responsive-layout case remains because it verifies the mobile terminal sits above bottom navigation.

## Validation

- `npm run test --workspace @mudd/web -- --maxWorkers=2`: 32 files passed, 547 tests passed.
- `npm run typecheck --workspace @mudd/web`: passed.
- The current targeted ESLint invocation could not load the repository configuration because `quality-policy.json` is absent; no lint success is claimed for this change.
- `npm run lint` completes but fails on 170 errors and 405 warnings in unchanged files elsewhere in the repository; the full scan reports no findings in the changed test files.
