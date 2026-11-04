# Design

## Context

See proposal.md for motivation and file scope. The preceding read-only research found these concrete patterns:

- WorldClient still has module-level scenario variables, manual resets, and `classApiFixture` positional booleans, despite the isolated fixture already covered by `world-client-harness.test.ts`.
- SDK combat potion scenarios repeat travel, purchasing, return travel, and revision reloads before the tested combat action.
- Quest contract cases combine unrelated validation failures.
- `createAppendTransaction` selects an active session by select index and injects failures by insert index.
- Character-state test registration uses permissive handler and event casts.
- Jobs metrics tests poll for operation start despite already having a release gate; engine presence resets can be skipped after failed assertions.

The earlier review was static and did not establish actual flakes or a passing baseline. The completed `refactor-world-client-test-harness` change supplies the fixture and ownership inventory; this change continues adoption. Active WorldClient work may change nearby files, so preserve its feature boundaries and reconcile destinations before each web migration.

## Goals / Non-Goals

**Goals:** Make scenario differences explicit, preserve unique regression guarantees, and diagnose failures at the behavior boundary that owns them. Keep setup abstractions small enough that readers can understand a case without tracing a general-purpose test framework.

**Non-Goals:** Runtime changes, universal cross-package fixtures, a new test framework, arbitrary file-length or test-count targets, removing valuable integration coverage, or applying production function-size limits to exempt test bodies.

## Decisions

### 1. Migrate scenarios through existing ownership boundaries

Use fresh typed web fixtures with named overrides for each migrated feature group. Prefer existing controller or screen suites for feature-owned behavior; retain WorldClient cases for session replacement, reconciliation, and cross-feature wiring. Remove old shared fields and resets only when their final consumers migrate. Update the existing ownership inventory with assertion destinations.

Acceptance: every migrated case has explicit independent starting state, retains its unique assertions, and leaves no unused scenario state. Existing deferred/error controls remain usable. Avoid simply splitting the giant file: that would retain coupling. Do not require eliminating all WorldClient shared state in this change; complete one cohesive class-selection/ability group first, including the positional fixture conversion.

### 2. Extract preparation while leaving the tested behavior visible

Add SDK-local helpers for preparing a character with a healing draught at the combat location, using real public client operations and explicit revision handling. Start with the repeated potion scenarios identified in `combat.test.ts`. Keep combat actions and health, consumption, and encounter assertions in each test. Retain a representative purchase/travel/combat journey with its integration assertions.

Acceptance: each affected case names its distinguishing starting condition and visibly performs its tested action. Avoid direct event injection merely to shorten setup, and avoid a universal world builder. Share route data only within the touched SDK setup if useful; cross-package route-map consolidation is deferred.

### 3. Name independent contract failures individually

Split the combined quest validation and quest graph validation cases into independent named cases or descriptive table rows. Preserve the exact invalid inputs and expected failures, with valid fresh defaults for each row. Keep multi-step lifecycle tests intact when the sequence itself is the guarantee.

Acceptance: runner output identifies each validation rule and every original rule assertion has a replacement. Prefer explicit cases when table data would obscure the rule; do not force unrelated invalid inputs into one generic table.

### 4. Model database fake controls by meaning

Make the append fake respond to the selected table or named operation, and inject failures at a named durable-write stage. Keep recorded values and SQL/transaction assertions where they protect adapter behavior. Retain real database integration guarantees for atomicity; a fluent fake cannot prove database rollback.

Acceptance: inserting an unrelated read does not change which operation represents the active-session lookup, and failure scenarios identify the failing write without ordinal indexes. Avoid both index renaming without semantic dispatch and reproducing a database inside the fake.

### 5. Type valid plugin scenarios at reusable boundaries

Use the real public registration contracts to type captured command and event handlers. Build valid events with canonical event types and explicit scenario overrides. Keep deliberately malformed inputs visibly local to validation tests.

Acceptance: the registration harness and valid event construction no longer rely on `any`, `as never`, or double casts to bypass their contracts. Prefer typed partial collaborators permitted by the real contract; do not fabricate a new production interface solely for testing.

### 6. Synchronize and clean up explicitly

Replace the bounded sleep loop in jobs metrics tests with a promise resolved by the fake when execution begins, then retain the existing release control. Guarantee release in teardown or `finally` so failed assertions cannot strand work. Use instance-local engine presence where the existing plugin seam allows it, otherwise unconditional teardown to reset module state.

Acceptance: no elapsed-time guess determines that the job started, and cleanup runs after failed assertions as well as successful ones. Preserve bounded runner timeouts. Do not claim historical flakes have been reproduced.

## Risks / Trade-offs

- [A moved test loses a unique integration assertion] -> Record assertion destinations before edits and retain representative composition/journey regressions; test counts alone do not prove equivalence.
- [Helpers hide relevant behavior] -> Extract only preparation; keep the trigger and expected outcomes visible and review helper names at their call sites.
- [Typed setup becomes verbose] -> Use narrow valid defaults rather than weakening contracts or adding speculative builders.
- [A fake duplicates production logic] -> Limit it to observable collaborator protocols and keep real database coverage.
- [A refactor exposes an unrelated bug] -> Stop that portion and report it; any authorized behavior fix needs a focused failing test before production edits.
- [Support files accidentally bypass quality rules] -> Ordinary support modules outside test/spec exemptions must meet numeric limits; do not rename files or raise suppression budgets to evade checks.

## Migration Plan

1. Record passing affected suites and an assertion mapping before editing. Report unavailable database or dependency prerequisites explicitly.
2. Refactor the web class scenario group and SDK potion setup first; then independent contract cases, database fake controls, plugin typing, and concurrency cleanup in separate reviewable groups.
3. Run each focused suite before and after its group. New helper behavior needs small red/green cycles with an observed behavioral failure; existing green coverage protects behavior-preserving moves. Never manufacture a failing test for a pure rename.
4. Run affected workspace suites, repository lint and typecheck, and the documented explicit-base PR quality checks with coverage. Review cohesion, helper names, assertion equivalence, class size, and unchanged quality budgets separately from automation.
5. Roll back individual test groups if equivalence cannot be established. There is no deployment or data migration. Record actual checks, red/green observations where applicable, skipped checks, and remaining local debt in the implementation report.
