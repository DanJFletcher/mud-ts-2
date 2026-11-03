# ADR 0045: Typed readable actions

## Decision

Readables may declare `readAction: { type: 'daily-board', boardId: 'board-id' }`.
The full-world graph validator requires a unique board in the readable's location.
Omission preserves normal text reading; text remains required for legacy clients.
The room projection carries this semantic resource affordance, not instructions to
open a browser modal. Additional variants require explicit schemas and handlers.

Daily-board reading uses the existing authoritative query and does not send an
ordinary read command or create read-progress events. Look remains inspection.
Ordinary read commands, results and events are unchanged. No UI effect is persisted.

## Compatibility

Updated SDK clients opt in with `readableActions: true`, advertising
`x-mudd-readable-actions: 1` on common HTTP requests. This is independent of command
projection opt-in: older clients already consume command projections with strict
room-object schemas. HTTP boundaries omit `readAction` for absent/unsupported
versions on snapshots, location queries and both command projection fields.
Internal projections stay complete and are never mutated for compatibility.

World-loading code must support the optional field before updated content is loaded.
No database migration is required. Cached old clients continue receiving the prior
payload; newer clients tolerate older servers omitting actions.
