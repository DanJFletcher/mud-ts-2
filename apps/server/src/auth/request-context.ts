import { type Request, type Response } from 'express';
import { measureStage, measureDatabaseOperation, recordRequestCacheLookup } from '../app/performance.js';
import { getAuth } from '@clerk/express';
import { and, eq } from 'drizzle-orm';
import { worldSessions } from '../db/schema.js';
import { type AccountIdentity } from './session-service.js';
import { getCachedWorldSession, takePrefetchedWorldSession, requestIdentityCacheEnabled, setCachedWorldSession } from './request-identity-cache.js';
import { type WorldRuntime } from '../worlds/world-registry.js';
import { type ServerDependencies } from '../app/dependencies.js';
import { replayCharacter } from '../app/character-replay.js';

export function createRequestContext(dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'getAccountIdentityForRequest'
  | 'expiredGuestCookie'
  | 'store'
  | 'e2eAuthEnabled'
>) {
  const { db, getAccountIdentityForRequest, expiredGuestCookie, store, e2eAuthEnabled } = dependencies;
  function requestAuth(request: Request) {
    return e2eAuthEnabled
      ? { userId: null, sessionId: null, sessionClaims: null }
      : getAuth(request);
  }

  async function accountFor(
    request: Request,
    response: Response,
    needsWorldSession = true,
  ): Promise<AccountIdentity | undefined> {
    const auth = requestAuth(request);
    const selected = selectedRuntime(response);
    const resolved = await measureStage('account', () => getAccountIdentityForRequest(
      request,
      { userId: auth.userId, sessionId: auth.sessionId },
      needsWorldSession ? selected.worldInstanceId : undefined,
    ));
    const identity = resolved.identity;
    if (!identity) {
      response.status(401).json({ message: 'Start a guest session or sign in to access your characters.' });
      return undefined;
    }
    if (identity.clearGuestCookie) response.setHeader('Set-Cookie', expiredGuestCookie);
    return identity;
  }

  function selectedRuntime(response: Response): WorldRuntime {
    const runtime = response.locals.worldRuntime as WorldRuntime | undefined;
    if (!runtime) throw new Error('The selected world is not available.');
    return runtime;
  }

  async function activeSession(identity: AccountIdentity, worldInstanceId: string) {
    const prefetched = takePrefetchedWorldSession(identity, worldInstanceId);
    if (prefetched.resolved) return prefetched.session;
    if (requestIdentityCacheEnabled()) {
      const cached = getCachedWorldSession(identity.playerId, worldInstanceId);
      recordRequestCacheLookup('worldSession', Boolean(cached));
      if (cached) return cached;
    }
    const [session] = await measureDatabaseOperation('world_session.active_lookup', () =>
      measureStage('session', () => db.select().from(worldSessions).where(and(
        eq(worldSessions.playerId, identity.playerId),
        eq(worldSessions.worldInstanceId, worldInstanceId),
      )).limit(1)));
    if (session && requestIdentityCacheEnabled()) setCachedWorldSession(session);
    return session;
  }

  async function activeCharacter(identity: AccountIdentity, worldInstanceId: string) {
    const session = await activeSession(identity, worldInstanceId);
    if (!session) return undefined;
    const character = replayCharacter(await store.readStream(session.worldInstanceId, session.characterId));
    if (!character || character.archived) return undefined;
    return { session, character };
  }

  function worldContext(identity: AccountIdentity, session: typeof worldSessions.$inferSelect) {
    return {
      ...identity.session,
      sessionId: session.id,
      worldInstanceId: session.worldInstanceId,
      selectedCharacterId: session.characterId,
    };
  }
  return { requestAuth, accountFor, selectedRuntime, activeSession, activeCharacter, worldContext };
}

export type RequestContext = ReturnType<typeof createRequestContext>;
