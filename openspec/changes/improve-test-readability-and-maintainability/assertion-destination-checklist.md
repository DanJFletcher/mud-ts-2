# Assertion-to-Destination Checklist

This mapping is the pre-edit record for the selected scenarios. Preserve the listed guarantees even when setup or test ownership changes.

## Web class selection and abilities

Current owner: `apps/web/src/world/WorldClient.test.tsx`; the existing feature boundary is `apps/web/src/world/screens/StatsScreen.tsx`. No focused `StatsScreen` test file currently exists.

- Move class-choice presentation and confirmation-state assertions—unselected adoption is disabled, selecting a class enables it, and permanent adoption requires confirmation—to a focused `StatsScreen` suite.
- Keep a WorldClient composition assertion for the `character.class.choose` command payload and the class identity returned in the updated snapshot.
- Keep adoption-command failures and class-catalog load failures in WorldClient coverage because they exercise request/response and recovery wiring.
- Keep solo/team ability routing after a completed PvP encounter, the hidden terminal assertion, and the ability-failure/retryable-button assertions in WorldClient coverage; these verify cross-screen command routing.
- Reconcile the resulting test ownership and case count with `refactor-world-client-test-harness/test-ownership-inventory.md`. Preserve the independent history/live-announcement work in the active `refactor-world-client` change.

## SDK combat healing items

Destination remains `packages/client-sdk/src/combat.test.ts`; extract only repeated travel, purchase, and revision-refresh preparation.

- In-combat case: retain damage/healing narration, combat round and health, one-time inventory consumption, resolved-event payload, and idempotent retry without duplicate stream events.
- Between-encounters case: retain victory state, one-point healing, item consumption, and `character.combat_item_used` event assertions.
- Full-health cases: retain rejection without stream growth, item consumption, or combat-state advancement both outside and inside combat.
- Keep the current purchase/travel/combat path as representative integration coverage; helpers must not hide the combat trigger or outcomes.
- Verification after extraction: the focused combat suite passed all 25 tests, and the full client-SDK suite passed all 75 tests; the journey and outcome assertions remain in `combat.test.ts`.

## Quest contract validation

Destination remains `engine-contracts/tests/quests.test.mjs`, split into named cases or descriptive rows with fresh valid defaults.

- Preserve objective/scope and reward ownership checks, including distinct/duplicate item IDs and party-scope exceptions.
- Give each branching-graph failure its own identifying case: missing start/target, unreachable branch, cycle, dead end/unreachable outcome, choices on terminal branches, duplicate IDs, missing or unassigned objectives, and unsupported party scope.
- Preserve the allowed server-verifiable prerequisites and rejected client/progress flags.
- Preserve previous-version objective, branch, choice, and outcome identity/transition checks, including the linear-to-branching incompatibility.
- Verification after the split: the full contracts suite passed all 129 tests; each invalid graph input has a named test, while the combined missing-target/unreachable and duplicate-ID/missing-objective cases still assert both rule messages.

## PostgreSQL append fake and transaction guarantees

Destination for fake readability remains `apps/server/src/persistence/postgres-event-store.unit.test.ts`; replace ordinal `selectIndex`/`failOnInsertIndex` behavior with semantic lookup and named failure-stage controls.

- Preserve active-session rejection for character archival and durable-effect-write failure behavior.
- Preserve unit assertions for primary/companion event writes, receipts, effects, deduplication, persisted values, and command-cache behavior.
- Keep real transaction guarantees in `apps/server/src/persistence/postgres-event-store.integration.test.ts` and `apps/server/src/persistence/single-call-append.integration.test.ts`, including atomic companion writes/retries and rollback of events, companions, and receipts after effect failure. The unit fake is not proof of database rollback.
- The fake now routes session rows by the `worldSessions` table and injects failure at the named `effects` stage. Verification: all 52 unit tests, all 27 real PostgreSQL integration tests, and server typecheck passed. Integration tests used a temporary local database; no configured app database was used.

## Character-state plugin typing

Destination remains `packages/plugins/src/character-state.test.ts`; type its registration capture and valid event builders without changing the covered feature behavior.

- Preserve command, query, system-command, and effect assertions at the plugin boundary.
- Keep valid lifecycle/event scenarios typed against public contracts; keep deliberately malformed validation inputs explicit and locally cast only when necessary.
- Preserve recovery, archive/restore, inventory/equipment, and object/interaction lifecycle assertions.
- Verification after typing: all 36 character-state tests passed, the full plugins suite passed all 347 tests, and the plugins workspace typecheck passed. Registration uses public handler/context types; the small generic adapter keeps intentional raw-input tests from being preempted by schema parsing, and event builders now return `StoredGameEvent` without double casts. No production interface was added for testing.

## Jobs metrics synchronization

The durable-effect overlap case now waits on an explicit start signal (bounded to two seconds) rather than polling; its release gate is always opened in `finally`, and the test asserts only one batch started while the second request was in flight. The focused integration suite passed all 6 tests.

Destination remains `apps/server/src/app/__tests__/jobs-metrics.integration.test.ts`.

- Replace only the bounded start-poll loop with an explicit started signal.
- Preserve durable-effect error logging and successful response behavior, the proof that overlapping batches do not start, and guaranteed release/cleanup if an assertion fails.

## Engine room-presence isolation

Destination remains `packages/engine-core/src/engine.test.ts`; keep the existing team-combat composition scenario intact while making presence state instance-local or unconditionally reset.

- Presence now comes from an engine-local plugin closure instead of module-global mutable state; all 54 engine tests and the engine-core typecheck passed.

## Final validation and review

- The full `npm run test:coverage` pipeline passed after migrating a temporary, isolated PostgreSQL database; line coverage by workspace: contracts 96.27%, demo world 100%, Orraveth world 100%, engine core 94.68%, plugins 99.65%, client SDK 97.84%, UI 97.91%, server 96.83%, web 96.89%.
- Repository `npm run typecheck` passed across all nine workspaces. `npm run quality:test` passed all 63 tests.
- Repository lint required a 4 GB Node heap; it completed with 170 errors and 388 warnings across the repository. Targeted lint on the changed test files had 0 errors and 64 warnings, all `no-explicit-any` warnings in test fixtures.
- The explicit-base PR quality gate was skipped: its documented prerequisite is a committed, clean working tree, while this change remains uncommitted. `git diff --check` passed.
- Baseline suites were green. During iteration, an initial schema-parsing handler adapter caused 22 character-state test failures and 34 type errors; the final raw-input adapter preserves malformed-input tests, and the final character-state suite and typecheck pass. No production source, migrations, or quality-budget files changed; the final diff keeps the original scenario assertions and makes the overlap-count assertion explicit.
- Review found no changed classes or non-exempt support modules; new synchronization and presence helpers stay in test files, so class-size and migration-budget policy remain unchanged.
- Preserve online-member discovery, independent turn order, party departure without deleting the active encounter participant, shared quest completion, both members' experience, and the resulting corpse/world-item state.
- Ensure presence cleanup runs after early errors as well as successful completion.
