# Proposal

## Why

The repository's existing tests and lint checks do not enforce complexity limits on changed functions or provide a shared PR quality policy. Agents also need durable guidance for leaving touched code cleaner and choosing names according to their lexical context.

## What Changes

- Add type-aware TypeScript correctness checks and selected SonarJS smell and complexity analysis, using versions compatible with the existing ESLint 10 setup.
- Define shared, checked-in thresholds enforced on every PR. New and modified production functions must meet absolute limits immediately; untouched legacy functions retain a migration baseline.
- Prevent suppression-budget increases from concealing new problems, and report actionable failures with measured values and limits.
- Add package-specific coverage floors using measured initial coverage, accommodating both Vitest and the contracts package's Node test runner.
- Extend agent and review guidance with the Scout's Principle, context-sensitive naming, and existing TDD evidence requirements.

## Capabilities

### New Capabilities

- `pr-quality-gates`: Configurable static-analysis and coverage gates, change-aware enforcement, baseline protection, and CI/local reporting.
- `agent-development-discipline`: Test-first work, bounded cleanup of touched code, context-sensitive naming, and truthful review evidence.

### Modified Capabilities

None. The project currently has no durable main specs.

## Impact

- Tooling: `eslint.config.mjs`, dependency manifests and lockfile, existing coverage configs, new quality-policy configuration and comparison tooling, and `.github/workflows/ci.yml`.
- Guidance: `AGENTS.md` and any directly conflicting implementation/review skill guidance; preserve existing OpenSpec delegation instructions.
- Existing `eslint-suppressions.json` remains a migration mechanism, not a waiver for changed functions.
- No game runtime, protocol, persistence, or public API behavior changes are intended. Local refactors are limited to code necessarily touched by implementation.
- Initial proposed defaults are cyclomatic complexity 10, cognitive complexity 10, nesting depth 3, function length 5, and parameter count 4. Coverage floors are measured rather than invented. Thresholds remain configurable through ordinary reviewed repository changes.
- Out of scope: per-PR overrides, hosted SonarQube, mutation testing, dead-code tooling, changed-line coverage, secret scanning, and a repo-wide legacy cleanup.
