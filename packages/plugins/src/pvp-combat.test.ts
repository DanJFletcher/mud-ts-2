import { describe, expect, it, vi } from 'vitest';
import { CharacterProjectionSchema } from '@mudd/contracts';
import { interactionStreamId, type InteractionRequestPolicy } from './interactions.js';
import { registerPvpCombat } from './pvp-combat.js';
import type { CharacterStateCapability } from './character.js';

const worldInstanceId = 'pvp-unit-world';
const occurredAt = '2026-10-27T12:00:00.000Z';

function character(characterId: string, name: string, overrides: Record<string, unknown> = {}) {
  return CharacterProjectionSchema.parse({
    characterId,
    worldInstanceId,
    name,
    locationId: 'market-square',
    revision: 3,
    health: { current: 6, maximum: 6 },
    ...overrides,
  });
}

function activeCharacterCombat() {
  return {
    encounterId: 'personal-encounter',
    locationId: 'market-square',
    opponentNpcId: 'bandit',
    opponentName: 'Bandit',
    round: 1,
    playerHealth: 6,
    playerMaxHealth: 6,
    opponentHealth: 5,
    opponentMaxHealth: 5,
    lastAction: 'attack',
    lastNarration: 'The fight continues.',
    status: 'active',
  };
}

function participant(characterId: string, name: string, health = 6) {
  return { characterId, name, health, maximumHealth: 6 };
}

function encounter(status: 'active' | 'resolving' | 'completed' = 'active') {
  return {
    encounterId: 'duel-one',
    requestId: 'request-one',
    locationId: 'market-square',
    participants: [participant('character-one', 'Aster'), participant('character-two', 'Briar')],
    turnCharacterId: status === 'active' ? 'character-one' : null,
    round: 0,
    status,
    lastNarration: 'The duel begins.',
    updatedAt: occurredAt,
  };
}

function stored(type: string, payload: Record<string, unknown>, aggregateVersion = 1) {
  return {
    type,
    version: 1,
    eventId: `${type}-${aggregateVersion}`,
    worldInstanceId,
    streamId: interactionStreamId(worldInstanceId),
    aggregateId: interactionStreamId(worldInstanceId),
    aggregateVersion,
    causationCommandId: `command-${aggregateVersion}`,
    actorId: 'player-one',
    occurredAt,
    tick: aggregateVersion,
    payload,
  } as any;
}

function characterCreated(id: string, name: string) {
  return {
    ...stored('character.created', {
      characterId: id,
      playerId: `player-${id}`,
      name,
      startingLocationId: 'market-square',
    }),
    streamId: id,
    aggregateId: id,
  };
}

function harness(options: {
  first?: ReturnType<typeof character>;
  second?: ReturnType<typeof character>;
  events?: any[];
  world?: any;
  classPolicy?: any;
} = {}) {
  const first = options.first ?? character('character-one', 'Aster');
  const second = options.second ?? character('character-two', 'Briar');
  const characters = new Map([
    [first.characterId, first],
    [second.characterId, second],
  ]);
  const commands = new Map<string, (command: any, context: any) => Promise<any>>();
  const effects = new Map<string, (payload: any, context: any) => Promise<void>>();
  const policies = new Map<string, InteractionRequestPolicy>();
  let events = options.events ?? [stored('pvp.encounter.started', {
    encounter: encounter(),
    participants: [
      {
        characterId: first.characterId,
        characterHealthAnchor: 6,
        attackDamage: 2,
        defenseReduction: 0,
        consumables: [],
        consumedItemIds: [],
      },
      {
        characterId: second.characterId,
        characterHealthAnchor: 6,
        attackDamage: 2,
        defenseReduction: 0,
        consumables: [],
        consumedItemIds: [],
      },
    ],
    guardingCharacterId: null,
  })];
  const streams = new Map<string, any[]>([...characters].map(([id, projection]) =>
    [id, [characterCreated(id, projection.name)]]));
  const commandReceipts = new Set<string>();
  const store = {
    readStream: vi.fn(async (_worldId: string, streamId: string) =>
      streamId === interactionStreamId(worldInstanceId) ? events : streams.get(streamId) ?? []),
    lookupCommand: vi.fn(async (_worldId: string, _actorId: string, commandId: string) =>
      commandReceipts.has(commandId) ? { commandId } : undefined),
    append: vi.fn(async (input: any) => {
      const appended = input.events.map((proposed: any, index: number) => ({
        ...stored(proposed.type, proposed.payload, input.expectedVersion + index + 1),
        streamId: input.streamId,
        aggregateId: input.streamId,
        actorId: input.actorId,
      }));
      if (input.streamId === interactionStreamId(worldInstanceId)) {
        events = [...events, ...appended];
      } else {
        streams.set(input.streamId, [...(streams.get(input.streamId) ?? []), ...appended]);
      }
      commandReceipts.add(input.commandId);
      return { receipt: { ok: true }, events: appended };
    }),
  };
  const characterState = {
    load: vi.fn(async (_context: unknown, characterId: string) => characters.get(characterId)),
  } as unknown as CharacterStateCapability;

  registerPvpCombat({
    registerCommand: (name: string, _schema: unknown, handler: any) => commands.set(name, handler),
    registerEffect: (name: string, _version: number, _schema: unknown, handler: any) => effects.set(name, handler),
    requireCapability: () => ({ register: (kind: string, policy: InteractionRequestPolicy) => policies.set(kind, policy) }),
    optionalCapability: () => options.classPolicy,
  } as never, characterState);

  const context = {
    worldInstanceId,
    world: options.world ?? {},
    store,
    commandId: 'command-pvp-action',
    now: () => new Date(occurredAt),
    makeId: () => 'generated-duel',
  };

  return { commands, effects, policies, characters, characterState, events, streams, store, context };
}

describe('PvP combat plugin', () => {
  it('prepares a consent request only for living, standing characters in the same room', async () => {
    const test = harness({ events: [] });
    const policy = test.policies.get('pvp.challenge');
    expect(policy).toBeDefined();

    await expect(policy!.prepareRequest({
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    }, test.context as any)).resolves.toEqual({
      initiatorName: 'Aster',
      recipientName: 'Briar',
    });

    const elsewhere = harness({
      second: character('character-two', 'Briar', { locationId: 'south-bridge' }),
      events: [],
    });
    await expect(elsewhere.policies.get('pvp.challenge')!.prepareRequest({
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    }, elsewhere.context as any)).rejects.toThrow('same room');

    const unavailable = harness({
      second: character('character-two', 'Briar', { health: { current: 0, maximum: 6 } }),
      events: [],
    });
    await expect(unavailable.policies.get('pvp.challenge')!.prepareRequest({
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    }, unavailable.context as any)).rejects.toThrow();

    const archived = harness({
      first: character('character-one', 'Aster', { archived: true }),
      events: [],
    });
    await expect(archived.policies.get('pvp.challenge')!.prepareRequest({
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    }, archived.context as any)).rejects.toThrow('That player is not available.');

    const fighting = harness({
      first: character('character-one', 'Aster', { combat: activeCharacterCombat() }),
      events: [],
    });
    await expect(fighting.policies.get('pvp.challenge')!.prepareRequest({
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    }, fighting.context as any)).rejects.toThrow('A player already has an active encounter.');

    const worldBusy = harness();
    await expect(worldBusy.policies.get('pvp.challenge')!.prepareRequest({
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    }, worldBusy.context as any)).rejects.toThrow('A PvP encounter is already active in this world.');
  });

  it('starts a duel on acceptance and adds character revision guards', async () => {
    const tonic = {
      id: 'challenge-tonic',
      label: 'Challenge tonic',
      description: 'A healing tonic.',
      consumable: { effect: 'heal', amount: 2 },
    };
    const test = harness({
      first: character('character-one', 'Aster', { inventory: [tonic] }),
      events: [],
    });
    const policy = test.policies.get('pvp.challenge')!;
    const result = await policy.prepareAcceptance({
      requestId: 'request-one',
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    } as any, test.context as any);

    expect(result).toEqual([expect.objectContaining({
      type: 'pvp.encounter.started',
      payload: expect.objectContaining({
        encounter: expect.objectContaining({
          encounterId: 'generated-duel',
          turnCharacterId: 'character-one',
          status: 'active',
          participants: [
            expect.objectContaining({ characterId: 'character-one', name: 'Aster' }),
            expect.objectContaining({ characterId: 'character-two', name: 'Briar' }),
          ],
        }),
        participants: expect.arrayContaining([expect.objectContaining({
          characterId: 'character-one',
          consumables: [{ itemId: 'challenge-tonic', amount: 2 }],
        })]),
      }),
    })]);

    const ruleset = harness({ events: [], world: { classCatalog: {} } });
    const guarded = await ruleset.policies.get('pvp.challenge')!.prepareAcceptance({
      requestId: 'request-ruleset',
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    } as any, ruleset.context as any);
    expect(guarded).toMatchObject({
      guards: expect.arrayContaining([
        { streamId: 'character-one', expectedVersion: 3 },
        { streamId: 'character-two', expectedVersion: 3 },
        { streamId: 'world-team-combat', expectedVersion: 0 },
        { streamId: interactionStreamId(worldInstanceId), expectedVersion: 0 },
      ]),
    });

    const archived = harness({
      first: character('character-one', 'Aster', { archived: true }),
      events: [],
    });
    await expect(archived.policies.get('pvp.challenge')!.prepareAcceptance({
      requestId: 'request-one',
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    } as any, archived.context as any)).rejects.toThrow('A player is no longer available.');

    const apart = harness({
      second: character('character-two', 'Briar', { locationId: 'south-bridge' }),
      events: [],
    });
    await expect(apart.policies.get('pvp.challenge')!.prepareAcceptance({
      requestId: 'request-one',
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    } as any, apart.context as any)).rejects.toThrow('same room');

    const fighting = harness({
      first: character('character-one', 'Aster', { combat: activeCharacterCombat() }),
      events: [],
    });
    await expect(fighting.policies.get('pvp.challenge')!.prepareAcceptance({
      requestId: 'request-one',
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    } as any, fighting.context as any)).rejects.toThrow('A player already has an active encounter.');

    const worldBusy = harness();
    await expect(worldBusy.policies.get('pvp.challenge')!.prepareAcceptance({
      requestId: 'request-one',
      initiatorCharacterId: 'character-one',
      recipientCharacterId: 'character-two',
    } as any, worldBusy.context as any)).rejects.toThrow('A PvP encounter is already active in this world.');
  });

  it('records attack and defend actions while enforcing turn and encounter ownership', async () => {
    const test = harness({ world: { classCatalog: {} } });
    const action = test.commands.get('pvp.action')!;
    const attack = await action({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, test.context);
    expect(attack.events[0]).toMatchObject({
      type: 'pvp.action.resolved',
      payload: {
        encounter: {
          round: 1,
          status: 'active',
          turnCharacterId: 'character-two',
        },
      },
    });
    const attacked = attack.events[0].payload.encounter.participants
      .find((entry: any) => entry.characterId === 'character-two');
    expect(attacked.health).toBe(4);

    const waiting = harness();
    await expect(waiting.commands.get('pvp.action')!({
      characterId: 'character-two',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, waiting.context)).rejects.toThrow('Wait for your turn.');

    const missing = harness({ events: [] });
    await expect(missing.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, missing.context)).rejects.toThrow('no longer active');
  });

  it('rejects an outsider and characters that disappear during a PvP action', async () => {
    const outsider = harness();
    await expect(outsider.commands.get('pvp.action')!({
      characterId: 'unrelated-character',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, outsider.context)).rejects.toThrow('You are not part of that encounter.');

    const missingActor = harness();
    missingActor.characters.delete('character-one');
    await expect(missingActor.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, missingActor.context)).rejects.toThrow('That character is no longer available.');

    const missingOpponent = harness();
    missingOpponent.characters.delete('character-two');
    await expect(missingOpponent.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, missingOpponent.context)).rejects.toThrow('A PvP participant is no longer available.');
  });

  it('finishes flee actions with an outcome effect and clears a defender on the next hit', async () => {
    const fleeing = harness();
    const flee = await fleeing.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'flee' },
    }, fleeing.context);
    expect(flee.events[0].payload.encounter).toMatchObject({
      status: 'resolving',
      turnCharacterId: null,
    });
    expect(flee.effects[0]).toMatchObject({ type: 'pvp.apply_outcome', version: 1 });

    const guardedEvents = [stored('pvp.encounter.started', {
      encounter: encounter(),
      participants: [
        {
          characterId: 'character-one',
          characterHealthAnchor: 6,
          attackDamage: 2,
          defenseReduction: 0,
          consumables: [],
          consumedItemIds: [],
        },
        {
          characterId: 'character-two',
          characterHealthAnchor: 6,
          attackDamage: 2,
          defenseReduction: 0,
          consumables: [],
          consumedItemIds: [],
        },
      ],
      guardingCharacterId: 'character-two',
    })];
    const guarded = harness({ events: guardedEvents });
    const hit = await guarded.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, guarded.context);
    expect(hit.events[0].payload.encounter.participants[1].health).toBe(6);
    expect(hit.events[0].payload.guardingCharacterId).toBeNull();
  });

  it('supports a guarded stance and a single healing item with the correct encounter inventory', async () => {
    const defending = harness();
    const defended = await defending.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'defend' },
    }, defending.context);
    expect(defended.events[0].payload).toMatchObject({
      guardingCharacterId: 'character-one',
      encounter: { round: 1, status: 'active' },
    });

    const tonic = {
      id: 'small-tonic',
      label: 'Small tonic',
      description: 'A healing tonic.',
      consumable: { effect: 'heal', amount: 2 },
    };
    const injuredPlayer = character('character-one', 'Aster', {
      health: { current: 3, maximum: 6 },
      inventory: [tonic],
    });
    const healingState = {
      encounter: {
        ...encounter(),
        participants: [participant('character-one', 'Aster', 3), participant('character-two', 'Briar')],
      },
      participants: [
        {
          characterId: 'character-one',
          characterHealthAnchor: 3,
          attackDamage: 2,
          defenseReduction: 0,
          consumables: [{ itemId: 'small-tonic', amount: 2 }],
          consumedItemIds: [],
        },
        {
          characterId: 'character-two',
          characterHealthAnchor: 6,
          attackDamage: 2,
          defenseReduction: 0,
          consumables: [],
          consumedItemIds: [],
        },
      ],
      guardingCharacterId: null,
    };
    const healing = harness({
      first: injuredPlayer,
      events: [stored('pvp.encounter.started', healingState)],
    });
    const result = await healing.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'use-item', itemId: 'small-tonic' },
    }, healing.context);
    expect(result.events[0].payload.encounter.participants[0].health).toBe(5);
    expect(result.events[0].payload.participants[0].consumedItemIds).toEqual(['small-tonic']);

    const fullHealthState = {
      ...healingState,
      encounter: {
        ...healingState.encounter,
        participants: [participant('character-one', 'Aster'), participant('character-two', 'Briar')],
      },
      participants: [
        { ...healingState.participants[0], characterHealthAnchor: 6 },
        healingState.participants[1],
      ],
    };
    const fullHealth = harness({
      first: character('character-one', 'Aster', {
        inventory: [tonic],
        health: { current: 6, maximum: 6 },
      }),
      events: [stored('pvp.encounter.started', fullHealthState)],
    });
    await expect(fullHealth.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'use-item', itemId: 'small-tonic' },
    }, fullHealth.context)).rejects.toThrow('You are already at full health.');

    const absent = harness();
    await expect(absent.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'use-item', itemId: 'missing-tonic' },
    }, absent.context)).rejects.toThrow('cannot be used');
  });

  it('doubles incoming damage against resting players and emits a standing companion event', async () => {
    const restingPlayer = character('character-two', 'Briar', {
      staminaRecovery: {
        posture: 'resting',
        lastSettledAt: occurredAt,
        fractionalCarry: 0,
      },
    });
    const test = harness({ second: restingPlayer });
    const result = await test.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, test.context);

    expect(result.events[0].payload.encounter.participants[1].health).toBe(2);
    expect(result.companions).toHaveLength(1);
    expect(result.companions[0]).toMatchObject({
      streamId: 'character-two',
      events: [expect.objectContaining({ type: 'character.posture_changed' })],
    });
    expect(result.companions[0].events[0].payload.posture).toBe('standing');
  });

  it('applies both character outcomes and finalizes the shared encounter idempotently', async () => {
    const test = harness();
    const effect = test.effects.get('pvp.apply_outcome');
    expect(effect).toBeDefined();
    const finalEncounter = {
      ...encounter('resolving'),
      participants: [participant('character-one', 'Aster', 5), participant('character-two', 'Briar', 4)],
    };
    const outcome = {
      interactionStreamId: interactionStreamId(worldInstanceId),
      encounter: finalEncounter,
      consumedItemIdsByCharacter: { 'character-one': [], 'character-two': [] },
      healthDeltaByCharacter: { 'character-one': -1, 'character-two': -2 },
      respawnsByCharacter: {},
    };

    await effect!(outcome, test.context);
    expect(test.store.append).toHaveBeenCalledTimes(3);
    expect(test.streams.get('character-one')?.map((entry: any) => entry.type))
      .toContain('character.pvp_outcome_applied');
    expect(test.streams.get('character-two')?.map((entry: any) => entry.type))
      .toContain('character.pvp_outcome_applied');
    const completionAppend = test.store.append.mock.calls[2]?.[0];
    expect(completionAppend.events[0]).toMatchObject({
      type: 'pvp.outcome.applied',
      payload: { encounter: { status: 'completed', turnCharacterId: null } },
    });

    await effect!(outcome, test.context);
    expect(test.store.append).toHaveBeenCalledTimes(3);
  });

  it('skips a participant outcome already committed under its idempotency receipt', async () => {
    const test = harness();
    test.store.lookupCommand.mockImplementation(async (
      _world: string,
      _actor: string,
      commandId: string,
    ) => commandId === 'pvp-outcome:duel-one:character-one' ? { commandId } : undefined);
    await test.effects.get('pvp.apply_outcome')!({
      interactionStreamId: interactionStreamId(worldInstanceId),
      encounter: {
        ...encounter('resolving'),
        participants: [participant('character-one', 'Aster', 5), participant('character-two', 'Briar', 4)],
      },
      consumedItemIdsByCharacter: { 'character-one': [], 'character-two': [] },
      healthDeltaByCharacter: { 'character-one': -1, 'character-two': -2 },
      respawnsByCharacter: {},
    }, test.context);
    expect(test.store.append).toHaveBeenCalledTimes(2);
    expect(test.store.append.mock.calls[0]?.[0]).toMatchObject({
      streamId: 'character-two',
    });
  });

  it('rejects missing participant history and failed outcome appends', async () => {
    const test = harness();
    const effect = test.effects.get('pvp.apply_outcome')!;
    const outcome = {
      interactionStreamId: interactionStreamId(worldInstanceId),
      encounter: {
        ...encounter('resolving'),
        participants: [participant('character-one', 'Aster', 5), participant('character-two', 'Briar', 4)],
      },
      consumedItemIdsByCharacter: { 'character-one': [], 'character-two': [] },
      healthDeltaByCharacter: { 'character-one': -1, 'character-two': -2 },
      respawnsByCharacter: {},
    };

    test.streams.set('character-one', []);
    await expect(effect(outcome, test.context))
      .rejects.toThrow('PvP participant state changed before the outcome could be applied.');

    const failed = harness();
    const failedEffect = failed.effects.get('pvp.apply_outcome')!;
    failed.store.append.mockImplementationOnce(async () => ({ receipt: { ok: false }, events: [] }));
    await expect(failedEffect(outcome, failed.context))
      .rejects.toThrow('Could not append the PvP outcome to a character stream.');
  });

  it('rejects a changed encounter and skips already-receipted finalization', async () => {
    const outcome = {
      interactionStreamId: interactionStreamId(worldInstanceId),
      encounter: {
        ...encounter('resolving'),
        participants: [participant('character-one', 'Aster', 5), participant('character-two', 'Briar', 4)],
      },
      consumedItemIdsByCharacter: { 'character-one': [], 'character-two': [] },
      healthDeltaByCharacter: { 'character-one': -1, 'character-two': -2 },
      respawnsByCharacter: {},
    };
    const changed = harness();
    const originalRead = changed.store.readStream.getMockImplementation()!;
    changed.store.readStream.mockImplementation(async (world: string, streamId: string) =>
      streamId === interactionStreamId(world) ? [] : originalRead(world, streamId));
    await expect(changed.effects.get('pvp.apply_outcome')!(outcome, changed.context))
      .rejects.toThrow('The PvP encounter changed before outcome finalization.');

    const receipted = harness();
    receipted.store.lookupCommand.mockImplementation(async (
      _world: string,
      _actor: string,
      commandId: string,
    ) => commandId === 'pvp-outcome:duel-one:complete' ? { commandId } : undefined);
    await receipted.effects.get('pvp.apply_outcome')!(outcome, receipted.context);
    expect(receipted.store.append).toHaveBeenCalledTimes(2);
  });

  it('rejects a failed shared encounter finalization append', async () => {
    const test = harness();
    const append = test.store.append.getMockImplementation()!;
    test.store.append
      .mockImplementationOnce((input: any) => append(input))
      .mockImplementationOnce((input: any) => append(input))
      .mockImplementationOnce(async () => ({ receipt: { ok: false }, events: [] }));
    await expect(test.effects.get('pvp.apply_outcome')!({
      interactionStreamId: interactionStreamId(worldInstanceId),
      encounter: {
        ...encounter('resolving'),
        participants: [participant('character-one', 'Aster', 5), participant('character-two', 'Briar', 4)],
      },
      consumedItemIdsByCharacter: { 'character-one': [], 'character-two': [] },
      healthDeltaByCharacter: { 'character-one': -1, 'character-two': -2 },
      respawnsByCharacter: {},
    }, test.context)).rejects.toThrow('Could not finalize the PvP encounter.');
  });

  it('prepares and applies the respawn when a duel defeats a player', async () => {
    const lethalState = {
      encounter: {
        ...encounter(),
        participants: [participant('character-one', 'Aster'), participant('character-two', 'Briar', 1)],
      },
      participants: [
        {
          characterId: 'character-one',
          characterHealthAnchor: 6,
          attackDamage: 9,
          defenseReduction: 0,
          consumables: [],
          consumedItemIds: [],
        },
        {
          characterId: 'character-two',
          characterHealthAnchor: 6,
          attackDamage: 2,
          defenseReduction: 0,
          consumables: [],
          consumedItemIds: [],
        },
      ],
      guardingCharacterId: null,
    };
    const test = harness({
      events: [stored('pvp.encounter.started', lethalState)],
      world: {
        respawn: { locationId: 'market-square' },
        locations: [{ id: 'market-square' }],
      },
    });
    const result = await test.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'attack' },
    }, test.context);
    const outcomeEffect = result.effects[0];
    expect(outcomeEffect.payload.respawnsByCharacter['character-two']).toMatchObject({
      cause: 'pvp',
      encounterId: 'duel-one',
      deathLocationId: 'market-square',
      respawnLocationId: 'market-square',
      health: { current: 6, maximum: 6 },
    });
    outcomeEffect.payload.respawnsByCharacter['character-two'].droppedItem = {
      sourceItemId: 'knife-lost-in-duel',
      item: {
        id: 'knife-lost-in-duel',
        typeId: 'knife',
        label: 'Knife',
        description: 'A narrow knife.',
      },
    };

    await test.effects.get('pvp.apply_outcome')!(outcomeEffect.payload, test.context);
    expect(test.streams.get('character-two')?.map((entry: any) => entry.type))
      .toContain('character.respawned');
    expect(test.store.append.mock.calls.some(([input]: [any]) => input.effects?.length))
      .toBe(true);
  });

  it('resolves class abilities through the optional ruleset capability and records its event', async () => {
    const policy = {
      catalog: {},
      select: vi.fn(),
      resolve: vi.fn(() => ({
        damage: 4,
        event: {
          type: 'character.class_ability_used',
          version: 1,
          payload: { characterId: 'character-one', abilityId: 'arcane-bolt' },
        },
      })),
    };
    const test = harness({ classPolicy: policy });
    const result = await test.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'ability', abilityId: 'arcane-bolt' },
    }, test.context);

    expect(policy.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'character-one' }),
      'arcane-bolt',
      'duel-one',
      'command-pvp-action',
    );
    expect(result.events[0].payload.encounter.participants[1].health).toBe(2);
    expect(result.companions[0].events[0]).toMatchObject({
      type: 'character.class_ability_used',
      payload: { abilityId: 'arcane-bolt' },
    });

    const unavailable = harness();
    await expect(unavailable.commands.get('pvp.action')!({
      characterId: 'character-one',
      payload: { encounterId: 'duel-one', action: 'ability', abilityId: 'arcane-bolt' },
    }, unavailable.context)).rejects.toThrow('ABILITY_UNAVAILABLE');
  });
});
