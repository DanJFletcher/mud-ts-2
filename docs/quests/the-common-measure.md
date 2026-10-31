# The Common Measure

**Status:** Design draft; not added to the Orraveth world pack.  
**Proposed quest ID/version:** `orraveth-common-measure` / `1.0.0`  
**World:** Orraveth — Bellwold Marches  
**Scope:** Character  
**Content boundaries:** No combat, no forced accusation, and no conclusion about the cause of Harrowfen's declining harvests or the provenance of any Veyl product.  
**Provenance:** Original proposal based on the existing Orraveth Codex and the Bellwold region-expansion plan. All new shipment records, negotiations, and outcomes below are draft content, not established canon.

## Experience brief

**Player promise:** Travel between three towns, compare what each community needs from a shared grain shipment, and decide what a fair arrangement should protect when no route is neutral.

**Primary verbs:** Investigate, negotiate, choose.

The tension is civic rather than combat-driven. Harrowfen needs food security, Rillford's residents disagree about who should control river passage, and Vell's Crossing wants dependable trade without surrendering local authority. The quest asks the player to make those competing concerns legible—not to uncover a secret villain or prove a cause for the harvest decline.

## Situation and dramatic question

Reeve Maela Thorn asks the player to help document a proposed one-time grain consignment intended to relieve pressure on Harrowfen and nearby markets. The amount, route, and terms are still being negotiated. She wants a record that distinguishes what each town can verify from what it merely expects.

In Rillford, Guildmistress Selda Rook argues that regulated passage and a complete cargo record protect small traders as well as large ones. An independent boatman argues that the ferry guild must not turn record-keeping into exclusive control. At Vell's Crossing, civic delegates disagree over whether a reliable shipment is worth accepting terms that favor one commercial route.

The dramatic question is: **Who should bear the risk—and who should have authority—when a regional shipment is scarce?**

The proposed shipment is a new quest situation. It does **not** explain the Vanishing Grain, establish a connection to the Hollow Trade, or imply that any named character is hiding the cause of either.

## Entry and refusal

- **Giver / intended start:** Reeve Maela Thorn, at Harrowfen's weigh-house.
- **Turn-in / intended return:** Maela Thorn, at the same location.
- **Availability:** Optional. The player may decline or leave at any point; the wider world path remains open.
- **Audience:** A solo character can complete the investigation. Other players may pursue their own character-scoped copy; the design does not require a party.
- **Repeatability:** Once per character unless a later, explicit replay policy is approved.

**Hook:** “The count on the field tally is clear. What isn't clear is who will carry the grain, who will record the handover, and who will be left waiting if the route fails. Bring me the towns' terms, not a guess about the harvest.”

## Places, people, and proposed material

| Town | Canonical anchor | Proposed quest material |
| --- | --- | --- |
| Harrowfen | Maela Thorn; weigh-house and yield tallies | A public request for shipment terms, separate from the yield record |
| Rillford | Selda Rook; ferry dispute and cargo documentation | A public cargo register and an independent boatman's account of passage |
| Vell's Crossing | Civic government of guild, landholder, and neighborhood delegates | A public terms sheet recording competing priorities; no single delegate speaks for the town |

The people and existing concerns in the second column are established in the Codex. Every proposed document, shipment, negotiation, and local response in the third column needs content review before being added to a world pack. Jarek Vell is not presumed to know about, participate in, or approve any disputed activity.

## Clue and travel graph

```text
Maela's request and Harrowfen yield tally
                  |
                  v
       Rillford cargo register
          /                 \
 Selda's regulated       Boatman's independent
 passage proposal        passage account
          \                 /
                  v
 Vell's Crossing: compare the terms and who bears each risk
                  |
                  v
 Choose a recommendation, defer it, or decline to endorse either route
                  |
                  v
 Return to Maela with the record and the choice
```

| Clue | Where | Player action | Reveals | Alternate route |
| --- | --- | --- | --- | --- |
| Harrowfen yield tally | Weigh-house | Read the existing public tally | The village has recorded declining yields; the tally does not explain why | Maela can describe what the tally does and does not establish |
| Shipment request | Weigh-house | Read the proposed request or ask Maela | What the proposed consignment is meant to address, and which terms remain unsettled | The request remains available to read after accepting |
| Cargo register | Rillford customs house (planned content) | Read the public entry | What the clerk recorded at handover; not proof of the cargo's final destination or condition | Selda can explain the register's limits |
| Passage accounts | Rillford quay / warehouse row (planned content) | Speak with Selda and an independent boatman | Why documentation and control of passage are separate questions | Either speaker can point to the public register |
| Terms sheet | Vell's Crossing civic hall (planned content) | Read and discuss the proposals | Which residents favor reliability, local discretion, or protections against exclusive terms | Delegates can summarize positions without revealing private motives |

All essential clues are textual and can be reached by reading or conversation. No color, map, combat result, timed event, or unverified rumor is required.

## Player approaches and outcomes

The player gathers the same core facts, then chooses how to advise Maela. The alternatives are materially different proposals; none is presented as the universally correct answer.

### A — Recommend the regulated route

Support Selda's documented passage process.

- **Trade-off:** A clearer cargo record and accountable handovers; greater authority accrues to the ferry guild.
- **Possible response:** Selda welcomes a concrete record. The independent boatman warns that procedure can become a barrier when one guild controls access.
- **Intended observable consequence:** Harrowfen's shipment plan records the regulated route and its safeguards. A future shipment could depend more heavily on guild access.

### B — Recommend an independent-carrier agreement

Support a route negotiated directly with independent boatmen, using the same public record at each handover.

- **Trade-off:** More local control and less exclusive authority; fewer guarantees if a carrier or crossing becomes unavailable.
- **Possible response:** The boatman accepts the proposal only if load and handover records are shared. Selda questions whether voluntary records will be complete.
- **Intended observable consequence:** The plan records a nonexclusive carrier arrangement and makes each handover visible to both towns.

### C — Recommend a shared protocol before dispatch

Ask the towns to agree on a common record and a nonexclusive passage rule before the shipment moves.

- **Trade-off:** More consent and clearer responsibilities; delay while a perishable or urgently needed shipment waits.
- **Possible response:** Delegates disagree over timing, but no town is forced to accept another town's authority.
- **Intended observable consequence:** The shipment remains pending until the communities agree; the delay is shown plainly rather than treated as a hidden failure.

### Decline or defer

The player can return the documents without endorsing a route, or leave the quest active and travel elsewhere. Maela records that no recommendation was made. There is no penalty, forced restart, or fabricated resolution.

### Failure-forward cases

- If a named NPC is unavailable, the public records preserve the essential information; no single conversation can softlock the quest.
- If a document cannot be read, the corresponding NPC can summarize the same observable facts without changing the choice.
- If the player returns before visiting all three towns, Maela identifies what is still unknown and leaves the quest active.
- If the player never returns, the unresolved proposal remains unresolved. No automatic world timer is assumed.

## Proposed state model

The following is design intent, not current runtime behavior. Quest acceptance and investigation progress should be character-scoped; the actual shipment decision would affect shared world state only if an authorized, idempotent world-scoped capability is added.

```text
unavailable
  -> offered
  -> active
     -> active_with_harrowfen_record
     -> active_with_rillford_record
     -> active_with_vells_terms
     -> resolved_regulated
     -> resolved_independent
     -> resolved_shared_protocol
     -> completed_without_recommendation
```

The three evidence states may be discovered in any order. The recommendation is legal only after all three records have been found, or after the player explicitly chooses to return without completing the investigation. The final choice is stored once; duplicate submissions must not duplicate consequences. Leaving the area or disconnecting does not clear progress.

## Current engine capability inventory

| Need | Verified interface | Status |
| --- | --- | --- |
| Define the quest and supported objectives | `QuestDefinitionSchema` in `engine-contracts/src/quests.ts` | Present |
| Character-scoped progress | `scope: 'character'` in `QuestDefinitionSchema` and the character quest projection | Present |
| Supported objective triggers | `read-object`, `visit-location`, `perform-interaction`, and `possess-item` variants in `QuestObjectiveDefinitionSchema` | Present |
| Offer and turn in through NPC dialogue | `QuestDialogueActionSchema` with `accept` and `turn-in`; world validation checks giver and turn-in NPC references | Present |
| Read progress and show objective completion | `projectQuestJournal` in `packages/engine-core/src/quest-projection.ts` | Present |
| Add a currency reward or return existing item(s) | `QuestRewardSchema`; rewards are character-scoped | Present, but no reward is proposed here |
| Choose among mutually exclusive endings and persist the selected ending | No branch-choice field or generic choice effect in `QuestDefinitionSchema` | **Absent** |
| Apply an idempotent shared shipment/market outcome | No quest-defined shared-world consequence was identified in the current quest contract | **Absent** |
| Import or activate a separate Orraveth content pack | The current Orraveth pack is authored in `packages/world-orraveth/src/index.ts`; the expansion plan says no separate authoring/publishing flow was used | **Not available in the inspected flow** |

The existing quest schema can represent a straightforward sequence of read/visit objectives and a character-scoped turn-in. It cannot honestly deliver the three distinct outcomes above. Do not approximate those outcomes with client state, hidden dialogue flags, or direct database writes.

## Implementation slice

1. **Content prerequisite:** Add the Rillford and Vell's Crossing routes, rooms, records, and NPC roles through the established Orraveth world-pack flow. Harrowfen exists in the current pack; the other two towns are still planned content in the region-expansion document.
2. **First playable version without new engine work:** Keep the quest character-scoped, require the three public records, and have Maela acknowledge the completed investigation without claiming that a shipment or town policy changed. This provides the multi-town investigation but not the three-way consequence.
3. **Branching version:** Ask `mudd-architect` for a public, versioned quest-choice capability with character authorization, an idempotent outcome event, a character journal projection, and an explicitly scoped shared-world effect if town conditions are to change.
4. **Do not publish the branching outcomes** until that capability and the destination-town content are implemented and validated.

## Verification plan for implementation

- Validate quest, NPC, location, readable, and dialogue references with `WorldPackDraftSchema` and `validateDraftWorldGraph`.
- Test each evidence order, including visiting Rillford or Vell's Crossing first.
- Test refusal, early return, NPC absence, unreadable records, disconnect/reconnect, duplicate choice submission, and late arrival after another character's choice.
- Confirm character progress never leaks between players.
- If any town state is shared, test simultaneous recommendations and verify one authorized resolution is applied exactly once.
- Conduct a blind text-only playtest to confirm players understand that the quest concerns shipment terms—not the cause of the harvest decline or proof of a Hollow Trade allegation.
