import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  WORLD_CORPSE_CREATE_EFFECT,
  WORLD_ITEM_CLAIM_EFFECT,
  WORLD_ITEM_DROP_EFFECT,
  createWorldCorpseEffect,
  createWorldItemDrop,
  projectWorldItems,
  worldCorpseGoldCreditEffect,
  worldItemClaimEffect,
  worldItemDropEffect,
  worldItemsPlugin,
  worldItemsStreamId,
  type WorldItemsStateCapability,
} from './world-items.js';

const replayCharacterMock = vi.hoisted(() => vi.fn());
vi.mock('@mudd/engine-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mudd/engine-core')>();
  return { ...actual, replayCharacter: replayCharacterMock };
});

function captureWorldItemsCapability() {
  let capability: WorldItemsStateCapability | undefined;
  worldItemsPlugin.register({
    provideCapability: (_token: unknown, implementation: unknown) => {
      capability = implementation as WorldItemsStateCapability;
    },
    registerEffect: () => undefined,
  } as never);
  if (!capability) throw new Error('World items capability was not registered.');
  return capability;
}

function captureWorldItemEffects() {
  const effects = new Map<string, (payload: unknown, context: any) => Promise<void>>();
  worldItemsPlugin.register({
    provideCapability: () => undefined,
    registerEffect: (type: string, _version: number, _schema: unknown, handler: unknown) => {
      effects.set(type, handler as (payload: unknown, context: any) => Promise<void>);
    },
  } as never);
  return effects;
}

const worldId = 'world-items-unit-test';
const createdAt = '2026-10-27T10:00:00.000Z';

function event(type: string, payload: Record<string, unknown>, revision: number): StoredGameEvent {
  return {
    eventId: `event-${revision}`,
    worldInstanceId: worldId,
    streamId: worldItemsStreamId(worldId),
    aggregateId: worldItemsStreamId(worldId),
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `command-${revision}`,
    actorId: 'system',
    occurredAt: createdAt,
    tick: revision,
  } as unknown as StoredGameEvent;
}

function corpseEffect(options: {
  id?: string;
  corpseType?: 'npc' | 'player';
  loot?: { items?: Array<Record<string, unknown>>; currencyAmount?: number };
  override?: { category?: 'ordinary' | 'boss'; lifetimeSeconds?: number; expirationPolicy?: 'destroy' | 'drop' };
  preservedItems?: Array<Record<string, unknown>>;
} = {}) {
  return createWorldCorpseEffect(() => options.id ?? 'corpse-1', {
    encounterId: 'encounter-1',
    opponentId: 'bandit-1',
    opponentName: 'Bandit',
    locationId: 'southbound-track',
    createdAt,
    loot: options.loot as never,
    corpseType: options.corpseType,
    ownerCharacterId: options.corpseType === 'player' ? 'character-1' : undefined,
    lifecycleOverride: options.override as never,
    currencyId: 'gold',
    currencyName: 'gold',
    preservedItems: options.preservedItems as never,
  });
}

describe('world item projection cache', () => {
  it('reuses only an authoritative revision and returns independent projection copies', async () => {
    let iterations = 0;
    const emptyHistory = new Proxy([] as StoredGameEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) iterations += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    let history: readonly StoredGameEvent[] = emptyHistory;
    const readStream = vi.fn(async () => history);
    const capability = captureWorldItemsCapability();
    const context = {
      worldInstanceId: 'world-items-cache-test',
      store: { readStream },
    } as never;

    const first = await capability.load(context);
    (first.items as unknown[]).push({ not: 'shared with the cache' });
    const sameRevision = await capability.load(context);

    expect(readStream).toHaveBeenCalledTimes(2);
    expect(iterations).toBe(1);
    expect(sameRevision.items).toEqual([]);
    expect(sameRevision.items).not.toBe(first.items);

    history = [{
      type: 'world.item.invalid',
      version: 1,
      payload: {},
      eventId: 'event-1',
      worldInstanceId: 'world-items-cache-test',
      streamId: 'world-items',
      aggregateId: 'world-items',
      aggregateVersion: 1,
      causationCommandId: 'command-1',
      actorId: 'actor-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      tick: 1,
    }];
    await expect(capability.load(context)).rejects.toThrow('Unsupported world item event');
  });

  it('evicts the least recently used world projection when the cache reaches its limit', async () => {
    const iterations = new Map<string, number>();
    const readStream = vi.fn(async (instanceId: string) => new Proxy([] as StoredGameEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          iterations.set(instanceId, (iterations.get(instanceId) ?? 0) + 1);
        }
        return Reflect.get(target, property, receiver);
      },
    }));
    const capability = captureWorldItemsCapability();
    for (let index = 0; index < 17; index += 1) {
      await capability.load({
        worldInstanceId: `world-cache-${index}`,
        store: { readStream },
      } as never);
    }
    expect(iterations.get('world-cache-0')).toBe(1);

    await capability.load({
      worldInstanceId: 'world-cache-0',
      store: { readStream },
    } as never);
    expect(iterations.get('world-cache-0')).toBe(2);
  });
});

describe('world item event projection', () => {
  const item = {
    id: 'pine-logs-1',
    sharedItemId: 'pine-logs-1',
    label: 'Pine logs',
    description: 'A bundle of pine logs.',
  };

  it('marks only the effects that finish a take or drop as completing their command', () => {
    const options = new Map<string, unknown>();
    worldItemsPlugin.register({
      provideCapability: () => undefined,
      registerEffect: (type: string, _version: number, _schema: unknown, _handler: unknown, effectOptions?: unknown) => {
        options.set(type, effectOptions);
      },
    } as never);
    expect(Object.fromEntries(options)).toEqual({
      [WORLD_ITEM_DROP_EFFECT]: { completesCommand: true },
      [WORLD_ITEM_CLAIM_EFFECT]: { completesCommand: true },
      [WORLD_CORPSE_CREATE_EFFECT]: undefined,
      'world-corpse.gold-credit': { completesCommand: true },
    });
  });

  it('creates stable effects for shared item drops, claims, and corpse gold credits', () => {
    expect(worldItemDropEffect({
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    })).toMatchObject({ type: WORLD_ITEM_DROP_EFFECT, version: 1 });
    expect(worldItemClaimEffect({
      worldItemId: item.id,
      characterId: 'character-2',
      sourceLocationId: 'market',
      item,
    })).toMatchObject({ type: WORLD_ITEM_CLAIM_EFFECT, version: 1 });
    expect(worldCorpseGoldCreditEffect({
      characterId: 'character-2',
      corpseId: 'corpse-1',
      currencyId: 'gold',
      amount: 4,
    })).toMatchObject({ type: 'world-corpse.gold-credit', version: 1 });
  });

  it('sets corpse lifetime by contents, category, override, and owner type', () => {
    expect((corpseEffect().payload as any).corpse.expiresAt).toBe('2026-10-27T10:01:00.000Z');
    expect((corpseEffect({ loot: { items: [{ label: 'Knife', description: 'A knife.' }] } }).payload as any)
      .corpse.expiresAt).toBe('2026-10-27T10:05:00.000Z');
    expect((corpseEffect({
      loot: { items: [{ label: 'Trophy', description: 'A token.' }] },
      override: { category: 'boss' },
    }).payload as any).corpse.expiresAt)
      .toBe('2026-10-27T10:15:00.000Z');
    expect((corpseEffect({
      loot: { items: [{ label: 'Knife', description: 'A narrow knife.' }] },
      override: { lifetimeSeconds: 45, expirationPolicy: 'drop' },
    }).payload as any)
      .corpse.expiresAt).toBe('2026-10-27T10:00:45.000Z');
    expect((corpseEffect({
      corpseType: 'player',
      loot: { items: [{ label: 'Pack', description: 'A worn pack.' }] },
    }).payload as any).corpse)
      .toMatchObject({ expiresAt: '2026-10-27T10:30:00.000Z', expirationPolicy: 'recovery-storage' });
  });

  it('preserves loot metadata and rejects currency loot without a currency definition', () => {
    const loot = corpseEffect({
      id: 'loot-corpse',
      loot: {
        items: [{
          typeId: 'bandit-knife',
          label: 'Bandit knife',
          description: 'A narrow knife.',
          equipment: { slot: 'weapon', attackBonus: 1 },
        }],
        currencyAmount: 7,
      },
    });
    expect(loot).toMatchObject({
      type: WORLD_CORPSE_CREATE_EFFECT,
      payload: {
        corpse: { corpseId: 'corpse:loot-corpse', currencyId: 'gold', currencyAmount: 7 },
        items: [{
          worldItemId: 'corpse-item:loot-corpse',
          item: { typeId: 'bandit-knife', label: 'Bandit knife', sharedItemId: 'corpse-item:loot-corpse' },
        }],
      },
    });
    const preserved = corpseEffect({
      id: 'preserved',
      preservedItems: [{
        id: 'old-rod',
        sharedItemId: 'old-rod',
        label: 'Old rod',
        description: 'A worn fishing rod.',
      }],
    });
    expect(preserved.payload).toMatchObject({
      items: [{ worldItemId: 'old-rod', item: { id: 'old-rod', label: 'Old rod' } }],
    });
    expect(() => createWorldCorpseEffect(() => 'corpse', {
      encounterId: 'encounter',
      opponentId: 'bandit',
      opponentName: 'Bandit',
      locationId: 'road',
      loot: { currencyAmount: 2 } as never,
    })).toThrow('Combatant currency loot requires the world currency definition.');
  });

  it('projects an item through drop, claim, and consumption transitions', () => {
    const drop = event('world.item_dropped', {
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, 1);
    const claim = event('world.item_claimed', {
      worldItemId: item.id,
      characterId: 'character-2',
      locationId: 'market',
    }, 2);
    const consumed = event('world.items_consumed', {
      characterId: 'character-2',
      worldItemIds: [item.id],
    }, 3);
    expect(projectWorldItems([drop])).toMatchObject({
      revision: 1,
      items: [{ worldItemId: item.id, locationId: 'market', holderCharacterId: null }],
    });
    expect(projectWorldItems([drop, claim])).toMatchObject({
      items: [{ worldItemId: item.id, locationId: null, holderCharacterId: 'character-2' }],
    });
    expect(projectWorldItems([drop, claim, consumed])).toMatchObject({
      revision: 3,
      items: [],
      corpses: [],
      currencyDrops: [],
    });
  });

  it('drops remaining corpse items and unclaimed gold when its expiry policy is drop', () => {
    const created = corpseEffect({
      id: 'bandit',
      loot: { items: [{ label: 'Bandit knife', description: 'A narrow knife.' }], currencyAmount: 7 },
      override: { expirationPolicy: 'drop' },
    });
    const corpse = (created.payload as any).corpse;
    const expired = event('world.corpse_expired', {
      corpseId: corpse.corpseId,
      corpseName: corpse.opponentName,
      locationId: corpse.locationId,
      policy: 'drop',
      expiredAt: '2026-10-27T10:05:00.000Z',
    }, 2);
    expect(projectWorldItems([
      event('world.corpse_created', created.payload as Record<string, unknown>, 1),
      expired,
    ])).toMatchObject({
      corpses: [],
      items: [{
        worldItemId: 'corpse-item:bandit',
        locationId: 'southbound-track',
        holderCharacterId: null,
      }],
      currencyDrops: [{ dropId: corpse.goldItemId, corpseId: corpse.corpseId, amount: 7 }],
    });
  });

  it('destroys corpse contents and records them as consumed when the expiry policy is destroy', () => {
    const created = corpseEffect({
      id: 'destroyed-corpse',
      loot: { items: [{ label: 'Knife', description: 'A narrow knife.' }] },
      override: { expirationPolicy: 'destroy' },
    });
    const corpse = (created.payload as any).corpse;
    const state = projectWorldItems([
      event('world.item_dropped', {
        worldItemId: 'loose-item',
        fromCharacterId: 'character-1',
        locationId: 'southbound-track',
        item: {
          id: 'loose-item',
          sharedItemId: 'loose-item',
          label: 'Loose item',
          description: 'Not inside the corpse.',
        },
      }, 1),
      event('world.corpse_created', created.payload as Record<string, unknown>, 2),
      event('world.corpse_expired', {
        corpseId: corpse.corpseId,
        corpseName: corpse.opponentName,
        locationId: corpse.locationId,
        policy: 'destroy',
        expiredAt: '2026-10-27T10:05:00.000Z',
      }, 3),
    ]);
    expect(state).toMatchObject({
      corpses: [],
      items: [{ worldItemId: 'loose-item', locationId: 'southbound-track' }],
      currencyDrops: [],
    });
  });

  it('rejects invalid ownership transitions, duplicate corpses, and quest-bound corpse loot', () => {
    const dropped = event('world.item_dropped', {
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, 1);
    const claimed = event('world.item_claimed', {
      worldItemId: item.id,
      characterId: 'character-2',
      locationId: 'market',
    }, 2);
    const invalidDrop = event('world.item_dropped', {
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'road',
      item,
    }, 3);
    expect(() => projectWorldItems([dropped, claimed, invalidDrop]))
      .toThrow('Invalid shared item ownership transition at revision 3.');

    const created = corpseEffect({ id: 'duplicate-corpse' });
    expect(() => projectWorldItems([
      event('world.corpse_created', created.payload as Record<string, unknown>, 1),
      event('world.corpse_created', created.payload as Record<string, unknown>, 2),
    ])).toThrow('Duplicate corpse creation at revision 2.');

    const questBoundLoot = corpseEffect({
      id: 'quest-bound-loot',
      preservedItems: [{
        id: 'quest-item',
        sharedItemId: 'quest-item',
        label: 'Quest item',
        description: 'A bound object.',
        questBound: true,
      }],
    });
    expect(() => projectWorldItems([
      event('world.corpse_created', questBoundLoot.payload as Record<string, unknown>, 1),
    ])).toThrow('Invalid corpse loot item at revision 1.');
  });

  it('rejects mismatched corpse and loose-currency claims', () => {
    const created = corpseEffect({
      id: 'gold-corpse',
      loot: { currencyAmount: 7 },
    });
    const corpse = (created.payload as any).corpse;
    const badCorpseClaim = event('world.corpse_gold_claimed', {
      corpseId: corpse.corpseId,
      characterId: 'character-1',
      locationId: corpse.locationId,
      currencyId: 'gold',
      amount: 6,
    }, 2);
    expect(() => projectWorldItems([
      event('world.corpse_created', created.payload as Record<string, unknown>, 1),
      badCorpseClaim,
    ])).toThrow('Invalid corpse gold claim at revision 2.');

    const expired = event('world.corpse_expired', {
      corpseId: corpse.corpseId,
      corpseName: corpse.opponentName,
      locationId: corpse.locationId,
      policy: 'drop',
      expiredAt: '2026-10-27T10:05:00.000Z',
    }, 2);
    const badLooseClaim = event('world.corpse_gold_claimed', {
      corpseId: corpse.corpseId,
      characterId: 'character-1',
      locationId: corpse.locationId,
      currencyId: 'gold',
      amount: 6,
    }, 3);
    expect(() => projectWorldItems([
      event('world.corpse_created', created.payload as Record<string, unknown>, 1),
      expired,
      badLooseClaim,
    ])).toThrow('Invalid loose currency claim at revision 3.');
  });

  it('marks corpse gold claimed and removes a claimed loose currency drop', () => {
    const created = corpseEffect({
      id: 'claimed-gold-corpse',
      loot: { currencyAmount: 7 },
    });
    const corpse = (created.payload as any).corpse;
    const corpseClaimed = projectWorldItems([
      event('world.corpse_created', created.payload as Record<string, unknown>, 1),
      event('world.corpse_gold_claimed', {
        corpseId: corpse.corpseId,
        characterId: 'character-1',
        locationId: corpse.locationId,
        currencyId: 'gold',
        amount: 7,
      }, 2),
    ]);
    expect(corpseClaimed.corpses).toMatchObject([{ corpseId: corpse.corpseId, goldClaimed: true }]);
    expect(corpseClaimed.currencyDrops).toEqual([]);

    const looseGoldClaimed = projectWorldItems([
      event('world.corpse_created', created.payload as Record<string, unknown>, 1),
      event('world.corpse_expired', {
        corpseId: corpse.corpseId,
        corpseName: corpse.opponentName,
        locationId: corpse.locationId,
        policy: 'drop',
        expiredAt: '2026-10-27T10:05:00.000Z',
      }, 2),
      event('world.corpse_gold_claimed', {
        corpseId: corpse.corpseId,
        characterId: 'character-1',
        locationId: corpse.locationId,
        currencyId: 'gold',
        amount: 7,
      }, 3),
    ]);
    expect(looseGoldClaimed.corpses).toEqual([]);
    expect(looseGoldClaimed.currencyDrops).toEqual([]);
  });

  it('rejects out-of-order, unsupported, unowned, and quest-bound shared-item events', () => {
    expect(() => projectWorldItems([event('world.item_dropped', {}, 2)]))
      .toThrow('Non-contiguous world item revision at 2.');
    expect(() => projectWorldItems([event('world.unrecognized', {}, 1)]))
      .toThrow('Unsupported world item event "world.unrecognized" at revision 1.');
    expect(() => projectWorldItems([event('world.items_consumed', {
      characterId: 'character-1',
      worldItemIds: ['missing'],
    }, 1)])).toThrow('Invalid shared item consumption.');
    expect(() => projectWorldItems([event('world.item_dropped', {
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item: { ...item, questBound: true },
    }, 1)])).toThrow('Invalid shared item drop at revision 1.');
    expect(() => projectWorldItems([event('world.item_claimed', {
      worldItemId: 'missing',
      characterId: 'character-1',
      locationId: 'market',
    }, 1)])).toThrow('Invalid shared item claim at revision 1.');
    expect(() => projectWorldItems([event('world.corpse_expired', {
      corpseId: 'missing',
      corpseName: 'Nobody',
      locationId: 'market',
      policy: 'destroy',
      expiredAt: createdAt,
    }, 1)])).toThrow('Invalid corpse expiration at revision 1.');
  });
});

describe('world item effect persistence', () => {
  const item = {
    id: 'shared-logs',
    sharedItemId: 'shared-logs',
    label: 'Pine logs',
    description: 'A bundle of pine logs.',
  };

  function store(history: readonly StoredGameEvent[] = [], receiptOk = true) {
    return {
      lookupCommand: vi.fn(async () => undefined),
      readStream: vi.fn(async () => history),
      append: vi.fn(async (_request: unknown) => ({ receipt: { ok: receiptOk } })),
    };
  }

  it('appends a shared drop once with a system actor and the current stream revision', async () => {
    const effects = captureWorldItemEffects();
    const eventStore = store();
    await effects.get(WORLD_ITEM_DROP_EFFECT)!({
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, { store: eventStore, worldInstanceId: worldId, effectId: 'effect-1' });
    expect(eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      streamId: 'world-items',
      expectedVersion: 0,
      events: [{
        type: 'world.item_dropped',
        version: 1,
        payload: {
          worldItemId: item.id,
          fromCharacterId: 'character-1',
          locationId: 'market',
          item,
        },
      }],
    }));

    eventStore.lookupCommand.mockResolvedValue({} as never);
    eventStore.append.mockClear();
    await effects.get(WORLD_ITEM_DROP_EFFECT)!({
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, { store: eventStore, worldInstanceId: worldId, effectId: 'effect-1' });
    expect(eventStore.append).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing room drop and rejects stale ownership', async () => {
    const effects = captureWorldItemEffects();
    const drop = event('world.item_dropped', {
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, 1);
    const eventStore = store([drop]);
    await effects.get(WORLD_ITEM_DROP_EFFECT)!({
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, { store: eventStore, worldInstanceId: worldId, effectId: 'same-drop' });
    expect(eventStore.append).not.toHaveBeenCalled();

    const claimed = event('world.item_claimed', {
      worldItemId: item.id,
      characterId: 'character-1',
      locationId: 'market',
    }, 2);
    const staleStore = store([drop, claimed]);
    await expect(effects.get(WORLD_ITEM_DROP_EFFECT)!({
      worldItemId: item.id,
      fromCharacterId: 'character-2',
      locationId: 'market',
      item,
    }, { store: staleStore, worldInstanceId: worldId, effectId: 'stale-drop' }))
      .rejects.toThrow('The shared item is no longer held by the character dropping it.');
  });

  it('creates corpses with room announcements and lifecycle companion events', async () => {
    const effects = captureWorldItemEffects();
    const eventStore = store();
    const created = corpseEffect({
      id: 'effect-corpse',
      loot: { items: [{ label: 'Knife', description: 'A narrow knife.' }] },
    });
    await effects.get(WORLD_CORPSE_CREATE_EFFECT)!(created.payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'corpse-create-1',
    });
    const request = eventStore.append.mock.calls[0]?.[0] as any;
    expect(request).toMatchObject({
      streamId: 'world-items',
      events: [{ type: 'world.corpse_created', payload: created.payload }],
      effects: [{
        type: 'mudd.world.room_announcement',
        payload: { locationId: 'southbound-track', message: 'Bandit falls, and their body lies here.' },
      }],
      companions: [{
        streamId: 'world-object-lifecycle:corpse:effect-corpse',
        expectedVersion: 0,
        events: [{ type: 'world.object_lifecycle_scheduled' }],
      }],
    });
  });

  it('treats matching corpse creation as idempotent and rejects conflicting IDs', async () => {
    const effects = captureWorldItemEffects();
    const created = corpseEffect({ id: 'existing-corpse' });
    const stored = event('world.corpse_created', created.payload as Record<string, unknown>, 1);
    const eventStore = store([stored]);
    await effects.get(WORLD_CORPSE_CREATE_EFFECT)!(created.payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'retry-create',
    });
    expect(eventStore.append).not.toHaveBeenCalled();

    const changed = corpseEffect({ id: 'existing-corpse' });
    (changed.payload as any).corpse.opponentName = 'Different Bandit';
    await expect(effects.get(WORLD_CORPSE_CREATE_EFFECT)!(changed.payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'conflicting-create',
    })).rejects.toThrow('The corpse ID already exists with different contents.');
  });

  it('reports failed event-store receipts instead of silently accepting effects', async () => {
    const effects = captureWorldItemEffects();
    const eventStore = store([], false);
    await expect(effects.get(WORLD_ITEM_DROP_EFFECT)!({
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, { store: eventStore, worldInstanceId: worldId, effectId: 'failed-drop' }))
      .rejects.toThrow('Could not commit the shared item drop.');
    await expect(effects.get(WORLD_CORPSE_CREATE_EFFECT)!(corpseEffect().payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'failed-corpse',
    })).rejects.toThrow('Could not commit the shared corpse.');
  });

  it('honors stored effect receipts before reading or appending any shared transfer', async () => {
    const effects = captureWorldItemEffects();
    const eventStore = store();
    eventStore.lookupCommand.mockResolvedValue({} as never);
    const context = {
      store: eventStore,
      worldInstanceId: worldId,
    };

    await effects.get(WORLD_ITEM_DROP_EFFECT)!({
      worldItemId: item.id,
      fromCharacterId: 'character-1',
      locationId: 'market',
      item,
    }, { ...context, effectId: 'receipt-drop' });
    await effects.get(WORLD_CORPSE_CREATE_EFFECT)!(corpseEffect().payload, {
      ...context,
      effectId: 'receipt-corpse',
    });
    await effects.get(WORLD_ITEM_CLAIM_EFFECT)!({
      worldItemId: item.id,
      characterId: 'character-1',
      sourceLocationId: 'market',
      item,
    }, { ...context, effectId: 'receipt-claim' });
    await effects.get('world-corpse.gold-credit')!({
      characterId: 'character-1',
      corpseId: 'corpse-1',
      currencyId: 'gold',
      amount: 3,
    }, { ...context, effectId: 'receipt-gold' });

    expect(eventStore.lookupCommand).toHaveBeenCalledTimes(4);
    expect(eventStore.readStream).not.toHaveBeenCalled();
    expect(eventStore.append).not.toHaveBeenCalled();
  });

  it('writes a claimant receipt once and rejects absent or conflicting character items', async () => {
    const effects = captureWorldItemEffects();
    const payload = {
      worldItemId: item.id,
      characterId: 'character-1',
      sourceLocationId: 'market',
      item,
    };
    const eventStore = store();
    replayCharacterMock.mockReturnValue(undefined);
    await expect(effects.get(WORLD_ITEM_CLAIM_EFFECT)!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'missing-character',
    })).rejects.toThrow('The shared item claimant has no character stream.');

    replayCharacterMock.mockReturnValue({
      inventory: [{ ...item }],
    });
    await effects.get(WORLD_ITEM_CLAIM_EFFECT)!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'already-carried',
    });
    expect(eventStore.append).not.toHaveBeenCalled();

    replayCharacterMock.mockReturnValue({
      inventory: [{ ...item, sharedItemId: 'other-shared-id' }],
    });
    await expect(effects.get(WORLD_ITEM_CLAIM_EFFECT)!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'conflicting-item',
    })).rejects.toThrow('A different item already uses the shared item ID.');

    replayCharacterMock.mockReturnValue({ inventory: [] });
    await effects.get(WORLD_ITEM_CLAIM_EFFECT)!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'successful-claim',
    });
    expect(eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      streamId: 'character-1',
      expectedVersion: 0,
      events: [{
        type: 'character.shared_item_received',
        version: 1,
        payload: {
          characterId: 'character-1',
          worldItemId: item.id,
          sourceLocationId: 'market',
          item,
        },
      }],
    }));
  });

  it('credits corpse gold only to a compatible wallet and respects idempotency', async () => {
    const effects = captureWorldItemEffects();
    const payload = {
      characterId: 'character-1',
      corpseId: 'corpse-1',
      currencyId: 'gold',
      amount: 7,
    };
    const eventStore = store();
    replayCharacterMock.mockReturnValue(undefined);
    await expect(effects.get('world-corpse.gold-credit')!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'missing-recipient',
    })).rejects.toThrow('The corpse gold recipient has no character stream.');

    replayCharacterMock.mockReturnValue({
      claimedCorpseGoldIds: ['corpse-1'],
      wallet: { currencyId: 'gold', balance: 2 },
    });
    await effects.get('world-corpse.gold-credit')!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'already-credited',
    });
    expect(eventStore.append).not.toHaveBeenCalled();

    replayCharacterMock.mockReturnValue({
      claimedCorpseGoldIds: [],
      wallet: { currencyId: 'silver', balance: 2 },
    });
    await expect(effects.get('world-corpse.gold-credit')!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'wrong-wallet',
    })).rejects.toThrow('The corpse gold recipient cannot receive this currency amount.');

    replayCharacterMock.mockReturnValue({
      claimedCorpseGoldIds: [],
      wallet: { currencyId: 'gold', balance: 2_147_483_647 },
    });
    await expect(effects.get('world-corpse.gold-credit')!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'full-wallet',
    })).rejects.toThrow('The corpse gold recipient cannot receive this currency amount.');

    replayCharacterMock.mockReturnValue({
      claimedCorpseGoldIds: [],
      wallet: { currencyId: 'gold', balance: 2 },
    });
    await effects.get('world-corpse.gold-credit')!(payload, {
      store: eventStore,
      worldInstanceId: worldId,
      effectId: 'valid-credit',
    });
    expect(eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      streamId: 'character-1',
      events: [{
        type: 'character.corpse_gold_received',
        version: 1,
        payload: {
          characterId: 'character-1',
          corpseId: 'corpse-1',
          currencyId: 'gold',
          amount: 7,
        },
      }],
    }));
  });

  it('creates a shared drop identity and surfaces failed claimant and gold receipts', async () => {
    expect(createWorldItemDrop('new-id', 'character-1', 'market', item)).toMatchObject({
      item: { id: 'new-id', sharedItemId: 'new-id' },
      effect: { type: WORLD_ITEM_DROP_EFFECT },
    });
    const effects = captureWorldItemEffects();
    const failedStore = store([], false);
    replayCharacterMock.mockReturnValue({ inventory: [] });
    await expect(effects.get(WORLD_ITEM_CLAIM_EFFECT)!({
      worldItemId: item.id,
      characterId: 'character-1',
      sourceLocationId: 'market',
      item,
    }, { store: failedStore, worldInstanceId: worldId, effectId: 'failed-claim' }))
      .rejects.toThrow('Could not add the claimed item to its character.');
    replayCharacterMock.mockReturnValue({
      claimedCorpseGoldIds: [],
      wallet: { currencyId: 'gold', balance: 0 },
    });
    await expect(effects.get('world-corpse.gold-credit')!({
      characterId: 'character-1',
      corpseId: 'corpse-1',
      currencyId: 'gold',
      amount: 2,
    }, { store: failedStore, worldInstanceId: worldId, effectId: 'failed-credit' }))
      .rejects.toThrow('Could not add the corpse gold to the character wallet.');
  });
});
