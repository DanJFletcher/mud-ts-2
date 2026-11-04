# WorldClient test ownership inventory

## Baseline

- `npm run test --workspace @mudd/web -- --maxWorkers=2`: 29 files passed, 541 tests passed.
- `apps/web/src/world/WorldClient.test.tsx`: 244 test cases in one top-level suite.
- All 244 cases render `WorldClient` and exercise it through the shared API fake. They are therefore composition-level tests by execution boundary, even where the behavior topic belongs to a single feature.

## Existing focused boundaries

Focused suites already cover pure helpers, controller behavior, and standalone screen behavior:

- Commands: intents, metadata, and read dispatch.
- Feature logic: gathering scheduler/run/controllers, activity history, action selectors, keyboard shortcuts, room controllers, and social state.
- Screens: dialog focus, NPC farewell, terminal, room chat, world map, and terminal history navigation.
- Session: action refresh gate, command projections, foreground execution, and game-session lifecycle.

These suites are candidates for owning feature-local invariants. Their presence does not replace the WorldClient tests that verify the corresponding behavior is wired into the live session and UI.

## Assertions that must remain at composition level

- Session replacement, stale responses, projection-versus-snapshot reconciliation, optimistic travel and rollback.
- Command identity and retry behavior as it crosses UI selection, SDK request, and server response.
- Cross-feature cases such as gathering while room events arrive, or travel announcing a combat encounter.
- History-window behavior shared between terminal output and Field notes.
- Navigation, modal, responsive-screen, and realtime behavior that depends on WorldClient wiring.

## Migration rule

Move only assertions that can be exercised through a focused public feature or screen interface without losing a composition guarantee. Retain a composition regression for each cross-feature behavior. The 244-case count is the exhaustive inventory: every case currently belongs to the WorldClient composition boundary; further classification is by behavior owner during migration, not by pretending these are already unit tests.

## Current migration

- The typed scenario harness is validated independently, including a real `WorldClient` render and isolated endpoint override, deferred-response, and failure cases.
- Keyboard filtering and navigation menu/theme behavior now have focused feature/screen tests; duplicate full-client cases were removed.
- Fishing and woodcutting single-flight cases are covered at the shared scheduler boundary, so their duplicated full-client polling tests were removed. Other gathering UI and event-recovery composition tests remain.
- The remaining 239 `WorldClient` cases still use the legacy shared API fake. They were retained because they exercise session/UI/SDK wiring; replacing that fake is deliberately incremental and requires each scenario to have an explicit narrower owner or remain as composition coverage.
