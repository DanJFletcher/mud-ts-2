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
  });

  it('starts a duel on acceptance and adds character revision guards', async () => {
    const test = harness({ events: [] });
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
      }),
    })]);
  });

  it('records attack and defend actions while enforcing turn and encounter ownership', async () => {
    const test = harness();
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

    await test.effects.get('pvp.apply_outcome')!(outcomeEffect.payload, test.context);
    expect(test.streams.get('character-two')?.map((entry: any) => entry.type))
      .toContain('character.respawned');
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
