/** Local-only baseline/after harness. Never targets the application's database. */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { players, worldSessions, gameEvents, commandReceipts } from './db/schema.js';
import { PostgresEventStore } from './persistence/postgres-event-store.js';
import { listRoomChatMessages } from './room-chat-service.js';
import { listRoomOccupants } from './room-presence-service.js';
import { newMeasurements, requestMeasurements } from './performance.js';

export function assertRoomReadBenchmarkEnvironment(env: NodeJS.ProcessEnv): void {
  const url = new URL(env.DATABASE_URL ?? '');
  if (env.MUDD_BENCHMARK_LOCAL !== '1' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('Benchmark requires explicitly opted-in local test database.');
  }
}

export async function runRoomReadBenchmark(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertRoomReadBenchmarkEnvironment(env);
  const store = new PostgresEventStore();
  const world = `room-benchmark-${randomUUID()}`;
  const owners: string[] = [];
  const ids: string[] = [];
  const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  try {
    for (const population of [2, 20, 100]) {
      while (ids.length < population) {
        const owner = randomUUID(), id = randomUUID();
        owners.push(owner); ids.push(id);
        await db.insert(players).values({ id: owner, displayName: 'Benchmark' });
        await store.append({
          worldInstanceId: world, streamId: id, actorId: owner,
          commandId: randomUUID(), payloadHash: randomUUID(), expectedVersion: 0,
          events: [{ type: 'character.created', version: 1, payload: {
            characterId: id, playerId: owner, name: 'Benchmark',
            startingLocationId: ids.length % 2 ? 'room-a' : 'room-b',
          } }, ...Array.from({ length: 1999 }, () => ({
            type: 'character.renamed', version: 1,
            payload: { characterId: id, name: 'Benchmark' },
          }))],
        });
        await db.insert(worldSessions).values({
          id: randomUUID(), playerId: owner, characterId: id, worldInstanceId: world,
        });
      }
      for (const action of ['chat', 'presence'] as const) {
        const durations: number[] = [], counts: number[] = [], sql: number[] = [], waits: number[] = [];
        for (let i = 0; i < 30; i++) {
          // Fixture setup can exceed the online TTL; keep every simulated client
          // alive outside the measured request.
          await db.update(worldSessions).set({ lastSeenAt: new Date() })
            .where(eq(worldSessions.worldInstanceId, world));
          const metrics = newMeasurements(), start = performance.now();
          await requestMeasurements.run(metrics, () => action === 'chat'
            ? listRoomChatMessages({ worldInstanceId: world, playerId: owners[0]!,
              characterId: ids[0]!, roomId: 'room-a', afterId: 0 })
            : listRoomOccupants(store, world, 'room-a', ids[0]!));
          durations.push(performance.now() - start); counts.push(metrics.queries);
          sql.push(metrics.queryMs); waits.push(metrics.poolWaitMs);
        }
        console.log(JSON.stringify({ action, population, history: 2000, samples: 30,
          p50: percentile(durations, .5), p95: percentile(durations, .95), p99: percentile(durations, .99),
          queriesP95: percentile(counts, .95), sqlP95: percentile(sql, .95), poolP95: percentile(waits, .95),
        }));
      }
    }
  } finally {
    await db.delete(commandReceipts).where(eq(commandReceipts.worldInstanceId, world));
    await db.delete(gameEvents).where(eq(gameEvents.worldInstanceId, world));
    for (const id of owners) await db.delete(players).where(eq(players.id, id));
    await pool.end();
  }
}

export async function runRoomReadBenchmarkCli(
  argv: string | undefined,
  moduleUrl: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (argv && moduleUrl === pathToFileURL(argv).href) {
    await runRoomReadBenchmark(env);
  }
}

await runRoomReadBenchmarkCli(process.argv[1], import.meta.url, process.env);
