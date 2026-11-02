# Design

## Context

See [proposal.md](./proposal.md) for motivation. The audited [world client](../../../apps/web/src/App.tsx) is 5,712 lines and its [integration test file](../../../apps/web/src/App.test.tsx) is 8,445 lines. It already uses shared UI controls and an extracted [session hook](../../../apps/web/src/use-game-session.ts), so incremental feature extraction is practical.

The completed, unarchived [session extraction design](../extract-game-session-hook/design.md) deliberately leaves feature handlers and presentation outside that hook. Preserve that boundary and its projection/refresh guarantees. This change adds feature lifecycle and interaction guarantees rather than replacing `game-session-state`.

Observed source patterns include unmanaged retry timeouts, error-text matching, inconsistent post-await context checks, ID-to-label-to-command round trips, a document movement listener without a modal guard, and unbounded history. These are static audit findings; the implementation must first establish focused regressions. Existing App tests already cover movement conflicts, uncertain command IDs, response projections, gathering retries, scroll behavior, and daily contexts.

## Goals / Non-Goals

**Goals:** Independently test feature lifecycles; make selection identity explicit; preserve command and reconciliation semantics; make `WorldClient` a composition boundary; retain shared UI ownership and accessible mobile behavior.

**Non-Goals:** Replacing the SDK or router, changing server gameplay rules, building a general event bus/state framework, persistent cross-session history, or treating a line-count target as proof of good architecture.

## Decisions

### 1. Extract by ownership and keep snapshot authority centralized

Introduce app-local controllers under `apps/web/src/features` for travel, gathering, dialogue, merchant/crafting, daily activities, party/combat, and activity history. Each owns its related state, subscriptions, timers, and callbacks. Screen compositions receive narrow view models and actions. `WorldClient` composes these with `useGameSession`; no controller imports another controller's internal state.

Retain existing `TerminalPanel`, `RoomChatPanel`, `WorldMapPanel`, and `@mudd/ui` controls. Reusable new controls belong in `packages/ui` with stories before screen integration; app-specific layouts remain in the app. Extract play and information screens incrementally. Moving the entire component into a single large hook was rejected because it preserves the same ownership problem.

### 2. Scope asynchronous work explicitly

Create an immutable world/session client boundary instead of mutating a module-level client's world after render. A session generation changes on world/character replacement and unmount. Each feature request captures generation, relevant location/action identity, and a request sequence when latest-read-wins ordering applies. Check these after every await before state writes, narration, or scheduling. Disposal invalidates the generation even when transport cancellation is unavailable.

Background snapshot writes also obey the existing refresh epoch. Reuse the daily-board context-checking pattern but keep its request state inside its feature. Party/team direct refreshes and polling use the same acceptance path. Review dialogue, merchant, inspection, and NPC refresh writes while extracting them. Do not require new SDK cancellation APIs: logical cancellation is sufficient to prevent obsolete effects; already accepted server commands cannot be undone by client cancellation.

### 3. Give gathering one scheduler per action

Fishing and woodcutting controllers use a small shared scheduling utility with injected clock/timer functions, one tracked wake-up, an in-flight guard, and owner generation. It schedules from authoritative start time/tick count/interval and disposes on cancellation, completion, replacement, or unmount. Retry completions cannot rearm a disposed scheduler.

Use `MuddCommandError.code` for supported codes such as `VERSION_CONFLICT`. Where the server does not distinguish a too-early tick with a code, fetch authoritative action timing and reschedule from that state instead of matching prose. Unknown failures permit a guarded refresh; failure to refresh pauses advancement until a valid update. Use a minimum retry delay to prevent immediate loops when client and server clocks differ. Do not add server error codes in this change.

### 4. Separate execution coordination from presentation

Replace the side-effectful `setPending` wrapper with explicit begin/finish operations returning an owner token. Acquiring a foreground action is synchronous so rapid submissions cannot race React rendering. Only the owning token releases its gate. Keep pending label/uncertain action presentation and timing instrumentation separate.

Movement is the key exception to preserve: after its request settles, release the refresh gate so authoritative updates can confirm the destination, while retaining the presentation/control lock until reconciliation. Keep command IDs, acknowledgement, uncertainty, rollback, and quest narration behavior. Timed gathering updates must coordinate with foreground mutations or be rejected as obsolete; avoid a second independent snapshot-writer policy.

### 5. Dispatch typed intents and colocate command metadata

Extract pure command parsing and target resolution into app-local command modules. Commands resolve to discriminated intents carrying stable IDs; feature controllers execute them. Clickable controls construct the same intents directly and never serialize labels to reparse. Check current availability at dispatch; stale selections fail without substitution.

Resolution prefers exact stable ID, then unique exact label, then unique partial label. Multiple exact labels are ambiguous. Maintain verb, alias, syntax, and help metadata together; keep detailed feature-specific parsers explicit rather than inventing a configurable grammar framework. General help and topic help derive from the metadata. This remains a client adapter: it does not calculate authoritative rule outcomes.

### 6. Scope movement shortcuts to eligible gameplay interaction

Move keyboard handling into a dedicated gameplay hook. Suspend it when any modal is active, when the event originated in a dialog/editable control, or when existing gameplay restrictions apply. Continue respecting prevented events and modifier behavior. Native modal inertness alone does not stop document listeners from observing bubbled keys. Test actual dialog focus as well as restored gameplay focus.

### 7. Bound history with explicit window navigation

Use one session history owner for append, replace, rollback, and eviction. Proposed implementation defaults are 1,000 settled entries retained and at most 200 activity rows rendered per view. Keep these named constants configurable in tests; specs require finite documented bounds rather than those exact tuning values. Pending travel entries are pinned outside the settled budget only until reconciliation, with their count bounded by the single active travel operation.

Use a navigable fixed-size window with keyboard-accessible older/newer/latest controls rather than introducing a virtualization dependency. Preserve stable entry IDs and reading anchors. If retention evicts the anchor, move to the oldest retained entry and show a concise notice. Field notes uses the same store in reverse order without independently retaining a second history. Separate announcements for newly received activity from historical row rendering so window navigation does not replay the live region. UI stories cover long content, narrow layout, focus, and both themes.

### 8. Use canonical data types and explicit adapters

Replace `ClassAwareCharacter` and inline daily-job shape assertions with indexed/exported SDK or contract types. If presentation requires a different shape, define a pure typed adapter; do not widen transport data by assertion. Consolidate repeated inventory/action eligibility selectors and ensure memo dependencies include every input. Keep server-projected values authoritative and preserve existing SDK vital projection behavior.

## Risks / Trade-offs

- [Extraction changes callback/subscription timing] -> Move one controller at a time, keeping App integration coverage and adding deferred-response tests at the new boundary.
- [History retention changes access to old activity] -> Clearly label recent-session retention and make all retained windows accessible; no persistence promise.
- [Cancelling local work cannot cancel accepted server commands] -> Reject obsolete local results and refresh authoritative state on re-entry; never claim server rollback.
- [Text ambiguity behavior becomes stricter] -> Explain ambiguity without sending a command; direct selected controls retain identity and exact IDs remain usable.
- [Shared scheduler overgeneralization] -> Share lifecycle mechanics only; retain feature-specific event interpretation and narration.
- [Completed session change has not been archived] -> Preserve its artifacts; coordinate normal spec synchronization later without archiving or modifying that change here.

## Migration Plan

1. Add focused regressions for lifecycle disposal, selected IDs, and modal shortcuts; keep existing integration coverage as the baseline.
2. Introduce session ownership/action coordination and migrate gathering and feature refreshes incrementally.
3. Introduce intent dispatch and compatible command metadata; migrate clickable and textual callers together per action.
4. Add bounded history and shared UI stories, then extract remaining screens/controllers and typed adapters.
5. Run targeted tests at each stage, then web/UI suites, relevant typechecks, lint, and the UI Storybook build. Manually verify modal keys, history navigation, mobile layout, and live announcements.

No data migration or backend deployment is needed. Each stage should be independently revertible with its tests; preserve the existing session hook and SDK contracts on rollback.
