import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { fishingPlugin, validateFishingSpots } from './fishing.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');

const bass = {
  id: 'bass',
  name: 'Smallmouth bass',
  itemTypeId: 'smallmouth-bass',
  weightPercent: 50,
  sizeBands: [{
    rarity: 'common' as const,
    weightPercent: 100,
    minLengthCm: 20,
    maxLengthCm: 30,
    minWeightGrams: 100,
    maxWeightGrams: 110,
  }],
};

const trout = {
  ...bass,
  id: 'trout',
  name: 'Rainbow trout',
  itemTypeId: 'rainbow-trout',
  weightPercent: 50,
};

const SPOT = {
  id: 'south-bridge',
  locationId: 'river-bridge',
  label: 'South Bridge',
  tickSeconds: 1,
  species: [bass, trout],
};

const ROD = {
  id: 'old-rod',
  typeId: 'fishing-rod',
  label: 'Old Rod',
  description: 'A worn fishing rod.',
  fishingRod: { qualityId: 'old', biteChancePercent: 10, waitSeconds: 2 },
};

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'angler-1',
    name: 'Angler',
    locationId: 'river-bridge',
    revision: 2,
    health: { current: 10, maximum: 10 },
    inventory: [ROD],
    ...overrides,
  });
}

function activeCast(startedAt = new Date(NOW.getTime() - 1000).toISOString(), overrides: Record<string, unknown> = {}) {
  return {
    castId: 'cast-1',
    spotId: SPOT.id,
    locationId: 'river-bridge',
    rodItemId: ROD.id,
    rodQualityId: 'old',
    startedAt,
    tickIntervalSeconds: 1,
    ticksRequired: 2,
    ticksCompleted: 0,
    ...overrides,
  };
}

function harness(
  player: ReturnType<typeof character>,
  options: {
    spots?: Array<typeof SPOT>;
    teamEvents?: Array<Record<string, unknown>>;
    pvpEvents?: Array<Record<string, unknown>>;
    rolls?: number[];
    defaultStateId?: string;
  } = {},
) {
  const handlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const rollValues = [...(options.rolls ?? [])];
  fishingPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    requireCapability: () => ({ load: vi.fn(async () => player) }),
  } as never);
  const context = {
    world: {
      locations: [{ id: 'river-bridge', defaultStateId: options.defaultStateId }],
      fishingSpots: options.spots ?? [SPOT],
    },
    worldInstanceId: 'world-1',
    store: {
      readStream: vi.fn(async (_worldId: string, streamId: string) =>
        streamId === 'world-team-combat' ? options.teamEvents ?? [] : options.pvpEvents ?? []),
    },
    now: () => NOW,
    makeId: () => 'fish-generated-id',
    rng: { roll: vi.fn(() => rollValues.shift() ?? 100) },
  };
  return { handlers, context };
}

function command(characterId: string, revision: number, payload: Record<string, unknown>) {
  return { characterId, expectedVersion: revision, payload };
}

describe('fishing world validation', () => {
  it('accepts spots connected to world locations', () => {
    expect(() => validateFishingSpots({
      locations: [{ id: 'river-bridge' }],
      fishingSpots: [SPOT],
    } as never)).not.toThrow();
  });

  it('rejects duplicate spot IDs and spots attached to missing locations', () => {
    expect(() => validateFishingSpots({
      locations: [{ id: 'river-bridge' }],
      fishingSpots: [SPOT, { ...SPOT }],
    } as never)).toThrow('Fishing spots require unique IDs and a valid world location.');
    expect(() => validateFishingSpots({
      locations: [{ id: 'river-bridge' }],
      fishingSpots: [{ ...SPOT, locationId: 'missing-room' }],
    } as never)).toThrow('Fishing spots require unique IDs and a valid world location.');
  });
});

describe('fishing.cast', () => {
  it('starts a cast at a designated spot with the rod timing', async () => {
    const player = character();
    const { handlers, context } = harness(player);

    const result = await handlers.get('fishing.cast')!(
      command(player.characterId, player.revision, { rodItemId: ROD.id }),
      context,
    );

    expect(result).toMatchObject({
      events: [{
        type: 'character.fishing_cast_started',
        version: 1,
        payload: {
          characterId: player.characterId,
          cast: {
            spotId: SPOT.id,
            rodItemId: ROD.id,
            rodQualityId: 'old',
            tickIntervalSeconds: 1,
            ticksRequired: 2,
            ticksCompleted: 0,
          },
        },
      }],
    });
  });

  it('requires a live character, a spot, the proper bridge side, and a rod', async () => {
    const player = character();
    const { handlers, context } = harness(player);
    const cast = handlers.get('fishing.cast')!;

    const unavailableHandlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
    fishingPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        unavailableHandlers.set(name, handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    await expect(unavailableHandlers.get('fishing.cast')!(
      command(player.characterId, player.revision, { rodItemId: ROD.id }),
      context,
    )).rejects.toThrow('That character is no longer available.');

    await expect(cast(command(player.characterId, player.revision, { rodItemId: ROD.id }), {
      ...context, world: { ...context.world, fishingSpots: [] },
    })).rejects.toThrow('There is no designated fishing spot here.');
    const wrongBank = harness(player, {
      defaultStateId: 'north-bank',
      spots: [{ ...SPOT, stateId: 'south-bank' } as never],
    });
    await expect(wrongBank.handlers.get('fishing.cast')!(
      command(player.characterId, player.revision, { rodItemId: ROD.id }),
      wrongBank.context,
    )).rejects.toThrow('You cannot fish from this side of the bridge.');

    const noRod = character({ inventory: [] });
    const noRodHarness = harness(noRod);
    await expect(noRodHarness.handlers.get('fishing.cast')!(
      command(noRod.characterId, noRod.revision, { rodItemId: ROD.id }),
      noRodHarness.context,
    )).rejects.toThrow('You need to carry a fishing rod to fish.');
  });

  it('blocks a cast during combat, including shared team combat', async () => {
    const player = character({
      combat: {
        encounterId: 'encounter-1', locationId: 'river-bridge', opponentNpcId: 'bandit',
        opponentName: 'Bandit', round: 1, playerHealth: 10, playerMaxHealth: 10,
        opponentHealth: 10, opponentMaxHealth: 10, status: 'active',
        lastAction: 'encounter', lastNarration: 'A bandit approaches.',
      },
    });
    const { handlers, context } = harness(player);
    await expect(handlers.get('fishing.cast')!(
      command(player.characterId, player.revision, { rodItemId: ROD.id }),
      context,
    )).rejects.toThrow('You cannot fish during combat.');

    const sharedPlayer = character();
    const shared = harness(sharedPlayer, {
      teamEvents: [{
        type: 'team.road_encounter_started',
        payload: { encounter: { encounterId: 'team-encounter', status: 'active', participants: [
          { characterId: sharedPlayer.characterId, status: 'active' },
        ] } },
      }],
    });
    await expect(shared.handlers.get('fishing.cast')!(
      command(sharedPlayer.characterId, sharedPlayer.revision, { rodItemId: ROD.id }),
      shared.context,
    )).rejects.toThrow('You cannot fish during combat.');
  });
});

describe('fishing.advance', () => {
  it('rejects advancement when the character is unavailable', async () => {
    const player = character({ activeFishing: activeCast() });
    const handlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
    fishingPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        handlers.set(name, handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    const { context } = harness(player);

    await expect(handlers.get('fishing.advance')!(
      command(player.characterId, player.revision, { castId: 'cast-1' }),
      context,
    )).rejects.toThrow('That character is no longer available.');
  });

  it('rejects missing casts and casts with no elapsed tick', async () => {
    const player = character();
    const inactive = harness(player);
    await expect(inactive.handlers.get('fishing.advance')!(
      command(player.characterId, player.revision, { castId: 'missing-cast' }),
      inactive.context,
    )).rejects.toThrow('That fishing cast is no longer active.');

    const casting = character({ activeFishing: activeCast(NOW.toISOString()) });
    const notReady = harness(casting);
    await expect(notReady.handlers.get('fishing.advance')!(
      command(casting.characterId, casting.revision, { castId: 'cast-1' }),
      notReady.context,
    )).rejects.toThrow('Your line is still in the water.');
  });

  it('marks a cast interrupted when its location, rod, spot, or combat state becomes invalid', async () => {
    const cast = activeCast();
    const moved = character({ locationId: 'other-room', activeFishing: cast });
    const movedHarness = harness(moved);
    const movedResult = await movedHarness.handlers.get('fishing.advance')!(
      command(moved.characterId, moved.revision, { castId: cast.castId }),
      movedHarness.context,
    );
    expect(movedResult).toMatchObject({ events: [{ payload: { status: 'interrupted', tickRolls: [] } }] });

    const withoutRod = character({ inventory: [], activeFishing: cast });
    const noRodHarness = harness(withoutRod);
    const noRodResult = await noRodHarness.handlers.get('fishing.advance')!(
      command(withoutRod.characterId, withoutRod.revision, { castId: cast.castId }),
      noRodHarness.context,
    );
    expect(noRodResult).toMatchObject({ events: [{ payload: { status: 'interrupted' } }] });

    const atRest = character({
      activeFishing: cast,
      staminaRecovery: { posture: 'resting', lastSettledAt: NOW.toISOString(), fractionalCarry: 0 },
    });
    const resting = harness(atRest);
    const restResult = await resting.handlers.get('fishing.advance')!(
      command(atRest.characterId, atRest.revision, { castId: cast.castId }),
      resting.context,
    );
    expect(restResult).toMatchObject({ events: [{ payload: { status: 'interrupted' } }] });
  });

  it('records a catch with weighted species, rarity, and measured size', async () => {
    const player = character({ activeFishing: activeCast() });
    const { handlers, context } = harness(player, { rolls: [1, 51, 1, 2, 3] });

    const result = await handlers.get('fishing.advance')!(
      command(player.characterId, player.revision, { castId: 'cast-1' }),
      context,
    );

    expect(result).toMatchObject({
      events: [{
        type: 'character.fishing_cast_advanced',
        payload: {
          status: 'caught',
          ticksCompleted: 1,
          tickRolls: [{ tick: 1, roll: 1, caught: true }],
          item: {
            typeId: 'rainbow-trout',
            label: 'Rainbow trout',
            fishCatch: { speciesId: 'trout', rarity: 'common', lengthCm: 21, weightGrams: 102 },
          },
        },
      }],
    });
  });

  it('uses rod species overrides and rejects a rod that cannot catch any listed fish', async () => {
    const selectiveRod = {
      ...ROD,
      fishingRod: { ...ROD.fishingRod, speciesWeightOverrides: { bass: 0, trout: 100 } },
    };
    const selectivePlayer = character({ inventory: [selectiveRod], activeFishing: activeCast() });
    const selective = harness(selectivePlayer, { rolls: [1, 1, 1, 1, 1] });
    const selected = await selective.handlers.get('fishing.advance')!(
      command(selectivePlayer.characterId, selectivePlayer.revision, { castId: 'cast-1' }),
      selective.context,
    );
    expect(selected).toMatchObject({
      events: [{ payload: { item: { fishCatch: { speciesId: 'trout' } } } }],
    });

    const cannotCatch = {
      ...ROD,
      fishingRod: { ...ROD.fishingRod, speciesWeightOverrides: { bass: 0, trout: 0 } },
    };
    const unablePlayer = character({ inventory: [cannotCatch], activeFishing: activeCast() });
    const unable = harness(unablePlayer, { rolls: [1] });
    await expect(unable.handlers.get('fishing.advance')!(
      command(unablePlayer.characterId, unablePlayer.revision, { castId: 'cast-1' }),
      unable.context,
    )).rejects.toThrow('No fish can be caught here with this rod.');
  });

  it('reports waiting after a missed bite and no-bite after the final failed tick', async () => {
    const player = character({ activeFishing: activeCast() });
    const waiting = harness(player, { rolls: [100] });
    const waitingResult = await waiting.handlers.get('fishing.advance')!(
      command(player.characterId, player.revision, { castId: 'cast-1' }),
      waiting.context,
    );
    expect(waitingResult).toMatchObject({
      events: [{ payload: { status: 'waiting', ticksCompleted: 1, tickRolls: [{ caught: false }] } }],
    });

    const finalPlayer = character({
      activeFishing: activeCast(new Date(NOW.getTime() - 2000).toISOString()),
    });
    const final = harness(finalPlayer, { rolls: [100, 100] });
    const finalResult = await final.handlers.get('fishing.advance')!(
      command(finalPlayer.characterId, finalPlayer.revision, { castId: 'cast-1' }),
      final.context,
    );
    expect(finalResult).toMatchObject({
      events: [{ payload: { status: 'no-bite', ticksCompleted: 2, tickRolls: [{ caught: false }, { caught: false }] } }],
    });
  });
});

describe('fishing.cancel', () => {
  it('records an interruption when the player cancels an active cast', async () => {
    const player = character({ activeFishing: activeCast(NOW.toISOString(), { ticksCompleted: 1 }) });
    const { handlers, context } = harness(player);
    const result = await handlers.get('fishing.cancel')!(
      command(player.characterId, player.revision, { castId: 'cast-1' }),
      context,
    );

    expect(result).toMatchObject({
      events: [{
        type: 'character.fishing_cast_advanced',
        payload: { castId: 'cast-1', ticksCompleted: 1, status: 'interrupted', tickRolls: [] },
      }],
    });
  });

  it('rejects cancellation when the player or cast is unavailable', async () => {
    const player = character({ activeFishing: activeCast() });
    const { handlers, context } = harness(player);
    await expect(handlers.get('fishing.cancel')!(
      command(player.characterId, player.revision, { castId: 'different-cast' }),
      context,
    )).rejects.toThrow('That fishing cast is no longer active.');

    const unavailable = new Map<string, (command: any, context: any) => Promise<unknown>>();
    fishingPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        unavailable.set(name, handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    await expect(unavailable.get('fishing.cancel')!(
      command(player.characterId, player.revision, { castId: 'cast-1' }),
      context,
    )).rejects.toThrow('That character is no longer available.');
  });
});
