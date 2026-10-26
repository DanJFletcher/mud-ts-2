import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import {
  databaseMeasurementContext,
  recordDatabasePoolWait,
  recordDatabaseQueryFinish,
  recordDatabaseQueryStart,
} from '../performance.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to run the MUDD server.');

export const pool = new Pool({ connectionString, max: 10 });
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
