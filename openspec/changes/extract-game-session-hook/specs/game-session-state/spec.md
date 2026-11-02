# Spec Delta

## Purpose

Keeps the client-visible game state aligned with authoritative server updates across commands, realtime events, and background refreshes.

## ADDED Requirements

### Requirement: Game state reconciliation preserves the newest authoritative state
The client SHALL apply command results and server snapshots without replacing newer game state with an older result.

#### Scenario: Command result is older than a known character update
- **GIVEN** the client has observed a character revision newer than the command result
- **WHEN** the command result is reconciled
- **THEN** the client fetches an authoritative game snapshot instead of applying the older result

#### Scenario: Command result has no usable game projection
- **WHEN** a successful command does not provide a usable game projection
- **THEN** the client fetches an authoritative game snapshot before presenting the resulting game state

### Requirement: Background refreshes cannot overwrite state across an action
The client SHALL reject a background snapshot result when a player action began after that refresh was started.

#### Scenario: Refresh completes while an action is pending
- **GIVEN** a background snapshot refresh started before a player action
- **WHEN** that refresh completes while the action is pending
- **THEN** the client does not apply the refresh result

#### Scenario: Refresh completes after an action
- **GIVEN** a background snapshot refresh started before a player action
- **WHEN** that refresh completes after the action has finished
- **THEN** the client does not apply the refresh result
