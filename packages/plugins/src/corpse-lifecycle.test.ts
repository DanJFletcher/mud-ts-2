import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import { createWorldCorpseEffect, projectWorldItems, worldItemsStreamId } from './world-items.js';
import {
  corpseLifecyclePlugin,
} from './corpse-lifecycle.js';
import {
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
  projectObjectLifecycle,
} from './object-lifecycle.js';

const worldId = 'corpse-lifecycle-world';
const corpseId = 'corpse:test-corpse';
const at = '2026-10-27T10:00:00.000Z';
const expiresAt = '2026-10-27T10:05:00.000Z';

function storedEvent(
  streamId: string,
  type: string,
  payload: Record<string, unknown>,
  revision: number,
): StoredGameEvent {
  return {
    eventId: `${streamId}:${revision}`,
    worldInstanceId: worldId,
    streamId,
    aggregateId: streamId,
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `command-${revision}`,
    actorId: 'system',
    occurredAt: at,
    tick: revision,
  } as unknown as StoredGameEvent;
}

function captureHandler() {
  let handler: ((payload: unknown, context: any) => Promise<void>) | undefined;
  corpseLifecyclePlugin.register({
    registerEventHandler: (_type: string, _version: number, _schema: unknown, registered: unknown) => {
      handler = registered as (payload: unknown, context: any) => Promise<void>;
    },
  } as never);
  if (!handler) throw new Error('Corpse-expiring handler was not registered.');
  return handler;
}

function corpseEffect(options: {
  policy?: 'destroy' | 'drop' | 'recovery-storage';
  corpseType?: 'npc' | 'player';
  ownerCharacterId?: string;
  contents?: boolean;
} = {}) {
  const corpseType = options.corpseType ?? 'npc';
  const ownerCharacterId = options.ownerCharacterId ?? (corpseType === 'player' ? 'owner-1' : undefined);
  return createWorldCorpseEffect(() => 'loot-item', {
    encounterId: 'encounter-1',
    opponentId: 'opponent-1',
    opponentName: 'Bandit',
    locationId: 'southbound-track',
    corpseType,
    ...(ownerCharacterId ? { ownerCharacterId } : {}),
    createdAt: at,
    lifecycleOverride: options.policy
      ? { category: 'ordinary', expirationPolicy: options.policy }
      : undefined,
    preservedItems: options.contents ? [{
      id: 'knife-1',
      sharedItemId: 'knife-1',
      label: 'Bandit knife',
      description: 'A narrow knife.',
    }] : undefined,
    loot: options.contents ? { items: [], currencyAmount: 5 } : undefined,
    currencyId: options.contents ? 'gold' : undefined,
    currencyName: options.contents ? 'gold' : undefined,
  });
}

function lifecycleHistory(
  objectId: string,
  state: 'scheduled' | 'expiring' = 'expiring',
  objectExpiresAt = expiresAt,
) {
  const streamId = objectLifecycleStreamId(objectId);
  const scheduled = objectLifecycleScheduledEvent({
    objectId,
    objectType: 'corpse',
    locationId: 'southbound-track',
    createdAt: at,
    expiresAt: objectExpiresAt,
  });
  const history = [storedEvent(streamId, scheduled.type, scheduled.payload, 1)];
  if (state === 'expiring') {
    history.push(storedEvent(streamId, 'world.object_expiring', {
      objectId,
      objectType: 'corpse',
      locationId: 'southbound-track',
      expiresAt: objectExpiresAt,
    }, 2));
  }
  return history;
}

function corpseHistory(effect: ReturnType<typeof corpseEffect>) {
  return [storedEvent(
    worldItemsStreamId(worldId),
    'world.corpse_created',
    effect.payload as unknown as Record<string, unknown>,
    1,
  )];
}

function context(histories: Map<string, readonly StoredGameEvent[]>, append = vi.fn(async (_request: unknown) => ({
  receipt: { ok: true },
}))) {
  return {
    effectId: 'expiry-effect-1',
    worldInstanceId: worldId,
    sourceStreamId: null,
    causationCommandId: 'cause-1',
    store: {
      readStream: vi.fn(async (_world: string, streamId: string) => histories.get(streamId) ?? []),
      append,
    },
    world: {
      corpseLifecycle: {
        playerExpirationPolicy: 'recovery-storage',
        npcExpirationPolicy: 'destroy',
      },
    },
    now: () => new Date('2026-10-27T10:06:00.000Z'),
    makeId: () => 'generated-id',
    rng: {},
  } as any;
}

describe('corpse lifecycle expiration effect', () => {
  const handle = captureHandler();

  it('ignores other object types, unscheduled corpses, and stale or not-yet-expiring lifecycle records', async () => {
    const append = vi.fn();
    const ctx = context(new Map(), append as never);

    await handle({ objectId: corpseId, objectType: 'cache', locationId: 'southbound-track', expiresAt }, ctx);
    await handle({ objectId: corpseId, objectType: 'corpse', locationId: 'southbound-track', expiresAt }, ctx);
    expect(append).not.toHaveBeenCalled();

    const scheduledOnly = new Map([[objectLifecycleStreamId(corpseId), lifecycleHistory(corpseId, 'scheduled')]]);
    await handle({ objectId: corpseId, objectType: 'corpse', locationId: 'southbound-track', expiresAt }, context(scheduledOnly));
    expect(append).not.toHaveBeenCalled();

    const mismatchedExpiry = new Map([[objectLifecycleStreamId(corpseId), lifecycleHistory(corpseId)]]);
    await handle({
      objectId: corpseId,
      objectType: 'corpse',
      locationId: 'southbound-track',
      expiresAt: '2026-10-27T10:04:00.000Z',
    }, context(mismatchedExpiry));
    expect(append).not.toHaveBeenCalled();
  });

  it('finalizes lifecycle when the scheduled corpse is already missing', async () => {
    const append = vi.fn(async (_request: unknown) => ({ receipt: { ok: true } }));
    const histories = new Map([[objectLifecycleStreamId(corpseId), lifecycleHistory(corpseId)]]);

    await handle({ objectId: corpseId, objectType: 'corpse', locationId: 'southbound-track', expiresAt }, context(histories, append));

    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      streamId: objectLifecycleStreamId(corpseId),
      commandId: 'object-expired-missing:expiry-effect-1',
      events: [expect.objectContaining({
        type: 'world.object_expired',
        payload: expect.objectContaining({ objectId: corpseId, expiredAt: '2026-10-27T10:06:00.000Z' }),
      })],
    }));
  });

  it('expires an NPC corpse by policy and announces its disappearance', async () => {
    const effect = corpseEffect({ policy: 'drop' });
    const corpse = (effect.payload as any).corpse;
    const histories = new Map([
      [objectLifecycleStreamId(corpse.corpseId), lifecycleHistory(corpse.corpseId, 'expiring', corpse.expiresAt)],
      [worldItemsStreamId(worldId), corpseHistory(effect)],
    ]);
    expect(projectObjectLifecycle(histories.get(objectLifecycleStreamId(corpse.corpseId))!))
      .toMatchObject({ state: 'expiring', expiresAt: corpse.expiresAt });
    expect(projectWorldItems(histories.get(worldItemsStreamId(worldId))!).corpses)
      .toHaveLength(1);
    const append = vi.fn(async (_request: unknown) => ({ receipt: { ok: true } }));

    await handle({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: corpse.locationId,
      expiresAt: corpse.expiresAt,
    }, context(histories, append));

    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      streamId: worldItemsStreamId(worldId),
      commandId: 'corpse-expire:expiry-effect-1',
      events: [expect.objectContaining({
        type: 'world.corpse_expired',
        payload: expect.objectContaining({ policy: 'drop', corpseId: corpse.corpseId }),
      })],
      companions: [expect.objectContaining({
        streamId: objectLifecycleStreamId(corpse.corpseId),
        events: [expect.objectContaining({ type: 'world.object_expired' })],
      })],
      effects: [expect.objectContaining({
        type: 'mudd.world.room_announcement',
        payload: { locationId: 'southbound-track', message: expect.stringContaining('leaving their belongings behind') },
      })],
    }));
  });

  it('returns recovered items and unclaimed currency to a player corpse owner atomically', async () => {
    const effect = corpseEffect({ corpseType: 'player', contents: true });
    const corpse = (effect.payload as any).corpse;
    const histories = new Map([
      [objectLifecycleStreamId(corpse.corpseId), lifecycleHistory(corpse.corpseId, 'expiring', corpse.expiresAt)],
      [worldItemsStreamId(worldId), corpseHistory(effect)],
      ['owner-1', [storedEvent('owner-1', 'character.created', {}, 1)]],
    ]);
    expect(projectObjectLifecycle(histories.get(objectLifecycleStreamId(corpse.corpseId))!))
      .toMatchObject({ state: 'expiring', expiresAt: corpse.expiresAt });
    const append = vi.fn(async (_request: unknown) => ({ receipt: { ok: true } }));

    await handle({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: corpse.locationId,
      expiresAt: corpse.expiresAt,
    }, context(histories, append));

    const request = append.mock.calls[0]?.[0] as any;
    expect(request.events[0].payload.policy).toBe('recovery-storage');
    expect(request.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        streamId: 'owner-1',
        expectedVersion: 1,
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'character.shared_item_received' }),
          expect.objectContaining({
            type: 'character.corpse_gold_received',
            payload: expect.objectContaining({ amount: 5, currencyId: 'gold' }),
          }),
        ]),
      }),
    ]));
    expect(request.effects[0].payload.message).toContain('returned to their owner');
  });

  it('rejects a failed atomic append without partially expiring the corpse', async () => {
    const effect = corpseEffect({ corpseType: 'player', contents: true });
    const corpse = (effect.payload as any).corpse;
    const histories = new Map([
      [objectLifecycleStreamId(corpse.corpseId), lifecycleHistory(corpse.corpseId, 'expiring', corpse.expiresAt)],
      [worldItemsStreamId(worldId), corpseHistory(effect)],
      ['owner-1', [storedEvent('owner-1', 'character.created', {}, 1)]],
    ]);
    const failedAppend = vi.fn(async (_request: unknown) => ({ receipt: { ok: false } }));

    await expect(handle({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: corpse.locationId,
      expiresAt: corpse.expiresAt,
    }, context(histories, failedAppend))).rejects.toThrow('Could not atomically expire the corpse');
  });

  it('rejects a failed lifecycle-only append for an already missing corpse', async () => {
    const histories = new Map([[objectLifecycleStreamId(corpseId), lifecycleHistory(corpseId)]]);
    const pending = handle({
      objectId: corpseId,
      objectType: 'corpse',
      locationId: 'southbound-track',
      expiresAt,
    }, context(histories, vi.fn(async (_request: unknown) => ({ receipt: { ok: false } }))));
    await expect(pending).rejects.toThrow('Could not finalize the missing corpse lifecycle.');
  });
});
