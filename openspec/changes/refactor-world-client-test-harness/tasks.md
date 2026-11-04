# Tasks

## 1. Establish test ownership and baseline

- [x] 1.1 Record the current web test result and classify each WorldClient case as controller/helper, screen, or composition coverage; verify the inventory accounts for every existing case.
- [x] 1.2 Identify unique assertions and cross-feature guarantees before moving tests; verify each planned move has a destination suite or is retained as a composition test.

## 2. Build an isolated typed fixture

- [x] 2.1 Add a per-test WorldClient scenario fixture with typed snapshot defaults, endpoint-specific handlers, and explicit failure/deferred-response controls; verify fixture instances do not share mutable state.
- [x] 2.2 Add focused tests for fixture isolation, scenario overrides, and deferred/error responses; verify them with the web test runner and web typecheck.

## 3. Move tests to ownership boundaries

- [x] 3.1 Move feature-owned keyboard filtering and single-flight scheduling assertions to focused suites; retain composition checks for feature wiring.
- [x] 3.2 Move navigation-menu and theme behavior to focused screen tests; verify accessible controls and user-visible outcomes.
- [x] 3.3 Retain WorldClient composition cases for session replacement, SDK projection/reconciliation, and cross-feature flows; verify all retained integration guarantees still pass.
- [x] 3.4 Remove redundant WorldClient cases and their test-local fake setup only after focused replacements pass; preserve shared fixture state still used by the remaining composition suite and review the inventory.

## 4. Validate the refactored suite

- [x] 4.1 Run `npm run test --workspace @mudd/web`; verify all web tests pass, including the focused suites and retained WorldClient composition tests.
- [x] 4.2 Run web typecheck and lint; ensure changed test files are clean and record existing failures outside this change.
