import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import type { EngineCommandContext } from '@mudd/engine-core';
import { demoWorld } from '@mudd/world-demo';
import { prepareCharacterRespawn } from './respawn.js';

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'character-1',
    name: 'Traveler',
    locationId: 'road',
    revision: 9,
    inventory: [],
    ...overrides,
  });
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    world: {
      respawn: { locationId: 'town' },
      locations: [{ id: 'town' }, { id: 'road' }],
      corpseLifecycle: demoWorld.corpseLifecycle,
    },
    makeId: vi.fn(() => 'generated-world-item'),
    rng: { roll: vi.fn(() => 1) },
    now: () => new Date('2026-10-27T12:00:00.000Z'),
    ...overrides,
  } as unknown as Pick<EngineCommandContext, 'world' | 'makeId' | 'rng' | 'now'>;
}

describe('prepareCharacterRespawn', () => {
  it('does not produce a respawn when the world has no configured location', () => {
    const result = prepareCharacterRespawn(
      character(),
      context({ world: { respawn: undefined, locations: [{ id: 'town' }] } }),
      'pve',
      'encounter-1',
      'road',
    );
    expect(result).toBeUndefined();
  });

  it('rejects a configured respawn location that is absent from the world', () => {
    expect(() => prepareCharacterRespawn(
      character(),
      context({ world: { respawn: { locationId: 'missing-town' }, locations: [] } }),
      'pve',
      'encounter-1',
      'road',
    )).toThrow('The configured respawn location is missing from this world.');
  });

  it('restores health without dropping an item when no inventory item is eligible', () => {
    const services = context();
    const result = prepareCharacterRespawn(
      character({
        inventory: [
          { id: 'quest-item', label: 'Quest item', description: 'Bound to a quest.', questBound: true },
          { id: 'excluded-item', label: 'Potion', description: 'A potion.' },
        ],
      }),
      services,
      'pvp',
      'encounter-2',
      'market',
      ['excluded-item'],
      12,
    );

    expect(result).toMatchObject({
      event: {
        type: 'character.respawned',
        version: 1,
        payload: {
          characterId: 'character-1',
          cause: 'pvp',
          encounterId: 'encounter-2',
          deathLocationId: 'market',
          respawnLocationId: 'town',
          health: { current: 12, maximum: 12 },
        },
      },
      effects: [],
    });
    expect(services.rng.roll).not.toHaveBeenCalled();
  });

  it('does not drop quest-bound takeables or equipped inventory items', () => {
    const player = character({
      inventory: [
        { id: 'bound-takeable', label: 'Seal', description: 'A quest seal.' },
        { id: 'equipped-shield', label: 'Shield', description: 'A carried shield.' },
      ],
      equipment: { weaponItemId: null, armorItemId: 'equipped-shield' },
    });
    const result = prepareCharacterRespawn(
      player,
      context({
        world: {
          respawn: { locationId: 'town' },
          locations: [
            { id: 'town' },
            { id: 'road', takeables: [{ id: 'bound-takeable', questBound: true }] },
          ],
          corpseLifecycle: demoWorld.corpseLifecycle,
        },
      }),
      'team-pve',
      'encounter-3',
      'road',
    );

    expect(result?.event).toMatchObject({ payload: { cause: 'team-pve' } });
    expect(result?.event.payload).not.toHaveProperty('droppedItem');
    expect(result?.effects).toEqual([]);
  });

  it('drops one eligible item into a player corpse and preserves existing shared-item identity', () => {
    const player = character({
      inventory: [
        { id: 'shared-crate', sharedItemId: 'shared-crate', label: 'Crate', description: 'A shared crate.' },
        { id: 'coin', label: 'Coin', description: 'A coin.' },
      ],
    });
    const services = context();
    const result = prepareCharacterRespawn(player, services, 'pve', 'encounter-4', 'road');

    expect(result?.event).toMatchObject({
      payload: {
        droppedItem: {
          sourceItemId: 'shared-crate',
          item: { id: 'shared-crate', sharedItemId: 'shared-crate' },
        },
      },
    });
    expect(result?.effects).toHaveLength(1);
    expect(result?.effects[0]).toMatchObject({
      type: 'world-corpse.create',
      payload: {
        corpse: {
          encounterId: 'encounter-4',
          opponentId: player.characterId,
          opponentName: player.name,
          locationId: 'road',
          corpseType: 'player',
          ownerCharacterId: player.characterId,
        },
      },
    });
    expect(services.rng.roll).toHaveBeenCalledWith(2);
  });

  it('rejects an out-of-range authoritative item selection', () => {
    const player = character({
      inventory: [{ id: 'item', label: 'Item', description: 'A carried item.' }],
    });
    const services = context({ rng: { roll: vi.fn(() => 2) } });
    expect(() => prepareCharacterRespawn(player, services, 'pve', 'encounter-5', 'road'))
      .toThrow('The authoritative RNG returned an out-of-range item selection.');
  });
});
