# Tasks

Implementation follows [design.md](./design.md). Observable acceptance criteria are in [Orraveth dialogue](./specs/orraveth-npc-dialogue/spec.md) and [world NPC identity](./specs/world-npc-identity/spec.md). All tasks below are implementation work; no implementation was performed while preparing this change.

## 1. Establish extraction safeguards

- [x] 1.1 Capture the current parsed Orraveth pack before editing it as a checked-in test fixture, recording its source revision or content digest and capture command; verify the unmodified pack deep-equals the fixture and existing world-package tests pass.
- [x] 1.2 Add the extraction equivalence test and document its limited lifetime and the rule against regenerating it from refactored output; verify changing a representative ID, ordered array, or encounter reward causes the comparison to fail.

## 2. Extract typed content and clarify dialogue helpers

- [x] 2.1 Introduce a local typed small-talk options object with explicit stable town keys and documented undefined/empty-condition semantics; add focused tests for default/custom visibility, initial and follow-up prerequisites, deduplication, and IDs remaining stable when display names change.
- [x] 2.2 Migrate all small-talk call sites and bulletin helpers, preserving existing flags and Orin's rod gate; verify exact parsed-pack equivalence and helper tests before making any dialogue behavior changes.
- [x] 2.3 Extract daily jobs, gathering/fishing, crafting, and quests into typed internal modules, formatting recipes without changing values; verify parsed-pack equivalence and the package typecheck.
- [x] 2.4 Extract location content into settlement fragments with a single owner per location key and a checked merge that rejects duplicate fragment keys; verify a collision regression test, parsed-pack equivalence, unchanged map files, and preserved first-location ordering.
- [x] 2.5 Reduce the public entry point to metadata/exports, content assembly, schema parsing, and graph validation; verify existing exports and import-failure tests still pass and internal modules do not import the entry point or runtime/server/client implementations.
- [x] 2.6 Document internal content ownership, stable-ID rules, and helper defaults in a package authoring README; verify its referenced paths and examples match the extracted modules and ADR 0042's layout/content boundary.

## 3. Consolidate encounter definitions without rebalancing

- [x] 3.1 Extract shared hound, boar, badger, deer, and bandit factories with explicit occurrence IDs and loot variations; verify exact pack equivalence, unchanged encounter ordering/probabilities, and the southern deer's hide drop remaining absent from other deer.
- [x] 3.2 Add focused factory tests that independently created encounters do not share mutable combat/loot objects; verify mutation of one returned encounter does not affect another and all balance values match the baseline.

## 4. Enforce complete authored NPC identity validation

- [x] 4.1 Add a shared internal duplicate-ID detector to schema refinement and direct graph validation, replacing redundant mobile-only identity checks while retaining movement/encounter validation; verify schema diagnostics identify the later ID field and graph diagnostics name the offending ID.
- [x] 4.2 Extend `engine-contracts/tests/world-graph.test.mjs` for same-room and cross-room static/static, static/mobile in both orders, and mobile/mobile collisions at both entry points; verify all cases reject correctly, including a valid parsed fixture subsequently mutated before direct graph validation.
- [x] 4.3 Add acceptance cases for identical names with distinct IDs, empty/absent NPC lists, and ID reuse across independently validated packs; verify existing movement and encounter/NPC collision tests continue to pass and update any obsolete mobile-only diagnostic assertions.
- [x] 4.4 Record the pack-scoped NPC identity invariant and compatibility tightening in an ADR, and add a world-package uniqueness assertion; verify the ADR preserves existing event identities and both shipped packs remain valid.

## 5. Correct Orraveth dialogue behavior

- [x] 5.1 Remove only Anwen's four town-flag hiding conditions from quest acceptance/turn-in actions and narrowly revise integration assertions that encode the old policy; verify each quest can be accepted after asking about town and turned in after town dialogue without restart.
- [x] 5.2 Add integration coverage for loading saved town-branch progress, incomplete direct turn-in rejection, restart/retry reward safety, and the church sword's preserved identity with one 20-gold reward; verify the scenarios through the existing authoritative dialogue and quest APIs.
- [x] 5.3 Adjust only the Boatman's ferry-related keywords as designed; verify real dialogue projection returns passage for "ferry stage" and "ferry", dispute for "ferry guild" and "ferry dispute", and unchanged responses for "Silverfin", "passage", and "current".
- [x] 5.4 Increment the Orraveth pack patch version and apply an explicit expected-output patch to the captured baseline for only the four Anwen condition changes, Boatman keyword changes, and version; verify final deep equality detects every other content change and quest versions/IDs remain unchanged.
- [x] 5.5 Update the package authoring documentation to explain quest-state eligibility independent of incidental small-talk branches and the Boatman keyword precedence; verify it agrees with the regression scenarios and does not imply a new global matching algorithm.

## 6. Verify integration and compatibility

- [x] 6.1 Run the contracts, world-demo, and world-orraveth suites, plugin NPC dialogue tests, and affected server world integration/map projection tests against freshly built workspace dependencies; verify valid packs load, existing exploration/replay coverage passes, and every spec scenario has passing coverage.
- [x] 6.2 Run repository typecheck, lint, and build; inspect the final change for unchanged package exports, map JSON, IDs, quest versions, balance values, and protocol/event schemas, recording results and any environmental limitations in a verification report for this change.

## Workflow follow-up

- Review the implementation and its equivalence evidence before archiving through the normal OpenSpec workflow.
- Remove the temporary full-pack baseline only in a separate reviewed cleanup after merge; retain the focused behavior and validation regression tests.
