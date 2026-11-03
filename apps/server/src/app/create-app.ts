import { type ServerDependencies } from './dependencies.js';
import { createHttp } from './http.js';
import { installHttpFallbacks } from './http-fallbacks.js';
import { createRequestContext } from '../auth/request-context.js';
import { createGameSnapshots } from '../worlds/game-snapshot.js';
import { installRealtime } from '../realtime/subscription-views.js';
import { registerGuestRoutes } from '../auth/routes.js';
import { registerCharacterRoutes } from '../worlds/routes/characters.js';
import { registerSessionRoutes } from '../worlds/routes/sessions.js';
import { registerGameRoutes } from '../worlds/routes/game.js';
import { registerRoomRoutes } from '../rooms/routes.js';
import { registerInteractionRoutes } from '../worlds/routes/interactions.js';
import { registerCommandRoutes } from '../worlds/routes/commands.js';
import { registerQueryRoutes } from '../worlds/routes/queries.js';

export type ApplicationDependencies = Pick<
  ServerDependencies,
  | 'db'
  | 'pool'
  | 'getAccountIdentityForRequest'
  | 'expiredGuestCookie'
  | 'createGuestIdentity'
  | 'listRoomOccupants'
  | 'touchWorldSessionPresence'
  | 'createPlayerRoomChatMessage'
  | 'getRoomChatMessageBySourceEffectId'
  | 'listRoomChatMessages'
  | 'MAX_ROOM_CHAT_MESSAGE_LENGTH'
  | 'worldActivity'
  | 'registeredWorlds'
  | 'toWorldSummary'
  | 'store'
  | 'worldRuntimes'
  | 'runtimeFor'
  | 'e2eAuthEnabled'
  | 'trustedProxyHops'
  | 'allowedOrigins'
  | 'trustedHosts'
  | 'runPendingEffectBatch'
>;

/** Build HTTP and socket routes; the caller owns runtime startup and listening. */
export function createApplication(dependencies: ApplicationDependencies, moduleUrl: string) {
  const { app, websocketApp } = createHttp(dependencies);
  const context = createRequestContext(dependencies);
  const snapshots = createGameSnapshots({ ...dependencies, ...context });
  const services = { ...dependencies, ...context, ...snapshots };
  const realtimeGateway = installRealtime(websocketApp, services);
  registerGuestRoutes(app, services);
  registerCharacterRoutes(app, services);
  registerSessionRoutes(app, services);
  registerGameRoutes(app, services);
  registerRoomRoutes(app, services);
  registerInteractionRoutes(app, services);
  registerCommandRoutes(app, services);
  registerQueryRoutes(app, services);
  installHttpFallbacks(app, moduleUrl);
  return { app, realtimeGateway };
}
