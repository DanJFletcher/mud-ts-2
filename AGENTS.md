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

Documentation-only and formatting-only changes do not require behavior tests. If a meaningful test cannot run, report the blocker and the resulting verification gap; do not claim TDD. Existing green tests or tests written after implementation are not evidence of a red/green cycle.

The final report must briefly identify the test observed failing and why, the checks that passed afterward, and any skipped checks or process exceptions. Report actual observations; do not invent execution evidence.

### Sandi Metz-inspired design rules

Use these explicit TypeScript adaptations:

- Keep classes at most 100 nonblank, noncomment lines; check this during review.
- Keep functions and methods at most 5 nonblank, noncomment lines, including their declaration and closing brace, as measured by ESLint.
- Accept at most 4 parameters per function or method.
- Keep framework and transport adapters thin and delegate domain decisions to focused collaborators.
- Prefer cohesive objects and modules with one responsibility. Do not introduce classes, meaningless wrappers, compressed statements, or parameter bags merely to satisfy numeric limits.

Test/spec files and Storybook stories are exempt from the numeric ESLint limits so readable scenarios and examples can remain together. They still require cohesive design. For a production exception, use a narrowly scoped ESLint disable with a concrete design reason and explain the tradeoff in the final report. Do not disable rules across a whole file to avoid refactoring.

`eslint-suppressions.json` records pre-existing numeric violations by file and rule. It is a migration budget, not permission to add violations: improve touched functions where practical, do not increase or regenerate the baseline to make a change pass, and prune unused entries with `npm run lint:prune`. ESLint budgets counts rather than individual function identities, so reviewers must still check changed functions. Class size, cohesion, adapter boundaries, and the order of test execution require review; CI does not prove TDD.

### Review requirements

Review code changes against the TDD evidence and design rules above. Flag new unexplained exceptions, baseline increases, tests coupled to implementation details, and adapters that acquire domain responsibilities. Run the relevant tests and the repository lint/type checks for implementation changes. Keep these requirements consistent when following a skill's workflow.

## OpenSpec research delegation

When working on an OpenSpec change (propose, explore, or update), and before writing a proposal or design, spawn the `research` subagent if the change needs any of:

- Understanding code across more than ~3 files or more than one package
- Docs for a library or API you are not certain about
- Comparing implementation options

Give it one focused question per call. Use its findings in your artifacts and don't redo the deep reading yourself.
