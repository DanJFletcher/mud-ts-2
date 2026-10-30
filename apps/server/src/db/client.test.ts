import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  poolOptions: undefined as unknown,
  listenerOptions: undefined as unknown,
  pool: undefined as unknown,
  connectionHandler: undefined as ((client: Record<string, unknown>) => void) | undefined,
  errorHandler: undefined as ((error: Error) => void) | undefined,
  connectFailures: 0,
  clients: [] as Array<{ release: ReturnType<typeof vi.fn> }>,
  queryMode: 'promise' as 'promise' | 'sync',
  clientQuery: vi.fn(),
  drizzle: vi.fn(() => ({ database: true })),
  databaseMeasurementContext: vi.fn(() => ({ measurements: { traceId: 'trace-id' } })),
  recordDatabaseConnectionOpened: vi.fn(),
  recordDatabasePoolWait: vi.fn(),
  recordDatabaseQueryStart: vi.fn(),
  recordDatabaseQueryFinish: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class MockClient {
    constructor(options: unknown) {
      databaseMocks.listenerOptions = options;
    }
  },
  Pool: class MockPool {
    constructor(options: unknown) {
      databaseMocks.poolOptions = options;
      databaseMocks.pool = this;
    }

    on(event: string, listener: (value: never) => void) {
      if (event === 'connect') databaseMocks.connectionHandler = listener;
      if (event === 'error') databaseMocks.errorHandler = listener;
      return this;
    }

    connect(callback?: (error: Error | null, client?: unknown, release?: () => void) => void) {
      if (databaseMocks.connectFailures > 0) {
        databaseMocks.connectFailures -= 1;
        return Promise.reject(new Error('database unavailable'));
      }
      const client = {
        query: (...args: unknown[]) => databaseMocks.clientQuery(...args),
        release: vi.fn(),
      };
      databaseMocks.clients.push(client);
      databaseMocks.connectionHandler?.(client);
      if (callback) {
        callback(null, client, () => undefined);
        return;
      }
      return Promise.resolve(client);
    }
  },
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: databaseMocks.drizzle,
}));

vi.mock('../performance.js', () => ({
  databaseMeasurementContext: databaseMocks.databaseMeasurementContext,
  recordDatabaseConnectionOpened: databaseMocks.recordDatabaseConnectionOpened,
  recordDatabasePoolWait: databaseMocks.recordDatabasePoolWait,
  recordDatabaseQueryStart: databaseMocks.recordDatabaseQueryStart,
  recordDatabaseQueryFinish: databaseMocks.recordDatabaseQueryFinish,
  recordDatabaseQueryError: vi.fn(),
  recordDatabaseQuery: vi.fn(),
}));

vi.mock('./schema.js', () => ({}));

const originalDatabaseUrl = process.env.DATABASE_URL;

describe('database client setup and query instrumentation', () => {
  beforeEach(() => {
    vi.resetModules();
    databaseMocks.poolOptions = undefined;
    databaseMocks.listenerOptions = undefined;
    databaseMocks.pool = undefined;
    databaseMocks.connectionHandler = undefined;
    databaseMocks.errorHandler = undefined;
    databaseMocks.connectFailures = 0;
    databaseMocks.clients.length = 0;
    databaseMocks.queryMode = 'promise';
    databaseMocks.clientQuery.mockReset();
    databaseMocks.drizzle.mockClear();
    databaseMocks.databaseMeasurementContext.mockReset()
      .mockReturnValue({ measurements: { traceId: 'trace-id' } });
    databaseMocks.recordDatabaseConnectionOpened.mockClear();
    databaseMocks.recordDatabasePoolWait.mockClear();
    databaseMocks.recordDatabaseQueryStart.mockClear();
    databaseMocks.recordDatabaseQueryFinish.mockClear();
    process.env.DATABASE_URL = 'postgres://unit-test.invalid/mudd';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('requires a connection string before constructing a pool', async () => {
    delete process.env.DATABASE_URL;

    await expect(import('./client.js'))
      .rejects.toThrow('DATABASE_URL is required to run the MUDD server.');
    expect(databaseMocks.poolOptions).toBeUndefined();
  });

  it('instruments promise and callback pool connections and query result forms', async () => {
    databaseMocks.clientQuery.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        callback(null, { rows: [] });
        return { callbackResult: true };
      }
      return databaseMocks.queryMode === 'sync'
        ? { syncResult: true }
        : Promise.resolve({ rows: [] });
    });

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { pool, db } = await import('./client.js');
    expect(databaseMocks.poolOptions).toEqual({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      min: 2,
      idleTimeoutMillis: 300_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
    });
    expect(db).toBe(databaseMocks.drizzle.mock.results[0]?.value);

    const promiseClient = await pool.connect();
    await promiseClient.query('SELECT 1');
    await promiseClient.query({ text: ' SELECT 2 ' });
    databaseMocks.queryMode = 'sync';
    expect(promiseClient.query({ text: '' })).toEqual({ syncResult: true });
    expect(promiseClient.query('SELECT callback', () => undefined)).toEqual({ callbackResult: true });

    const callbackClient = await new Promise<{ query: (...args: unknown[]) => unknown }>((resolve, reject) => {
      pool.connect((error, client) => {
        if (error) reject(error);
        else resolve(client as { query: (...args: unknown[]) => unknown });
      });
    });
    expect(callbackClient.query('SELECT callback connection', () => undefined))
      .toEqual({ callbackResult: true });

    databaseMocks.databaseMeasurementContext.mockReturnValue({ measurements: undefined });
    await promiseClient.query('SELECT without trace');

    expect(databaseMocks.recordDatabasePoolWait).toHaveBeenCalledTimes(2);
    expect(databaseMocks.recordDatabaseQueryStart).toHaveBeenCalledTimes(6);
    expect(databaseMocks.recordDatabaseQueryFinish).toHaveBeenCalledTimes(6);
    expect(databaseMocks.recordDatabaseQueryFinish).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Number),
      expect.any(String),
    );
    expect(databaseMocks.recordDatabaseQueryFinish).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Number),
      undefined,
    );
    expect(databaseMocks.recordDatabaseConnectionOpened).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"event":"database_connection_opened"'));
    info.mockRestore();
  });

  it('warms the minimum connections, survives idle client errors, and opens listeners outside the pool', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { warmDatabasePool, createListenerClient } = await import('./client.js');

      await warmDatabasePool();
      expect(databaseMocks.clients).toHaveLength(2);
      for (const client of databaseMocks.clients) expect(client.release).toHaveBeenCalledOnce();

      databaseMocks.connectFailures = 1;
      await expect(warmDatabasePool()).rejects.toThrow('database unavailable');
      expect(databaseMocks.clients).toHaveLength(3);
      expect(databaseMocks.clients[2]!.release).toHaveBeenCalledOnce();

      databaseMocks.errorHandler?.(Object.assign(new Error('terminating connection'), { code: '57P01' }));
      expect(errorLog).toHaveBeenCalledWith(JSON.stringify({
        event: 'database_idle_client_error',
        errorName: 'Error',
        code: '57P01',
      }));

      createListenerClient();
      expect(databaseMocks.listenerOptions).toEqual({
        connectionString: process.env.DATABASE_URL,
        keepAlive: true,
        keepAliveInitialDelayMillis: 30_000,
      });
    } finally {
      info.mockRestore();
      errorLog.mockRestore();
    }
  });
});
