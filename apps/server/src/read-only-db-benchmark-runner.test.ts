import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { database } = vi.hoisted(() => ({
  database: {
    pool: {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
      totalCount: 4,
      idleCount: 3,
      waitingCount: 0,
    },
    client: {
      query: vi.fn(),
      release: vi.fn(),
    },
  },
}));

vi.mock('./db/client.js', () => ({ pool: database.pool }));

import {
  runReadOnlyDbBenchmark,
  runReadOnlyDbBenchmarkCli,
} from './read-only-db-benchmark.js';

describe('read-only database benchmark runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs warmups and bounded read-only samples and reports only aggregate timings', async () => {
    database.pool.query.mockResolvedValue({
      rows: [{ pack_id: 'orraveth', pack_version: '1.0.0' }],
    });
    database.pool.connect.mockResolvedValue(database.client);
    database.client.query.mockResolvedValue({ rows: [] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const sourcePath = fileURLToPath(new URL('./read-only-db-benchmark.ts', import.meta.url));
    await runReadOnlyDbBenchmarkCli(
      sourcePath,
      pathToFileURL(sourcePath).href,
      {
        MUDD_DB_BENCHMARK: '1',
        MUDD_DB_BENCHMARK_TARGET: 'development',
        MUDD_DB_BENCHMARK_SAMPLES: '10',
      },
    );

    expect(database.pool.query).toHaveBeenCalledTimes(1);
    expect(database.pool.connect).toHaveBeenCalledTimes(15);
    expect(database.client.query).toHaveBeenCalledTimes(60);
    expect(database.client.query).toHaveBeenNthCalledWith(1, 'BEGIN READ ONLY');
    expect(database.client.query).toHaveBeenNthCalledWith(2, 'SELECT 1');
    expect(database.client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('SELECT revision'),
      ['orraveth', '1.0.0'],
    );
    expect(database.client.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(database.client.release).toHaveBeenCalledTimes(15);
    expect(database.pool.end).toHaveBeenCalledTimes(1);

    const report = JSON.parse(log.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(report).toMatchObject({
      event: 'mudd_read_only_db_benchmark',
      target: 'development',
      warmupSamples: 5,
      samples: 10,
      measuredSelectsPerSample: 2,
      dataWritten: false,
      pool: { total: 4, idle: 3, waiting: 0 },
    });
    expect(report).not.toHaveProperty('pack_id');
    log.mockRestore();
  });

  it('ends the pool and fails when no indexed-read catalog exists', async () => {
    database.pool.query.mockResolvedValue({ rows: [] });

    await expect(runReadOnlyDbBenchmark({ target: 'development', samples: 10 }))
      .rejects.toThrow('No location-group catalog exists for the indexed-read measurement.');

    expect(database.pool.connect).not.toHaveBeenCalled();
    expect(database.pool.end).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases a client when a measured query fails', async () => {
    database.pool.query.mockResolvedValue({
      rows: [{ pack_id: 'orraveth', pack_version: '1.0.0' }],
    });
    database.pool.connect.mockResolvedValue(database.client);
    database.client.query.mockImplementation(async (query: string) => {
      if (query === 'SELECT 1') throw new Error('read failed');
      if (query === 'ROLLBACK') throw new Error('rollback failed');
      return { rows: [] };
    });

    await expect(runReadOnlyDbBenchmark({ target: 'development', samples: 10 }))
      .rejects.toThrow('read failed');

    expect(database.client.query).toHaveBeenNthCalledWith(1, 'BEGIN READ ONLY');
    expect(database.client.query).toHaveBeenNthCalledWith(2, 'SELECT 1');
    expect(database.client.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(database.client.release).toHaveBeenCalledTimes(1);
    expect(database.pool.end).toHaveBeenCalledTimes(1);
  });
});
