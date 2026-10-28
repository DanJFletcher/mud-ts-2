import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppendRequest } from '@mudd/engine-core';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('../db/client.js', () => ({ db: mockDb }));

import { PostgresEventStore, toStoredGameEvent } from './postgres-event-store.js';

function mockUpdateReturning(rows: unknown[]) {
  const returning = vi.fn(async () => rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  mockDb.update.mockReturnValue({ set });
  return { set, where, returning };
}

function mockSelectLimit(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  mockDb.select.mockReturnValue({
    from: () => ({
      where: () => ({ limit }),
    }),
  });
  return { limit };
}

function createAppendTransaction(options: {
  heads?: Array<{ streamId: string; revision: number }>;
  persistedCounts?: Array<{ eventCount: number; receiptCount: number }>;
  failOnInsertIndex?: number;
} = {}) {
  const persistedValues: unknown[] = [];
  const ctes: unknown[] = [];
  let insertIndex = 0;
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          groupBy: async () => options.heads ?? [],
        }),
      }),
    })),
    insert: vi.fn(() => {
      const index = insertIndex++;
      return {
        values: (values: unknown) => {
          persistedValues.push(values);
          if (index === options.failOnInsertIndex) throw new Error('durable effect insert failed');
          return {
            returning: () => ({ values }),
            onConflictDoUpdate: () => Promise.resolve(),
          };
        },
      };
    }),
    $with: vi.fn((name: string) => ({
      as: (query: unknown) => {
        const cte = { name, query };
        ctes.push(cte);
        return cte;
      },
    })),
    with: vi.fn(() => ({
      select: () => ({
        from: () => ({
          limit: async () => options.persistedCounts ?? [{ eventCount: 1, receiptCount: 1 }],
        }),
      }),
    })),
  };
  return { tx, persistedValues, ctes };
}

function basicAppendRequest(overrides: Partial<AppendRequest> = {}): AppendRequest {
  return {
    worldInstanceId: 'world-1',
    streamId: 'shared-character-stream',
    actorId: 'player-1',
    commandId: 'atomic-command',
    payloadHash: 'atomic-payload',
    expectedVersion: 0,
    events: [{
      type: 'character.progress.changed',
      version: 1,
      payload: { characterId: 'shared-character-stream', progress: 1 },
    }],
    ...overrides,
  };
}

function persistedEventRow(streamId: string, eventId: string, streamVersion: number) {
  return {
    type: 'character.progress.changed',
    contractVersion: 1,
    payload: { progress: streamVersion },
    eventId,
    worldInstanceId: 'world-1',
    streamId,
    streamVersion,
    causationCommandId: `command-${streamVersion}`,
    actorId: 'player-1',
    occurredAt: new Date(`2026-10-28T12:00:0${streamVersion}.000Z`),
    tick: streamVersion,
  } as Parameters<typeof toStoredGameEvent>[0];
}

function revisionSelect(revision: number) {
  return () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => [{ revision }] }),
      }),
    }),
  });
}

function historySelect(rows: Array<Parameters<typeof toStoredGameEvent>[0]>) {
  return () => ({
    from: () => ({
      where: () => ({ orderBy: async () => rows }),
    }),
  });
}

describe('PostgresEventStore unit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps persisted event rows to ordered domain-event envelopes', () => {
    const occurredAt = new Date('2026-10-27T12:34:56.000Z');
    const row = {
      type: 'character.moved',
      contractVersion: 1,
      payload: { fromLocationId: 'room-a', toLocationId: 'room-b' },
      eventId: 'event-1',
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      streamVersion: 7,
      causationCommandId: 'command-7',
      actorId: 'player-1',
      occurredAt,
      tick: 7,
    } as Parameters<typeof toStoredGameEvent>[0];

    expect(toStoredGameEvent(row)).toEqual({
      type: 'character.moved',
      version: 1,
      payload: { fromLocationId: 'room-a', toLocationId: 'room-b' },
      eventId: 'event-1',
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      aggregateId: 'character-1',
      aggregateVersion: 7,
      causationCommandId: 'command-7',
      actorId: 'player-1',
      occurredAt: occurredAt.toISOString(),
      tick: 7,
    });
  });

  it('reuses a command-scoped stream snapshot only when its expected revision matches', async () => {
    const occurredAt = new Date('2026-10-27T12:34:56.000Z');
    const row = {
      type: 'character.moved',
      contractVersion: 1,
      payload: { fromLocationId: 'room-a', toLocationId: 'room-b' },
      eventId: 'event-1',
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      streamVersion: 1,
      causationCommandId: 'command-1',
      actorId: 'player-1',
      occurredAt,
      tick: 1,
    } as Parameters<typeof toStoredGameEvent>[0];
    const revisionQuery = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [{ revision: 1 }] }),
        }),
      }),
    });
    const eventsQuery = () => ({
      from: () => ({
        where: () => ({ orderBy: async () => [row] }),
      }),
    });
    mockDb.select.mockImplementationOnce(revisionQuery)
      .mockImplementationOnce(eventsQuery)
      .mockImplementationOnce(revisionQuery);
    const store = new PostgresEventStore();

    const matchingSnapshot = await store.withCommandReadCache(
      'world-1',
      'character-1',
      async () => {
        const first = await store.readStream('world-1', 'character-1');
        const second = await store.readStream('world-1', 'character-1');
        return { first, second };
      },
      1,
    );
    expect(matchingSnapshot.first).toBe(matchingSnapshot.second);
    expect(matchingSnapshot.first).toHaveLength(1);
    expect(mockDb.select).toHaveBeenCalledTimes(2);

    const staleExpectedVersion = await store.withCommandReadCache(
      'world-1',
      'character-1',
      () => store.readStream('world-1', 'character-1'),
      2,
    );
    expect(staleExpectedVersion).toEqual(matchingSnapshot.first);
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });

  it('keeps the command cache and room-state projection current after a cached character append', async () => {
    const characterId = '123e4567-e89b-42d3-a456-426614174000';
    const occurredAt = new Date('2026-10-28T12:00:00.000Z');
    const createdRow = {
      type: 'character.created',
      contractVersion: 1,
      payload: {
        characterId,
        playerId: 'player-1',
        name: 'Rowan',
        startingLocationId: 'room-a',
      },
      eventId: 'event-created',
      worldInstanceId: 'world-1',
      streamId: characterId,
      streamVersion: 1,
      causationCommandId: 'create-command',
      actorId: 'player-1',
      occurredAt,
      tick: 1,
    } as Parameters<typeof toStoredGameEvent>[0];
    const revisionQuery = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [{ revision: 1 }] }),
        }),
      }),
    });
    const historyQuery = () => ({
      from: () => ({
        where: () => ({ orderBy: async () => [createdRow] }),
      }),
    });
    mockDb.select.mockImplementationOnce(revisionQuery).mockImplementationOnce(historyQuery);

    const { tx, persistedValues } = createAppendTransaction({
      heads: [{ streamId: characterId, revision: 1 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();
    const request: AppendRequest = {
      worldInstanceId: 'world-1',
      streamId: characterId,
      actorId: 'player-1',
      commandId: 'move-command',
      payloadHash: 'move-payload',
      expectedVersion: 1,
      events: [{
        type: 'character.moved',
        version: 1,
        payload: {
          characterId,
          fromLocationId: 'room-a',
          toLocationId: 'room-b',
          exitId: 'east-exit',
        },
      }],
    };

    const result = await store.withCommandReadCache('world-1', characterId, async () => {
      const before = await store.readStream('world-1', characterId);
      const outcome = await store.append(request);
      const after = await store.readStream('world-1', characterId);
      return { before, outcome, after };
    }, 1);

    expect(result.before).toHaveLength(1);
    expect(result.outcome.kind).toBe('committed');
    expect(result.after).toHaveLength(2);
    expect(result.after[1]).toMatchObject({
      type: 'character.moved',
      aggregateVersion: 2,
      payload: { fromLocationId: 'room-a', toLocationId: 'room-b' },
    });
    expect(mockDb.select).toHaveBeenCalledTimes(2);

    expect(persistedValues[2]).toMatchObject({
      characterId,
      worldInstanceId: 'world-1',
      locationId: 'room-b',
      revision: 2,
      schemaVersion: 1,
      state: {
        characterId,
        worldInstanceId: 'world-1',
        locationId: 'room-b',
        name: 'Rowan',
        archived: false,
      },
    });
  });

  it('loads a successful append into the scoped cache when no snapshot was read first', async () => {
    const streamId = 'uncached-stream';
    mockDb.select.mockImplementationOnce(historySelect([
      persistedEventRow(streamId, 'event-new', 1),
    ]));
    const { tx } = createAppendTransaction();
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const result = await store.withCommandReadCache('world-1', streamId, async () => {
      const outcome = await store.append(basicAppendRequest({
        streamId,
        commandId: 'uncached-command',
        expectedVersion: 0,
      }));
      const events = await store.readStream('world-1', streamId);
      return { outcome, events };
    }, 0);

    expect(result.outcome.kind).toBe('committed');
    expect(result.events.map(({ eventId }) => eventId)).toEqual(['event-new']);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it('invalidates the primary scoped snapshot after a version conflict', async () => {
    const streamId = 'primary-cache';
    const previous = persistedEventRow(streamId, 'event-before', 1);
    const latest = persistedEventRow(streamId, 'event-after', 2);
    mockDb.select
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([previous]))
      .mockImplementationOnce(revisionSelect(2))
      .mockImplementationOnce(historySelect([latest]));
    const { tx } = createAppendTransaction({
      heads: [{ streamId, revision: 2 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const result = await store.withCommandReadCache('world-1', streamId, async () => {
      const before = await store.readStream('world-1', streamId);
      const outcome = await store.append(basicAppendRequest({
        streamId,
        commandId: 'stale-primary-command',
        expectedVersion: 1,
      }));
      const after = await store.readStream('world-1', streamId);
      return { before, outcome, after };
    }, 1);

    expect(result.before.map(({ eventId }) => eventId)).toEqual(['event-before']);
    expect(result.outcome.kind).toBe('conflict');
    expect(result.after.map(({ eventId }) => eventId)).toEqual(['event-before', 'event-after']);
    expect(mockDb.select).toHaveBeenCalledTimes(4);
  });

  it('invalidates companion stream caches after a successful atomic write', async () => {
    const companionStreamId = 'companion-cache';
    const previous = persistedEventRow(companionStreamId, 'companion-before', 1);
    const latest = persistedEventRow(companionStreamId, 'companion-after', 2);
    mockDb.select
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([previous]))
      .mockImplementationOnce(revisionSelect(2))
      .mockImplementationOnce(historySelect([previous, latest]));
    const { tx } = createAppendTransaction({
      heads: [{ streamId: companionStreamId, revision: 1 }],
      persistedCounts: [{ eventCount: 2, receiptCount: 1 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();
    const request = basicAppendRequest({
      streamId: 'primary-stream',
      commandId: 'companion-write',
      companions: [{
        streamId: companionStreamId,
        expectedVersion: 1,
        events: [{ type: 'world.team.changed', version: 1, payload: { teamId: 'team-1' } }],
      }],
    });

    const result = await store.withCommandReadCache('world-1', companionStreamId, async () => {
      const before = await store.readStream('world-1', companionStreamId);
      const outcome = await store.append(request);
      const after = await store.readStream('world-1', companionStreamId);
      return { before, outcome, after };
    }, 1);

    expect(result.before.map(({ eventId }) => eventId)).toEqual(['companion-before']);
    expect(result.outcome.kind).toBe('committed');
    expect(result.after.map(({ eventId }) => eventId)).toEqual([
      'companion-before',
      'companion-after',
    ]);
    expect(mockDb.select).toHaveBeenCalledTimes(4);
  });

  it('invalidates a companion scoped snapshot when the atomic command conflicts', async () => {
    const companionStreamId = 'companion-cache';
    const previous = persistedEventRow(companionStreamId, 'companion-before', 1);
    const latest = persistedEventRow(companionStreamId, 'companion-after', 2);
    mockDb.select
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([previous]))
      .mockImplementationOnce(revisionSelect(2))
      .mockImplementationOnce(historySelect([latest]));
    const { tx } = createAppendTransaction({
      heads: [{ streamId: companionStreamId, revision: 2 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();
    const request = basicAppendRequest({
      streamId: 'primary-stream',
      commandId: 'stale-companion-write',
      companions: [{
        streamId: companionStreamId,
        expectedVersion: 1,
        events: [{ type: 'world.team.changed', version: 1, payload: { teamId: 'team-1' } }],
      }],
    });

    const result = await store.withCommandReadCache('world-1', companionStreamId, async () => {
      const before = await store.readStream('world-1', companionStreamId);
      const outcome = await store.append(request);
      const after = await store.readStream('world-1', companionStreamId);
      return { before, outcome, after };
    }, 1);

    expect(result.before.map(({ eventId }) => eventId)).toEqual(['companion-before']);
    expect(result.outcome.kind).toBe('conflict');
    expect(result.after.map(({ eventId }) => eventId)).toEqual([
      'companion-before',
      'companion-after',
    ]);
    expect(mockDb.select).toHaveBeenCalledTimes(4);
  });

  it('rebuilds a missing room-state projection from persisted character history', async () => {
    const characterId = '123e4567-e89b-42d3-a456-426614174000';
    const occurredAt = new Date('2026-10-28T12:00:00.000Z');
    const createdRow = {
      type: 'character.created',
      contractVersion: 1,
      payload: {
        characterId,
        playerId: 'player-1',
        name: 'Rowan',
        startingLocationId: 'room-a',
      },
      eventId: 'event-created',
      worldInstanceId: 'world-1',
      streamId: characterId,
      streamVersion: 1,
      causationCommandId: 'create-command',
      actorId: 'player-1',
      occurredAt,
      tick: 1,
    } as Parameters<typeof toStoredGameEvent>[0];
    mockDb.select.mockReturnValue({
      from: () => ({
        where: async () => [{ id: characterId, world: 'world-1' }],
      }),
    });

    const selectResults = [
      {
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [{ revision: 1 }] }),
          }),
        }),
      },
      {
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      },
      {
        from: () => ({
          where: () => ({ limit: async () => [{ id: characterId }] }),
        }),
      },
      {
        from: () => ({
          where: () => ({ orderBy: async () => [createdRow] }),
        }),
      },
    ];
    const projectionWrites: Array<{ values: unknown; conflict: unknown }> = [];
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => selectResults.shift()),
      insert: vi.fn(() => ({
        values: (values: unknown) => ({
          onConflictDoUpdate: (conflict: unknown) => {
            projectionWrites.push({ values, conflict });
            return Promise.resolve();
          },
        }),
      })),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await new PostgresEventStore().rebuildRoomStates('world-1', characterId);

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.select).toHaveBeenCalledTimes(4);
    expect(projectionWrites).toHaveLength(1);
    expect(projectionWrites[0]?.values).toMatchObject({
      characterId,
      worldInstanceId: 'world-1',
      locationId: 'room-a',
      revision: 1,
      schemaVersion: 1,
      state: {
        characterId,
        worldInstanceId: 'world-1',
        locationId: 'room-a',
        name: 'Rowan',
        archived: false,
      },
    });
  });

  it('skips rebuilding a room-state projection already at the current schema and revision', async () => {
    const characterId = '123e4567-e89b-42d3-a456-426614174000';
    mockDb.select.mockReturnValue({
      from: () => ({
        where: async () => [{ id: characterId, world: 'world-1' }],
      }),
    });
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn()
        .mockImplementationOnce(() => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({ limit: async () => [{ revision: 4 }] }),
            }),
          }),
        }))
        .mockImplementationOnce(() => ({
          from: () => ({
            where: () => ({ limit: async () => [{ revision: 4, schemaVersion: 1 }] }),
          }),
        })),
      insert: vi.fn(),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await new PostgresEventStore().rebuildRoomStates('world-1', characterId);

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('returns empty stream batches without querying and de-duplicates requested streams', async () => {
    const occurredAt = new Date('2026-10-27T12:34:56.000Z');
    const revisionsQuery = () => ({
      from: () => ({
        where: () => ({
          groupBy: async () => [
            { streamId: 'character-a', revision: 1 },
            { streamId: 'character-b', revision: 1 },
          ],
        }),
      }),
    });
    const eventsQuery = (streamId: string, eventId: string) => () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [{
            type: 'character.moved',
            contractVersion: 1,
            payload: { toLocationId: `room-${streamId}` },
            eventId,
            worldInstanceId: 'world-1',
            streamId,
            streamVersion: 1,
            causationCommandId: 'command-1',
            actorId: 'player-1',
            occurredAt,
            tick: 1,
          }],
        }),
      }),
    });
    mockDb.select.mockImplementationOnce(revisionsQuery)
      .mockImplementationOnce(eventsQuery('character-a', 'event-a'))
      .mockImplementationOnce(eventsQuery('character-b', 'event-b'));
    const store = new PostgresEventStore();

    const empty = await store.readStreams('world-1', []);
    const streams = await store.readStreams('world-1', ['character-a', 'character-a', 'character-b']);

    expect(empty.size).toBe(0);
    expect(streams.size).toBe(2);
    expect(streams.get('character-a')?.map(({ eventId }) => eventId)).toEqual(['event-a']);
    expect(streams.get('character-b')?.map(({ eventId }) => eventId)).toEqual(['event-b']);
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });

  it('looks up an idempotent receipt or reports a payload mismatch', async () => {
    const prior = {
      payloadHash: 'saved-hash',
      streamId: 'character-1',
      events: [{
        type: 'character.moved',
        version: 1,
        eventId: 'event-1',
        worldInstanceId: 'world-1',
        streamId: 'character-1',
        aggregateId: 'character-1',
        aggregateVersion: 1,
        causationCommandId: 'command-1',
        actorId: 'player-1',
        occurredAt: '2026-10-27T12:34:56.000Z',
        tick: 1,
        payload: { toLocationId: 'room-b' },
      }],
      receipt: {
        ok: true,
        commandId: 'command-1',
        eventIds: ['event-1'],
        newAggregateVersion: 1,
      },
    };
    const store = new PostgresEventStore();

    mockSelectLimit([prior]);
    const duplicate = await store.lookupCommand('world-1', 'player-1', 'command-1', 'saved-hash');
    expect(duplicate).toMatchObject({
      kind: 'duplicate',
      streamId: 'character-1',
      receipt: { ok: true, eventIds: ['event-1'] },
      events: [{ eventId: 'event-1' }],
    });

    mockSelectLimit([prior]);
    const conflict = await store.lookupCommand('world-1', 'player-1', 'command-1', 'different-hash');
    expect(conflict).toMatchObject({
      kind: 'conflict',
      streamId: 'character-1',
      receipt: {
        ok: false,
        code: 'INVALID_COMMAND',
        retryable: false,
      },
      events: [{ eventId: 'event-1' }],
    });

    mockSelectLimit([]);
    await expect(store.lookupCommand('world-1', 'player-1', 'missing-command', 'hash'))
      .resolves.toBeUndefined();
  });

  it('checks the command lock before reading a prior receipt and returns an idempotent retry', async () => {
    const calls: string[] = [];
    const commandId = 'command-retry';
    const prior = {
      payloadHash: 'same-payload',
      streamId: 'character-1',
      events: [],
      receipt: {
        ok: true,
        commandId,
        eventIds: ['event-1'],
        newAggregateVersion: 1,
      },
    };
    const tx = {
      execute: vi.fn(async () => { calls.push('command-lock'); }),
      select: vi.fn(() => {
        calls.push('receipt-read');
        return {
          from: () => ({
            where: () => ({
              limit: async () => [prior],
            }),
          }),
        };
      }),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const outcome = await store.append({
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      actorId: 'player-1',
      commandId,
      payloadHash: 'same-payload',
      expectedVersion: 0,
      events: [{ type: 'character.created', version: 1, payload: {} }],
    });

    expect(calls).toEqual(['command-lock', 'receipt-read']);
    expect(outcome).toMatchObject({
      kind: 'duplicate',
      streamId: 'character-1',
      receipt: { ok: true, commandId, eventIds: ['event-1'] },
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a command ID with a different payload after taking the lock', async () => {
    const calls: string[] = [];
    const commandId = 'command-conflict';
    const tx = {
      execute: vi.fn(async () => { calls.push('command-lock'); }),
      select: vi.fn(() => {
        calls.push('receipt-read');
        return {
          from: () => ({
            where: () => ({
              limit: async () => [{
                payloadHash: 'original-payload',
                streamId: 'character-1',
                events: [],
                receipt: { ok: true, commandId, eventIds: ['event-1'], newAggregateVersion: 1 },
              }],
            }),
          }),
        };
      }),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const outcome = await store.append({
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      actorId: 'player-1',
      commandId,
      payloadHash: 'different-payload',
      expectedVersion: 1,
      events: [{ type: 'character.item_taken', version: 1, payload: {} }],
    });

    expect(calls).toEqual(['command-lock', 'receipt-read']);
    expect(outcome).toMatchObject({
      kind: 'conflict',
      receipt: { ok: false, code: 'INVALID_COMMAND', retryable: false },
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it('rechecks stream and guard revisions after locking before accepting an append', async () => {
    const calls: string[] = [];
    const tx = {
      execute: vi.fn(async () => { calls.push('lock'); }),
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              calls.push('receipt-read');
              return [];
            },
            groupBy: async () => {
              calls.push('locked-stream-revisions-read');
              return [];
            },
          }),
        }),
      })),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const outcome = await store.append({
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      actorId: 'player-1',
      commandId: 'stale-command',
      payloadHash: 'payload',
      expectedVersion: 0,
      guards: [{ streamId: 'world-team-combat', expectedVersion: 1 }],
      events: [{ type: 'character.moved', version: 1, payload: {} }],
    });

    expect(calls).toEqual(['lock', 'receipt-read', 'lock', 'locked-stream-revisions-read']);
    expect(outcome).toMatchObject({
      kind: 'conflict',
      receipt: { ok: false, code: 'VERSION_CONFLICT', retryable: true },
    });
  });

  it('rejects duplicate streams in one atomic write before inserting anything', async () => {
    const { tx, persistedValues } = createAppendTransaction();
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await expect(new PostgresEventStore().append(basicAppendRequest({
      companions: [{
        streamId: 'shared-character-stream',
        expectedVersion: 0,
        events: [{ type: 'world.team.changed', version: 1, payload: {} }],
      }],
    }))).rejects.toThrow('Duplicate atomic write stream.');

    expect(persistedValues).toHaveLength(0);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('rejects empty primary or companion event batches', async () => {
    const primary = createAppendTransaction();
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(primary.tx));

    await expect(new PostgresEventStore().append(basicAppendRequest({ events: [] })))
      .rejects.toThrow('A command must append at least one event.');
    expect(primary.tx.insert).not.toHaveBeenCalled();

    const companion = createAppendTransaction();
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(companion.tx));
    await expect(new PostgresEventStore().append(basicAppendRequest({
      companions: [{ streamId: 'world-team', expectedVersion: 0, events: [] }],
    }))).rejects.toThrow('An atomic companion write must contain events.');
    expect(companion.tx.insert).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict when the primary stream head has advanced', async () => {
    const { tx, persistedValues } = createAppendTransaction({
      heads: [{ streamId: 'shared-character-stream', revision: 3 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    const outcome = await new PostgresEventStore().append(basicAppendRequest());

    expect(outcome).toMatchObject({
      kind: 'conflict',
      streamId: 'shared-character-stream',
      receipt: {
        ok: false,
        code: 'VERSION_CONFLICT',
        retryable: true,
      },
    });
    expect(persistedValues).toHaveLength(0);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('commits primary and companion events, receipt, and effects in one atomic append', async () => {
    const persistedValues: unknown[] = [];
    const heads = [
      { streamId: 'companion-stream', revision: 2 },
      { streamId: 'guard-stream', revision: 3 },
    ];
    const ctes: unknown[] = [];
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
            groupBy: async () => heads,
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: (values: unknown) => {
          persistedValues.push(values);
          return {
            returning: () => ({ values }),
          };
        },
      })),
      $with: vi.fn((name: string) => ({
        as: (query: unknown) => {
          const cte = { name, query };
          ctes.push(cte);
          return cte;
        },
      })),
      with: vi.fn(() => ({
        select: () => ({
          from: () => ({
            limit: async () => [{ eventCount: 2, receiptCount: 1 }],
          }),
        }),
      })),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();
    const request: AppendRequest = {
      worldInstanceId: 'world-1',
      streamId: 'shared-character-stream',
      actorId: 'player-1',
      commandId: 'atomic-command',
      payloadHash: 'atomic-payload',
      expectedVersion: 0,
      guards: [{ streamId: 'guard-stream', expectedVersion: 3 }],
      companions: [{
        streamId: 'companion-stream',
        expectedVersion: 2,
        events: [{ type: 'world.team.changed', version: 1, payload: { teamId: 'team-1' } }],
      }],
      events: [{
        type: 'character.progress.changed',
        version: 1,
        payload: { characterId: 'shared-character-stream', progress: 1 },
      }],
      effects: [{
        type: 'world.location.entered',
        version: 1,
        payload: { characterId: 'shared-character-stream', toLocationId: 'room-b' },
      }],
    };

    const outcome = await store.append(request);

    expect(outcome.kind).toBe('committed');
    expect(outcome).toMatchObject({
      streamId: 'shared-character-stream',
      receipt: { ok: true, commandId: 'atomic-command', newAggregateVersion: 1 },
    });
    expect(persistedValues).toHaveLength(3);

    const eventRows = persistedValues[0] as Array<{
      streamId: string;
      streamVersion: number;
      type: string;
      causationCommandId: string;
      payload: Record<string, unknown>;
    }>;
    expect(eventRows).toHaveLength(2);
    expect(eventRows.map(({ streamId, streamVersion, type }) => ({ streamId, streamVersion, type })))
      .toEqual([
        { streamId: 'companion-stream', streamVersion: 3, type: 'world.team.changed' },
        { streamId: 'shared-character-stream', streamVersion: 1, type: 'character.progress.changed' },
      ]);
    expect(eventRows.every((event) => event.causationCommandId === 'atomic-command')).toBe(true);

    expect(persistedValues[1]).toMatchObject({
      worldInstanceId: 'world-1',
      actorId: 'player-1',
      commandId: 'atomic-command',
      payloadHash: 'atomic-payload',
      streamId: 'shared-character-stream',
    });
    const effectRows = persistedValues[2] as Array<{
      effectType: string;
      dedupeKey: string;
      payload: Record<string, unknown>;
    }>;
    expect(effectRows).toHaveLength(1);
    expect(effectRows[0]).toMatchObject({
      effectType: 'world.location.entered',
      dedupeKey: 'command:world-1:player-1:atomic-command:0',
      payload: { toLocationId: 'room-b' },
    });
    expect(ctes.map((cte) => (cte as { name: string }).name))
      .toEqual(['appended_events', 'appended_receipt']);
    expect(tx.with).toHaveBeenCalledTimes(1);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the event count is incomplete', [{ eventCount: 0, receiptCount: 1 }]],
    ['the receipt count is incomplete', [{ eventCount: 1, receiptCount: 0 }]],
    ['the combined insert returns no row', []],
  ])('rejects the append when %s', async (_scenario, persistedCounts) => {
    const { tx, persistedValues } = createAppendTransaction({ persistedCounts });
    let transactionResolved = false;
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => {
      const result = await run(tx);
      transactionResolved = true;
      return result;
    });

    await expect(new PostgresEventStore().append(basicAppendRequest({
      effects: [{
        type: 'world.location.entered',
        version: 1,
        payload: { characterId: 'shared-character-stream', toLocationId: 'room-b' },
      }],
    }))).rejects.toThrow('Command append did not persist its events and receipt.');

    expect(transactionResolved).toBe(false);
    expect(persistedValues).toHaveLength(2);
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it('rejects after an effect write fails so the enclosing append transaction can roll back', async () => {
    const { tx, persistedValues } = createAppendTransaction({ failOnInsertIndex: 2 });
    let transactionResolved = false;
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => {
      const result = await run(tx);
      transactionResolved = true;
      return result;
    });

    await expect(new PostgresEventStore().append(basicAppendRequest({
      effects: [{
        type: 'world.location.entered',
        version: 1,
        payload: { characterId: 'shared-character-stream', toLocationId: 'room-b' },
      }],
    }))).rejects.toThrow('durable effect insert failed');

    expect(transactionResolved).toBe(false);
    expect(persistedValues).toHaveLength(3);
    expect(tx.insert).toHaveBeenCalledTimes(3);
  });

  it('claims a pending durable effect with a lease and incremented attempt count', async () => {
    const pending = {
      id: 'effect-1',
      worldInstanceId: 'world-1',
      sourceStreamId: 'character-1',
      causationCommandId: 'command-1',
      effectType: 'world.location.entered',
      effectVersion: 1,
      payload: { toLocationId: 'room-b' },
      attempts: 2,
    };
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                for: async () => [pending],
              }),
            }),
          }),
        }),
      })),
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ ...pending, attempts: 3 }],
          }),
        }),
      })),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const effect = await store.claimNextEffect(30_000, 'world-1');

    expect(effect).toMatchObject({
      id: 'effect-1',
      worldInstanceId: 'world-1',
      type: 'world.location.entered',
      attempts: 3,
      leaseToken: expect.any(String),
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('validates effect lease durations and returns no claim when the queue is empty', async () => {
    const store = new PostgresEventStore();
    for (const leaseMs of [0, -1, 1.5]) {
      await expect(store.claimNextEffect(leaseMs))
        .rejects.toThrow('Effect lease must be a positive integer.');
    }

    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                for: async () => [],
              }),
            }),
          }),
        }),
      })),
      update: vi.fn(),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await expect(store.claimNextEffect(1_000)).resolves.toBeUndefined();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('returns no effect when a pending row loses its lease before update', async () => {
    const pending = {
      id: 'effect-raced',
      worldInstanceId: 'world-1',
      sourceStreamId: 'character-1',
      causationCommandId: 'command-1',
      effectType: 'world.location.entered',
      effectVersion: 1,
      payload: { toLocationId: 'room-b' },
      attempts: 0,
    };
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                for: async () => [pending],
              }),
            }),
          }),
        }),
      })),
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      })),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await expect(new PostgresEventStore().claimNextEffect(5_000, 'world-1'))
      .resolves.toBeUndefined();
    expect(tx.update).toHaveBeenCalledOnce();
  });

  it('claims due object lifecycles with bounded leases and releases a claim', async () => {
    const now = new Date('2026-10-28T12:00:00.000Z');
    const rows = [
      { objectId: 'corpse-a', revision: 4 },
      { objectId: 'dropped-item-b', revision: 7 },
    ];
    const updates: Array<Record<string, unknown>> = [];
    const forUpdate = vi.fn(async () => rows);
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                for: forUpdate,
              }),
            }),
          }),
        }),
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      })),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const claims = await store.claimDueObjectLifecycles('world-1', now, 2, 5_000);

    expect(forUpdate).toHaveBeenCalledWith('update', { skipLocked: true });
    expect(claims).toHaveLength(2);
    expect(claims.map(({ objectId, revision }) => ({ objectId, revision }))).toEqual(rows);
    expect(new Set(claims.map(({ leaseToken }) => leaseToken)).size).toBe(2);
    expect(updates).toEqual(claims.map(({ leaseToken }) => ({
      leaseToken,
      leaseUntil: new Date(now.getTime() + 5_000),
    })));

    const where = vi.fn(async () => undefined);
    const set = vi.fn(() => ({ where }));
    mockDb.update.mockReturnValue({ set });
    await store.releaseObjectLifecycleClaim('world-1', 'corpse-a', claims[0]!.leaseToken);
    expect(set).toHaveBeenCalledWith({ leaseToken: null, leaseUntil: null });
    expect(where).toHaveBeenCalledOnce();
  });

  it('validates lifecycle claim limits and returns no rows when nothing is due', async () => {
    const store = new PostgresEventStore();
    const now = new Date('2026-10-28T12:00:00.000Z');
    await expect(store.claimDueObjectLifecycles('world-1', now, 0))
      .rejects.toThrow('Lifecycle batch size must be positive.');
    await expect(store.claimDueObjectLifecycles('world-1', now, 1, 0))
      .rejects.toThrow('Lifecycle lease must be positive.');
    expect(mockDb.transaction).not.toHaveBeenCalled();

    const forUpdate = vi.fn(async () => []);
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                for: forUpdate,
              }),
            }),
          }),
        }),
      })),
      update: vi.fn(),
    };
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await expect(store.claimDueObjectLifecycles('world-1', now)).resolves.toEqual([]);
    expect(forUpdate).toHaveBeenCalledWith('update', { skipLocked: true });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('marks leased effects complete or dead only when the database returns a matched row', async () => {
    const store = new PostgresEventStore();
    mockUpdateReturning([{ id: 'effect-1' }]);
    await expect(store.completeEffect('effect-1', 'lease-a')).resolves.toBe(true);
    expect(mockDb.update.mock.results.at(-1)?.value.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', leaseToken: null, lockedUntil: null }),
    );

    mockUpdateReturning([]);
    await expect(store.deadLetterEffect('effect-1', 'stale-lease', 'permanent failure')).resolves.toBe(false);
    expect(mockDb.update.mock.results.at(-1)?.value.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dead', leaseToken: null, lastError: 'permanent failure' }),
    );
  });

  it('requeues retryable effects, truncates stored errors, and rejects negative delays', async () => {
    const store = new PostgresEventStore();
    const { set } = mockUpdateReturning([{ id: 'effect-1' }]);
    await expect(store.retryEffect('effect-1', 'lease-a', 250, 'x'.repeat(600))).resolves.toBe(true);

    const update = set.mock.calls[0]?.[0] as { status: string; leaseToken: null; lastError: string };
    expect(update.status).toBe('pending');
    expect(update.leaseToken).toBeNull();
    expect(update.lastError).toHaveLength(500);
    await expect(store.retryEffect('effect-1', 'lease-a', -1, 'invalid'))
      .rejects.toThrow('Effect retry delay must be non-negative.');
  });
});
