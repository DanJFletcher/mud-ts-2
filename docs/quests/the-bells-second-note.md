# The Bell’s Second Note

**Status:** Playable demo-world quest; automated integration-tested. Human blind playtest not yet performed.  
**Quest ID/version:** `eddas-bell-echo` / `1.0.0`  
**Gate:** Optional side route; skipping it does not block the existing world path.  
**Audience/state scope:** Solo puzzle progress per character in a shared world.

## Brief

Edda, a bellwright on Glasswater Bridge, believes the Old Bell Tower hides a tuning room beneath it. The player’s goal is to open the stair and visit that room. The bellwrights built the chamber to tune a cracked bell: a pale stone sets its first note, then a hollow river reed gives the second. The intended insight is that the item descriptions, the inscription’s “pale / hollow” language, and the bell’s first-note response describe the same two-step mechanism. This is an introductory, text-only puzzle with no timer, resource cost, outside knowledge, or required main-story progress.

## Player-facing clues and affordances

- Edda can be asked about the bell or directly for a hint. Hints are opt-in through the NPC topic `hint`.
- The brass inscription beneath the cracked bell reads: “Pale first, hollow second. Set the stone to the cracked mouth; let the river reed carry the answer. When the tower echoes below, descend.”
- The carried smooth stone is described as having a pale stripe; the hollow reed at Glasswater Bridge has a hollow stem.
- Striking the bell with the stone produces a low note but does not open the stair.
- Using the reed too early gives a specific, non-punishing message that the first note is missing.
- After the second note, the response says a stair opens and the `down` exit becomes available.
- The Underhollow contains a bellwright’s ledger explaining why the chamber was built.

All essential information and success feedback is textual. There is no sound, color-only, timing, or external-trivia requirement.

## Designer truth and dependency graph

```text
Read inscription (quest objective; not a mechanical prerequisite)
            │
            ├── possess smooth stone ──> use stone on cracked bell
            │                                  │
            └── possess hollow reed ───────────┴──> use reed on bell
                                                   (requires first interaction)
                                                           │
                                                   down exit unlocks
                                                           │
                                                   visit Underhollow
                                                           │
                                                   report to Edda
```

The two carried items are not consumed. The first bell interaction is repeatable and records progress once. The second is authoritative only after the first interaction has been recorded for that character. A rejected action does not append progress or consume an item. The exit is checked by the server as well as projected as unavailable, so a client cannot bypass the gate by submitting a movement command directly.

### Primary solution trace

1. Take the smooth stone in Mossgate Clearing.
2. Reach Glasswater Bridge, accept Edda’s quest, and take the hollow reed.
3. At Old Bell Tower, read the brass inscription.
4. Use the smooth stone on the cracked bell; hear the first note.
5. Use the hollow reed on the cracked bell; hear the second note and open the stair.
6. Go down to the Underhollow and return to Edda to report.

The objective to read the inscription is tracked by the quest but is not a hidden mechanical gate; players who infer the solution first can read it later. The Underhollow is optional, so no bypass is needed for required story progress. There is no alternate item combination in this version.

## Hint ladder (opt-in)

| Stage | Hint |
| --- | --- |
| 1 — attention | Look beneath the bell for the brass plate. |
| 2 — relationship | “Pale” describes the smooth, striped stone; the inscription names the cracked bell. |
| 3 — action | The reed is the hollow river voice; use it on the bell after the first note. |
| After success | Check the available exits for a way down. |

The general Edda quest response stays suggestive; the explicit ladder is returned only when the player asks about a hint. Edda’s topic is available only while the character is in her room.

## State, persistence, and safety

- Item-use observations, quest progress, and visited locations are recorded per character in the existing event-backed character stream. The exit therefore unlocks for the character who solved it, not globally for every player in the room.
- Each character can take their own copy of the bridge reed; no shared consumable can be hoarded.
- Optimistic character versions and server-side precondition checks govern commands. Rejected actions leave the version unchanged; repeated valid uses are safe.
- Leaving between steps is safe. The character can return to the tower and continue. There is no reset action in this version.
- There is no failure or abandon state; an accepted quest remains active until the player reports it or chooses to ignore it. The main world path remains available either way.
- The map’s existing visited-location projection keeps the Underhollow off the character’s map until it has been entered.
- The puzzle does not emit its solution to shared room chat.

## Runtime capability inventory

| Need | Verified interface | Status |
| --- | --- | --- |
| Define world locations, exits, NPCs, items, clues, and interactions | `WorldPackDraftSchema` and `validateDraftWorldGraph` in `engine-contracts/src/world.ts`; demo content in `packages/world-demo/src/index.ts` | Present |
| Use a carried item on an interactable | `UseCharacterItemCommandSchema` and the `character.use` handler in `packages/plugins/src/character.ts` | Present |
| Enforce ordered interaction and gated movement | `requiresInteractionIds` / `requiredInteractionId` world fields plus server checks in character and movement plugins | Present |
| Track a puzzle action as a quest objective | `perform-interaction` in `engine-contracts/src/quests.ts`; `projectQuestJournal` in `packages/engine-core/src/quest-projection.ts` | Present |
| Offer stage-aware dialogue and optional hints | NPC `questResponses` in `engine-contracts/src/world.ts` and `packages/plugins/src/npc-dialogue.ts` | Present |
| Author/publish content through a separate admin importer | Demo world is currently authored in the typed package; no separate authoring/publishing flow was used | Not used |
| Reset a character’s puzzle progress | No puzzle-specific reset interface was used | Not present |

## Verification

The client SDK integration test exercises quest acceptance, all three hint stages, the rejected wrong-order action, locked-exit rejection, both valid interactions, descent, return, and quest turn-in through the engine. The full `npm test`, `npm run typecheck`, and `npm run lint` checks pass. This is integration evidence, not a human fairness/playability study; no blind playtest has been conducted yet.
