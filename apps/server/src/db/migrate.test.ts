import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const migrationMocks = vi.hoisted(() => ({
  poolOptions: undefined as unknown,
  pool: undefined as { end: ReturnType<typeof vi.fn> } | undefined,
  drizzle: vi.fn(() => ({ database: true })),
  migrate: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    end = migrationMocks.pool?.end ?? vi.fn(async () => undefined);

    constructor(options: unknown) {
      migrationMocks.poolOptions = options;
      migrationMocks.pool = { end: this.end };
    }
  },
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: migrationMocks.drizzle,
}));

vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: migrationMocks.migrate,
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
const log = console.log;

describe('database migration runner', () => {
  beforeEach(() => {
    vi.resetModules();
    migrationMocks.poolOptions = undefined;
    migrationMocks.pool = undefined;
    migrationMocks.drizzle.mockClear();
    migrationMocks.migrate.mockReset().mockResolvedValue(undefined);
    process.env.DATABASE_URL = 'postgres://unit-test.invalid/mudd';
    console.log = vi.fn();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    console.log = log;
  });

  it('requires a connection string before creating a migration pool', async () => {
    delete process.env.DATABASE_URL;

    await expect(import('./migrate.js'))
      .rejects.toThrow('DATABASE_URL is required for PostgreSQL migrations.');
    expect(migrationMocks.poolOptions).toBeUndefined();
  });

  it('runs migrations and always closes its one-connection pool', async () => {
    await import('./migrate.js');

    expect(migrationMocks.poolOptions).toEqual({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    });
    expect(migrationMocks.drizzle).toHaveBeenCalledTimes(1);
    expect(migrationMocks.migrate).toHaveBeenCalledWith(
      { database: true },
      { migrationsFolder: expect.stringContaining('/apps/server/drizzle') },
    );
    expect(migrationMocks.pool?.end).toHaveBeenCalledTimes(1);
  });

  it('closes the pool when migration application fails', async () => {
    const error = new Error('Migration failed.');
    migrationMocks.migrate.mockRejectedValue(error);

    await expect(import('./migrate.js')).rejects.toBe(error);
    expect(migrationMocks.pool?.end).toHaveBeenCalledTimes(1);
  });
});
