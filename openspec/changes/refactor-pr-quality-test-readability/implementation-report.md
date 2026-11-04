# Implementation report

## Baseline

- The first focused run could not load `@typescript-eslint/parser` or `eslint` because workspace dependencies were absent.
- After `npm install`, `node --test scripts/quality/comparison.test.mjs scripts/quality/enforcement.test.mjs` passed: 19 tests, 0 failures.
- The expected missing-revision assertion prints Git's `fatal: Needed a single revision` diagnostic; the test passed by asserting the comparison throws.
- The worktree was clean before implementation. Implementation changes are limited to `comparison.test.mjs` and `enforcement.test.mjs`; this report and `tasks.md` are the only change-artifact edits.

## Comparison assertion map

| Existing assertion(s) | Planned named destination |
|---|---|
| Explicit base and head values | `explicit revisions report their base and head` |
| Old path, new path with spaces, and unchanged status for a byte-identical rename | `byte-identical renames preserve paths with spaces` |
| Missing revision throws | `missing revisions fail explicitly` |
| A maintenance-branch comparison uses the common base | `maintenance comparisons use the merge base` |
| Inventory count for generator, async arrow, function expression, constructor, getter, setter, method, and nested arrow forms | `inventory includes executable TypeScript and JavaScript function forms` |
| Insertion selection count includes all inventoried functions | `insertions select every executable function form` |
| Invalid source throws | `invalid source fails inventory` |
| Body edit selects `outer` and its nested anonymous function | `body edits select the containing function and its nested function` |
| Inserted heading selects no shifted function | `inserted headings do not select shifted functions` |
| Signature edit selects `outer` | `signature edits select the changed function` |
| Removing a nested function body line selects only `outer` | `nested deletions select the surviving outer function` |
| Deleting a top-level function selects no remaining function | `deleted top-level functions do not select surviving siblings` |
| CRLF nested deletion selects one function | `CRLF deletions preserve selection` |
| Generic angle assertion in `.ts` inventories one function | `TypeScript angle assertions use the TypeScript parser` |
| JSX in `.tsx` inventories one function | `JSX uses the TSX parser` |
| Return-type edit selects `typed` | `return-type edits select the typed function` |
| Indentation edit selects `typed` | `formatting edits select the containing function` |
| Same-line arrow edit conservatively selects `a` and `b` | `same-line function edits retain conservative selection` |
| Move hunks retain one mapped `typed` function | `move hunks map the typed function once` |
| Duplicate anonymous bodies select only `first` | `duplicate anonymous functions map to the changed occurrence` |
| Rename-plus-edit reports `original.ts` and changed status | `rename-plus-edit retains the old source path` |
| A copied destination is treated as an addition and selects one function | `copies at a destination count as additions` |
| Array hole inventories without failure | `array holes in valid production code do not break function inventory` |

The comparison suite passed after the Git scenario split (12 tests) and after the
selection/parser split (23 tests). Review of the diff confirmed that embedded
source bytes and hunk coordinates are unchanged; assertions now expose the
selected function names where the original test asserted them.

## Enforcement assertion map

| Existing assertion(s) | Planned named destination |
|---|---|
| A budget increase produces one failure | `budget increases fail` |
| A budget decrease produces no failures | `budget decreases are allowed` |
| An unchanged rename preserves a budget allowance | `unchanged renames preserve budget allowances` |
| An edited rename does not preserve a budget allowance | `edited renames do not preserve budget allowances` |
| An import-only rename retains a suppression allowance when its dependency identity is stable | `import-only renames retain allowances when dependencies keep identity` |
| An unchanged one-to-one site occurrence is allowed | `unchanged occurrences retain site allowances` |
| A copied site occurrence cannot use the original allowance | `copied occurrences cannot inherit site allowances` |
| An edited site occurrence is not allowed | `edited occurrences lose site allowances` |
| All package metrics exactly at inclusive floors pass | `inclusive coverage floors allow exact matches` |
| A below-floor metric fails and identifies package `a` | `coverage failures identify the package below its floor` |
| Missing report, missing total, and `Unknown` percentage each fail closed | `missing package coverage reports fail closed`; `missing coverage totals fail closed`; `invalid coverage percentages fail closed` |
| An unchanged diagnostic line cannot keep its allowance after the owning function changes | `changed functions invalidate unchanged diagnostic-line allowances` |
| Missing diff hunks reject a changed production file | `unavailable diff hunks cannot exempt changed production files` |
| Site-ledger decreases are reported as removals without failure | `site-ledger decreases are reported without failing` |
| Complexity measurement, function-wide findings, and exclusion of untouched functions | `numeric findings cover the selected function, not just changed lines` |
| Actual nesting measurement, parameter measurement, and cognitive measurement despite improvement | `nesting`, `parameter`, and `cognitive` measurement cases |
| Same-count replacement cannot transfer an allowance; exact function name, rule, and measurement | `same-count replacements cannot transfer numeric allowances` |
| Duplicate legacy occurrences fail and show inspect/prune guidance | `ambiguous duplicate occurrences fail with inspect/prune guidance` |

After separating the budget, occurrence, and coverage cases, the focused
enforcement suite passed: 20 tests, 0 failures.

The expanded numeric, fail-closed, and diagnostic cases passed the focused
suite: 22 tests, 0 failures. Review against the original assertions confirmed
that measured values and limits remain complexity 12/10, depth 4/3, parameters
5 against 4, cognitive complexity 12/10 after 20-to-12 improvement, and
10 function lines against the policy limit of 5. Coverage package identities
remain `a` and `b`, with floors of 80/70/60/80 for lines/branches/functions/
statements. The `/hunk/i` and `/ambiguous.*prune/i` diagnostics, temporary
directory cleanup, source fixture bytes, and hunk coordinates are unchanged.

## Integration verification

- `npm run quality:test`: passed, 89 tests and 0 failures.
- `npm run lint`: failed on repository-wide existing findings (170 errors and
  405 warnings); neither owned test file appears in the lint output.
- `npm run typecheck`: passed after `npm run build` produced the required
  workspace declarations. The first typecheck attempt failed because those
  build outputs were absent.
- `npm run build`: passed; Vite reported its existing large-chunk advisory.
- Explicit-base `npm run quality:pr -- --base origin/main --head HEAD` was not
  run: `docs/pr-quality.md` requires committed changes and a clean source tree,
  while these requested changes remain uncommitted. No budgets or configuration
  were changed.

## Final review

- The named scenarios preserve the original measurements, expected function
  names, package identities, rejection outcomes, allowance outcomes, and
  source fixtures; no behavior was added, so no new-behavior red/green cycle
  applies. The passing pre-edit baseline protected the refactor.
- No production functions or classes were changed or introduced. The two
  edited files are test files and are exempt from the numeric function/class
  gates.
- The only implementation files changed are the owned comparison and
  enforcement test files. The only other changes are this report and the
  task checklist. Shared helpers, policies, ledgers, production modules,
  Orraveth files, and other changes' artifacts remain untouched.
- The branch `agents/refactor-pr-quality-test-readability` was clean and at
  the same commit as fetched `origin/main` before implementation; no rebase
  was needed.
