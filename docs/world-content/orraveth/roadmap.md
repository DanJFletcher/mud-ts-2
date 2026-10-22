# Orraveth Content Roadmap

This roadmap develops the Codex into playable regions without adding engine systems merely to make the content work. Each phase should be independently validated against the actual pack schema and player command pipeline.

## Phase 1 — Bellwold first session (implemented)

- Six interconnected rooms: square, inn, general-goods shop, tower road, old tower, and abandoned watermill.
- Two canon-established NPCs with distinct local knowledge.
- Readable local records and a small, optional, character-scoped quest.
- Verified movement, dialogue, read-object progression, completion, and replay.
- Preserve the unresolved Bellwold mysteries; no combat, crafting, or bespoke puzzle mechanics.

## Phase 2 — Expand Bellwold from Codex facts

- Review the Codex entries for Blackwater Forge, the Green Mortar, and the Eastern Forest before authoring additional locations.
- Add one location group or short connected route only when the existing geography supports it; keep new details explicitly provisional until reviewed.
- Give every new NPC a clear location, limited knowledge, and interaction purpose; avoid duplicating the same NPC under multiple IDs.
- Add optional quests only where an existing supported objective and dialogue transition fit the story.

## Phase 3 — Develop one Codex mystery as a player-led investigation

- Choose one mystery after reviewing its canon status, claims, spoiler boundary, and related articles.
- Establish what the player can observe, what residents believe, what is disputed, and what remains GM-only.
- Use existing room, readable, dialogue, visit, and quest capabilities first. Submit a versioned engine contract request before relying on any missing capability.
- Keep the investigation optional and do not collapse unresolved canon into a single explanation without approval.

## Phase 4 — Additional Orraveth regions

- Choose a neighboring settlement or region only after reviewing its canonical geography, political context, and articles.
- Keep each new region in the Orraveth content package with stable IDs and its own connected graph.
- Add region-specific NPCs, readable artifacts, and simple goals without changing the separate-world instance model.

## Deferred engine work

- Authenticated content import/version activation is not present in the checked-in public APIs; any authoring workflow needs an authorization and compatibility design.
- Relationship/reputation state is not part of this slice's content contracts.
- New puzzle mechanics, crafting, combat encounters, and scheduled NPC behavior are deliberately deferred until a story need and engine capability are both established.
