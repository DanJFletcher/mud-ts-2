import { startRealtimeNotifications } from '../realtime/realtime-notifications.js';
import { measureDatabaseOperation } from './performance.js';
import { and, eq } from 'drizzle-orm';
import { db, pool, warmDatabasePool } from '../db/client.js';
import { characters } from '../db/schema.js';
import { PostgresEventStore } from '../persistence/postgres-event-store.js';
import { listRoomOccupants, touchWorldSessionPresence } from '../rooms/room-presence-service.js';
import { worldActivity } from '../worlds/world-activity.js';
import { createGuestIdentity, expiredGuestCookie, getAccountIdentityForRequest } from '../auth/session-service.js';
import { invalidateCachedPlayer, setMembershipListenerConnected } from '../auth/request-identity-cache.js';
import { createCharacterOwnershipCheck } from '../auth/character-authorization.js';
import { createPlayerRoomChatMessage, getRoomChatMessageBySourceEffectId, listRoomChatMessages, MAX_ROOM_CHAT_MESSAGE_LENGTH } from '../rooms/room-chat-service.js';
import { readServerConfiguration } from './server-config.js';
import { readE2eAuthMode } from '../auth/e2e-auth-mode.js';
import { createWorldRuntimes, registeredWorlds, startWorldRuntimes, stopWorldRuntimes, toWorldSummary, type WorldRuntime } from '../worlds/world-registry.js';
import { createApplication } from './create-app.js';
import { runtimeTimers, type RuntimeTimers } from './timers.js';
import { startRuntimeSchedulers } from '../jobs/runtime-schedulers.js';
import { startEffectProcessing } from '../jobs/effect-processing.js';
import { startInteractionMaintenance } from '../jobs/interaction-maintenance.js';

/** Production composition; import does not execute application startup. */
export async function startServer(moduleUrl: string, timers: RuntimeTimers = runtimeTimers) {
  const { trustedProxyHops, allowedOrigins, trustedHosts } = readServerConfiguration(process.env);
  const e2eAuthEnabled = readE2eAuthMode(process.env);

  await warmDatabasePool();
  const store = new PostgresEventStore();
  await store.rebuildRoomStates();
  const registeredWorldIds = new Set(registeredWorlds.map((world) => world.worldInstanceId));
  const authorization = {
    async canAccessInstance(session: { worldInstanceId: string; }, id: string) {
      return session.worldInstanceId === id && registeredWorldIds.has(id);
    },
    ownsCharacter: createCharacterOwnershipCheck(async (playerId, id) => {
      const [row] = await measureDatabaseOperation('character.ownership_lookup', () =>
        db.select({ id: characters.id }).from(characters)
          .where(and(eq(characters.id, id), eq(characters.playerId, playerId)))
          .limit(1));
      return Boolean(row);
    }),
  };
  const worldRuntimes = createWorldRuntimes(store, authorization);
  await startWorldRuntimes(worldRuntimes);
  function runtimeFor(worldInstanceId: string): WorldRuntime {
    const runtime = worldRuntimes.get(worldInstanceId);
    if (!runtime) throw new Error(`No world is registered for instance ${worldInstanceId}.`);
    return runtime;
  }

  const dependencies = {
    db,
    pool,
    store,
    worldRuntimes,
    runtimeFor,
    e2eAuthEnabled,
    trustedProxyHops,
    allowedOrigins,
    trustedHosts,
    timers,
    getAccountIdentityForRequest,
    expiredGuestCookie,
    createGuestIdentity,
    listRoomOccupants,
    touchWorldSessionPresence,
    createPlayerRoomChatMessage,
    getRoomChatMessageBySourceEffectId,
    listRoomChatMessages,
    MAX_ROOM_CHAT_MESSAGE_LENGTH,
    worldActivity,
    registeredWorlds,
    toWorldSummary,
  };
  const schedulers = await startRuntimeSchedulers(dependencies);
  const effects = startEffectProcessing(dependencies);
  const { runPendingEffectBatch, wakeEffectBatch } = effects;
  startInteractionMaintenance(dependencies);
  const { app, realtimeGateway } = createApplication({ ...dependencies, ...effects }, moduleUrl);
  const stopRealtimeNotifications = startRealtimeNotifications((change) => {
    if (change.kind === 'membership' && change.playerId) {
      invalidateCachedPlayer(change.playerId, change.world);
    }
    realtimeGateway.invalidate(change);
    wakeEffectBatch(change.world);
  }, () => {
    realtimeGateway.refreshAll();
    void runPendingEffectBatch();
  }, setMembershipListenerConnected);
  const port = Number(
    process.env.PORT ?? process.env.API_PORT ?? (process.env.NODE_ENV === 'production' ? 5000 : 5001),
  );
  const server = app.listen(port, e2eAuthEnabled ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(`MUDD server listening on ${port}`);
  });
  async function shutdown() {
    effects.stop();
    stopRealtimeNotifications();
    realtimeGateway.close();
    server.close();
    schedulers.stop();
    await stopWorldRuntimes(worldRuntimes);
    await pool.end();
  }
  return { server, shutdown };
}
