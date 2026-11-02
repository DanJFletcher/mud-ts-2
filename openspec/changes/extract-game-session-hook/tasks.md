# Tasks

## 1. Extract the session state boundary

- [x] 1.1 Add `useGameSession` with injected client, hook-owned snapshot/loading/connection state, and initial game loading; add focused tests for successful load, loading completion, and surfaced load errors, verified with `npm run test --workspace @mudd/web -- src/use-game-session.test.tsx`.
- [x] 1.2 Move full-snapshot realtime, visibility/pageshow, disconnected fallback refresh, and heartbeat lifecycle behind the hook using the shared action refresh gate; test that refreshes crossing an action are rejected and same-room refreshes retain current occupants, verified with `npm run test --workspace @mudd/web -- src/use-game-session.test.tsx`.

## 2. Route command reconciliation through the session

- [x] 2.1 Expose command-result reconciliation and action-gate controls from the hook, then migrate command-result and pending-action coordination in `WorldClient`; test projection acceptance, stale-projection fallback, and background refresh rejection with `npm run test --workspace @mudd/web -- src/use-game-session.test.tsx src/action-refresh-gate.test.ts src/command-projection.test.ts`.
- [x] 2.2 Keep feature-specific narration, optimistic travel, retry, dialogue, and UI effects in `WorldClient` while migrating snapshot writes to the hook-owned state updater; verify existing world-session and movement behavior with `npm run test --workspace @mudd/web -- src/App.test.tsx`.

## 3. Verify integration

- [x] 3.1 Run the web typecheck and complete web test suite to verify the extracted session boundary preserves current behavior: `npm run typecheck --workspace @mudd/web` and `npm run test --workspace @mudd/web`.
