import { describe, expect, it, vi } from 'vitest';
import { useServerHarness, state, instanceId } from './server-harness.js';

describe('auth-security through the server', () => {
  const harness = useServerHarness();
  const { enterWorld } = harness;
  it('starts a guest session and accepts its cookie on account APIs', async () => {
    const start = await fetch(`${harness.baseUrl}/api/guest-session`, { method: 'POST' });
    expect(start.status).toBe(200);
    expect(start.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(start.headers.get('set-cookie')).not.toContain('player-guest');

    const roster = await fetch(`${harness.baseUrl}/api/characters`, {
      headers: { cookie: 'mudd_guest=test-guest-token' },
    });
    expect(roster.status).toBe(200);
    expect(await roster.json()).toMatchObject({
      player: { id: 'player-guest', displayName: 'Guest Traveler' },
      characters: [],
      activeWorldSession: null,
    });
  });

  it('serves health checks and prevents signed-in users from starting guest sessions', async () => {
    const health = await fetch(`${harness.baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const guestSession = await fetch(`${harness.baseUrl}/api/guest-session`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });
    expect(guestSession.status).toBe(409);
    expect(await guestSession.json()).toEqual({
      message: 'Sign out before starting a guest session.',
    });
  });

  it('routes guest-session creation failures through standard error handling', async () => {
    state.guestIdentityError = new Error('Guest identity unavailable.');

    const response = await fetch(`${harness.baseUrl}/api/guest-session`, { method: 'POST' });

    expect(response.status).toBe(500);
  });

  it('rejects world actions for zero-health and defeated characters', async () => {
    await enterWorld('alice', 'character-alice');
    const postMovement = (commandId: string) => fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'character.move',
        version: 1,
        commandId,
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        expectedVersion: 0,
        payload: { exitId: 'exit-north' },
      }),
    });
    const healthyCharacter = state.characters['character-alice'];
    const defeatedProjections = [
      ['zero-health-block', { ...healthyCharacter, health: { current: 0, maximum: 10 } }],
      ['defeat-status-block', { ...healthyCharacter, combat: { status: 'defeat' } }],
    ] as const;

    for (const [commandId, projection] of defeatedProjections) {
      state.characterReplayOverride = projection;
      const response = await postMovement(commandId);
      expect(response.status, commandId).toBe(409);
      expect(await response.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
    }
    expect(state.moveReceipts.size).toBe(0);
    expect(state.characters['character-alice'].locationId).toBe('npc-room');
  });

  it('returns safe status codes and request IDs for unexpected route errors', async () => {
    await enterWorld('alice', 'character-alice');
    const query = {
      type: 'party.info',
      version: 1,
      queryId: 'unexpected-query-error',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    };
    const postQuery = () => fetch(`${harness.baseUrl}/api/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(query),
    });
    const cases: Array<{ error: unknown; status: number; }> = [
      { error: Object.assign(new Error('unprocessable'), { status: 422 }), status: 422 },
      { error: Object.assign(new Error('out of range'), { status: 399 }), status: 500 },
      { error: 'unstructured failure', status: 500 },
    ];
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const testCase of cases) {
        state.queryOverrides.set('party.info', () => {
          throw testCase.error;
        });
        const response = await postQuery();
        expect(response.status).toBe(testCase.status);
        const body = await response.json() as { message: string; requestId: string; };
        expect(body.message).toBe('The game server could not complete that request.');
        expect(body.requestId).toBe(response.headers.get('x-request-id'));
      }
    } finally {
      state.queryOverrides.delete('party.info');
      errorLog.mockRestore();
    }
  });

  it('returns a specific error when JSON request bodies exceed the configured limit', async () => {
    const response = await fetch(`${harness.baseUrl}/api/queries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(17 * 1024) }),
    });

    expect(response.status).toBe(413);
    const body = await response.json() as { message: string; requestId: string; };
    expect(body).toMatchObject({ message: 'The request body is too large.' });
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
  });
});
