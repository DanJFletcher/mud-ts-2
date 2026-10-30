import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AppendOutcome, AppendRequest } from '@mudd/engine-core';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock('../db/client.js', () => ({ db: mockDb }));

import {
  PostgresEventStore,
  resetSingleCallAppendRuntimeForTests,
  toStoredGameEvent,
} from './postgres-event-store.js';

function mockUpdateReturning(rows: unknown[]) {
  const returning = vi.fn(async () => rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  mockDb.update.mockReturnValue({ set });
  return { set, where, returning };
}

/** Render the effect claim with Drizzle's real SQL builder and return canned rows. */
function mockEffectClaim(rows: unknown[]) {
  const sqlBuilder = drizzle.mock();
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  mockDb.select.mockImplementationOnce((fields: never) => sqlBuilder.select(fields));
  mockDb.update.mockImplementationOnce((table: never) => ({
    set: (values: never) => ({
      where: (condition: never) => ({
        returning: async () => {
          statements.push(sqlBuilder.update(table).set(values).where(condition).returning().toSQL());
          return rows;
        },
      }),
    }),
  }));
  return { statements };
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
  activeSession?: boolean;
} = {}) {
  const persistedValues: unknown[] = [];
  const ctes: unknown[] = [];
  const upserts: Array<{ values: unknown; conflict: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown; condition: unknown }> = [];
  let insertIndex = 0;
  let selectIndex = 0;
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => {
      const index = selectIndex++;
      return {
        from: () => ({
          where: () => ({
            limit: async () => options.activeSession && index === 2 ? [{ id: 'session-1' }] : [],
            groupBy: async () => options.heads ?? [],
          }),
        }),
      };
    }),
    insert: vi.fn(() => {
      const index = insertIndex++;
      return {
        values: (values: unknown) => {
          persistedValues.push(values);
          if (index === options.failOnInsertIndex) throw new Error('durable effect insert failed');
          return {
            returning: () => ({ values }),
            onConflictDoUpdate: (conflict: unknown) => {
              upserts.push({ values, conflict });
              return Promise.resolve();
            },
            onConflictDoNothing: () => Promise.resolve(),
          };
        },
      };
    }),
    update: vi.fn((table: unknown) => ({
      set: (values: unknown) => ({
        where: (condition: unknown) => {
          updates.push({ table, values, condition });
          return Promise.resolve();
        },
      }),
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
          limit: async () => options.persistedCounts ?? [{ eventCount: 1, receiptCount: 1 }],
        }),
      }),
    })),
  };
  return { tx, persistedValues, ctes, upserts, updates };
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

  it('persists every object lifecycle transition with its new revision', async () => {
    const { tx, persistedValues, upserts, updates } = createAppendTransaction({
      persistedCounts: [{ eventCount: 5, receiptCount: 1 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const outcome = await new PostgresEventStore().append({
      worldInstanceId: 'world-1',
      streamId: 'world-object-lifecycle:corpse-1',
      actorId: 'system',
      commandId: 'lifecycle-transitions',
      payloadHash: 'lifecycle-payload',
      expectedVersion: 0,
      events: [
        {
          type: 'world.object_lifecycle_scheduled',
          version: 1,
          payload: {
            objectId: 'corpse-1',
            objectType: 'corpse',
            locationId: 'southbound-track',
            createdAt: '2026-10-28T12:00:00.000Z',
            expiresAt: '2026-10-28T12:01:00.000Z',
          },
        },
        {
          type: 'world.object_lifecycle_rescheduled',
          version: 1,
          payload: {
            objectId: 'corpse-1',
            objectType: 'corpse',
            locationId: 'southbound-track',
            expiresAt: '2026-10-28T12:02:00.000Z',
          },
        },
        {
          type: 'world.object_lifecycle_cancelled',
          version: 1,
          payload: {
            objectId: 'corpse-1',
            objectType: 'corpse',
            locationId: 'southbound-track',
          },
        },
        {
          type: 'world.object_expiring',
          version: 1,
          payload: {
            objectId: 'corpse-1',
            objectType: 'corpse',
            locationId: 'southbound-track',
            expiresAt: '2026-10-28T12:02:00.000Z',
          },
        },
        {
          type: 'world.object_expired',
          version: 1,
          payload: {
            objectId: 'corpse-1',
            objectType: 'corpse',
            locationId: 'southbound-track',
            expiredAt: '2026-10-28T12:02:00.000Z',
          },
        },
      ],
    });

    expect(outcome.kind).toBe('committed');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.values).toMatchObject({
      worldInstanceId: 'world-1',
      objectId: 'corpse-1',
      objectType: 'corpse',
      locationId: 'southbound-track',
      state: 'scheduled',
      revision: 1,
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
    });
    expect(upserts[0]?.conflict).toMatchObject({
      set: {
        objectType: 'corpse',
        locationId: 'southbound-track',
        state: 'scheduled',
        revision: 1,
        attempts: 0,
        leaseToken: null,
        leaseUntil: null,
      },
    });

    const updatedLifecycleStates = updates.map(({ values }) =>
      (values as { state: string; revision: number }).state);
    const updatedLifecycleRevisions = updates.map(({ values }) =>
      (values as { state: string; revision: number }).revision);
    expect(updatedLifecycleStates).toEqual(['scheduled', 'cancelled', 'expiring', 'expired']);
    expect(updatedLifecycleRevisions).toEqual([2, 3, 4, 5]);
    expect((updates[2]?.values as { attempts?: unknown }).attempts).toBeDefined();
    expect((updates[3]?.values as { locationId: string }).locationId).toBe('southbound-track');
    expect(persistedValues).toHaveLength(3);
  });

  it('updates character metadata for create, rename, archive, and restore events', async () => {
    const { tx, persistedValues, updates } = createAppendTransaction({
      persistedCounts: [{ eventCount: 4, receiptCount: 1 }],
    });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    const outcome = await new PostgresEventStore().append({
      worldInstanceId: 'world-1',
      streamId: 'character-1',
      actorId: 'player-1',
      commandId: 'character-lifecycle',
      payloadHash: 'character-lifecycle-payload',
      expectedVersion: 0,
      events: [
        {
          type: 'character.created',
          version: 1,
          payload: {
            characterId: 'character-1',
            playerId: 'player-1',
            name: 'Rowan',
            startingLocationId: 'market-square',
          },
        },
        {
          type: 'character.renamed',
          version: 1,
          payload: { characterId: 'character-1', name: 'Rowan Vale' },
        },
        {
          type: 'character.archived',
          version: 1,
          payload: { characterId: 'character-1' },
        },
        {
          type: 'character.restored',
          version: 1,
          payload: { characterId: 'character-1' },
        },
      ],
    });

    expect(outcome.kind).toBe('committed');
    expect(persistedValues[2]).toMatchObject({
      id: 'character-1',
      playerId: 'player-1',
      worldInstanceId: 'world-1',
      name: 'Rowan',
    });
    expect(updates.map(({ values }) => values)).toMatchObject([
      { name: 'Rowan Vale' },
      { archivedAt: expect.any(Date) },
      { archivedAt: null },
    ]);
    expect(tx.select).toHaveBeenCalledTimes(3);
  });

  it('rejects character archival while an active world session exists', async () => {
    const { tx } = createAppendTransaction({ activeSession: true });
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));

    await expect(new PostgresEventStore().append(basicAppendRequest({
      streamId: 'character-1',
      commandId: 'archive-active-character',
      events: [{
        type: 'character.archived',
        version: 1,
        payload: { characterId: 'character-1' },
      }],
    }))).rejects.toThrow('Leave the world before archiving this character.');

    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(tx.update).not.toHaveBeenCalled();
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
    mockDb.select.mockImplementationOnce(revisionsQuery)
      .mockImplementationOnce(historySelect([
        persistedEventRow('character-a', 'event-a', 1),
        persistedEventRow('character-b', 'event-b', 1),
      ]));
    const store = new PostgresEventStore();

    const empty = await store.readStreams('world-1', []);
    const streams = await store.readStreams('world-1', ['character-a', 'character-a', 'character-b']);

    expect(empty.size).toBe(0);
    expect(streams.size).toBe(2);
    expect(streams.get('character-a')?.map(({ eventId }) => eventId)).toEqual(['event-a']);
    expect(streams.get('character-b')?.map(({ eventId }) => eventId)).toEqual(['event-b']);
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it('reuses the command-scoped stream while bulk-reading other streams', async () => {
    const streamA = persistedEventRow('character-a', 'event-a', 1);
    const streamB = persistedEventRow('character-b', 'event-b', 1);
    mockDb.select
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([streamA]))
      .mockImplementationOnce(() => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [{ streamId: 'character-b', revision: 1 }],
          }),
        }),
      }))
      .mockImplementationOnce(historySelect([streamB]));
    const store = new PostgresEventStore();

    const result = await store.withCommandReadCache('world-1', 'character-a', async () => {
      await store.readStream('world-1', 'character-a');
      return store.readStreams('world-1', ['character-a', 'character-b', 'character-a']);
    }, 1);

    expect(result.get('character-a')?.map(({ eventId }) => eventId)).toEqual(['event-a']);
    expect(result.get('character-b')?.map(({ eventId }) => eventId)).toEqual(['event-b']);
    expect(mockDb.select).toHaveBeenCalledTimes(4);
  });

  it('populates the scoped cache when bulk reads include its stream before a snapshot exists', async () => {
    const streamA = persistedEventRow('character-a', 'event-a', 1);
    const streamB = persistedEventRow('character-b', 'event-b', 1);
    mockDb.select
      .mockImplementationOnce(() => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [
              { streamId: 'character-a', revision: 1 },
              { streamId: 'character-b', revision: 1 },
            ],
          }),
        }),
      }))
      .mockImplementationOnce(historySelect([streamA, streamB]));
    const store = new PostgresEventStore();

    const result = await store.withCommandReadCache('world-1', 'character-a', async () => {
      const streams = await store.readStreams('world-1', ['character-a', 'character-b']);
      const scopedRead = await store.readStream('world-1', 'character-a');
      return { streams, scopedRead };
    }, 1);

    expect(result.streams.get('character-a')?.map(({ eventId }) => eventId)).toEqual(['event-a']);
    expect(result.scopedRead.map(({ eventId }) => eventId)).toEqual(['event-a']);
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it('bypasses an empty command scope and can temporarily exit a populated scope', async () => {
    const store = new PostgresEventStore();
    expect(store.withCommandReadCache('world-1', '', () => 'without-scope')).toBe('without-scope');

    const row = persistedEventRow('character-a', 'event-a', 1);
    mockDb.select
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([row]))
      .mockImplementationOnce(revisionSelect(1));

    const result = await store.withCommandReadCache('world-1', 'character-a', async () => {
      const scoped = await store.readStream('world-1', 'character-a');
      const unscoped = await store.withoutCommandReadCache(() =>
        store.readStream('world-1', 'character-a'));
      const restoredScope = await store.readStream('world-1', 'character-a');
      return { scoped, unscoped, restoredScope };
    }, 1);

    expect(result.scoped).toEqual(result.unscoped);
    expect(result.scoped).toEqual(result.restoredScope);
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });

  it('drops oversized streams and evicts cached streams at the byte and entry limits', () => {
    type CacheInternals = {
      cacheStream(key: string, events: readonly unknown[], knownBytes?: number): void;
      streamCache: Map<string, { bytes: number }>;
      cachedStreamBytes: number;
    };
    const oversizeStore = new PostgresEventStore() as unknown as CacheInternals;
    const maxStreamBytes = 8 * 1024 * 1024;
    oversizeStore.cacheStream('world-1\u0000oversized', [], 10);
    oversizeStore.cacheStream('world-1\u0000oversized', [], maxStreamBytes + 1);
    oversizeStore.cacheStream('world-1\u0000never-cached', [], maxStreamBytes + 1);
    expect(oversizeStore.streamCache.has('world-1\u0000oversized')).toBe(false);
    expect(oversizeStore.streamCache.has('world-1\u0000never-cached')).toBe(false);
    expect(oversizeStore.cachedStreamBytes).toBe(0);

    const byteLimited = new PostgresEventStore() as unknown as CacheInternals;
    const bytesPerStream = 1024 * 1024;
    for (let index = 0; index < 32; index += 1) {
      byteLimited.cacheStream(`world-1\u0000byte-${index}`, [], bytesPerStream);
    }
    byteLimited.cacheStream('world-1\u0000byte-final', [], bytesPerStream);
    expect(byteLimited.streamCache.has('world-1\u0000byte-0')).toBe(false);
    expect(byteLimited.streamCache.size).toBe(32);
    expect(byteLimited.cachedStreamBytes).toBe(32 * bytesPerStream);

    const entryLimited = new PostgresEventStore() as unknown as CacheInternals;
    for (let index = 0; index < 128; index += 1) {
      entryLimited.cacheStream(`world-1\u0000entry-${index}`, [], 0);
    }
    entryLimited.cacheStream('world-1\u0000entry-final', [], 0);
    expect(entryLimited.streamCache.has('world-1\u0000entry-0')).toBe(false);
    expect(entryLimited.streamCache.size).toBe(128);
  });

  it('discards a cached stream whose revision differs from the append base', async () => {
    const streamId = 'revision-mismatch-stream';
    const staleCachedEvent = persistedEventRow(streamId, 'stale-cached-event', 1);
    const persistedEvent = persistedEventRow(streamId, 'persisted-after-append', 1);
    mockDb.select
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([staleCachedEvent]))
      .mockImplementationOnce(revisionSelect(1))
      .mockImplementationOnce(historySelect([persistedEvent]));
    const { tx } = createAppendTransaction();
    mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
    const store = new PostgresEventStore();

    const before = await store.readStream('world-1', streamId);
    const outcome = await store.append(basicAppendRequest({
      streamId,
      commandId: 'revision-mismatch-append',
      expectedVersion: 0,
    }));
    const after = await store.readStream('world-1', streamId);

    expect(before.map(({ eventId }) => eventId)).toEqual(['stale-cached-event']);
    expect(outcome.kind).toBe('committed');
    expect(after.map(({ eventId }) => eventId)).toEqual(['persisted-after-append']);
    expect(mockDb.select).toHaveBeenCalledTimes(4);
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

  it('leases the next due durable effect in one locking statement', async () => {
    const claimedRow = {
      id: 'effect-1',
      worldInstanceId: 'world-1',
      sourceStreamId: 'character-1',
      causationCommandId: 'command-1',
      effectType: 'world.location.entered',
      effectVersion: 1,
      payload: { toLocationId: 'room-b' },
      attempts: 3,
    };
    const claim = mockEffectClaim([claimedRow]);
    const store = new PostgresEventStore();

    const effect = await store.claimNextEffect(30_000, 'world-1');

    expect(effect).toMatchObject({
      id: 'effect-1',
      worldInstanceId: 'world-1',
      type: 'world.location.entered',
      attempts: 3,
      leaseToken: expect.any(String),
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(claim.statements).toHaveLength(1);
    const [statement] = claim.statements;
    expect(statement!.sql).toMatch(/^update "durable_effects" set /);
    expect(statement!.sql).toContain('"attempts" = "durable_effects"."attempts" + 1');
    expect(statement!.sql).toMatch(/where "durable_effects"\."id" = \(select .* limit \$\d+ for update skip locked\) returning /);
    // Due times and leases use the database clock that wrote available_at.
    expect(statement!.sql).toContain('"durable_effects"."available_at" <= now()');
    expect(statement!.sql).toContain('"locked_until" = now() + (');
    expect(statement!.params).toEqual(expect.arrayContaining(['processing', 'pending', 'world-1', effect!.leaseToken]));
  });

  it('validates effect lease durations and returns no claim when nothing is due', async () => {
    const store = new PostgresEventStore();
    for (const leaseMs of [0, -1, 1.5]) {
      await expect(store.claimNextEffect(leaseMs))
        .rejects.toThrow('Effect lease must be a positive integer.');
    }
    expect(mockDb.update).not.toHaveBeenCalled();

    const claim = mockEffectClaim([]);
    await expect(store.claimNextEffect(1_000)).resolves.toBeUndefined();
    expect(claim.statements).toHaveLength(1);
    expect(claim.statements[0]!.sql).not.toContain('"world_instance_id" =');
  });

  it('leases a due effect only from one actor’s command and the given effect types', async () => {
    const claim = mockEffectClaim([{
      id: 'effect-2',
      worldInstanceId: 'world-1',
      sourceStreamId: 'world-items',
      causationCommandId: 'command-1',
      effectType: 'world-item.claim',
      effectVersion: 1,
      payload: { worldItemId: 'item-1' },
      attempts: 1,
    }]);
    const store = new PostgresEventStore();
    const scope = {
      worldInstanceId: 'world-1',
      actorId: 'player-1',
      commandId: 'command-1',
      types: ['world-item.claim', 'world-item.drop'],
    };

    const effect = await store.claimCommandEffect(30_000, scope);

    expect(effect).toMatchObject({
      id: 'effect-2',
      causationCommandId: 'command-1',
      type: 'world-item.claim',
      leaseToken: expect.any(String),
    });
    expect(claim.statements).toHaveLength(1);
    const [statement] = claim.statements;
    expect(statement!.sql).toContain('"causation_command_id" = $');
    expect(statement!.sql).toContain('starts_with("durable_effects"."dedupe_key", $');
    expect(statement!.sql).toContain('"effect_type" in ($');
    expect(statement!.sql).toMatch(/limit \$\d+ for update skip locked\) returning /);
    expect(statement!.params).toEqual(expect.arrayContaining([
      'world-1',
      'command-1',
      'command:world-1:player-1:command-1:',
      'world-item.claim',
      'world-item.drop',
      'pending',
    ]));

    await expect(store.claimCommandEffect(30_000, { ...scope, types: [] })).resolves.toBeUndefined();
    await expect(store.claimCommandEffect(0, scope)).rejects.toThrow('Effect lease must be a positive integer.');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
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

describe('PostgresEventStore single-call append', () => {
  const dialect = new PgDialect();
  const sharedRequest: AppendRequest = {
    worldInstanceId: 'world-1',
    streamId: 'world-items:world-1',
    actorId: 'actor-1',
    commandId: 'command-1',
    payloadHash: 'hash-1',
    expectedVersion: 4,
    events: [{ type: 'world.item_dropped', version: 1, payload: { itemId: 'item-1' } }],
    companions: [{
      streamId: 'world-npc:guard',
      expectedVersion: 2,
      events: [{ type: 'npc.noticed', version: 1, payload: { itemId: 'item-1' } }],
    }],
    guards: [{ streamId: 'world-team-combat', expectedVersion: 7 }],
    effects: [{ type: 'world.item.announce', version: 1, payload: { itemId: 'item-1' } }],
  };

  function respondWith(row: Record<string, unknown>) {
    mockDb.execute.mockResolvedValueOnce({ rows: [{
      prior_stream_id: null, prior_payload_hash: null, prior_receipt: null,
      prior_events: null, current_revision: null, ...row,
    }] });
  }

  function executed(call = 1) {
    const query = dialect.sqlToQuery(mockDb.execute.mock.calls[call]![0]);
    return { sql: query.sql, request: JSON.parse(String(query.params[0])) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockReset();
    resetSingleCallAppendRuntimeForTests();
    mockDb.execute.mockResolvedValueOnce({ rows: [{
      function_exists: true,
      transaction_isolation: 'read committed',
    }] });
    mockDb.transaction.mockRejectedValue(new Error('transaction path'));
  });

  it('keeps the transaction path unless the single call is enabled', async () => {
    await expect(new PostgresEventStore({ singleCallAppend: false }).append(sharedRequest))
      .rejects.toThrow('transaction path');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('commits in one call with the transaction path rows, lock set and effect keys', async () => {
    respondWith({ outcome: 'committed', current_revision: 4 });
    const store = new PostgresEventStore({ singleCallAppend: true });

    const outcome = await store.append(sharedRequest);

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ kind: 'committed', streamId: 'world-items:world-1' });
    expect(outcome.events).toEqual([expect.objectContaining({
      type: 'world.item_dropped', aggregateVersion: 5, tick: 5, actorId: 'actor-1', causationCommandId: 'command-1',
    })]);
    expect(outcome.receipt).toEqual({
      ok: true, commandId: 'command-1', eventIds: [outcome.events[0]!.eventId], newAggregateVersion: 5,
    });

    const { sql: statement, request } = executed();
    expect(statement).toBe('SELECT * FROM mudd_append_command_v1($1::jsonb)');
    expect(request.lockStreamIds.sort()).toEqual(['world-items:world-1', 'world-npc:guard', 'world-team-combat']);
    expect(request.checks).toEqual([
      { streamId: 'world-npc:guard', expectedVersion: 2 },
      { streamId: 'world-team-combat', expectedVersion: 7 },
    ]);
    expect(request.events.map((event: { stream_id: string; stream_version: number }) =>
      [event.stream_id, event.stream_version])).toEqual([['world-npc:guard', 3], ['world-items:world-1', 5]]);
    expect(request.receipt).toEqual(outcome.receipt);
    expect(request.receiptEvents).toEqual(outcome.events);
    expect(request.effects).toEqual([expect.objectContaining({
      effect_type: 'world.item.announce', dedupe_key: 'command:world-1:actor-1:command-1:0',
    })]);
    expect(request.roomStates).toEqual([]);
  });

  it('maps prior receipts and revision conflicts to the transaction path outcomes', async () => {
    const store = new PostgresEventStore({ singleCallAppend: true });
    const priorReceipt = { ok: true, commandId: 'command-1', eventIds: ['event-1'], newAggregateVersion: 5 };
    respondWith({ outcome: 'prior', prior_stream_id: 'world-items:world-1', prior_payload_hash: 'hash-1',
      prior_receipt: priorReceipt, prior_events: [{ eventId: 'event-1' }] });
    respondWith({ outcome: 'prior', prior_stream_id: 'world-items:world-1', prior_payload_hash: 'other-hash',
      prior_receipt: priorReceipt, prior_events: [] });
    respondWith({ outcome: 'guard_conflict', current_revision: 8 });
    respondWith({ outcome: 'version_conflict', current_revision: 6 });

    expect(await store.append(sharedRequest)).toEqual({
      kind: 'duplicate', streamId: 'world-items:world-1', events: [{ eventId: 'event-1' }], receipt: priorReceipt,
    });
    expect(await store.append(sharedRequest)).toMatchObject({
      kind: 'conflict', receipt: { code: 'INVALID_COMMAND', message: 'Command ID was already used with a different payload.' },
    });
    expect(await store.append(sharedRequest)).toMatchObject({
      kind: 'conflict', events: [], receipt: { code: 'VERSION_CONFLICT', message: 'An observed stream changed. Refresh and try again.' },
    });
    expect(await store.append(sharedRequest)).toMatchObject({
      kind: 'conflict', events: [], receipt: { code: 'VERSION_CONFLICT', message: 'Expected revision 4; current revision is 6.', retryable: true },
    });
    mockDb.execute.mockResolvedValueOnce({ rows: [] });
    await expect(store.append(sharedRequest)).rejects.toThrow('Command append returned no recognizable outcome.');
  });

  it('sends the character room state computed from the cached history', async () => {
    const characterId = '123e4567-e89b-42d3-a456-426614174000';
    const store = new PostgresEventStore({ singleCallAppend: true });
    const created = toStoredGameEvent({
      type: 'character.created', contractVersion: 1,
      payload: { characterId, playerId: 'player-1', name: 'Rowan', startingLocationId: 'room-a' },
      eventId: 'event-created', worldInstanceId: 'world-1', streamId: characterId, streamVersion: 1,
      causationCommandId: 'create-command', actorId: 'player-1', occurredAt: new Date('2026-10-28T12:00:00.000Z'), tick: 1,
    } as Parameters<typeof toStoredGameEvent>[0]);
    (store as unknown as { cacheStream(key: string, events: readonly unknown[]): void })
      .cacheStream(`world-1\u0000${characterId}`, [created]);
    respondWith({ outcome: 'committed', current_revision: 1 });

    const outcome = await store.append({
      worldInstanceId: 'world-1', streamId: characterId, actorId: 'player-1', commandId: 'take-1',
      payloadHash: 'hash-take', expectedVersion: 1,
      events: [{ type: 'character.item_taken', version: 1, payload: {
        characterId, locationId: 'room-a', item: { id: 'item-1', label: 'Stone', description: 'A stone.' },
      } }],
    });

    expect(outcome.kind).toBe('committed');
    expect(executed().request.roomStates).toEqual([{
      character_id: characterId, location_id: 'room-a', revision: 2,
      state: { characterId, worldInstanceId: 'world-1', locationId: 'room-a', name: 'Rowan', archived: false },
    }]);
    expect((store as unknown as { streamCache: Map<string, { revision: number }> })
      .streamCache.get(`world-1\u0000${characterId}`)?.revision).toBe(2);
  });

  it('falls back for side-table events, uncached character streams and malformed batches', async () => {
    const store = new PostgresEventStore({ singleCallAppend: true });
    const characterId = '123e4567-e89b-42d3-a456-426614174001';
    for (const request of [
      { ...sharedRequest, events: [{ type: 'character.renamed', version: 1, payload: { characterId, name: 'New' } }] },
      { ...sharedRequest, companions: [{ streamId: 'lifecycle', expectedVersion: 0,
        events: [{ type: 'world.object_lifecycle_scheduled', version: 1, payload: {} }] }] },
      { ...sharedRequest, streamId: characterId, companions: [] },
      { ...sharedRequest, companions: [{ streamId: sharedRequest.streamId, expectedVersion: 4, events: sharedRequest.events }] },
      { ...sharedRequest, events: [] },
    ] satisfies AppendRequest[]) {
      await expect(store.append(request)).rejects.toThrow('transaction path');
    }
    expect(mockDb.execute).toHaveBeenCalledOnce();
    expect(mockDb.transaction).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['missing function', { function_exists: false, transaction_isolation: 'read committed' }, 'missing_function'],
    ['non-read-committed isolation', { function_exists: true, transaction_isolation: 'repeatable read' }, 'isolation'],
  ] as const)('uses the transaction path when readiness reports %s', async (_label, readiness, reason) => {
    mockDb.execute.mockReset();
    mockDb.execute.mockResolvedValueOnce({ rows: [readiness] });
    const store = new PostgresEventStore({ singleCallAppend: true });
    const appendInTransaction = vi.spyOn(
      store as unknown as { appendInTransaction(request: AppendRequest): Promise<AppendOutcome> },
      'appendInTransaction',
    ).mockResolvedValue({
      kind: 'conflict',
      streamId: sharedRequest.streamId,
      events: [],
      receipt: {
        ok: false,
        commandId: sharedRequest.commandId,
        code: 'VERSION_CONFLICT',
        message: 'fallback',
        retryable: true,
      },
    });
    const nextStore = new PostgresEventStore({ singleCallAppend: true });
    const nextStoreAppend = vi.spyOn(
      nextStore as unknown as { appendInTransaction(request: AppendRequest): Promise<AppendOutcome> },
      'appendInTransaction',
    ).mockResolvedValue({
      kind: 'conflict',
      streamId: sharedRequest.streamId,
      events: [],
      receipt: {
        ok: false,
        commandId: sharedRequest.commandId,
        code: 'VERSION_CONFLICT',
        message: 'fallback',
        retryable: true,
      },
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await store.append(sharedRequest);
    await nextStore.append(sharedRequest);

    expect(appendInTransaction).toHaveBeenCalledOnce();
    expect(nextStoreAppend).toHaveBeenCalledOnce();
    expect(mockDb.execute).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[0]).toContain(`"reason":"${reason}"`);
    warning.mockRestore();
  });

  it.each([
    ['missing function', '42883'],
    ['isolation guard', 'MU001'],
  ] as const)('falls back and disables the fast path after a %s error', async (_label, code) => {
    const store = new PostgresEventStore({ singleCallAppend: true });
    const appendInTransaction = vi.spyOn(
      store as unknown as { appendInTransaction(request: AppendRequest): Promise<AppendOutcome> },
      'appendInTransaction',
    ).mockResolvedValue({
      kind: 'conflict',
      streamId: sharedRequest.streamId,
      events: [],
      receipt: {
        ok: false,
        commandId: sharedRequest.commandId,
        code: 'VERSION_CONFLICT',
        message: 'fallback',
        retryable: true,
      },
    });
    const nextStore = new PostgresEventStore({ singleCallAppend: true });
    const nextStoreAppend = vi.spyOn(
      nextStore as unknown as { appendInTransaction(request: AppendRequest): Promise<AppendOutcome> },
      'appendInTransaction',
    ).mockResolvedValue({
      kind: 'conflict',
      streamId: sharedRequest.streamId,
      events: [],
      receipt: {
        ok: false,
        commandId: sharedRequest.commandId,
        code: 'VERSION_CONFLICT',
        message: 'fallback',
        retryable: true,
      },
    });
    mockDb.execute.mockRejectedValueOnce(Object.assign(new Error('sensitive query and parameters'), { code }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const first = await store.append(sharedRequest);
    const second = await nextStore.append(sharedRequest);

    expect(first).toMatchObject({ kind: 'conflict', receipt: { message: 'fallback' } });
    expect(second).toMatchObject({ kind: 'conflict', receipt: { message: 'fallback' } });
    expect(appendInTransaction).toHaveBeenCalledOnce();
    expect(nextStoreAppend).toHaveBeenCalledOnce();
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledOnce();
    expect(String(warning.mock.calls[0]?.[0])).not.toContain('sensitive');
    warning.mockRestore();
  });

  it('rethrows unrelated fast-path errors without entering the transaction path', async () => {
    const store = new PostgresEventStore({ singleCallAppend: true });
    const appendInTransaction = vi.spyOn(
      store as unknown as { appendInTransaction(request: AppendRequest): Promise<AppendOutcome> },
      'appendInTransaction',
    );
    const error = Object.assign(new Error('unique violation'), { code: '23505' });
    mockDb.execute.mockRejectedValueOnce(error);

    await expect(store.append(sharedRequest)).rejects.toBe(error);
    expect(appendInTransaction).not.toHaveBeenCalled();
  });
});
