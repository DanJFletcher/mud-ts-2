# Spec Delta

## Purpose

Provide durable guidance for coding agents and reviewers to improve touched code, preserve meaningful test-first development, and choose names that remain clear at their point of use.

## ADDED Requirements

### Requirement: Persistent development guidance

Repository agent instructions SHALL state the development discipline and require its use during skill-driven and delegated implementation. Directly conflicting local implementation guidance MUST be reconciled. Existing OpenSpec research-delegation requirements SHALL remain intact.

#### Scenario: Implementation through a skill
- **WHEN** an agent implements a change using an implementation skill
- **THEN** the repository's TDD, cleanup, naming, and quality requirements still apply

#### Scenario: Delegation
- **WHEN** an authorized coding task is delegated
- **THEN** the delegated task carries the applicable development requirements

### Requirement: Observed test-first development

For behavior changes and bug fixes, agents SHALL observe a behavior-relevant failing test before production implementation, then passing tests after minimal implementation and refactoring. Behavior-preserving refactors SHALL establish passing coverage first. Documentation and formatting-only changes SHALL NOT require invented behavior tests.

#### Scenario: Bug reproduction
- **WHEN** an agent fixes a behavior bug
- **THEN** it first observes a test fail for that bug and later observes the test pass after implementation

#### Scenario: Setup failure
- **WHEN** a test fails only because of imports, syntax, or environment setup
- **THEN** the agent does not report that failure as evidence of the required behavior-first red phase

### Requirement: Bounded Scout's Principle

Agents SHALL leave code they touch cleaner by addressing relevant unclear names, obsolete code, unnecessary duplication, and responsibilities exposed by the task. Cleanup MUST remain related and reviewable. Agents MUST NOT introduce unrelated churn or speculative abstractions merely to demonstrate cleanup.

#### Scenario: Change makes an old helper obsolete
- **WHEN** implementing a task removes the need for a local helper, import, or explanatory comment
- **THEN** the agent removes the obsolete material and verifies the affected behavior

#### Scenario: No useful cleanup opportunity
- **WHEN** the affected code already satisfies the discipline and no relevant cleanup is warranted
- **THEN** the agent can report that conclusion without manufacturing additional edits

### Requirement: Strict compliance on touched functions

Agents SHALL bring new and modified production functions within shared numeric limits immediately, even when a small task requires a larger local refactor. They MUST preserve behavior through tests and explain the resulting scope. Numeric suppressions MUST NOT be used to bypass PR gates. Production classes SHALL retain the 100-line review limit.

#### Scenario: Small edit in an over-limit legacy function
- **WHEN** a behavior fix modifies a legacy function above the configured complexity limit
- **THEN** the agent treats the local refactor needed for compliance as part of the task and protects it with tests

### Requirement: Naming follows lexical context

Agents SHALL choose names according to scope, lifetime, distance from declaration, and ambiguity at use sites. Descriptive names SHALL be preferred as contextual distance grows. Short names SHALL be permitted when their meaning is immediately clear throughout a tiny scope. No fixed minimum name length or line-distance rule SHALL replace this judgment.

#### Scenario: Tiny callback
- **WHEN** an agent writes `orders.map(x => x.amount)`
- **THEN** the short name `x` is acceptable because its role is immediately clear

#### Scenario: Callback grows
- **WHEN** the callback grows to several steps, uses the item farther from its declaration, or introduces competing values
- **THEN** the agent reassesses the binding and prefers a descriptive name such as `order` when `x` would require readers to reconstruct its meaning

#### Scenario: Domain value without local context
- **WHEN** a standalone binding represents a currency symbol
- **THEN** the agent chooses a descriptive name such as `currencySymbol` rather than an unexplained `c`

#### Scenario: Conventional short names
- **WHEN** an index or coordinate has an unambiguous conventional meaning in its local context
- **THEN** its short name is acceptable without mechanical expansion

### Requirement: Reassess names during cleanup

When widening a binding's scope or extending its uses, agents SHALL reconsider whether its name remains clear. They SHALL rename ambiguous bindings as part of relevant cleanup without renaming unrelated code solely for stylistic consistency.

#### Scenario: Binding moves to outer scope
- **WHEN** an agent moves a short-lived binding into a wider scope with more distant uses
- **THEN** it reassesses and, where needed, improves the name before completing the task

### Requirement: Truthful implementation and review evidence

Agent reports SHALL briefly identify observed red/green evidence, completed checks, relevant cleanup, and remaining local debt or verification gaps. Review guidance SHALL distinguish automated gates from naming, cohesion, class size, and cleanup judgments. Agents MUST NOT weaken tests or fabricate evidence to satisfy the policy.

#### Scenario: Tests cannot run
- **WHEN** an environment blocker prevents the relevant tests from running
- **THEN** the report identifies the blocker and verification gap without claiming TDD completion

#### Scenario: Code review
- **WHEN** a reviewer evaluates a completed implementation
- **THEN** the review checks naming at use sites, relevant cleanup, class size, and test evidence in addition to automated gate results
