import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { EventStorePort } from '@mudd/engine-core';
import { db } from './db/client.js';
import { worldSessions, roomCharacterStates } from './db/schema.js';
import { projectRoomOccupants, ROOM_PRESENCE_TTL_MS } from './room-presence-projection.js';

// Fail closed during mixed-version rollout if an older writer bypassed the
// read model. The covering stream index makes this a bounded head check.
const currentRoomState = sql`${roomCharacterStates.revision} = (
  SELECT e.stream_version FROM game_events e
  WHERE e.world_instance_id = ${roomCharacterStates.worldInstanceId}
    AND e.stream_id = ${roomCharacterStates.characterId}::text
  ORDER BY e.stream_version DESC LIMIT 1
)`;

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
  _store: Pick<EventStorePort, 'readStream'>,
  worldInstanceId: string,
  locationId: string,
  viewerCharacterId: string,
  now = new Date(),
) {
  const sessions = await db.select({
    worldInstanceId: worldSessions.worldInstanceId,
    characterId: worldSessions.characterId,
    lastSeenAt: worldSessions.lastSeenAt,
    character: roomCharacterStates.state,
  }).from(worldSessions).innerJoin(roomCharacterStates, and(
    eq(worldSessions.characterId, roomCharacterStates.characterId),
    eq(worldSessions.worldInstanceId, roomCharacterStates.worldInstanceId),
  )).where(and(
    eq(roomCharacterStates.locationId, locationId),
    eq(roomCharacterStates.schemaVersion, 1),
    currentRoomState,
    eq(worldSessions.worldInstanceId, worldInstanceId),
    ne(worldSessions.characterId, viewerCharacterId),
    gte(worldSessions.lastSeenAt, new Date(now.getTime() - ROOM_PRESENCE_TTL_MS)),
  ));
  const candidates = sessions;
  return projectRoomOccupants({
    candidates,
    worldInstanceId,
    locationId,
    viewerCharacterId,
    now,
  });
}

export async function listActiveRoomCharacters(
  _store: Pick<EventStorePort, 'readStream'>,
  worldInstanceId: string,
  locationId: string,
  now = new Date(),
) {
  const sessions = await db.select({
    playerId: worldSessions.playerId,
    worldInstanceId: worldSessions.worldInstanceId,
    characterId: worldSessions.characterId,
    lastSeenAt: worldSessions.lastSeenAt,
    character: roomCharacterStates.state,
  }).from(worldSessions).innerJoin(roomCharacterStates, and(
    eq(worldSessions.characterId, roomCharacterStates.characterId),
    eq(worldSessions.worldInstanceId, roomCharacterStates.worldInstanceId),
  )).where(and(
    eq(roomCharacterStates.locationId, locationId),
    eq(roomCharacterStates.schemaVersion, 1),
    currentRoomState,
    eq(worldSessions.worldInstanceId, worldInstanceId),
    gte(worldSessions.lastSeenAt, new Date(now.getTime() - ROOM_PRESENCE_TTL_MS)),
  )).orderBy(desc(worldSessions.lastSeenAt));

  const candidates = sessions;

  const activeByPlayer = new Map<string, {
    playerId: string;
    characterId: string;
    displayName: string;
  }>();
  const onlineAfter = now.getTime() - ROOM_PRESENCE_TTL_MS;
  for (const candidate of candidates) {
    const character = candidate.character;
    if (
      candidate.lastSeenAt.getTime() < onlineAfter ||
      !character ||
      character.worldInstanceId !== worldInstanceId ||
      character.characterId !== candidate.characterId ||
      character.locationId !== locationId ||
      character.archived ||
      character.health?.current === 0 ||
      character.combat?.status === 'active' ||
      character.combat?.status === 'defeat' ||
      activeByPlayer.has(candidate.playerId)
    ) continue;
    activeByPlayer.set(candidate.playerId, {
      playerId: candidate.playerId,
      characterId: character.characterId,
      displayName: character.name,
    });
  }
  return [...activeByPlayer.values()];
}
