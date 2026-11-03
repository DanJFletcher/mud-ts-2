# Spec Delta

## Purpose

Keeps web application areas visually complete with explicit styling dependencies and predictable theme inheritance, so unrelated area styles and navigation history do not determine their appearance.

## ADDED Requirements

### Requirement: Application areas have complete styling dependencies
Each application area SHALL render its intended layout, controls, and interaction states using shared foundations and its own declared styles, without requiring rules owned exclusively by another area.

#### Scenario: Account and lobby without world styles
- **GIVEN** shared foundations and account/lobby styles are loaded, with world-specific styles excluded
- **WHEN** a player opens account or lobby content
- **THEN** its layout, typography, controls, and focus indicators match its normal application appearance

#### Scenario: World recovery controls without account styles
- **GIVEN** shared foundations and world styles are loaded, with account/lobby-specific styles excluded
- **WHEN** a world recovery state presents its action controls
- **THEN** the controls retain their intended layout and interaction styling

#### Scenario: Standalone encyclopedia without world styles
- **GIVEN** shared foundations and encyclopedia styles are loaded, with world-specific styles excluded
- **WHEN** a player opens the standalone encyclopedia
- **THEN** its navigation, search controls, and article layout are fully styled

### Requirement: Theme inheritance respects the active application context
The application SHALL preserve the selected light or dark preference across account, lobby, world, and encyclopedia views. Area-specific palettes SHALL retain their intended differences; embedded encyclopedia content SHALL inherit its host context while standalone content uses the shared application theme.

#### Scenario: Theme preference survives world entry and exit
- **GIVEN** a player selected either light or dark mode in the lobby
- **WHEN** the player enters a world and returns to the lobby
- **THEN** the selected preference remains active and persisted
- **AND** each area uses its intended palette for that preference

#### Scenario: Encyclopedia follows its host palette
- **GIVEN** the same light or dark preference is active
- **WHEN** a player opens encyclopedia content standalone and within world play
- **THEN** standalone content uses the shared palette and embedded content uses the world palette

### Requirement: Appearance does not depend on route visitation order
For the same theme, viewport, host context, and interface state, an area's computed appearance SHALL be equivalent whether opened directly or reached after other application areas. Loading another area's styles MUST NOT change the intended styling of the current area.

#### Scenario: Return after lazy encyclopedia loading
- **GIVEN** a player opens lobby content directly
- **WHEN** the player visits the encyclopedia and returns to the same lobby state
- **THEN** lobby layout, typography, and controls retain their original appearance

#### Scenario: Open encyclopedia after world play
- **GIVEN** a player has entered world play and then left it
- **WHEN** the player opens the standalone encyclopedia
- **THEN** its appearance matches a direct standalone load with the same theme and viewport

### Requirement: Style isolation preserves accessible interaction states
Area styling SHALL retain visible keyboard focus and reduced-motion behavior at narrow and wide viewport sizes, including controls whose appearance adapts shared components.

#### Scenario: Keyboard focus remains visible
- **WHEN** a player navigates account, lobby, world panels, and encyclopedia controls with the keyboard in either theme
- **THEN** focused controls retain visible focus indicators without clipping that hides the indicator

#### Scenario: Reduced-motion preference remains effective
- **GIVEN** the player requests reduced motion
- **WHEN** the player navigates between application areas or opens animated world content
- **THEN** reduced-motion styling remains effective after the area's styles load
