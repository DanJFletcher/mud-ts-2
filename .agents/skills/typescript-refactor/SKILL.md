---
name: typescript-refactor
description: Review TypeScript code for concrete maintenance costs or make a behavior-preserving refactor after tests are green. Use when asked to identify code smells, improve maintainability, simplify TypeScript structure, or delegate a bounded refactor.
---

# TypeScript Refactoring

Use this skill for evidence-based TypeScript smell reviews and behavior-preserving refactors. Keep the judgment in this guide; host-specific agent profiles should only route to it.

## Choose a mode

- **Review mode** is read-only. Do not edit files. Identify concrete maintenance costs and proportionate options, including when the code should stay as it is.
- **Edit mode** changes only the agreed scope. First establish passing public-behavior coverage for the code the refactor can affect. Follow the repository's `AGENTS.md` rules and preserve behavior.
- **After a green implementation**, consider cleanup inline, a read-only second opinion, a bounded delegated edit, or no refactor. Delegation is optional; do not add a serial handoff when the change is already clear.

Read `references/typescript-field-guide.md` when evaluating extraction, type assertions, parameter objects, feature flags, discriminated unions, or strategy objects.

## Review process

1. Read the repository instructions and inspect the relevant callers, tests, and ownership boundaries.
2. Describe each finding with:
   - location and affected callers;
   - an observable maintenance cost (for example, inconsistent permission decisions, confusing control flow, or a behavior change that is hard to detect);
   - a proportionate refactoring option;
   - behavior and error ordering to preserve.
3. Distinguish a duplicated expression from a duplicated policy. Similar code that represents independently changing rules is not automatically a reason to merge it.
4. Rank findings by impact and confidence. Do not manufacture a cleanup when no concrete cost is visible.
5. Return findings and recommendations without editing files.

## Edit process

1. Confirm the requested scope and inspect its public callers and current tests.
2. Run the relevant tests before editing. For behavior-preserving refactors, require existing passing coverage that exercises the outcomes the edit can affect. Do not treat a post-edit green run as a pre-edit baseline.
3. Make one small change at a time. Preserve accepted inputs, outputs, side effects, exception behavior, and error precedence. If a proposed change would alter accepted input or user-visible behavior, separate it as a feature or bug fix and use the repository's red/green process.
4. Run the focused tests and relevant type/lint checks after the edit. Review the diff for scope, naming, cohesion, and newly introduced maintenance costs.
5. Report the pre-edit command and result, files changed, post-edit commands and results, and any unverified checks.

Do not extract code just because it is repeated. Share a decision when callers enforce the same domain policy and inconsistent enforcement is a real risk; leave independently evolving policies separate.

## Selective delegation

The implementing agent owns final verification. A handoff for a delegated edit must state:

- **Mode:** read-only review or bounded edit.
- **Baseline:** commit or exact tested revision, plus any pending changes that must be present.
- **Observed evidence:** the pre-edit test command and its actual result; distinguish the parent's run from the specialist's runs.
- **Owned scope:** exact files or responsibility, with no overlapping edits.
- **Invariants:** accepted input, outputs, side effects, error precedence, and other behavior that must remain unchanged.
- **Verification:** required commands and the report expected back.

If a separate task cannot see the stated baseline or cannot reproduce the green pre-edit result, it must report that mismatch before editing. The parent reviews the integrated diff and reruns the relevant checks.

### Portable Replit task handoff

Copy and fill this into a separate Replit task when an isolated edit is useful:

> Use `.agents/skills/typescript-refactor/SKILL.md` in **edit mode**. Load `AGENTS.md` and follow its development rules. Baseline: `<commit or exact revision>`; include these pending changes if applicable: `<description or none>`. Before editing, run `<test command>`; the parent observed `<actual result>`. If the revision or result differs, stop and report the mismatch. Own only `<files or responsibility>`. Preserve `<inputs, outputs, side effects, error precedence, invariants>`. Make a bounded behavior-preserving refactor, then run `<verification commands>`. Return the changed files, actual commands/results, and any gaps. The parent will inspect the diff and verify the integrated result.

## Report format

For a review, return:

1. **Summary:** overall condition and whether a change is justified.
2. **Findings:** severity, file/location, affected callers, concrete cost, suggested change, and behavior to preserve.
3. **No-change areas:** relevant duplication or complexity that should remain separate, if any.
4. **Verification:** checks actually run; clearly label checks not run.

For an edit, use the same summary and verification sections, adding the pre-edit baseline and a concise diff summary.
