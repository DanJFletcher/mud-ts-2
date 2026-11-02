# Proposal

## Why

The world client combines command interpretation, asynchronous feature lifecycles, action coordination, and screen composition in one large component. The audit identified concrete risks around late results, orphaned retries, loss of selected target identity, modal shortcuts, and growing history; extracting explicit ownership boundaries makes these behaviors safer and independently testable.

## What Changes

- Scope feature requests and gathering retries to the active world, character, and relevant action/location; reject obsolete results and cancel obsolete scheduling.
- Preserve target IDs from clickable controls through typed action intents, while retaining existing text commands, aliases, and help.
- Suspend world movement shortcuts while dialogs are active.
- Bound retained terminal history and rendered history while preserving scroll position, recent field notes, and optimistic travel reconciliation.
- Extract feature controllers, command parsing/help metadata, and screen compositions from `WorldClient`; retain `useGameSession` as the shared snapshot boundary.
- Separate action execution/refresh-gate lifetime from pending presentation and performance instrumentation.
- Replace locally restated transport shapes with canonical types and explicit presentation adapters.

## Capabilities

### New Capabilities

- `world-feature-lifecycle`: Session-scoped asynchronous feature work, gathering retries, and action coordination.
- `world-command-interaction`: Identity-preserving command dispatch and modal-safe movement shortcuts.
- `world-activity-history`: Bounded, navigable session history with reliable optimistic-entry reconciliation.

### Modified Capabilities

None. The capability inventory is currently empty. The completed, unarchived `extract-game-session-hook` change already defines `game-session-state`; this change builds on its reconciliation guarantees without redeclaring them.

## Impact

- Primarily `apps/web/src/App.tsx`, new feature/controller/screen modules, and focused tests in `apps/web/src`.
- May extend the presentation API and stories of `packages/ui` activity-log and extracted reusable controls; generic UI components remain independent of the SDK.
- Reuses the client SDK, pending-action tracking, refresh gate, and canonical contracts. No server mechanics, persistence migration, routing replatform, or new runtime dependency is planned.
- History becomes explicitly limited to recent session activity; older retained entries remain accessible through a bounded rendering window until evicted under the documented retention policy.
- Planning only: audit risks require regression reproduction during implementation, not claims that all failure paths have already been observed at runtime.
