# Spec Delta

## Purpose

Allows authored readable objects to expose typed resource interactions while retaining ordinary text reading. Players reach the intended resource consistently through text commands and object actions without losing selected identity or bypassing authoritative resource access.

## ADDED Requirements

### Requirement: Readable actions are optional and semantic
Readable definitions SHALL support optional typed `readAction` metadata. The initial supported action SHALL be `{ type: 'daily-board', boardId }`. Omission SHALL preserve static-text reading. Actions MUST describe a resource without embedding browser-modal instructions, executable code, or arbitrary query payloads.

#### Scenario: Existing readable omits an action
- **WHEN** existing content defines a readable with its current identity, description, and text fields only
- **THEN** the content remains valid and reading the object retains its existing text behavior

#### Scenario: Unsupported action is authored
- **WHEN** readable metadata supplies an unsupported action type, missing target ID, or arbitrary execution fields
- **THEN** content validation rejects it with a diagnostic identifying the invalid action

### Requirement: Resource references are validated within their location
An authored daily-board read action SHALL reference an existing board by its exact ID in the readable's location. Content validation MUST reject missing or wrong-location references without inferring a replacement from labels or array order.

#### Scenario: Readable and board have different valid identities
- **GIVEN** a readable and a daily board have different IDs in the same location
- **WHEN** the readable explicitly references that board ID
- **THEN** the association is valid without renaming either entity

#### Scenario: Board reference is missing or belongs elsewhere
- **WHEN** a readable references a nonexistent board or a board authored in another location
- **THEN** world validation rejects the reference and identifies the readable and target

#### Scenario: Referenced board identity is duplicated
- **WHEN** multiple authored boards share the identity referenced by a readable action
- **THEN** validation rejects the ambiguous reference rather than choosing the first definition

### Requirement: Room projections preserve readable actions
Readable room projections SHALL preserve their supported authored read action alongside existing identity and readable capability. HTTP exposure SHALL follow negotiated client support. Readable objects without actions SHALL retain existing projection behavior. Changing a location's presentation state MUST NOT drop an inherited readable action.

#### Scenario: Linked board is visible in a room view
- **WHEN** a room containing an action-bearing readable is projected for a client supporting read actions
- **THEN** its object projection contains the readable's exact ID and exact typed resource target

#### Scenario: Location presentation state changes
- **GIVEN** a readable belongs to a location whose active presentation state changes
- **WHEN** that room is projected in the new state
- **THEN** the readable retains its authored action when it remains available

### Requirement: Resource reads preserve the selected target
Reading an action-bearing object SHALL use its current exact identity and declared target. For a daily-board action, the web client SHALL request the referenced board and open the existing daily-postings dialog. It MUST NOT substitute another board by display label or default array position.

#### Scenario: Orraveth bulletin is read through the action chooser
- **GIVEN** the player sees Orraveth's linked Bulletin board in the room description
- **WHEN** the player selects that object and chooses Read
- **THEN** the daily-postings dialog opens for its linked board rather than only printing generic readable text

#### Scenario: Multiple boards share a room or display name
- **GIVEN** two visible readable objects link to different local boards
- **WHEN** the player selects Read for the second object
- **THEN** the requested board is the second object's exact authored target regardless of labels or board ordering

### Requirement: Text and clickable reads share target resolution
Text Read commands resolving to an object by exact readable ID or unambiguous name SHALL execute the same declared action as clicking Read for that object. Supported generic bulletin aliases SHALL remain usable when they identify one local board. Ambiguous object names or board aliases MUST request disambiguation without dispatching a read for an arbitrary target.

#### Scenario: Exact object ID or unique name is typed
- **GIVEN** a visible readable has a daily-board action
- **WHEN** the player types Read with its exact ID or unique name
- **THEN** the same referenced board opens as for its object action

#### Scenario: Generic bulletin alias has one target
- **GIVEN** one eligible daily board is available locally and no exact object identity takes precedence
- **WHEN** the player submits a supported bulletin-reading alias such as `read bulletin` or `read board`
- **THEN** the alias opens that board through the same resource-reading behavior

#### Scenario: Text target is ambiguous
- **WHEN** a Read name matches multiple objects or a generic board alias identifies multiple eligible boards
- **THEN** the client requests a more specific target without sending an ordinary read or board request

### Requirement: Ordinary reading and inspection remain compatible
Reading an object without a declared action SHALL retain ordinary read-command, text-result, and read-event behavior. Look SHALL retain inspection behavior regardless of a readable's action. Browsing a linked daily board SHALL preserve existing daily-board browsing semantics without accepting/completing jobs or introducing ordinary read-progress events.

#### Scenario: Ordinary sign is read
- **WHEN** the player reads a sign without action metadata through text or the object chooser
- **THEN** its normal read command and text output occur without opening daily postings

#### Scenario: Linked bulletin is inspected
- **WHEN** the player chooses Look for a linked bulletin
- **THEN** its inspection description is shown without opening the daily-postings dialog

#### Scenario: Board is browsed without mutating progression
- **WHEN** a linked board's postings are opened
- **THEN** the read does not accept or complete a job or append an ordinary read-progress event

### Requirement: Resource reads respect current context and failures
Selected-object actions SHALL reject obsolete session, location, or object identity without substituting a same-named replacement. Board responses and errors SHALL apply only to their originating current context. Unavailable targets or failed queries MUST surface existing safe error behavior without opening an unrelated board or reporting a successful text read.

#### Scenario: Selected object disappears before Read
- **GIVEN** the object chooser was opened for an identified readable
- **WHEN** that object is removed or the player changes location before choosing Read
- **THEN** the selection is rejected as obsolete without dispatching a read for a replacement

#### Scenario: Player leaves while postings are loading
- **GIVEN** a linked board request is pending
- **WHEN** its world, character, or location context becomes obsolete before completion
- **THEN** the late response or error does not reopen the board dialog or overwrite the new context

#### Scenario: Board request fails or location access is rejected
- **WHEN** the authoritative board request fails or rejects access to its target
- **THEN** the existing safe error behavior is presented without silently opening another board or treating the action as an ordinary successful read

### Requirement: Existing clients and authority boundaries remain compatible
Adding read actions SHALL preserve existing readable fields and ordinary read command/result/event contracts. Clients without action metadata SHALL continue static reading. Board access and job mutations SHALL remain server-authoritative through their existing operations; projection metadata MUST NOT authorize an action by itself.

#### Scenario: Older projection has no action field
- **WHEN** the updated client receives a readable object without read-action metadata
- **THEN** it remains usable through the ordinary static-reading path

#### Scenario: Client requests a nonlocal board
- **WHEN** a client attempts to open a board outside its current authorized location
- **THEN** the authoritative operation rejects access regardless of any client-side action metadata

### Requirement: HTTP metadata is negotiated for strict legacy clients
Location-bearing HTTP responses SHALL include read-action metadata only when the client explicitly advertises a supported version. Clients without support or with an unsupported version SHALL receive the existing object shape. This rule SHALL apply consistently to game snapshots, location queries, and command-response locations; newer clients MUST tolerate older servers that omit the metadata.

#### Scenario: Cached legacy client requests a location
- **WHEN** a client sends no supported read-action capability on a location-bearing request
- **THEN** the response omits the new field and remains valid under the prior strict room-object schema

#### Scenario: Updated client requests all supported location paths
- **WHEN** a client advertises supported read-action metadata on snapshot, location-query, or location-bearing command requests
- **THEN** each response preserves the same supported action metadata for the same readable

#### Scenario: Unsupported capability version is supplied
- **WHEN** a client advertises an unsupported read-action metadata version
- **THEN** the response retains the legacy object shape without an unsupported action payload
