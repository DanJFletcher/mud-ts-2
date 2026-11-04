# Tasks

## 1. Establish comparison regression baseline

- [ ] 1.1 Run `node --test scripts/quality/comparison.test.mjs scripts/quality/enforcement.test.mjs` before editing and record actual results and prerequisites; verify implementation edits are limited to the two owned test files.
- [ ] 1.2 Record each comparison assertion and its planned named destination in this change's implementation notes or report; verify coverage of revision errors, merge bases, renames/copies, parser forms, nested selection, line shifts, edits, deletions, moves, CRLF, duplicates, and array holes.

## 2. Clarify comparison scenarios

- [ ] 2.1 Separate independent Git comparison scenarios with fresh cleanup-aware repositories, expand compressed setup, and retain necessary history sequences; verify `node --test scripts/quality/comparison.test.mjs` passes after each group and shared repository helpers remain unchanged.
- [ ] 2.2 Separate selection/parser cases and clarify embedded source fixtures while preserving bytes and hunk coordinates; verify focused tests and review original-to-new fixture equality, selected names, and every mapped assertion before removing old cases.

## 3. Clarify enforcement scenarios

- [ ] 3.1 Record enforcement assertion destinations and separate independent budget, occurrence, and coverage rules into named cases or named rows; verify `node --test scripts/quality/enforcement.test.mjs` passes and all rejection/allowance outcomes remain represented.
- [ ] 3.2 Expand remaining numeric, fail-closed, and diagnostic scenarios without changing source measurements or limits; verify the focused suite after each group and review exact measured values, package identities, errors, cleanup, and fixture bytes against the original assertions.

## 4. Verify integration and ownership

- [ ] 4.1 Run `npm run quality:test`, `npm run lint`, and `npm run typecheck`, plus applicable explicit-base PR quality verification from `docs/pr-quality.md` with its prerequisites; record results and any skipped checks without changing budgets or configuration.
- [ ] 4.2 Review names, cohesion, applicable numeric limits and class sizes, assertion equivalence, and the final diff; verify no shared helpers, policies, ledgers, production modules, Orraveth files, or other changes' artifacts were edited, and report actual green baselines, any new-behavior red/green evidence, exceptions, and remaining debt.
