# Tasks

## 1. Establish session and action ownership

- [x] 1.1 Replace the mutable module-level world client with an injected session-owned client and generation boundary; add world-switch, character-switch, and unmount/remount tests proving old callbacks cannot affect the new session, and run the focused tests plus `npm run typecheck --workspace @mudd/web`.
- [x] 1.2 Introduce token-owned foreground execution coordination separate from pending presentation/timing; test same-turn duplicate submission and owner-only release with the refresh-gate and session-hook tests.
- [x] 1.3 Migrate travel orchestration into a feature controller while preserving pending command IDs, optimistic rollback, and confirmation refreshes; verify the existing movement/uncertain-action App tests and add a deferred-confirmation regression.
- [x] 1.4 Document controller ownership and execution-versus-presentation lifetimes beside the new modules; verify documentation describes the actual exported interfaces and movement exception.

## 2. Make gathering lifecycle-safe

- [x] 2.1 Add a tracked scheduler with injected timing, owner invalidation, and in-flight exclusion; use fake timers and deferred promises to verify disposal, coincident triggers, and late completion cannot rearm it.
- [x] 2.2 Extract fishing state and callbacks into its controller using authoritative timing and structured error information; verify cancellation, leave/re-entry, changed error wording, failed recovery, and existing fishing behavior with focused tests.
- [x] 2.3 Extract woodcutting using the same scheduler mechanics while retaining its own event/narration adapter; verify conflict recovery, cancellation during an advance, tree depletion, and session replacement with focused tests.
- [x] 2.4 Coordinate gathering result application with foreground action epochs; test a delayed gathering result across travel and document when recovery pauses until a valid update.

## 3. Guard feature requests and extract controllers

- [x] 3.1 Extract party and team/PvP refresh controllers with generation, ordering, and refresh-epoch checks shared by direct refreshes and subscriptions; verify deferred responses after cleanup and reversed response order cannot overwrite current state or append narration.
- [x] 3.2 Extract dialogue and merchant/crafting controllers; verify delayed room-specific responses do not reopen stale dialogs/catalogs and retain existing reply, purchase, and crafting tests.
- [x] 3.3 Extract daily-activity and inventory/inspection controllers, retaining the existing daily context safeguards and guarding NPC room refreshes; verify stale room results, daily reset, inventory changes, and existing daily/inspection integration cases.
- [x] 3.4 Document each feature's session/location/action ownership and disposal behavior alongside its module; review that no controller reaches into another controller's internal state.

## 4. Preserve identity through command dispatch

- [x] 4.1 Extract typed action intents, pure parsing, and target resolution; test exact-ID precedence, unique/ambiguous labels, partial matches, and multiword/container syntax using table-driven parser tests.
- [x] 4.2 Colocate command aliases, usage, and help metadata and derive help output; verify every existing verb/alias and help topic remains accepted with parser/help tests and existing App command tests.
- [x] 4.3 Migrate terminal links and quick-action target selections to direct ID-bearing intents, dispatching through the same feature actions as text; test duplicate item/NPC labels, stale selections, and same-named replacements by asserting SDK target IDs.
- [x] 4.4 Document intent and parser boundaries; verify no selected-target path serializes display labels for re-resolution and that command examples match generated help.

## 5. Isolate gameplay keyboard behavior

- [x] 5.1 Extract movement-shortcut handling with explicit modal/editable-context suppression; add regressions for arrow and Shift-arrow keys on dialogue, interaction, and crafting dialog buttons, verifying no movement is sent.
- [ ] 5.2 Preserve post-dismissal, combat, resting, pending, and editable-input behavior; run focused keyboard integration tests and manually verify focus restoration and normal movement after closing dialogs.

## 6. Bound and present activity history

- [x] 6.1 Add session-owned append/replace/rollback/eviction operations with named retention limits; test overflow, stable IDs/order, session reset, pinned optimistic entries, and reapplying limits after reconciliation.
- [x] 6.2 Build bounded history-window presentation and older/newer/latest controls in the existing UI library before screen integration; add stories and interaction tests for long history, narrow layout, themes, keyboard navigation, and bounded mounted row counts.
- [x] 6.3 Integrate the shared history owner into terminal and Field notes; verify older-entry anchoring, evicted-anchor notice, return-to-latest, reverse-order notes, and optimistic travel rollback through App tests.
- [ ] 6.4 Separate new-activity announcements from historical rendering; test window changes do not replay live announcements, manually check a screen reader, and document retention defaults and user-facing history behavior in the design-system docs.

## 7. Finish composition and typed presentation boundaries

- [x] 7.1 Replace local class/daily-job transport assertions with canonical types and pure view-model adapters; verify web typechecking and focused class/daily rendering tests without widening transport types through assertions.
- [x] 7.2 Consolidate repeated inventory/action selectors and correct memo dependencies; verify selector tests for equipment, duplicate labels, gathering level changes, and disappearing targets, then check hook dependency lint warnings in changed modules.
- [x] 7.3 Extract the play screen and combat/merchant compositions using existing shared controls; retain App tests for solo/team/PvP controls, dialogue, map/chat fullscreen, and responsive navigation.
- [x] 7.4 Extract information screens, navigation/theme behavior, and field-note composition; verify existing route/hash, class adoption, equipment, menu, and theme tests. Add stories first for any reusable controls introduced by the extraction.
- [x] 7.5 Document the final module map and ownership rules; inspect `WorldClient` to verify it composes narrow feature APIs and contains no command grammar, gathering scheduling, or feature polling loops.

## 8. Validate integrated behavior

- [x] 8.1 Run `npm run test --workspace @mudd/web` and `npm run test --workspace @mudd/ui`; confirm existing reconciliation/uncertainty tests and all new lifecycle, identity, keyboard, and history regressions pass.
- [x] 8.2 Run `npm run typecheck --workspace @mudd/web`, `npm run typecheck --workspace @mudd/ui`, `npm run lint`, and `npm run storybook:build`; resolve introduced failures and report any pre-existing failures separately.
- [ ] 8.3 Exercise enter-world, movement, NPC dialogue, item selection, gathering cancellation, world exit/re-entry, and long-session history in a production web build/preview; record keyboard, mobile viewport, scroll, and screen-reader results separately from automated tests.
- [x] 8.4 Run `openspec validate refactor-world-client --strict` and review requirement-to-test coverage for all three capability specs; confirm implementation preserves the existing `game-session-state` guarantees.
