import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../db/client.js', () => ({ db: mockDb }));

import { postgresEffectRepository } from './postgres-effect-repository.js';

describe('PostgreSQL effect repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims effects with the command actor prefix and requested effect types', async () => {
    const dialect = drizzle.mock();
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const claimedRow = {
      id: 'effect-1',
      worldInstanceId: 'world-1',
      sourceStreamId: 'character-1',
      causationCommandId: 'command-1',
      effectType: 'world-item.claim',
      effectVersion: 1,
      payload: { itemId: 'item-1' },
      attempts: 2,
    };
    mockDb.select.mockImplementationOnce((fields: never) => dialect.select(fields));
    mockDb.update.mockImplementationOnce((table: never) => ({
      set: (values: never) => ({
        where: (condition: never) => ({
          returning: async () => {
            statements.push(dialect.update(table).set(values).where(condition).returning().toSQL());
            return [claimedRow];
          },
        }),
      }),
    }));

    const result = await postgresEffectRepository.claimCommandEffect(30_000, {
      worldInstanceId: 'world-1',
      actorId: 'player-1',
      commandId: 'command-1',
      types: ['world-item.claim'],
    });

    expect(result).toMatchObject({
      id: 'effect-1',
      type: 'world-item.claim',
      attempts: 2,
      leaseToken: expect.any(String),
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain('starts_with("durable_effects"."dedupe_key", $');
    expect(statements[0]!.params).toEqual(expect.arrayContaining([
      'command:world-1:player-1:command-1:',
      'world-item.claim',
    ]));
  });

  it('validates leases and skips empty command-effect type sets without querying', async () => {
    await expect(postgresEffectRepository.claimNextEffect(0))
      .rejects.toThrow('Effect lease must be a positive integer.');
    await expect(postgresEffectRepository.claimNextEffect(1_000, undefined, {
      types: ['world-item.claim'],
      graceMs: -1,
    })).rejects.toThrow('Effect reservation grace must be a non-negative integer.');
    await expect(postgresEffectRepository.claimCommandEffect(1_000, {
      worldInstanceId: 'world-1',
      actorId: 'player-1',
      commandId: 'command-1',
      types: [],
    })).resolves.toBeUndefined();

    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('settles leased effects and truncates retry/dead-letter errors', async () => {
    const setCalls: unknown[] = [];
    mockDb.update.mockImplementation(() => ({
      set: (values: unknown) => {
        setCalls.push(values);
        return {
          where: () => ({ returning: async () => [{ id: 'effect-1' }] }),
        };
      },
    }));

    await expect(postgresEffectRepository.completeEffect('effect-1', 'lease-a')).resolves.toBe(true);
    await expect(postgresEffectRepository.retryEffect('effect-1', 'lease-a', 250, 'x'.repeat(600)))
      .resolves.toBe(true);
    await expect(postgresEffectRepository.deadLetterEffect('effect-1', 'lease-a', 'permanent failure'))
      .resolves.toBe(true);
    await expect(postgresEffectRepository.retryEffect('effect-1', 'lease-a', -1, 'invalid'))
      .rejects.toThrow('Effect retry delay must be non-negative.');

    expect(setCalls[0]).toMatchObject({ status: 'completed', leaseToken: null, lockedUntil: null });
    expect(setCalls[1]).toMatchObject({ status: 'pending', leaseToken: null, lastError: 'x'.repeat(500) });
    expect(setCalls[2]).toMatchObject({ status: 'dead', leaseToken: null, lastError: 'permanent failure' });
    expect(mockDb.update).toHaveBeenCalledTimes(3);
  });
});
