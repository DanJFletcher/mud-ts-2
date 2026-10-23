# Places, sensory prose, interactables and encounters

## A room is a playable state, not just a paragraph

Model each location as:

- identity: stable ID, region, name key, version;
- orientation: exits/links, traversability, geographic relationship;
- player-visible `arrival` and `look` text;
- inspectables (objects, descriptions, clues) with legitimate permissions;
- inhabitants and their schedules/state;
- environmental states and variants after key world events;
- sensory layer (light, sound, texture, smells) where relevant;
- public affordances and secret discoveries that require commands/observations;
- interactions bound to documented public capabilities;
- exits blocked/unblocked by **authoritative** world state;
- text-only equivalent for every required clue.

Use second person present for player-facing room descriptions by default, concise opening followed by optional deeper inspections. Prefer vivid **specific** detail over purple prose. The first entry should be evocative but skimmable; subsequent `look` calls should avoid repeating a cutscene. If a bridge is destroyed in world state, stale descriptions must not continue presenting it intact.

## Room prose and the player's knowledge

Write room descriptions as immediate sensory observations. A `look` description should normally use **one or two** senses from sight, smell, taste, hearing, and touch; do not force all five or add a sensory detail merely to meet a count. Use only details the character could perceive in that moment. Taste and touch are valid when naturally plausible, but never invent an action such as tasting or touching something just to include them. Describe an audible or smelled source as known only when the character can reasonably identify it.

Do not use room prose to state information the author knows but the player has not discovered: a location's purpose, its history, its usual schedule or crowd, ownership, local customs, unseen events, or an NPC's motives. Keep the distinction between **evidence** and **context**:

- Describe perceptible evidence: a row of stalls, a faded painted name, a split bell, worn steps, a trail of flour, or a door standing open.
- Do not turn that evidence into an undiscovered explanation: who built it, what the room is for, why the bell broke, who owns the stalls, or when the market is busiest.
- Reveal background facts through a readable source or an NPC who knows them. A visible sign may be mentioned as a sign; its written contents belong in the supported `read` interaction, not automatically in `look`. Make sure the source or conversation is actually authored and accessible.

**Player-facing sensory description:**

> Stalls and handcarts crowd the open area. The smell of baked goods seems to be coming from the East.

This gives the player visible shapes and a smell with direction. It does not assert the square's purpose, the market's schedule, or a history the character has not learned.

**Avoid author-only exposition in `look`:**

> The square is Bellwold's commercial heart. Every fifth day the whole village gathers here, where generations of traders have met since the old tax hall burned.

The schedule, civic role, history, and gathering are not immediate sensory observations.

**Separate evidence from learned context:**

- Room prose: “A rain-softened notice hangs beside the door. Its ink has run into blue-black streaks.”
- After the player reads the notice: provide the text that is actually written there.
- In an NPC conversation: the NPC may explain the hall's former use, but only if the NPC has that knowledge and is willing to share it.

The structured location title, engine-generated exit lists, and other interface information may remain separate from the sensory room prose. A location title does not authorize the prose to explain the place's purpose. Keep the prose itself grounded in what the character can perceive. Do not state the character's thoughts, emotions, or interpretation as an objective sensory fact.

## Environmental storytelling

Let architecture, objects, routes and omissions provide perceptible evidence without explaining its backstory. For example, a moss-covered bell by a dock, a sanded-off guild insignia, and invoices for repairs can invite questions; do not state what dispute they imply as fact in room prose. Make important background available through an authored, reachable readable source or an NPC who knows it. When evidence is pivotal, provide multiple corroborating sources through those channels.

A discovered object should have consistent persistence/ownership rules. Don't allow a single physical object to be collected simultaneously by every player unless it is instanced or repeatable by design. Keep unique keys stable across content edits.

## Encounters beyond combat

An encounter is a collision of interests, not necessarily a fight. Specify:

- Why now? What draws players into this conflict?
- Who acts without players? Who reacts to negotiation, retreat, sabotage or assistance?
- Which clues reveal stakes before irreversible decisions?
- Which terrain/object affordances matter?
- Which kinds of risk and success are supported by the **actual** ruleset/capability inventory?
- What remains different in the world afterward?

For combat, design roles and tactical terrain rather than copying protected monster statistics. Request creatures from an available named ruleset; if no ruleset plugin exists, provide a rules-neutral encounter spec and mark it blocked from numeric balancing. Explain why players may choose violence and how they can exit or resolve conflict otherwise, when appropriate.

## Adventure pacing

Alternate tension, decision, exploration, discovery, social interaction, risk and calm. A small 15–30 minute slice can be: compelling arrival → inspect 2 meaningful clues → speak with one NPC → choose between 2–3 approaches → see a persistent changed world response. Do not force linear ordering when players can plausibly act otherwise.

## Text-first accessibility and privacy

- Text client expresses all decisions, exits, evidence and consequences; visual art/audio can enrich but must not be the only evidence.
- Separately mark GM-only commentary, hidden traps/clues, and player-facing narration. No automatic serialization of secret fields into ordinary player projections.
- Support clear discoverability: `look`, `inspect`, `exits`, `talk`, `journal` as concepts only; bind to actual commands/queries before claiming they work.
- Horror/violence content needs tonal boundaries and options for less graphic wording where appropriate.

## Route checks

Check each room has an intentional incoming path; one-way routes are marked; locked areas have discoverable key/alternative; procedural changes cannot permanently strand players; accessibility doesn't depend on arbitrary mouse interactions; travel events maintain correct region/instance scope; reconnecting produces accurate room state.
