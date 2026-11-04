# Orraveth world editions

## Purpose

Let players select and enter a fresh Orraveth geography edition while existing characters retain their original world and progress.

## ADDED Requirements

### Requirement: Distinct selectable editions
The world picker SHALL distinguish the existing and rebuilt Orraveth editions by name and world identity, and explain that the rebuilt edition begins fresh character progress.

#### Scenario: First entry into rebuilt Orraveth
- **WHEN** a player with an existing-edition character selects rebuilt Orraveth
- **THEN** the rebuilt instance offers its own character roster and new characters start at the intended Bellwold spawn
- **AND** the player's existing-edition character remains available in its original world

### Requirement: World-scoped progress
The editions SHALL keep character, encounter and shared mutable world state scoped to their own world instances. Each edition SHALL load its own location-group geometry.

#### Scenario: Actions across editions
- **WHEN** a character moves, completes a quest or changes shared state in rebuilt Orraveth
- **THEN** the original edition's characters and mutable state are unaffected
- **AND** each map query uses the selected edition's locations and groups

### Requirement: Continued access to the existing edition
Players SHALL be able to re-enter their existing Orraveth characters with their prior locations and progress after the rebuilt edition is introduced.

#### Scenario: Re-enter original world
- **WHEN** a player returns to an original-edition character after visiting the rebuilt edition
- **THEN** the original location, inventory and quest progress remain usable under the original layout
