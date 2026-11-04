import { describe, expect, it } from 'vitest';
import {
  replayCharacterArchived,
  replayCharacterCreated,
  replayCharacterRenamed,
  replayCharacterRestored,
} from './lifecycle.js';
import type { StoredGameEvent } from '../types.js';

function event(type: string, revision: number, payload: Record<string, unknown>, version = 1): StoredGameEvent {
  return {
    type, version, payload, aggregateVersion: revision, eventId: `event-${revision}`,
    worldInstanceId: 'world', streamId: 'character', aggregateId: 'character',
    causationCommandId: `command-${revision}`, actorId: 'player', occurredAt: '2026-01-01T00:00:00.000Z', tick: revision,
  };
}

describe('character lifecycle replay handlers', () => {
  it('creates a legacy projection with default resources and the recorded starting location', () => {
    const created = replayCharacterCreated(event('character.created', 1, {
      characterId: 'character', playerId: 'player', name: 'Rowan', startingLocationId: 'village',
    }));

    expect(created).toMatchObject({
      worldInstanceId: 'world', characterId: 'character', name: 'Rowan',
      locationId: 'village', visitedLocationIds: ['village'], revision: 1,
      resources: { stamina: { current: 100 }, mana: { current: 100 } },
    });
  });

  it('applies rename, archive, and restore transitions in order', () => {
    const created = replayCharacterCreated(event('character.created', 1, {
      characterId: 'character', playerId: 'player', name: 'Rowan', startingLocationId: 'village',
    }));
    const renamed = replayCharacterRenamed(created, event('character.renamed', 2, {
      characterId: 'character', name: 'Ash',
    }));
    const archived = replayCharacterArchived(renamed, event('character.archived', 3, { characterId: 'character' }));
    const restored = replayCharacterRestored(archived, event('character.restored', 4, { characterId: 'character' }));

    expect(restored).toMatchObject({ name: 'Ash', archived: false, revision: 4 });
  });

  it('retains creation and lifecycle validation errors', () => {
    const classAttributes = { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 };
    const malformed = event('character.created', 1, {
      characterId: 'character', playerId: 'player', name: 'Rowan', startingLocationId: 'village',
      attributes: { ...classAttributes, strength: 11 },
      characterClass: {
        id: 'class', revision: 1, catalogId: 'catalog', catalogRevision: 1, label: 'Vanguard',
        description: 'Fixture', primaryAttribute: 'strength', attributes: classAttributes,
        coreAction: {
          id: 'action', revision: 1, label: 'Strike', description: 'Fixture',
          cost: { resource: 'stamina', amount: 1 }, baseDamage: 1,
          scalingAttribute: 'strength', weaponBonus: false,
        },
      },
      health: { current: 6, maximum: 6 },
      resources: { stamina: { current: 100, maximum: 100 }, mana: { current: 100, maximum: 100 } },
    }, 3);
    const created = replayCharacterCreated(event('character.created', 1, {
      characterId: 'character', playerId: 'player', name: 'Rowan', startingLocationId: 'village',
    }));

    expect(() => replayCharacterCreated(malformed)).toThrow('Class creation attributes must match its recorded snapshot.');
    expect(() => replayCharacterRenamed(created, event('character.renamed', 2, {
      characterId: 'other', name: 'Ash',
    }))).toThrow('Invalid rename event at revision 2.');
  });
});
