# ADR 0027: Character-owned stamina and mana

- **Status:** Accepted
- **Date:** 2026-10-22
- **Owners:** Engine and game client
- **Related tasks:** None

## Context

The game already projects stamina and mana regeneration ratings, but characters have no stamina or mana pools and no gameplay action consumes them. Combat is turn-based, the existing `flee` action is supported in solo and party PvE, and inn rest is a paid full-health restore. The external combat reference also includes timed regeneration, skills, spells, and cooldowns, none of which the current game has.

## Decision

- Stamina and mana are persistent resources owned by the character aggregate. Each pool has a current and maximum value, both initialized to 100 for new characters. Legacy character streams replay with full 100/100 pools until an event changes them.
- Solo PvE flee costs 20 stamina. The combat command rejects a flee when the character has less than 20 stamina, without resolving the turn or allowing the opponent to act.
- Party PvE flee has the same cost and precondition. Because party turns are stored in a shared encounter stream, the party action commits first and queues an idempotent effect that records the stamina expenditure in the character stream.
- Inn rest retains its authored price and atomically restores health, stamina, and mana to their current maxima. Rest is available when any of those pools is below maximum; it remains unavailable during active solo combat and after character death.
- The Vitals screen displays server-projected current/max values for health, stamina, and mana. Clients do not calculate or mutate resource state.
- Mana is tracked and restored but is not spent until magical actions exist. Passive/timed regeneration, a resting state, skills, spells, cooldowns, and resource-stat formulas remain deferred.
- Resource pools and changes are versioned character events. No database migration or new aggregate is introduced; existing one-active-character-per-world-session behavior is unchanged.

## Alternatives considered

| Option | Benefits | Costs / rejected reason |
| --- | --- | --- |
| Track both pools without costs | Minimal first step | Does not make stamina or mana affect play |
| Add persistent pools, stamina flee cost, and inn recovery | Fits current turn-based combat and existing rest command | Leaves magical costs and timed regeneration for later |
| Port the full external combat loop | Includes skills, spells, cooldowns, and timed regeneration | Requires a real-time combat clock and action model that this game does not have |

## Consequences and trade-offs

- **Positive:** Resource ownership follows existing character health and equipment boundaries; solo flee and inn restoration are replayable and atomic.
- **Negative:** Party flee spending is applied by an idempotent durable effect after the party action event, so the character projection may briefly lag the encounter result.
- **Compatibility/migration:** Existing character-created and combat events remain readable. New character creation records the resource snapshot; legacy streams use fixed full-resource defaults. Inn-rest event version 1 remains readable; version 2 records restored resources.
- **Security/abuse/trust:** Only server-side combat and inn handlers determine resource costs and resulting values. Client UI may disable an unaffordable flee for usability, but the server validates it authoritatively.
- **Performance/operational:** Adds character-stream events and one small effect for party flee; no tables or polling systems are added.
- **Rollback/reversibility:** Resource events remain replayable if the mechanics are disabled. Do not delete their schemas or replay branches after events have been persisted.

## Verification

- Verify new characters start with 100/100 stamina and mana, and legacy streams replay to those same defaults.
- Verify solo and party flee spend 20 stamina exactly once, and reject insufficient stamina.
- Verify inn rest charges the existing price and restores all three resources atomically, including resource-only rest when health is full.
- Verify duplicate command/effect delivery does not duplicate resource changes and that the Vitals screen shows projected values.

## Follow-up / revisit trigger

Revisit before adding active spell/skill costs, passive/timed regeneration, resting states, PvP resource spending, or resource maximum formulas. Those systems need explicit action timing and balance rules.
