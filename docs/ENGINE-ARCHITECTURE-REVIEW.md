# MUDD engine architecture review

- **Status:** Current-state review and proposals; no runtime or gameplay changes made.
- **Reviewed:** 2026-10-19
- **Baseline:** Current workspace checkout. The attached repository audit was generated from an older GitHub revision and is treated as a list of hypotheses, not evidence that the current checkout still has those defects.

## Executive summary

MUDD is currently a modular TypeScript monolith with a server-authoritative, event-sourced character model. The workspace already has useful boundaries: shared Zod contracts, an engine host and store port, first-party plugins, a PostgreSQL adapter, a separate HTTP SDK, and a mobile-first React PWA with Storybook components. The evidence does not support a wholesale rewrite.

The three confirmed audit bugs have regression coverage and are fixed in the current checkout: chat acknowledgements no longer move the polling cursor, successful movement retries do not rerun NPC entry announcements, and plugin dependency checks compare the supported exact/caret ranges correctly. Other audit concerns were either addressed since the audited revision or were recommendations rather than demonstrated runtime failures.

The main architectural boundary still awaiting a product decision is shared mutable world state. Current items, wallets, combat, and progression are character-scoped. That is coherent for the current solo/instanced demo; it is not a shared-MUD ownership model. ADR 0002 already defers shared items. A proposal for a more general ownership model is in [ADR proposal 0009](adr/proposals/0009-shared-world-authority.md); it is not accepted and must not be read as an implementation decision.

## Current capability inventory

| Capability | Status | Current boundary and evidence |
|---|---|---|
| Versioned commands, events, projections, and wire validation | **Implemented** | `engine-contracts/src/` provides Zod schemas; `packages/engine-core/src/engine.ts` validates command inputs and `replay.ts` validates supported events and contiguous revisions. Unknown event types fail closed. |
| Engine host, plugin registration, lifecycle, and capabilities | **Implemented, trusted in-process** | `packages/engine-core/src/` defines the live `EnginePlugin`, command/query/effect registries, capability tokens, dependency ordering, and `EngineHost`. Plugin code is not sandboxed. |
| Character event streams, expected revisions, receipts, and idempotency | **Implemented** | `EventStorePort` has in-memory and PostgreSQL adapters. The PostgreSQL append transaction stores events, command receipt, and durable-effect intents together. |
| Durable event effects | **Implemented** | `apps/server/src/persistence/postgres-event-store.ts`, `demo-event-effects-plugin.ts`, and [ADR 0004](adr/0004-durable-event-effects.md) implement at-least-once delivery, leases, retries, dead-lettering, and idempotent consumers. Operator inspection/replay controls remain absent. |
| Account and character management | **Implemented** | Clerk identity resolves to a server-owned player record. An account can retain multiple characters but has at most one active character per world instance. See `apps/server/src/session-service.ts`, `apps/server/src/index.ts`, and `docs/ARCHITECTURE-M1.md`. |
| Items, wallet, quests, combat, and health | **Implemented as character-scoped state** | These facts replay from the character stream. Authored item definitions and NPC/shop content remain world-pack data. ADRs 0002 and 0005–0007 explicitly keep the current slices character-scoped. |
| Shared room chat and NPC room announcements | **Implemented as a separate durable feed** | `room_chat_messages` is intentionally outside character progression. `room-chat-service.ts` revalidates current session/location under the same stream lock used by movement; message IDs are ordered under a room lock. See [ADR 0003](adr/0003-room-chat-persistence-boundary.md). |
| World occupancy and globally unique physical items | **Deferred** | Room occupants are not yet a shared presence projection, and takeables are character-instanced. The engine does not yet arbitrate one physical item across characters. |
| Client SDK and mobile PWA | **Implemented** | `packages/client-sdk/src/index.ts` is React-independent and parses core response shapes with Zod. `apps/web` uses it alongside a few direct feature-specific requests, including room chat. `packages/ui` remains presentation-focused and Storybook-backed. |
| Plugin API stability | **Experimental internally; external API proposed** | The live plugin interface is used by first-party code in a private 0.1 workspace. No third-party compatibility promise or sandbox is established; the separate `GamePlugin` contract remains a proposal. |
| Third-party plugin execution and permission enforcement | **Not implemented; do not imply it is** | The runtime executes trusted code in-process. Manifest `permissions` are metadata, not sandbox grants. `engine-contracts/src/plugins.ts` also contains a separately described `GamePlugin` proposal; the live runtime uses `EnginePlugin` from `packages/engine-core/src/types.ts`. |
| Content-pack import/version migration pipeline | **Deferred** | The demo world is validated as a code-authored pack; there is no general import, provenance, or live content migration system. |
| TTY client, multiple simultaneous characters in one session, shared NPC health/combat, and shared shop stock | **Out of scope / deferred** | None is required to preserve the current one-active-character-per-world-session rule. |

“Implemented” describes the present vertical slice, not a promise that the corresponding capability is generalized for multiple production worlds or untrusted extensions.

## Attached-audit findings checked against this checkout

| Audit finding | Current result | Evidence and interpretation |
|---|---|---|
| Chat polling cursor could skip a message when a send acknowledgement advanced it | **Fixed and regression-tested** | `apps/web/src/RoomChatPanel.tsx` advances `lastMessageIdRef` only from polled history; send acknowledgements are merged into display state without moving the cursor. `apps/web/src/RoomChatPanel.test.tsx` covers an unseen message arriving before a send acknowledgement. |
| Retried movement could repeat NPC entry announcements | **Fixed and regression-tested** | `EngineHost.dispatch` returns the prior receipt/events for an idempotent command before rerunning the handler. Movement effect intent is atomically stored with the event/receipt and has a stable deduplication path. `apps/server/src/npc-room-announcement.integration.test.ts` verifies retrying the same successful move does not rerun the announcement; that HTTP-level test uses test doubles, while `postgres-event-store.integration.test.ts` separately checks database-backed atomicity/idempotency in CI. |
| Plugin dependency matcher accepted incompatible versions | **Fixed for the documented subset** | `packages/engine-core/src/engine.ts` parses stable `x.y.z` versions and correctly evaluates exact, `*`, and caret ranges, including zero-major rules. `engine.test.ts` covers compatible and incompatible cases, cycles, and unsupported `~` syntax. The runtime intentionally does not claim full npm-semver syntax. |
| Character-only items and empty shared occupancy could be mistaken for shared simulation | **Confirmed capability limit, intentionally deferred** | `packages/plugins/src/character.ts` and `replay.ts` keep item state in character streams. [ADR 0002](adr/0002-world-item-aggregate-ownership.md) documents the current boundary and required decision before shared items. This is not a defect in the stated solo/instanced slice. |
| Chat bypasses the engine command/event stream | **Confirmed fact, now an explicit boundary** | Chat uses its own table and transaction model by design. [ADR 0003](adr/0003-room-chat-persistence-boundary.md) documents ordering, room authorization, retry semantics, and interaction with movement. It should not be migrated into character streams solely to make all writes look alike. |
| Rule failures and infrastructure failures could be conflated or leak error text | **Addressed in the current path** | `packages/engine-core/src/domain-error.ts` identifies rule violations; `engine.ts` returns safe internal-error text with a correlation ID for unexpected failures. The server's final error middleware logs request IDs and returns a generic response. Keep tests around this boundary as errors evolve. |
| Production host/origin/body/abuse protections were missing | **Mostly addressed; one scale limit remains** | `apps/server/src/request-security.ts`, `apps/server/src/index.ts`, and `docs/SECURITY.md` show exact-origin checking, production trusted-host configuration, bounded JSON, request IDs, and limits on chat/command posts. The limiter is in-memory and per process, not a cluster-wide quota. |
| PostgreSQL behavior and CI were unverified | **CI and integration coverage now exist; local real-DB run unavailable** | `.github/workflows/ci.yml` provisions PostgreSQL 16, migrates, and runs the suite. `apps/server/src/postgres-event-store.integration.test.ts` covers real persistence, concurrency/idempotency, effects, and chat ordering. In this review, `MUDD_TEST_DATABASE_URL` was not configured, so five PostgreSQL tests were skipped locally; no claim is made that this run exercised PostgreSQL. |
| Replay could silently ignore unknown events | **Fixed and regression-tested** | `packages/engine-core/src/replay.ts` rejects unsupported event types and revision gaps; `replay.test.ts` covers both. |
| Snapshot reads could use inconsistent character revisions | **Addressed in the current game snapshot path** | `/api/game` reads/replays the character once, passes that projection to `engine.query`, and derives the map from the same projection. The character-state capability uses the supplied projection rather than rereading the stream. |
| SDK responses were not runtime-validated | **Addressed for SDK methods; partial gap outside the SDK** | `MuddHttpClient.request` parses its response through a Zod schema. `RoomChatPanel` still makes direct `fetch` calls and uses TypeScript casts plus manual checks rather than a shared Zod response contract. This is a narrow contract-hardening opportunity, not evidence of a current production failure. |
| Architecture documentation still described guest-only access | **Stale claim corrected** | `docs/ARCHITECTURE-M1.md` now documents Clerk accounts, multiple managed characters, and the one-active-character-per-world-session rule. |
| Fullscreen modal surfaces lacked focus containment | **Implementation is now present** | `RoomChatPanel` and `WorldMapPanel` use `trapDialogTab`, focus the close control, and restore focus when leaving fullscreen. Keep keyboard and reduced-motion checks with future changes. |
| Both npm and pnpm lockfiles were tracked | **Not present in this checkout** | The root uses npm workspaces and `package-lock.json`; the separate mockup artifact has its own `package-lock.json`. No `pnpm-lock.yaml` is present. |
| Shared item ownership, plugin trust, multi-client occupancy, deterministic clock/RNG, and content import need future decisions | **Recommendations, not confirmed runtime failures** | Shared item ownership is deferred by ADR 0002. Plugins are explicitly trusted in-process. The remaining capabilities should be scoped when product work requires them; they do not justify broad changes in this review. |

## Confirmed gaps and approval decisions

1. **Shared mutable state:** review and accept/revise ADR proposal 0009 before any shared item, occupancy, NPC health, or shared stock implementation.
2. **Plugin public contract:** decide whether to keep third-party plugins out of scope or converge the separate proposed contract with the live engine contract. Do not describe manifest permissions as sandboxing.
3. **Chat response typing:** decide whether to export Zod response schemas for the direct room-chat client path.
4. **Rate-limit scope:** the present process-local limit is adequate only as a per-process guard. Use shared storage if multi-process/global quotas become a requirement.
5. **Effect operations:** before effects govern critical progression, add operator visibility and safe inspection/replay controls; delivery is at-least-once, not exactly-once.

## Verification performed

- `npm test` — passed. Contracts: 16; engine: 26; SDK: 20; UI: 8; server: 24 passed and 5 skipped; web: 51. The five skipped tests are the PostgreSQL integration tests because `MUDD_TEST_DATABASE_URL` was not configured.
- `npm run typecheck` — passed across all workspaces.
- `npm run lint` — passed.
- `npm run build` — passed across contracts, world content, engine, plugins, SDK, UI, server, and web.
- `npm run storybook:build` — passed.
- Both production web and Storybook builds report large-chunk warnings. They are build warnings, not failures; code splitting can be considered separately.
- No database migration or runtime database command was run against an unspecified database.

This review did not reproduce the application against a production database or deployed origin. It verifies the current source and the available automated tests, and does not turn static audit observations into claims of production incidents.
