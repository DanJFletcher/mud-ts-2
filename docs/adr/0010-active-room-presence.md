# ADR 0010: Active room presence

- **Status:** Accepted for the first active-room presence slice
- **Date:** 2026-10-19

## Context

`world_sessions` binds one account to one character in a world instance, but the row persists until the player explicitly leaves. It therefore identifies the character selected for a resumable world session, not whether the player is currently online. Treating every row as online would leave stale occupants after a browser closes or loses connectivity.

The location projection already has an `occupants` field. The selected feature is to show currently online characters in the same room, without introducing shared item ownership or shared mutable NPC state.

## Decision

- Keep `world_sessions` as the durable resumable session binding. A stale presence lease does not delete or revoke the world session.
- Add `last_seen_at` to the world-session row as presence metadata. A client sends a server-authorized heartbeat every 30 seconds while its world client is mounted and when it returns to a visible tab.
- A session is considered online for room display only if its last heartbeat is no more than 90 seconds old.
- Resolve each fresh session's current location from its character event stream. The character stream remains authoritative for movement; presence does not write or duplicate location state.
- Return only other, non-archived, living characters whose current location matches the viewer's room. Use character ID and character display name only; do not expose account IDs or authentication identity.
- Include this list in the existing `LocationProjection.occupants` field for both the initial game snapshot and `look` queries. The client refreshes this projection at the heartbeat interval and displays a compact room-presence line.
- Presence is an eventually consistent read projection. Entry appears on the next refresh; a disconnected session may remain visible for up to 90 seconds. The heartbeat endpoint is authenticated, limited, and scoped to the caller's existing session.
- Backfill existing `last_seen_at` values from `created_at` in an additive migration. Existing clients that remain open refresh their heartbeat after the new client code loads; existing world-session rows and character histories are not deleted or rewritten.

## Consequences

- Two or more accounts in the same world instance and room can see each other's character names; characters in other rooms remain hidden.
- One account still has only one active character per world instance. Presence does not enable multiple characters in one session.
- Personal inventory, wallet, combat, quests, and movement authority remain unchanged. Current takeables remain character-instanced under ADR 0002.
- The initial projection reads fresh session rows and their character streams. This is intentionally small for the current world; add a rebuildable location/presence projection or batching only if measured load requires it.
- This is not a websocket subscription. UI updates are bounded by the 30-second refresh interval and 90-second lease.

## Alternatives considered

- **Treat every unclosed world session as online:** rejected because closed or disconnected browsers can leave characters appearing indefinitely.
- **Delete a world session when its heartbeat expires:** rejected because it would destroy the existing resume behavior and conflate connectivity with the selected character.
- **Persist a separate shared occupant list:** rejected because it duplicates current location and risks drifting from committed movement events.
- **Add a websocket/presence service now:** deferred. Polling the existing typed location query is sufficient for this initial feature and can be replaced without changing ownership.

## Verification requirements

- Two different accounts with active sessions in one room see each other's character names; neither sees an occupant in another room or world instance.
- A character is excluded from its own “other travelers” list.
- Movement changes the room in which the character is listed after the next refresh.
- A heartbeat older than 90 seconds does not appear; a fresh heartbeat does.
- Archived and permanently defeated characters do not appear.
- Heartbeat requests cannot create or switch a world session and cannot refresh another account's session.
- The existing one-active-character-per-account/world constraint remains enforced.
