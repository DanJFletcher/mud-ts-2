# The Rainkeeper's Archive — example designer note

> ORIGINAL FICTION · NONCANONICAL · EDITORIAL DRAFT · NOT ENGINE INTEGRATED

The archive stores old water-control records. A riveted bronze apparatus protects its ceremonial entrance, but the builders required a maintenance path so ordinary canal workers could inspect the machinery. The heart of the puzzle is **recognizing that the reservoir is served before the overflow**. The proper alignment can be inferred independently from an architectural mural, actual wear on the gear, and a maintenance ledger. All three cues are accessible as text; the images and sound effects, if provided in future clients, are supplementary.

## Player-facing description

The chamber smells of damp copper. A wheel-shaped dial stands below a river mural. A chain hangs beside the locked archive doors. Across the wall, a suspicious line of rivets interrupts the otherwise perfect stonework. A maintenance ledger rests on a lectern.

## Private solutions — not for player wiki

**Main:** Inspect one of mural/gear/ledger → infer first flow leads to reservoir → align dial → pull chain → door opens.

**Alternate:** Inspect rivets → locate service hatch → open hatch → crawl into archive.

Invalid attempts return state-sensitive feedback; unexpected free-text input should offer available inspectable nouns and supported verbs through real UI/parser support, not silently fail. The sample JSON's `pattern_known` flag is only a simplified test proxy for an observation. In production, do not conflate character knowledge and shared mechanism state.

## Hint ladder

1. Attention: “The river mural, the dial, and the marks of wear may describe the same operation.”
2. Relationship: “The earliest flow reaches the reservoir, not the spillway.”
3. Action: “Align the dial to the reservoir symbol, then try the release chain.”

## Difference between tiers

- **Tier 1:** Only mural + dial + chain in one room, each labeled; no extra deductions.
- **Tier 2:** Need observe mural and one physical clue; service hatch is apparent.
- **Tier 3:** Current version; three independent clues and side-route.
- **Tier 4:** Split clues into nearby rooms, add a second well-established valve rule; preserve multiple solutions.
- **Tier 5:** Optional waterworks network with several branches, player-shared observations and clear persistent recovery. Never gate core progression through a brittle expert puzzle.

## Multiplayer tests to request after runtime binding

Two characters align/pull concurrently; duplicate `pull-chain`; a new arrival after door opens; one player locates the hatch without automatically granting another's private knowledge; persistence across world restart; content pack version migration. **No such runtime checks have been executed in this editorial example.**
