/** PROPOSED server-only authority. Never derive actorId from a client JSON field. */
import type { CharacterId, PlayerId, SessionId, WorldInstanceId } from './ids.js';

export interface SessionContext {
  readonly sessionId: SessionId;
  readonly playerId: PlayerId;
  readonly actorId: PlayerId;
  readonly worldInstanceId: WorldInstanceId;
  readonly selectedCharacterId?: CharacterId;
  readonly grantedPermissions: readonly string[];
  readonly authenticated: boolean;
}

export interface AuthorizationPort {
  ownsCharacter(context: SessionContext, characterId: CharacterId): Promise<boolean>;
  canAccessInstance(context: SessionContext, worldInstanceId: WorldInstanceId): Promise<boolean>;
  hasPermission(context: SessionContext, permission: string): boolean;
}
