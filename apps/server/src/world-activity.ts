// Matches the heartbeat freshness window used for interactions and recovery:
// a world is active while any session there has confirmed presence this recently.
export const WORLD_ACTIVITY_WINDOW_MS = 45_000;

type ActivityListener = (worldInstanceId: string) => void;

/**
 * In-process record of when each world last saw player presence, so background
 * schedulers can sleep while nobody is online without polling the database.
 * It only ever moves forward; a restart starts empty and is reseeded from
 * recent sessions.
 */
export function createWorldActivityTracker(now: () => number = Date.now) {
  const lastSeenByWorld = new Map<string, number>();
  const listeners = new Set<ActivityListener>();

  return {
    record(worldInstanceId: string, seenAt: Date | number = now()): void {
      const seenAtMs = typeof seenAt === 'number' ? seenAt : seenAt.getTime();
      const previous = lastSeenByWorld.get(worldInstanceId);
      if (previous !== undefined && previous >= seenAtMs) return;
      lastSeenByWorld.set(worldInstanceId, seenAtMs);
      for (const listener of listeners) listener(worldInstanceId);
    },
    /** True while presence was confirmed within `windowMs`. */
    isActive(worldInstanceId: string, windowMs = WORLD_ACTIVITY_WINDOW_MS): boolean {
      const lastSeen = lastSeenByWorld.get(worldInstanceId);
      return lastSeen !== undefined && now() - lastSeen <= windowMs;
    },
    onActivity(listener: ActivityListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type WorldActivityTracker = ReturnType<typeof createWorldActivityTracker>;

export const worldActivity = createWorldActivityTracker();
