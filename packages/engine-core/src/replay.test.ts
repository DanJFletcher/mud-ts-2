import { describe, expect, it } from 'vitest';
import type { StoredGameEvent } from './types.js';
import { replayCharacter } from './replay.js';
import { resolveStaminaRecovery } from '@mudd/contracts';

function event(
  type: string,
  aggregateVersion: number,
  payload: Record<string, unknown>,
  version = 1,
  occurredAt = '2026-10-18T12:00:00.000Z',
): StoredGameEvent {
  return {
    type,
    version,
    eventId: `event-${aggregateVersion}`,
    worldInstanceId: 'world-test',
    streamId: 'character-test',
    aggregateId: 'character-test',
    aggregateVersion,
    causationCommandId: `command-${aggregateVersion}`,
    actorId: 'player-test',
    occurredAt,
    tick: 0,
    payload,
  };
}

const created = event('character.created', 1, {
  characterId: 'character-test',
  playerId: 'player-test',
  name: 'Rowan',
  startingLocationId: 'mossgate-clearing',
});

describe('character event replay validation', () => {
  it('replays legacy stamina defaults, exact recovery, posture transitions, and movement restrictions', () => {
    const start = new Date('2026-10-18T12:00:00.000Z');
    const createdV2 = event('character.created', 1, {
      characterId: 'character-test',
      playerId: 'player-test',
      name: 'Rowan',
      startingLocationId: 'mossgate-clearing',
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
    }, 2);
    const legacy = replayCharacter([created]);
    expect(legacy?.staminaRecovery).toEqual({
      posture: 'standing',
      lastSettledAt: null,
      fractionalCarry: 0,
    });

    const initial = replayCharacter([createdV2])!;
    const anchored = resolveStaminaRecovery(
      initial.resources.stamina,
      initial.staminaRecovery,
      start,
    );
    const initialAnchor = event('character.stamina_recovery_settled', 2, {
      characterId: initial.characterId,
      resources: { ...initial.resources, stamina: anchored.stamina },
      recovery: anchored.recovery,
    }, 1, start.toISOString());
    const anchoredProjection = replayCharacter([createdV2, initialAnchor])!;
    const standingRecoveryAt = new Date(start.getTime() + 1_000);
    const standing = resolveStaminaRecovery(
      anchoredProjection.resources.stamina,
      anchoredProjection.staminaRecovery,
      standingRecoveryAt,
    );
    const standingEvent = event('character.stamina_recovery_settled', 3, {
      characterId: initial.characterId,
      resources: { ...anchoredProjection.resources, stamina: standing.stamina },
      recovery: standing.recovery,
    }, 1, standingRecoveryAt.toISOString());
    const postureEvent = event('character.posture_changed', 4, {
      characterId: initial.characterId,
      posture: 'resting',
      locationId: initial.locationId,
    }, 1, standingRecoveryAt.toISOString());
    const afterRest = replayCharacter([createdV2, initialAnchor, standingEvent, postureEvent])!;
    expect(afterRest.resources.stamina.current).toBe(1);
    expect(afterRest.staminaRecovery.posture).toBe('resting');

    const restingRecoveryAt = new Date(start.getTime() + 2_000);
    const rested = resolveStaminaRecovery(
      afterRest.resources.stamina,
      afterRest.staminaRecovery,
      restingRecoveryAt,
    );
    const restingEvent = event('character.stamina_recovery_settled', 5, {
      characterId: initial.characterId,
      resources: { ...afterRest.resources, stamina: rested.stamina },
      recovery: rested.recovery,
    }, 1, restingRecoveryAt.toISOString());
    expect(replayCharacter([createdV2, initialAnchor, standingEvent, postureEvent, restingEvent])?.resources.stamina.current).toBe(4);
    expect(() => replayCharacter([
      createdV2,
      initialAnchor,
      standingEvent,
      postureEvent,
      restingEvent,
      event('character.moved', 6, {
        characterId: initial.characterId,
        fromLocationId: initial.locationId,
        toLocationId: 'glasswater-bridge',
        exitId: 'clearing-to-bridge',
        movementCost: 5,
      }),
    ])).toThrow(/invalid movement event/i);
  });

  it('keeps legacy character streams valid without progression and rejects duplicate victory rewards', () => {
    const legacyCharacter = replayCharacter([created]);
    expect(legacyCharacter?.advancement).toBeUndefined();
    expect(legacyCharacter?.attributes).toEqual({
      strength: 10,
      intelligence: 10,
      constitution: 10,
      dexterity: 10,
    });
    expect(legacyCharacter?.honors).toEqual({ glory: 0, medals: 0 });

    const victory = event('character.combat_action_resolved', 2, {
      characterId: 'character-test',
      damageDealt: 4,
      damageTaken: 0,
      encounter: {
        encounterId: 'encounter-test',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 6,
        playerMaxHealth: 6,
        opponentHealth: 0,
        opponentMaxHealth: 4,
        status: 'victory',
        lastAction: 'attack',
        lastNarration: 'You defeat the sentinel.',
      },
    });
    const reward = event('character.advancement_awarded', 3, {
      characterId: 'character-test',
      encounterId: 'encounter-test',
      experienceAwarded: 10,
      totalExperience: 10,
      level: 1,
    });
    expect(replayCharacter([created, victory, reward])?.advancement).toEqual({
      experience: 10,
      level: 1,
      lastRewardedEncounterId: 'encounter-test',
    });
    expect(() => replayCharacter([
      created,
      victory,
      reward,
      event('character.advancement_awarded', 4, {
        characterId: 'character-test',
        encounterId: 'encounter-test',
        experienceAwarded: 10,
        totalExperience: 20,
        level: 2,
      }),
    ])).toThrow(/invalid character advancement event/i);
  });

  it('rejects unknown event types instead of silently skipping them', () => {
    expect(() => replayCharacter([
      created,
      event('character.renamed.v2', 2, { characterId: 'character-test', name: 'Rill' }),
    ])).toThrow(/unsupported event type/i);
  });

  it('validates rename payloads against the event contract', () => {
    expect(() => replayCharacter([
      created,
      event('character.renamed', 2, { characterId: 'character-test', name: 123 }),
    ])).toThrow();
  });

  it('rejects replaying a drop event for a quest-bound item', () => {
    const taken = event('character.item_taken', 2, {
      characterId: 'character-test',
      locationId: 'mossgate-clearing',
      item: {
        id: 'quest-stone',
        label: 'Quest stone',
        description: 'A marked stone.',
      },
    });
    const dropped = event('character.item_dropped', 3, {
      characterId: 'character-test',
      locationId: 'mossgate-clearing',
      item: {
        id: 'quest-stone',
        label: 'Quest stone',
        description: 'A marked stone.',
        questBound: true,
      },
    });

    expect(() => replayCharacter([created, taken, dropped])).toThrow(/invalid item dropped event/i);
  });

  it('rejects gaps in aggregate revisions', () => {
    expect(() => replayCharacter([
      created,
      event('character.archived', 3, { characterId: 'character-test' }),
    ])).toThrow(/non-contiguous aggregate revision/i);
  });

  it('replays version-1 combat events as steady-style encounters', () => {
    const legacyCombat = event('character.combat_action_resolved', 2, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 1,
      encounter: {
        encounterId: 'combat-legacy',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'mossgate-training-sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The practice begins.',
      },
    });

    expect(replayCharacter([created, legacyCombat])?.combat).toMatchObject({
      encounterId: 'combat-legacy',
      opponentStyle: 'steady',
    });
  });

  it('replays legacy encounters that restarted at full health before persistent health was introduced', () => {
    const firstRound = event('character.combat_action_resolved', 2, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 1,
      encounter: {
        encounterId: 'combat-legacy-first',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The practice begins.',
      },
    }, 2);
    const firstVictory = event('character.combat_action_resolved', 3, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 0,
      encounter: {
        encounterId: 'combat-legacy-first',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 2,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 0,
        opponentMaxHealth: 4,
        status: 'victory',
        lastAction: 'attack',
        lastNarration: 'You defeat the sentinel.',
      },
    }, 2);
    const secondEncounter = event('character.combat_action_resolved', 4, {
      characterId: 'character-test',
      damageDealt: 2,
      damageTaken: 1,
      encounter: {
        encounterId: 'combat-legacy-second',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'sentinel',
        opponentName: 'Practice Sentinel',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 2,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The practice begins again.',
      },
    }, 2);

    expect(replayCharacter([created, firstRound, firstVictory, secondEncounter])?.combat)
      .toMatchObject({ encounterId: 'combat-legacy-second', playerHealth: 5 });
  });
});
