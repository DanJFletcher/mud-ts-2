# Spec Delta

## Purpose

Keeps recent session activity readable and responsive during long play sessions without breaking scroll navigation or optimistic action feedback.

## ADDED Requirements

### Requirement: Session history has finite retention
The client SHALL enforce a documented finite retention limit for settled activity entries, evicting the oldest settled entries first. Unresolved optimistic entries SHALL remain addressable until reconciliation, subject to the existing single foreground travel limit. History SHALL be isolated by world and character session.

#### Scenario: Retention limit is exceeded
- **WHEN** new settled entries take history beyond its configured retention limit
- **THEN** the oldest settled entries are evicted and recent entries retain their IDs and ordering
- **AND** the interface indicates that only recent session activity is retained

#### Scenario: History fills during unconfirmed travel
- **GIVEN** optimistic travel entries await confirmation
- **WHEN** settled entries exceed the retention limit
- **THEN** the optimistic entries remain available for replacement or rollback
- **AND** after reconciliation the settled-entry retention limit is applied again

#### Scenario: A different session becomes active
- **WHEN** the active world or character session changes
- **THEN** the new session does not display the previous session's activity history

### Requirement: History rendering remains bounded and navigable
The client SHALL render a finite window of retained activity entries in both the terminal and field notes. Players SHALL be able to navigate retained older entries using keyboard-accessible controls without mounting the full retained history.

#### Scenario: Review older retained entries
- **GIVEN** retained history exceeds the rendering window
- **WHEN** the player navigates to older activity
- **THEN** the requested retained entries are accessible while mounted activity rows remain within the configured window limit

### Requirement: New activity respects reading position
The client SHALL follow new activity when the player is at the latest entry and preserve the visible retained entry when reading older activity. It SHALL offer a return-to-latest control and avoid announcing old history as new activity when the rendering window changes.

#### Scenario: Activity arrives while reading older entries
- **GIVEN** the player is reading an older retained entry
- **WHEN** new activity arrives
- **THEN** the visible entry remains anchored if retained and a return-to-latest control becomes available

#### Scenario: The anchored entry is evicted
- **WHEN** retention removes the entry being read
- **THEN** the view moves to the oldest retained entry and indicates that earlier activity is no longer retained

#### Scenario: Window changes without new activity
- **WHEN** the player navigates to an older rendering window
- **THEN** assistive technology is not notified of those historical rows as newly received activity
