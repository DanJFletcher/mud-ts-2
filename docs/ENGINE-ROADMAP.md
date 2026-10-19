# MUDD engine architecture roadmap

- **Status:** Prioritized proposal; scope gates require review.
- **Reviewed:** 2026-10-19

This roadmap does not authorize new gameplay or a broad refactor. It keeps current behavior stable and sequences decisions before changes that would affect aggregate ownership.

## Priorities and dependencies

| Priority | Work | Depends on | Benefits | Complexity and migration risk |
|---|---|---|---|---|
| 0 — Review gate | Review [ADR proposal 0009](adr/proposals/0009-shared-world-authority.md); decide whether and which state must be shared. | Product/architecture review | Prevents two independent streams from claiming authority over one shared fact. | Low to review; high cost if deferred until after shared data is persisted. No implementation before acceptance. |
| 1 — Contract hardening | Add a Zod response contract for room chat or route it through `MuddHttpClient`; document the supported plugin manifest/range subset and live-vs-proposed plugin interface. | No aggregate changes required | Makes invalid server responses and API drift fail at a boundary; reduces plugin author confusion. | Low to medium. Keep the existing wire shape and chat persistence. |
| 1 — Operations | Add visibility for pending/retrying/dead effects and a safe operator replay policy; decide whether process-local rate limits remain adequate. | Operational requirements and hosting topology | Improves diagnosis and recovery for at-least-once work and distributed deployments. | Medium. Replay must preserve consumer idempotency; shared rate limiting adds infrastructure. |
| 2 — Shared-item vertical slice (conditional) | If ADR 0009 is accepted, implement one explicitly authored shared item using one authoritative item aggregate, then add inventory/room projections. | Accepted ownership ADR; store API and migration plan | Proves contention, ownership transitions, and room visibility with minimal gameplay scope. | High. Existing personal item streams must remain replayable and must not be silently converted. |
| 3 — Shared presence (conditional) | Add a read model for characters in a room using active sessions and committed locations; specify session expiry and visibility policy. | Product need for visible occupancy; session consistency design | Enables accurate occupants and multi-player room views. | Medium to high. Presence has different freshness/expiry needs from durable character events. |
| 4 — Public plugin and authoring API | Converge the proposed and live plugin contracts; add helpers and examples only after the public capability/security model is agreed. | Plugin support decision; contract-hardening results | Makes extension work discoverable and versionable. | Medium to high. Public types become compatibility obligations; permissions do not sandbox code. |
| Later / separately scoped | TTY client, importable content packs, multi-world operations, and ruleset-neutral RNG/clock integration where product behavior needs it. | Independent product requirements | Expands clients and authoring without coupling them to the React app. | Varies; licensing and data provenance matter for externally distributed content. |

## Critical invariant test plan

| Invariant | Essential test |
|---|---|
| One active character per account/world instance | Concurrently join two owned characters for the same account and world; at most one session commits. A different account remains independent. |
| A character command cannot mutate another character | Use an owned and an unowned character ID; verify the latter is forbidden and no event is appended. |
| Retry does not duplicate committed state or effects | Repeat the same command ID and payload after commit; original receipt/events return and NPC announcement output occurs once. Reuse the ID with different payload must conflict. |
| Stale writes cannot overwrite newer state | Concurrently append at one expected revision; exactly one commits and the other receives a version conflict. |
| Replay is deterministic and fail-closed | Replay supported event versions; reject malformed payloads, unknown event types, and revision gaps. |
| Room chat cannot cross room/world boundaries | Race chat with movement using the same character; the message is accepted in the old room before movement or rejected after it. Repeated submission ID does not duplicate it. Poll cursors retrieve all ordered messages once, including messages interleaved with the sender's own acknowledgement. |
| Shared unique item has one owner (only after ADR approval) | Two characters race to take one instance; exactly one transition commits. Drop becomes visible to the other character. Retrying the winner does not create a second item. Separate world instances remain isolated. |
| Rule errors and infrastructure failures remain distinct | Rule violations return safe player messages. Inject store/authorization failures and verify a generic internal response with request ID and no raw database detail. |
| Host trust and abuse limits fail closed | Exercise allowed/disallowed origins and hosts, request body limit, and command/chat limits; test proxy configuration with the production hop count. |
| Runtime responses match client contracts | Feed malformed snapshots, command receipts, world-session responses, and room-chat responses; SDK/feature schemas reject them rather than trusting casts. |
| Plugin graph is deterministic and honest | Test dependency ordering, exact/caret supported ranges, invalid/unsupported range syntax, cycles, missing plugins/capabilities, declared capability mismatch, and duplicate registrations. |
| PostgreSQL is the concurrency authority | Run migrations and the above persistence-critical concurrency/idempotency cases against an isolated PostgreSQL test database in CI. Never substitute an unspecified development or production database. |

The first three historical regression tests are already present in `RoomChatPanel.test.tsx`, `npc-room-announcement.integration.test.ts`, and `engine.test.ts`. The remaining rows identify coverage to preserve or add when touching those boundaries; the shared-item row is gated on ADR approval.

## Components and decisions to preserve

- The TypeScript/npm workspace monorepo; do not split services or replace the language stack as part of this work.
- `engine-contracts` Zod schemas as the wire boundary; server authority and client validation remain separate responsibilities.
- PostgreSQL/Drizzle as the durable store and the in-memory store as a focused engine-test adapter.
- Character streams, expected revisions, command receipts, replay, and atomic append semantics for character-owned state.
- **One active character per world session.** Multiple account-owned characters remain a roster/selection concern, not multiple simultaneous identities in one session.
- Character ownership of current inventory, wallet, health, combat, and progression until an accepted ADR changes a specific state type.
- The separate room-chat feed and its movement-membership ordering guarantees from ADR 0003.
- The durable outbox and idempotent-consumer model from ADR 0004.
- The React PWA's mobile-first layout and the `packages/ui` Storybook-first component boundary.
- Existing accepted ADRs 0001–0008 unless a later decision explicitly supersedes one.

No test plan item permits data deletion, event reinterpretation, or schema migration without an explicit design and rollback plan.
