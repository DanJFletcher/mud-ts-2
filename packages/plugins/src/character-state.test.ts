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
  type CharacterStateCapability,
} from './character.js';
import { worldItemsStateCapability } from './world-items.js';
import { interactionStreamId } from './interactions.js';

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
  let state: CharacterStateCapability | undefined;
  characterPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: unknown) => {
      commands.set(name, handler as (command: any, context: any) => Promise<unknown>);
    },
    registerSystemCommand: (name: string, _schema: unknown, handler: unknown) => {
      systemCommands.set(name, handler as (command: any, context: any) => Promise<unknown>);
    },
    registerQuery: (name: string, _schema: unknown, handler: unknown) => {
      queries.set(name, handler as (query: any, context: any) => Promise<unknown>);
    },
    registerEffect: () => undefined,
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
  return { commands, systemCommands, queries, state, player };
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
    const player = character({
      itemLocations: [{ item: roomItem, locationId: 'mossgate-clearing' }],
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
    ]));
    expect(projection.exits.some((exit: any) => exit.destinationPreview?.locationId)).toBe(true);
    expect(context.measureStage).toHaveBeenCalled();
    await expect(queries.get('location.describe')!({
      characterId: player.characterId,
      payload: { locationId: 'stillwater-path' },
    }, context)).rejects.toThrow('only inspect your current location');
  });

  it('reads only room readables and inspects room or carried objects', async () => {
    const carried = { id: 'field-journal', label: 'Field journal', description: 'A leatherbound journal.' };
    const roomContents = {
      id: 'stored-canvas',
      label: 'Stored canvas',
      description: 'A folded piece of canvas.',
    };
    const player = character({
      inventory: [carried],
      itemLocations: [
        { item: roomContents, locationId: 'mossgate-clearing', containerId: 'supply-crate' },
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
