import { describe, expect, it } from 'vitest';
import type {
  AppendOutcome,
  AppendRequest,
  EventStorePort,
  StoredGameEvent,
} from '@mudd/engine-core';
import {
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
} from '@mudd/core-plugins';
import { scheduleLegacyCorpseLifecycles } from './legacy-corpse-cleanup.js';

const NOW = new Date('2026-10-31T12:00:00.000Z');

function storedEvent(
  worldInstanceId: string,
  streamId: string,
  aggregateVersion: number,
  type: string,
  payload: Record<string, unknown>,
  occurredAt = '2026-10-30T12:00:00.000Z',
): StoredGameEvent {
  return {
    type,
    version: 1,
    payload,
    eventId: `${streamId}:${aggregateVersion}`,
    worldInstanceId,
    streamId,
    aggregateId: streamId,
    aggregateVersion,
    causationCommandId: 'fixture-command',
    actorId: '00000000-0000-4000-8000-000000000001',
    occurredAt,
    tick: aggregateVersion,
  };
}

function corpseCreatedEvent(
  worldInstanceId: string,
  corpseId: string,
  locationId: string,
  aggregateVersion = 1,
  corpseFields: Record<string, unknown> = {},
): StoredGameEvent {
  return storedEvent(worldInstanceId, 'world-items', aggregateVersion, 'world.corpse_created', {
    corpse: {
      corpseId,
      encounterId: `encounter-${corpseId}`,
      opponentId: 'roadside-deer',
      opponentName: 'Roadside Deer',
      label: 'Roadside Deer corpse',
      description: 'A deer lies still.',
      locationId,
      currencyAmount: 0,
      goldClaimed: false,
      ...corpseFields,
    },
    items: [],
  });
}

class MemoryStore {
  readonly streams = new Map<string, StoredGameEvent[]>();
  readonly appends: AppendRequest[] = [];

  streamKey(worldInstanceId: string, streamId: string) {
    return `${worldInstanceId}\u0000${streamId}`;
  }

  seed(event: StoredGameEvent) {
    const key = this.streamKey(event.worldInstanceId, event.streamId);
    this.streams.set(key, [...(this.streams.get(key) ?? []), event]);
  }

  readonly port: Pick<EventStorePort, 'readStream' | 'append'> = {
    readStream: async (worldInstanceId, streamId) =>
      this.streams.get(this.streamKey(worldInstanceId, streamId)) ?? [],
    append: async (request): Promise<AppendOutcome> => {
      this.appends.push(request);
      const key = this.streamKey(request.worldInstanceId, request.streamId);
      const history = this.streams.get(key) ?? [];
      const currentVersion = history.at(-1)?.aggregateVersion ?? 0;
      if (currentVersion !== request.expectedVersion) {
        return {
          kind: 'conflict',
          streamId: request.streamId,
          events: [],
          receipt: {
            ok: false,
            commandId: request.commandId,
            code: 'VERSION_CONFLICT',
            message: 'The stream changed.',
            retryable: true,
          },
        };
      }

      const appended = request.events.map((event, index) =>
        storedEvent(
          request.worldInstanceId,
          request.streamId,
          currentVersion + index + 1,
          event.type,
          { ...event.payload },
          NOW.toISOString(),
        ),
      );
      this.streams.set(key, [...history, ...appended]);
      return {
        kind: 'committed',
        streamId: request.streamId,
        events: appended,
        receipt: { ok: true, commandId: request.commandId },
      };
    },
  };
}

describe('legacy corpse lifecycle cleanup', () => {
  it('schedules active corpses in every world for immediate normal expiry', async () => {
    const store = new MemoryStore();
    store.seed(corpseCreatedEvent('world-a', 'corpse-a', 'old-road'));
    store.seed(corpseCreatedEvent('world-a', 'corpse-b', 'market', 2, {
      createdAt: '2026-10-29T08:00:00.000Z',
    }));
    store.seed(corpseCreatedEvent('world-b', 'corpse-c', 'crossing'));

    const result = await scheduleLegacyCorpseLifecycles(
      store.port,
      ['world-a', 'world-b', 'world-a'],
      NOW,
    );

    expect(result).toEqual({
      worldsScanned: 2,
      corpsesScheduled: 3,
      corpsesAlreadyScheduled: 0,
    });
    expect(store.appends).toHaveLength(3);
    expect(store.appends.map((append) => append.events[0])).toEqual([
      objectLifecycleScheduledEvent({
        objectId: 'corpse-a',
        objectType: 'corpse',
        locationId: 'old-road',
        createdAt: '2026-10-30T12:00:00.000Z',
        expiresAt: NOW.toISOString(),
      }),
      objectLifecycleScheduledEvent({
        objectId: 'corpse-b',
        objectType: 'corpse',
        locationId: 'market',
        createdAt: '2026-10-29T08:00:00.000Z',
        expiresAt: NOW.toISOString(),
      }),
      objectLifecycleScheduledEvent({
        objectId: 'corpse-c',
        objectType: 'corpse',
        locationId: 'crossing',
        createdAt: '2026-10-30T12:00:00.000Z',
        expiresAt: NOW.toISOString(),
      }),
    ]);
  });

  it('leaves existing lifecycle histories untouched and is safe to rerun', async () => {
    const store = new MemoryStore();
    store.seed(corpseCreatedEvent('world-a', 'corpse-a', 'old-road'));
    store.seed(corpseCreatedEvent('world-a', 'corpse-b', 'market', 2));
    store.seed(storedEvent(
      'world-a',
      objectLifecycleStreamId('corpse-b'),
      1,
      'world.object_lifecycle_scheduled',
      {
        objectId: 'corpse-b',
        objectType: 'corpse',
        locationId: 'market',
        createdAt: '2026-10-30T12:00:00.000Z',
        expiresAt: '2026-11-01T12:00:00.000Z',
      },
    ));

    const firstRun = await scheduleLegacyCorpseLifecycles(store.port, ['world-a'], NOW);
    const secondRun = await scheduleLegacyCorpseLifecycles(store.port, ['world-a'], NOW);

    expect(firstRun).toEqual({
      worldsScanned: 1,
      corpsesScheduled: 1,
      corpsesAlreadyScheduled: 1,
    });
    expect(secondRun).toEqual({
      worldsScanned: 1,
      corpsesScheduled: 0,
      corpsesAlreadyScheduled: 2,
    });
    expect(store.appends).toHaveLength(1);
  });

  it('does not append a schedule when creation is later than the cleanup time', async () => {
    const store = new MemoryStore();
    const event = corpseCreatedEvent('world-a', 'corpse-a', 'old-road');
    store.seed({ ...event, occurredAt: '2026-11-01T12:00:00.000Z' });

    await expect(scheduleLegacyCorpseLifecycles(store.port, ['world-a'], NOW))
      .rejects.toThrow('invalid creation time');
    expect(store.appends).toHaveLength(0);
  });

  it('recognizes a lifecycle stream created concurrently by another worker', async () => {
    const store = new MemoryStore();
    store.seed(corpseCreatedEvent('world-a', 'corpse-a', 'old-road'));
    const originalAppend = store.port.append;
    store.port.append = async (request) => {
      store.seed(storedEvent(
        request.worldInstanceId,
        request.streamId,
        1,
        'world.object_lifecycle_scheduled',
        {
          objectId: 'corpse-a',
          objectType: 'corpse',
          locationId: 'old-road',
          createdAt: '2026-10-30T12:00:00.000Z',
          expiresAt: NOW.toISOString(),
        },
        NOW.toISOString(),
      ));
      return originalAppend(request);
    };

    const result = await scheduleLegacyCorpseLifecycles(store.port, ['world-a'], NOW);

    expect(result).toEqual({
      worldsScanned: 1,
      corpsesScheduled: 0,
      corpsesAlreadyScheduled: 1,
    });
  });
});
