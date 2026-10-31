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

The pack (`packVersion` 1.19.0) has 79 connected locations. The market square is the starting room.

- **The village:** the market square, the Kindly Roof, Marr's General Goods, Old Bell Tower Road and the tower; the southern lanes, with South Common, the Green Mortar, Blackwater Forge, Well Court, Wattle Row, Soven's Wheelwright Yard, Tallow End Cottage, the Old Grain House and the Common House; and the newer rows round Hearth Alley and Lantern Court, the jail, the library and the local museum. These rooms form the `bellwold` settlement location group.
- **Roads:** five roads with room-by-room travel and encounters (stray hounds, roadside deer, bandits): the West Road to the Western Road Verge (where the Harrowfen Road continues), the South Road over the Lower Rill bridge to the unfinished road end, the Mile Marker West Road to the Milepost Workshop, the East Mill Road past the abandoned watermill, and the North Church Road.
- **Harrowfen** (Phase 1 of the region expansion): the Harrowfen Road runs on from the Western Road Verge to the East Field Gate, half a day's travel at about 8 road steps a day. Ditch foxes, reedback boars and stray hounds use it. The village has the Threshing Green, the Weigh-House, a drainage cut, Tenant Row and the West Fields. Its rooms form the primary `harrowfen` settlement group, so they read as "Harrowfen: Threshing Green" and so on.
- **The Lower Rill:** seven river tiles at the south bridge, with a fishing spot. The world data still calls it "Bellwold River"; the rename is planned in [bellwold-region-expansion.md](bellwold-region-expansion.md).
- **Separate maps:** the jail cell, the library's upper room, the abandoned church's belfry and annex, and the church undercrypt maze each use their own map area or level.

Every route is reachable in both directions and uses the supported cardinal directions. No two rooms share a map tile within the same map area and level.

Nineteen residents are available to meet:

- **Reeve Maela Thorn** works at Harrowfen's Weigh-House. She speaks for the farmers on yields, landholders and the offer of cheap grain for extraction rights, and doesn't claim to know why harvests are falling. Her yield tallies record the decline without a cause.
- **Anwen Marr**, the practical shopkeeper, distinguishes repeatable observations from unproven causes. She sells tools and offers the Mill Ledger and Church Reliquary quests.
- **Tomas**, innkeeper of the Kindly Roof, shares road reports while making clear that reports are not guarantees.
- **Darric Holt** and **Ilya Fen**, established in the Codex as the blacksmith and healer, work at their workplaces.
- **Rell Soven**, **Enna Pell**, **Seli Tor** and **Aven Rusk** are provisional residents associated with wheel repair, public records, weaving and grain storage. Their knowledge stays close to their work.
- **Sella Nettlemere**, **Tovin Ashdown**, **Renna Kell**, **Pella Wren**, **Sergeant Nera Vail**, **Mira Dell** and **Nessa Rill** live and work in the newer rows, jail, library and Milepost Workshop. They are not yet in the Codex.
- **Linnet Reed** walks among Bellwold's public streets without a fixed itinerary; **Taren Voss** and **Orin Vale** follow fixed routes.

Two optional, character-scoped quests are available. **The Mill Ledger** asks the player to read the mill's ledger and report its observations to Anwen; it has no reward and does not establish why the wheel moved. **The Church Reliquary** sends the player through the church undercrypt for a reliquary sword, with a 20-gold reward.

Daily jobs on the South Common board, woodcutting, fishing, crafting at the Milepost Workshop and equipment all use existing engine capabilities.

## Content authoring guardrails

- Keep NPCs' knowledge local and attributable. Do not make every resident an expert on every mystery.
- Treat the new residents, southern buildings, and their exact arrangement as provisional until separately approved; do not extend their biographies or relationships beyond the documented facts.
- Autonomous movement uses the existing shared-world NPC capability: Linnet may choose among authored public destinations, while Taren follows his ordered route. Neither behavior makes the NPC a combatant.
- Build content from existing engine capabilities. A new world mechanic needs its own engine contract first.
- Keep stable IDs stable when names or prose change. A location ID must never be repurposed for a different place.
- Keep concealed canon (the watermill's extraction apparatus and Severin Vale's agents) out of every player-facing string. Room text also appears in destination previews before arrival. The integration test scans the pack for these terms.
- Grow the region by following [bellwold-region-expansion.md](bellwold-region-expansion.md). New roads start from an existing road's endpoint rather than extending that road, and NPCs the Codex doesn't name are unnamed roles.
- Treat substantial additions to unresolved mysteries as proposals for Codex review before they become canonical.

## World identity and ownership

This is the separate Orraveth pack and world instance, not an extension of the MUDD demo world. Character state remains scoped to its selected world instance under [ADR 0022](../../adr/0022-world-selection-and-character-world-ownership.md). The one-active-character-per-world-session rule remains unchanged.
