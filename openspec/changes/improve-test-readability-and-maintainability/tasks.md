# Tasks

## 1. Preserve baseline and regression intent

- [x] 1.1 Run the seven affected suites before editing (WorldClient, SDK combat, quest contracts, PostgreSQL event-store unit tests, jobs metrics integration, character-state, and engine); record exact commands, prerequisites, results, and any blockers without claiming an unavailable baseline.
- [x] 1.2 Record an assertion-to-destination checklist for the selected scenarios in each group; verify it accounts for unique health/consumption, validation, atomicity, lifecycle, and composition guarantees. Reconcile the web group with the existing ownership inventory and current feature boundaries.

## 2. Adopt isolated web class scenarios

- [x] 2.1 Replace positional `classApiFixture` booleans with named typed scenario options and migrate the class-selection/ability group to fresh instances using existing web test support; verify fixture isolation and affected cases, using a focused red/green cycle for any new fixture behavior.
- [x] 2.2 Move only feature-owned class assertions to appropriate focused suites, retain cross-feature composition checks, and remove obsolete fixture state after its final consumer migrates; update the existing ownership inventory and verify all mapped assertions with focused suites and the full web suite.

## 3. Clarify SDK combat preparation

- [x] 3.1 Extract repeated healing-draught preparation into focused SDK-local helpers using public client operations and correct revisions; verify existing potion cases pass before and after, with combat triggers and outcome assertions remaining visible.
- [x] 3.2 Preserve a representative travel/purchase/combat journey and each scenario's distinct failure, health, and consumption guarantees; verify the assertion checklist against the full SDK suite and document retained journey ownership alongside the affected tests where clarification is needed.

## 4. Separate quest validation scenarios

- [x] 4.1 Split independent quest and quest-graph validation assertions into named cases or descriptive table rows with fresh valid defaults; verify each original invalid input and expected failure remains represented and the runner reports distinct rule names.
- [x] 4.2 Run the full contracts suite and compare the assertion checklist; verify sequential lifecycle coverage remains intact and remove only setup made obsolete by the split.

## 5. Decouple PostgreSQL fake controls from call order

- [x] 5.1 Replace select/insert index routing in `createAppendTransaction` with operation- or table-aware responses and named failure stages; verify active-session and durable-write failure scenarios before and after, using red/green tests for any new reusable fake behavior.
- [x] 5.2 Preserve SQL, persisted-value, and transaction guarantees while removing obsolete counters; verify the event-store unit suite and relevant real PostgreSQL atomicity integration tests, recording database blockers separately from fake results.

## 6. Type character plugin setup

- [ ] 6.1 Type captured registration handlers and valid event builders using public contracts; verify character-state scenarios before and after and typecheck without permissive bypass casts at these boundaries. Keep deliberately malformed validation inputs explicit.
- [ ] 6.2 Run the full plugins suite and review the mapped lifecycle assertions; verify no production interface was added solely for testing and remove obsolete harness types or helpers.

## 7. Make scheduling and cleanup explicit

- [ ] 7.1 Replace jobs metrics start polling with an explicit started signal and retain a release gate with guaranteed cleanup; verify the original concurrency/metrics guarantees and failure-safe release using the focused integration suite with bounded timeouts.
- [ ] 7.2 Make engine test presence instance-local through an existing seam or reset it unconditionally in teardown; verify the engine suite before and after and review that failed assertions cannot skip cleanup.

## 8. Verify integration and review quality

- [ ] 8.1 Run all affected workspace suites, repository `npm run lint` and `npm run typecheck`; collect coverage and run the explicit-base PR quality checks described in `docs/pr-quality.md` when their clean-head prerequisites are satisfied, recording any skipped checks and reasons.
- [ ] 8.2 Review assertion equivalence, scenario readability at call sites, cohesion, class sizes, numeric compliance of non-exempt support modules, and unchanged migration budgets; verify the final report distinguishes actual red/green observations from green refactor baselines and subjective review, and identifies remaining local debt.
