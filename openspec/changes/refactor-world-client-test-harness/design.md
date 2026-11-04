# Design

## Context

See [proposal.md](./proposal.md) for motivation. The current WorldClient suite shares a large mutable fixture and fake API across tests for many independently owned features. Focused tests already exist for several controllers and helpers, so the refactor should build on those boundaries rather than recreate their coverage.

This change follows the active `refactor-world-client` work. It must preserve the session and feature ownership boundaries documented in `apps/web/src/world/features/README.md`; it does not reopen or modify that change's artifacts.

## Goals / Non-Goals

**Goals:**

- Make each test's scenario state explicit and isolated.
- Put feature-owned behavior near the controller or screen that owns it.
- Keep WorldClient tests for interactions that genuinely cross composition boundaries.
- Preserve meaningful behavior coverage while reducing reliance on a shared all-purpose fake.

**Non-Goals:**

- Changing production behavior, APIs, or gameplay rules.
- Replacing integration tests with unit tests or moving every full-client test to a controller test.
- Reaching a target test-file size, test count, or coverage percentage as a proxy for quality.
- Adding a test framework or runtime dependency.

## Decisions

### 1. Classify tests by the behavior boundary they protect

Review each existing test and place it in one of three levels:

- **Controller/helper tests** cover isolated feature rules, lifecycle, parsing, and state transitions through public feature interfaces.
- **Screen tests** cover a screen's rendering and user interactions with supplied view data and callbacks.
- **Composition tests** cover WorldClient wiring, session replacement, cross-feature flows, and SDK projection/reconciliation behavior.

Move a test only when its behavior can be tested at a narrower boundary without losing a meaningful integration guarantee. Keep at least one composition-level regression when behavior depends on multiple feature owners.

**Alternative considered:** Move all tests out of `WorldClient.test.tsx` into feature suites. Rejected because some flows depend on actual composition, and making them controller-only would lose integration coverage.

### 2. Use per-test typed scenario fixtures, not shared mutable module state

Create a test harness that returns a fresh fixture for each test. The fixture should expose typed snapshot defaults, explicit scenario overrides, and focused controls for deferred responses or failures. Route behavior should be separated by endpoint or scenario concern rather than kept in one mutable switch driven by dozens of independent module variables.

Use canonical SDK/contract types where they fit. Keep a small number of deliberately low-level transport tests for details such as command IDs or response handling; other tests should assert observable UI or public feature outcomes instead of inspecting raw `fetch` history.

**Alternative considered:** Keep the current fake API and only split the test file. Rejected because file splitting alone would preserve the shared mutable-state coupling.

### 3. Migrate incrementally and preserve regression intent

Move tests in small feature groups. For each group, first ensure the target suite can express its behavior, then move the relevant cases and remove only redundant coverage. The WorldClient composition suite remains until equivalent composition assertions pass. Do not change production modules solely to make tests easier to move.

**Alternative considered:** Replace the whole suite in one rewrite. Rejected because it would make missed behavior and regressions difficult to distinguish.

## Risks / Trade-offs

- [Moving a scenario drops a unique regression assertion] → Inventory assertions before moving; require equivalent coverage at the new boundary or retain a composition test.
- [The new fixture becomes another oversized universal mock] → Keep scenario state explicit, split endpoint concerns, and avoid adding feature flags to a single global fixture.
- [Typed fixtures take more setup than permissive casts] → Provide small typed builders with sensible defaults; avoid weakening types for convenience.
- [Some tests cannot be narrowed without losing confidence] → Keep them as composition tests rather than forcing all behavior into unit tests.

## Migration Plan

1. Begin after the active WorldClient refactor has a stable baseline; record the current web test result.
2. Inventory the large suite by behavior owner and identify tests that can move without losing cross-feature guarantees.
3. Add the isolated typed fixture and validate it with representative screen and composition cases.
4. Migrate feature groups incrementally, running their focused suites after each group.
5. Run the complete web test suite, web typecheck, and lint. Compare retained behavior coverage and keep the composition suite for cross-boundary cases.

Rollback is limited to restoring moved test files and fixture helpers. No production behavior or data migration is involved.
