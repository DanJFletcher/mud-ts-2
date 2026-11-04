# Tasks

## 1. Establish test ownership and baseline

- [ ] 1.1 Record the current web test result and classify each WorldClient case as controller/helper, screen, or composition coverage; verify the inventory accounts for every existing case.
- [ ] 1.2 Identify unique assertions and cross-feature guarantees before moving tests; verify each planned move has a destination suite or is retained as a composition test.

## 2. Build an isolated typed fixture

- [ ] 2.1 Add a per-test WorldClient scenario fixture with typed snapshot defaults, endpoint-specific handlers, and explicit failure/deferred-response controls; verify fixture instances do not share mutable state.
- [ ] 2.2 Add focused tests for fixture isolation, scenario overrides, and deferred/error responses; verify them with the web test runner and web typecheck.

## 3. Move tests to ownership boundaries

- [ ] 3.1 Move feature-owned lifecycle and state-transition cases to the relevant controller/helper suites; verify each moved behavior with its focused tests.
- [ ] 3.2 Move screen-only rendering and interaction cases to focused screen suites; verify accessibility queries and user-visible outcomes without relying on unrelated fixture state.
- [ ] 3.3 Retain a smaller WorldClient composition suite for session replacement, SDK projection/reconciliation, and cross-feature flows; verify those integration guarantees still pass.
- [ ] 3.4 Remove obsolete shared fixture variables and duplicate assertions after their replacements pass; verify no behavior case is lost by reviewing the inventory from task group 1.

## 4. Validate the refactored suite

- [ ] 4.1 Run `npm run test --workspace @mudd/web`; verify all web tests pass, including the focused suites and retained WorldClient composition tests.
- [ ] 4.2 Run `npm run typecheck --workspace @mudd/web` and `npm run lint`; verify the test helpers use typed boundaries without adding production changes.
