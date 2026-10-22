# Orraveth: Bellwold Starter Slice

## Player experience brief

The first session introduces Orraveth through an ordinary frontier village rather than a world-history lecture. Players arrive at Bellwold's market, meet residents with limited and distinct knowledge, choose where to go, and can follow a small optional investigation to the abandoned watermill. The interaction should reward observation without resolving the village's mysteries.

**Tone:** grounded, attentive, and quietly uncanny. Use physical details and local work as the player's entry to the setting. Keep dialogue concise, personal, and careful about the difference between a witnessed fact and an explanation.

**Session loop:** orient at the square → speak with Anwen or Tomas → choose a destination → read or inspect local material → return with an observation. Movement and interaction use the existing game client; this slice introduces no new client controls.

## Canon and source boundaries

- The canonical world name is **Orraveth**. Its Codex identifies it as the continent and setting; Bellwold is one frontier village, not the whole world.
- The Codex is the source for established facts. Its articles on Bellwold, Anwen Marr, Tomas, the Silent Bell, the unusual scale, the Kindly Roof, and the watermill informed this slice.
- The Codex describes the square's layout and the detailed paths beyond Bellwold as not yet fixed. The six playable room connections and sensory descriptions here are a first playable interpretation, not a claim that every architectural detail is already established canon.
- Preserve uncertainty. The Silent Bell's history, Professor Elira Venn's disappearance, Anwen's scale, the inn's hearth, and the mill's operation are unresolved or disputed. Player-facing dialogue and readable text must not present a theory as established fact.
- Information about concealed essence extraction and its agents is not common knowledge. It is deliberately excluded from player-facing dialogue and this starter quest.
- Do not assign currency denominations, prices, or a universal exchange rate. The Codex does not establish them.

## Playable content in this slice

The six connected locations are Bellwold Market Square, The Kindly Roof, Marr's General Goods, Old Bell Tower Road, Old Bell Tower, and the Abandoned Watermill. The square is the starting room. All exits are traversable in both directions and use the supported cardinal directions.

Two established residents anchor the first interaction:

- **Anwen Marr**, the practical shopkeeper, distinguishes repeatable observations from unproven causes. She offers the optional Mill Ledger quest.
- **Tomas**, innkeeper of the Kindly Roof, shares road reports while making clear that reports are not guarantees.

The optional **The Mill Ledger** quest asks the player to read the existing ledger and report its recorded observations to Anwen. It uses the character-scoped quest and dialogue APIs, has no reward, and does not establish why the wheel moved.

## Content authoring guardrails

- Keep NPCs' knowledge local and attributable. Do not make every resident an expert on every mystery.
- Do not add new world mechanics, combat, a puzzle chain, or private player state to this content slice.
- Keep stable IDs stable when names or prose change. A location ID must never be repurposed for a different place.
- Treat substantial additions to unresolved mysteries as proposals for Codex review before they become canonical.

## World identity and ownership

This is the separate Orraveth pack and world instance, not an extension of the MUDD demo world. Character state remains scoped to its selected world instance under [ADR 0022](../../adr/0022-world-selection-and-character-world-ownership.md). The one-active-character-per-world-session rule remains unchanged.
