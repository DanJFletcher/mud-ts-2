# Spec Delta

## Purpose

Keeps world feature requests, timed gathering, and action feedback consistent with the active player session throughout asynchronous work.

## ADDED Requirements

### Requirement: Feature results belong to their originating context
The client SHALL discard feature results and errors whose world, character, lifecycle generation, or feature-specific location/action context is no longer current. Obsolete work MUST NOT update current feature state or append current-session narration.

#### Scenario: Delayed party response after switching character
- **GIVEN** a party request began for one character
- **WHEN** another character becomes active before it completes
- **THEN** its response and errors do not alter the new character's party state or history

#### Scenario: Location-specific result arrives after travel
- **GIVEN** a dialogue, inspection, merchant, or bulletin request belongs to the previous room
- **WHEN** it completes after the player leaves that room
- **THEN** it does not reopen obsolete UI or overwrite current room state

#### Scenario: Superseded feature read completes last
- **GIVEN** a newer read has supplied the current state for a feature
- **WHEN** an older read completes
- **THEN** the older result does not replace the newer feature state

### Requirement: Gathering scheduling ends with its owner
The client SHALL cancel pending gathering schedules when the owning session ends or the action changes, completes, or is cancelled. In-flight completions from obsolete owners MUST NOT schedule retries or apply results. At most one advancement request per active gathering action SHALL be in flight.

#### Scenario: Leave while a retry is waiting
- **GIVEN** fishing or woodcutting has a retry scheduled
- **WHEN** the player leaves the world before it runs
- **THEN** the retry sends no request, including after another world is entered

#### Scenario: Cancellation during an advancement request
- **GIVEN** an advancement request is in flight
- **WHEN** its action is cancelled before the response arrives
- **THEN** the response neither restores the action nor schedules another advancement

#### Scenario: Recovery and due-time triggers coincide
- **WHEN** multiple scheduler triggers fire for the same active action
- **THEN** at most one advancement request is sent until that request settles

### Requirement: Retry decisions use authoritative action state
The client SHALL use available structured error codes and authoritative action identity and timing to determine gathering retries. Unknown failures SHALL trigger a guarded refresh before retrying; terminal or obsolete actions MUST NOT be blindly replayed.

#### Scenario: Error wording changes
- **GIVEN** a recoverable response has unchanged structured information and action timing
- **WHEN** its human-readable message changes
- **THEN** retry behavior remains unchanged

#### Scenario: Refresh cannot confirm an action
- **WHEN** recovery cannot obtain authoritative state after an unknown advancement failure
- **THEN** automatic advancement waits for a subsequent valid session update rather than recursively replaying the failed command

### Requirement: Action execution and pending feedback have distinct lifetimes
The client SHALL prevent incompatible foreground actions from overlapping and reject background results that cross an action boundary. Pending feedback MAY remain after execution finishes while authoritative confirmation is outstanding; feedback alone MUST NOT prevent confirmation refreshes.

#### Scenario: Movement is acknowledged but unconfirmed
- **WHEN** movement finishes its request while the destination remains unconfirmed
- **THEN** confirmation refreshes can run while incompatible controls remain unavailable
- **AND** a retry of the same uncertain movement preserves its command ID

#### Scenario: Rapid duplicate submission
- **WHEN** an incompatible action is submitted twice before the next UI update
- **THEN** only one foreground execution starts and its completion cannot release another execution's coordination state
