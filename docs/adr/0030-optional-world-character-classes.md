# ADR 0030: Optional world-owned character classes

- **Status:** Accepted for starter implementation; Orraveth class labels and mappings are provisional gameplay design.
- **Date:** 2026-10-23

## Decision and boundaries

Worlds opt in with a validated, versioned catalog and a matching ruleset capability.
The host's generic world-validation lifecycle rejects missing or mismatched capabilities
before it starts. The kernel has no class enum, catalog, or class damage formula.
Waystone has neither catalog nor capability and retains name-only creation, its
balanced attributes, existing equipment, recovery, XP, level cap, and formulas.

Creation in an opted-in world requires a catalog class ID. Selection records the
entire definition, catalog ID/revision, base attributes, automatic level-one action,
and starting health. Old creation versions remain readable. Existing characters
are never assigned implicitly: a one-time, revision-checked adoption command records
a new event without rerunning creation. Selection is permanent in this release.
It neither grants inventory, XP, nor currency, nor restores health or resources.

On adoption, current health is preserved (or clamped if necessary); maximum health
is recorded using the new Constitution and existing level. If health was previously
implicit, the previous classless maximum is treated as current health, so adopting
Vanguard exposes an empty extra health point rather than healing. No historical
events or recorded attributes are rewritten. Level-up still uses the existing
Constitution-based maximum; base attributes do not auto-grow.

The character-owned snapshot, not the latest catalog, resolves an existing
character's action. Future catalog revisions affect new choices only. Preserve
historical IDs/revisions; a future explicit migration requires its own design.
Resolved damage/health, ability ID/revision, cost and remaining resource are facts
in events. Replay does not load a catalog, reroll, or apply new balance definitions.

## Starter balance (original, provisional design)

| Class | STR | INT | CON | DEX | Basic Attack | Starting action | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Vanguard | 15 | 10 | 15 | 10 | 3 | Heavy Strike: 4 damage | 20 stamina |
| Scout | 15 | 10 | 10 | 15 | 3 | Precise Strike: 4 damage | 15 stamina |
| Kindler | 10 | 15 | 10 | 15 | 2 | Directed Heat: 4 damage | 20 mana |

Values are unarmored level-one values without gear. Every class has a 50-point fixed
attribute distribution; Vanguard starts with 7 health, the others with 6. Resource
maxima stay 100. One point of ability damage is added per five primary-attribute
points above 10, on an authored base of 3. Martial actions include the existing
weapon bonus; Directed Heat does not. Vanguard/Scout basic physical Attack uses
Strength/Dexterity respectively; Kindler's basic Attack still uses Strength.
Constitution health and existing flat armor/guard behavior are retained. Ordinary
Attack remains free and available at zero stamina/mana.

These values use existing six-health characters, two-damage basic attacks and small
practice encounters as the baseline: a core action improves a single turn, but is
finite (five heavy/heat actions or six precise actions from full resources). It
does not activate critical, dodge, regeneration, stance, stealth or movement costs.

## Shared-combat consistency

Solo outcomes and resource debits append together to the character stream. Team
and PvP turns append to shared streams; their ability debits are atomic companion
writes to the character stream in the **same event-store transaction**, not an
eventually successful charge after a free attack. Both revisions must match or
nothing commits, including no queued effects. Command identity spans the complete
transaction, making retries lossless. PostgreSQL locks all observed/written streams
in deterministic order; the memory adapter validates all preconditions before
mutation without yielding. Adapters must implement these atomic semantics, never
emulate them with sequential appends.

Existing durable effects still apply terminal shared health, loot, respawn and XP,
but they never spend ability resources a second time. Read guards serialize class
adoption with encounter starts. Adoption rejects active solo/team/PvP and resolving
PvP or unapplied team outcomes. Class-enabled starts guard participant revisions so
a concurrent adoption cannot leave a stale encounter stat snapshot. Resources may
change between shared turns, but each debit uses the current character revision,
preventing spending races from committing a partial turn.

In class-enabled worlds, team flee also uses an atomic companion debit at its
existing 20-stamina price. Otherwise a pending flee charge could race a subsequent
ability after outcome delivery. Classless worlds retain their existing flee
effect and recovery semantics unchanged.

## Reference mapping and roadmap

Reference: <https://docs.writtenrealms.com/playing/your-character/> (consulted
2026-10-23). Adopted ideas: world-specific creation choices, attributes appropriate
to a class, automatically available core actions, and later optional build choices.
No skill prose, four-class taxonomy, formulas, equipment permissions, unlock
schedule, automatic attribute recalculation, quest XP, or larger level cap was
copied.

Vanguard, Scout, and Kindler are **new proposed gameplay labels**, not established
Orraveth lore, institutions, or a replacement for Resonance disciplines. Kindler's
bounded directed-heat action describes patterns directing existing energy with
costs and limits; it establishes neither creation from nothing nor magic's source.
Existing Orraveth residents remain noncombatants and no encounters are added.
Combat coverage uses an authorized test host and explicitly fixture-only opponents.

1. Starter release: these three classes, one core action each, creation, adoption,
   character views and solo/team/accepted-PvP controls.
2. Next: more bounded core skills and separately authored Orraveth encounters,
   balanced and playtested without turning residents hostile.
3. Then: optional flex skills/feats within levels 1–10, after selection authority,
   snapshots, eligibility and persistence are specified.
4. Later: support/ally interactions and subclasses only after targeting, consent,
   cross-aggregate ownership and narrative/content requirements are designed.
