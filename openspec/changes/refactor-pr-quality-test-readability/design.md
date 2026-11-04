# Design

## Context

See proposal.md for scope and motivation. Prior research and direct inspection show that `comparison.test.mjs` bundles rename/path handling, revision errors, merge-base selection, parser forms, diff selection, and deletion behavior. `enforcement.test.mjs` bundles budget transitions, occurrence matching, coverage floors, and numeric measurements. Source strings and hunks are deliberately sensitive to exact positions. Design is warranted to resolve how readability changes preserve those regression conditions.

## Goals / Non-Goals

**Goals:** Make individual guarantees discoverable in runner output and preserve exact fixture semantics and diagnostic expectations.

**Non-Goals:** Analyzer/gate changes, broader test rewrites, new dependencies, quality-policy changes, or generic fixture frameworks.

## Decisions

### Name independent rules and retain meaningful sequences

Separate revision failures from successful comparisons; split function selection by body/signature/formatting edits, inserted headings, deletions, moves, duplicate occurrences, and extension-sensitive parsing. Separate budget increases, decreases, unchanged renames, and edited renames, plus individual missing/invalid coverage cases. Use named table rows only when setup and assertions genuinely share a shape. Keep repository histories together when their sequence is the guarantee, with a fresh temporary repository per independent case.

Alternative: formatting alone. Rejected because a broad scenario would still stop at its first failure and conceal independent guarantees.

### Preserve source fixture bytes

Prefer readable local multiline literals or explicit line arrays when they preserve source bytes. Keep significant leading/trailing newlines, indentation, CRLF conversions, intentional invalid syntax, and same-line functions. Do not format the embedded code as ordinary implementation code. Preserve hand-authored hunks and measured limits; compare fixture content before/after extraction rather than updating expectations to fit a changed fixture.

Alternative: a shared source builder. Rejected because it hides line positions and adds a dependency outside the owned files.

### Keep assertions diagnostic and local

Expand compressed statements and use descriptive names at their uses. Keep expected selected function names, actual measurements, package identities, failure flags, and error patterns visible. Do not replace precise assertions with counts or truthiness, or over-mock real repository operations. Maintain an assertion mapping in this change's tasks or implementation report; test-count increases alone do not establish equivalence.

### Preserve parallel ownership

Only the two named test files and this change's artifacts may change. `scripts/quality/tests/repository.mjs` and other shared helpers are read-only dependencies. There is no merge-order dependency on the Orraveth change or the broader test-maintainability change. Use separate worktrees for implementation and verification outputs; do not introduce common helper or configuration edits.

## Risks / Trade-offs

- [Whitespace changes alter selected functions or measurements] -> Preserve fixture bytes and exact hunks; run focused tests after each case group.
- [Splitting repository scenarios loses history guarantees] -> Retain necessary history within each case and use the existing cleanup-aware repository helper unchanged.
- [More named cases duplicate small setup] -> Accept small local duplication when it makes the tested rule explicit; avoid abstractions that obscure fixture positions.
- [Readability work weakens safety coverage] -> Map every original assertion, including fail-closed cases, before removal.

## Migration Plan

1. Establish passing coverage with `node --test scripts/quality/comparison.test.mjs scripts/quality/enforcement.test.mjs` before edits; record blockers honestly.
2. Refactor comparison then enforcement groups in small behavior-preserving steps, running focused tests each time. New helper behavior, if required within scope, needs an observed behavioral red/green cycle; pure refactors use the passing baseline.
3. Run `npm run quality:test`, repository lint and typecheck, and applicable explicit-base checks from `docs/pr-quality.md`; never increase baselines. Review naming, cohesion, class size, and assertion equivalence separately.
4. Rollback restores only the owned test files; no deployment or data migration is needed. Report actual verification, skipped checks, process exceptions, and remaining debt.
