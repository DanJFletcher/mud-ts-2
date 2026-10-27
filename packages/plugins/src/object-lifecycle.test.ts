import { describe, expect, it } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import { projectObjectLifecycle } from './object-lifecycle.js';

const worldInstanceId = 'lifecycle-test-world';
const streamId = 'world-object-lifecycle:corpse-1';
const baseTime = '2026-10-27T10:00:00.000Z';
const expiresAt = '2026-10-27T10:05:00.000Z';

function storedEvent(
  type: string,
  payload: Record<string, unknown>,
  aggregateVersion: number,
): StoredGameEvent {
  return {
    eventId: `event-${aggregateVersion}`,
    worldInstanceId,
    aggregateId: streamId,
    streamId,
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
});
