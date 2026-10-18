import { describe, expect, it } from 'vitest';
import type { StoredGameEvent } from './types.js';
import { replayCharacter } from './replay.js';

function event(
  type: string,
  aggregateVersion: number,
  payload: Record<string, unknown>,
): StoredGameEvent {
  return {
    type,
    version: 1,
    eventId: `event-${aggregateVersion}`,
    worldInstanceId: 'world-test',
    streamId: 'character-test',
    aggregateId: 'character-test',
    aggregateVersion,
    causationCommandId: `command-${aggregateVersion}`,
    actorId: 'player-test',
    occurredAt: '2026-10-18T12:00:00.000Z',
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
});
