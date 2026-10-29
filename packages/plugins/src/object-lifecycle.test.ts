import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  objectLifecycleExpiredEvent,
  objectLifecyclePlugin,
  objectLifecycleRescheduledEvent,
  objectLifecycleScheduledEvent,
  objectLifecycleStateCapability,
  objectLifecycleStreamId,
  objectLifecycleSystemActorId,
  projectObjectLifecycle,
} from './object-lifecycle.js';

const worldInstanceId = 'lifecycle-test-world';
const baseTime = '2026-10-27T10:00:00.000Z';
const expiresAt = '2026-10-27T10:05:00.000Z';

function storedEvent(
  type: string,
  payload: Record<string, unknown>,
  aggregateVersion: number,
  objectId = 'corpse-1',
): StoredGameEvent {
  const lifecycleStreamId = objectLifecycleStreamId(objectId);
  return {
    eventId: `event-${aggregateVersion}`,
    worldInstanceId,
    aggregateId: lifecycleStreamId,
    streamId: lifecycleStreamId,
    aggregateVersion,
    type,
    version: 1,
    payload,
    occurredAt: baseTime,
    actorId: 'system',
    causationCommandId: `command-${aggregateVersion}`,
    commandId: `command-${aggregateVersion}`,
    tick: aggregateVersion,
  } as unknown as StoredGameEvent;
}

function captureLifecyclePlugin() {
  let state: { load(context: any, objectId: string): Promise<any> } | undefined;
  let expire: ((command: any, context: any) => Promise<any>) | undefined;
  objectLifecyclePlugin.register({
    provideCapability: (_token: unknown, implementation: unknown) => {
      state = implementation as typeof state;
    },
    registerSystemCommand: (_name: string, _schema: unknown, handler: unknown) => {
      expire = handler as typeof expire;
    },
  } as never);
  if (!state || !expire) throw new Error('Object lifecycle plugin did not register its capability and command.');
  return { state, expire };
}

function scheduledHistory(
  objectId = 'corpse-1',
  objectType = 'corpse',
  locationId = 'market-square',
) {
  const scheduled = objectLifecycleScheduledEvent({
    objectId,
    objectType,
    locationId,
    createdAt: baseTime,
    expiresAt,
  });
  return [storedEvent(scheduled.type, scheduled.payload, 1, objectId)];
}

describe('generic object lifecycle projection', () => {
  it('tracks scheduled, rescheduled, expiring, and expired transitions', () => {
    const events = [
      storedEvent('world.object_lifecycle_scheduled', {
        objectId: 'corpse-1',
        objectType: 'corpse',
        locationId: 'market-square',
        createdAt: baseTime,
        expiresAt,
      }, 1),
      storedEvent('world.object_lifecycle_rescheduled', {
        objectId: 'corpse-1',
        objectType: 'corpse',
        locationId: 'market-square',
        expiresAt: '2026-10-27T10:01:00.000Z',
      }, 2),
      storedEvent('world.object_expiring', {
        objectId: 'corpse-1',
        objectType: 'corpse',
        locationId: 'market-square',
        expiresAt: '2026-10-27T10:01:00.000Z',
      }, 3),
      storedEvent('world.object_expired', {
        objectId: 'corpse-1',
        objectType: 'corpse',
        locationId: 'market-square',
        expiredAt: '2026-10-27T10:01:05.000Z',
      }, 4),
    ];

    expect(projectObjectLifecycle(events)).toMatchObject({
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
      createdAt: baseTime,
      expiresAt: '2026-10-27T10:01:00.000Z',
      state: 'expired',
      revision: 4,
    });
  });

  it('rejects a reschedule without a prior lifecycle record', () => {
    expect(() => projectObjectLifecycle([
      storedEvent('world.object_lifecycle_rescheduled', {
        objectId: 'corpse-1',
        objectType: 'corpse',
        locationId: 'market-square',
        expiresAt,
      }, 1),
    ])).toThrow('Lifecycle reschedule without a scheduled object');
  });

  it('projects cancellation and rejects transitions from missing, cancelled, or expired states', () => {
    const scheduled = scheduledHistory();
    const cancelled = storedEvent('world.object_lifecycle_cancelled', {
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
    }, 2);
    expect(projectObjectLifecycle([...scheduled, cancelled])).toMatchObject({
      state: 'cancelled',
      revision: 2,
    });
    expect(() => projectObjectLifecycle([storedEvent('world.object_expiring', {
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
      expiresAt,
    }, 1)])).toThrow('Invalid object-expiring transition');
    expect(() => projectObjectLifecycle([...scheduled, cancelled, storedEvent('world.object_expired', {
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
      expiredAt: expiresAt,
    }, 3)])).toThrow('Invalid object-expired transition');
    expect(projectObjectLifecycle([storedEvent('unrelated.event', {}, 1)])).toBeUndefined();
  });

  it('rejects cancellation without a matching scheduled lifecycle', () => {
    expect(() => projectObjectLifecycle([storedEvent('world.object_lifecycle_cancelled', {
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
    }, 1)])).toThrow('Lifecycle cancellation without a scheduled object');
  });

  it('validates lifecycle event helpers and identifies the system actor', () => {
    expect(objectLifecycleRescheduledEvent({
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
      expiresAt,
    })).toMatchObject({ type: 'world.object_lifecycle_rescheduled', version: 1 });
    expect(objectLifecycleExpiredEvent({
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
      expiredAt: expiresAt,
    })).toMatchObject({ type: 'world.object_expired', version: 1 });
    expect(() => objectLifecycleRescheduledEvent({
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'market-square',
      expiresAt: 'not-a-date',
    } as any)).toThrow();
    expect(objectLifecycleSystemActorId()).toBe(SYSTEM_ACTOR_ID);
  });
});

describe('object lifecycle plugin', () => {
  it('loads projected state and marks a due object as expiring', async () => {
    const plugin = captureLifecyclePlugin();
    const history = scheduledHistory();
    const store = { readStream: vi.fn(async () => history) };
    const ctx = {
      worldInstanceId,
      store,
      now: () => new Date('2026-10-27T10:06:00.000Z'),
    };

    await expect(plugin.state.load(ctx, 'corpse-1')).resolves.toMatchObject({
      objectId: 'corpse-1',
      state: 'scheduled',
      revision: 1,
    });
    await expect(plugin.expire({
      payload: { objectId: 'corpse-1' },
      expectedVersion: 1,
    }, ctx)).resolves.toMatchObject({
      streamId: objectLifecycleStreamId('corpse-1'),
      expectedVersion: 1,
      events: [expect.objectContaining({
        type: 'world.object_expiring',
        payload: expect.objectContaining({ objectId: 'corpse-1', expiresAt }),
      })],
    });
    expect(store.readStream).toHaveBeenCalledWith(worldInstanceId, objectLifecycleStreamId('corpse-1'));
    expect(objectLifecycleStateCapability.id).toBe('mudd.object-lifecycle.state.v1');
  });

  it('emits generic expiration events for plugin-owned non-corpse objects', async () => {
    const plugin = captureLifecyclePlugin();
    const campfireHistory = scheduledHistory(
      'campfire-1',
      'campfire',
      'mossgate-clearing',
    );
    const store = { readStream: vi.fn(async () => campfireHistory) };

    const result = await plugin.expire({
      payload: { objectId: 'campfire-1' },
      expectedVersion: 1,
    }, {
      worldInstanceId,
      store,
      now: () => new Date('2026-10-27T10:06:00.000Z'),
    });

    expect(result.events).toEqual([expect.objectContaining({
      type: 'world.object_expiring',
      payload: {
        objectId: 'campfire-1',
        objectType: 'campfire',
        locationId: 'mossgate-clearing',
        expiresAt,
      },
    })]);
    expect(store.readStream).toHaveBeenCalledWith(
      worldInstanceId,
      objectLifecycleStreamId('campfire-1'),
    );
  });

  it('rejects expiration when no lifecycle exists, it is not due, or it is already terminal', async () => {
    const plugin = captureLifecyclePlugin();
    const baseContext = {
      worldInstanceId,
      now: () => new Date('2026-10-27T10:06:00.000Z'),
    };
    const command = { payload: { objectId: 'corpse-1' }, expectedVersion: 1 };

    await expect(plugin.expire(command, {
      ...baseContext,
      store: { readStream: async () => [] },
    })).rejects.toThrow('no longer scheduled');
    await expect(plugin.expire(command, {
      ...baseContext,
      now: () => new Date('2026-10-27T10:01:00.000Z'),
      store: { readStream: async () => scheduledHistory() },
    })).rejects.toThrow('not due to expire');

    const cancelledHistory = [
      ...scheduledHistory(),
      storedEvent('world.object_lifecycle_cancelled', {
        objectId: 'corpse-1',
        objectType: 'corpse',
        locationId: 'market-square',
      }, 2),
    ];
    await expect(plugin.expire(command, {
      ...baseContext,
      store: { readStream: async () => cancelledHistory },
    })).rejects.toThrow('no longer scheduled');
  });
});
