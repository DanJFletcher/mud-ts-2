# Design

## Context

See [proposal.md](./proposal.md) for motivation. Snapshot state currently has multiple writers in `WorldClient`: initial loading, realtime and visibility refreshes, command projections, and feature handlers. `ActionRefreshGate` prevents a background request from crossing an action boundary, while `commandResultProjection` decides whether a command response can be applied against the latest known character revision.

## Goals / Non-Goals

**Goals:**
- Put the shared snapshot state and its reconciliation rules behind one hook boundary.
- Keep the refresh gate shared by background reads and foreground actions, including movement's deferred optimistic reconciliation.
- Make stale-result behavior testable without mounting the full world interface.
- Preserve existing command, realtime, presence, and UI behavior.

**Non-Goals:**
- Move command parsing or feature-specific handlers into the hook.
- Move optimistic travel presentation, terminal entries, dialogue, party, inventory, or layout state into the hook.
- Change client SDK contracts, server behavior, or the user's visible interaction flow.

## Decisions

### The hook coordinates session state; `WorldClient` remains the feature orchestrator

Create `useGameSession` in the web client and inject the existing `MuddHttpClient` rather than importing the module-level client into the hook. The hook owns the snapshot state, initial load and its loading/error state, background snapshot refresh lifecycle, and action refresh gate. It exposes the snapshot and a functional snapshot updater for feature handlers that need to apply local projections such as presence or action-specific results.

Keep UI pending labels and action timing in `WorldClient`. The component begins and ends the hook's refresh gate through its existing pending-action wrapper, so UI feedback remains coupled to UI while background ordering has a single owner. Preserve movement's special case: its pending label can outlive the gate while realtime/fallback snapshots reconcile optimistic travel.

### Keep snapshot selection policy in existing shared helpers

The hook uses `commandResultProjection` with the client's latest character revision hint. A usable projection is merged over the command's base snapshot; otherwise the hook fetches the authoritative game snapshot. Background refreshes capture the gate epoch before requesting, validate it before applying, and retain current occupants when the refreshed snapshot still represents the same room.

This reuses existing policy instead of duplicating revision comparisons or gate logic. Moving either helper into the hook would make focused unit testing harder and risk changing established behavior.

### Move session-wide refresh subscriptions together

Move initial loading and the full-snapshot refresh lifecycle (character realtime updates, visibility/pageshow refreshes, and disconnected fallback polling) into the hook. Keep the heartbeat and presence-stale signal with that lifecycle because it updates the same session snapshot and must obey the same action gate. Other realtime domains, such as party and interaction polling, remain in `WorldClient`.

The hook receives the active character context derived from its current snapshot and manages request cleanup when that context changes or the hook unmounts. Retain the current schema parsing and suppression of stale background errors; heartbeat failures continue to drive the presence-stale indicator.

### Keep command-specific side effects at the call site

Expose a command-result reconciliation operation that returns the applied snapshot to the feature handler. Handlers remain responsible for their own narration, quest announcements, dialogue/merchant cleanup, retries, pending-action tracking, and movement reconciliation. This makes the shared state transition explicit without flattening unrelated command behavior into a generic dispatcher.

## Risks / Trade-offs

- [Snapshot writes are spread across many handlers] -> Migrate them to the hook-owned state updater without changing feature-specific sequencing; retain existing App-level tests and add hook tests for stale refresh and projection fallback.
- [Hook lifecycle changes can alter subscription timing or duplicate requests] -> Move the existing effects as a unit, retain their active/request-running guards and cleanup, and test observable refresh ordering.
- [Movement has distinct pending and refresh-gate lifetimes] -> Preserve the explicit deferred-reconciliation path and cover it with existing movement tests.

## Migration Plan

Extract the hook and its focused tests, then migrate `WorldClient` to consume the hook's state and lifecycle methods. Run the web typecheck and targeted hook/App tests, followed by the web test suite if targeted coverage reveals regressions. The change is client-internal and requires no data migration or server rollout; reverting the extraction restores the existing component-owned implementation.
