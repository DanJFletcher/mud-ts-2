# ADR 0031: Explicit world entry and account-owned recency

Status: Accepted

## Context

The lobby lists worlds and recent characters without entering gameplay. Guest and
signed-in identities use the same character roster and world-session endpoints.
Characters remain permanently bound to their existing world instance (ADR 0022).

## Decision

- Add nullable `characters.last_played_at` account-index metadata. Update it in
  the successful world-entry transaction, including explicit resumes of the same
  character, after checking ownership, world, archive state and session occupancy.
  Rejected entries, browsing and heartbeats do not update it. Historical rows stay
  null; they are not presented as recently played.
- This is account navigation metadata, not gameplay state, so no gameplay events
  or replay schemas change. Keep location-entered effects idempotent on resume.
- Public lobby and world-detail URLs never create a guest or join a world.
  Guest identity is created only after an explicit guest action. Authentication
  returns to a validated same-app world detail/creation intent, not straight into
  gameplay.
- An occupied world requires explicit leave-and-switch or return to the existing
  character. Leaving is scoped to that world, never all of an account's sessions.
- World descriptions and cover presentation are optional server catalog metadata,
  not kernel/ruleset requirements. New SDK fields remain backward-compatible.

## Consequences

Recent character ordering is shared across devices for an account. Existing data
and sessions remain valid. Character creation and joining remain two operations:
the UI retains a successful creation if entry fails and retries entry, not creation.
Client routes support a configurable app base path; authentication return paths
must be internal and limited to lobby/world browsing routes.
