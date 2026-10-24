/**
 * Isolated PostgreSQL benchmark. Requires an explicitly opted-in local test DB:
 * DATABASE_URL=postgresql://runner@127.0.0.1:55439/mudd_latency_test
 * MUDD_BENCHMARK_LOCAL=1 npx tsx apps/server/src/latency-benchmark.ts
 * Never run against production. "before" reproduces the previous history
 * read/replay policy; both modes use the same current command/plugin code.
 */
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { and, eq, inArray } from 'drizzle-orm';
import { replayCharacter } from '@mudd/engine-core';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { PostgresEventStore, toStoredGameEvent } from './persistence/postgres-event-store.js';
import { db, pool } from './db/client.js';
import { players, gameEvents, commandReceipts, characters, durableEffects } from './db/schema.js';
import { createWorldRuntimes, registeredWorlds, startWorldRuntimes, stopWorldRuntimes } from './world-registry.js';
import { requestMeasurements, newMeasurements } from './performance.js';
import { createStaminaRecoveryScheduler } from './stamina-recovery-scheduler.js';

const url = new URL(process.env.DATABASE_URL!);
if (process.env.MUDD_BENCHMARK_LOCAL !== '1' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
  throw new Error('Benchmark requires an explicitly opted-in localhost *_test database.');
}
class PreviousHistoryPolicy extends PostgresEventStore {
  private previous = new Map<string, { revision: number; events: Awaited<ReturnType<PostgresEventStore['readStream']>> }>();
  override async readStream(world: string, stream: string) {
    const key = `${world}:${stream}`;
    const revision = await this.readStreamRevision(world, stream);
    const previous = this.previous.get(key);
    let events;
    if (previous?.revision === revision) events = previous.events;
    else {
      events = (await db.select().from(gameEvents)
        .where(and(eq(gameEvents.worldInstanceId, world), eq(gameEvents.streamId, stream)))
        .orderBy(gameEvents.streamVersion)).map(toStoredGameEvent);
      if (events.length && Buffer.byteLength(JSON.stringify(events)) <= 512 * 1024) this.previous.set(key, { revision, events });
      else this.previous.delete(key);
    }
    // The original reducer always replayed, even when the event array was cached.
    return [...events];
  }
}
const world = registeredWorlds.find((w) => w.worldInstanceId === DEMO_WORLD_INSTANCE_ID)!.world;
for (const road of world.roads ?? []) road.encounterChancePercent = 0;
const sentinel = world.locations.flatMap((l) => l.npcs ?? []).find((n) => n.id === 'mossgate-training-sentinel')!;
sentinel.combatProfile = { ...sentinel.combatProfile!, attackDamage: 0, maxHealth: 1000 };
const owner = randomUUID();
const ids: string[] = [];
await db.insert(players).values({ id: owner, displayName: 'Benchmark fixture' });
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: +sorted[Math.floor(sorted.length * .5)]!.toFixed(2),
    p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]!.toFixed(2) };
};
try {
  for (const length of [100, 2000]) {
    for (const mode of ['before', 'after']) {
      const store = mode === 'before' ? new PreviousHistoryPolicy() : new PostgresEventStore();
      const runtimes = createWorldRuntimes(store, {
        canAccessInstance: async () => true, ownsCharacter: async () => true,
      });
      await startWorldRuntimes(runtimes);
      const engine = runtimes.get(DEMO_WORLD_INSTANCE_ID)!.engine;
      const id = randomUUID(); ids.push(id);
      const session = { sessionId: randomUUID(), playerId: owner, actorId: owner,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID, grantedPermissions: [], authenticated: true };
      const created = await store.append({
        worldInstanceId: DEMO_WORLD_INSTANCE_ID, streamId: id, actorId: owner,
        commandId: randomUUID(), payloadHash: randomUUID(), expectedVersion: 0,
        events: [{ type: 'character.created', version: 2, payload: {
          characterId: id, playerId: owner, name: 'Benchmark',
          startingLocationId: 'mossgate-clearing',
          resources: { stamina: { current: 1000, maximum: 1000 }, mana: { current: 100, maximum: 100 } },
        } }],
      });
      if (created.kind !== 'committed') throw new Error('Could not create benchmark fixture.');
      await store.append({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, streamId: id, actorId: owner,
        commandId: randomUUID(), payloadHash: randomUUID(), expectedVersion: 1,
        events: Array.from({ length: length - 1 }, (_, i) => ({
          type: 'character.renamed', version: 1, payload: { characterId: id, name: `Fixture ${i}` },
        })),
      });
      let state = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, id))!;
      const snapshot = async () => {
        const started = performance.now();
        const history = await store.readStream(DEMO_WORLD_INSTANCE_ID, id);
        const replayStarted = performance.now();
        state = replayCharacter(history)!;
        const replayMs = performance.now() - replayStarted;
        const projectionMs = performance.now() - started;
        const result = await engine.query({ type: 'location.describe', version: 1, queryId: randomUUID(),
          worldInstanceId: DEMO_WORLD_INSTANCE_ID, characterId: id, payload: {},
        }, session, { characterProjection: state });
        if (!result.ok) throw new Error(result.message);
        return { projectionMs, replayMs };
      };
      await snapshot(); // warm same-world catalog and history/projection
      let encounterId: string | undefined;
      for (const action of ['look', 'move', 'combat']) {
        const samples: number[] = [], queries: number[] = [], waits: number[] = [], queryTimes: number[] = [], projections: number[] = [], replays: number[] = [];
        const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
        for (let i = 0; i < 30; i++) {
          const metrics = newMeasurements();
          const started = performance.now();
          await requestMeasurements.run(metrics, async () => {
            if (action !== 'look') {
              const command = action === 'move'
                ? { type: 'character.road.step', payload: { exitId: i % 2 === 0
                  ? 'clearing-to-bellwarden-track' : 'bellwarden-track-to-clearing' } }
                : { type: 'combat.action', payload: i === 0
                  ? { action: 'attack', targetNpcId: 'mossgate-training-sentinel' }
                  : { action: 'defend', encounterId } };
              const result = await engine.dispatch({ ...command, version: 1, commandId: randomUUID(),
                worldInstanceId: DEMO_WORLD_INSTANCE_ID, characterId: id, expectedVersion: state.revision,
              }, session);
              if (!result.receipt.ok) throw new Error(`${action}: ${result.receipt.message}`);
            }
            const fresh = await snapshot(); projections.push(fresh.projectionMs); replays.push(fresh.replayMs);
            encounterId = state.combat?.encounterId;
          });
          samples.push(performance.now() - started); queries.push(metrics.queries);
          waits.push(metrics.poolWaitMs); queryTimes.push(metrics.queryMs);
        }
        loop.disable();
        console.log(JSON.stringify({ mode, history: length, action, actionAndSnapshotMs: summarize(samples),
          dbQueries: summarize(queries), poolWaitMs: summarize(waits), queryMs: summarize(queryTimes),
          historyReadAndReplayMs: summarize(projections),
          snapshotReplayMs: summarize(replays),
          eventLoopP95Ms: +(loop.percentile(95) / 1e6).toFixed(2),
          handlerStepsPerAction: action === 'look' ? 1 : 2,
        }));
      }
      for (const online of [true, false]) {
        let reads = 0;
        const readStream = async (world: string, stream: string) => {
          reads++; return store.readStream(world, stream);
        };
        let time = new Date();
        const scheduler = createStaminaRecoveryScheduler({ engine, store: { readStream },
          worldInstanceId: DEMO_WORLD_INSTANCE_ID, now: () => time,
          listSessions: async () => [{ characterId: id,
            lastSeenAt: online ? time : new Date(time.getTime() - 120_000) }],
        });
        const samples: number[] = [];
        const metrics = newMeasurements();
        await requestMeasurements.run(metrics, async () => {
          for (let i = 0; i < 30; i++) {
            // Use the same real clock as EngineHost; future recovery timestamps
            // would not be a valid recorded event history.
            time = new Date();
            const started = performance.now();
            if (!online && mode === 'before') {
              // Former scheduler read/replayed before checking the offline anchor.
              replayCharacter(await readStream(DEMO_WORLD_INSTANCE_ID, id));
            } else await scheduler.tick();
            samples.push(performance.now() - started);
          }
        });
        console.log(JSON.stringify({ mode, history: length,
          action: online ? 'recovery-active' : 'recovery-offline', tickMs: summarize(samples),
          ticks: 30, streamReads: reads, dbQueriesTotal: metrics.queries,
          poolWaitTotalMs: +metrics.poolWaitMs.toFixed(2), sessionSource: 'fixture; event store is real PostgreSQL',
        }));
      }
      await stopWorldRuntimes(runtimes);
    }
  }
} finally {
  if (ids.length) {
    await db.delete(durableEffects).where(inArray(durableEffects.sourceStreamId, ids));
    await db.delete(commandReceipts).where(inArray(commandReceipts.streamId, ids));
    await db.delete(gameEvents).where(inArray(gameEvents.streamId, ids));
    await db.delete(characters).where(inArray(characters.id, ids));
  }
  await db.delete(players).where(eq(players.id, owner));
  await pool.end();
}
