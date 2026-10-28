---
name: Unit-test coverage target
description: The project's ongoing goal to expand unit-test code coverage.
---

The user wants unit tests expanded until the unit-test suite reaches 100% code coverage.

**Why:** the user explicitly set this goal; line coverage can miss callback bodies even when the collection expression executes.

**How to apply:** Measure coverage across the repository's test workspaces, add meaningful tests to uncovered source paths incrementally, seed nonempty collections to exercise uncovered callbacks, and do not claim the target is met until all reports show 100%.
