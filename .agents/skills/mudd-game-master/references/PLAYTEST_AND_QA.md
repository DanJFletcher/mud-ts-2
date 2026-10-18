# Game Master playtesting, validation and quality gates

## Build a test matrix from narrative claims

For every significant quest, test at least:

| Case | Expected |
|---|---|
| Discover hook by each planned route | Progress possible without exact scripted order |
| Ignore initial hook | World remains valid, faction time advances only if supported |
| Resolve via approach A | Distinct authoritative outcome and clear narration |
| Resolve via approach B | Distinct state and appropriate relationship/world reaction |
| Noncombat route | Works where designed; no secret compulsory fight |
| Fail check / lose required item | Alternative or intentional failure, not silent softlock |
| NPC unavailable/dead | Valid re-route, quest fail or explicit consequence |
| Disconnect before/after submission | Correct ack, persisted state, no duplicated effect |
| Two actors complete simultaneously | Correct world scope, transaction/version conflicts resolved |
| Late join / reload / replay | Same world truth and authorized projection |
| Guest/player vs GM view | No unrevealed clue, hidden NPC motive or spoiler leak |
| Content upgrade mid-quest | Supported migration, version pin or explicit refusal |

## Static checks

Validate all references (location, NPC, item, faction, quest state, conversation node), ensure graph reachability, required exits, no unguarded cycles/trapped dialogues, valid state transitions, localized strings, appropriate content rating and licensing metadata. A room graph's intentional unreachable areas should be documented; an accidental orphan is a defect.

If content schema is not implemented, tests can target the **draft format** but must not be reported as runtime integration tests. Distinguish unit/static, contract/adapter, end-to-end, simulated playthrough and real user playtest.

## Narrative quality rubric (score 0–2 each)

- **Agency:** player decisions plausibly alter events or knowledge.
- **Coherence:** motives, clues, geography and timeline agree.
- **Discoverability:** player understands available actions without excessive handholding.
- **Characterization:** NPCs sound distinct and pursue understandable interests.
- **Pacing:** rhythm of tension, reflection, agency, consequences.
- **Mechanics fit:** every required verb is actually supported or marked blocked.
- **Continuity:** world responds to persistent changes and returns.
- **Inclusivity:** essential clues work in text, content boundaries respected.
- **Replay/MP robustness:** no contradictory world state or duplication.

Treat any `0` in agency, coherence, mechanics fit, or replay/MP robustness as a blocking issue for a release-ready multiplayer adventure.

## Playtest evidence and iteration

Record each run: scenario/branch, pack version, engine/ruleset version, actor identities/scopes (anonymized), steps and real commands issued, resulting events/projections, narrative observations, failures and screenshots/logs if available. Change one high-impact weakness at a time; retest opposing branches and hidden-info access after edits.

Gather observations rather than relying on praise: did players notice the bell? Did they infer a rumor? Did they feel they had a choice? Did the world acknowledge a prior action? Did any prose mislead them into unsupported commands?

## AI-assisted authoring

LLMs may propose content, dialogue and branch permutations, but run an explicit canon and capability check. Never treat unverified generated descriptions as existing location knowledge or non-authorized actions as executed events. Validate data with real engine schemas. Separate narrative critique from runtime test evidence.

## Definition of done for first vertical slice

- At least 3 linked locations, 2 interacting NPCs, 1 changeable object or clue and 1 quest with 2 genuinely different outcomes (or comparably meaningful player responses).
- Public API binding inventory exists; known gaps are clearly marked.
- Tested visibility for secrets/GM-only info, idempotent completion, persistence across reload (where supported), and a text-only route.
- A coherent world bible and source/provenance metadata accompany the content.
- Game designer reports exactly what ran and what did not.
