import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';
import { roadTravelPlugin } from './road-travel.js';
import { createMovementPlan } from './movement.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');

function roadFixture() {
  const world = structuredClone(demoWorld);
  for (const road of world.roads) {
    for (let index = 0; index < road.locationIds.length - 1; index += 1) {
      const fromLocationId = road.locationIds[index]!;
      const toLocationId = road.locationIds[index + 1]!;
      const location = world.locations.find((candidate) => candidate.id === fromLocationId);
      const exit = location?.exits.find((candidate) =>
        candidate.roadId === road.id && candidate.toLocationId === toLocationId);
      if (exit && road.encounters[0]) return { world, road, exit, fromLocationId, toLocationId };
    }
  }
  throw new Error('The demo pack needs a road with an adjacent exit and an encounter.');
}

function character(locationId: string, overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'world-1',
    characterId: 'road-traveler',
    name: 'Road Traveler',
    locationId,
    revision: 4,
    health: { current: 10, maximum: 10 },
    ...overrides,
  });
}

function harness(
  player: ReturnType<typeof character>,
  fixture: ReturnType<typeof roadFixture>,
  options: {
    rolls?: number[];
    teamResult?: unknown;
    movement?: unknown;
  } = {},
) {
  const handlers = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const capabilities: unknown[] = [
    { load: vi.fn(async () => player) },
    {
      plan: vi.fn(() => options.movement ?? createMovementPlan(
        fixture.world, player, fixture.exit.id, true, NOW,
      )),
    },
    { plan: vi.fn(async () => options.teamResult ?? null) },
  ];
  roadTravelPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    requireCapability: () => capabilities.shift(),
  } as never);
  const rollValues = [...(options.rolls ?? [])];
  const context = {
    world: fixture.world,
    worldInstanceId: 'world-1',
    now: () => NOW,
    makeId: () => 'road-encounter-id',
    rng: { roll: vi.fn(() => rollValues.shift() ?? 100) },
  };
  return { handlers, context };
}

function movement(exit: Record<string, unknown>) {
  return {
    exit,
    events: [{
      type: 'character.moved',
      version: 1,
      payload: {
        characterId: 'road-traveler',
        fromLocationId: exit.fromLocationId,
        toLocationId: exit.toLocationId,
        exitId: exit.id,
        movementCost: 1,
      },
    }],
    effects: [],
  };
}

describe('road travel command', () => {
  it('rejects a water destination before rolling an encounter', async () => {
    const fixture = roadFixture();
    const destination = fixture.world.locations.find(({ id }) => id === fixture.toLocationId);
    if (!destination) throw new Error('Missing road destination fixture.');
    destination.requiresWaterTravel = true;
    const player = character(fixture.fromLocationId);
    const { handlers, context } = harness(player, fixture);
    const handler = handlers.get('character.road.step');
    if (!handler) throw new Error('Missing road handler.');
    await expect(handler({ characterId: player.characterId, expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id } }, context)).rejects.toThrow('You need to swim or use a boat.');
    expect(context.rng.roll).not.toHaveBeenCalled();
  });

  it('records an adjacent road step and its encounter roll when no encounter occurs', async () => {
    const fixture = roadFixture();
    const player = character(fixture.fromLocationId);
    const { handlers, context } = harness(player, fixture, { rolls: [100] });

    const result = await handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, context);

    expect(result).toMatchObject({ streamId: player.characterId, effects: expect.any(Array) });
    const events = (result as { events: Array<{ type: string; payload: unknown }> }).events;
    const moveEvent = events.find((event) => event.type === 'character.moved');
    expect(moveEvent?.payload).toMatchObject({
      fromLocationId: fixture.fromLocationId,
      toLocationId: fixture.toLocationId,
      roadTravel: {
        roadId: fixture.road.id,
        segmentIndex: 1,
        encounterRoll: 100,
        encounterOccurred: false,
      },
    });
  });

  it('starts a solo road encounter after movement and includes the destination room', async () => {
    const fixture = roadFixture();
    fixture.road.encounterChancePercent = 100;
    const player = character(fixture.fromLocationId);
    const { handlers, context } = harness(player, fixture, { rolls: [1, 1] });

    const result = await handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, context);

    const events = (result as { events: Array<{ type: string; payload: unknown }> }).events;
    expect(events.map(({ type }) => type)).toContain('character.moved');
    const encounter = events.find((event) => event.type === 'character.combat_encounter_started');
    expect(encounter?.payload).toMatchObject({
      encounter: {
        locationId: fixture.toLocationId,
        opponentNpcId: fixture.road.encounters[0]!.id,
      },
    });
  });

  it('delegates a road encounter to the cooperative encounter capability when available', async () => {
    const fixture = roadFixture();
    fixture.road.encounterChancePercent = 100;
    const player = character(fixture.fromLocationId);
    const partyPlan = { streamId: 'world-team-combat', events: [{ type: 'team.road_encounter_started' }] };
    const { handlers, context } = harness(player, fixture, { rolls: [1, 1], teamResult: partyPlan });

    await expect(handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, context)).resolves.toBe(partyPlan);
  });

  it('rejects unavailable travelers and exits without a valid road segment', async () => {
    const fixture = roadFixture();
    const player = character(fixture.fromLocationId);
    const { context } = harness(player, fixture);

    const unavailable = new Map<string, (command: any, context: any) => Promise<unknown>>();
    roadTravelPlugin.register({
      registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
        unavailable.set(name, handler);
      },
      requireCapability: () => ({ load: vi.fn(async () => undefined) }),
    } as never);
    await expect(unavailable.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, context)).rejects.toThrow('That character is no longer available.');

    const noRoad = harness(player, fixture, {
      movement: movement({ ...fixture.exit, roadId: undefined }),
    });
    await expect(noRoad.handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, noRoad.context)).rejects.toThrow('That exit is not part of a road.');

    const missingRoad = harness(player, fixture, {
      movement: movement({ ...fixture.exit, roadId: 'missing-road' }),
    });
    await expect(missingRoad.handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, missingRoad.context)).rejects.toThrow(`Exit ${fixture.exit.id} references missing road missing-road.`);
  });

  it('rejects nonadjacent segments and movement policies without a move event', async () => {
    const fixture = roadFixture();
    const player = character(fixture.fromLocationId);
    const locations = fixture.road.locationIds;
    const nonadjacent = harness(player, fixture, {
      movement: movement({
        ...fixture.exit,
        fromLocationId: locations[0],
        toLocationId: locations.at(-1),
      }),
    });
    await expect(nonadjacent.handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, nonadjacent.context)).rejects.toThrow('That exit does not lead to the next segment of this road.');

    const noMove = harness(player, fixture, {
      movement: { ...movement(fixture.exit), events: [] },
    });
    await expect(noMove.handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, noMove.context)).rejects.toThrow('Movement policy did not return a movement event.');
  });

  it('rejects invalid random encounter selections rather than inventing an opponent', async () => {
    const fixture = roadFixture();
    fixture.road.encounterChancePercent = 100;
    const player = character(fixture.fromLocationId);
    const { handlers, context } = harness(player, fixture, { rolls: [1, 0] });
    await expect(handlers.get('character.road.step')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: fixture.exit.id },
    }, context)).rejects.toThrow('The random source returned an invalid road encounter selection.');

    const missingOpponentFixture = roadFixture();
    missingOpponentFixture.road.encounterChancePercent = 100;
    missingOpponentFixture.road.encounters = Array(1) as any;
    const missingOpponent = harness(
      character(missingOpponentFixture.fromLocationId),
      missingOpponentFixture,
      { rolls: [1, 1] },
    );
    await expect(missingOpponent.handlers.get('character.road.step')!({
      characterId: 'road-traveler',
      expectedVersion: 4,
      payload: { exitId: missingOpponentFixture.exit.id },
    }, missingOpponent.context)).rejects.toThrow('A successful road encounter did not select an opponent.');
  });
});
