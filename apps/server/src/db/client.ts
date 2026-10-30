import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import * as schema from './schema.js';
import {
  databaseMeasurementContext,
  recordDatabaseConnectionOpened,
  recordDatabasePoolWait,
  recordDatabaseQueryFinish,
  recordDatabaseQueryStart,
} from '../performance.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to run the MUDD server.');

// Production reaches PostgreSQL over a high-latency network, where a new
// connection costs several round trips (TCP, TLS, startup and SCRAM). Keep
// connections warm across player think time instead of pg's 10 s idle default,
// detect dropped connections with TCP keepalive, and fail a stalled connect
// rather than waiting indefinitely.
const MIN_POOL_CONNECTIONS = 2;
const keepAlive = { keepAlive: true, keepAliveInitialDelayMillis: 30_000 };
export const pool = new Pool({
  connectionString,
  max: 10,
  min: MIN_POOL_CONNECTIONS,
  idleTimeoutMillis: 5 * 60_000,
  connectionTimeoutMillis: 10_000,
  ...keepAlive,
});
// An idle client can fail when the database restarts or the network drops; pg
// discards it, but an unhandled pool error would crash the process. Log only
// the error class and code, never connection details.
pool.on('error', (error) => {
  console.error(JSON.stringify({
    event: 'database_idle_client_error',
    errorName: error.name,
    code: (error as { code?: unknown }).code ?? null,
  }));
});

/** Open the pool's minimum connections before serving traffic; pg opens them lazily. */
export async function warmDatabasePool(): Promise<void> {
  const results = await Promise.allSettled(
    Array.from({ length: MIN_POOL_CONNECTIONS }, () => pool.connect()),
  );
  for (const result of results) {
    if (result.status === 'fulfilled') result.value.release();
  }
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/** A long-lived connection for LISTEN, kept out of the query pool. */
export function createListenerClient(): Client {
  return new Client({ connectionString, ...keepAlive });
}
// pg accepts both promise and callback forms; retain both for Drizzle and
// transaction clients. Record only durations/counts, never SQL or parameters.
const connect = pool.connect.bind(pool);
pool.connect = ((callback?: (...args: any[]) => void) => {
  const context = databaseMeasurementContext();
  const started = performance.now();
  if (!callback) return connect().then((client) => {
    recordDatabasePoolWait(context, performance.now() - started);
    return client;
  });
  return connect((error, client, release) => {
    recordDatabasePoolWait(context, performance.now() - started);
    callback(error, client, release);
  });
}) as typeof pool.connect;
const instrumented = new WeakSet<object>();
function queryFingerprint(args: any[]): string | undefined {
  const input = args[0];
  const text = typeof input === 'string'
    ? input
    : input && typeof input === 'object' && typeof input.text === 'string'
      ? input.text
      : undefined;
  if (!text) return undefined;
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
}
pool.on('connect', (client) => {
  if (instrumented.has(client)) return;
  instrumented.add(client);
  // Connection setup is expensive over a remote link; count it per request and
  // log it so slow-request pool waits can be matched to new connections.
  recordDatabaseConnectionOpened(databaseMeasurementContext());
  console.info(JSON.stringify({
    event: 'database_connection_opened',
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  }));
  const query = client.query.bind(client);
  client.query = ((...args: any[]) => {
    const context = databaseMeasurementContext();
    const started = performance.now();
    const fingerprint = context.measurements?.traceId ? queryFingerprint(args) : undefined;
    recordDatabaseQueryStart(context);
    const finish = () => {
      recordDatabaseQueryFinish(context, performance.now() - started, fingerprint);
    };
    const last = args.at(-1);
    if (typeof last === 'function') {
      args[args.length - 1] = (...result: any[]) => { finish(); last(...result); };
      return (query as any)(...args);
    }
    const result = (query as any)(...args);
    if (result?.then) return result.finally(finish);
    finish();
    return result;
  }) as typeof client.query;
});
export const db = drizzle(pool, { schema });
