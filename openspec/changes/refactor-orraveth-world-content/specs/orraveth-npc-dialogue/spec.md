# Spec Delta

## Purpose

Keep Orraveth's quest conversations accessible as players explore incidental dialogue, and route authored ferry-stage questions to the intended passage information.

## ADDED Requirements

### Requirement: Anwen quest access is independent of town small talk

Anwen Marr SHALL offer otherwise eligible acceptance and turn-in choices for The Mill Ledger and The Church Reliquary regardless of whether the character has asked what Bellwold is like. Access SHALL NOT require restarting the conversation.

#### Scenario: Ask about town before accepting either quest
- **GIVEN** a character has not accepted either quest
- **WHEN** the character asks Anwen what Bellwold is like and requests the available dialogue choices
- **THEN** both quest acceptance choices remain available and executable
- **AND** the normal town follow-up dialogue remains available

#### Scenario: Finish a quest after asking about town
- **GIVEN** a character has accepted either quest and subsequently asked Anwen what Bellwold is like
- **WHEN** the character completes that quest's objectives and returns to Anwen
- **THEN** its turn-in choice is available and executable without restarting the conversation
- **AND** completion and rewards follow the existing quest rules

#### Scenario: Resume an existing character in the town branch
- **GIVEN** saved character progress already contains Anwen's town-question flag and an active quest with completed objectives
- **WHEN** that character's dialogue is projected after loading the updated world
- **THEN** the eligible turn-in choice is available without migrating or clearing saved progress

### Requirement: Quest eligibility and reward safety survive dialogue changes

Making Anwen's quest actions independent of small talk SHALL preserve authoritative quest eligibility, one-time rewards, and item identity. Restarting a conversation SHALL NOT permit duplicate quest acceptance, completion, or rewards.

#### Scenario: Incomplete objectives remain gated
- **GIVEN** a character has asked Anwen about town and has an active quest with incomplete objectives
- **WHEN** the character requests dialogue or submits that quest's turn-in choice directly
- **THEN** the turn-in choice is not offered and direct submission is rejected without completion or reward events

#### Scenario: Repeat a completed quest action
- **GIVEN** a character has completed either quest through Anwen's dialogue
- **WHEN** the character restarts the conversation or retries the completed action
- **THEN** the quest cannot be accepted or rewarded again

#### Scenario: Return the recovered sword
- **GIVEN** a character holds the recovered reliquary sword and has completed the church quest's objectives
- **WHEN** the character turns in the quest after asking Anwen about town
- **THEN** the character receives the existing 20-gold reward once and retains the same sword identity

### Requirement: Ferry-stage questions return passage information

The Independent Boatman's authored topic routing SHALL distinguish questions about the ferry stage from questions about the ferry guild or its dispute. These queries SHALL retain the existing passage and dispute response texts respectively.

#### Scenario: Ask about the ferry stage
- **WHEN** a character asks the Independent Boatman about "ferry stage"
- **THEN** the response explains passage and current passenger availability
- **AND** it is not the guild-dispute response

#### Scenario: Ask about the ferry guild dispute
- **WHEN** a character asks the Independent Boatman about "ferry guild" or "ferry dispute"
- **THEN** the response describes the dispute over exclusive rights

#### Scenario: Ask generally about the ferry
- **WHEN** a character asks the Independent Boatman about "ferry"
- **THEN** the response gives passage information rather than assuming a question about guild politics

#### Scenario: Preserve other established topic routes
- **WHEN** a character asks the Independent Boatman about "Silverfin", "passage", or "current"
- **THEN** each query returns its existing corresponding response
