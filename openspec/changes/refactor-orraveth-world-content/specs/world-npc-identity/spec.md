# Spec Delta

## Purpose

Protect NPC-addressed commands and persistent conversation progress by requiring unambiguous authored NPC identities throughout each world pack.

## ADDED Requirements

### Requirement: Authored NPC IDs are unique within a pack

World-pack validation SHALL reject repeated authored NPC IDs anywhere in the pack's locations, regardless of movement configuration, merchant status, or whether the occurrences share a location. Both schema parsing and direct graph validation SHALL detect these collisions.

#### Scenario: Duplicate static residents in different rooms
- **GIVEN** two static NPC definitions in different rooms have the same ID
- **WHEN** the pack is submitted to either public validation boundary
- **THEN** validation reports the duplicate NPC ID and rejects the pack as invalid

#### Scenario: Static and mobile identity collision
- **GIVEN** a static NPC and a mobile NPC share an ID
- **WHEN** the pack is validated with either NPC occurring first in location order
- **THEN** both validation boundaries report the collision

#### Scenario: Preserve mobile duplicate rejection
- **GIVEN** two mobile NPC definitions share an ID
- **WHEN** the pack is validated
- **THEN** the duplicate remains invalid
- **AND** movement-plan validation remains in effect

#### Scenario: Duplicate residents in one room
- **GIVEN** two NPC definitions in a single room have the same ID
- **WHEN** the pack is validated
- **THEN** the duplicate is rejected even if neither NPC is a merchant or mobile

### Requirement: Duplicate diagnostics identify the authored occurrence

Duplicate-NPC diagnostics SHALL identify the offending ID. Schema validation SHALL attach the issue to the later occurrence's NPC ID field so an author can locate the definition to correct. Graph validation SHALL return a readable duplicate-ID diagnostic.

#### Scenario: Locate a copied NPC definition
- **GIVEN** a pack contains a copied NPC ID in a later location
- **WHEN** schema validation reports that duplicate
- **THEN** its issue path points to the later location's NPC ID field
- **AND** the diagnostic includes the duplicated ID

#### Scenario: Validate an already constructed draft
- **GIVEN** an otherwise valid draft is modified to contain a duplicate NPC ID
- **WHEN** direct graph validation runs without reparsing the draft
- **THEN** its error list includes a readable diagnostic naming the duplicated ID

### Requirement: Uniqueness respects existing identity boundaries

NPC uniqueness SHALL be scoped to one authored world pack. Distinct NPC IDs with identical names or content SHALL remain valid, and separate packs SHALL be allowed to reuse an NPC ID. Existing rejection of collisions between road encounters and authored NPC IDs SHALL remain intact.

#### Scenario: Similar residents with distinct identities
- **WHEN** a pack contains two NPCs with distinct IDs but identical display names and other content
- **THEN** NPC identity validation accepts them

#### Scenario: Reuse an ID in independent packs
- **WHEN** two otherwise valid packs containing the same NPC ID are validated independently
- **THEN** neither is rejected because of the other pack

#### Scenario: Rooms without residents
- **WHEN** an otherwise valid pack contains rooms with empty or absent NPC lists
- **THEN** NPC identity validation accepts those rooms

#### Scenario: Preserve encounter identity protection
- **GIVEN** a road encounter uses the ID of an authored NPC in the same pack
- **WHEN** schema validation runs
- **THEN** the existing encounter/NPC collision rule still rejects the pack
