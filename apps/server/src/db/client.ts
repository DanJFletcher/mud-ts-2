import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { requestMeasurements } from '../performance.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to run the MUDD server.');

export const pool = new Pool({ connectionString, max: 10 });
// pg accepts both promise and callback forms; retain both for Drizzle and
// transaction clients. Record only durations/counts, never SQL or parameters.
const connect = pool.connect.bind(pool);
pool.connect = ((callback?: (...args: any[]) => void) => {
  const metrics = requestMeasurements.getStore();
  const started = performance.now();
  if (!callback) return connect().then((client) => {
    if (metrics) metrics.poolWaitMs += performance.now() - started;
    return client;
  });
  return connect((error, client, release) => {
    if (metrics) metrics.poolWaitMs += performance.now() - started;
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
    const metrics = requestMeasurements.getStore();
    const started = performance.now();
    const fingerprint = metrics?.traceId ? queryFingerprint(args) : undefined;
    if (metrics) metrics.queries++;
    const finish = () => {
      if (!metrics) return;
      const durationMs = performance.now() - started;
      metrics.queryMs += durationMs;
      if (fingerprint && metrics.queryTimings.length < 100) {
        metrics.queryTimings.push({ fingerprint, durationMs: Math.round(durationMs * 10) / 10 });
      }
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
