# Design

## Context

See proposal.md for scope and motivation. `phase-3.test.ts` imports the public `orravethWorld` and builds a location lookup. Seven broad cases mix Ashcombe, Thornmere, Mosswake, Lower Rill, pack metadata, NPC identities, and unresolved lore restrictions. Prior research and direct inspection support reorganizing these assertions without changing content. Design is warranted to resolve grouping and prevent accidental loss of negative canon constraints.

## Goals / Non-Goals

**Goals:** Give each durable invariant a clear test name, retain all exact expectations, and make a failed lookup identify the relevant world entity.

**Non-Goals:** New lore or mechanics, production authoring changes, broad consolidation of other content suites, snapshots, or a generic world-test framework.

## Decisions

### Organize one file by durable invariant

Keep `phase-3.test.ts` and use cohesive describe groups for settlement membership/political metadata, NPC identities, authored restrictions, Lower Rill topology/map presentation, and pack metadata/start location. Separate unrelated assertions currently hidden in one case. File splitting is deferred because the current file is small enough to navigate with clear groups.

Alternative: one file per settlement. Rejected for this scope because it fragments cross-settlement restrictions and requires shared support without a demonstrated benefit.

### Use named data only for repeated shapes

Use named rows for repeated settlement primary memberships and route/non-primary membership checks. Keep Ashcombe oak restrictions, Thornmere bridge/healer restrictions, territory endpoints, fishing timing, readables, and dialogue assertions explicit. River rows may expose reach IDs and expected coordinates, with distinct adjacency assertions; preserve reciprocal direction checks and absence of road IDs at the same locations as before.

Alternative: a single broad table for all content. Rejected because unique restrictions become optional flags and failures lose narrative meaning.

### Preserve the full regression contract

Inventory every original assertion before moving it. Preserve membership lengths and ordered IDs, exact NPC IDs/names and their ordered roster, pack version `1.21.1`, first location, terrain/color/coordinates, forbidden future roads, existing fishing timing, unresolved-cause dialogue, and all undefined-content checks. Keep assertions against the public world export; never derive expected values wholesale from actual world data. Local lookup helpers may fail clearly on absent entities but must not add runtime APIs or mutate content.

Acceptance: every original assertion has an identifiable destination; the test runner names the affected settlement or invariant. No negative restriction is replaced by a broad snapshot or weaker collection assertion.

### Preserve parallel ownership

Only `packages/world-orraveth/src/phase-3.test.ts` and this change's artifacts may change. Other tests, content data, production modules, baseline JSON, shared helpers, manifests, config, and ledgers remain outside scope. There is no merge-order dependency on the quality-test or broader maintainability changes. Separate worktrees keep test/coverage outputs independent.

## Risks / Trade-offs

- [Regrouping loses a restriction or order guarantee] -> Maintain an assertion mapping and review each original expectation against its destination.
- [Generalized rows obscure special content] -> Use tables only for shared shapes and retain named unique cases.
- [Missing entities produce vague failures] -> Name rows by entity ID and use explicit existence checks or narrow local lookups where helpful.
- [Refactor discovers a canon mismatch] -> Report the mismatch rather than changing content or expectations to make the suite pass.

## Migration Plan

1. Establish a passing focused baseline with `npm run test --workspace @mudd/world-orraveth -- src/phase-3.test.ts` and record assertion destinations.
2. Reorganize settlement/route cases first, then identity/restriction and river/metadata cases; run the focused suite after each group. Existing passing behavior tests protect this refactor; any new helper behavior needs observed red/green evidence.
3. Run the full Orraveth suite, repository lint and typecheck, and applicable explicit-base checks from `docs/pr-quality.md`. Review naming, cohesion, numeric exemptions, class size, unchanged budgets, and exact canon preservation separately from automated results.
4. Rollback restores the single owned test file. No deployment or data migration is needed. Report actual checks, skipped checks, process exceptions, and remaining local debt.
