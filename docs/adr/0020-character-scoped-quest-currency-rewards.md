# ADR 0020: Character-scoped quest currency rewards

- **Status:** Accepted
- **Date:** 2026-10-21
- **Owners:** MUDD engine and game team

## Context

Character quests can be accepted and completed through NPC dialogue, and each character owns an event-sourced wallet. Quest definitions do not yet describe payouts. Rewards must not be selected by the client, paid twice after a retry, or written to shared world or party state.

## Decision

- Add an optional authored currency reward to a quest definition. The world graph validator requires its currency ID to match the world's configured currency.
- Currency rewards are supported only for character-scoped quests. Party quests remain unrewarded until their reward ownership and distribution rules are explicitly decided.
- On a valid NPC turn-in, the server resolves the reward from the quest definition and appends `quest.completed` and `character.quest_rewarded` to the same character stream in one command receipt.
- Replay credits the character wallet from the reward event and records the quest as rewarded. It rejects rewards for the wrong character, an incomplete quest, a mismatched wallet, an overflowed balance, or a quest that has already been rewarded.
- The existing command ID and expected-version checks provide retry and concurrency safety. No database migration is required.
- The Sedgewatch waterline quest awards its completing character 5 moss marks.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Credit currency in a separate command after quest completion | Separates quest and economy handlers | A crash or retry between writes could complete the quest without paying, or pay twice |
| Store quest rewards on a shared world or party aggregate | Could support shared payouts | The initial feature is character-specific and does not define shared reward ownership |
| Let the client submit the reward amount | Simple client integration | The client is untrusted and could choose arbitrary currency or amounts |

## Consequences and trade-offs

- Positive: Reward, completion, and wallet balance are auditable in one character-owned event stream.
- Negative: Item rewards and party rewards are not supported by this first slice.
- Compatibility/migration: Reward definitions and the new event are additive; existing character streams replay without a database migration.
- Security/abuse/trust: The server resolves currency and amount from authored content and validates wallet capacity before appending events.
- Performance/operational: A turn-in remains one character-stream append.
- Rollback/reversibility: Removing a reward from future authored content does not erase already recorded reward events.

## Verification

- Contract tests validate positive currency amounts and reject party-scoped rewards.
- World graph tests reject reward currencies that differ from the configured world currency.
- Client integration tests verify exact wallet credit, per-character quest completion, duplicate-command retry safety, and rejection of a second turn-in.
- Replay enforces the event ordering and one-reward-per-quest invariant.

## Follow-up / revisit trigger

Revisit the decision when newly created item rewards or party quest payouts are requested. Same-item quest returns are addressed by ADR 0023.
