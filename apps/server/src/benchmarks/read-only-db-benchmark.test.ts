import { describe, expect, it } from 'vitest';
import {
  readBenchmarkConfig,
  summarizeReadOnlyDbBenchmark,
} from './read-only-db-benchmark.js';

describe('read-only database benchmark safeguards', () => {
  it('requires explicit opt-in and an explicit environment', () => {
    expect(() => readBenchmarkConfig({})).toThrow('Set MUDD_DB_BENCHMARK=1');
    expect(() => readBenchmarkConfig({ MUDD_DB_BENCHMARK: '1' }))
      .toThrow('MUDD_DB_BENCHMARK_TARGET');
  });

  it('requires a separate confirmation before production reads', () => {
    expect(() => readBenchmarkConfig({
      MUDD_DB_BENCHMARK: '1',
      MUDD_DB_BENCHMARK_TARGET: 'production',
    })).toThrow('MUDD_DB_BENCHMARK_ALLOW_PRODUCTION=1');
  });

  it('rejects mislabeled production execution and unbounded sample counts', () => {
    expect(() => readBenchmarkConfig({
      MUDD_DB_BENCHMARK: '1',
      MUDD_DB_BENCHMARK_TARGET: 'development',
      NODE_ENV: 'production',
    })).toThrow('cannot be labeled as a development benchmark');
    expect(() => readBenchmarkConfig({
      MUDD_DB_BENCHMARK: '1',
      MUDD_DB_BENCHMARK_TARGET: 'development',
      MUDD_DB_BENCHMARK_SAMPLES: '31',
    })).toThrow('from 10 to 30');
    expect(readBenchmarkConfig({
      MUDD_DB_BENCHMARK: '1',
      MUDD_DB_BENCHMARK_TARGET: 'development',
    })).toEqual({ target: 'development', samples: 30 });
  });

  it('summarizes bounded samples with nearest-rank percentiles', () => {
    expect(summarizeReadOnlyDbBenchmark([1, 2, 3, 4, 5])).toEqual({
      n: 5,
      p50Ms: 3,
      p95Ms: 5,
      maxMs: 5,
    });
  });
});
