import { describe, expect, it, vi } from 'vitest';
import { getCachedWorldSession } from '../../auth/request-identity-cache.js';
import { useServerHarness, state, instanceId } from './server-harness.js';

describe('world-sessions through the server', () => {
  const harness = useServerHarness();
  const { enterWorld } = harness;
  it('forwards session-entry and session-leave storage failures to error handling', async () => {
    state.readStreamError = new Error('Character history unavailable.');
    const entry = await fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'x-test-user': 'alice',
        'x-mudd-world-instance': instanceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ characterId: 'character-alice' }),
    });
    expect(entry.status).toBe(500);

    state.readStreamError = null;
    state.deleteSessionError = new Error('Session storage unavailable.');
    const leave = await fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'alice', 'x-mudd-world-instance': instanceId },
    });
    expect(leave.status).toBe(500);
  });

  it('lists registered worlds without requiring an account', async () => {
    const response = await fetch(`${harness.baseUrl}/api/worlds`);
    expect(response.status).toBe(200);
    const worlds = await response.json() as Array<{
      worldInstanceId: string;
      packId: string;
      summary: string;
    }>;
    expect(worlds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        worldInstanceId: instanceId,
        packId: state.world.packId,
        summary: expect.any(String),
      }),
    ]));
  });

  it('lists only the signed-in player’s characters and selected world sessions', async () => {
    const unauthorized = await fetch(`${harness.baseUrl}/api/characters`);
    expect(unauthorized.status).toBe(401);

    const headers = { 'x-test-user': 'alice' };
    const rosterBeforeEntry = await fetch(`${harness.baseUrl}/api/characters`, { headers });
    expect(rosterBeforeEntry.status).toBe(200);
    expect(await rosterBeforeEntry.json()).toMatchObject({
      player: { id: 'player-alice', displayName: 'Alice' },
      characters: [expect.objectContaining({
        characterId: 'character-alice',
        locationTitle: 'NPC Room',
        lastPlayedAt: null,
      })],
      activeWorldSession: null,
      activeWorldSessions: [],
    });

    await enterWorld('alice', 'character-alice');
    const rosterInWorld = await fetch(`${harness.baseUrl}/api/characters`, { headers });
    expect(rosterInWorld.status).toBe(200);
    expect(await rosterInWorld.json()).toMatchObject({
      player: { id: 'player-alice', displayName: 'Alice' },
      characters: [expect.objectContaining({
        characterId: 'character-alice',
        locationTitle: 'NPC Room',
        lastPlayedAt: expect.any(String),
      })],
      activeWorldSession: {
        id: expect.any(String),
        characterId: 'character-alice',
      },
      activeWorldSessions: [{
        worldInstanceId: instanceId,
        id: expect.any(String),
        characterId: 'character-alice',
      }],
    });
  });

  it('loads a character roster through the event store batch-read API', async () => {
    state.batchReadStreams = true;

    const response = await fetch(`${harness.baseUrl}/api/characters`, {
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      characters: [expect.objectContaining({
        characterId: 'character-alice',
        locationTitle: 'NPC Room',
      })],
    });
  });

  it('validates world-session requests and reports unavailable characters', async () => {
    const postSession = (body: unknown) => fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const malformed = await postSession({ characterId: '' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ message: 'Choose a valid character.' });

    const wrongWorld = await postSession({
      characterId: 'character-alice',
      worldInstanceId: 'another-world',
    });
    expect(wrongWorld.status).toBe(400);
    expect(await wrongWorld.json()).toEqual({
      message: 'Choose a character from the selected world.',
    });

    const unavailable = await postSession({ characterId: 'character-does-not-exist' });
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toEqual({ message: 'That character is unavailable.' });
    expect(state.sessions.size).toBe(0);
  });

  it('rejects world entry for defeated characters and blocks switching while occupied', async () => {
    const postSession = (body: unknown) => fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });
    state.characterReplayOverride = {
      ...state.characters['character-alice'],
      health: { current: 0, maximum: 10 },
    };
    const defeated = await postSession({ characterId: 'character-alice' });
    expect(defeated.status).toBe(409);
    expect(await defeated.json()).toEqual({
      message: 'Your character has died. Start a new character to begin again.',
    });
    expect(state.sessions.size).toBe(0);

    state.characterReplayOverride = null;
    await enterWorld('alice', 'character-alice');
    const originalOwner = state.charactersByOwner['character-bob'];
    state.charactersByOwner['character-bob'] = 'player-alice';
    try {
      const occupied = await postSession({ characterId: 'character-bob' });
      expect(occupied.status).toBe(409);
      expect(await occupied.json()).toEqual({
        message: 'Leave the current world session before switching characters.',
      });
      expect(state.sessions.get('player-alice')).toMatchObject({
        characterId: 'character-alice',
      });
    } finally {
      state.charactersByOwner['character-bob'] = originalOwner;
    }
  });

  it('clears the cached world session after archiving a character', async () => {
    vi.stubEnv('MUDD_IDENTITY_CACHE', '1');
    const originalOwner = state.charactersByOwner['character-bob'];
    state.charactersByOwner['character-bob'] = 'player-alice';
    await enterWorld('alice', 'character-alice');
    try {
      const warmSnapshot = await fetch(`${harness.baseUrl}/api/game`, {
        headers: { 'x-test-user': 'alice' },
      });
      expect(warmSnapshot.status).toBe(200);
      expect(getCachedWorldSession('player-alice', instanceId)).toMatchObject({
        characterId: 'character-alice',
      });

      state.nextCommandResult = {
        receipt: { ok: true, commandId: 'archive-non-active-character' },
        commitOutcome: 'committed',
      };
      const response = await fetch(`${harness.baseUrl}/api/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'alice',
        },
        body: JSON.stringify({
          type: 'character.archive',
          version: 1,
          commandId: 'archive-non-active-character',
          worldInstanceId: instanceId,
          characterId: 'character-bob',
          expectedVersion: 0,
          payload: {},
        }),
      });

      expect(response.status).toBe(200);
      expect(getCachedWorldSession('player-alice', instanceId)).toBeUndefined();
    } finally {
      state.charactersByOwner['character-bob'] = originalOwner;
      vi.unstubAllEnvs();
    }
  });

  it('reuses a warm world session and invalidates it on membership notifications', async () => {
    vi.stubEnv('MUDD_IDENTITY_CACHE', '1');
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const traceIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ];
    const readsBeforeSnapshots = state.worldSessionSelectCount;
    const requestGame = async (traceId: string) => fetch(`${harness.baseUrl}/api/game`, {
      headers: {
        'x-test-user': 'alice',
        'x-mudd-trace-id': traceId,
        'x-mudd-trace-phase': 'snapshot',
      },
    });
    const traceFor = (traceId: string) => infoLog.mock.calls
      .map(([message]) => {
        try { return JSON.parse(String(message)) as { traceId?: string; measurements?: { databaseOperations?: unknown[]; worldSessionCacheHits?: number; worldSessionCacheMisses?: number; }; }; }
        catch { return undefined; }
      })
      .find((entry) => entry?.traceId === traceId);

    try {
      await enterWorld('alice', 'character-alice');
      for (const traceId of traceIds.slice(0, 2)) {
        expect((await requestGame(traceId)).status).toBe(200);
      }
      const readsAfterWarmSnapshot = state.worldSessionSelectCount;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const first = traceFor(traceIds[0]!);
      const warm = traceFor(traceIds[1]!);
      expect(first?.measurements?.worldSessionCacheMisses).toBe(1);
      expect(warm?.measurements?.worldSessionCacheHits).toBe(1);
      expect(readsAfterWarmSnapshot).toBeGreaterThan(readsBeforeSnapshots);
      expect(state.worldSessionSelectCount).toBe(readsAfterWarmSnapshot);
      expect(getCachedWorldSession('player-alice', instanceId)).toMatchObject({
        characterId: 'character-alice',
      });

      const notifications = state.realtimeNotificationCallbacks;
      if (!notifications) throw new Error('Realtime notification callbacks were not registered.');
      notifications.invalidate({ world: instanceId, kind: 'membership', playerId: 'player-alice' });
      expect(getCachedWorldSession('player-alice', instanceId)).toBeUndefined();

      expect((await requestGame(traceIds[2]!)).status).toBe(200);
      const readsAfterInvalidation = state.worldSessionSelectCount;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(readsAfterInvalidation).toBe(readsAfterWarmSnapshot + 1);
      expect(traceFor(traceIds[2]!)?.measurements?.worldSessionCacheMisses).toBe(1);
    } finally {
      infoLog.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('fails explicitly when a character row has no creation event in its stream', async () => {
    state.streamlessCharacterIds.add('character-alice');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${harness.baseUrl}/api/characters`, {
        headers: { 'x-test-user': 'alice' },
      });
      const body = await response.json() as { requestId: string; };

      expect(response.status).toBe(500);
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      state.streamlessCharacterIds.clear();
      errorLog.mockRestore();
    }
  });

  it('fails explicitly when an owned character references an unregistered world', async () => {
    state.characterWorldInstanceOverrides.set('character-alice', 'missing-world');

    const response = await fetch(`${harness.baseUrl}/api/characters`, {
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      requestId: response.headers.get('x-request-id'),
    });
  });

  it('refreshes an active session heartbeat and removes only the leaving player session', async () => {
    const heartbeat = (userId: string) => fetch(`${harness.baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': userId },
    });
    const noSession = await heartbeat('alice');
    expect(noSession.status).toBe(409);

    await enterWorld('alice', 'character-alice');
    await enterWorld('bob', 'character-bob');
    const aliceSession = state.sessions.get('player-alice') as { lastSeenAt?: Date; };
    aliceSession.lastSeenAt = new Date();

    const refreshed = await heartbeat('alice');
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual({
      worldInstanceId: instanceId,
      locationId: 'npc-room',
      occupants: [],
    });

    const left = await fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'alice' },
    });
    expect(left.status).toBe(204);
    expect(state.sessions.has('player-alice')).toBe(false);
    expect(state.sessions.has('player-bob')).toBe(true);

    const noLongerInWorld = await fetch(`${harness.baseUrl}/api/game`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(noLongerInWorld.status).toBe(409);
  });

  it('rejects archived or defeated heartbeat characters and handles stream failures', async () => {
    await enterWorld('alice', 'character-alice');
    const character = state.characters['character-alice'];
    const savedCharacter = structuredClone(character);
    const heartbeat = () => fetch(`${harness.baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });

    try {
      Object.assign(character, { archived: true });
      const archived = await heartbeat();
      expect(archived.status).toBe(409);
      expect(await archived.json()).toEqual({
        message: 'Enter the world with an active character before sending presence.',
      });

      Object.assign(character, { archived: false, health: { current: 0 } });
      const defeated = await heartbeat();
      expect(defeated.status).toBe(409);
      expect(await defeated.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
    } finally {
      state.characters['character-alice'] = savedCharacter;
    }

    state.readStreamError = new Error('Heartbeat stream read failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failed = await heartbeat();
      expect(failed.status).toBe(500);
      expect(await failed.json()).toMatchObject({ requestId: expect.any(String) });
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      state.readStreamError = null;
      errorLog.mockRestore();
    }
  });

  it('returns a conflict when a stale heartbeat cannot re-read its character', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { lastSeenAt: Date; };
    session.lastSeenAt = new Date(Date.now() - 60_000);
    state.readStreamSequence.push(state.characters['character-alice'], null);

    const response = await fetch(`${harness.baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: 'Your character is no longer available.',
    });
  });

  it('retries stamina-anchor conflicts and safely reports exhaustion', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { lastSeenAt: Date; };
    session.lastSeenAt = new Date(Date.now() - 60_000);
    const commandCount = state.systemCommands.length;
    state.systemCommandResults.push(
      { receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'revision changed' } },
      { receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'revision changed' } },
      { receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'revision changed' } },
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${harness.baseUrl}/api/world-session/heartbeat`, {
        method: 'POST',
        headers: { 'x-test-user': 'alice' },
      });

      expect(response.status).toBe(500);
      expect(state.systemCommands).toHaveLength(commandCount + 3);
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('reports non-conflict stamina-anchor failures without retrying them', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { lastSeenAt: Date; };
    session.lastSeenAt = new Date(Date.now() - 60_000);
    const commandCount = state.systemCommands.length;
    state.systemCommandResults.push({
      receipt: { ok: false, code: 'RULE_VIOLATION', message: 'Recovery is unavailable.' },
    });

    const response = await fetch(`${harness.baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(500);
    expect(state.systemCommands).toHaveLength(commandCount + 1);
  });

  it('refreshes stale presence and resets recovery when heartbeating or re-entering', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { id: string; lastSeenAt?: Date; };
    const staleTime = () => new Date(Date.now() - 60 * 60 * 1000);
    const heartbeatAnchor = staleTime();
    session.lastSeenAt = heartbeatAnchor;

    const heartbeat = await fetch(`${harness.baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });
    expect(heartbeat.status).toBe(200);
    expect(state.presenceTouches).toHaveLength(1);
    expect(state.presenceTouches[0]).toEqual([
      'player-alice',
      instanceId,
      session.id,
    ]);
    expect(state.systemCommands).toHaveLength(2);
    expect(state.systemCommands[1]).toMatchObject({
      type: 'character.stamina.recover',
      version: 2,
      characterId: 'character-alice',
      payload: {
        settleAt: heartbeatAnchor.toISOString(),
        resetAnchorAt: expect.any(String),
      },
    });

    const reconnectAnchor = staleTime();
    session.lastSeenAt = reconnectAnchor;
    const reentered = await fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ characterId: 'character-alice' }),
    });
    expect(reentered.status).toBe(200);
    expect(state.presenceTouches).toHaveLength(2);
    expect(state.systemCommands).toHaveLength(3);
    expect(state.systemCommands[2]).toMatchObject({
      type: 'character.stamina.recover',
      version: 2,
      characterId: 'character-alice',
      payload: {
        settleAt: reconnectAnchor.toISOString(),
        resetAnchorAt: expect.any(String),
      },
    });
  });

  it('checks registered-world access and character ownership against the account', async () => {
    const authorization = state.engineAuthorizations[0] as {
      canAccessInstance: (session: { worldInstanceId: string; }, id: string) => Promise<boolean>;
      ownsCharacter: (session: {
        sessionId: string;
        playerId: string;
        actorId: string;
        worldInstanceId: string;
        grantedPermissions: never[];
        authenticated: true;
        selectedCharacterId?: string;
      }, characterId: string) => Promise<boolean>;
    } | undefined;
    if (!authorization) throw new Error('World runtime authorization was not registered.');

    expect(await authorization.canAccessInstance({ worldInstanceId: instanceId }, instanceId)).toBe(true);
    expect(await authorization.canAccessInstance({ worldInstanceId: instanceId }, 'missing-world')).toBe(false);

    const session = {
      sessionId: 'session-one',
      playerId: 'player-alice',
      actorId: 'player-alice',
      worldInstanceId: instanceId,
      grantedPermissions: [] as never[],
      authenticated: true as const,
    };
    expect(await authorization.ownsCharacter(session, 'character-alice')).toBe(true);
    expect(await authorization.ownsCharacter(session, 'character-bob')).toBe(false);
  });
});
