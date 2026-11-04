# Tasks

## 1. Establish the compatibility baseline

- [x] 1.1 Run the replay, replay-cache and incremental-projection suites on the original runtime. In replay-cache tests, register a prefix ending in team defeat and two independent valid respawn tails. Observe each child's expected health and location, parent isolation, and parity with cold replay before editing production code.
- [x] 1.2 Characterize a second ability spend using a previously recorded action ID with otherwise sufficient resources. Verify a cached prefix and a cold history reject at the same revision for the same reason. Add a successful team-victory prefix followed by advancement and check the expected experience as well as cold parity.
- [x] 1.3 Cover competing failures through the public replay functions. Observe that a revision gap wins over an unknown event type, and that a malformed known event before creation yields the existing pre-creation error. Confirm a contiguous unknown event still produces the unsupported-type rejection.
- [x] 1.4 Run the guarded gameplay latency benchmark on a dedicated local test database before runtime edits. Record the revision, fixture, policy, and short- and long-history reducer timings so the candidate run is comparable.

## 2. Separate immutable-history tracking

- [x] 2.1 Extract immutable registration, freezing and weak parent lookup into a shared internal module. Preserve character checkpoint retention and public exports. Verify replay-cache and incremental-projection tests, including mutable inputs, isolated results and incremental tail counts.
- [x] 2.2 Point the generic projection helper at the shared module and verify it no longer imports character replay. Run its plugin consumers' tests and PostgreSQL stream freshness, cross-writer append and cache eviction integration cases against rebuilt packages.

## 3. Replace the reducer in one cutover

- [x] 3.1 Map the original event branches and accepted versions to handler responsibilities. Check each family against existing public tests and establish passing characterization coverage for any newly identified gap before editing that behavior.
- [ ] 3.2 Move lifecycle, travel, resources, gathering, inventory, commerce, jobs, quests and dialogue handling into cohesive internal modules. Check the mappings against the original branches and run their focused public replay cases as each family is wired in.
- [ ] 3.3 Extract combat, advancement, ability-spending and respawn handlers with their precise evidence needs. Verify legacy combat versions, distinct consumable rules, forked respawn, advancement and duplicate-action outcomes.
- [ ] 3.4 Complete the single ordered dispatcher for cached and uncached replay. Verify all original event types are routed, unknown types and revision gaps fail as characterized, and class-action availability reflects final resources. Remove the superseded branch chain in the same cutover.
- [ ] 3.5 Run engine-core and plugin suites, relevant PostgreSQL integration tests, lint, typecheck and the explicit-base PR quality checks. Review changed functions against project limits, prune obsolete allowances, and record skipped checks or unresolved coverage gaps.
- [ ] 3.6 Repeat the stage-one benchmark with the same database setup, fixture sizes and policies. Compare cold and warm reducer timings between revisions, investigate repeatable regressions, and report the outcome with the verification results.
