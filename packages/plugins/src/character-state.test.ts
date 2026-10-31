import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema, type CharacterProjection } from '@mudd/contracts';
import type { StoredGameEvent } from '@mudd/engine-core';
import { demoWorld } from '@mudd/world-demo';
import {
  assertCharacterAlive,
  assertCharacterStanding,
  characterPlugin,
  isInSharedCombat,
  staminaRecoveryEvent,
  staminaRecoveryEventForCommand,
  teamFleeStaminaEffect,
  type CharacterStateCapability,
} from './character.js';
import { worldItemsStateCapability } from './world-items.js';
import { interactionStreamId } from './interactions.js';
import {
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
} from './object-lifecycle.js';

const worldId = 'character-state-test-world';
const now = new Date('2026-10-27T12:00:00.000Z');
const defeatedCombat = {
  encounterId: 'encounter-one',
  locationId: 'mossgate-clearing',
  opponentNpcId: 'bandit-one',
  opponentName: 'Bandit',
  round: 1,
  playerHealth: 0,
  playerMaxHealth: 6,
  opponentHealth: 5,
  opponentMaxHealth: 5,
  status: 'defeat',
  lastAction: 'attack',
  lastNarration: 'The bandit wins the fight.',
} as const;

function character(overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    characterId: 'character-one',
    worldInstanceId: worldId,
    name: 'Aster',
    locationId: 'mossgate-clearing',
    revision: 1,
    ...overrides,
  });
}

function event(type: string, payload: Record<string, unknown>): StoredGameEvent {
  return {
    eventId: type,
    worldInstanceId: worldId,
    streamId: 'world-team-combat',
    aggregateId: 'world-team-combat',
    aggregateVersion: 1,
    type,
    version: 1,
    payload,
    causationCommandId: 'command-1',
    actorId: 'system',
    occurredAt: now.toISOString(),
    tick: 1,
  } as unknown as StoredGameEvent;
}

function captureCommands(
  player: ReturnType<typeof character>,
  sharedState: any = { revision: 0, items: [], corpses: [], currencyDrops: [] },
) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const systemCommands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  const effects = new Map<string, (payload: any, context: any) => Promise<void>>();
  let state: CharacterStateCapability | undefined;
  characterPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: unknown) => {
      commands.set(name, handler as (command: any, context: any) => Promise<unknown>);
    },
    registerSystemCommand: (name: string, _schema: unknown, handler: unknown, version = 1) => {
      systemCommands.set(version === 1 ? name : `${name}@${version}`,
        handler as (command: any, context: any) => Promise<unknown>);
    },
    registerQuery: (name: string, _schema: unknown, handler: unknown) => {
      queries.set(name, handler as (query: any, context: any) => Promise<unknown>);
    },
    registerEffect: (name: string, _version: number, _schema: unknown, handler: unknown) => {
      effects.set(name, handler as (payload: any, context: any) => Promise<void>);
    },
    provideCapability: (_token: unknown, implementation: unknown) => {
      state = implementation as CharacterStateCapability;
    },
    requireCapability: (token: { id: string }) => {
      if (token.id === worldItemsStateCapability.id) {
        return { load: vi.fn(async () => sharedState) };
      }
      throw new Error(`Unexpected capability ${token.id}`);
    },
    optionalCapability: () => undefined,
  } as never);
  if (!state) throw new Error('Character state capability was not provided.');
  return { commands, systemCommands, queries, effects, state, player };
}

function storedCharacterEvent(
  type: string,
  version: number,
  payload: Record<string, unknown>,
  aggregateVersion: number,
  eventId = `character-event-${aggregateVersion}`,
): StoredGameEvent {
  const characterId = String(payload.characterId);
  return {
    eventId,
    worldInstanceId: worldId,
    streamId: characterId,
    aggregateId: characterId,
    aggregateVersion,
    type,
    version,
    payload,
    causationCommandId: 'character-command',
    actorId: 'player-one',
    occurredAt: now.toISOString(),
    tick: aggregateVersion,
  } as unknown as StoredGameEvent;
}

function commandContext(player: ReturnType<typeof character>, options: {
  teamEvents?: readonly StoredGameEvent[];
  pvpEvents?: readonly StoredGameEvent[];
} = {}) {
  return {
    worldInstanceId: worldId,
    world: structuredClone(demoWorld),
    session: { playerId: 'player-one' },
    characterProjection: player,
    now: () => now,
    makeId: () => 'generated-id',
    store: {
      readStream: vi.fn(async (_world: string, streamId: string) =>
        streamId === 'world-team-combat' ? options.teamEvents ?? []
          : streamId === interactionStreamId(worldId) ? options.pvpEvents ?? [] : []),
    },
  };
}

describe('character state guards and recovery', () => {
  it('uses the request projection when available and otherwise replays the stream', async () => {
    const player = character();
    const { state } = captureCommands(player);
    const context = commandContext(player) as any;
    await expect(state.load(context, player.characterId)).resolves.toBe(player);
    expect(context.store.readStream).not.toHaveBeenCalled();
    await expect(state.load({ ...context, characterProjection: undefined }, player.characterId))
      .resolves.toBeUndefined();
    expect(context.store.readStream).toHaveBeenCalledWith(worldId, player.characterId);
  });

  it('validates that worlds with class catalogs have a matching class capability', () => {
    expect(() => characterPlugin.validateWorld?.(demoWorld, {
      optionalCapability: () => undefined,
    } as any)).not.toThrow();
    expect(() => characterPlugin.validateWorld?.({
      ...demoWorld,
      classCatalog: { id: 'classes' },
    } as any, { optionalCapability: () => undefined } as any))
      .toThrow('requires its class ruleset capability');
  });

  it('allows living standing characters and rejects defeat, zero health, and resting posture', () => {
    expect(() => assertCharacterAlive(character())).not.toThrow();
    expect(() => assertCharacterAlive(character({ health: { current: 0, maximum: 10 } })))
      .toThrow('Your character has died');
    expect(() => assertCharacterAlive(character({ combat: defeatedCombat })))
      .toThrow('Your character has died');
    expect(() => assertCharacterStanding(character())).not.toThrow();
    expect(() => assertCharacterStanding(character({
      staminaRecovery: {
        posture: 'resting',
        lastSettledAt: now.toISOString(),
        fractionalCarry: 0,
      },
    }))).toThrow('Stand before taking that action');
  });

  it('settles vital recovery using current health and derives health if the projection lacks it', () => {
    const player = character();
    const settled = staminaRecoveryEvent(player, new Date(now.getTime() + 5_000));
    expect(settled).toMatchObject({
      type: 'character.vital_recovery_settled',
      payload: {
        characterId: player.characterId,
        health: { maximum: player.health?.maximum ?? 6 },
        recovery: { lastSettledAt: new Date(now.getTime() + 5_000).toISOString() },
      },
    });

    const withoutHealth = { ...player, health: undefined } as unknown as CharacterProjection;
    expect(staminaRecoveryEvent(withoutHealth, now).payload.health).toMatchObject({
      current: 6,
      maximum: 6,
    });
  });

  it('currently settles the entire offline gap when a command arrives before a heartbeat', () => {
    const lastHeartbeat = new Date(now.getTime() - 60_000);
    const player = character({
      health: { current: 1, maximum: 6 },
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 0, maximum: 100 },
      },
      staminaRecovery: {
        posture: 'standing',
        lastSettledAt: lastHeartbeat.toISOString(),
        fractionalCarry: 0,
        healthFractionalCarry: 0,
        manaFractionalCarry: 0,
      },
    });

    const settled = staminaRecoveryEvent(player, now);
    expect(settled.payload).toMatchObject({
      health: { current: 4, maximum: 6 },
      resources: {
        stamina: { current: 60, maximum: 100 },
        mana: { current: 60, maximum: 100 },
      },
      recovery: { lastSettledAt: now.toISOString() },
    });
  });

  it('settles fresh sessions to command time and stale sessions only to their last heartbeat', () => {
    const previousSettlement = new Date(now.getTime() - 90_000);
    const freshHeartbeat = new Date(now.getTime() - 30_000);
    const staleHeartbeat = new Date(now.getTime() - 60_000);
    const player = character({
      health: { current: 1, maximum: 6 },
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 0, maximum: 100 },
      },
      staminaRecovery: {
        posture: 'standing',
        lastSettledAt: previousSettlement.toISOString(),
        fractionalCarry: 20_000,
        healthFractionalCarry: 40_000,
        manaFractionalCarry: 70_000,
      },
    });

    const fresh = staminaRecoveryEventForCommand(player, now, freshHeartbeat);
    expect(fresh.payload).toMatchObject({
      resources: {
        stamina: { current: 90 },
        mana: { current: 90 },
      },
      recovery: { lastSettledAt: now.toISOString() },
    });

    const stale = staminaRecoveryEventForCommand(player, now, staleHeartbeat);
    expect(stale.payload).toMatchObject({
      health: { current: 3 },
      resources: {
        stamina: { current: 30 },
        mana: { current: 30 },
      },
      settledAt: staleHeartbeat.toISOString(),
      resetAnchor: true,
      recovery: {
        lastSettledAt: now.toISOString(),
        fractionalCarry: 20_000,
        manaFractionalCarry: 70_000,
      },
    });
  });

  it('does not accrue recovery when a command has no confirmed presence anchor', () => {
    const player = character({
      health: { current: 1, maximum: 6 },
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 0, maximum: 100 },
      },
      staminaRecovery: {
        posture: 'standing',
        lastSettledAt: new Date(now.getTime() - 60_000).toISOString(),
        fractionalCarry: 20_000,
        healthFractionalCarry: 40_000,
        manaFractionalCarry: 70_000,
      },
    });

    expect(staminaRecoveryEventForCommand(player, now).payload).toMatchObject({
      health: { current: 1 },
      resources: {
        stamina: { current: 0 },
        mana: { current: 0 },
      },
      settledAt: new Date(now.getTime() - 60_000).toISOString(),
      resetAnchor: true,
      recovery: { lastSettledAt: now.toISOString() },
    });
  });
});

describe('shared combat presence detection', () => {
  it('detects active team combat and falls through to the latest PvP encounter', async () => {
    const teamEvent = event('team.combat_started', {
      encounter: {
        encounterId: 'team-encounter',
        status: 'active',
        participants: [{ characterId: 'character-one', status: 'active' }],
      },
    });
    const context = commandContext(character(), { teamEvents: [teamEvent] }) as any;
    await expect(isInSharedCombat(context, 'character-one')).resolves.toBe(true);
    expect(context.store.readStream).toHaveBeenCalledTimes(1);

    const latestTeam = event('team.combat_action_resolved', {
      encounter: {
        encounterId: 'team-encounter',
        status: 'completed',
        participants: [{ characterId: 'character-one', status: 'active' }],
      },
    });
    const pvpEvent = event('pvp.encounter.started', {
      encounter: { status: 'active', participants: [{ characterId: 'character-one' }] },
    });
    await expect(isInSharedCombat(
      commandContext(character(), { teamEvents: [latestTeam], pvpEvents: [pvpEvent] }) as any,
      'character-one',
    )).resolves.toBe(true);
    await expect(isInSharedCombat(
      commandContext(character(), {
        pvpEvents: [event('pvp.outcome.applied', {
          encounter: { status: 'completed', participants: [{ characterId: 'character-one' }] },
        })],
      }) as any,
      'character-one',
    )).resolves.toBe(false);
    await expect(isInSharedCombat(commandContext(character()) as any, 'character-one')).resolves.toBe(false);

    const unrelated = commandContext(character(), {
      teamEvents: [event('team.member_changed', {})],
      pvpEvents: [event('pvp.request.created', {})],
    }) as any;
    await expect(isInSharedCombat(unrelated, 'character-one')).resolves.toBe(false);
  });
});

describe('team flee stamina effect', () => {
  it('creates a versioned effect for the character and encounter', () => {
    expect(teamFleeStaminaEffect('character-one', 'encounter-one')).toEqual({
      type: 'mudd.character.team-flee-stamina',
      version: 1,
      payload: { characterId: 'character-one', encounterId: 'encounter-one' },
    });
  });
});

describe('unavailable character handlers', () => {
  it('fails closed for character commands and object queries', async () => {
    const player = character();
    const captured = captureCommands(player);
    const context = {
      ...commandContext(player),
      characterProjection: undefined,
    };
    const request = {
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: {},
    };

    for (const name of [
      'character.take',
      'character.drop',
      'character.put',
      'character.equip',
      'character.unequip',
      'character.use',
      'character.read',
      'character.rename',
      'character.archive',
    ]) {
      await expect(captured.commands.get(name)!(request, context))
        .rejects.toThrow('That character is no longer available.');
    }

    for (const name of ['location.describe', 'object.read', 'object.inspect']) {
      await expect(captured.queries.get(name)!({
        characterId: player.characterId,
        payload: {},
      }, context)).rejects.toThrow('That character is no longer available.');
    }
  });
});

describe('inventory and combat command guards', () => {
  it('rejects missing, quest-bound, equipped, and already-equipped items', async () => {
    const empty = character({ inventory: [] });
    const commands = captureCommands(empty).commands;
    const missing = {
      characterId: empty.characterId,
      expectedVersion: empty.revision,
      payload: { itemId: 'missing-item' },
    };
    for (const name of ['character.drop', 'character.put', 'character.equip']) {
      await expect(commands.get(name)!(missing, commandContext(empty)))
        .rejects.toThrow('You are not carrying that item.');
    }

    const questItem = {
      id: 'quest-tool',
      typeId: 'quest-tool',
      label: 'Quest tool',
      description: 'A needed tool.',
      questBound: true,
    };
    const questCarrier = character({ inventory: [questItem] });
    await expect(captureCommands(questCarrier).commands.get('character.put')!({
      characterId: questCarrier.characterId,
      expectedVersion: questCarrier.revision,
      payload: { itemId: questItem.id },
    }, commandContext(questCarrier))).rejects.toThrow('Quest items cannot be put away.');

    const weapon = {
      id: 'equipped-weapon',
      typeId: 'sword',
      label: 'Sword',
      description: 'A plain sword.',
      equipment: { slot: 'weapon', attackBonus: 1, defenseBonus: 0 },
    };
    const equipped = character({
      inventory: [weapon],
      equipment: { weaponItemId: weapon.id, armorItemId: null },
    });
    const equippedCommands = captureCommands(equipped).commands;
    await expect(equippedCommands.get('character.put')!({
      characterId: equipped.characterId,
      expectedVersion: equipped.revision,
      payload: { itemId: weapon.id },
    }, commandContext(equipped))).rejects.toThrow('Unequip that item before putting it away.');
    await expect(equippedCommands.get('character.equip')!({
      characterId: equipped.characterId,
      expectedVersion: equipped.revision,
      payload: { itemId: weapon.id },
    }, commandContext(equipped))).rejects.toThrow('is already equipped.');
  });

  it('prevents changing equipment or using healing items during personal combat', async () => {
    const inCombat = character({
      combat: { ...defeatedCombat, status: 'active', playerHealth: 6 },
    });
    const commands = captureCommands(inCombat).commands;
    const command = {
      characterId: inCombat.characterId,
      expectedVersion: inCombat.revision,
      payload: {},
    };
    await expect(commands.get('character.unequip')!(command, commandContext(inCombat)))
      .rejects.toThrow('You cannot change equipment during an active encounter.');
    await expect(commands.get('character.use')!(command, commandContext(inCombat)))
      .rejects.toThrow('Use a healing item through your combat action while a fight is active.');
  });
});

describe('rest and stand commands', () => {
  it('settles recovery while changing posture and enforces state restrictions', async () => {
    const player = character();
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const baseCommand = { characterId: player.characterId, expectedVersion: player.revision };
    const rested = await commands.get('character.rest')!(baseCommand, context) as any;
    expect(rested.events.map((item: any) => item.type)).toEqual([
      'character.vital_recovery_settled',
      'character.posture_changed',
    ]);
    expect(rested.events[1].payload).toMatchObject({
      posture: 'resting',
      locationId: player.locationId,
    });

    const resting = character({
      staminaRecovery: { posture: 'resting', lastSettledAt: now.toISOString(), fractionalCarry: 0 },
    });
    const restingCommands = captureCommands(resting).commands;
    await expect(restingCommands.get('character.rest')!(baseCommand, commandContext(resting)))
      .rejects.toThrow('already resting');
    expect(await restingCommands.get('character.stand')!(baseCommand, commandContext(resting)))
      .toMatchObject({ events: expect.arrayContaining([expect.objectContaining({
        type: 'character.posture_changed',
        payload: expect.objectContaining({ posture: 'standing' }),
      })]) });

    const standingCommands = captureCommands(player).commands;
    await expect(standingCommands.get('character.stand')!(baseCommand, context))
      .rejects.toThrow('already standing');
    const inCombat = character({
      combat: { ...defeatedCombat, status: 'active', playerHealth: 6 },
    });
    await expect(captureCommands(inCombat).commands.get('character.rest')!(
      baseCommand,
      commandContext(inCombat),
    )).rejects.toThrow('cannot rest while combat is active');
  });

  it('rejects rest during shared combat or without a room or character', async () => {
    const player = character();
    const { commands } = captureCommands(player);
    const command = { characterId: player.characterId, expectedVersion: player.revision, payload: {} };
    const activeTeamEvent = event('team.combat_started', {
      encounter: {
        encounterId: 'shared-encounter',
        status: 'active',
        participants: [{ characterId: player.characterId, status: 'active' }],
      },
    });
    await expect(commands.get('character.rest')!(command, commandContext(player, {
      teamEvents: [activeTeamEvent],
    }))).rejects.toThrow('cannot rest while combat is active');

    const noRoom = commandContext(player) as any;
    noRoom.world = { ...noRoom.world, locations: [] };
    await expect(commands.get('character.rest')!(command, noRoom))
      .rejects.toThrow('current location is not available');

    const missingCharacter = commandContext(player) as any;
    missingCharacter.characterProjection = undefined;
    await expect(commands.get('character.rest')!(command, missingCharacter))
      .rejects.toThrow('character is no longer available');
    await expect(commands.get('character.stand')!(command, missingCharacter))
      .rejects.toThrow('character is no longer available');
    const archived = character({ archived: true });
    await expect(captureCommands(archived).commands.get('character.stand')!({
      ...command,
      characterId: archived.characterId,
    }, commandContext(archived))).rejects.toThrow('character is no longer available');
  });
});

describe('character creation and recovery system commands', () => {
  it('creates a default character and validates its name, world start, and unsupported class choice', async () => {
    const player = character();
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const command = {
      characterId: 'unused-client-id',
      payload: { name: '  New Traveler  ' },
    };
    const result = await commands.get('character.create')!(command, context) as any;
    expect(result).toMatchObject({
      streamId: 'generated-id',
      expectedVersion: 0,
      events: [expect.objectContaining({
        type: 'character.created',
        version: 2,
        payload: expect.objectContaining({
          characterId: 'generated-id',
          playerId: 'player-one',
          name: 'New Traveler',
          startingLocationId: 'mossgate-clearing',
        }),
      })],
    });

    await expect(commands.get('character.create')!({
      payload: { name: '   ' },
    }, context)).rejects.toThrow('Choose a character name');
    await expect(commands.get('character.create')!({
      payload: { name: 'No classes', classId: 'warrior' },
    }, context)).rejects.toThrow('CLASS_UNSUPPORTED');
    await expect(commands.get('character.create')!({
      payload: { name: 'No start' },
    }, { ...context, world: { ...context.world, locations: [] } }))
      .rejects.toThrow('world has no starting location');
  });

  it('settles recovery or resets its anchor, and refuses unavailable or dead characters', async () => {
    const player = character();
    const { systemCommands } = captureCommands(player);
    const context = commandContext(player);
    const command = {
      type: 'character.stamina.recover',
      version: 1,
      commandId: 'recovery-command',
      worldInstanceId: worldId,
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { settleAt: new Date(now.getTime() + 10_000).toISOString(), resetAnchor: false },
    };
    const settled = await systemCommands.get('character.stamina.recover')!(command, context) as any;
    expect(settled).toMatchObject({
      streamId: player.characterId,
      expectedVersion: player.revision,
      events: [expect.objectContaining({
        type: 'character.vital_recovery_settled',
        payload: expect.objectContaining({ characterId: player.characterId, resetAnchor: false }),
      })],
    });

    const reset = await systemCommands.get('character.stamina.recover')!({
      ...command,
      payload: { ...command.payload, resetAnchor: true },
    }, context) as any;
    expect(reset.events[0].payload).toMatchObject({
      resetAnchor: true,
      recovery: {
        lastSettledAt: command.payload.settleAt,
        fractionalCarry: 0,
        healthFractionalCarry: 0,
        manaFractionalCarry: 0,
      },
    });

    const unavailable = captureCommands(player).systemCommands.get('character.stamina.recover')!;
    await expect(unavailable(command, { ...context, characterProjection: undefined }))
      .rejects.toThrow('no longer available');
    const deadCharacter = character({ health: { current: 0, maximum: 6 } });
    await expect(captureCommands(deadCharacter).systemCommands.get('character.stamina.recover')!(
      command,
      commandContext(deadCharacter),
    )).rejects.toThrow('Your character has died');
  });

  it('v2 settles through the reconnect anchor before resetting it in the same event', async () => {
    const player = character({
      health: { current: 1, maximum: 6 },
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 0, maximum: 100 },
      },
      staminaRecovery: {
        posture: 'resting',
        lastSettledAt: new Date(now.getTime() - 20_000).toISOString(),
        fractionalCarry: 0,
        healthFractionalCarry: 0,
        manaFractionalCarry: 0,
      },
    });
    const handler = captureCommands(player).systemCommands.get('character.stamina.recover@2')!;
    const settleAt = new Date(now.getTime() - 10_000);
    const result = await handler({
      type: 'character.stamina.recover',
      version: 2,
      commandId: 'recovery-reconnect-v2',
      worldInstanceId: worldId,
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: {
        settleAt: settleAt.toISOString(),
        resetAnchorAt: now.toISOString(),
      },
    }, commandContext(player)) as any;

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'character.vital_recovery_settled',
      version: 1,
      payload: {
        settledAt: settleAt.toISOString(),
        resetAnchor: true,
        health: { current: 2, maximum: 6 },
        resources: {
          stamina: { current: 30, maximum: 100 },
          mana: { current: 30, maximum: 100 },
        },
        recovery: { lastSettledAt: now.toISOString() },
      },
    });
  });
});

describe('team flee stamina effect', () => {
  it('spends stamina once, honors successful receipts, and handles failures', async () => {
    const player = character();
    const { commands, effects } = captureCommands(player);
    const created = await commands.get('character.create')!({
      payload: { name: 'Fleeing traveler' },
    }, commandContext(player)) as any;
    const createdPayload = created.events[0].payload;
    const history = [storedCharacterEvent(
      'character.created',
      2,
      createdPayload,
      1,
    )];
    const append = vi.fn(async (input: any) => {
      const next = input.events[0];
      history.push(storedCharacterEvent(next.type, next.version, next.payload, input.expectedVersion + 1));
      return { receipt: { ok: true } };
    });
    const store = {
      readStream: vi.fn(async () => history),
      lookupCommand: vi.fn(async () => undefined),
      append,
    };
    const effect = effects.get('mudd.character.team-flee-stamina')!;
    const payload = { characterId: createdPayload.characterId, encounterId: 'team-encounter' };
    const context = { worldInstanceId: worldId, effectId: 'flee-effect-one', store };

    await effect(payload, context);
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      streamId: createdPayload.characterId,
      expectedVersion: 1,
      events: [{
        type: 'character.stamina_spent',
        payload: {
          characterId: createdPayload.characterId,
          cause: 'team-flee',
          causeId: 'team-encounter',
          resources: { stamina: { current: expect.any(Number) } },
        },
      }],
    });
    expect(append.mock.calls[0]?.[0].events[0].payload.resources.stamina.current)
      .toBeLessThan(createdPayload.resources.stamina.current);
    await effect(payload, context);
    expect(append).toHaveBeenCalledOnce();

    const emptyHistoryStore = {
      ...store,
      readStream: vi.fn(async () => []),
    };
    await expect(effect(payload, { ...context, store: emptyHistoryStore }))
      .rejects.toThrow('participant is no longer available');

    const exhaustedPayload = {
      ...createdPayload,
      resources: {
        ...createdPayload.resources,
        stamina: { ...createdPayload.resources.stamina, current: 0 },
      },
    };
    const exhaustedStore = {
      ...store,
      readStream: vi.fn(async () => [storedCharacterEvent(
        'character.created',
        2,
        exhaustedPayload,
        1,
      )]),
    };
    await expect(effect(payload, { ...context, store: exhaustedStore }))
      .rejects.toThrow('stamina cost cannot be applied');

    const priorSuccessStore = {
      ...store,
      readStream: vi.fn(async () => [storedCharacterEvent(
        'character.created',
        2,
        createdPayload,
        1,
      )]),
      lookupCommand: vi.fn(async () => ({ receipt: { ok: true } })),
      append: vi.fn(),
    };
    await expect(effect(payload, { ...context, store: priorSuccessStore })).resolves.toBeUndefined();
    expect(priorSuccessStore.append).not.toHaveBeenCalled();

    const priorFailureStore = {
      ...store,
      readStream: vi.fn(async () => [storedCharacterEvent(
        'character.created',
        2,
        createdPayload,
        1,
      )]),
      lookupCommand: vi.fn(async () => ({ receipt: { ok: false, code: 'COMMAND_REJECTED' } })),
      append: vi.fn(),
    };
    await expect(effect(payload, { ...context, store: priorFailureStore }))
      .rejects.toThrow('could not be applied');

    const failedAppendStore = {
      ...store,
      readStream: vi.fn(async () => [storedCharacterEvent(
        'character.created',
        2,
        createdPayload,
        1,
      )]),
      lookupCommand: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ receipt: { ok: false } })),
    };
    await expect(effect(payload, { ...context, store: failedAppendStore }))
      .rejects.toThrow('Could not apply stamina spending');
  });
});

describe('corpse presentation and lifecycle companions', () => {
  it('shows decay stages only for valid configured corpse lifetimes', async () => {
    const player = character();
    const baseCorpse = {
      corpseId: 'weathering-corpse',
      encounterId: 'encounter-one',
      opponentId: 'bandit-one',
      opponentName: 'Bandit',
      label: 'Bandit remains',
      description: 'The bandit’s remains lie beside the road.',
      locationId: player.locationId,
      currencyId: 'gold',
      currencyAmount: 0,
      goldItemId: null,
      goldClaimed: true,
    };
    const cases = [
      {
        name: 'disabled stages',
        showStages: false,
        createdAt: new Date(now.getTime() - 40_000),
        expiresAt: new Date(now.getTime() + 60_000),
        appendedText: undefined,
      },
      {
        name: 'invalid lifetime',
        showStages: true,
        createdAt: new Date(now.getTime() + 4_000),
        expiresAt: new Date(now.getTime() + 2_000),
        appendedText: undefined,
      },
      {
        name: 'near decay',
        showStages: true,
        createdAt: new Date(now.getTime() - 90_000),
        expiresAt: new Date(now.getTime() + 10_000),
        appendedText: 'The remains are fading quickly.',
      },
      {
        name: 'early decay',
        showStages: true,
        createdAt: new Date(now.getTime() - 40_000),
        expiresAt: new Date(now.getTime() + 60_000),
        appendedText: 'The body has begun to weather and darken.',
      },
      {
        name: 'fresh corpse',
        showStages: true,
        createdAt: new Date(now.getTime() - 10_000),
        expiresAt: new Date(now.getTime() + 90_000),
        appendedText: undefined,
      },
    ];

    for (const scenario of cases) {
      const { queries } = captureCommands(player, {
        revision: 1,
        items: [],
        corpses: [{
          ...baseCorpse,
          createdAt: scenario.createdAt.toISOString(),
          expiresAt: scenario.expiresAt.toISOString(),
        }],
        currencyDrops: [],
      });
      const context = commandContext(player) as any;
      context.world.corpseLifecycle.showDecayStages = scenario.showStages;
      const projection = await queries.get('location.describe')!({
        characterId: player.characterId,
        payload: {},
      }, context) as any;
      expect(projection.description, scenario.name).toContain(baseCorpse.description);
      if (scenario.appendedText) {
        expect(projection.description, scenario.name).toContain(scenario.appendedText);
      } else {
        expect(projection.description, scenario.name).not.toContain('fading quickly');
        expect(projection.description, scenario.name).not.toContain('weather and darken');
      }
    }
  });

  it('reschedules an empty corpse after its last shared item is taken', async () => {
    const player = character();
    const corpse = {
      corpseId: 'emptying-corpse',
      encounterId: 'encounter-one',
      opponentId: 'bandit-one',
      opponentName: 'Bandit',
      label: 'Bandit remains',
      description: 'The bandit’s remains lie beside the road.',
      locationId: player.locationId,
      currencyId: 'gold',
      currencyAmount: 0,
      goldItemId: null,
      goldClaimed: true,
      createdAt: new Date(now.getTime() - 10_000).toISOString(),
      expiresAt: new Date(now.getTime() + 90_000).toISOString(),
    };
    const sharedState = {
      revision: 5,
      items: [{
        worldItemId: 'corpse-pelt',
        locationId: player.locationId,
        containerId: corpse.corpseId,
        item: { id: 'pelt', label: 'Bandit pelt', description: 'A rough pelt.' },
      }],
      corpses: [corpse],
      currencyDrops: [],
    };
    const { commands } = captureCommands(player, sharedState);
    const context = commandContext(player) as any;
    const scheduled = objectLifecycleScheduledEvent({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: player.locationId,
      createdAt: corpse.createdAt,
      expiresAt: corpse.expiresAt,
    });
    const lifecycleStream = objectLifecycleStreamId(corpse.corpseId);
    context.store.readStream = vi.fn(async (_worldId: string, streamId: string) =>
      streamId === lifecycleStream
        ? [{
          eventId: 'corpse-scheduled',
          worldInstanceId: worldId,
          streamId: lifecycleStream,
          aggregateId: lifecycleStream,
          aggregateVersion: 1,
          type: scheduled.type,
          version: scheduled.version,
          payload: scheduled.payload,
          causationCommandId: 'corpse-created',
          actorId: 'system',
          occurredAt: now.toISOString(),
          tick: 1,
        } as StoredGameEvent]
        : [],
    );

    const result = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'corpse-pelt' },
    }, context) as any;
    expect(result).toMatchObject({
      streamId: 'world-items',
      events: [{ type: 'world.item_claimed' }],
      companions: [{
        streamId: lifecycleStream,
        expectedVersion: 1,
        events: [{
          type: 'world.object_lifecycle_rescheduled',
          payload: { objectId: corpse.corpseId },
        }],
      }],
    });
  });

  it('skips corpse lifecycle rescheduling when no expiry or schedule exists', async () => {
    const player = character();
    for (const [suffix, expiresAt] of [
      ['no-expiry', undefined],
      ['unscheduled', new Date(now.getTime() + 3_600_000).toISOString()],
    ] as const) {
      const corpseId = `corpse-${suffix}`;
      const corpse = {
        corpseId,
        encounterId: 'encounter-one',
        opponentId: 'bandit-one',
        opponentName: 'Bandit',
        label: 'Bandit remains',
        description: 'The bandit’s remains lie beside the road.',
        locationId: player.locationId,
        currencyId: 'gold',
        currencyAmount: 0,
        goldItemId: null,
        goldClaimed: true,
        ...(expiresAt ? { expiresAt } : {}),
      };
      const { commands } = captureCommands(player, {
        revision: 1,
        items: [{
          worldItemId: `item-${suffix}`,
          locationId: player.locationId,
          containerId: corpseId,
          item: { id: `item-${suffix}`, label: 'Old scrap', description: 'A piece of scrap.' },
        }],
        corpses: [corpse],
        currencyDrops: [],
      });
      const context = commandContext(player) as any;
      const lifecycleStream = objectLifecycleStreamId(corpseId);
      context.store.readStream = vi.fn(async (_worldId: string, streamId: string) =>
        streamId === lifecycleStream ? [] : [],
      );
      const result = await commands.get('character.take')!({
        characterId: player.characterId,
        expectedVersion: player.revision,
        payload: { itemId: `item-${suffix}` },
      }, context) as any;
      expect(result.companions).toBeUndefined();
      if (!expiresAt) {
        expect(context.store.readStream).not.toHaveBeenCalled();
      } else {
        expect(context.store.readStream).toHaveBeenCalledWith(worldId, lifecycleStream);
      }
    }
  });
});

describe('character inventory commands', () => {
  it('takes room items with authored quest binding and rejects unavailable or duplicate items', async () => {
    const player = character();
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const room = context.world.locations.find((candidate) => candidate.id === player.locationId)!;
    room.takeables = [
      {
        id: 'quest-ledger',
        label: 'Old ledger',
        description: 'A ledger bound for the town archive.',
        questBound: true,
      },
      {
        id: 'bronze-axe',
        label: 'Bronze axe',
        description: 'A sturdy bronze axe.',
        equipment: { slot: 'weapon', attackBonus: 1, defenseBonus: 0 },
        woodcuttingAxe: { requiredLevel: 1, power: 5 },
      },
    ];
    const taken = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'quest-ledger' },
    }, context) as any;
    expect(taken.events[0]).toMatchObject({
      type: 'character.item_taken',
      payload: { item: { id: 'quest-ledger', questBound: true } },
    });
    const equipment = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'bronze-axe' },
    }, context) as any;
    expect(equipment.events[0].payload.item).toMatchObject({
      id: 'bronze-axe',
      equipment: { slot: 'weapon' },
      woodcuttingAxe: { requiredLevel: 1 },
    });
    const alreadyCarrying = character({
      inventory: [{ id: 'bronze-axe', label: 'Bronze axe', description: 'Already held.' }],
    });
    await expect(captureCommands(alreadyCarrying).commands.get('character.take')!({
      characterId: alreadyCarrying.characterId,
      payload: { itemId: 'bronze-axe' },
    }, commandContext(alreadyCarrying))).rejects.toThrow('already carrying');
    await expect(commands.get('character.take')!({
      characterId: player.characterId,
      payload: { itemId: 'missing-item' },
    }, context)).rejects.toThrow('not available to take here');
  });

  it('takes unclaimed container items and preserves their source container', async () => {
    const trackedItem = {
      id: 'tracked-stone',
      label: 'River stone',
      description: 'A smooth stone from the riverbank.',
    };
    const player = character({
      claimedContainerItemIds: ['already-claimed'],
      itemLocations: [{ item: trackedItem, locationId: 'mossgate-clearing' }],
    });
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const room = context.world.locations.find((candidate) => candidate.id === player.locationId)!;
    room.containers = [{
      id: 'market-crate',
      label: 'Market crate',
      description: 'A crate beside the road.',
      kind: 'chest',
      contents: [
        { id: 'apple-in-crate', label: 'Apple', description: 'A green apple.' },
        { id: 'already-claimed', label: 'Token', description: 'A wooden token.' },
      ],
    }];
    const result = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'apple-in-crate' },
    }, context) as any;
    expect(result.events[0]).toMatchObject({
      type: 'character.item_taken',
      payload: {
        containerId: 'market-crate',
        item: { id: 'apple-in-crate', label: 'Apple' },
      },
    });
    await expect(commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'already-claimed' },
    }, context)).rejects.toThrow('not available to take here');
    const tracked = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: trackedItem.id },
    }, context) as any;
    expect(tracked.events[0].payload.item).toMatchObject({ id: trackedItem.id, label: trackedItem.label });
  });

  it('drops shared equipment and stores it in a shared corpse only for its holder', async () => {
    const sharedEquipment = {
      id: 'world-knife',
      sharedItemId: 'world-knife',
      label: 'Shared knife',
      description: 'A narrow iron knife.',
      equipment: { slot: 'weapon', attackBonus: 1, defenseBonus: 0 },
    };
    const player = character({
      inventory: [sharedEquipment],
      itemLocations: [{ item: sharedEquipment, locationId: null }],
    });
    const sharedItem = {
      worldItemId: sharedEquipment.sharedItemId,
      locationId: null,
      containerId: null,
      holderCharacterId: player.characterId,
      item: sharedEquipment,
    };
    const sharedState = {
      revision: 4,
      items: [sharedItem],
      corpses: [{
        corpseId: 'shared-corpse',
        encounterId: 'encounter-one',
        opponentId: 'bandit-one',
        opponentName: 'Bandit',
        label: 'Bandit remains',
        description: 'A bandit lies still.',
        locationId: player.locationId,
        currencyId: 'gold',
        currencyAmount: 0,
        goldItemId: null,
        goldClaimed: true,
      }],
      currencyDrops: [],
    };
    const { commands } = captureCommands(player, sharedState);
    const context = commandContext(player);
    const dropped = await commands.get('character.drop')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: sharedEquipment.id },
    }, context) as any;
    expect(dropped).toMatchObject({
      events: [{
        type: 'character.shared_item_relinquished',
        payload: { worldItemId: sharedEquipment.sharedItemId },
      }],
      effects: [expect.objectContaining({ type: expect.any(String) })],
    });

    const wrongHolder = character({
      inventory: [sharedEquipment],
      itemLocations: [{ item: sharedEquipment, locationId: null }],
    });
    const wrongHolderCommands = captureCommands(wrongHolder, {
      ...sharedState,
      items: [{ ...sharedItem, holderCharacterId: 'another-character' }],
    }).commands;
    await expect(wrongHolderCommands.get('character.drop')!({
      characterId: wrongHolder.characterId,
      payload: { itemId: sharedEquipment.id },
    }, commandContext(wrongHolder))).rejects.toThrow('not currently held');

    const corpseStored = await commands.get('character.put')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: sharedEquipment.id, containerId: 'shared-corpse' },
    }, context) as any;
    expect(corpseStored.events[0]).toMatchObject({
      type: 'character.item_stored',
      payload: { containerId: 'shared-corpse', item: { sharedItemId: 'world-knife' } },
    });
  });

  it('claims shared room loot and corpse or loose gold using the character wallet', async () => {
    const player = character({ wallet: { currencyId: 'gold', balance: 10 } });
    const sharedItem = {
      worldItemId: 'dropped-knife',
      locationId: player.locationId,
      containerId: null,
      item: { id: 'knife', label: 'Dropped knife', description: 'A narrow knife.' },
    };
    const corpse = {
      corpseId: 'gold-corpse',
      encounterId: 'encounter-one',
      opponentId: 'bandit-one',
      opponentName: 'Bandit',
      label: 'Bandit remains',
      description: 'A bandit lies still.',
      locationId: player.locationId,
      currencyId: 'gold',
      currencyAmount: 4,
      goldItemId: 'corpse-gold',
      goldClaimed: false,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    };
    const sharedState = {
      revision: 7,
      items: [
        sharedItem,
        {
          worldItemId: 'expired-pelt',
          locationId: player.locationId,
          containerId: 'expired-corpse',
          item: { id: 'pelt', label: 'Old pelt', description: 'A faded pelt.' },
        },
      ],
      corpses: [
        corpse,
        { ...corpse, corpseId: 'expired-corpse', expiresAt: new Date(now.getTime() - 1_000).toISOString() },
      ],
      currencyDrops: [{
        dropId: 'loose-gold',
        corpseId: 'old-corpse',
        locationId: player.locationId,
        currencyId: 'gold',
        amount: 2,
      }],
    };
    const { commands } = captureCommands(player, sharedState);
    const context = commandContext(player) as any;
    context.world.currency = { id: 'gold', name: 'Gold', symbol: 'g' };

    const itemResult = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'dropped-knife' },
    }, context) as any;
    expect(itemResult).toMatchObject({
      streamId: 'world-items',
      expectedVersion: 7,
      events: [{ type: 'world.item_claimed', payload: { worldItemId: 'dropped-knife' } }],
      effects: [expect.objectContaining({ type: expect.any(String) })],
    });

    sharedState.items[0]!.locationId = 'stillwater-path';
    await expect(commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'dropped-knife' },
    }, context)).rejects.toThrow('not available to take here');
    sharedState.items[0]!.locationId = player.locationId;
    await expect(commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'expired-pelt' },
    }, context)).rejects.toThrow('begun to decay');

    const corpseGold = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'corpse-gold' },
    }, context) as any;
    expect(corpseGold).toMatchObject({
      events: [{
        type: 'world.corpse_gold_claimed',
        payload: { corpseId: 'gold-corpse', currencyId: 'gold', amount: 4 },
      }],
      effects: [expect.objectContaining({ type: expect.any(String) })],
    });

    const looseGold = await commands.get('character.take')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: 'loose-gold' },
    }, context) as any;
    expect(looseGold.events[0]).toMatchObject({
      type: 'world.corpse_gold_claimed',
      payload: { corpseId: 'old-corpse', amount: 2 },
    });

    const walletOverflow = character({
      wallet: { currencyId: 'gold', balance: 2_147_483_647 },
    });
    const overflowCommands = captureCommands(walletOverflow, {
      ...sharedState,
      currencyDrops: [{
        dropId: 'too-much-gold',
        corpseId: 'old-corpse',
        locationId: walletOverflow.locationId,
        currencyId: 'gold',
        amount: 2,
      }],
    }).commands;
    const overflowContext = commandContext(walletOverflow) as any;
    overflowContext.world.currency = { id: 'gold', name: 'Gold', symbol: 'g' };
    await expect(overflowCommands.get('character.take')!({
      characterId: walletOverflow.characterId,
      expectedVersion: walletOverflow.revision,
      payload: { itemId: 'too-much-gold' },
    }, overflowContext)).rejects.toThrow('wallet cannot hold');

    const noWallet = character();
    const noWalletCommands = captureCommands(noWallet, {
      revision: 1,
      items: [],
      corpses: [],
      currencyDrops: [{
        dropId: 'unbankable-gold',
        corpseId: 'old-corpse',
        locationId: noWallet.locationId,
        currencyId: 'gold',
        amount: 1,
      }],
    }).commands;
    const noWalletContext = commandContext(noWallet) as any;
    noWalletContext.world.currency = { id: 'gold', name: 'Gold', symbol: 'g' };
    await expect(noWalletCommands.get('character.take')!({
      characterId: noWallet.characterId,
      expectedVersion: noWallet.revision,
      payload: { itemId: 'unbankable-gold' },
    }, noWalletContext)).rejects.toThrow('wallet is not ready');
  });

  it('drops ordinary items and blocks quest-bound or equipped items', async () => {
    const plainItem = { id: 'spare-rope', label: 'Spare rope', description: 'A length of rope.' };
    const player = character({ inventory: [plainItem] });
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const dropped = await commands.get('character.drop')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: plainItem.id },
    }, context) as any;
    expect(dropped.events[0]).toMatchObject({
      type: 'character.item_dropped',
      payload: { characterId: player.characterId, item: plainItem },
    });

    const questItem = character({
      inventory: [{ ...plainItem, id: 'sealed-ledger', questBound: true }],
    });
    await expect(captureCommands(questItem).commands.get('character.drop')!({
      characterId: questItem.characterId,
      payload: { itemId: 'sealed-ledger' },
    }, commandContext(questItem))).rejects.toThrow('Quest items cannot be dropped');

    const equipped = character({
      inventory: [{ ...plainItem, equipment: { slot: 'weapon', attackBonus: 1, defenseBonus: 0 } }],
      equipment: { weaponItemId: plainItem.id, armorItemId: null },
    });
    await expect(captureCommands(equipped).commands.get('character.drop')!({
      characterId: equipped.characterId,
      payload: { itemId: plainItem.id },
    }, commandContext(equipped))).rejects.toThrow('Unequip that item');
  });

  it('stores carried items only in available containers and enforces capacity', async () => {
    const storedItem = { id: 'canvas-roll', label: 'Canvas roll', description: 'Rolled canvas.' };
    const player = character({
      inventory: [storedItem],
      itemLocations: [{ item: storedItem, locationId: null }],
    });
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const room = context.world.locations.find((candidate) => candidate.id === player.locationId)!;
    room.containers = [{
      id: 'supply-chest',
      label: 'Supply chest',
      description: 'A small storage chest.',
      kind: 'chest',
      capacity: 2,
      contents: [],
    }];
    const put = await commands.get('character.put')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: storedItem.id, containerId: 'supply-chest' },
    }, context) as any;
    expect(put.events[0]).toMatchObject({
      type: 'character.item_stored',
      payload: { containerId: 'supply-chest', item: storedItem },
    });

    player.itemLocations.push({
      item: { id: 'already-stored', label: 'Stored bolt', description: 'A bolt in the chest.' },
      locationId: player.locationId,
      containerId: 'supply-chest',
    } as any);
    room.containers![0]!.capacity = 1;
    room.containers![0]!.contents = [
      { id: 'existing-1', label: 'Existing one', description: 'Stored item.' },
    ];
    await expect(commands.get('character.put')!({
      characterId: player.characterId,
      payload: { itemId: storedItem.id, containerId: 'supply-chest' },
    }, context)).rejects.toThrow('cannot hold any more items');
    await expect(commands.get('character.put')!({
      characterId: player.characterId,
      payload: { itemId: storedItem.id, containerId: 'not-here' },
    }, context)).rejects.toThrow('container is not here');

    const unlocated = character({
      inventory: [storedItem],
      itemLocations: [],
    });
    await expect(captureCommands(unlocated).commands.get('character.put')!({
      characterId: unlocated.characterId,
      payload: { itemId: storedItem.id, containerId: 'supply-chest' },
    }, commandContext(unlocated))).rejects.toThrow('not available to put away');

    const sharedItem = { ...storedItem, id: 'shared-canvas', sharedItemId: 'shared-canvas' };
    const sharedCarrier = character({
      inventory: [sharedItem],
      itemLocations: [{ item: sharedItem, locationId: null }],
    });
    const sharedCommands = captureCommands(sharedCarrier, {
      revision: 1,
      items: [{
        worldItemId: 'shared-canvas',
        locationId: sharedCarrier.locationId,
        containerId: null,
        holderCharacterId: 'another-character',
        item: sharedItem,
      }],
      corpses: [],
      currencyDrops: [],
    }).commands;
    await expect(sharedCommands.get('character.put')!({
      characterId: sharedCarrier.characterId,
      payload: { itemId: sharedItem.id, containerId: 'supply-chest' },
    }, commandContext(sharedCarrier))).rejects.toThrow('not currently held by this character');
  });

  it('equips supported gear, unequips slots, and blocks invalid or in-combat changes', async () => {
    const weapon = {
      id: 'iron-knife',
      label: 'Iron knife',
      description: 'A small iron knife.',
      equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
    };
    const player = character({ inventory: [weapon] });
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const equipped = await commands.get('character.equip')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: weapon.id },
    }, context) as any;
    expect(equipped.events[0]).toMatchObject({
      type: 'character.equipment_changed',
      payload: { slot: 'weapon', itemId: weapon.id },
    });
    await expect(commands.get('character.unequip')!({
      characterId: player.characterId,
      payload: { slot: 'armor' },
    }, context)).rejects.toThrow('no armor equipped');

    const equippedState = character({
      inventory: [weapon],
      equipment: { weaponItemId: weapon.id, armorItemId: null },
    });
    const removed = await captureCommands(equippedState).commands.get('character.unequip')!({
      characterId: equippedState.characterId,
      payload: { slot: 'weapon' },
    }, commandContext(equippedState)) as any;
    expect(removed.events[0].payload).toMatchObject({ slot: 'weapon', itemId: null });

    const nonGear = character({
      inventory: [{ id: 'rope', label: 'Rope', description: 'A length of rope.' }],
    });
    await expect(captureCommands(nonGear).commands.get('character.equip')!({
      characterId: nonGear.characterId,
      payload: { itemId: 'rope' },
    }, commandContext(nonGear))).rejects.toThrow('cannot be equipped');

    const activeCombat = character({ combat: { ...defeatedCombat, status: 'active', playerHealth: 6 } });
    await expect(captureCommands(activeCombat).commands.get('character.equip')!({
      characterId: activeCombat.characterId,
      payload: { itemId: weapon.id },
    }, commandContext(activeCombat))).rejects.toThrow('active encounter');
  });

  it('uses matching room objects and enforces visited-room and prerequisite conditions', async () => {
    const stone = {
      id: 'mossgate-loose-stone',
      label: 'Smooth stone',
      description: 'A pale, smooth stone.',
    };
    const player = character({
      locationId: 'bell-tower-belfry',
      inventory: [stone],
      visitedLocationIds: [],
    });
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const use = commands.get('character.use')!;
    const command = {
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { itemId: stone.id, targetId: 'tower-cracked-bell' },
    };
    await expect(use(command, context)).rejects.toThrow('must first visit West of Old Bell Tower');

    player.visitedLocationIds.push('bell-tower-west');
    const first = await use(command, context) as any;
    expect(first.events[0]).toMatchObject({
      type: 'character.item_used',
      payload: {
        interactionId: 'ring-tower-bell-with-stone',
        response: expect.stringContaining('low, uneven note'),
      },
    });

    const reed = {
      id: 'glasswater-reed',
      label: 'Hollow reed',
      description: 'A length of hollow river reed.',
    };
    player.inventory.push(reed as any);
    const ribbon = { id: 'silk-ribbon', label: 'Silk ribbon', description: 'A narrow strip of silk.' };
    player.inventory.push(ribbon as any);
    await expect(use({
      ...command,
      payload: { itemId: ribbon.id, targetId: 'tower-cracked-bell' },
    }, context)).rejects.toThrow(/You cannot use the silk ribbon on the .* here\./);
    const useReed = {
      ...command,
      payload: { itemId: reed.id, targetId: 'tower-cracked-bell' },
    };
    await expect(use(useReed, context)).rejects.toThrow('first note is still missing');
    player.itemUseObservations.push({
      interactionId: 'ring-tower-bell-with-stone',
      locationId: 'bell-tower-belfry',
      observedAt: now.toISOString(),
    } as any);
    const followUp = await use(useReed, context) as any;
    expect(followUp.events[0].payload).toMatchObject({
      interactionId: 'answer-tower-bell-with-reed',
      response: expect.stringContaining('clear second note'),
    });
    player.itemUseObservations.push({
      interactionId: 'answer-tower-bell-with-reed',
      locationId: 'bell-tower-belfry',
      observedAt: now.toISOString(),
    } as any);
    const repeated = await use(useReed, context) as any;
    expect(repeated.events[0].payload.response).toContain('second note again');

    await expect(use({
      ...command,
      payload: { itemId: stone.id, targetId: 'missing-target' },
    }, context)).rejects.toThrow('not a usable target');
  });

  it('reads room text and trims or validates renames while supporting archive and restore', async () => {
    const player = character();
    const { commands } = captureCommands(player);
    const context = commandContext(player);
    const room = context.world.locations.find((candidate) => candidate.id === player.locationId)!;
    room.readables = [{
      id: 'town-record',
      label: 'Town record',
      description: 'A record of the town.',
      text: 'The market opened years ago.',
    }];
    const read = await commands.get('character.read')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { objectId: 'town-record' },
    }, context) as any;
    expect(read.events[0]).toMatchObject({
      type: 'character.object_read',
      payload: { label: 'Town record', text: 'The market opened years ago.' },
    });
    await expect(commands.get('character.read')!({
      characterId: player.characterId,
      payload: { objectId: 'missing-record' },
    }, context)).rejects.toThrow('not readable');

    const renamed = await commands.get('character.rename')!({
      characterId: player.characterId,
      payload: { name: '  Aster Vale  ' },
    }, context) as any;
    expect(renamed.events[0].payload.name).toBe('Aster Vale');
    await expect(commands.get('character.rename')!({
      characterId: player.characterId,
      payload: { name: '   ' },
    }, context)).rejects.toThrow('Choose a character name');

    expect((await commands.get('character.archive')!({
      characterId: player.characterId,
      payload: {},
    }, context) as any).events[0].type).toBe('character.archived');
    await expect(commands.get('character.restore')!({
      characterId: player.characterId,
      payload: {},
    }, context)).rejects.toThrow('archived character');
    const archived = character({ archived: true });
    expect((await captureCommands(archived).commands.get('character.restore')!({
      characterId: archived.characterId,
      payload: {},
    }, commandContext(archived)) as any).events[0].type).toBe('character.restored');
  });
});

describe('character location and object queries', () => {
  it('projects room contents, NPC detail, exits, and adjacent-room previews', async () => {
    const roomItem = { id: 'lost-glove', label: 'Lost glove', description: 'A wool glove.' };
    const corpseItem = { id: 'bandit-note', label: 'Bandit note', description: 'A folded note.' };
    const basketItem = { id: 'basket-peach', label: 'Peach', description: 'A ripe peach.' };
    const player = character({
      itemLocations: [
        { item: roomItem, locationId: 'mossgate-clearing' },
        { item: corpseItem, locationId: 'mossgate-clearing', containerId: 'fallen-bandit' },
        { item: basketItem, locationId: 'mossgate-clearing', containerId: 'supply-basket' },
      ],
    });
    const corpse = {
      corpseId: 'fallen-bandit',
      encounterId: 'encounter-one',
      opponentId: 'bandit-one',
      opponentName: 'Bandit',
      label: 'Bandit remains',
      description: 'The bandit’s remains lie in the grass.',
      locationId: 'mossgate-clearing',
      currencyId: 'gold',
      currencyAmount: 3,
      goldItemId: 'corpse-gold',
      goldClaimed: false,
      createdAt: new Date(now.getTime() - 100_000).toISOString(),
      expiresAt: new Date(now.getTime() + 100_000).toISOString(),
    };
    const { queries } = captureCommands(player, {
      revision: 5,
      items: [
        {
          worldItemId: 'dropped-lantern',
          locationId: 'mossgate-clearing',
          containerId: null,
          item: { id: 'lantern', label: 'Lantern', description: 'A dented lantern.' },
        },
        {
          worldItemId: 'loot-pouch',
          locationId: 'mossgate-clearing',
          containerId: 'fallen-bandit',
          item: { id: 'pouch', label: 'Small pouch', description: 'A leather pouch.' },
        },
      ],
      corpses: [corpse, {
        ...corpse,
        corpseId: 'old-remains',
        expiresAt: new Date(now.getTime() - 1_000).toISOString(),
      }],
      currencyDrops: [{
        dropId: 'loose-gold',
        corpseId: 'expired-corpse',
        locationId: 'mossgate-clearing',
        currencyId: 'gold',
        amount: 2,
      }],
    });
    const context = commandContext(player) as any;
    context.world.corpseLifecycle.showDecayStages = true;
    context.world.currency = { id: 'gold', name: 'gold', symbol: 'g' };
    const room = context.world.locations.find((candidate: any) => candidate.id === player.locationId);
    room.npcs = [{
      id: 'watcher',
      name: 'Aster Watcher',
      description: 'A road warden with a weathered cloak.',
      activityDescription: 'counting the wagons',
    }];
    for (const destination of context.world.locations) {
      if (destination.id !== room.id) {
        destination.npcs = [{
          id: `preview-${destination.id}`,
          name: 'Road traveler',
          description: 'A traveler with a dusty pack.',
          movement: { path: [] },
        }];
      }
    }
    room.exits[0].requiredInteractionId = 'ring-bell';
    player.itemUseObservations.push({
      interactionId: 'unrelated-interaction',
      locationId: room.id,
      observedAt: now.toISOString(),
    } as any);
    room.readables = [{
      id: 'road-notice',
      label: 'Road notice',
      description: 'A notice pinned to a post.',
      text: 'Repairs are due after the thaw.',
    }];
    room.takeables = [{
      id: 'loose-feather',
      label: 'Blue feather',
      description: 'A bright blue feather.',
      roomDescription: 'A blue feather rests in the grass.',
    }];
    room.interactables = [{
      id: 'stone-marker',
      label: 'Stone marker',
      description: 'A waist-high marker.',
      roomDescription: 'A weathered marker rises beside the road.',
    }];
    room.containers = [{
      id: 'supply-basket',
      label: 'Supply basket',
      description: 'A wicker basket.',
      kind: 'other',
      roomDescription: 'A basket sits by the notice post.',
      contents: [{ id: 'apple', label: 'Apple', description: 'A red apple.' }],
    }];
    context.measureStage = vi.fn(async (_name: string, run: () => Promise<unknown>) => run());

    const projection = await queries.get('location.describe')!({
      characterId: player.characterId,
      payload: { includeNpcDescriptions: true },
    }, context) as any;
    expect(projection).toMatchObject({
      title: 'Mossgate Clearing',
      locationId: player.locationId,
      npcs: [{
        id: 'watcher',
        name: 'Aster Watcher',
        description: 'A road warden with a weathered cloak.',
      }],
    });
    expect(projection.description).toContain('A blue feather rests in the grass.');
    expect(projection.description).toContain('Aster Watcher is here. A road warden');
    expect(projection.description).toContain('Lantern lies here.');
    expect(projection.description).toContain('The bandit’s remains');
    expect(projection.description).toContain('body is breaking down');
    expect(projection.description).not.toContain('old-remains');
    expect(projection.description).toContain('2 gold lies here.');
    expect(projection.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'road-notice', readable: true }),
      expect.objectContaining({ id: 'loose-feather', takeable: true }),
      expect.objectContaining({ id: 'supply-basket', containerKind: 'other' }),
      expect.objectContaining({ id: 'apple', containerId: 'supply-basket' }),
      expect.objectContaining({ id: 'stone-marker' }),
      expect.objectContaining({ id: 'dropped-lantern', takeable: true }),
      expect.objectContaining({ id: 'corpse-gold', containerId: 'fallen-bandit' }),
      expect.objectContaining({ id: 'loose-gold', label: '2 gold' }),
      expect.objectContaining({ id: 'lost-glove' }),
      expect.objectContaining({ id: 'bandit-note', containerId: 'fallen-bandit' }),
      expect.objectContaining({ id: 'basket-peach', containerId: 'supply-basket' }),
    ]));
    expect(projection.exits.some((exit: any) => exit.destinationPreview?.npcs?.length)).toBe(true);
    expect(context.measureStage).toHaveBeenCalled();
    await expect(queries.get('location.describe')!({
      characterId: player.characterId,
      payload: { locationId: 'stillwater-path' },
    }, context)).rejects.toThrow('only inspect your current location');

    room.inn = {} as any;
    delete context.world.currency;
    await expect(queries.get('location.describe')!({
      characterId: player.characterId,
      payload: {},
    }, context)).rejects.toThrow('An authored inn requires configured world currency.');
  });

  it('reads only room readables and inspects room or carried objects', async () => {
    const carried = { id: 'field-journal', label: 'Field journal', description: 'A leatherbound journal.' };
    const roomContents = {
      id: 'stored-canvas',
      label: 'Stored canvas',
      description: 'A folded piece of canvas.',
    };
    const corpseItem = { id: 'corpse-note', label: 'Wolf tag', description: 'A small brass tag.' };
    const looseItem = { id: 'ground-reed', label: 'Ground reed', description: 'A dry reed.' };
    const player = character({
      inventory: [carried],
      itemLocations: [
        { item: roomContents, locationId: 'mossgate-clearing', containerId: 'supply-crate' },
        { item: corpseItem, locationId: 'mossgate-clearing', containerId: 'inspect-corpse' },
        { item: looseItem, locationId: 'mossgate-clearing' },
      ],
      claimedContainerItemIds: ['claimed-token'],
    });
    const corpse = {
      corpseId: 'inspect-corpse',
      encounterId: 'encounter-two',
      opponentId: 'wolf-one',
      opponentName: 'Wolf',
      label: 'Wolf remains',
      description: 'A wolf lies still.',
      locationId: 'mossgate-clearing',
      currencyId: 'gold',
      currencyAmount: 1,
      goldItemId: 'wolf-gold',
      goldClaimed: false,
      createdAt: new Date(now.getTime() - 10_000).toISOString(),
      expiresAt: new Date(now.getTime() + 10_000).toISOString(),
    };
    const { queries } = captureCommands(player, {
      revision: 2,
      items: [
        {
          worldItemId: 'shared-charm',
          locationId: 'mossgate-clearing',
          containerId: null,
          item: { id: 'charm', label: 'Glass charm', description: 'A small glass charm.' },
        },
        {
          worldItemId: 'corpse-pelt',
          locationId: 'mossgate-clearing',
          containerId: 'inspect-corpse',
          item: { id: 'pelt', label: 'Wolf pelt', description: 'A rough pelt.' },
        },
      ],
      corpses: [corpse],
      currencyDrops: [{
        dropId: 'dropped-coins',
        corpseId: 'another-corpse',
        locationId: 'mossgate-clearing',
        currencyId: 'gold',
        amount: 4,
      }],
    });
    const context = commandContext(player);
    const room = context.world.locations.find((candidate) => candidate.id === player.locationId)!;
    room.readables = [{
      id: 'notice',
      label: 'Notice',
      description: 'A folded notice.',
      text: 'The old bridge is open.',
    }];
    room.takeables = [{ id: 'red-berry', label: 'Red berry', description: 'A ripe berry.' }];
    room.containers = [{
      id: 'supply-crate',
      label: 'Supply crate',
      description: 'A wooden crate.',
      kind: 'chest',
      contents: [
        { id: 'green-apple', label: 'Green apple', description: 'A tart apple.' },
        { id: 'claimed-token', label: 'Claimed token', description: 'A wooden token.' },
      ],
    }];
    (context.world as any).currency = { id: 'gold', name: 'gold', symbol: 'g' };
    (context.world as any).corpseLifecycle.showDecayStages = true;

    await expect(queries.get('object.read')!({
      characterId: player.characterId,
      payload: { objectId: 'notice' },
    }, context)).resolves.toMatchObject({
      id: 'notice',
      label: 'Notice',
      text: 'The old bridge is open.',
    });
    await expect(queries.get('object.read')!({
      characterId: player.characterId,
      payload: { objectId: 'red-berry' },
    }, context)).rejects.toThrow('not readable');
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'red-berry' },
    }, context)).resolves.toMatchObject({ id: 'red-berry', label: 'Red berry' });
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'field-journal' },
    }, context)).resolves.toMatchObject({ id: 'field-journal', description: carried.description });
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'supply-crate' },
    }, context)).resolves.toMatchObject({
      id: 'supply-crate',
      description: expect.stringContaining('Green apple, Stored canvas'),
    });
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'inspect-corpse' },
    }, context)).resolves.toMatchObject({
      id: 'inspect-corpse',
      description: expect.stringContaining('Wolf pelt, 1 gold'),
    });
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'shared-charm' },
    }, context)).resolves.toMatchObject({ id: 'shared-charm', label: 'Glass charm' });
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'dropped-coins' },
    }, context)).resolves.toMatchObject({ id: 'dropped-coins', label: '4 gold' });
    await expect(queries.get('object.inspect')!({
      characterId: player.characterId,
      payload: { objectId: 'unknown' },
    }, context)).rejects.toThrow('not here or in your pack');
  });
});
