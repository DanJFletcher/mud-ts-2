import { describe, expect, it } from 'vitest';
import type { AccountIdentity } from './session-service.js';
import {
  clearRequestIdentityCachesForTests,
  getCachedIdentity,
  getCachedWorldSession,
  invalidateCachedPlayer,
  LruTtlCache,
  REQUEST_IDENTITY_CACHE_MAX_ENTRIES,
  REQUEST_IDENTITY_CACHE_TTL_MS,
  setCachedIdentity,
  setCachedWorldSession,
  setMembershipListenerConnected,
  updateCachedWorldSessionPresence,
  type CachedWorldSession,
} from './request-identity-cache.js';

function worldSession(overrides: Partial<CachedWorldSession> = {}): CachedWorldSession {
  return {
    id: 'session-one',
    playerId: 'player-one',
    worldInstanceId: 'world-one',
    characterId: 'character-one',
    lastSeenAt: new Date('2026-10-30T12:00:00.000Z'),
    ...overrides,
  } as CachedWorldSession;
}

function identity(playerId: string): AccountIdentity {
  return {
    playerId,
    displayName: 'Traveler',
    clearGuestCookie: false,
    isGuest: false,
    session: {
      sessionId: 'auth-session',
      playerId,
      actorId: playerId,
      worldInstanceId: 'world-one',
      grantedPermissions: [],
      authenticated: true,
    },
  };
}

describe('request identity and world-session caches', () => {
  it('expires entries and evicts the least recently used entry at capacity', () => {
    const cache = new LruTtlCache<string, string>(2);
    cache.set('first', 'one', 1_000, 0);
    cache.set('second', 'two', 1_000, 0);
    expect(cache.get('first', 1)).toBe('one');
    cache.set('third', 'three', 1_000, 1);

    expect(cache.get('second', 2)).toBeUndefined();
    expect(cache.get('first', 2)).toBe('one');
    expect(cache.get('third', 1_000)).toBeUndefined();
    expect(cache.get('first', 1_000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('rejects invalid cache capacities', () => {
    expect(() => new LruTtlCache<string, string>(0)).toThrow(
      'An LRU cache must have a positive integer capacity.',
    );
  });

  it('bounds many-player cache growth at the configured capacity', () => {
    const cache = new LruTtlCache<number, number>(REQUEST_IDENTITY_CACHE_MAX_ENTRIES);
    for (let playerIndex = 0; playerIndex <= REQUEST_IDENTITY_CACHE_MAX_ENTRIES; playerIndex++) {
      cache.set(playerIndex, playerIndex, Number.POSITIVE_INFINITY, playerIndex);
    }

    expect(cache.size).toBe(REQUEST_IDENTITY_CACHE_MAX_ENTRIES);
    expect(cache.get(0, REQUEST_IDENTITY_CACHE_MAX_ENTRIES + 1)).toBeUndefined();
    expect(cache.get(REQUEST_IDENTITY_CACHE_MAX_ENTRIES, REQUEST_IDENTITY_CACHE_MAX_ENTRIES + 1))
      .toBe(REQUEST_IDENTITY_CACHE_MAX_ENTRIES);
  });

  it('updates cached presence and clears session entries when membership notifications disconnect', () => {
    clearRequestIdentityCachesForTests();
    setMembershipListenerConnected(true);
    setCachedWorldSession(worldSession());
    const touchedAt = new Date('2026-10-30T12:01:00.000Z');
    updateCachedWorldSessionPresence('player-one', 'world-one', 'session-one', touchedAt);
    expect(getCachedWorldSession('player-one', 'world-one')?.lastSeenAt).toEqual(touchedAt);

    setMembershipListenerConnected(false);
    expect(getCachedWorldSession('player-one', 'world-one')).toBeUndefined();
    setMembershipListenerConnected(true);
    expect(getCachedWorldSession('player-one', 'world-one')).toBeUndefined();
  });

  it('invalidates all identity entries and only the specified world session for a player', () => {
    clearRequestIdentityCachesForTests();
    setMembershipListenerConnected(true);
    const expiresAt = Date.now() + REQUEST_IDENTITY_CACHE_TTL_MS;
    setCachedIdentity('clerk:user-one', identity('player-one'), expiresAt);
    setCachedWorldSession(worldSession());
    setCachedWorldSession(worldSession({ id: 'session-two', worldInstanceId: 'world-two' }));

    invalidateCachedPlayer('player-one', 'world-one');

    expect(getCachedIdentity('clerk:user-one')).toBeUndefined();
    expect(getCachedWorldSession('player-one', 'world-one')).toBeUndefined();
    expect(getCachedWorldSession('player-one', 'world-two')?.id).toBe('session-two');
  });
});
