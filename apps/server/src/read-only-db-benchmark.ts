import { pathToFileURL } from 'node:url';

type BenchmarkConfig = {
  target: 'development' | 'production';
  samples: number;
};

type Timings = {
  poolAcquireMs: number;
  selectOneMs: number;
  indexedReadMs: number;
  totalMs: number;
};

export function readBenchmarkConfig(env: NodeJS.ProcessEnv): BenchmarkConfig {
  if (env.MUDD_DB_BENCHMARK !== '1') {
    throw new Error('Set MUDD_DB_BENCHMARK=1 to opt in to the read-only database benchmark.');
  }

  const target = env.MUDD_DB_BENCHMARK_TARGET;
  if (target !== 'development' && target !== 'production') {
    throw new Error('Set MUDD_DB_BENCHMARK_TARGET to development or production.');
  }
  if (target === 'production' && env.MUDD_DB_BENCHMARK_ALLOW_PRODUCTION !== '1') {
    throw new Error('Production benchmark requires MUDD_DB_BENCHMARK_ALLOW_PRODUCTION=1.');
  }
  if (env.NODE_ENV === 'production' && target !== 'production') {
    throw new Error('A production runtime cannot be labeled as a development benchmark.');
  }

  const samples = Number(env.MUDD_DB_BENCHMARK_SAMPLES ?? 30);
  if (!Number.isInteger(samples) || samples < 10 || samples > 30) {
    throw new Error('MUDD_DB_BENCHMARK_SAMPLES must be an integer from 10 to 30.');
  }

  return { target, samples };
}

export function summarizeReadOnlyDbBenchmark(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    n: sorted.length,
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1)!),
  };
}

export async function runReadOnlyDbBenchmark(config: BenchmarkConfig): Promise<void> {
  const { pool } = await import('./db/client.js');
  const timings: Timings[] = [];
  try {
    // This setup query selects only a public content-catalog primary key. Its
    // values are kept in memory and are never printed.
    const [catalog] = (await pool.query<{ pack_id: string; pack_version: string }>(
      `SELECT pack_id, pack_version
       FROM world_location_group_catalogs
       ORDER BY pack_id, pack_version
       LIMIT 1`,
    )).rows;
    if (!catalog) {
      throw new Error('No location-group catalog exists for the indexed-read measurement.');
    }

    const sample = async (): Promise<Timings> => {
      const totalStarted = performance.now();
      const acquireStarted = performance.now();
      const client = await pool.connect();
      const poolAcquireMs = performance.now() - acquireStarted;
      try {
        await client.query('BEGIN READ ONLY');
        const selectOneStarted = performance.now();
        await client.query('SELECT 1');
        const selectOneMs = performance.now() - selectOneStarted;

        const indexedReadStarted = performance.now();
        await client.query(
          `SELECT revision
           FROM world_location_group_catalogs
           WHERE pack_id = $1 AND pack_version = $2`,
          [catalog.pack_id, catalog.pack_version],
        );
        const indexedReadMs = performance.now() - indexedReadStarted;
        await client.query('COMMIT');
        return {
          poolAcquireMs,
          selectOneMs,
          indexedReadMs,
          totalMs: performance.now() - totalStarted,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };

    for (let warmup = 0; warmup < 5; warmup++) await sample();
    for (let index = 0; index < config.samples; index++) timings.push(await sample());

    console.log(JSON.stringify({
      event: 'mudd_read_only_db_benchmark',
      target: config.target,
      nodeVersion: process.version,
      warmupSamples: 5,
      samples: timings.length,
      measuredSelectsPerSample: 2,
      poolAcquireMs: summarizeReadOnlyDbBenchmark(timings.map((item) => item.poolAcquireMs)),
      selectOneMs: summarizeReadOnlyDbBenchmark(timings.map((item) => item.selectOneMs)),
      indexedReadMs: summarizeReadOnlyDbBenchmark(timings.map((item) => item.indexedReadMs)),
      sequentialTotalMs: summarizeReadOnlyDbBenchmark(timings.map((item) => item.totalMs)),
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
      dataWritten: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readBenchmarkConfig(process.env);
  await runReadOnlyDbBenchmark(config);
}
