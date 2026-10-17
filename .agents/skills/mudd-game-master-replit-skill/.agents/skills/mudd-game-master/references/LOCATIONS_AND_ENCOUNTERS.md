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

## Environmental storytelling

Let architecture, objects, routes and omissions imply backstory. Example: a moss-covered bell by an abandoned ferry dock, a sanded-off guild insignia and invoices for untold repairs suggest a dispute without an NPC monologue. The player can *inspect* these through explicit interactions. When evidence is pivotal, include multiple corroborating sources.

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
