# Quests: situations, choices, and consequences

## Think in dramatic questions

A quest is not 'collect 10 wolf pelts' unless the collection reveals a meaningful tension in the world. Start with: **What is at stake? Who disagrees? Why now? What player behaviors could affect the outcome?** Define an experience goal (wonder, dread, mystery, moral uncertainty, camaraderie), then work backward to verifiable mechanics. Use MDA as a lens: intended experience -> player dynamics -> supported mechanics.

Prepare situations rather than linear scripts. Describe actors, locations, resources and schedules. A player's solution may be barter, stealth, diplomacy, clever navigation, crafting, withdrawal or fighting; don't write 'talk to Mara then kill the beast' as the only allowed sequence.

## Recommended quest spec fields

- `id`, `version`, `scope`, `titleKey`, `summaryKey`, `tags`, `availability`, `repeatPolicy`
- `dramaticQuestion`, `setup`, `stakes`, `factions`, `characters`, `locations`
- `entryConditions`, `signals/rumors`, `objectives` described as **observable outcomes**
- `stateModel` with legal transitions and triggering authoritative events
- `branchConditions`, `choices`, `consequences`, `failurePaths`, `abandonPolicy`
- `clueGraph` and alternative discovery routes; spoiler classifications
- `rewardIntent` tied to supported inventory/reputation/economy/rules capabilities
- `timers` using authoritative logical time (if present)
- `cleanup`, `migration`, `reentry`, `replay`, `multiplayerConcurrency`
- `testCases`, content-rating considerations, `requiresCapabilities`.

Do not invent a universal schema in the engine. Map this editorial model into the project's **actual** accepted content format and identify unsupported properties.

## State machine

Illustrative design vocabulary (not promised public API):

```text
unavailable -> offered -> active -> {resolved_a, resolved_b, failed, abandoned}
                             ^          (terminal unless explicit replay)
                             | (re-enter only when designed)
```

Some quests begin without a formal 'accept' button: environmental interactions may directly establish quest progress. The state model must express that. A failure may leave a world changed and open a new situation, not reset all fiction. Define precise meaning of `failed` versus `declined` versus `abandoned`.

Every transition has an **authorized trigger**, condition, idempotency key and effect set; a duplicate event must not grant a reward twice. State should be derived from authoritative events and read through a public projection, not duplicated in PWA state. Server/runtime validation must repeat any checks clients use to display options.

## Node-based scenario design

Think locations, clues and leads as a graph. Each clue directs players to *another node* or inference; missing a single check should not permanently remove every viable way forward. For pivotal conclusions, aim for **three independent clues** or other genuinely different routes. This is a heuristic, not a rigid requirement for minor reveals.

Example: villagers can learn who sabotaged a bridge by (a) questioning a ferryman, (b) inspecting unconventional tool marks, or (c) observing late-night material deliveries. Each clue is actionable through a real supported interaction.

Track:

- reachable nodes from each legitimate quest entry;
- alternate routes around locked/removed NPCs;
- noncombat route where fiction permits;
- late-join information discovery;
- paths after losing a required object;
- closure after faction/world change.

## Decision matrix

A meaningful decision gets at least one **distinct observable result**: world flag, altered access, faction response, NPC disposition, inventory transfer, time use, persistent journal entry, or legitimate loss. Do not confuse two button labels with two branches. A small number of deep branches plus reconvergence is often more maintainable than exponentially growing branches.

When two paths reconverge, remember their consequences with minimal explicit facts: who was helped, price paid, relationships changed. Avoid keeping hundreds of redundant booleans that drift out of sync; favor facts derived from events.

## Players break your design—welcome that

Explicitly consider: player refuses, lies, kills or avoids an NPC (only if gameplay permits), arrives early/late, attacks a suspicious object, tries an unexpected order, disconnects mid-choice, multiple parties pursue opposed goals, or retrieves a target item before hearing the quest. New consequences must stay consistent with previously persisted facts.

## Failure-forward / anti-softlock rubric

1. The player understands the current problem or deliberate mystery.
2. Every compulsory task is possible under supported game systems.
3. A failed check yields a cost, complication or another approach, unless true failure is a designed outcome.
4. NPC death/absence, missing objects and elapsed time cannot strand an unfinishable state silently.
5. Negative endings still deliver feedback and reflect in the world.
6. Branch endings are not duplicated after reconnect/retry.
7. Quests are fun for 1 player and honest about additional players if they require cooperation.

Use `assets/QUEST_SPEC_TEMPLATE.md` to record decisions before implementation.
