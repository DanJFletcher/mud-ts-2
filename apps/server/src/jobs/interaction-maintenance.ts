import { eq } from 'drizzle-orm';
import { interactionStreamId, projectInteractionEvents, updateInteractionRequestStatus } from '@mudd/core-plugins';
import { worldSessions } from '../db/schema.js';
import { type ServerDependencies } from '../app/dependencies.js';
import { INTERACTION_HEARTBEAT_FRESH_MS } from '../worlds/session-policy.js';

export function startInteractionMaintenance(dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'worldActivity'
  | 'store'
  | 'worldRuntimes'
  | 'timers'
>) {
  const { db, worldActivity, store, worldRuntimes, timers } = dependencies;
  const { setInterval } = timers;
  let interactionMaintenanceRunning = false;
  // Pending requests need two online players. Keep maintaining a world until a
  // few passes after its last presence, so requests left by departing players
  // are cancelled, then skip it until someone returns.
  const INTERACTION_IDLE_GRACE_MS = INTERACTION_HEARTBEAT_FRESH_MS + 10_000;
  async function runInteractionMaintenance(includeIdleWorlds = false) {
    if (interactionMaintenanceRunning) return;
    interactionMaintenanceRunning = true;
    try {
      for (const runtime of worldRuntimes.values()) {
        const worldInstanceId = runtime.worldInstanceId;
        if (!includeIdleWorlds && !worldActivity.isActive(worldInstanceId, INTERACTION_IDLE_GRACE_MS)) continue;
        const events = await store.readStream(worldInstanceId, interactionStreamId(worldInstanceId));
        const { requests } = projectInteractionEvents(events);
        const sessions = await db.select({
          characterId: worldSessions.characterId,
          lastSeenAt: worldSessions.lastSeenAt,
        }).from(worldSessions).where(eq(worldSessions.worldInstanceId, worldInstanceId));
        const online = new Set(sessions
          .filter((session) => Date.now() - session.lastSeenAt.getTime() <= INTERACTION_HEARTBEAT_FRESH_MS)
          .map((session) => session.characterId));
        const now = Date.now();
        for (const request of requests) {
          if (request.status !== 'pending') continue;
          if (Date.parse(request.expiresAt) <= now) {
            await updateInteractionRequestStatus(store, worldInstanceId, request.requestId, 'expired');
          } else if (
            !online.has(request.initiatorCharacterId) ||
            !online.has(request.recipientCharacterId)
          ) {
            await updateInteractionRequestStatus(store, worldInstanceId, request.requestId, 'cancelled');
          }
        }
      }
    } catch {
      console.error('Could not process pending player interaction requests.');
    } finally {
      interactionMaintenanceRunning = false;
    }
  }
  // The startup pass covers every world, clearing requests left before a restart.
  void runInteractionMaintenance(true);
  const interactionPoller = setInterval(() => void runInteractionMaintenance(), 2_000);
  interactionPoller.unref();
  return { runInteractionMaintenance };
}
