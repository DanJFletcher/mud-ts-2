import { describe, expect, it, vi } from 'vitest';
import type { EngineHost, EventStorePort, StoredGameEvent } from '@mudd/engine-core';
import { resolveStaminaRecovery } from '@mudd/contracts';
import { createStaminaRecoveryScheduler } from './stamina-recovery-scheduler.js';

function characterEvents(
  anchorAt: string | null,
  lowHealthWithFullResources = false,
  healthCurrent = 1,
  manaCurrent = 100,
): StoredGameEvent[] {
  const attributes = { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 };
  const characterClass = {
    id: 'test-scout',
    revision: 1,
    catalogId: 'test-catalog',
    catalogRevision: 1,
    label: 'Scout',
    description: 'A test class.',
    primaryAttribute: 'dexterity',
    attributes,
    coreAction: {
      id: 'test-action',
      revision: 1,
      label: 'Quick strike',
      description: 'A test action.',
      cost: { resource: 'stamina' as const, amount: 1 },
      baseDamage: 1,
      scalingAttribute: 'dexterity' as const,
      weaponBonus: false,
    },
  };
  const created: StoredGameEvent = {
    type: 'character.created',
    version: lowHealthWithFullResources ? 3 : 2,
    eventId: 'created',
    worldInstanceId: 'world',
    streamId: 'character',
    aggregateId: 'character',
    aggregateVersion: 1,
    causationCommandId: 'create',
    actorId: 'player',
    occurredAt: '2026-10-23T11:59:00.000Z',
    tick: 1,
    payload: {
      characterId: 'character',
      playerId: 'player',
      name: 'Mira',
      startingLocationId: 'room',
      resources: {
        stamina: { current: lowHealthWithFullResources ? 100 : 0, maximum: 100 },
        mana: { current: manaCurrent, maximum: 100 },
      },
      ...(lowHealthWithFullResources ? {
        attributes,
        characterClass,
        health: { current: healthCurrent, maximum: 6 },
      } : {}),
    },
  };
  if (!anchorAt) return [created];
  const base = {
    posture: 'standing' as const,
    lastSettledAt: null,
    fractionalCarry: 0,
  };
  const recovered = resolveStaminaRecovery(
    { current: 0, maximum: 100 },
    base,
    new Date(anchorAt),
  );
  return [created, {
    ...created,
    type: 'character.stamina_recovery_settled',
    version: 1,
    eventId: 'recovery',
    aggregateVersion: 2,
    causationCommandId: 'settle',
    occurredAt: anchorAt,
    payload: {
      characterId: 'character',
      resources: {
        stamina: recovered.stamina,
        mana: { current: 100, maximum: 100 },
      },
      recovery: recovered.recovery,
    },
  }];
}

describe('online stamina recovery scheduler', () => {
  it('reconciles offline history once rather than replaying it every tick', async () => {
    const now = new Date('2026-10-23T12:05:00.000Z');
    const readStream = vi.fn(async () => characterEvents('2026-10-23T11:59:50.000Z'));
    const listSessions = vi.fn(async () => [{
      characterId: 'character', lastSeenAt: new Date('2026-10-23T12:00:00.000Z'),
    }]);
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem: async () => ({ receipt: { ok: true }, events: [] }) } as unknown as EngineHost,
      store: { readStream }, worldInstanceId: 'world', listSessions, now: () => now,
    });
    await scheduler.tick(); await scheduler.tick(); await scheduler.tick();
    expect(readStream).toHaveBeenCalledTimes(1);
    expect(listSessions.mock.calls[0]).toEqual([undefined]);
    expect(listSessions.mock.calls[1]).toEqual([new Date(now.getTime() - 45_000)]);
  });

  it('retries a failed offline final settlement before retiring it', async () => {
    const now = new Date('2026-10-23T12:05:00.000Z');
    const dispatchSystem = vi.fn()
      .mockResolvedValueOnce({ receipt: { ok: false, code: 'VERSION_CONFLICT' } })
      .mockResolvedValue({ receipt: { ok: true } });
    const readStream = vi.fn(async () => characterEvents('2026-10-23T11:59:50.000Z'));
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: { readStream }, worldInstanceId: 'world',
      listSessions: async () => [{ characterId: 'character', lastSeenAt: new Date('2026-10-23T12:00:00.000Z') }],
      now: () => now,
    });
    await scheduler.tick(); await scheduler.tick(); await scheduler.tick();
    expect(dispatchSystem).toHaveBeenCalledTimes(2);
  });
  it('settles only through the last confirmed heartbeat and skips unanchored offline sessions', async () => {
    const now = new Date('2026-10-23T12:05:00.000Z');
    const dispatchSystem = vi.fn(async () => ({
      receipt: { ok: true, commandId: 'recovery', eventIds: [], newAggregateVersion: 3 },
      events: [],
    }));
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: { readStream: async () => characterEvents('2026-10-23T11:59:50.000Z') } as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions: async () => [{
        characterId: 'character',
        lastSeenAt: new Date('2026-10-23T12:00:00.000Z'),
      }],
      now: () => now,
    });

    expect(await scheduler.tick()).toBe(1);
    expect(dispatchSystem).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 2,
      payload: {
        settleAt: '2026-10-23T12:00:00.000Z',
        resetAnchor: false,
      },
    }), expect.any(String));
    expect(await scheduler.tick()).toBe(0);
    expect(dispatchSystem).toHaveBeenCalledTimes(1);
  });

  it('does not mint offline stamina when an old stream has no recovery anchor', async () => {
    const dispatchSystem = vi.fn();
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: { readStream: async () => characterEvents(null) } as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions: async () => [{
        characterId: 'character',
        lastSeenAt: new Date('2026-10-23T11:00:00.000Z'),
      }],
      now: () => new Date('2026-10-23T12:00:00.000Z'),
    });
    expect(await scheduler.tick()).toBe(0);
    expect(dispatchSystem).not.toHaveBeenCalled();
  });

  it('settles low health even when stamina and mana are already full', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const dispatchSystem = vi.fn(async () => ({
      receipt: { ok: true, commandId: 'recovery', eventIds: [], newAggregateVersion: 2 },
      events: [],
    }));
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: {
        readStream: async () => characterEvents(null, true),
      } as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions: async () => [{
        characterId: 'character',
        lastSeenAt: now,
      }],
      now: () => now,
    });
    expect(await scheduler.tick()).toBe(1);
    expect(dispatchSystem).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 1,
      payload: { settleAt: now.toISOString(), resetAnchor: false },
    }), expect.any(String));
  });

  it('settles low mana even when health and stamina are already full', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const dispatchSystem = vi.fn();
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: {
        readStream: async () => characterEvents(null, true, 6, 50),
      } as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions: async () => [{
        characterId: 'character',
        lastSeenAt: now,
      }],
      now: () => now,
    });
    expect(await scheduler.tick()).toBe(1);
    expect(dispatchSystem).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 'character',
      payload: { settleAt: now.toISOString(), resetAnchor: false },
    }), expect.any(String));
  });

  it('does not dispatch recovery for a dead character', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const dispatchSystem = vi.fn();
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: {
        readStream: async () => characterEvents(null, true, 0),
      } as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions: async () => [{
        characterId: 'character',
        lastSeenAt: now,
      }],
      now: () => now,
    });
    expect(await scheduler.tick()).toBe(0);
    expect(dispatchSystem).not.toHaveBeenCalled();
  });

  it('skips recovery when every vital is full and no fractional carry remains', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const dispatchSystem = vi.fn();
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: {
        readStream: async () => characterEvents(null, true, 6, 100),
      } as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions: async () => [{ characterId: 'character', lastSeenAt: now }],
      now: () => now,
    });

    expect(await scheduler.tick()).toBe(0);
    expect(dispatchSystem).not.toHaveBeenCalled();
  });

  it('reports rejected recovery commands and retries thrown dispatches', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const onError = vi.fn();
    const rejectedScheduler = createStaminaRecoveryScheduler({
      engine: {
        dispatchSystem: async () => ({
          receipt: { ok: false, code: 'RULE_VIOLATION', message: 'Recovery rejected.' },
        }),
      } as unknown as EngineHost,
      store: { readStream: async () => characterEvents(null) },
      worldInstanceId: 'world',
      listSessions: async () => [{ characterId: 'character', lastSeenAt: now }],
      now: () => now,
      onError,
    });
    expect(await rejectedScheduler.tick()).toBe(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Recovery rejected.' }), 'character');

    const dispatchSystem = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary engine failure.'))
      .mockResolvedValue({ receipt: { ok: true } });
    const retryScheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem } as unknown as EngineHost,
      store: { readStream: async () => characterEvents(null) },
      worldInstanceId: 'world',
      listSessions: async () => [{ characterId: 'character', lastSeenAt: now }],
      now: () => now,
      onError,
    });
    expect(await retryScheduler.tick()).toBe(0);
    expect(await retryScheduler.tick()).toBe(1);
    expect(dispatchSystem).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), 'character');
  });

  it('starts and stops its polling timer idempotently', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const listSessions = vi.fn(async () => []);
    const scheduler = createStaminaRecoveryScheduler({
      engine: { dispatchSystem: vi.fn() } as unknown as EngineHost,
      store: { readStream: vi.fn() } as unknown as Pick<EventStorePort, 'readStream'>,
      worldInstanceId: 'world',
      listSessions,
    });

    try {
      scheduler.start();
      scheduler.start();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      scheduler.stop();
      scheduler.stop();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.stop();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
