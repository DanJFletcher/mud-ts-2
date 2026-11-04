# Spec Delta

## Purpose

Defines how the world map and minimap retain and update focus while a traveler moves between rooms, without revealing locations that remain undiscovered.

## ADDED Requirements

### Requirement: Map focus stays on a represented location during travel
The client SHALL keep the map focus on a location represented in the current map projection. During optimistic travel to a destination absent from that projection, the map SHALL retain the last authoritative current location as focus until an updated projection includes the destination.

#### Scenario: Optimistic travel targets an unvisited room
- **GIVEN** the destination is not represented in the current map projection
- **WHEN** the client begins optimistic travel to that destination
- **THEN** the minimap remains focused on the last authoritative current room and does not jump to an unrelated map location or reveal the destination

#### Scenario: Optimistic travel targets a represented room
- **GIVEN** the destination is already represented in the current map projection
- **WHEN** the client begins optimistic travel to that destination
- **THEN** the minimap may focus on the destination while travel is pending

#### Scenario: The authoritative projection includes the destination
- **GIVEN** the minimap retained the current room while an unvisited destination was absent
- **WHEN** an authoritative projection includes the destination as the current location
- **THEN** the minimap focuses on the destination

#### Scenario: Travel is rejected
- **GIVEN** optimistic travel is pending to a destination absent from the current map projection
- **WHEN** the move is rejected and the authoritative location remains unchanged
- **THEN** the minimap remains focused on the authoritative current room
