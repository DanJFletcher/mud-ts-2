# MUDD — Engine Contracts

> **Status: internal, version-1 contract package.** Character creation, movement, room projections and plugin manifests are used by the Milestone 1 engine. Other draft modules remain proposals until implemented and tested.

This package preserves the source references under `originals/` and holds the shared Zod contracts used at the engine trust boundary. Its contract catalog distinguishes implemented Milestone 1 behavior from draft future interfaces; an exported type alone does not imply a shipped feature.

## Directory map

```text
src/                       Shared TS + Zod contract library
  ids.ts                    Identity / protocol version
  protocol.ts               Command/query/event envelopes, receipts/errors
  movement.ts               Move command and moved event (from original example)
  character.ts              Character creation and projection (new proposal)
  world.ts                  Locations, exits, read query, draft world pack
  session.ts                Trusted server-side session/authorization
  chat.ts                   Local/party speech (new proposal)
  combat.ts                 Minimal ruleset-agnostic extension seam (draft)
  clock-rng.ts              Injected clock, RNG, turn coordinator
  plugins.ts                Plugin manifest, lifecycle, registry, capability injection
  event-store.ts            Event stream, atomic append/idempotency ports
  stream.ts                 Subscriptions, filtered updates and snapshots
  network.ts                Transport-neutral wire frame candidates
  client.ts                 Shared PWA/TTY SDK facade
  authoring.ts              Proposed authorized content publication interface
originals/                 Unmodified sources extracted from prior skills
  architect/                Two original TS contract examples + reference documents
  pwa-client/               Client boundary and view-model guidance
  game-master/              Original authoring sketch + public API policy
docs/                      Provenance, status, design requirements and adoption notes
tests/                     Executable shape tests (after npm install)
scripts/                   Offline ZIP/static validation
```

## How to use

1. **Inspect the actual Replit repository first.** Determine whether contract packages already exist, and treat actual exports/migrations/tests as source of truth.
2. Read `docs/CONTRACT_CATALOG.md` and `docs/ADOPTION_GUIDE.md`.
3. Use the implemented command, query and event contracts as the runtime boundary. Keep breaking changes versioned.
4. Add runtime support and integration tests before treating a draft contract as implemented.
5. Verify behavior via integration tests for authority, concurrency, persistence, reconnect and replay before calling an interface stable.

### Optional local checks

```bash
npm install
npm run typecheck
npm test
npm run verify-package
```

Dependencies: Node >=20, TypeScript, Zod. Contract and engine unit tests use the in-memory adapter.

## Scope and non-claims

- Source references in `originals/` are design inputs, not complete API packages. The content adapter was a separate sketch in `mudd-game-master`.
- Chat, combat, authoring, streams, and transport modules remain draft schemas; no runtime behavior is claimed for them.
- The Lore Wiki skill owns prose, canon and cross-links, and introduced **no engine contract**. Nothing in this bundle is a quest-generation or wiki-editing API.
- No D&D/Monster Manual/Curse of Strahd copyrighted content is embedded. This is engine design only.
- PostgreSQL/Drizzle persistence is implemented in `apps/server`; its schema and migrations are authoritative for the running server.

See `docs/SOURCE_MAP.md` for the evidence and original artifact locations.
