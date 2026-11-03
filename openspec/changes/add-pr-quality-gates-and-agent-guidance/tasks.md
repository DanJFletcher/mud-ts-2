# Tasks

Implementation uses the repository's red/green/refactor discipline. Observe each behavior test fail before implementing its behavior, and preserve existing passing coverage for refactors. All tasks below are pending; planning does not complete implementation tasks.

## 1. Shared policy and analyzer integration

- [ ] 1.1 Add a validated shared quality policy with initial 10/10/3 complexity/depth limits and existing 5-line/4-parameter limits; verify boundary equality, malformed/missing values, and documented test/story exemptions with red/green configuration fixtures.
- [ ] 1.2 Install and lock an ESLint-10-compatible SonarJS release and configure TypeScript project-service analysis plus selected correctness/smell rules from design.md; verify peer compatibility and real typed/smell failure fixtures, including out-of-project config and JS handling.
- [ ] 1.3 Route analyzer numeric values through the policy and document source inclusions/exclusions; verify ordinary lint retains existing checks and numeric exemptions without silently excluding production modules or the gate's own source.

## 2. Function-aware PR comparison

- [ ] 2.1 Implement explicit base/head resolution and rename-aware machine-readable diff loading; verify maintenance-branch bases, missing history, invalid revisions, filenames with spaces, and analyzer/Git errors fail or resolve as specified.
- [ ] 2.2 Implement parsed function-span inventory and added/modified selection; verify declarations, arrows, expressions, methods, constructors, accessors, async/generators, parameter/return-type edits, formatting edits, multiple functions on one line, and nested ancestor selection with red/green fixtures.
- [ ] 2.3 Implement deletion-only correspondence and untouched-function handling; verify deleted statements, removed nested functions, fully deleted functions, shifted siblings, duplicate/anonymous functions, CRLF, ambiguous correspondence, pure renames, rename-plus-edit, moves, and copies match the specified selection policy.
- [ ] 2.4 Enforce unsuppressed absolute metrics on selected functions and report owning functions accurately; verify an unchanged declaration location, inline disable, same-count replacement, and 20-to-12 improvement all fail at a limit of 10 while untouched neighbors remain allowed.
- [ ] 2.5 Document selection semantics and the explicit-base local invocation; verify the documented command on representative passing/failing temporary Git fixtures without mutating the working repository's history.

## 3. Migration ledgers and new findings

- [ ] 3.1 Protect suppression counts against base-relative increases and support pruning and proven byte-identical rename remapping; verify increases fail, decreases pass, and allowance removal cannot transfer a budget to changed functions.
- [ ] 3.2 Add occurrence-aware site baselines for existing typed/smell findings and unchanged-site matching; verify new findings, identical copies, same-count replacements, inline disables, and ambiguous matches cannot consume a legacy allowance.
- [ ] 3.3 Seed and document the one-time baseline for newly activated rules without increasing allowances for already-enabled rules; verify the rollout passes for untouched legacy sites and a later ordinary PR cannot reseed its way to success.
- [ ] 3.4 Document baseline maintenance and policy-change reporting; verify both ledger-pruning commands and fixture reports make changes/decreases visible without creating a standing per-PR override.

## 4. Coverage floors

- [ ] 4.1 Configure complete production-source coverage and comparable summaries for Vitest workspaces and the contracts Node runner, adding a compatible adapter if needed; verify an unimported production source is included and each runner emits all four required metrics.
- [ ] 4.2 Record reproducible package coverage measurements, commands, revision, versions, and exclusions; populate all workspace floors from those measurements and verify the measurement run meets the recorded floors.
- [ ] 4.3 Enforce per-package line/branch/function/statement minima from the shared policy; verify exact-floor passes, below-floor failures, invalid/missing reports, missing metrics, and a well-covered package failing to conceal another package's shortfall.
- [ ] 4.4 Document coverage reproduction, deliberate exclusions, and floor-adjustment procedure; verify documented commands produce the summaries consumed by the local gate.

## 5. CI and reporting

- [ ] 5.1 Add the local PR quality command with machine-readable and human-readable reports; verify exit codes and output for policy errors, analysis errors, no applicable changes, threshold failures, baseline changes, and passing results.
- [ ] 5.2 Wire a named PR quality check into CI with actual base/head metadata and sufficient history, preserving existing verification and required database/build setup; verify workflow behavior for a non-default PR base and ordinary push events without assuming a PR context.
- [ ] 5.3 Add job summaries and failure artifacts with SHAs, scope, function/rule locations, measured values, limits, coverage, and policy/baseline changes; verify generated summaries/artifacts using integration fixtures and document the check name to require in branch protection/rulesets.

## 6. Agent and review guidance

- [ ] 6.1 Update persistent instructions with strict modified-function compliance and bounded Scout's Principle cleanup, preserving TDD and OpenSpec delegation rules; verify the small-edit/large-legacy-function, obsolete-helper, and no-useful-cleanup review scenarios against the delivered guidance.
- [ ] 6.2 Add context-sensitive naming guidance and examples, including `orders.map(x => x.amount)`, growing callbacks, wider scopes, descriptive domain values, and conventional short names; verify no blanket identifier-length rule or fixed line-distance cutoff is introduced.
- [ ] 6.3 Reconcile directly conflicting implementation/review guidance and prior numeric-exception wording; verify skill-driven and delegated work inherit the discipline and final reports distinguish automated results from subjective review and actual TDD evidence.

## 7. Integrated acceptance

- [ ] 7.1 Run a fixture-backed end-to-end PR comparison proving strict changed-function compliance, untouched allowances, budget protection, coverage failures, and failure summaries together; record observed failing then passing cases.
- [ ] 7.2 Run relevant tooling tests, repository lint, type checking, tests, builds, and Storybook checks; record outcomes and any genuine execution blockers without weakening policy or treating gaps as completed verification.
- [ ] 7.3 Run strict OpenSpec validation and review requirement-to-test/documentation coverage for both capabilities; verify all acceptance scenarios have evidence and all implementation artifacts are ready for review.

## Workflow follow-up

- Maintainers configure the documented CI check as required in repository branch protection/rulesets before relying on it to block merges.
- Review the completed implementation and archive this change through the archive workflow when appropriate.
