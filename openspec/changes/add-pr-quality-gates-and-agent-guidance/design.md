# Design

## Context

See proposal.md for motivation and scope. Research found that CI already runs tests, type checking, ESLint, builds, and Storybook builds, but does not enforce coverage floors. ESLint uses untyped recommended TypeScript rules. Numeric suppressions are counts per file/rule, so they cannot identify changed functions or distinguish replaced findings. Coverage scripts exist, but contracts use Node's test runner while the other packages use Vitest.

This change crosses tooling, CI, coverage adapters, and agent guidance, so a design artifact is required. Existing uncommitted policy/lint changes from the earlier task are inputs to preserve and reconcile, not changes to discard.

## Goals / Non-Goals

**Goals:**
- Reproduce PR decisions locally using the same policy and explicit comparison base.
- Enforce immediate compliance for new/modified functions without blanket cleanup of untouched legacy code.
- Report understandable failures while treating missing data and analyzer errors as failures.
- Keep subjective development guidance explicit and separate from automated evidence.

**Non-Goals:**
- See proposal.md for deferred tools and hosted services.
- No semantic proof of naming quality, design cohesion, or test-first execution.
- No matching of arbitrary cross-file function moves to preserve legacy exemptions.

## Decisions

### 1. Repository-owned policy and local command

Introduce `quality-policy.json` with a validated schema and a documented `npm run quality:pr -- --base <revision>` command. Keep one source of numeric values consumed by the analyzer config and PR gate. Initial defaults are 10 cyclomatic complexity, 10 cognitive complexity, 3 nesting depth, 5 nonblank/noncomment function lines (including declaration/braces), and 4 parameters. Equality passes. Coverage contains explicit floors per workspace and metric, populated from reproducible implementation-time measurements rounded down only to the recorded precision. Save the measurement command, revision, runner versions, inclusion/exclusion policy, and results with the rollout documentation.

Use the versioned policy from the checked-out PR revision, making threshold adjustments normal visible code changes. There are no PR-body directives, label overrides, or per-PR threshold inputs. Report policy changes against the base; do not claim to prevent maintainers deliberately weakening the policy in a reviewed change.

Alternative: environment-only values are easy to configure but drift between local and CI execution. Hard-coded values duplicated across scripts are also rejected.

### 2. Type-aware ESLint and selected SonarJS rules

Enable TypeScript project-service analysis for included TS/TSX files, with intentional handling of configs outside a tsconfig and JS files. Start with `no-floating-promises`, `no-misused-promises`, and `switch-exhaustiveness-check`, plus selected SonarJS duplicated-branch, identical-function/expression, and cognitive-complexity rules. Use core `complexity`, `max-depth`, `max-lines-per-function`, and `max-params` for numeric checks. Verify exact selected rule names and type-information requirements against the installed release.

Upstream SonarJS research identifies 4.x as the release family adding ESLint 10 support; verify released peer metadata before choosing and locking a version. Do not follow the archived standalone plugin repository's older compatibility instructions. Any numeric values come from the shared policy. Preserve existing correctness rules, hooks checks, and test/story numeric exemptions.

Tests/specs and stories remain subject to applicable correctness checks. Inventory current TS/JS production files, including scripts needed by this gate, and document deliberate exclusions; do not exclude difficult production code simply to pass.

Alternative: hosted SonarQube provides richer historical reporting and new-code gates, but introduces a service and is unnecessary for the initial repo-local policy.

### 3. Compare full function spans against a real PR base

Resolve `merge-base(baseSHA, headSHA)` with explicit PR target metadata, sufficient fetched history, and an explicit head revision. Use rename-aware, NUL-delimited Git path data and zero-context two-sided diff ranges with external diff/textconv disabled. Do not infer functions from hunk labels.

Parse base and head source with the existing TypeScript ESLint parser. Inventory executable function declarations, expressions, and arrows; include method, constructor, getter/setter, async, generator, and nested callback spans. Select every head function intersecting added/changed source and all containing functions. Signature and formatting edits count. A nested edit qualifies its containing functions because their complete source bodies changed.

Deletion-only changes require old-to-new correspondence: map surviving unchanged tokens from the affected base function into head and locate the surviving enclosing function(s). Fully deleted top-level functions have no surviving check; deletion of a nested function still changes the outer. If correspondence is ambiguous, select plausible surviving functions in the affected region and explain the conservative selection. Never pass by silently dropping unmappable changed code. Parser failures fail explicitly.

Pure line shifts leave siblings untouched. A byte-identical whole-file rename preserves legacy classification. Rename plus edit uses the old path for comparison and checks changed functions. Moves within/between files and copies are treated as additions at their new location; function declaration renames count as modifications. This keeps move handling predictable and avoids semantic identity heuristics.

Run the selected numeric checks without bulk suppressions or inline disables affecting the decision. Associate findings with the owning function by AST span/location, not only changed diagnostic lines; preserve nested attribution rather than letting inner findings falsely become outer findings. Compare complete measurements to inclusive limits. Ordinary lint can continue using its migration suppressions for untouched functions.

### 4. Protect budgets and identify migrated correctness findings

Compare the head suppression ledger to the base revision: reject new keys/count increases for previously enabled rules; allow decreases and one-to-one path remapping for proven byte-identical file renames. During initial rollout only, seed numeric budgets for newly enabled rules and record them as such. The rule's introduction is visible in configuration and rollout documentation, not a standing runtime bypass or PR label.

Counts alone are insufficient for typed/smell findings. Add a versioned site baseline for pre-existing findings, recording rule, source path, source anchor, and occurrence identity. Match only surviving unchanged sites using base/head token correspondence; do not consume an old allowance for a new identical copy or a finding introduced into changed source. Ambiguous matches fail with a request to inspect/prune the baseline rather than silently granting an allowance. New findings fail even if the count stays flat. Analyze unsuppressed results for this comparison, so inline disable comments cannot mint a new baseline allowance.

Document baseline pruning for both ledgers. A decrease never transfers allowance to a new function. Existing broad policy text permitting production numeric inline exceptions must be reconciled: changed functions have no numeric exception in PR gates. Subjective design tradeoffs still belong in review.

### 5. Package coverage adapters, not an aggregate average

Run coverage for each workspace's full production-source set. Configure Vitest's V8 provider and summary reports; use a Node-compatible coverage adapter such as `c8` for contracts to produce equivalent Istanbul metrics, including untouched source files. Add/lock that dependency if necessary and document actual runtime-source exclusions (generated output, tests, stories, declaration-only files).

Use native runner thresholds where available but normalize summaries into the shared gate for reporting and missing-data detection. Require line, branch, function, and statement metrics from every configured package. Missing reports, invalid percentages, or unavailable required metrics fail, rather than exempting a runner. Keep package floors independent so well-covered packages cannot hide another package's regression below its floor.

Coverage floors are not changed-line coverage or a promise that every percentage decrease fails. A decrease above the fixed floor passes; reviewed policy changes can raise floors. No invented universal percentage or target of 100% is imposed.

### 6. CI reporting and reproducibility

Wire a named quality job/check into `.github/workflows/ci.yml` for every PR. Fetch actual base history and check out/analyze a defined PR head; do not accidentally compare a synthetic merge commit to the wrong parent. Reuse existing builds and database setup where coverage requires them. Keep tests, type checking, builds, and Storybook checks intact.

Produce a machine-readable result and a GitHub job summary with comparison SHAs, policy changes, selected function counts, failed metrics/limits, rule/location, baseline changes, and coverage by package. Analysis failures remain distinct from policy failures. Upload available diagnostic artifacts on failure. Keep changed-source gates applicable to PRs; ordinary push CI retains full-repo lint/test behavior without guessing a PR base.

A named status check only blocks merging when required by repository branch protection/rulesets. Document the exact check name and the maintainer-side setting; do not claim workflow YAML alone makes it required. Use ordinary PR CI with no privileged `pull_request_target` execution or write-token requirement.

### 7. Durable agent guidance and review

Update `AGENTS.md` as the primary persistent policy and reconcile directly conflicting local skill guidance without rewriting unrelated skills. Preserve TDD red/green evidence, refactor-first passing coverage, and truthful reporting. State that tiny changes to over-limit functions require the relevant refactor and tests.

The Scout's Principle means improving relevant touched code: clearer names, removal of obsolete material, reduced duplication, focused responsibilities, and pruned allowances. It does not require unrelated churn or invented cleanup.

Name length grows with scope, lifetime, distance from declaration, and competing context. Accept `orders.map(x => x.amount)`; reconsider `x` when the callback grows or scope widens. Prefer descriptive domain names such as `currencySymbol`; retain clear conventional indices/coordinates. Do not enable a blanket `id-length` rule or a five-line naming cutoff. Review scenarios, not a new subjective lint rule, validate this guidance.

## Risks / Trade-offs

- Strict five-line limits can cause substantial local refactoring for small edits. Protect behavior with tests and explain scope; do not silently relax the confirmed modified-function policy.
- Nested edits qualify outer functions and can amplify refactoring scope. Make selection explicit in reports and test this behavior.
- Token correspondence and duplicate source can be ambiguous. Use conservative selection and explicit errors rather than count-only matching or silent exemptions.
- Type-aware analysis and full coverage cost more CI time. Isolate reporting and reuse setup/build outputs; optimize only after measurements without weakening gates.
- Empty or highly declarative packages can produce runner-specific coverage semantics. Record and test the adapter's treatment; never silently invent a missing metric.
- Agents may mechanically split functions to pass numeric limits. Retain review checks for cohesion, useful abstractions, naming, and class size.

## Migration Plan

1. Add fixture-tested policy parsing, change attribution, and failure reporting using TDD.
2. Activate analyzers with locked compatible versions, seed documented initial ledgers, and verify pre-existing allowances cannot hide changed-code violations.
3. Measure all package coverage with production inclusions, commit floors and evidence, and validate runner adapters.
4. Wire PR CI and local usage, reconcile agent/review guidance, and demonstrate a deliberately failing fixture PR analysis followed by compliant fixtures.
5. Document the required-check setting for maintainers. Rollback is a reviewed revert of this tooling change, leaving game behavior unchanged.

## Research References

- [Typed linting](https://typescript-eslint.io/getting-started/typed-linting/) and [parser API](https://typescript-eslint.io/packages/parser/).
- [SonarJS plugin and compatibility changelog](https://github.com/SonarSource/SonarJS/tree/master/packages/analysis/src/jsts/rules).
- [ESLint bulk suppressions](https://eslint.org/docs/latest/use/suppressions), which budget counts rather than function identities.
- [Git diff](https://git-scm.com/docs/git-diff) for machine-readable rename data and two-sided ranges.
- [Vitest coverage configuration](https://vitest.dev/config/coverage).
- [SonarQube quality gates](https://docs.sonarsource.com/sonarqube-cloud/standards/quality-gates), considered as an alternative.
