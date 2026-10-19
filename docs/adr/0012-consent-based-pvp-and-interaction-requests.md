# ADR 0012 — Consent-Based PvP and Interaction Requests

- **Status:** Accepted
- **Date:** 2026-10-19
- **Owners:** MUDD engine and game team
- **Related tasks:** Consent-based player-versus-player combat

## Context

The engine currently supports character-scoped PvE combat. An encounter has one character as its owner and its opponent is an NPC. That model cannot safely represent two players acting in the same encounter: writing both players' health or inventory to one character stream would violate character ownership, while independently updating both streams could leave the encounter inconsistent. The engine also has no reusable, recipient-authorized request lifecycle.

The game must preserve the rule that one world session controls one active character. PvP is opt-in, server-authoritative, restricted to online players in the same room, and must not change PvE behavior. Character health, gear, and consumables remain character-owned, and the existing zero-health permadeath rule applies.

## Decision

Add a rules-agnostic interaction-request capability in the engine. Requests have a unique ID, initiator, recipient, kind, creation and expiry times, and lifecycle states `pending`, `accepted`, `declined`, `expired`, or `cancelled`. Only the designated recipient may accept or decline. Duplicate or conflicting responses are rejected idempotently; expiry and disconnect cancellation are server-authoritative. Plugins subscribe to lifecycle events and provide kind-specific validation and resolution policy.

Persist interaction lifecycle and active shared interactions in a world-scoped event stream. Its single append boundary makes competing responses and turn actions serializable and allows the inbox to be projected from authoritative events. This intentionally serializes interactions within one world instance; partitioning is deferred until measured contention justifies it.

The combat plugin owns the PvP policy and the shared encounter projection, including the current turn. The first version allows one active duel per world instance. It reuses compatible PvE action rules but does not store either character's durable health or inventory in the world stream. On encounter completion, an idempotent durable effect applies each participant's final health and consumed items to that participant's character stream. Ordinary character actions remain unavailable while a character has an active PvP encounter or an unapplied outcome. Reaching zero health permanently ends that character, consistent with the existing game rule. PvP does not grant PvE experience or loot.

Use authenticated HTTP polling for inbox and encounter updates in the first version, matching the existing client transport. Polling does not replace or reset the active world session. Challenges expire after 60 seconds. A player is challengeable only while their world-session heartbeat is fresher than 45 seconds; the web client heartbeat interval is 30 seconds. A missing/stale session cancels pending requests and prevents new challenges.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Store the encounter in either participant's character stream | Reuses current PvE projection | Breaks the ownership boundary for the other participant and cannot atomically coordinate both characters |
| Write encounter events independently to both character streams | Keeps data near each character | There is no atomic multi-stream append; partial writes can disagree about turn, health, or outcome |
| Add a new database row/table as the encounter authority | Straightforward querying | Duplicates the event-store authority and requires a second concurrency/idempotency model |
| World-scoped interaction stream plus character outcome effects | One serializable authority for consent and shared turn state; character data remains character-owned | All interactions in one world share an append lane; outcome application requires idempotent effect handling |

## Consequences and trade-offs

- Positive: Generic request lifecycle can support future consent-based interactions without embedding game rules in engine core.
- Positive: Acceptance, decline, timeout, disconnect, and concurrent responses have one authoritative ordering.
- Positive: PvP does not weaken one-character-per-session, character-owned state, or permadeath rules.
- Negative: A world-scoped stream is a per-world serialization point.
- Negative: PvP currently permits only one active duel per world instance.
- Negative: Clients poll rather than receiving real-time push notifications.
- Compatibility/migration: New contract types, event schemas, plugin capability, and HTTP endpoints are additive. Existing PvE commands and projections remain unchanged.
- Security/abuse/trust: The server derives actor identity from the authenticated world session, verifies target presence and room, restricts response to the recipient, rate-limits challenges, and never trusts client-supplied health, turn, or outcome.
- Performance/operational: Expiry and outcome effects require a server worker; they must be idempotent across retries.
- Rollback/reversibility: PvP can be disabled at the game plugin/route boundary without removing PvE combat. Existing character events remain readable.

## Verification

Test consent, authorization, expiry, disconnect cancellation, duplicate and concurrent responses, PvP turn/action resolution, durable character outcome application, and unchanged PvE combat. Exercise the HTTP polling flow with two selected characters in one world and verify neither client loses its world session.

## Follow-up / revisit trigger

Revisit world-stream partitioning and concurrent-duel support if production contention or demand warrants it. Push delivery, PvP rewards, party/group combat, and cross-room challenges are deferred. Any change to death, rewards, or item ownership requires a separate product/architecture decision.
