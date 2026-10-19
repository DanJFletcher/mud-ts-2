import { and, eq, gte, ne } from 'drizzle-orm';
import type { EventStorePort } from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';
import { db } from './db/client.js';
import { worldSessions } from './db/schema.js';
import { projectRoomOccupants, ROOM_PRESENCE_TTL_MS } from './room-presence-projection.js';

export async function touchWorldSessionPresence(
  playerId: string,
  worldInstanceId: string,
  sessionId: string,
  lastSeenAt = new Date(),
): Promise<boolean> {
  const [updated] = await db.update(worldSessions)
    .set({ lastSeenAt })
    .where(and(
      eq(worldSessions.id, sessionId),
      eq(worldSessions.playerId, playerId),
      eq(worldSessions.worldInstanceId, worldInstanceId),
    ))
    .returning({ id: worldSessions.id });
  return Boolean(updated);
}

export async function listRoomOccupants(
  store: Pick<EventStorePort, 'readStream'>,
  worldInstanceId: string,
  locationId: string,
  viewerCharacterId: string,
  now = new Date(),
) {
  const sessions = await db.select({
    worldInstanceId: worldSessions.worldInstanceId,
    characterId: worldSessions.characterId,
    lastSeenAt: worldSessions.lastSeenAt,
  }).from(worldSessions).where(and(
    eq(worldSessions.worldInstanceId, worldInstanceId),
    ne(worldSessions.characterId, viewerCharacterId),
    gte(worldSessions.lastSeenAt, new Date(now.getTime() - ROOM_PRESENCE_TTL_MS)),
  ));

  const candidates = await Promise.all(sessions.map(async (session) => ({
    ...session,
    character: replayCharacter(await store.readStream(worldInstanceId, session.characterId)),
  })));

  return projectRoomOccupants({
    candidates,
    worldInstanceId,
    locationId,
    viewerCharacterId,
    now,
  });
}
