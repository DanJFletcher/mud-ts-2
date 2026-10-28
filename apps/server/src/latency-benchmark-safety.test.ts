import { afterEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  db: {},
  pool: { end: vi.fn() },
}));

vi.mock('./db/client.js', () => database);
vi.mock('./persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class {},
  toStoredGameEvent: vi.fn(),
}));

describe('latency benchmark safety guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects a remote database before benchmark fixtures can be created', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://runner@production.example.com/mudd_test');
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '1');
    vi.resetModules();

    await expect(import('./latency-benchmark.js'))
      .rejects.toThrow('Benchmark requires an explicitly opted-in localhost *_test database.');

    expect(database.pool.end).not.toHaveBeenCalled();
  });

  it('requires the explicit local benchmark opt-in even for a local test database', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://runner@127.0.0.1:55439/mudd_latency_test');
    vi.stubEnv('MUDD_BENCHMARK_LOCAL', '0');
    vi.resetModules();

    await expect(import('./latency-benchmark.js'))
      .rejects.toThrow('Benchmark requires an explicitly opted-in localhost *_test database.');

    expect(database.pool.end).not.toHaveBeenCalled();
  });
});
