# ADR 0041 — Persistent branching quest outcomes

- **Status:** Accepted
- **Date:** 2026-10-31
- **Owners:** MUDD engine, plugins and server
- **Related:** [ADR 0004 durable event effects](0004-durable-event-effects.md), [ADR 0020 character-scoped quest rewards](0020-character-scoped-quest-currency-rewards.md), [ADR 0014 party quests](0014-groups-cooperative-combat-and-party-quests.md)

## Context

Quests were linear: a character accepted a quest, completed every objective, and turned it in. Designs such as *The Common Measure* need the player to choose between paths (regulated passage, independent carriers, or a shared protocol), keep that choice across travel and reconnects, see it in the journal and in NPC dialogue, and sometimes settle a fact that every player in the world shares.

Choices must be authoritative. A client-visible dialogue option, a client-side flag, or a dialogue progress flag must never be enough to change quest state, and retries must not apply a choice or a reward twice.

## Decision

### Definition format

`QuestDefinition` gains two optional fields. Quests without them behave exactly as before.

- `branching`: `startBranchId`, `branches[]` and `outcomes[]`.
  - A **branch** has a stable `id`, `label`, optional `summary`, the `objectiveIds` it owns, and either `choices[]` (non-terminal) or an `outcomeId` (terminal).
  - A **choice** has a stable `id`, `label`, the `npcId` who must be present, a `toBranchId`, optional `requires[]` prerequisites, and an optional `worldOutcome { key, value, label }`.
  - An **outcome** has an `id`, `label` and `summary`.
- `previousVersions[]`: manifests of earlier definition versions (see *Definition versioning*).

Choice prerequisites are a closed union of conditions the server can verify from authoritative state: `visited-location`, `possess-item`, `quest-completed` (another character-scoped quest), and `world-outcome` (a settled shared value). Unknown prerequisite types fail schema parsing. In addition, every objective on the current branch must be complete before any of its choices is available.

### Load-time validation

`QuestDefinitionSchema` rejects a branching quest unless:

- branch, choice (quest-wide) and outcome IDs are unique, and the start branch exists;
- every choice leads to an existing, different branch, and the graph is acyclic;
- every branch is reachable from the start branch;
- every non-terminal branch offers at least one choice, terminal branches offer none, and every outcome is used (no dead ends or orphaned outcomes);
- every quest objective belongs to exactly one branch;
- the quest is character-scoped (party branching is not supported).

`validateDraftWorldGraph` adds cross-references: choice NPCs, prerequisite locations, items and quests exist; a `world-outcome` prerequisite names a key and value some quest can set; each world outcome key is owned by exactly one quest; dialogue `choose` actions name an existing quest choice offered by that NPC; and dialogue `branchId` / `outcomeId` conditions exist.

### Commands, queries and events

| Contract | Kind | Notes |
| --- | --- | --- |
| `quest.choice.select` v1 `{ questId, choiceId, fromBranchId }` | Player command | Requires `expectedVersion`. `fromBranchId` is the branch the client saw; any other current branch makes the request stale. |
| `npc.dialogue.choose` with `questAction: { type: 'choose', questId, choiceId }` | Existing command, new action | Goes through the same planner as `quest.choice.select`. |
| `quest.journal` v1 | Player query | Returns `QuestJournalSchema` with shared outcomes loaded. Added to the server query allowlist. |
| `quest.choice_selected` v1 | Character event | `{ characterId, questId, definitionVersion, choiceId, fromBranchId, toBranchId }`. |
| `quest.accepted` v1 | Character event, additive field | Optional `branchId` (the start branch) for branching quests. |
| `quest.completed` v1 | Character event, additive field | Optional `outcomeId` for branching quests. |
| `world.quest_outcome_decided` v1 | World event on stream `quest-world-outcomes` | `{ key, value, questId, choiceId, definitionVersion, decidedByCharacterId }`. |

The character projection's `questProgress[]` entries gain optional `branchId`, `choiceIds` (in order) and `outcomeId`. Journal entries gain optional `branch`, `decisions`, `availableChoices` (with the NPC to speak with), `outcome` and `worldOutcomes`. These fields appear only on branching quests, so linear entries keep their exact previous shape.

### Authorization and validation

`EngineHost` already rejects commands for characters the session does not own and for other world instances. The choice handlers then check, on every submission:

- the character exists, is not archived, and is alive;
- the quest is branching, character-scoped, active for this character, and its recorded version is interpretable (below);
- the choice belongs to the character's current branch, and `fromBranchId` matches it;
- the current branch's objectives and the choice's prerequisites are met;
- the offering NPC is present at the character's location (autonomous NPC positions included);
- no conflicting world outcome has been settled.

`checkQuestChoice` in `@mudd/engine-core` holds these rules (except NPC presence) and is shared by the command handlers, the journal and the dialogue projection. A choice shown to the client is therefore a hint only: the command re-runs the same checks against current state. When shared outcomes have not been loaded, choices that depend on them are treated as unavailable (fail closed).

### Idempotency and retries

- Retrying with the same `commandId` returns the original receipt through the existing command ledger; no events or rewards are appended again.
- Retrying with a new `commandId` after success is rejected: the character is no longer on `fromBranchId`.
- Replay enforces the same invariants: a `quest.choice_selected` event whose source branch is not the current branch, whose choice was already recorded, or whose version differs from the accepted version fails replay. Rewards remain guarded by `questRewardedIds` (ADR 0020).

### Shared world outcomes and conflicts

- A world outcome is written only by the `mudd.quest-branches` plugin, which provides the `mudd.quest-world-outcomes.v1` capability. No other path, client flag, or dialogue progress flag can set it.
- Selecting a choice with a `worldOutcome` for an unsettled key appends `world.quest_outcome_decided` as an atomic companion write, guarded by the outcome stream's observed revision, in the same commit as the character's `quest.choice_selected` event. Either both commit or neither does.
- **Conflict policy: first committed decision wins, and a key is set once per world instance.** After a key is settled:
  - choices that would set a different value are hidden from the journal and dialogue and rejected with a rule violation;
  - choices that agree with the settled value remain available, move only that character's branch, and append no further world event.
- Concurrent conflicting submissions both observe the same outcome revision; the first commit wins and the other receives a retryable `VERSION_CONFLICT`. Re-evaluation then rejects it as already settled.
- Each character's branch and decisions stay in that character's stream. Shared outcomes are projected to every character with the quest through `worldOutcomes` on the journal and through choice availability.
- The engine refuses to start a world whose quests declare world outcomes unless `mudd.quest-branches` is registered.

### Definition versioning and migration

- Progress keeps the `definitionVersion` recorded at acceptance. It is never rewritten.
- A definition may list `previousVersions[]` manifests (`version`, `objectiveIds`, `branchIds`, `choices[{ id, fromBranchId, toBranchId }]`, `outcomeIds`). Schema validation guarantees every listed ID still exists, every listed choice still has the same source and destination branch, and an earlier version cannot switch between linear and branching. New branches, choices and outcomes may be added; labels and text may change.
- Progress recorded under the current version or a listed earlier version is interpreted with the current definition. Completion and reward events record the progress's original version.
- Progress recorded under any other version fails closed, as before: the journal projection throws, and no state change is offered. If a recorded choice cannot be placed on the current branch graph, projection also fails rather than guessing.
- To remove or re-point a branch or choice, publish a new quest ID or keep the old IDs in place. Do not reuse an ID with a new meaning.

### Rollback and replay

- Character streams replay without world content, so they always rebuild. Only projections depend on definitions.
- Rolling back to an older world pack is safe only if no character has accepted the quest under a newer, unlisted version or recorded a choice the older definition lacks. Otherwise those characters' journals fail closed until the newer definition is restored.
- The outcome stream is append-only and set-once. Undoing a settled world outcome is not supported by this ADR; it requires a separately authorized operator command.
- Removing the plugin while a world still declares world outcomes is rejected at engine start.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Reuse dialogue progress flags as branch state | No new events | Flags are not authoritative quest state and can be restarted; requirement forbids it |
| Durable effect writing the world outcome after commit | Matches ADR 0004 | At-least-once delivery after commit would let two conflicting choices both commit before either effect runs |
| Last decision wins | Simple | Lets later players overwrite a settled town fact; confusing for everyone affected |
| Per-quest outcome streams | Smaller streams | More stream reads per projection; one small set-once stream per world is enough today |

## Consequences and trade-offs

- **Positive:** Choices are authoritative, idempotent, survive reconnects and restarts, and appear consistently in the journal and dialogue.
- **Negative:** Other players see a newly settled world outcome on their next journal or dialogue read; no realtime push is added.
- **Compatibility:** Linear quests, existing events and existing tests are unchanged. Event changes are additive optional fields plus new event types. Branching journal entries add fields that older strict client schemas would reject, so worlds with branching quests require the matching client build. No database migration is needed; the outcome stream uses the existing event store.
- **Security/trust:** The server derives every transition from authored content and authoritative state. The outcome stream records a character ID for audit, but projections never expose it.
- **Performance:** The shared outcome stream is read only in worlds whose quests declare world outcomes.

## Not included

- *The Common Measure* is not added to Orraveth; the towns and content it needs are not in that pack. Tests use a fixture modeled on its three outcomes.
- Party-scoped branching, outcome-specific rewards, and an operator command to reset a world outcome.
- PostgreSQL integration tests for the outcome companion write. The memory adapter's atomic companion semantics are covered; the PostgreSQL adapter uses the same generic companion path as world items.

## Verification

- `engine-contracts/tests/quests.test.mjs`: graph validation (unreachable, cyclic, dead-end, missing references, party scope), prerequisite whitelist, and version manifests.
- `packages/engine-core/src/quest-branching.test.ts`: replay of branch events, rejection of stale, repeated or mismatched transitions, journal projection, fail-closed shared outcomes, compatible and unknown versions.
- `packages/plugins/src/quest-branches.test.ts`, through `EngineHost`: world cross-references; choices gated by objectives and prerequisites; persistence across a new engine instance; journal and dialogue after reconnect; stale, unavailable, unmet, unauthorized and absent-NPC rejections; duplicate retries for choices and rewards; separate character branches with a shared outcome; a forced concurrent conflict that settles exactly once; earlier compatible versions; startup refusal without the plugin.
