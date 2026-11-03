import { and, eq, gte } from 'drizzle-orm';
import { activeSharedCombatCharacterIds, mobileNpcDefinitions } from '@mudd/core-plugins';
import { worldSessions } from '../db/schema.js';
import { WORLD_ACTIVITY_WINDOW_MS } from '../worlds/world-activity.js';
import { createAutonomousNpcScheduler } from './autonomous-npc-scheduler.js';
import { createStaminaRecoveryScheduler } from './stamina-recovery-scheduler.js';
import { createObjectLifecycleScheduler } from './object-lifecycle-scheduler.js';
import { type ServerDependencies } from '../app/dependencies.js';

export async function startRuntimeSchedulers(dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'worldActivity'
  | 'store'
  | 'worldRuntimes'
>) {
  const { db, worldActivity, store, worldRuntimes } = dependencies;
  const autonomousNpcSchedulers = new Map([...worldRuntimes.values()]
    .filter((runtime) => mobileNpcDefinitions(runtime.world).length > 0)
    .map((runtime) => [runtime.worldInstanceId, createAutonomousNpcScheduler({
      engine: runtime.engine,
      store,
      world: runtime.world,
      worldInstanceId: runtime.worldInstanceId,
      // NPC wandering is only observable with someone online, so the scheduler
      // sleeps while the world is idle instead of replaying NPC streams.
      isActive: () => worldActivity.isActive(runtime.worldInstanceId),
      onError(error, npcId) {
        console.error(
          `Could not run autonomous movement for NPC ${npcId} in world ${runtime.worldInstanceId}.`,
          error,
        );
      },
    })]));
  worldActivity.onActivity((worldInstanceId) => autonomousNpcSchedulers.get(worldInstanceId)?.wake());
  // A restart forgets in-memory presence; reseed it from sessions that are still fresh.
  for (const session of await db.select({
    worldInstanceId: worldSessions.worldInstanceId,
    lastSeenAt: worldSessions.lastSeenAt,
  }).from(worldSessions).where(gte(worldSessions.lastSeenAt, new Date(Date.now() - WORLD_ACTIVITY_WINDOW_MS)))) {
    worldActivity.record(session.worldInstanceId, session.lastSeenAt);
  }
  for (const scheduler of autonomousNpcSchedulers.values()) scheduler.start();

  const staminaRecoverySchedulers = [...worldRuntimes.values()].map((runtime) =>
    createStaminaRecoveryScheduler({
      engine: runtime.engine,
      store,
      worldInstanceId: runtime.worldInstanceId,
      enabled: process.env.MUDD_TIMER_RECOVERY !== '0',
      listActiveSharedCombatants: () => activeSharedCombatCharacterIds({
        store,
        worldInstanceId: runtime.worldInstanceId,
      }),
      listSessions: async (activeSince) => {
        const sessions = await db.select({
          characterId: worldSessions.characterId,
          lastSeenAt: worldSessions.lastSeenAt,
        }).from(worldSessions).where(and(
          eq(worldSessions.worldInstanceId, runtime.worldInstanceId),
          ...(activeSince ? [gte(worldSessions.lastSeenAt, activeSince)] : []),
        ));
        return sessions;
      },
      onError(error, characterId) {
        console.error(`Could not settle vitals for character ${characterId} in ${runtime.worldInstanceId}.`, error);
      },
    }),
  );
  for (const scheduler of staminaRecoverySchedulers) scheduler.start();
  const objectLifecycleScheduler = createObjectLifecycleScheduler({
    runtimes: [...worldRuntimes.values()],
    store,
    onError(error, worldInstanceId, objectId) {
      console.error(
        `Could not expire world object${objectId ? ` ${objectId}` : ''} in ${worldInstanceId}.`,
        error,
      );
    },
  });
  return {
    stop() {
      for (const scheduler of autonomousNpcSchedulers.values()) scheduler.stop();
      for (const scheduler of staminaRecoverySchedulers) scheduler.stop();
      objectLifecycleScheduler.stop();
    },
  };
}
