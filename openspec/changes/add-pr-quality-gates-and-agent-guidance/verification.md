# Implementation verification

## Acceptance coverage

- Shared configuration and inclusive metric boundaries: `scripts/quality/policy.test.mjs`, `analyzer.test.mjs`, `enforcement.test.mjs`.
- Typed promise/switch correctness, SonarJS smell behavior, JavaScript, Storybook exemption and out-of-project configs: `analyzer.test.mjs`; installed SonarJS 4.2.2 peer metadata explicitly includes ESLint 10.
- Real Git histories, explicit maintenance-branch merge bases, missing revisions, safe spaced paths, identical renames and edited renames/copies: `comparison.test.mjs`.
- AST declarations/arrows/expressions/methods/constructors/accessors, async/generators, signatures/return types/formatting, nested ancestors, deletion-only changes, removed functions, shifted siblings, duplicate anonymous functions, same-line conservative selection, moves, CRLF, TS/TSX and array holes: `comparison.test.mjs`.
- Unchanged diagnostic declarations, suppressed changed functions, untouched neighbors, balanced replacement counts, 20-to-12 cognitive improvement, all five reported numeric metrics, absent diff data: `enforcement.test.mjs`.
- Increased/decreased/renamed budgets, exact unchanged source occurrences, copies/replacements, owner-context edits, pruning-only maintenance and visible ledger removals: `enforcement.test.mjs`, `pruning.test.mjs`, `gate.test.mjs`.
- Every package/metric, floor equality, below-floor and invalid/missing reports, package independence, actual unimported source inclusion in both Node/c8 and Vitest: `enforcement.test.mjs`, `coverage-adapters.test.mjs`, `gate.test.mjs`.
- Actual local command exit codes and reports, passing/failing/compliant temporary PR comparisons, missing history, dirty checkout, malformed policy, ordinary-PR reseeding rejection, inline-disable rejection and successive-PR occurrence stability: `gate.test.mjs`.
- Job summaries/artifacts and actionable details: `report.test.mjs`; actual PR metadata/full history, PR-only quality job, preserved push verification/database/build setup and artifact wiring: `workflow.test.mjs`.

## Observed test-first evidence

Behavior tests were observed failing before their implementations for policy validation/numeric configuration, typed/smell analyzer activation, Git comparison/function inventory/deletion selection, unsuppressed function enforcement, budget/site matching, coverage enforcement, local gate decisions, coverage-adapter configuration, pruning and CI wiring. The tests subsequently passed after implementation.

Additional focused red/green regressions covered unchanged-declaration owner-context allowances, successive-PR line shifts, valid TypeScript angle assertions, sparse-array AST traversal, missing diff hunks, missing ledger-decrease reporting and the installed analyzer's nesting message format. Failures in test fixture setup (an initially wrong function inventory count and an unignored dependency symlink) were corrected and are not claimed as behavior-first evidence.

Process exception: the Markdown/JSON report-format tests were written after the report renderer. They verify output but are not evidence of test-first implementation. Later acceptance variations extend earlier behavior coverage; passing them alone does not establish a red phase. Documentation-only guidance edits required no invented behavior tests.

## Guidance review

The delivered `AGENTS.md` keeps TDD and OpenSpec delegation, applies discipline to skills/delegation, and replaces numeric-inline-exception wording with strict changed-function compliance. A small edit in a large function requires behavior-protected local refactoring. Obsolete helpers/imports/comments must be removed when exposed by the work; already-clean code needs no manufactured cleanup.

Naming examples allow `orders.map(x => x.amount)`, reconsider `order` as callbacks grow, require reassessment when bindings move outward, prefer `currencySymbol` for domain values, and retain clear conventional coordinates/indices. No identifier-length lint or line-distance cutoff was added. Existing implementation/review skills were searched for direct conflicts; no additional conflicting local numeric/TDD instructions required changes. No production classes or runtime domain responsibilities were added. New gate functions receive no migration counts or inline exceptions.

## Repository checks

Supported runtime: Node 22.23.4. Initial checks using the machine's default Node 23 were superseded by supported-runtime checks.

- Repository build passed, including contracts, all libraries, server and PWA.
- Type checking passed for every workspace.
- Storybook production build passed.
- Lint passed with zero errors and 405 existing warnings after seeding 25 unchanged typed/smell sites and pruning unused counts. Previously enabled length/parameter budgets were not increased.
- Initial coverage without database configuration stopped at server imports. PostgreSQL 16 was then started in a disposable local container, migrated and used for real integration tests. A server coverage run passed all 459 tests; web passed all 532 tests. Contracts and all six library/UI coverage runs passed.
- A concurrent combined coverage run hit the pre-existing five-second timeout in the large-history PostgreSQL replay test. A further isolated run and a fresh memory-backed database did not remove that timeout. Bounding server coverage concurrency to four workers did: the canonical full coverage command then passed across all nine workspaces, with all 459 server and 532 web tests. No assertions, coverage floors or test timeouts were weakened.

Final fixture counts, full-run result and strict OpenSpec validation are recorded below after execution. Temporary fixture repositories and raw logs are outside the checkout; the full measured coverage data and reproducible commands are in `docs/quality-coverage-measurement.json`.

Final acceptance: all 33 tooling tests passed. The canonical full coverage command passed for all nine workspaces and all 36 floors. Both real pruning commands passed; the site ledger retained its 25 unchanged sites and added none. Final lint passed with zero errors and 405 existing warnings. Strict OpenSpec validation passed. A base-relative programmatic comparison confirmed no increases for previously enabled length/parameter budgets. The real committed-head PR comparison is run after the implementation commit.

The real committed-head command passed against origin/main: base 4ff85e146780e37359566527058ed38a40deb666, head 0637669872531796d4311659534ea0c897719005, 135 selected functions, zero failures, all coverage floors met. All 25 implementation tasks are complete; archive is intentionally left for the later archive workflow.

## CI follow-up

GitHub run 41660734147 passed both ordinary verification jobs but timed out two server tests under coverage: large-history replay/eviction and Bellwold road travel. Missing server/web summaries were downstream symptoms because the coverage command stopped at server. Four workers alone did not provide enough time on GitHub runners. A new real Vitest fixture reproduced the five-second deadline failure before implementation. Server coverage now has a dedicated 30-second instrumentation budget; ordinary test deadlines, assertions, source inclusions and all coverage floors remain unchanged. The fixture also checks that an ordinary run still times out at five seconds and an incorrect assertion still fails under coverage.
