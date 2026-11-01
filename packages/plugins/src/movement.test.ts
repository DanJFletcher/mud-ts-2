import { describe, expect, it } from 'vitest';
import { CharacterProjectionSchema, MOVEMENT_STAMINA_COST } from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';
import { createMovementPlan, movementPlugin } from './movement.js';

const now = new Date('2026-10-27T12:00:00.000Z');
const roomId = 'mossgate-clearing';

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'mudd-demo-instance',
    characterId: 'movement-test-character',
    name: 'Movement Tester',
    locationId: roomId,
    revision: 1,
    ...overrides,
  });
}

function world() {
  return structuredClone(demoWorld);
}

function firstExitOf(worldPack = world()) {
  const location = worldPack.locations.find((candidate) => candidate.id === roomId);
  if (!location?.exits[0]) throw new Error('The demo start room needs at least one exit.');
  return { world: worldPack, exit: location.exits[0] };
}

describe('createMovementPlan', () => {
  it('uses a world-specific cost and allows travel with exactly that much stamina', () => {
    const { world: pack, exit } = firstExitOf();
    pack.movementStaminaCost = 2;
    const base = character();
    const traveler = character({
      resources: { ...base.resources, stamina: { ...base.resources.stamina, current: 2 } },
      staminaRecovery: { ...base.staminaRecovery, lastSettledAt: now.toISOString() },
    });
    expect(createMovementPlan(pack, traveler, exit.id, true, now).events.at(-1)?.payload).toMatchObject({ movementCost: 2 });
    traveler.resources.stamina.current = 1;
    expect(() => createMovementPlan(pack, traveler, exit.id, true, now)).toThrow('You need 2 stamina to travel; you have 1.');
  });

  it('rejects water independently of map colour and terrain, including road-authorised moves', () => {
    const { world: pack, exit } = firstExitOf();
    const destination = pack.locations.find(({ id }) => id === exit.toLocationId);
    if (!destination) throw new Error('Missing destination fixture.');
    destination.mapPosition = { x: 1, y: 0, terrain: 'land' };
    destination.requiresWaterTravel = true;
    expect(() => createMovementPlan(pack, character(), exit.id, true, now)).toThrow('You need to swim or use a boat.');
    delete destination.requiresWaterTravel;
    destination.mapPosition.terrain = 'river';
    expect(() => createMovementPlan(pack, character(), exit.id, true, now)).not.toThrow();
  });

  it('allows dry crossing states to override a water location and blocks a water state on dry terrain', () => {
    const { world: pack, exit } = firstExitOf();
    const destination = pack.locations.find(({ id }) => id === exit.toLocationId);
    if (!destination) throw new Error('Missing crossing fixture.');
    destination.requiresWaterTravel = true;
    destination.defaultStateId = 'stage';
    destination.states = [{ id: 'stage', requiresWaterTravel: false }, { id: 'water' }];
    expect(() => createMovementPlan(pack, character(), exit.id, true, now)).not.toThrow();
    exit.toStateId = 'water';
    expect(() => createMovementPlan(pack, character(), exit.id, true, now)).toThrow('open water');
    destination.requiresWaterTravel = false;
    destination.states[1] = { id: 'water', requiresWaterTravel: true };
    expect(() => createMovementPlan(pack, character(), exit.id, true, now)).toThrow('open water');
  });

  it('allows a character already in water to return directly to a dry destination', () => {
    const { world: pack, exit } = firstExitOf();
    const source = pack.locations.find(({ id }) => id === roomId);
    if (!source) throw new Error('Missing source fixture.');
    source.requiresWaterTravel = true;
    expect(() => createMovementPlan(pack, character(), exit.id, true, now)).not.toThrow();
  });

  it('plans a valid move and emits location-entry effects', () => {
    const { world: pack, exit } = firstExitOf();
    const plan = createMovementPlan(pack, character(), exit.id, true, now);

    expect(plan.exit.id).toBe(exit.id);
    expect(plan.events.at(-1)).toMatchObject({
      type: 'character.moved',
      payload: {
        fromLocationId: roomId,
        toLocationId: exit.toLocationId,
        exitId: exit.id,
        movementCost: MOVEMENT_STAMINA_COST,
      },
    });
    expect(plan.effects.map((effect) => effect.type)).toEqual([
      'world.location.entered',
      'combat.hostile-npc-entry',
    ]);
  });

  it('records an active fishing interruption before the move event', () => {
    const { world: pack, exit } = firstExitOf();
    const activeCharacter = character({
      activeFishing: {
        castId: 'cast-test',
        spotId: 'spot-test',
        locationId: roomId,
        rodItemId: 'rod-test',
        rodQualityId: 'old',
        startedAt: now.toISOString(),
        tickIntervalSeconds: 1,
        ticksRequired: 10,
        ticksCompleted: 3,
      },
    });

    const plan = createMovementPlan(pack, activeCharacter, exit.id, true, now);
    expect(plan.events.map((event) => event.type)).toEqual([
      'character.fishing_cast_advanced',
      'character.vital_recovery_settled',
      'character.moved',
    ]);
    expect(plan.events[0]?.payload).toMatchObject({ status: 'interrupted', ticksCompleted: 3 });
  });

  it('rejects movement while resting or in combat', () => {
    const { world: pack, exit } = firstExitOf();
    const resting = character({
      staminaRecovery: { posture: 'resting', lastSettledAt: now.toISOString(), fractionalCarry: 0 },
    });
    expect(() => createMovementPlan(pack, resting, exit.id, true, now))
      .toThrow('You are resting. Stand before you move.');

    const fighting = character({
      combat: {
        encounterId: 'encounter-test',
        locationId: roomId,
        opponentNpcId: 'bandit-test',
        opponentName: 'Bandit',
        round: 1,
        playerHealth: 10,
        playerMaxHealth: 10,
        opponentHealth: 10,
        opponentMaxHealth: 10,
        status: 'active',
        lastAction: 'encounter',
        lastNarration: 'The bandit blocks the road.',
      },
    });
    expect(() => createMovementPlan(pack, fighting, exit.id, true, now))
      .toThrow('You cannot leave while combat is active. Flee first.');
  });

  it('rejects missing rooms, exits, road permission, and destinations', () => {
    const { world: pack, exit } = firstExitOf();
    expect(() => createMovementPlan(pack, character({ locationId: 'missing-room' }), exit.id, true, now))
      .toThrow('Your current location is not available.');
    expect(() => createMovementPlan(pack, character(), 'missing-exit', true, now))
      .toThrow('That exit is not available from your current location.');
    expect(() => createMovementPlan(pack, character(), exit.id, false, now))
      .toThrow('That exit is part of a road. Travel one road segment at a time.');

    exit.toLocationId = 'missing-room';
    expect(() => createMovementPlan(pack, character(), exit.id, true, now))
      .toThrow('That destination is not available.');
  });

  it('requires visited locations and a recorded interaction before passage', () => {
    const { world: pack, exit } = firstExitOf();
    const destination = pack.locations.find((candidate) => candidate.id === exit.toLocationId)!;
    destination.requiredVisitedLocationId = roomId;
    expect(() => createMovementPlan(pack, character(), exit.id, true, now))
      .toThrow('You must first visit Mossgate Clearing before entering');
    expect(() => createMovementPlan(pack, character({ visitedLocationIds: [roomId] }), exit.id, true, now))
      .not.toThrow();

    destination.requiredVisitedLocationId = undefined;
    exit.requiredInteractionId = 'unlock-passage';
    expect(() => createMovementPlan(pack, character(), exit.id, true, now))
      .toThrow('That passage is still sealed.');
    expect(() => createMovementPlan(pack, character({
      itemUseObservations: [{
        interactionId: 'unlock-passage',
        itemId: 'key-test',
        targetId: 'door-test',
        locationId: roomId,
      }],
    }), exit.id, true, now)).not.toThrow();
  });

  it('rejects travel without enough recovered stamina and skips entry effects on self-exits', () => {
    const { world: pack, exit } = firstExitOf();
    const defaultCharacter = character();
    const exhausted = character({
      resources: {
        ...defaultCharacter.resources,
        stamina: { ...defaultCharacter.resources.stamina, current: 0 },
      },
      staminaRecovery: { posture: 'standing', lastSettledAt: now.toISOString(), fractionalCarry: 0 },
    });
    expect(() => createMovementPlan(pack, exhausted, exit.id, true, now))
      .toThrow(`You need ${MOVEMENT_STAMINA_COST} stamina to travel; you have 0.`);

    exit.toLocationId = roomId;
    const selfExitPlan = createMovementPlan(pack, character(), exit.id, true, now);
    expect(selfExitPlan.effects).toEqual([]);
  });
});

describe('movement command registration', () => {
  function registeredCommand(player: ReturnType<typeof character>) {
    let handler: ((command: any, context: any) => Promise<unknown>) | undefined;
    let providedPlan: unknown;
    movementPlugin.register({
      registerCommand: (_name: string, _schema: unknown, registered: unknown) => {
        handler = registered as (command: any, context: any) => Promise<unknown>;
      },
      requireCapability: () => ({ load: async () => player }),
      provideCapability: (_token: unknown, implementation: unknown) => {
        providedPlan = implementation;
      },
    } as never);
    if (!handler) throw new Error('Movement command was not registered.');
    return { handler, providedPlan };
  }

  it('provides movement planning and handles a valid command', async () => {
    const { world: pack, exit } = firstExitOf();
    exit.roadId = undefined;
    const player = character();
    const { handler, providedPlan } = registeredCommand(player);

    const result = await handler({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { exitId: exit.id },
    }, {
      world: pack,
      now: () => now,
    });

    expect(providedPlan).toMatchObject({ plan: expect.any(Function) });
    expect(result).toMatchObject({
      streamId: player.characterId,
      expectedVersion: player.revision,
      events: expect.arrayContaining([expect.objectContaining({ type: 'character.moved' })]),
      effects: expect.any(Array),
    });
  });

  it('rejects missing and archived character state', async () => {
    let handler: ((command: any, context: any) => Promise<unknown>) | undefined;
    const players = [undefined, character({ archived: true })];
    movementPlugin.register({
      registerCommand: (_name: string, _schema: unknown, registered: unknown) => {
        handler = registered as (command: any, context: any) => Promise<unknown>;
      },
      requireCapability: () => ({ load: async () => players.shift() }),
      provideCapability: () => undefined,
    } as never);
    if (!handler) throw new Error('Movement command was not registered.');

    const command = {
      characterId: 'movement-test-character',
      expectedVersion: 1,
      payload: { exitId: 'exit-1' },
    };
    await expect(handler(command, { world: world(), now: () => now }))
      .rejects.toThrow('That character is no longer available.');
    await expect(handler(command, { world: world(), now: () => now }))
      .rejects.toThrow('That character is no longer available.');
  });
});
