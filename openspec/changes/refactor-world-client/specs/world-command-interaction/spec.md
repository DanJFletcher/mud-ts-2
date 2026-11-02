# Spec Delta

## Purpose

Provides consistent world actions through text and clickable controls while preserving selected entity identity and respecting modal interaction.

## ADDED Requirements

### Requirement: Clickable actions preserve selected identity
The client SHALL dispatch clickable entity actions using the selected entity's stable identity and context. Display labels MUST NOT be reparsed to choose a different entity. A stale selection SHALL be rejected or refreshed without substituting a matching label.

#### Scenario: Two carried items share a label
- **GIVEN** two items share a display label but have different IDs
- **WHEN** the player chooses an action for the second identified item
- **THEN** the dispatched action targets that item's ID

#### Scenario: Selected entity disappears
- **GIVEN** the player opened actions for an identified entity
- **WHEN** that entity is no longer available at submission time
- **THEN** the client reports that the selection is stale without acting on a same-named replacement

### Requirement: Text commands retain compatible behavior
The client SHALL preserve existing command syntax, aliases, help topics, validation feedback, and server-authoritative execution. Text and clickable actions resolving to the same intent SHALL use the same execution path. Ambiguous text labels MUST NOT silently select the first entity; exact stable IDs SHALL resolve uniquely.

#### Scenario: Existing alias is submitted
- **WHEN** the player submits a supported alias such as get instead of take
- **THEN** it resolves to the same action and validation behavior as its canonical command

#### Scenario: Exact label is ambiguous
- **GIVEN** two eligible objects have the same exact label
- **WHEN** the player names that label in a text command
- **THEN** the client requests disambiguation without sending an action for either object

#### Scenario: Help remains aligned with dispatch
- **WHEN** the player requests general help or help for a supported command or alias
- **THEN** the documented syntax and alias behavior agree with accepted commands

### Requirement: Modal interaction suppresses movement shortcuts
The client SHALL suppress world movement shortcuts while a modal is open or keyboard focus belongs to a modal or editable control. Closing a modal SHALL restore normal shortcut eligibility without bypassing existing combat, posture, or pending-action restrictions.

#### Scenario: Arrow key on a dialogue button
- **GIVEN** a world interaction dialog is open and a button has focus
- **WHEN** the player presses an arrow movement key, including a vertical movement modifier
- **THEN** no world movement command is dispatched

#### Scenario: Gameplay resumes after dismissal
- **GIVEN** the dialog has closed and focus is on the eligible gameplay surface
- **WHEN** the player presses a movement key with an available exit and no action restriction
- **THEN** the normal movement behavior occurs
