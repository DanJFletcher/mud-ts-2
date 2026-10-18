# NPCs and dialogue: believable people, accurate state

## Write NPCs from motives

NPCs are not quest vending machines. Each important NPC needs: player-facing impression; personal desire; fear/constraint; competence; contradiction; allegiance; social relationships; relationship to place; schedule/next move; possessed knowledge; distorted belief; inventory/position (only if real capabilities); a distinct voice and at least one way they can change.

**Voice template:** rhythm and vocabulary, favored imagery, what they refuse to discuss, politeness baseline, emotional tells, short greeting/sample line. Avoid accents represented via phonetic caricature or cultural stereotypes. Dialogue should usually be brief enough to play well on phones and terminals.

## Knowledge, memory, and secrets

Classify assertions as (1) canonical truth; (2) sincerely believed falsehood; (3) strategic lie; (4) rumor; (5) perception tied to a character; (6) out-of-world GM-only secret. An NPC may reveal only facts accessible to them at that moment. A public profile must not include hidden fields; player-specific projections should be filtered by authority/visibility, **not by a UI-only reveal flag**.

Example: the innkeeper knows a messenger left after midnight, believes the mayor paid her, and lies about receiving a letter; only the GM ledger knows the letter contents until discovered. Keep these distinctions in the bible.

## Dialogue specification

For every node/option specify stable ID, speaker, localized text key, conditions, visibility, player-facing choice, next node/outcome, relevant clue, and required command when it changes authoritative state. All permanent social effects pass through real capabilities.

A dialogue can have one 'goodbye' exit and a graceful interruption when the session closes, NPC becomes unavailable, or world conditions change. Don't make every conversation a 20-step exposition tree. Treat returning characters differently if the engine can support memory/reputation.

Separate:

```text
Narrative line -> harmless, presentational
Choice/decision -> player input through typed client SDK
Predicate -> server-authoritative visibility/eligibility check
Effect -> supported command from authorized actor, event emitted, projection updated
```

Never grant an item because a dialogue component reached a paragraph. Commands must be idempotent and revalidated. In branching systems, read terminal conditions from the server, not dialogue-local browser state.

## Implementation strategies

The primary output is **structured MUDD content** in its current accepted format. Ink and Yarn Spinner illustrate helpful features such as node IDs, options, variables and conditions; they are not automatically installed dependencies. If the repo has an accepted adapter to Ink/Yarn, use it through approved public mapping and avoid introducing separate authoritative narrative variables that conflict with event sourcing.

A future generative NPC service must read **bounded authorized lore/quest projections**, attribute facts to sources, distinguish what the NPC knows from GM truth and treat generated text as *proposal*, not an authoritative event. No external LLM is necessary for normal authored dialogue. Never leak GM secret prompt text or private player information to an unintended player.

## Dialogue quality tests

- A first-time visitor understands who speaks and what is at issue.
- Options have distinguishable implications (where fiction implies stakes).
- No player can receive clues they never unlocked unless explicitly public.
- An NPC can tell a believable falsehood without corrupting the world truth ledger.
- Returning / hostile / allied players see correct conditional greetings where supported.
- Long names, narrow displays, terminal output, screen readers, translation expansion and interruption remain usable.
- A repeated choice does not duplicate an item, achievement, quest transition or payout.
- Narrative voice remains consistent across content authored in different sessions.
