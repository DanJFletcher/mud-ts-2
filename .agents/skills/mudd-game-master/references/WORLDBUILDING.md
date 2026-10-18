# Worldbuilding: coherent worlds that play

## Minimum world bible

Worldbuilding starts with **what players can do**, not with thousands of years of lore. Write, in order:

1. **Player promise:** what feelings and conflicts distinguish this world? List 3–5 recurring player verbs.
2. **Physical affordances:** geography, routes, travel friction, hazards, environmental shifts, resource ecology.
3. **People and culture:** how inhabitants make a living; food, labor, trade, holidays, governance, faiths and stories; viewpoints within cultures rather than stereotypes.
4. **Pressures:** scarce resources, political interests, ecological tensions, broken agreements, threats from within and beyond. Identify the player-intervention opportunities.
5. **Everyday life:** who is there during an ordinary day, what systems keep a settlement running, what changes during night/weather/season.
6. **Mysteries:** buried truths and discoverable surfaces; each secret should have clues and a legitimate means of discovery.
7. **Change:** what happens absent player action, and how the world plausibly reacts if players interrupt.

Aim for **high-density, low-exposition** design: 1 hub, 3–5 connected places, 3 distinct NPCs, 2–3 meaningful tensions, 1 running clock. Expand when players can already complete a loop.

## Canon and knowledge ledger

For every consequential fact, record a stable ID and:

- `truth`: what is true for authors/admins;
- `status`: canon / mutable / historical / rumor / draft;
- `knownTo`: which NPCs/factions/characters might know it;
- `evidence`: which real player actions can reveal or verify it;
- `visibility`: gm-only, discovered-by, public-to-world, party, character;
- `source`, `introducedVersion`, `lastReviewed`.

Contradictions can be **intentional** when different sources disagree. Distinguish *disputed in fiction* from *accidental canon error*. Do not store spoilers inside player-readable location payloads, even behind UI conditions.

## Geography and spatial representation

Specify rooms/locations with stable IDs, labels, and logical links (north/south/east/west etc. only where geographically justified). Keep travel graph strongly usable; label one-way exits, locked edges and necessary unlock predicates. A region can be explored without a map image. Need a player orientation sentence: where they are, what they can see, what exits are evident.

Every important place should have: landmark, sensory texture, player interaction, relationship to another place, an inhabitant/object, and a mutable state or valuable discovery. Lived-in details justify economies; a smith needs ore and customers, and a fishing village needs water, storage and buyers.

## Factions as active systems

Faction template: ideal, concrete objective, spokesperson, public posture, hidden conflict, resources, constraints, relationships, offered bargains, red lines, and *next move if nobody intervenes*. Avoid evil/good labels as substitutes for motives. Example: a river guild protects navigation and charges tolls; farmers need irrigation; a town council must balance both.

Track **pressure clocks** as content design objects only when the time/quest plugin supports a matching authoritative state primitive. Otherwise label `requiresCapability` and use story documentation rather than hacking timers. Player-visible signals should precede important deadlines. Do not advance the clock simply because an NPC line was rendered.

## Multiplayer worlds and ownership

Clarify whether a narrative change is:

- **Shared world-wide:** bridge destroyed, mayor replaced, market depleted.
- **Per campaign/instance:** ritual resolved differently in parallel instances.
- **Per party:** party discovered a clue, accepted a job.
- **Per character:** trust in an NPC, journal entries, choices, reputation.
- **Ephemeral/session-only:** temporary text drafts, preview.

Never allow contradictory shared terminal states through independent per-character flags. For player-owned buildings, settlements and resources, define how authorial narrative reacts to player-created entities rather than overwriting them with scripted set dressing. Player claims/transactions use land/economy plugins, not lore mutations.

## Useful pressure questions

- Why would a curious player go here *today*?
- What does the ordinary population do while players are absent?
- What new problem does an apparent solution create?
- Can someone else plausibly possess the missing information or resource?
- Which condition tells the world to change after the players intervene?
- Does the world's history explain its current incentives, instead of burdening players with encyclopedia entries?

## Canon reviews

Run name/ID collision, timeline contradiction, travel connectivity, resource provenance, faction-goal contradiction, secret visibility, pronoun/style, localization and license provenance checks. Track accepted revisions as additions to the bible rather than silently rewriting published history. Retcons need an explicit migration and player-facing explanation when they alter established shared state.
