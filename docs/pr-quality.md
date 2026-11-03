# Pull request quality

The required check to configure in GitHub branch protection or a ruleset is **PR quality** (workflow **CI**). Workflow YAML supplies the check; a maintainer must mark it required for protected target branches. Push verification remains independent of PR metadata. No privileged `pull_request_target` or write token is needed.

## Reproduce a PR decision

Use Node 22 (22.15 or newer) and an isolated PostgreSQL 16 test database. Install dependencies, migrate the database, and collect coverage:

```sh
npm ci
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mudd_test
export MUDD_TEST_DATABASE_URL="$DATABASE_URL"
export NODE_ENV=test
export TRUSTED_PROXY_HOPS=0
npm run db:migrate
npm run test:coverage
npm run quality:test
npm run quality:pr -- --base origin/main --head HEAD
```

Commit source/config changes first. The comparison requires the specified head to be checked out with a clean tree (ignored build/coverage outputs are fine). Fetch the actual target branch before comparing; maintenance-branch PRs must use their own target, not `origin/main`. The tool resolves both commits and their merge base; absent/shallow history, invalid policy, parser errors, analyzer errors and missing coverage fail with exit 2. Policy failures exit 1; success exits 0. There is no environment, PR-label or command-line threshold override.

JSON and Markdown reports default to `coverage/pr-quality.json` and `coverage/pr-quality.md`. `--output <path.json>` changes the destination. Reports include target/base/head SHAs, policy values/changes, selected functions and locations, measured failures and limits, baseline changes and per-workspace coverage. No applicable function changes is an explicit empty selection, not an analysis failure. Policy, ledger and coverage checks still run. GitHub receives the same Markdown as a job summary and uploads available diagnostics on failure.

## Scope and selection

Analyze TS/TSX and JS/MJS/CJS in applications, packages, executable contracts and the gate's own `scripts/quality` modules, plus the ESLint config. Ignore dependency/build/coverage/Storybook output. `artifacts/` is prototype material, `generated-artifacts/` is generated material, and `engine-contracts/originals/` contains archived design examples, not shipped contract source. The retired one-shot map migration `scripts/extract-world-map-data.ts` is outside this runtime/tooling scope. Existing e2e infrastructure is exercised by its own runner; this gate does not expand its static-analysis scope. Every workspace production `src` module remains included, even when unimported by tests.

TS source uses TypeScript project-service analysis. Tests, stories and out-of-project config files use the explicit lint TS project so excluded test files and Storybook configs still get type information. JavaScript gets syntax/correctness/smell checks without pretending it has a TS program. Selected typed checks are floating promises, misused promises and switch exhaustiveness. Selected SonarJS checks are duplicated branches, identical functions, identical expressions and cognitive complexity. SonarJS 4.2.2 declares ESLint 8/9/10 compatibility; this repository locks ESLint 10.

Tests/specs, stories and files under `tests`/`__tests__` are exempt only from the numeric function limits. Their supported correctness checks remain enabled. Ordinary lint retains existing recommended, hooks and unused-variable checks.

Rename-aware NUL-delimited Git data supplies paths safely, including spaces. Zero-context two-sided ranges select whole parsed function spans: declarations, expressions, arrows, methods, constructors, accessors, async/generators and nested callbacks. Signature and formatting edits count. A nested edit selects every containing function. Deletions map surviving unchanged source lines (and their unchanged tokens) back into enclosing head spans. Whole deleted functions impose no check; pure line shifts do not select siblings. Where surviving spans can correspond to several enclosing functions, all plausible ancestors are selected conservatively. Byte-identical whole-file renames retain legacy status. Rename-plus-edit compares the old path. Function moves/copies are additions at their destination, including moves within a file. Several functions on the same changed line are selected conservatively.

Numeric analysis disables inline configuration and bulk suppression effects. The owning AST span, rather than the changed diagnostic line, determines whether a finding applies. New/modified functions must meet inclusive absolute limits: a reduction from 20 to 12 still fails a maximum of 10. Fixing a neighboring violation cannot transfer its allowance. Subjective naming, cohesion, 100-line class size, relevant cleanup and actual TDD order remain review responsibilities.

## Migration and pruning

`eslint-suppressions.json` supports ordinary whole-repository lint. PR comparison rejects new or increased file/rule counts, accepts decreases, and allows one-to-one byte-identical whole-file rename remapping. A Git-detected import-only rename can also preserve counts when exact source outside relative static import/export specifier contents is unchanged and all relative static dependencies resolve to corresponding tracked base/head modules. Resolution supports explicit tracked assets and `.js` to `.ts`/`.tsx` correspondence; unresolved/ambiguous identities, copied sources, dependency substitutions and other edits fail closed. Numeric selection, diff hunks and occurrence-ledger enforcement remain independent. Counts do not waive changed-function checks.

`quality-sites.json` separately records occurrence identity for migrated typed/smell findings: original source revision/path/location, unchanged source-line anchor and complete owning-function context (or diagnostic source span outside functions). Git correspondence from that immutable revision preserves line shifts across successive PRs. New copies/replacements or changed contexts cannot use an old site, including diagnostics on unchanged declarations. Ambiguous multiple matches fail. Matching is deliberately conservative: editing the containing function can retire an allowance even if the diagnostic line did not change. Keep original coordinates/revision; do not relocate or regenerate sites to silence failures.

The one-time rollout is pinned in `quality-rollout.json` to the pre-tooling base revision and requires the base to lack a policy. Only newly enabled rules can receive initial counts. Previously enabled length/parameter allowances cannot increase. The initial site list consists solely of unchanged pre-existing findings. A subsequent ordinary PR cannot reseed these ledgers. The rollout adds no standing bypass.

After fixing legacy findings and committing source changes, run:

```sh
npm run quality:prune
npm run lint:prune
```

The first command removes obsolete site occurrences without adding allowances; the second prunes unused ESLint counts. Commit/review ledger decreases, then rerun the PR gate. A pure rename may require moving its count ledger key while retaining counts; verify the gate proves byte identity. Site identities stay at their original paths and follow Git rename correspondence.

Threshold and floor changes are ordinary policy changes, visible in the report and code review. Maintainers can intentionally change policy; this tooling does not claim to prevent a reviewed weakening. Never increase a migration budget or weaken tests to make an ordinary change pass.

## Coverage

Server coverage bounds file-worker concurrency to four and gives each instrumented test a 30-second execution budget. CI demonstrated that both large-history replay and room-by-room travel can exceed the normal five-second deadline under V8 coverage, even with four workers. Ordinary verification retains the default five-second deadline. These are behavioral tests, not latency benchmarks: all assertions and coverage floors remain enforced. The adapter regression executes a workload beyond five seconds, verifies the normal run still times out, and verifies incorrect assertions still fail under coverage.

All nine workspaces have independent line, branch, function and statement minima in `quality-policy.json`. Vitest V8 includes the complete `src` production set and emits JSON summary, JSON details and text. Exclusions are declaration-only files, tests/specs/stories and test setup. Contracts retain Node tests: c8 includes all TS runtime sources, uses TypeScript source maps from compiled code, and emits equivalent Istanbul metrics. Runtime sources with no hits are included by both adapters. No aggregate average conceals another package's shortfall; missing or nonnumeric required metrics fail.

[Recorded rollout measurements](quality-coverage-measurement.json) include commands, source revision, Node/runner versions, file counts and exact measured totals. Initial floors round down those observations to whole percentages; they are not invented uniform targets. Reproduce with the configuration delivered in this change. A decrease above a fixed floor passes. To raise floors, rerun coverage with the same inclusion policy, record the measurement and review the policy diff. Changes to exclusions require explicit review. Fixtures prove both runners include an unimported production file and emit all four metrics.

## Review evidence

Check naming at use sites, related cleanup, cohesive abstractions, class size and observed test-first evidence as well as automated results. Small edits to large legacy functions require a behavior-protected local refactor. Remove helpers/imports/comments made obsolete by the work. If no useful cleanup exists, do not manufacture churn. Short bindings in tiny scopes are valid; reassess when their scope or uses grow.
