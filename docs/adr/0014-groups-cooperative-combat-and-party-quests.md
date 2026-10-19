# ADR 0014 — Groups, Cooperative Combat, and Party Quests

- **Status:** Accepted
- **Date:** 2026-10-19
- **Owners:** MUDD engine and game team
- **Related tasks:** Shared parties, cooperative PvE, and party-scoped quests

## Context

The engine has character-owned PvE encounters and consent-based two-player PvP, but no reusable group aggregate. A game party must coordinate several players without becoming the owner of their characters, health, equipment, or inventory. Party quest progress must be shared, attributable, and invalidated when its party closes. The one-active-character-per-world-session rule and explicit PvP consent remain unchanged.

## Decision

- Add a rules-agnostic Groups capability. It owns a world-scoped event stream containing generic group lifecycle and membership events. A first-party party plugin applies game policy: public join, one party per player per world, a four-member cap, and create/list/join/info/leave/close/help commands. Membership is keyed by authenticated player ID; character ID and display name are descriptive snapshots, not ownership.
- Add a generic team-combat aggregate separate from both groups and PvP interactions. Starting cooperative PvE snapshots eligible, online party members in the same location into an encounter team. Later party membership changes do not reassign active participants. Each action is authorized as the acting character, and durable health, inventory, and equipment remain character-owned. Final outcomes and drops are applied to character streams through idempotent effects. PvP still requires its existing request/accept flow.
- Add `character` and `party` quest scopes. Party quest state is keyed to a party ID, uses the existing quest definitions where possible, and is visible only to current members. A member leaving does not erase progress for remaining members. Closing a party appends an idempotent abandonment event for its incomplete party quests; a new party starts with no inherited progress.
- Add persisted event subscriptions to the engine outbox so party quest progress reacts to committed, server-authoritative combat outcomes. Subscribers must be idempotent because an effect may be retried.
- Expose these capabilities through typed contracts, plugin APIs, and the existing HTTP client/terminal. Do not add party chat.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Store party membership on each character | Easy character lookup | No atomic one-party-per-player rule and duplicates shared state across owners |
| Store cooperative encounter state on a party | Convenient grouping | Couples combat lifecycle to a social group and risks changing active combat when membership changes |
| Reuse the PvP interaction stream | Reuses a shared stream | PvE has different consent, rewards, and team rules; mixing it would weaken the PvP boundary |
| Let the client report party quest progress | Simple UI integration | Client is not authoritative and can fabricate contributions |

## Consequences and trade-offs

- Positive: Generic group lifecycle can support future non-party groups without embedding game limits in the engine.
- Positive: Party membership, combat teams, character state, and PvP interactions have distinct owners and validation rules.
- Positive: Event-driven quest progress is durable and retryable.
- Negative: Group, encounter, and character state cross aggregate boundaries; durable effects are required and must remain idempotent.
- Negative: The first combat slice supports one enemy per encounter and a simple party round-robin; richer initiative and multiple opponents remain future combat work.
- Negative: There is no turn timeout or automatic skip for a player who disconnects after roster capture. Reconnecting is required to take that character's turn.
- Negative: The generic team-combat plugin serializes encounter events in a world-scoped stream. Repartition it only if measured contention warrants the added coordination complexity.
- Compatibility/migration: New contracts and event types are additive; existing character events and PvP requests remain readable.
- Security/abuse/trust: Player identity comes from the server session. The server verifies ownership, party membership, active presence, location, alive status, and turn authorization. No client-supplied combat result or quest progress is trusted.
- Performance/operational: World-scoped group writes serialize membership changes. Presence checks and event effects add reads and queued work.
- Rollback/reversibility: Disable party commands and team-combat entry points without deleting event history. Existing solo PvE and PvP continue to use their current aggregates.

## Verification

Test group authorization, capacity and membership races, idempotent lifecycle operations, presence/location eligibility, team turn and outcome application, quest progress deduplication, member departure, party closure, event-effect retries, and unchanged PvP consent. Provide a four-client manual test path.

## Follow-up / revisit trigger

Revisit stream partitioning if measured contention warrants it. Defer party chat, cross-party combat, and transfers of party quest progress. Keep encounters fixed to their captured participants even when party membership changes.
