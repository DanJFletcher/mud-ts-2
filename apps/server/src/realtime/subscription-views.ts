import { createRealtimeGateway } from './realtime-gateway.js';
import { and, eq, sql } from 'drizzle-orm';
import { REALTIME_PROTOCOL_VERSION } from '@mudd/contracts';
import { interactionStreamId, projectCharacterInteractions } from '@mudd/core-plugins';
import { roomChatMessages } from '../db/schema.js';
import { type ServerDependencies } from '../app/dependencies.js';

export function installRealtime(websocketApp: import('express-ws').Application, dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'getAccountIdentityForRequest'
  | 'listRoomOccupants'
  | 'store'
  | 'worldRuntimes'
  | 'allowedOrigins'
  | 'requestAuth'
  | 'activeCharacter'
  | 'worldContext'
>) {
  const {
    db,
    getAccountIdentityForRequest,
    listRoomOccupants,
    store,
    worldRuntimes,
    allowedOrigins,
    requestAuth,
    activeCharacter,
    worldContext,
  } = dependencies;
  const realtimeGateway = createRealtimeGateway(async (req, channels) => {
    const auth = requestAuth(req);
    if (auth.sessionClaims?.exp && Date.now() >= auth.sessionClaims.exp * 1000) return undefined;
    const worldId = typeof req.query.world === 'string' ? req.query.world : '';
    const resolved = await getAccountIdentityForRequest(
      req,
      { userId: auth.userId, sessionId: auth.sessionId },
      worldId || undefined,
    );
    const identity = resolved.identity;
    if (!identity) return undefined;
    const runtime = worldRuntimes.get(worldId);
    if (!runtime) return undefined;
    const current = await activeCharacter(identity, worldId);
    if (!current) return undefined;
    const { session, character } = current;
    const context = worldContext(identity, session);
    const [chat, presence, interactions, party, team] = await Promise.all([
      channels.includes('chat') ? db.select({ cursor: sql<number>`coalesce(max(${roomChatMessages.id}), 0)` }).from(roomChatMessages)
        .where(and(eq(roomChatMessages.worldInstanceId, worldId), eq(roomChatMessages.roomId, character.locationId)))
        : Promise.resolve([]),
      channels.includes('presence')
        ? listRoomOccupants(store, worldId, character.locationId, character.characterId) : Promise.resolve([]),
      channels.includes('interactions') ? store.readStream(worldId, interactionStreamId(worldId)).then((events) =>
        projectCharacterInteractions(events, character.characterId))
        : Promise.resolve(null),
      channels.includes('party') ? runtime.engine.query({
        type: 'party.info', version: 1, queryId: crypto.randomUUID(),
        worldInstanceId: worldId, characterId: character.characterId, payload: {}
      }, context) : Promise.resolve(null),
      channels.includes('team') ? runtime.engine.query({
        type: 'team.combat.info', version: 1, queryId: crypto.randomUUID(),
        worldInstanceId: worldId, characterId: character.characterId, payload: {}
      }, context) : Promise.resolve(null),
    ]);
    if (party && !party.ok || team && !team.ok) return undefined;
    const guestExpiry = Date.now() + 60_000;
    const tokenExpiry = auth.sessionClaims?.exp ? auth.sessionClaims.exp * 1000 : guestExpiry;
    return {
      worldInstanceId: worldId, characterId: character.characterId, playerId: identity.playerId,
      expiresAt: Math.min(guestExpiry, tokenExpiry),
      roomId: character.locationId, values: {
        chat: [character.locationId, chat[0]?.cursor], presence: [character.locationId, presence],
        interactions, party: party?.ok ? party.value : null, team: team?.ok ? team.value : null,
        character: channels.includes('character') ? character.revision : undefined,
      }
    };
  });
  websocketApp.ws('/api/realtime', (socket, req) => {
    // Exact same-origin or explicitly configured origins only; never allow absent
    // or opaque browser origins on the socket path.
    const origin = req.get('origin');
    if (!origin || !(allowedOrigins.has(origin) || origin === `${req.protocol}://${req.get('host')}`)) {
      socket.close(1008); return;
    }
    // Installed PWAs can run older SDK builds; only clients that ask for protocol 2
    // receive its additional frame fields.
    realtimeGateway.connect(socket, req, {
      protocolVersion: req.query.protocol === String(REALTIME_PROTOCOL_VERSION) ? REALTIME_PROTOCOL_VERSION : 1,
    });
  });
  return realtimeGateway;
}
