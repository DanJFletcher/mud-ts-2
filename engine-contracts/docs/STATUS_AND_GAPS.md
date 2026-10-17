# Contract status and open decisions

## Implemented Milestone 1 surface

- Version-1 command/query/event envelope, guest character creation, character movement and room projection are validated with Zod at the server boundary.
- The plugin host, in-memory event store, PostgreSQL adapter, typed HTTP client and three-room content fixture implement the first playable path.
- Chat, combat, network streams, authoring, and optional content modules remain draft shapes until they have runtime behavior and integration tests.
- Contracts are internal to this repository and are not published or frozen as a public API.

## Before freezing broader v1

## Before freezing v1

1. Decide ID format (generic strings vs UUID/ULID/branded domain IDs) without breaking clients.
2. Decide the aggregate boundary and who is responsible for constructing final event metadata.
3. Confirm whether `expectedVersion` is mandatory on all writes or only mutable aggregate operations.
4. Define transactional idempotency key scope and mismatched-payload failure code.
5. Decide trusted identity/session model and guest identity expiration.
6. Define plugin version-range parsing and capability token compatibility.
7. Define query errors/consistency (`projection-not-ready`, revision/cursor), viewer permissions and hidden info.
8. Define remote auth, WebSocket envelopes, source-ordered subscription cursor and snapshot race handling.
9. Decide world definition formats, import permissions and content version migration.
10. Select ruleset plugin API before implementing nontrivial combat; maintain combat coordinator/ruleset split.
11. Confirm the long-term account provider and whether local-only mode is still needed alongside the Postgres server.

These are deliberately exposed as open questions to avoid creating the illusion of an approved contract library.
