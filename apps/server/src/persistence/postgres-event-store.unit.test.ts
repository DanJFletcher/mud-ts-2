import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppendRequest } from '@mudd/engine-core';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
    update: vi.fn(),
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
          return { returning: () => ({ values }) };
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
