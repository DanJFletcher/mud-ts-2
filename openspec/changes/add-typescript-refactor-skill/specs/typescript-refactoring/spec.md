# TypeScript refactoring

## Purpose

Give contributors consistent, evidence-based TypeScript refactoring assistance during reviews and the refactor stage of TDD across supported coding assistants.

## ADDED Requirements

### Requirement: Evidence-based review
The skill SHALL keep review requests read-only and connect each finding to a location, an observable maintenance cost, a proportionate refactoring, and the behavior to preserve.

#### Scenario: Similar code implements independent rules
- **WHEN** two checks currently use the same value but express independently changing policies
- **THEN** the reviewer explains why duplication alone does not justify merging them and can conclude no change is warranted

#### Scenario: Duplicated domain decision
- **WHEN** several command handlers independently enforce the same permission rule
- **THEN** the review identifies the affected callers, the risk of inconsistent decisions, a shared owner for the rule, and relevant rejection behavior without editing files

### Requirement: Behavior-preserving edits
The refactorer SHALL establish passing public-behavior coverage for its intended scope before editing production code and follow the active repository's development and verification rules.

#### Scenario: Extraction changes control flow
- **WHEN** extracting checks could change which error wins when two conditions fail
- **THEN** the refactorer confirms passing coverage of that outcome before editing and reruns the checks after extraction

#### Scenario: Proposed validation changes accepted input
- **WHEN** replacing a cast with runtime validation would reject a previously accepted legacy record
- **THEN** the refactorer reports the behavior change separately and leaves it for a separately scoped red/green cycle

### Requirement: Selective delegation after green
After observing green, the implementing agent SHALL consider inline cleanup, a read-only second opinion, a bounded delegated edit, or completing the cycle without edits. The implementing agent retains final verification responsibility.

#### Scenario: Parent delegates an edit
- **WHEN** the parent hands off a bounded refactor
- **THEN** it provides the observed red and green evidence, test command, owned scope, and invariants, and avoids overlapping edits
- **AND** the specialist verifies green and reports changes, actual checks and gaps so the parent can inspect the diff and verify the result

#### Scenario: No justified cleanup
- **WHEN** the green implementation already meets the project rules and no concrete improvement is identified
- **THEN** the agent can finish the cycle without spawning a specialist or manufacturing edits

### Requirement: Portable skill and specialist access
Users SHALL be able to apply the same skill in Codex, GitHub Copilot CLI, Claude Code and Replit Agent. Codex, Copilot CLI and Claude Code SHALL expose a named refactorer for delegation. Replit SHALL support the same assignment inline and via a separate task.

#### Scenario: Native specialist invocation
- **WHEN** a parent in any of the three named-delegation targets delegates a read-only smell review to the refactorer
- **THEN** the named specialist applies the shared guidance and returns findings to its parent without modifying files

#### Scenario: Replit task handoff
- **WHEN** a contributor starts a separate Replit task with the refactoring handoff
- **THEN** the task can load the shared skill, verify the stated baseline in its own workspace, and return its findings or scoped edits for the contributor to review

#### Scenario: Compatibility reporting
- **WHEN** a contributor checks support for a host
- **THEN** the guidance distinguishes skill discovery, named delegation, and fallback execution, identifying which were exercised and any unverified paths
