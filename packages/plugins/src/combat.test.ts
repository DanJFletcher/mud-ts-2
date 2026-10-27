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

function captureCombatPlugin(player: ReturnType<typeof character>, classPolicy?: unknown) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  const effects = new Map<string, (payload: any, context: any) => Promise<void>>();
  const capabilitySequence: unknown[] = [
    { load: vi.fn(async () => player) },
    { register: vi.fn() },
    { register: vi.fn() },
  ];
  combatPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: (command: any, context: any) => Promise<unknown>) => {
      commands.set(name, handler);
    },
    registerQuery: (name: string, _schema: unknown, handler: (query: any, context: any) => Promise<unknown>) => {
      queries.set(name, handler);
    },
    registerEffect: (name: string, _version: number, _schema: unknown, handler: (payload: any, context: any) => Promise<void>) => {
      effects.set(name, handler);
    },
    requireCapability: () => capabilitySequence.shift(),
    optionalCapability: () => classPolicy,
  } as never);
  return { commands, queries, effects };
}

function captureCombatCommands(player: ReturnType<typeof character>, classPolicy?: unknown) {
  return captureCombatPlugin(player, classPolicy).commands;
}

function storedCharacterCreated(characterId: string, locationId: string) {
  const streamId = characterId;
  return {
    eventId: `${characterId}-created`,
    worldInstanceId: 'combat-test-world',
    streamId,
    aggregateId: streamId,
    aggregateVersion: 1,
    type: 'character.created',
    version: 1,
    payload: {
      characterId,
      playerId: 'combat-test-player',
      name: 'Combat Tester',
      startingLocationId: locationId,
    },
    causationCommandId: `${characterId}-create-command`,
    actorId: 'combat-test-player',
    occurredAt: '2026-10-27T12:00:00.000Z',
    tick: 1,
  } as any;
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

  it('rejects rest away from an inn, without a wallet, with insufficient funds, or during combat', async () => {
    const room = demoWorld.locations.find((location) => location.inn);
    if (!room?.inn || !demoWorld.currency) throw new Error('The demo pack needs an inn and currency fixture.');
    const commandFor = (player: ReturnType<typeof character>) => {
      const command = captureCombatCommands(player).get('inn.rest');
      if (!command) throw new Error('The combat plugin did not register inn.rest.');
      return command;
    };
    const input = { characterId: 'combat-test-character', expectedVersion: 1, payload: { innId: room.inn.id } };

    await expect(commandFor(null as any)(input, { world: demoWorld }))
      .rejects.toThrow('no longer available');
    await expect(commandFor(character() as any)(input, { world: demoWorld }))
      .rejects.toThrow('There is no such inn here');

    const innCharacter = character({ locationId: room.id });
    const noCurrencyWorld = structuredClone(demoWorld);
    delete (noCurrencyWorld as any).currency;
    await expect(commandFor(CharacterProjectionSchema.parse({
      ...innCharacter,
      wallet: { currencyId: 'gold', balance: 20 },
      health: { current: 1, maximum: 6 },
    }))(input, { world: noCurrencyWorld }))
      .rejects.toThrow('no configured currency');

    const noWallet = CharacterProjectionSchema.parse({
      ...innCharacter,
      wallet: undefined,
      health: { current: 1, maximum: 6 },
    });
    await expect(commandFor(noWallet)(input, { world: demoWorld }))
      .rejects.toThrow('wallet is not ready');

    const mismatchedWallet = CharacterProjectionSchema.parse({
      ...innCharacter,
      wallet: { currencyId: 'silver', balance: 20 },
      health: { current: 1, maximum: 6 },
    });
    await expect(commandFor(mismatchedWallet)(input, { world: demoWorld }))
      .rejects.toThrow('wallet is not ready');

    const poor = CharacterProjectionSchema.parse({
      ...innCharacter,
      wallet: { currencyId: demoWorld.currency.id, balance: 0 },
      health: { current: 1, maximum: 6 },
    });
    await expect(commandFor(poor)(input, { world: demoWorld }))
      .rejects.toThrow('You need');

    const fighting = CharacterProjectionSchema.parse({
      ...innCharacter,
      wallet: { currencyId: demoWorld.currency.id, balance: 20 },
      health: { current: 1, maximum: 6 },
      combat: {
        encounterId: 'rest-blocked-encounter',
        locationId: room.id,
        opponentNpcId: 'bandit',
        opponentName: 'Bandit',
        round: 1,
        playerHealth: 1,
        playerMaxHealth: 6,
        opponentHealth: 3,
        opponentMaxHealth: 3,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The bandit closes in.',
      },
    });
    await expect(commandFor(fighting)(input, { world: demoWorld }))
      .rejects.toThrow('You cannot rest while combat is active');
  });
});

describe('combat stats query', () => {
  it('returns server-derived stats and rejects unavailable characters', async () => {
    const player = character();
    const query = captureCombatPlugin(player).queries.get('character.stats')!;
    await expect(query({ characterId: player.characterId }, { world: demoWorld })).resolves.toMatchObject({
      attributes: expect.objectContaining({ strength: 10, constitution: 10 }),
      attackPower: expect.any(Number),
      damage: expect.any(Number),
    });

    const missing = captureCombatPlugin(null as any).queries.get('character.stats')!;
    await expect(missing({ characterId: player.characterId }, { world: demoWorld }))
      .rejects.toThrow('no longer available');
    const archived = CharacterProjectionSchema.parse({ ...player, archived: true });
    const archivedQuery = captureCombatPlugin(archived).queries.get('character.stats')!;
    await expect(archivedQuery({ characterId: player.characterId }, { world: demoWorld }))
      .rejects.toThrow('no longer available');
  });
});

describe('hostile NPC room-entry effect', () => {
  function effectFixture(options: {
    history?: any[];
    prior?: any;
    hostile?: boolean;
    appendReceipt?: { ok: boolean; code?: string };
  } = {}) {
    const characterId = 'combat-test-character';
    const opponent = {
      id: 'hostile-scout',
      name: 'Hostile Scout',
      combatDisposition: options.hostile === false ? 'passive' : 'hostile',
      combatProfile: { maxHealth: 5, attackDamage: 1 },
    };
    const world = { locations: [{ id: 'room-a', npcs: [opponent] }], roads: [] };
    const plugin = captureCombatPlugin(character({ locationId: 'room-a' }));
    const lookupCommand = vi.fn(async () => options.prior);
    const readStream = vi.fn(async () => options.history ?? [
      storedCharacterCreated(characterId, 'room-a'),
    ]);
    const append = vi.fn(async () => ({ receipt: options.appendReceipt ?? { ok: true, code: 'accepted' } }));
    const effect = plugin.effects.get('combat.hostile-npc-entry');
    if (!effect) throw new Error('The combat plugin did not register the hostile-entry effect.');
    return {
      effect,
      world,
      store: { lookupCommand, readStream, append },
      characterId,
    };
  }

  it('starts and records one authoritative encounter when a living character enters a hostile room', async () => {
    const fixture = effectFixture();
    await fixture.effect({
      characterId: fixture.characterId,
      fromLocationId: 'road',
      toLocationId: 'room-a',
    }, {
      effectId: 'hostile-entry-1',
      worldInstanceId: 'combat-test-world',
      world: fixture.world,
      store: fixture.store,
    } as any);

    expect(fixture.store.lookupCommand).toHaveBeenCalledWith(
      'combat-test-world',
      expect.any(String),
      'hostile-npc-entry:hostile-entry-1',
      expect.any(String),
    );
    expect(fixture.store.append).toHaveBeenCalledWith(expect.objectContaining({
      streamId: fixture.characterId,
      expectedVersion: 1,
      events: [expect.objectContaining({
        type: 'character.combat_encounter_started',
        payload: expect.objectContaining({
          characterId: fixture.characterId,
          encounter: expect.objectContaining({
            encounterId: 'hostile-entry-1',
            opponentNpcId: 'hostile-scout',
            status: 'active',
          }),
        }),
      })],
    }));
  });

  it('honors successful and conflicting idempotency receipts', async () => {
    const prior = effectFixture({ prior: { receipt: { ok: true } } });
    await prior.effect({ characterId: prior.characterId, toLocationId: 'room-a' }, {
      effectId: 'hostile-entry-retry',
      worldInstanceId: 'combat-test-world',
      world: prior.world,
      store: prior.store,
    } as any);
    expect(prior.store.readStream).not.toHaveBeenCalled();
    expect(prior.store.append).not.toHaveBeenCalled();

    const conflict = effectFixture({ prior: { receipt: { ok: false } } });
    await expect(conflict.effect({ characterId: conflict.characterId, toLocationId: 'room-b' }, {
      effectId: 'hostile-entry-retry',
      worldInstanceId: 'combat-test-world',
      world: conflict.world,
      store: conflict.store,
    } as any)).rejects.toThrow('reused with a different payload');
  });

  it('skips stale, missing, already-active, and passive encounters and reports append failure', async () => {
    const stale = effectFixture({
      history: [storedCharacterCreated('combat-test-character', 'another-room')],
    });
    await stale.effect({ characterId: stale.characterId, toLocationId: 'room-a' }, {
      effectId: 'stale-entry',
      worldInstanceId: 'combat-test-world',
      world: stale.world,
      store: stale.store,
    } as any);
    expect(stale.store.append).not.toHaveBeenCalled();

    const missing = effectFixture({ history: [] });
    await missing.effect({ characterId: missing.characterId, toLocationId: 'room-a' }, {
      effectId: 'missing-character-entry',
      worldInstanceId: 'combat-test-world',
      world: missing.world,
      store: missing.store,
    } as any);
    expect(missing.store.append).not.toHaveBeenCalled();

    const passive = effectFixture({ hostile: false });
    await passive.effect({ characterId: passive.characterId, toLocationId: 'room-a' }, {
      effectId: 'passive-entry',
      worldInstanceId: 'combat-test-world',
      world: passive.world,
      store: passive.store,
    } as any);
    expect(passive.store.append).not.toHaveBeenCalled();

    const failing = effectFixture({ appendReceipt: { ok: false, code: 'version-conflict' } });
    await expect(failing.effect({ characterId: failing.characterId, toLocationId: 'room-a' }, {
      effectId: 'failed-entry',
      worldInstanceId: 'combat-test-world',
      world: failing.world,
      store: failing.store,
    } as any)).rejects.toThrow('Could not start hostile encounter: version-conflict');
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

  it('finds road encounters and begins a fight against an authored road opponent', async () => {
    const road = demoWorld.roads.find((candidate) => candidate.encounters.length > 0);
    const roadOpponent = road?.encounters[0];
    if (!road || !roadOpponent) throw new Error('The demo pack needs a road encounter fixture.');
    const player = character();
    const command = captureCombatCommands(player).get('combat.action')!;
    const result = await command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'attack', targetNpcId: roadOpponent.id },
    }, {
      world: demoWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'road-encounter-id',
      commandId: 'road-encounter-command',
      rng: { roll: vi.fn().mockReturnValue(1) },
    }) as any;

    expect(result.events.find((event: any) => event.type === 'character.combat_action_resolved')
      .payload.encounter).toMatchObject({
        encounterId: 'road-encounter-id',
        opponentNpcId: roadOpponent.id,
        status: expect.any(String),
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

    await expect(captureCombatCommands(null as any).get('combat.action')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'attack', targetNpcId: 'mossgate-training-sentinel' },
    }, {
      world: demoWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'unused-encounter',
      commandId: 'missing-character-combat',
    })).rejects.toThrow('no longer available');

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

    await expect(command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'defend' },
    }, {
      world: demoWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'unused-encounter',
      commandId: 'no-combatant-command',
    })).rejects.toThrow('Choose a combatant here to begin a fight');
  });

  it('rejects fleeing when recovery leaves too little stamina', async () => {
    const player = character({
      locationId: 'mossgate-clearing',
      resources: {
        stamina: { current: 0, maximum: 100 },
        mana: { current: 100, maximum: 100 },
      },
      combat: {
        encounterId: 'low-stamina-encounter',
        locationId: 'mossgate-clearing',
        opponentNpcId: 'mossgate-training-sentinel',
        opponentName: 'Practice Sentinel',
        opponentStyle: 'steady',
        round: 0,
        playerHealth: 6,
        playerMaxHealth: 6,
        opponentHealth: 20,
        opponentMaxHealth: 20,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The sentinel clicks into position.',
      },
    });
    const command = captureCombatCommands(player).get('combat.action')!;
    await expect(command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'flee', encounterId: 'low-stamina-encounter' },
    }, {
      world: demoWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'unused',
      commandId: 'low-stamina-flee',
    })).rejects.toThrow('need 20 stamina to flee');
  });

  it('uses a healing item outside combat and rejects missing, non-healing, and full-health cases', async () => {
    const potion = {
      id: 'healing-potion',
      label: 'Healing potion',
      description: 'A small red vial.',
      consumable: { effect: 'heal', amount: 5 },
    };
    const wounded = CharacterProjectionSchema.parse({
      ...character({ health: { current: 2, maximum: 6 } }),
      inventory: [potion],
    });
    const command = captureCombatCommands(wounded).get('combat.action')!;
    const result = await command({
      characterId: wounded.characterId,
      expectedVersion: wounded.revision,
      payload: { action: 'use-item', itemId: potion.id },
    }, { world: demoWorld, now: () => new Date('2026-10-27T12:00:00.000Z') });
    const healingEvent = (result as any).events[0];
    expect(healingEvent.type).toBe('character.combat_item_used');
    expect(healingEvent.payload).toMatchObject({
      itemId: potion.id,
      healingDone: 4,
      health: { current: 6, maximum: 6 },
    });

    await expect(command({
      characterId: wounded.characterId,
      expectedVersion: wounded.revision,
      payload: { action: 'use-item', itemId: 'missing-item' },
    }, { world: demoWorld, now: () => new Date('2026-10-27T12:00:00.000Z') }))
      .rejects.toThrow('not carrying that item');

    const tool = CharacterProjectionSchema.parse({
      ...wounded,
      inventory: [{ id: 'rope', label: 'Rope', description: 'A length of rope.' }],
    });
    await expect(captureCombatCommands(tool).get('combat.action')!({
      characterId: tool.characterId,
      expectedVersion: tool.revision,
      payload: { action: 'use-item', itemId: 'rope' },
    }, { world: demoWorld, now: () => new Date('2026-10-27T12:00:00.000Z') }))
      .rejects.toThrow('cannot be used as a healing item');

    const full = CharacterProjectionSchema.parse({
      ...wounded,
      health: { current: 6, maximum: 6 },
    });
    await expect(captureCombatCommands(full).get('combat.action')!({
      characterId: full.characterId,
      expectedVersion: full.revision,
      payload: { action: 'use-item', itemId: potion.id },
    }, { world: demoWorld, now: () => new Date('2026-10-27T12:00:00.000Z') }))
      .rejects.toThrow('already at full health');
    await expect(captureCombatCommands(full).get('combat.action')!({
      characterId: full.characterId,
      expectedVersion: full.revision,
      payload: { action: 'use-item', itemId: potion.id, encounterId: 'expired' },
    }, { world: demoWorld, now: () => new Date('2026-10-27T12:00:00.000Z') }))
      .rejects.toThrow('no longer active');
  });

  it('awards victory experience and produces a world corpse after a lethal attack', async () => {
    const world = structuredClone(demoWorld);
    const sentinel = world.locations.find((location) => location.id === 'mossgate-clearing')!
      .npcs!.find((npc) => npc.id === 'mossgate-training-sentinel')!;
    sentinel.combatProfile!.maxHealth = 1;
    const player = character({ locationId: 'mossgate-clearing' });
    const command = captureCombatCommands(player).get('combat.action')!;
    const ids = ['victory-encounter', 'victory-corpse'];
    const result = await command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'attack', targetNpcId: sentinel.id },
    }, {
      world,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => ids.shift() ?? 'extra-id',
      commandId: 'victory-command',
      rng: { roll: vi.fn().mockReturnValue(1) },
    });
    const events = (result as any).events;

    expect(events.find((event: any) => event.type === 'character.combat_action_resolved'))
      .toMatchObject({ payload: { encounter: { status: 'victory', opponentHealth: 0 } } });
    expect(events.find((event: any) => event.type === 'character.advancement_awarded'))
      .toMatchObject({ version: 2, payload: { experienceAwarded: 10, totalExperience: 10 } });
    expect((result as any).effects).toHaveLength(1);
    expect((result as any).effects[0]).toMatchObject({
      type: 'world-corpse.create',
      payload: { corpse: { corpseId: 'corpse:victory-corpse', opponentId: sentinel.id } },
    });
  });

  it('uses healing items in an active encounter and rejects invalid or unnecessary healing', async () => {
    const potion = {
      id: 'combat-potion',
      label: 'Combat potion',
      description: 'A restorative draught.',
      consumable: { effect: 'heal', amount: 4 },
    };
    const activeState = {
      encounterId: 'item-encounter',
      locationId: 'mossgate-clearing',
      opponentNpcId: 'mossgate-training-sentinel',
      opponentName: 'Practice Sentinel',
      opponentStyle: 'steady',
      round: 1,
      playerHealth: 2,
      playerMaxHealth: 6,
      opponentHealth: 20,
      opponentMaxHealth: 20,
      status: 'active',
      lastAction: 'attack',
      lastNarration: 'The sentinel clicks into position.',
    };
    const player = CharacterProjectionSchema.parse({
      ...character({
        locationId: 'mossgate-clearing',
        health: { current: 2, maximum: 6 },
        combat: activeState,
      }),
      inventory: [potion],
    });
    const command = captureCombatCommands(player).get('combat.action')!;
    const context = { world: demoWorld, now: () => new Date('2026-10-27T12:00:00.000Z') };
    const healed = await command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'use-item', itemId: potion.id, encounterId: activeState.encounterId },
    }, context) as any;
    expect(healed.events.find((event: any) => event.type === 'character.combat_action_resolved').payload)
      .toMatchObject({ healingDone: 4, consumedItemId: potion.id });

    await expect(command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'use-item', itemId: 'missing', encounterId: activeState.encounterId },
    }, context)).rejects.toThrow('not carrying that item');

    const ropeCarrier = CharacterProjectionSchema.parse({
      ...player,
      inventory: [{ id: 'rope', label: 'Rope', description: 'A length of rope.' }],
    });
    await expect(captureCombatCommands(ropeCarrier).get('combat.action')!({
      characterId: ropeCarrier.characterId,
      expectedVersion: ropeCarrier.revision,
      payload: { action: 'use-item', itemId: 'rope', encounterId: activeState.encounterId },
    }, context)).rejects.toThrow('cannot be used as a combat item');

    const fullHealth = CharacterProjectionSchema.parse({
      ...player,
      health: { current: 6, maximum: 6 },
      combat: { ...activeState, playerHealth: 6 },
    });
    await expect(captureCombatCommands(fullHealth).get('combat.action')!({
      characterId: fullHealth.characterId,
      expectedVersion: fullHealth.revision,
      payload: { action: 'use-item', itemId: potion.id, encounterId: activeState.encounterId },
    }, context)).rejects.toThrow('already at full health');
  });

  it('uses heavy-opponent narration, applies defeat, and schedules character respawn', async () => {
    const heavyWorld = structuredClone(demoWorld);
    const sentinel = heavyWorld.locations.find((location) => location.id === 'mossgate-clearing')!
      .npcs!.find((npc) => npc.id === 'mossgate-training-sentinel')!;
    sentinel.combatProfile!.style = 'heavy';
    const playerAtStart = character({
      locationId: 'mossgate-clearing',
      combat: {
        encounterId: 'heavy-encounter',
        locationId: 'mossgate-clearing',
        opponentNpcId: sentinel.id,
        opponentName: sentinel.name,
        opponentStyle: 'heavy',
        round: 0,
        playerHealth: 6,
        playerMaxHealth: 6,
        opponentHealth: 20,
        opponentMaxHealth: 20,
        status: 'active',
        lastAction: 'attack',
        lastNarration: 'The sentinel clicks into position.',
      },
    });
    const command = captureCombatCommands(playerAtStart).get('combat.action')!;
    const firstDefend = await command({
      characterId: playerAtStart.characterId,
      expectedVersion: playerAtStart.revision,
      payload: { action: 'defend', encounterId: 'heavy-encounter' },
    }, {
      world: heavyWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
    }) as any;
    expect(firstDefend.events.find((event: any) => event.type === 'character.combat_action_resolved')
      .payload.encounter.lastNarration).toContain('winds up');
    const heavyAttack = await command({
      characterId: playerAtStart.characterId,
      expectedVersion: playerAtStart.revision,
      payload: { action: 'attack', encounterId: 'heavy-encounter' },
    }, {
      world: heavyWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
    }) as any;
    expect(heavyAttack.events.find((event: any) => event.type === 'character.combat_action_resolved')
      .payload.encounter.lastNarration).toContain('winds up for a heavy strike');

    const lethalWorld = structuredClone(heavyWorld);
    const lethalOpponent = lethalWorld.locations.find((location) => location.id === 'mossgate-clearing')!
      .npcs!.find((npc) => npc.id === sentinel.id)!;
    lethalOpponent.combatProfile!.style = 'steady';
    lethalOpponent.combatProfile!.attackDamage = 99;
    const injured = CharacterProjectionSchema.parse({
      ...playerAtStart,
      health: { current: 1, maximum: 6 },
      combat: {
        ...playerAtStart.combat!,
        opponentStyle: 'steady',
        playerHealth: 1,
      },
    });
    const defeated = await captureCombatCommands(injured).get('combat.action')!({
      characterId: injured.characterId,
      expectedVersion: injured.revision,
      payload: { action: 'attack', encounterId: 'heavy-encounter' },
    }, {
      world: lethalWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'defeat-generated-id',
      rng: { roll: vi.fn().mockReturnValue(1) },
    }) as any;
    expect(defeated.events.find((event: any) => event.type === 'character.combat_action_resolved')
      .payload.encounter.status).toBe('defeat');
    expect(defeated.events.find((event: any) => event.type === 'character.respawned'))
      .toMatchObject({ payload: { respawnLocationId: 'stillwater-fountain' } });

  });

  it('rejects unsupported abilities, stale encounters, and combat at a different location', async () => {
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
    const command = captureCombatCommands(player).get('combat.action')!;
    const baseContext = {
      world: demoWorld,
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      makeId: () => 'unused',
      commandId: 'unsupported-ability-command',
    };
    await expect(command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'ability', encounterId: 'active-encounter', abilityId: 'power-strike' },
    }, baseContext)).rejects.toThrow('ABILITY_UNSUPPORTED');
    await expect(command({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'defend', encounterId: 'stale-encounter' },
    }, baseContext)).rejects.toThrow('no longer active');
    const missingOpponentWorld = structuredClone(demoWorld);
    missingOpponentWorld.locations.find((location) => location.id === 'mossgate-clearing')!.npcs = [];
    await expect(captureCombatCommands(player).get('combat.action')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'defend', encounterId: 'active-encounter' },
    }, { ...baseContext, world: missingOpponentWorld }))
      .rejects.toThrow('opponent is no longer available');

    const policy = { resolve: vi.fn(() => { throw new Error('policy rejected ability'); }) };
    await expect(captureCombatCommands(player, policy).get('combat.action')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'ability', encounterId: 'active-encounter', abilityId: 'power-strike' },
    }, baseContext)).rejects.toThrow('policy rejected ability');
    expect(policy.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: player.characterId }),
      'power-strike',
      'active-encounter',
      baseContext.commandId,
    );

    const classPlayer = {
      ...player,
      characterClass: { coreAction: { label: 'Power strike' } },
    } as any;
    const abilityEvent = {
      type: 'character.class_ability_used',
      version: 1,
      payload: { characterId: player.characterId, abilityId: 'power-strike' },
    };
    const successfulPolicy = {
      resolve: vi.fn(() => ({ damage: 3, event: abilityEvent })),
    };
    const resolvedAbility = await captureCombatCommands(classPlayer, successfulPolicy).get('combat.action')!({
      characterId: player.characterId,
      expectedVersion: player.revision,
      payload: { action: 'ability', encounterId: 'active-encounter', abilityId: 'power-strike' },
    }, baseContext) as any;
    expect(resolvedAbility.events).toContainEqual(abilityEvent);
    expect(resolvedAbility.events.find((event: any) => event.type === 'character.combat_action_resolved')
      .payload.encounter.lastNarration).toContain('Power strike:');

    const elsewhere = CharacterProjectionSchema.parse({
      ...player,
      locationId: 'southbound-track',
    });
    await expect(captureCombatCommands(elsewhere).get('combat.action')!({
      characterId: elsewhere.characterId,
      expectedVersion: elsewhere.revision,
      payload: { action: 'defend', encounterId: 'active-encounter' },
    }, baseContext)).rejects.toThrow('no longer at the combat location');
  });
});
