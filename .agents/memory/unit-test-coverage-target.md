---
name: Unit-test coverage target
description: The project's ongoing goal to expand unit-test code coverage.
---

The user wants unit tests expanded until the unit-test suite reaches 100% code coverage.

**Why:** the user explicitly set this goal; line coverage can miss callback bodies even when the collection expression executes.

Do not change runtime behavior solely to cover branches that cannot occur through supported user flows.

**Why:** coverage is only useful when tests protect real behavior; making unreachable UI paths reachable just to raise the metric can weaken the product.

**How to apply:** Measure coverage across the repository's test workspaces, add meaningful tests to uncovered source paths incrementally, seed nonempty collections to exercise callbacks, and report residual unreachable branches honestly. Do not claim the target is met until all reports show 100%. In this environment, run the web coverage suite with `--maxWorkers=2`; higher worker counts spend more time starting isolated test environments.
