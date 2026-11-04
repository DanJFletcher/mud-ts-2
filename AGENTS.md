# Agent Instructions

## Development discipline

These requirements apply to all code-writing work, including work performed through skills and delegated agents. Carry them into delegated task instructions. Planning-only OpenSpec work does not require implementation or tests.

### Test-driven development

For new behavior and bug fixes, use small red/green/refactor cycles:

1. Write one focused test of observable behavior. For a bug fix, reproduce the bug.
2. Run the test before changing production code. Observe a failure caused by the missing or incorrect behavior; syntax, import, and environment failures do not count.
3. Write the minimum production code needed to pass, then run the test and observe it pass.
4. Refactor with tests green, then run the relevant checks. Repeat for the next behavior.

For behavior-preserving refactors, establish passing coverage before editing. Test public behavior rather than private implementation details. Do not weaken assertions, delete tests, or over-mock collaborators merely to make a change pass.

After an implementation is green, consider whether a small cleanup would reduce a concrete maintenance cost. Use `.agents/skills/typescript-refactor/SKILL.md` for evidence-based TypeScript review or behavior-preserving edits. Keep review mode read-only, and do not delegate routine cleanup by default. A bounded refactor may be delegated when an independent review or isolated edit adds value; the parent must provide the tested baseline, scope, and invariants, then inspect the integrated diff and rerun relevant checks.

Documentation-only and formatting-only changes do not require behavior tests. If a meaningful test cannot run, report the blocker and the resulting verification gap; do not claim TDD. Existing green tests or tests written after implementation are not evidence of a red/green cycle.

The final report must briefly identify the test observed failing and why, the checks that passed afterward, and any skipped checks or process exceptions. Report actual observations; do not invent execution evidence.

### Sandi Metz-inspired design rules

Use these explicit TypeScript adaptations:

- Keep classes at most 100 nonblank, noncomment lines; check this during review.
- Keep functions and methods at most 5 nonblank, noncomment lines, including their declaration and closing brace, as measured by ESLint.
- Accept at most 4 parameters per function or method.
- Keep framework and transport adapters thin and delegate domain decisions to focused collaborators.
- Prefer cohesive objects and modules with one responsibility. Do not introduce classes, meaningless wrappers, compressed statements, or parameter bags merely to satisfy numeric limits.

Test/spec files and Storybook stories are exempt from the numeric ESLint limits so readable scenarios and examples can remain together. They still require cohesive design. Every new or modified production function must meet all shared numeric limits immediately. A small edit to an over-limit legacy function includes the behavior-protected local refactor needed for compliance. Inline disables and file-level budgets cannot waive the PR gate. Explain local refactoring scope and subjective design tradeoffs in the final report.

`quality-policy.json` supplies inclusive function limits and measured package coverage floors. `eslint-suppressions.json` records legacy file/rule counts for ordinary lint; `quality-sites.json` identifies pre-existing typed/smell occurrences. They are migration budgets, not permission to add violations: do not increase or regenerate them to make a change pass. Prune obsolete entries with `npm run quality:prune` and `npm run lint:prune`. Changed functions must comply even when a legacy violation improves but remains above a limit. See [PR quality](docs/pr-quality.md) for explicit-base local verification and enforcement boundaries. Class size, cohesion, adapter boundaries, and the order of test execution require review; CI does not prove TDD.

### Relevant cleanup and naming

Follow the Scout's Principle: leave touched code cleaner through relevant clearer names, removal of obsolete helpers/imports/comments, reduced duplication, and focused responsibilities. Keep cleanup related and reviewable. Do not introduce unrelated churn, speculative abstractions, or invented cleanup when no useful opportunity exists.

Choose names according to scope, lifetime, distance from declaration, and ambiguity at use sites. `orders.map(x => x.amount)` is acceptable in that tiny scope. If the callback grows, gains competing values, or uses the binding farther from its declaration, reconsider `x` and prefer `order` when that clarifies the use. Reassess short names when moving bindings to wider scopes. Prefer descriptive domain names such as `currencySymbol` over unexplained `c`; clear conventional local indices and coordinates may stay short. There is no blanket minimum identifier length or fixed line-distance cutoff.

### Review requirements

Review code changes against the TDD evidence and design rules above. Flag numeric gate bypasses, baseline increases, tests coupled to implementation details, and adapters that acquire domain responsibilities. Review naming at use sites, relevant cleanup, cohesion and the 100-line class limit separately from automated gates. Run the relevant tests and the repository lint/type checks for implementation changes. Final reports must distinguish actual red/green observations and automated results from subjective review, and identify relevant cleanup, remaining local debt, skipped checks and process exceptions. Keep these requirements consistent when following a skill's workflow or delegating authorized work.

## OpenSpec research delegation

When working on an OpenSpec change (propose, explore, or update), and before writing a proposal or design, spawn the `research` subagent if the change needs any of:

- Understanding code across more than ~3 files or more than one package
- Docs for a library or API you are not certain about
- Comparing implementation options

Give it one focused question per call. Use its findings in your artifacts and don't redo the deep reading yourself.
