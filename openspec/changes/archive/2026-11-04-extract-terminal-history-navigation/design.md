# Design

## Context

See `proposal.md` for motivation. `WorldClient` remains mounted while its active screen changes, but `PlayScreen` is conditionally rendered only while the play screen is active. The current scroll position and reading anchor therefore need to survive outside `PlayScreen`; moving the hook into that component would reset the state whenever the player opens another screen.

`ActivityHistory` owns retained activity data and announcement sequencing. `ActivityHistoryWindow` owns the bounded rendering window. Neither should become responsible for terminal DOM measurement or scrolling.

## Goals / Non-Goals

**Goals:**
- Give terminal scroll tracking, anchor preservation, and follow-latest behavior one explicit owner.
- Preserve navigation state across play-screen unmount/remount.
- Narrow the props that carry DOM refs and scroll-state setters into `PlayScreen`.
- Keep activity retention, row-window selection, announcements, and interaction targets owned by their existing modules.

**Non-Goals:**
- Change the threshold or policy for deciding whether the player is reading the latest activity.
- Move quick-action projection, room-event reconciliation, or feature command dispatch.
- Change history retention, announcement semantics, visible controls, or the `ActivityHistoryWindow` API.

## Decisions

### Keep the hook at the persistent composition lifetime

Add `useTerminalHistoryNavigation` under `apps/web/src/world/screens/`. Invoke it unconditionally from `WorldClient`, passing the current entries and whether the play screen is active. It owns the history element ref, follow-latest state, reading anchor and offset, scroll availability, scroll handler, window-change handler, scroll-to-latest action, and layout effect.

The hook returns a focused navigation model to `PlayScreen`. `WorldClient` keeps the hook mounted while changing screens, so the reading anchor survives the conditional unmount of `PlayScreen`. While inactive, the hook preserves the reading state and reports that the terminal cannot scroll down; when the play screen becomes active again, its layout effect reattaches to the new element and restores the current reading position.

**Alternative considered:** Calling the hook inside `PlayScreen` would reduce parent wiring further, but would lose the reading anchor whenever `PlayScreen` unmounts. Keeping all logic inline in `WorldClient` preserves state but leaves screen-specific DOM behavior in the composition.

### Keep history data and navigation mechanics separate

Pass `entries`, target data, and target-action callbacks independently from the navigation model. The hook must not mutate `ActivityHistory` or interpret gameplay entities. The hook handles only the terminal viewport and its reading position.

**Alternative considered:** Expanding `ActivityHistory` to own DOM navigation would couple the session data store to one presentation surface and make it harder to share history with Field notes.

### Preserve current scroll policies exactly

Retain the existing 32-pixel latest threshold, first-visible-row anchor selection, row-ID-plus-offset restoration, scroll-to-latest behavior, and animation-frame correction. Keep the existing `screen` active/inactive behavior. These values and policies are compatibility constraints, not tuning targets for this refactor.

## Risks / Trade-offs

- [The refactor changes which module owns layout effects and DOM refs] → Add focused hook tests and retain the existing WorldClient integration regression for live activity while scrolled away from the latest entry.
- [Screen switching could reset or misapply the anchor] → Keep the hook instance in `WorldClient` and test leaving and returning to the play screen while reading older entries.
- [Changing the event handler could alter anchor measurement timing] → Preserve the current first-visible-row and offset calculation and verify append, window navigation, and return-to-latest behavior through integration tests.

## Migration Plan

No data or deployment migration is required. Add and test the hook, wire it into `WorldClient` and `PlayScreen`, remove the old duplicated scroll state and handlers, then run the focused tests, web test suite, and web typecheck. Rollback is a code revert; the activity store and persisted data remain unchanged.
