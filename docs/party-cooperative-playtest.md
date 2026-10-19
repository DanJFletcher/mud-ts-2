# Parties and cooperative combat playtest

## Current rules

- One player may belong to one party at a time. The first-party party policy is public and capped at four members.
- Cooperative encounters capture the party members who are online, alive, available, and in the same room when the encounter starts. Presence uses the existing 90-second heartbeat.
- The encounter keeps its captured roster if somebody leaves, disconnects, or the party closes. A later joiner is not added mid-fight.
- There is no turn timeout or automatic skip yet. If the current participant disconnects after the encounter starts, that encounter waits for the participant to reconnect and act.
- Players take turns in roster order; the enemy acts after each active ally has acted once. Each player controls only their own character.
- Combat health, consumed items, XP, and death drops are written back to each character stream when the encounter resolves. PvP still uses its separate request-and-accept flow.
- A party quest is private to its party instance. A current party member must have contributed to a team encounter for its defeat objective to count. Leaving does not erase the remaining members' progress; closing the party abandons active quests.
- Party chat is not part of this feature.

## Terminal commands

```text
party help
party create
party list
party join <party-id>
party info
party quests
party quest start <quest-id>
party leave
party close
attack <opponent>
```

The demo party quest is `mossgate-cooperative-drill`. Its objective is to defeat the Practice Sentinel at Mossgate Clearing.

## Four-client manual flow

1. Open four independent guest or signed-in sessions in separate browser profiles. Create a character in each and enter the same world.
2. Move all four characters to Mossgate Clearing. Keep each client visible long enough to refresh its heartbeat.
3. On client A, run `party create`; copy the party ID from the response or `party info`.
4. On clients B, C, and D, run `party join <party-id>`. On each client, run `party info` and confirm the same four members are listed.
5. On client A, run `party quest start mossgate-cooperative-drill`; on all four clients, run `party quests` and confirm the same active objective is shown.
6. On client A, run `attack Practice Sentinel`. Confirm the terminal switches to combat-only controls and displays all eligible allies and the enemy.
7. Act on the client whose turn is shown. Confirm the other clients see the turn and wait, then confirm the enemy acts after the last active ally in each round.
8. Defeat the sentinel. Confirm all participating characters receive the existing victory XP, the party quest completes for the remaining party members, and the encounter is no longer active.
9. Repeat with one client disconnected or moved to another room before combat starts. Confirm it is not pulled into the encounter.
10. In a separate active encounter, have a non-host leave. Confirm the captured encounter roster and turn sequence do not change; confirm that character loses access to party quests and is not included in future encounters.
11. Repeat as the host and run `party close`. Confirm the party disappears from `party list`, active quests are abandoned, and the already-started encounter retains its captured roster until it resolves.
12. Challenge another player outside PvE and confirm the existing PvP acceptance requirement is unchanged.
