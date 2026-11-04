# Tasks

## 1. Establish canon regression baseline

- [ ] 1.1 Run `npm run test --workspace @mudd/world-orraveth -- src/phase-3.test.ts` before editing; record actual results and blockers and verify the sole implementation file is `phase-3.test.ts`.
- [ ] 1.2 Map every original assertion to a named invariant destination in this change's implementation notes or report; verify the mapping includes exact membership/order, political metadata, identities, absence restrictions, river topology, coordinates/terrain/color, endpoints, fishing/dialogue/readables, version, and starting location.

## 2. Organize settlement and route invariants

- [ ] 2.1 Create cohesive settlement and route groups with descriptive named rows only for repeated shapes; verify the focused suite after each group and preserve exact primary/non-primary membership, ordered IDs, lengths, and political metadata.
- [ ] 2.2 Separate NPC identity and authored restriction cases, keeping unique oak, bridge, healer, territory, fishing, readable, and dialogue expectations explicit; verify the focused suite and assertion mapping, including the ordered roster and all undefined-content restrictions.

## 3. Organize topology and pack metadata

- [ ] 3.1 Give Lower Rill reach presentation and adjacency invariants distinct names, preserving reciprocal exits, membership, coordinates, and road-ID absence at the original locations; verify the focused suite and review all original river assertions against their destinations.
- [ ] 3.2 Separate pack version and starting-location cases, remove only obsolete test-local setup, and review lookup diagnostics; verify the focused suite and complete assertion mapping without snapshots, runtime changes, or weakened expectations.

## 4. Verify integration and ownership

- [ ] 4.1 Run `npm run test --workspace @mudd/world-orraveth`, `npm run lint`, and `npm run typecheck`, plus applicable explicit-base PR quality verification from `docs/pr-quality.md` with its prerequisites; record actual results and skipped checks without changing configuration or budgets.
- [ ] 4.2 Review naming, cohesion, applicable numeric limits and class sizes, exact canon preservation, and the final diff; verify no content, baseline JSON, production modules, other tests/shared helpers, quality-test files, or other changes' artifacts were edited, and report green refactor baselines, any new-behavior red/green evidence, exceptions, and remaining debt.
