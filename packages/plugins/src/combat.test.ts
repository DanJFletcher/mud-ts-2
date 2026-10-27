import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { demoWorld } from '@mudd/world-demo';
import { combatPlugin, createRoadEncounterStartEvent } from './combat.js';

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: 'combat-test-world',
    characterId: 'combat-test-character',
    name: 'Combat Tester',
    locationId: 'southbound-track',
    revision: 1,
    ...overrides,
  });
}

const opponent = {
  id: 'road-bandit',
  name: 'Bandit',
  combatProfile: { maxHealth: 12, attackDamage: 2 },
} as Parameters<typeof createRoadEncounterStartEvent>[2];

const context = {
  makeId: () => 'encounter-deterministic',
} as Parameters<typeof createRoadEncounterStartEvent>[0];

function captureCombatCommands(player: ReturnType<typeof character>) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const capabilitySequence: unknown[] = [
    { load: vi.fn(async () => player) },
    { register: vi.fn() },
    { register: vi.fn() },
  ];
  combatPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      commands.set(name, handler);
    },
    registerQuery: () => undefined,
    registerEffect: () => undefined,
    requireCapability: () => capabilitySequence.shift(),
    optionalCapability: () => undefined,
  } as never);
  return commands;
}

describe('road encounter event creation', () => {
  it('creates an authoritative encounter with stable opponent and character state', () => {
    const event = createRoadEncounterStartEvent(context, character(), opponent);

    expect(event).toMatchObject({
      type: 'character.combat_encounter_started',
      version: 1,
      payload: {
        characterId: 'combat-test-character',
        encounter: {
          encounterId: 'encounter-deterministic',
          locationId: 'southbound-track',
          opponentNpcId: 'road-bandit',
          opponentName: 'Bandit',
          opponentStyle: 'steady',
          round: 0,
          opponentHealth: 12,
          opponentMaxHealth: 12,
          status: 'active',
          lastAction: 'encounter',
        },
      },
    });
    expect((event.payload as { encounter: { playerHealth: number; playerMaxHealth: number } }).encounter.playerHealth)
      .toBe((event.payload as { encounter: { playerMaxHealth: number } }).encounter.playerMaxHealth);
  });

  it('uses an authored combat style and refuses to start when the player has no health', () => {
    const aggressiveOpponent = {
      ...opponent,
      combatProfile: { ...opponent.combatProfile, style: 'heavy' },
    } as Parameters<typeof createRoadEncounterStartEvent>[2];
    const aggressive = createRoadEncounterStartEvent(context, character(), aggressiveOpponent);
    expect(aggressive).toMatchObject({
      payload: { encounter: { opponentStyle: 'heavy' } },
    });

    const incapacitated = character({ health: { current: 0, maximum: 6 } });
    expect(() => createRoadEncounterStartEvent(context, incapacitated, opponent))
      .toThrow('You are too hurt to survive a road encounter.');
  });
});

describe('combat plugin rest command', () => {
  it('creates one paid rest event that restores all three vitals', async () => {
    const room = demoWorld.locations.find((location) => location.inn);
    if (!room?.inn || !demoWorld.currency) throw new Error('The demo pack needs an inn and currency fixture.');
    const base = character({ locationId: room.id });
    const injured = CharacterProjectionSchema.parse({
      ...base,
      health: { current: 1, maximum: 6 },
      wallet: { currencyId: demoWorld.currency.id, balance: 20 },
      resources: {
        stamina: { ...base.resources.stamina, current: 0 },
        mana: { ...base.resources.mana, current: 0 },
      },
    });
    const command = captureCombatCommands(injured).get('inn.rest');
    if (!command) throw new Error('The combat plugin did not register inn.rest.');

    const result = await command({
      characterId: injured.characterId,
      expectedVersion: injured.revision,
      payload: { innId: room.inn.id },
    }, { world: demoWorld });

    expect(result).toMatchObject({
      streamId: injured.characterId,
      expectedVersion: injured.revision,
      events: [{
        type: 'character.inn_rest_completed',
        version: 2,
        payload: {
          locationId: room.id,
          innId: room.inn.id,
          currencyId: demoWorld.currency.id,
          price: room.inn.restPrice,
          health: { current: 6, maximum: 6 },
        },
      }],
    });
    const event = (result as { events: Array<{ payload: { resources: typeof injured.resources } }> }).events[0]!;
    expect(event.payload.resources.stamina.current).toBe(injured.resources.stamina.maximum);
    expect(event.payload.resources.mana.current).toBe(injured.resources.mana.maximum);
  });

  it('does not charge for an already-full character', async () => {
    const room = demoWorld.locations.find((location) => location.inn);
    if (!room?.inn || !demoWorld.currency) throw new Error('The demo pack needs an inn and currency fixture.');
    const base = character({ locationId: room.id });
    const full = CharacterProjectionSchema.parse({
      ...base,
      health: { current: 6, maximum: 6 },
      wallet: { currencyId: demoWorld.currency.id, balance: 20 },
    });
    const command = captureCombatCommands(full).get('inn.rest');
    if (!command) throw new Error('The combat plugin did not register inn.rest.');

    await expect(command({
      characterId: full.characterId,
      expectedVersion: full.revision,
      payload: { innId: room.inn.id },
    }, { world: demoWorld })).rejects.toThrow(
      'Your health, stamina, and mana are already full.',
    );
  });
});

describe('combat action command', () => {
  it('starts a local NPC encounter and records the resolved player action', async () => {
    const combatWorld = structuredClone(demoWorld);
    const sentinel = combatWorld.locations
      .find((location) => location.id === 'mossgate-clearing')!
      .npcs!.find((npc) => npc.id === 'mossgate-training-sentinel')!;
    sentinel.combatProfile!.maxHealth = 100;
    const player = character({ locationId: 'mossgate-clearing' });
    const command = captureCombatCommands(player).get('combat.action');
    if (!command) throw new Error('The combat plugin did not register combat.action.');

    const result = await command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'attack', targetNpcId: sentinel.id },
    }, {
      world: combatWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'new-encounter',
      commandId: 'start-combat-command',
    });

    expect(result).toMatchObject({
      streamId: player.characterId,
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'character.combat_action_resolved', version: 3 }),
      ]),
    });
    const actionEvent = (result as { events: Array<{ type: string; payload: unknown }> })
      .events.find((event) => event.type === 'character.combat_action_resolved');
    expect(actionEvent?.payload).toMatchObject({
      characterId: player.characterId,
      encounter: {
        encounterId: 'new-encounter',
        opponentNpcId: sentinel.id,
        round: 1,
        status: 'active',
        lastAction: 'attack',
      },
    });
  });

  it('ends an active encounter when fleeing and spends the configured stamina', async () => {
    const combatWorld = structuredClone(demoWorld);
    const player = character({
      locationId: 'mossgate-clearing',
      combat: {
        encounterId: 'active-encounter',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'mossgate-training-sentinel',
        opponentName: 'Practice Sentinel',
        opponentStyle: 'steady',
        round: 1,
        playerHealth: 5,
        playerMaxHealth: 6,
        opponentHealth: 4,
        opponentMaxHealth: 4,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The sentinel clicks into position.',
      },
    });
    const command = captureCombatCommands(player).get('combat.action');
    if (!command) throw new Error('The combat plugin did not register combat.action.');

    const result = await command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'flee', encounterId: 'active-encounter' },
    }, {
      world: combatWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'unused-encounter',
      commandId: 'flee-combat-command',
    });
    const events = (result as { events: Array<{ type: string; payload: any }> }).events;

    expect(events.find((event) => event.type === 'character.combat_action_resolved')?.payload.encounter.status)
      .toBe('fled');
    expect(events.find((event) => event.type === 'character.stamina_spent')?.payload)
      .toMatchObject({ cause: 'solo-flee', causeId: 'active-encounter' });
  });

  it('rejects a target that is not present in the room', async () => {
    const player = character({ locationId: 'mossgate-clearing' });
    const command = captureCombatCommands(player).get('combat.action');
    if (!command) throw new Error('The combat plugin did not register combat.action.');

    await expect(command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'attack', targetNpcId: 'missing-opponent' },
    }, {
      world: demoWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'unused-encounter',
      commandId: 'missing-opponent-command',
    })).rejects.toThrow('That opponent is not available here.');
  });
});
