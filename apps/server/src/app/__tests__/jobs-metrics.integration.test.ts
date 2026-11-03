import { describe, expect, it, vi } from 'vitest';
import { useServerHarness, state, instanceId } from './server-harness.js';

describe('jobs-metrics through the server', () => {
  const harness = useServerHarness();
  const { enterWorld } = harness;
  it('emits structured measurements for an explicitly traced snapshot request', async () => {
    const traceId = '3b47bd31-7242-40fb-9d8f-4d3a1d9f6e4f';
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${harness.baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-trace-id': traceId,
          'x-mudd-trace-phase': 'snapshot',
        },
      });
      expect(response.status).toBe(409);
      await response.json();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response.headers.get('x-mudd-trace-id')).toBe(traceId);
      expect(infoLog).toHaveBeenCalledWith(expect.stringContaining('"event":"mudd_traced_http_request"'));
    } finally {
      infoLog.mockRestore();
    }
  });

  it('logs durable-effect failures and prevents overlapping batches', async () => {
    await enterWorld('alice', 'character-alice');
    const request = () => fetch(`${harness.baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'x-test-user': 'alice',
        'x-mudd-world-instance': instanceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ characterId: 'character-alice' }),
    });

    state.processPendingEffectsError = new Error('effect storage unavailable');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failureResponse = await request();
      expect(failureResponse.status).toBe(200);
      expect(errorLog).toHaveBeenCalledWith('Could not process durable event effects.');
    } finally {
      errorLog.mockRestore();
    }

    let releaseBatch: () => void = () => undefined;
    state.processPendingEffectsGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    const startedBefore = state.processPendingEffectsStarted;
    const first = request();
    for (let attempt = 0;attempt < 20 && state.processPendingEffectsStarted === startedBefore;attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(state.processPendingEffectsStarted).toBeGreaterThan(startedBefore);

    const secondResponse = await request();
    expect(secondResponse.status).toBe(200);
    releaseBatch();
    expect((await first).status).toBe(200);
    state.processPendingEffectsGate = null;
  });

  it('reports autonomous scheduler errors', async () => {
    expect(state.autonomousSchedulers.length).toBeGreaterThan(0);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = state.autonomousSchedulers[0];
    scheduler?.options.onError(new Error('scheduler failure'), 'mara');
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('NPC mara'),
      expect.any(Error),
    );
    errorLog.mockRestore();
  });

  it('lists recovery sessions and reports stamina scheduler failures', async () => {
    const scheduler = state.staminaSchedulers[0];
    if (!scheduler) throw new Error('Stamina recovery scheduler was not registered.');

    await enterWorld('alice', 'character-alice');
    const sessions = await scheduler.options.listSessions();
    expect(sessions).toHaveLength(1);
    expect(await scheduler.options.listSessions(new Date())).toBeDefined();

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      scheduler.options.onError(new Error('recovery failure'), 'character-alice');
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('character character-alice'),
        expect.any(Error),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('reports lifecycle failures with or without a specific world object', () => {
    const onError = state.objectLifecycleErrorHandlers[0];
    if (!onError) throw new Error('Object lifecycle scheduler was not registered.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      onError(new Error('decay failure'), instanceId, 'corpse-1');
      onError(new Error('cleanup failure'), instanceId);

      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('Could not expire world object corpse-1'),
        expect.any(Error),
      );
      expect(errorLog).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`Could not expire world object in ${instanceId}`),
        expect.any(Error),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('expires and cancels stale interaction requests on the scheduled maintenance tick', async () => {
    const callback = state.intervalCallbacks.find(({ delay }) => delay === 2_000)?.callback;
    if (!callback) throw new Error('Interaction-maintenance interval was not registered.');
    await enterWorld('alice', 'character-alice');
    (state.sessions.get('player-alice') as { lastSeenAt: Date; }).lastSeenAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, 10));

    state.interactionMaintenanceRequests.push(
      {
        requestId: 'already-settled',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        initiatorCharacterId: 'character-alice',
        recipientCharacterId: 'character-bob',
      },
      {
        requestId: 'expired-request',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        initiatorCharacterId: 'character-alice',
        recipientCharacterId: 'character-bob',
      },
      {
        requestId: 'offline-recipient',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        initiatorCharacterId: 'character-alice',
        recipientCharacterId: 'character-bob',
      },
    );

    callback();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.interactionStatusUpdates.map(([, , requestId, status]) => [requestId, status])).toEqual([
      ['expired-request', 'expired'],
      ['offline-recipient', 'cancelled'],
    ]);

    state.interactionStatusUpdates.length = 0;
    state.interactionMaintenanceRequests.length = 0;
    let releaseRead: () => void = () => undefined;
    state.readStreamGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    callback();
    callback();
    releaseRead();
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.readStreamGate = null;
    expect(state.interactionStatusUpdates).toEqual([]);

    state.readStreamError = new Error('Interaction stream read failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      callback();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(errorLog).toHaveBeenCalledWith('Could not process pending player interaction requests.');
    } finally {
      state.readStreamError = null;
      errorLog.mockRestore();
    }
  });
});
