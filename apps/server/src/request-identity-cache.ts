import type { AccountIdentity } from './session-service.js';
import type { worldSessions as worldSessionsTable } from './db/schema.js';

export const REQUEST_IDENTITY_CACHE_TTL_MS = 60_000;
export const REQUEST_IDENTITY_CACHE_MAX_ENTRIES = 10_000;

export type CachedWorldSession = typeof worldSessionsTable.$inferSelect;

type CacheEntry<Value> = {
  value: Value;
  expiresAt: number;
};

/** A small LRU with absolute expiry, used only by the server request layer. */
export class LruTtlCache<Key, Value> {
  private readonly entriesByKey = new Map<Key, CacheEntry<Value>>();

  constructor(readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('An LRU cache must have a positive integer capacity.');
    }
  }

  get(key: Key, now = Date.now()): Value | undefined {
    const entry = this.entriesByKey.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entriesByKey.delete(key);
      return undefined;
    }
    this.entriesByKey.delete(key);
    this.entriesByKey.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, expiresAt: number, now = Date.now()): void {
    if (expiresAt <= now) {
      this.entriesByKey.delete(key);
      return;
    }
    this.entriesByKey.delete(key);
    this.entriesByKey.set(key, { value, expiresAt });
    while (this.entriesByKey.size > this.maxEntries) {
      const leastRecentlyUsed = this.entriesByKey.keys().next().value as Key | undefined;
      if (leastRecentlyUsed === undefined) break;
      this.entriesByKey.delete(leastRecentlyUsed);
    }
  }

  delete(key: Key): void {
    this.entriesByKey.delete(key);
  }

  deleteWhere(predicate: (key: Key, value: Value) => boolean): void {
    for (const [key, entry] of this.entriesByKey) {
      if (entry.expiresAt <= Date.now() || predicate(key, entry.value)) {
        this.entriesByKey.delete(key);
      }
    }
  }

  clear(): void {
    this.entriesByKey.clear();
  }

  get size(): number {
    return this.entriesByKey.size;
  }
}

const identities = new LruTtlCache<string, AccountIdentity>(REQUEST_IDENTITY_CACHE_MAX_ENTRIES);
const worldSessionCache = new LruTtlCache<string, CachedWorldSession>(REQUEST_IDENTITY_CACHE_MAX_ENTRIES);
const prefetchedWorldSessions = new WeakMap<AccountIdentity, Map<string, CachedWorldSession | null>>();
let membershipListenerConnected = false;

export function requestIdentityCacheEnabled(): boolean {
  return process.env.MUDD_IDENTITY_CACHE === '1';
}

function worldSessionKey(playerId: string, worldInstanceId: string): string {
  return `${playerId}\u0000${worldInstanceId}`;
}

export function getCachedIdentity(key: string): AccountIdentity | undefined {
  return identities.get(key);
}

export function setCachedIdentity(key: string, identity: AccountIdentity, expiresAt: number): void {
  identities.set(key, identity, expiresAt);
}

export function invalidateCachedIdentity(key: string): void {
  identities.delete(key);
}

export function invalidateCachedIdentitiesForPlayer(playerId: string): void {
  identities.deleteWhere((_key, identity) => identity.playerId === playerId);
}

export function getCachedWorldSession(
  playerId: string,
  worldInstanceId: string,
): CachedWorldSession | undefined {
  if (!membershipListenerConnected) return undefined;
  return worldSessionCache.get(worldSessionKey(playerId, worldInstanceId));
}

export function setCachedWorldSession(session: CachedWorldSession): void {
  if (!membershipListenerConnected) return;
  worldSessionCache.set(
    worldSessionKey(session.playerId, session.worldInstanceId),
    session,
    Date.now() + REQUEST_IDENTITY_CACHE_TTL_MS,
  );
}

export function updateCachedWorldSessionPresence(
  playerId: string,
  worldInstanceId: string,
  sessionId: string,
  lastSeenAt: Date,
): void {
  const key = worldSessionKey(playerId, worldInstanceId);
  const existing = getCachedWorldSession(playerId, worldInstanceId);
  if (!existing || existing.id !== sessionId) return;
  worldSessionCache.set(key, { ...existing, lastSeenAt }, Date.now() + REQUEST_IDENTITY_CACHE_TTL_MS);
}

export function invalidateCachedWorldSession(playerId: string, worldInstanceId: string): void {
  worldSessionCache.delete(worldSessionKey(playerId, worldInstanceId));
}

export function invalidateCachedWorldSessionsForPlayer(playerId: string): void {
  worldSessionCache.deleteWhere((_key, session) => session.playerId === playerId);
}

export function invalidateCachedPlayer(
  playerId: string,
  worldInstanceId?: string,
): void {
  invalidateCachedIdentitiesForPlayer(playerId);
  if (worldInstanceId) invalidateCachedWorldSession(playerId, worldInstanceId);
  else invalidateCachedWorldSessionsForPlayer(playerId);
}

/** A membership listener outage disables cached authorization until it reconnects. */
export function setMembershipListenerConnected(connected: boolean): void {
  if (!connected || !membershipListenerConnected) worldSessionCache.clear();
  membershipListenerConnected = connected;
}

export function clearRequestIdentityCachesForTests(): void {
  identities.clear();
  worldSessionCache.clear();
  membershipListenerConnected = false;
}

export function rememberPrefetchedWorldSession(
  identity: AccountIdentity,
  worldInstanceId: string,
  session: CachedWorldSession | null,
): void {
  const sessionsForIdentity = prefetchedWorldSessions.get(identity) ?? new Map();
  sessionsForIdentity.set(worldInstanceId, session);
  prefetchedWorldSessions.set(identity, sessionsForIdentity);
}

export function takePrefetchedWorldSession(
  identity: AccountIdentity,
  worldInstanceId: string,
): { resolved: boolean; session?: CachedWorldSession } {
  const sessionsForIdentity = prefetchedWorldSessions.get(identity);
  if (!sessionsForIdentity?.has(worldInstanceId)) return { resolved: false };
  const session = sessionsForIdentity.get(worldInstanceId) ?? null;
  sessionsForIdentity.delete(worldInstanceId);
  if (sessionsForIdentity.size === 0) prefetchedWorldSessions.delete(identity);
  return session ? { resolved: true, session } : { resolved: true };
}
