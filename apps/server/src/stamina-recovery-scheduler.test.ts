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
    const command = dispatchSystem.mock.calls[0]?.[0] as { commandId: string };
    expect(await scheduler.tick()).toBe(1);
    expect((dispatchSystem.mock.calls[1]?.[0] as { commandId: string }).commandId).toBe(command.commandId);
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
});
