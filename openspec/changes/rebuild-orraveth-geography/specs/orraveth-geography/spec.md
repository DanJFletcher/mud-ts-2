# Orraveth geography

## Purpose

Give players a coherent terrain-driven Orraveth region while retaining the people, creatures and activities already authored for the world.

## ADDED Requirements

### Requirement: Preserved authored activities
The rebuilt edition SHALL retain every existing authored NPC, creature profile, quest, dialogue, item, reward, service and progression prerequisite. Geography-dependent placements and directions SHALL have reviewed bindings to the new layout.

#### Scenario: Existing quests in the new geography
- **WHEN** a new character follows the mill, church and inter-town grain quests
- **THEN** the same clues, prerequisite checks, branches and rewards remain available through the new routes
- **AND** return visits cannot duplicate one-time rewards

#### Scenario: Reassigned patrol and encounters
- **WHEN** the new layout is traversed and its mobile NPCs advance
- **THEN** retained NPCs have valid itineraries and the retained creature profiles and loot appear on their reviewed road sections

### Requirement: Terrain-led regional layout
The rebuilt map SHALL follow a reviewed terrain and drainage plan for the existing playable region, including settlement interiors and underground areas. Essential places SHALL remain reachable according to their existing access prerequisites.

#### Scenario: New regional journeys
- **WHEN** a player travels from Bellwold to each existing neighboring settlement
- **THEN** connected, directionally consistent routes lead to the destination through geography described in the design
- **AND** alternate routes and gated locations retain their reviewed access conditions

### Requirement: Natural river geography
Orraveth authoring guidance SHALL explain how rivers follow and shape their valleys. The rebuilt Lower Rill SHALL express bends and hooks appropriate to the reviewed terrain, with bank and floodplain features that explain nearby roads and settlements.

#### Scenario: A lowland river bend
- **WHEN** a player inspects a designed lowland bend and its approaches
- **THEN** its map shape and descriptions agree about the channel, outer bank and inner-bank deposition
- **AND** a crossing or landing has an explicit geographical reason for its placement

#### Scenario: River course review
- **WHEN** the regional drainage design is reviewed
- **THEN** its downstream direction, tributary connections and gradients are documented and supported by the terrain plan
- **AND** proposed geography from the supplied illustrations is identified for review

### Requirement: Measured overland itineraries
Authors SHALL measure intended overland journeys against the approximate 48-move fictional-day convention and document terrain-based exceptions and shorter alternatives before release.

#### Scenario: One-day destination
- **WHEN** a one-day itinerary is checked
- **THEN** the report identifies endpoints, intended and shortest legal walking routes, and the move count against the approximate 48-move target
- **AND** any deviation has a reviewed explanation and pacing evidence

### Requirement: Water and gated access
The rebuilt edition SHALL enforce existing water-entry, bridge, ferry and quest-gate restrictions through authoritative commands.

#### Scenario: Dry bridge crossing
- **WHEN** an eligible walker crosses the bridge on its dry surface
- **THEN** the crossing succeeds while entry into restricted open water remains rejected

#### Scenario: Ferry stage
- **WHEN** a walker reaches the Rillford ferry stage
- **THEN** the stage does not grant an unauthored ferry passage or bypass a water restriction
