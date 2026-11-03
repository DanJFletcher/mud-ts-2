# Spec Delta

## Purpose

Give contributors reproducible, configurable quality checks that prevent pull requests from introducing overly complex code, correctness findings, or unapproved baseline growth.

## ADDED Requirements

### Requirement: Shared configurable thresholds

The quality gate SHALL read a checked-in policy shared by local execution and every PR. It MUST support function complexity, cognitive complexity, nesting depth, function length, parameter count, and per-package coverage floors. Invalid or missing required policy values MUST fail visibly. Numeric limits SHALL be inclusive.

#### Scenario: A shared limit is changed
- **WHEN** the configured cognitive complexity limit changes from 10 to 8
- **THEN** local and CI checks use 8 and reject a qualifying function with measured complexity 9

#### Scenario: Boundary values
- **WHEN** a qualifying function measures exactly the configured maximum
- **THEN** that metric passes

#### Scenario: Invalid policy
- **WHEN** a required limit is absent or has an invalid type or range
- **THEN** the check fails with a configuration error rather than silently skipping enforcement

### Requirement: Immediate compliance for changed functions

Every new or modified production function SHALL satisfy all configured function limits immediately. A reduction from a higher legacy value SHALL NOT waive an exceeded limit. An existing suppression or a balanced file-level violation count MUST NOT waive this requirement.

#### Scenario: Improvement remains over the limit
- **WHEN** a modified function's cognitive complexity falls from 20 to 12 with a maximum of 10
- **THEN** the PR fails and reports 12 against the maximum of 10

#### Scenario: Existing budget would hide a new violation
- **WHEN** one legacy violation is fixed and a different new function violates the same rule in the same file
- **THEN** the new function fails even though the file's total violation count does not increase

#### Scenario: Inline suppression on a modified function
- **WHEN** a modified function exceeds a numeric limit and carries an inline rule-disable comment
- **THEN** the PR gate still reports the exceeded limit

### Requirement: Function-aware change attribution

Change detection SHALL inspect full function spans rather than only diagnostic lines. A changed signature or source body, including deletion-only and formatting edits, SHALL qualify a surviving function. Changes within a nested function SHALL also qualify its containing functions. New files SHALL qualify all their functions.

#### Scenario: Finding is on an unchanged declaration
- **WHEN** only a function body changes and the complexity finding points to its unchanged declaration
- **THEN** the whole function is checked against the limits

#### Scenario: Body changes only by deletion
- **WHEN** statements are deleted from a surviving legacy function
- **THEN** the surviving function must satisfy the limits

#### Scenario: Nested callback changes
- **WHEN** a callback body changes inside a containing function
- **THEN** both the callback and its containing function are subject to the limits

### Requirement: Untouched legacy code retains its baseline

Unchanged legacy functions SHALL NOT fail solely because another function in their file changes. Pure line-number shifts, byte-identical whole-file renames, and deleted functions SHALL NOT count as modified surviving functions. A moved function added to another existing file SHALL count as new there.

#### Scenario: Neighboring function changes
- **WHEN** a compliant function changes while an over-limit neighboring function remains unchanged
- **THEN** the untouched neighbor retains its existing migration allowance

#### Scenario: Rename without edits
- **WHEN** a file is renamed without content changes
- **THEN** its existing functions are not treated as newly written code and existing allowances can follow the rename without budget growth

#### Scenario: Function is removed
- **WHEN** an entire function is deleted without changing a surviving function
- **THEN** no compliance requirement is imposed on the deleted function or an untouched neighbor

### Requirement: Type-aware correctness and smell checks

The quality checks SHALL detect unhandled promises, promises used in inappropriate synchronous contexts, non-exhaustive typed switches, and selected duplicated or suspicious logic patterns. New findings MUST fail. Existing findings MAY retain an explicit migration baseline; a baseline MUST NOT hide a new finding in changed code.

#### Scenario: New unhandled promise
- **WHEN** a PR adds a promise-valued operation without the handling required by the configured correctness policy
- **THEN** the check fails with the source location and rule

#### Scenario: New finding replaces an old one
- **WHEN** a PR removes a baselined finding and adds an equivalent finding at a different changed site
- **THEN** the new finding fails despite an unchanged total finding count

### Requirement: Baseline growth protection

Every PR SHALL compare migration allowances with its base revision and reject new or increased allowances. Removing obsolete allowances SHALL be supported. Newly activated rules MAY establish a documented one-time initial baseline in the rollout change; ordinary PRs MUST NOT regenerate the baseline to pass.

#### Scenario: Suppression count increases
- **WHEN** a PR raises an existing file/rule allowance or adds an allowance for an already-enabled rule
- **THEN** the check fails with the baseline difference

#### Scenario: Obsolete allowance removed
- **WHEN** a PR fixes a legacy finding and removes its now-unused allowance
- **THEN** the baseline comparison accepts the decrease

### Requirement: Measured package coverage floors

Every configured package SHALL enforce minimum line, branch, function, and statement coverage using complete production-source inclusion. Initial floors MUST be derived from recorded reproducible coverage measurements. Missing reports or an unsupported required metric MUST fail explicitly. A package SHALL NOT disappear from enforcement because its runner differs.

#### Scenario: Coverage below floor
- **WHEN** a package reports branch coverage below its configured minimum
- **THEN** the PR fails and reports the package, measured percentage, and minimum

#### Scenario: Required report is absent
- **WHEN** tests pass but an enforced package emits no coverage report
- **THEN** the coverage gate fails instead of treating missing coverage as zero findings

#### Scenario: Different test runner
- **WHEN** a package uses the Node test runner rather than the other packages' runner
- **THEN** its coverage is measured and enforced through a compatible report or explicitly equivalent adapter

### Requirement: Reliable base comparison and actionable output

Every PR check SHALL identify its actual target base and comparison revision, fail on unavailable comparison data or analysis errors, and emit a nonzero exit status for a failed gate. Reports SHALL identify policy values, measured failures, source locations, scope, and baseline changes. A local command SHALL accept an explicit base revision and apply equivalent policy.

#### Scenario: PR targets a non-default branch
- **WHEN** a PR targets a maintenance branch
- **THEN** the changed-code comparison uses that PR's base rather than assuming the default branch

#### Scenario: History is missing
- **WHEN** the required comparison revision cannot be resolved
- **THEN** the check fails with a clear error rather than reporting success with no changed functions

#### Scenario: No applicable source changes
- **WHEN** a PR changes documentation only
- **THEN** the changed-function report states that no applicable functions changed while policy and baseline validation still run

### Requirement: Explicit enforcement boundaries

Test/spec files and Storybook stories SHALL retain their documented numeric-limit exemption. Production class size and subjective design quality SHALL remain explicit review checks. The PR gate MUST NOT claim to prove TDD order, naming clarity, or the Scout's Principle.

#### Scenario: Long test scenario
- **WHEN** a test callback exceeds production numeric limits
- **THEN** its length alone does not fail the numeric gate and correctness checks still apply where supported

#### Scenario: Production helper in an ordinary source file
- **WHEN** a changed production helper exceeds a limit
- **THEN** it is checked even if a test imports it
