# Baseline Suite Results

Captured on 2026-11-04 before any code or test refactoring in this change.

## Prerequisites and Limits

- Workspace dependencies were already installed.
- The contracts test command builds `@mudd/contracts` before running its tests.
- No manual database setup, service provisioning, or environment changes were needed for these runs.
- These are single-run pass baselines, not evidence that a suite is flake-free or that coverage is 100%.

## Results

| Area | Command | Result |
| --- | --- | --- |
| WorldClient | `npm run test --workspace @mudd/web -- src/world/WorldClient.test.tsx --maxWorkers=2` | Passed: 274 tests |
| SDK combat | `npm run test --workspace @mudd/client-sdk -- src/combat.test.ts --maxWorkers=2` | Passed: 25 tests |
| Quest contracts | `npm run test --workspace @mudd/contracts` | Build passed; 100 tests passed |
| PostgreSQL event-store unit | `npm run test --workspace @mudd/server -- src/persistence/postgres-event-store.unit.test.ts --maxWorkers=2` | Passed: 52 tests |
| Jobs metrics integration | `npm run test --workspace @mudd/server -- src/app/__tests__/jobs-metrics.integration.test.ts --maxWorkers=2` | Passed: 6 tests |
| Character state | `npm run test --workspace @mudd/core-plugins -- src/character-state.test.ts --maxWorkers=2` | Passed: 36 tests |
| Engine | `npm run test --workspace @mudd/engine-core -- src/engine.test.ts --maxWorkers=2` | Passed: 54 tests |

No blockers were encountered. No coverage or PR-quality baseline was collected in this task.
