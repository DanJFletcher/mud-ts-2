# Proposal

## Why

`WorldClient` combines UI with snapshot loading, realtime refresh ordering, and command-result reconciliation. Extracting those shared session responsibilities gives stale-state behavior a focused, testable boundary while keeping feature-specific gameplay and presentation behavior stable.

## What Changes

- Add a `useGameSession` hook to coordinate the game snapshot, initial load, background refreshes, action refresh gating, and command-result projection or authoritative snapshot fallback.
- Keep command parsing, feature handlers, optimistic travel presentation, narration, dialogue, and other UI state in `WorldClient`.
- Add focused coverage for snapshot reconciliation and refresh ordering; preserve existing behavior and public APIs.

## Capabilities

### New Capabilities

- `game-session-state`: Client behavior for keeping the displayed game snapshot consistent across initial loads, realtime/background refreshes, and command results.

### Modified Capabilities

None.

## Impact

- Affects `apps/web/src/App.tsx` and new hook-focused tests in `apps/web/src`.
- Reuses the existing client SDK, `ActionRefreshGate`, and command projection behavior; no server or public API changes are intended.
