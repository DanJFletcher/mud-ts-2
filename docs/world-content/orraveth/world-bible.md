# Orraveth: Bellwold Settlement Expansion

## Player experience brief

The first session introduces Orraveth through Bellwold, a growing frontier settlement rather than a world-history lecture. Players arrive at the market, find workshops and homes along the southern lanes, meet residents with limited and distinct knowledge, and can follow a small optional investigation to the abandoned watermill. The interaction should reward observation without resolving the settlement's mysteries.

**Tone:** grounded, attentive, and quietly uncanny. Use physical details and local work as the player's entry to the setting. Keep dialogue concise, personal, and careful about the difference between a witnessed fact and an explanation.

**Session loop:** orient at the square → speak with Anwen or Tomas → choose a destination → read or inspect local material → return with an observation. Movement and interaction use the existing game client; this slice introduces no new client controls.

## Canon and source boundaries

- The canonical world name is **Orraveth**. Its Codex identifies it as the continent and setting; Bellwold is one frontier village, not the whole world.
- The Codex is the source for established facts. Its articles on Bellwold, Anwen Marr, Tomas, the Silent Bell, the unusual scale, the Kindly Roof, and the watermill informed this slice.
- The Codex establishes Bellwold's market, inn, general store, forge, healer, tower, and mill. The southern streets and additional shared buildings are a provisional expansion of the settlement layout, not a claim that every architectural detail is settled canon.
- Preserve uncertainty. The Silent Bell's history, Professor Elira Venn's disappearance, Anwen's scale, the inn's hearth, and the mill's operation are unresolved or disputed. Player-facing dialogue and readable text must not present a theory as established fact.
- Information about concealed essence extraction and its agents is not common knowledge. It is deliberately excluded from player-facing dialogue and this starter quest.
- Gold is the provisional currency name for the current Orraveth slice. Do not infer denominations, prices, or a universal exchange rate; these remain unspecified.

## Playable content in this slice

The fifteen connected locations are Bellwold Market Square, The Kindly Roof, Marr's General Goods, Old Bell Tower Road, Old Bell Tower, the Abandoned Watermill, Bellwold South Common, the Green Mortar, Blackwater Forge, Bellwold Well Court, Wattle Row, Soven's Wheelwright Yard, Tallow End Cottage, Old Grain House, and Bellwold Common House. The market square is the starting room. The southern branch adds workshops, a well, residential lanes, shared storage, and a meeting room. Every route is reachable in both directions and uses the supported cardinal directions.

Ten residents are available to meet:

- **Anwen Marr**, the practical shopkeeper, distinguishes repeatable observations from unproven causes. She offers the optional Mill Ledger quest.
- **Tomas**, innkeeper of the Kindly Roof, shares road reports while making clear that reports are not guarantees.
- **Darric Holt** and **Ilya Fen**, established in the Codex as the blacksmith and healer, are now present at their respective workplaces.
- **Rell Soven**, **Enna Pell**, **Seli Tor**, and **Aven Rusk** are new provisional residents associated with wheel repair, public records, weaving, and grain storage. Their knowledge stays close to their work.
- **Linnet Reed** walks among Bellwold's public streets and shared spaces without a fixed itinerary.
- **Taren Voss** follows a regular watch patrol from the tower road through the square and southern public spaces.

The optional **The Mill Ledger** quest asks the player to read the existing ledger and report its recorded observations to Anwen. It uses the character-scoped quest and dialogue APIs, has no reward, and does not establish why the wheel moved.

## Content authoring guardrails

- Keep NPCs' knowledge local and attributable. Do not make every resident an expert on every mystery.
- Treat the new residents, southern buildings, and their exact arrangement as provisional until separately approved; do not extend their biographies or relationships beyond the documented facts.
- Autonomous movement uses the existing shared-world NPC capability: Linnet may choose among authored public destinations, while Taren follows his ordered route. Neither behavior makes the NPC a combatant.
- Do not add new world mechanics, combat, a puzzle chain, or private player state to this content slice.
- Keep stable IDs stable when names or prose change. A location ID must never be repurposed for a different place.
- Treat substantial additions to unresolved mysteries as proposals for Codex review before they become canonical.

## World identity and ownership

This is the separate Orraveth pack and world instance, not an extension of the MUDD demo world. Character state remains scoped to its selected world instance under [ADR 0022](../../adr/0022-world-selection-and-character-world-ownership.md). The one-active-character-per-world-session rule remains unchanged.
