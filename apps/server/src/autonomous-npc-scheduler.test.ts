import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineHost, InMemoryEventStore } from '@mudd/engine-core';
import type { EventStorePort } from '@mudd/engine-core';
import type { WorldPackDraft } from '@mudd/contracts';
import {
  autonomousNpcsPlugin,
  autonomousNpcStreamId,
  mobileNpcDefinitions,
  projectAutonomousNpcPosition,
  projectAutonomousNpcPositionFromHead,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { ORRAVETH_WORLD_INSTANCE_ID, orravethWorld } from '@mudd/world-orraveth';
import { worldEventEffectsPlugin } from './demo-event-effects-plugin.js';
import {
  AUTONOMOUS_NPC_SYSTEM_ACTOR_ID,
  createAutonomousNpcScheduler,
} from './autonomous-npc-scheduler.js';

const { publishNpcMessage } = vi.hoisted(() => ({
  publishNpcMessage: vi.fn(),
}));

vi.mock('./room-chat-service.js', () => ({
  NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX: 'world-npc-movement:',
  getRoomChatMessageById: vi.fn(),
  getRoomChatMessageBySourceEffectId: vi.fn(),
  publishNpcRoomMessage: publishNpcMessage,
}));

const authorization = {
  canAccessInstance: async () => true,
  ownsCharacter: async () => true,
};

describe('autonomous NPC scheduler and room movement messages', () => {
  beforeEach(() => {
    publishNpcMessage.mockReset();
    publishNpcMessage.mockResolvedValue({});
  });

  it('moves configured NPCs without player commands and respects their intervals', async () => {
    let now = new Date('2026-10-21T12:00:00.000Z');
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin],
      store,
      authorization,
      demoWorld,
      () => globalThis.crypto.randomUUID(),
      () => now,
      { roll: (sides) => sides },
    );
    await engine.start();
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: demoWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
    });

    expect(await scheduler.tick()).toBe(2);
    expect(await scheduler.tick()).toBe(0);
    for (const npcId of ['mossgate-wandering-villager', 'mossgate-patrolling-guard']) {
      const events = await store.readStream(DEMO_WORLD_INSTANCE_ID, autonomousNpcStreamId(npcId));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('world.npc.moved');
    }

    now = new Date(now.getTime() + 60_000);
    expect(await scheduler.tick()).toBe(2);
    const guardEvents = await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      autonomousNpcStreamId('mossgate-patrolling-guard'),
    );
    expect(projectAutonomousNpcPosition(guardEvents, 'mossgate-patrolling-guard', 'mossgate-clearing'))
      .toMatchObject({ locationId: 'bell-tower-west', routeIndex: 2 });
    await engine.stop();
  });

  it('enforces at least one minute between rooms even when authored movement is faster', async () => {
    let now = new Date('2026-10-21T12:00:00.000Z');
    const fastWorld = structuredClone(demoWorld);
    for (const location of fastWorld.locations) {
      for (const npc of location.npcs ?? []) {
        if (npc.movement) npc.movement.intervalMs = 5_000;
      }
    }
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin],
      store,
      authorization,
      fastWorld,
      () => globalThis.crypto.randomUUID(),
      () => now,
      { roll: (sides) => sides },
    );
    await engine.start();

    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: fastWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
    });
    expect(await scheduler.tick()).toBe(2);

    now = new Date(now.getTime() + 5_000);
    expect(await scheduler.tick()).toBe(0);
    const directTick = await engine.dispatchSystem({
      type: 'world.npc.tick',
      version: 1,
      commandId: 'too-soon-direct-npc-tick',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      npcId: 'mossgate-patrolling-guard',
    }, AUTONOMOUS_NPC_SYSTEM_ACTOR_ID);
    expect(directTick.receipt.ok).toBe(false);

    const resumedScheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: fastWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
    });
    now = new Date(now.getTime() + 54_999);
    expect(await resumedScheduler.tick()).toBe(0);
    now = new Date(now.getTime() + 1);
    expect(await resumedScheduler.tick()).toBe(2);

    const guardEvents = await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      autonomousNpcStreamId('mossgate-patrolling-guard'),
    );
    expect(guardEvents).toHaveLength(2);
    await engine.stop();
  });

  it('publishes deduplicated departure and arrival narratives with actual reverse-exit directions', async () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin, worldEventEffectsPlugin],
      store,
      authorization,
      demoWorld,
      () => globalThis.crypto.randomUUID(),
      () => now,
      { roll: (sides) => sides },
    );
    await engine.start();
    const result = await engine.dispatchSystem({
      type: 'world.npc.tick',
      version: 1,
      commandId: 'movement-notification-test',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      npcId: 'mossgate-patrolling-guard',
    }, AUTONOMOUS_NPC_SYSTEM_ACTOR_ID);
    expect(result.receipt.ok).toBe(true);

    expect(await engine.processPendingEffects()).toBe(1);
    expect(await engine.processPendingEffects()).toBe(0);
    expect(publishNpcMessage).toHaveBeenCalledTimes(2);
    expect(publishNpcMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roomId: 'mossgate-clearing',
      text: 'The guard leaves toward the east, eyes alert.',
      sourceEffectId: expect.stringMatching(/:departure$/),
    }));
    expect(publishNpcMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      roomId: 'bellwarden-track',
      text: 'A town guard enters from the west, eyes alert.',
      sourceEffectId: expect.stringMatching(/:arrival$/),
    }));
    await engine.stop();
  });

  it('publishes Orraveth NPC movement announcements from the authored world narratives', async () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin, worldEventEffectsPlugin],
      store,
      authorization,
      orravethWorld,
      () => globalThis.crypto.randomUUID(),
      () => now,
      { roll: (sides) => sides },
    );
    await engine.start();
    try {
      const scheduler = createAutonomousNpcScheduler({
        engine,
        store,
        world: orravethWorld,
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        now: () => now,
      });

      expect(await scheduler.tick()).toBe(3);
      expect(await engine.processPendingEffects()).toBe(3);
      expect(publishNpcMessage).toHaveBeenCalledTimes(6);
      expect(publishNpcMessage).toHaveBeenCalledWith(expect.objectContaining({
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        roomId: 'bellwold-market-square',
        npcName: 'Taren Voss',
        text: 'The guard leaves toward the south, continuing the patrol.',
      }));
      expect(publishNpcMessage).toHaveBeenCalledWith(expect.objectContaining({
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        roomId: 'bellwold-south-common',
        npcName: 'Taren Voss',
        text: 'The guard enters from the north, eyes alert.',
      }));
    } finally {
      await engine.stop();
    }
  });

  it('reports NPC stream and dispatch failures without aborting the rest of a tick', async () => {
    const onError = vi.fn();
    let now = new Date('2026-10-21T12:00:00.000Z');
    const store = {
      readStream: vi.fn(async () => []),
    } as unknown as EventStorePort;
    const engine = {
      dispatchSystem: vi.fn(async () => ({
        receipt: { ok: false, code: 'RULE_VIOLATION', message: 'Movement rejected.' },
      })),
    } as unknown as EngineHost;
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: demoWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
      onError,
    });

    expect(await scheduler.tick()).toBe(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Movement rejected.' }), expect.any(String));

    vi.mocked(store.readStream).mockRejectedValue(new Error('Stream unavailable.'));
    // Failed NPCs back off before their streams are read again.
    expect(await scheduler.tick()).toBe(0);
    expect(store.readStream).toHaveBeenCalledTimes(2);
    now = new Date(now.getTime() + 5_000);
    expect(await scheduler.tick()).toBe(0);
    expect(onError).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), expect.any(String));
  });

  it('skips stream reads for NPCs that are not yet due', async () => {
    let now = new Date('2026-10-21T12:00:00.000Z');
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin],
      store,
      authorization,
      demoWorld,
      () => globalThis.crypto.randomUUID(),
      () => now,
      { roll: (sides) => sides },
    );
    await engine.start();
    const readStream = vi.spyOn(store, 'readStream');
    const readStreamHeads = vi.spyOn(store, 'readStreamHeads');
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: demoWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
    });

    expect(await scheduler.tick()).toBe(2);
    readStream.mockClear();
    readStreamHeads.mockClear();
    for (let second = 1; second < 60; second += 1) {
      now = new Date(Date.parse('2026-10-21T12:00:00.000Z') + second * 1_000);
      expect(await scheduler.tick()).toBe(0);
    }
    expect(readStream).not.toHaveBeenCalled();
    expect(readStreamHeads).not.toHaveBeenCalled();

    now = new Date('2026-10-21T12:01:00.000Z');
    expect(await scheduler.tick()).toBe(2);
    await engine.stop();
  });

  it('derives the same position from each latest event as from a full replay', async () => {
    let now = new Date('2026-10-21T12:00:00.000Z');
    let roll = 0;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin],
      store,
      authorization,
      demoWorld,
      () => globalThis.crypto.randomUUID(),
      () => now,
      // Vary rolls so wanderers both move and wait.
      { roll: (sides) => (roll++ % sides) + 1 },
    );
    await engine.start();
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: demoWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
    });
    for (let minute = 0; minute < 60; minute += 1) {
      await scheduler.tick();
      now = new Date(now.getTime() + 60_000);
    }

    for (const { npc, initialLocationId } of mobileNpcDefinitions(demoWorld)) {
      const events = await store.readStream(DEMO_WORLD_INSTANCE_ID, autonomousNpcStreamId(npc.id));
      expect(events.length).toBeGreaterThan(30);
      expect(new Set(events.map(({ type }) => type))).toContain('world.npc.moved');
      for (let length = 1; length <= events.length; length += 1) {
        expect(projectAutonomousNpcPositionFromHead(events[length - 1], npc.id, initialLocationId))
          .toEqual(projectAutonomousNpcPosition(events.slice(0, length), npc.id, initialLocationId));
      }
    }
    await engine.stop();
  });

  it('does not move NPCs while the world is inactive', async () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    let active = false;
    const store = { readStream: vi.fn(async () => []) } as unknown as EventStorePort;
    const engine = {
      dispatchSystem: vi.fn(async () => ({ receipt: { ok: true } })),
    } as unknown as EngineHost;
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: demoWorld,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      now: () => now,
      isActive: () => active,
    });

    expect(await scheduler.tick()).toBe(0);
    expect(store.readStream).not.toHaveBeenCalled();
    active = true;
    expect(await scheduler.tick()).toBe(2);
  });

  it('uses the default clock and skips NPCs without movement definitions', async () => {
    const staticLocation = demoWorld.locations.find((location) =>
      location.npcs?.some((npc) => !npc.movement),
    );
    const stationaryNpc = staticLocation?.npcs?.find((npc) => !npc.movement);
    if (!staticLocation || !stationaryNpc) throw new Error('Expected a stationary demo NPC.');
    const store = { readStream: vi.fn() } as unknown as EventStorePort;
    const engine = { dispatchSystem: vi.fn() } as unknown as EngineHost;
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: {
        ...demoWorld,
        locations: [{ ...staticLocation, npcs: [stationaryNpc] }],
      } as WorldPackDraft,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    });

    await expect(scheduler.tick()).resolves.toBe(0);
    expect(store.readStream).not.toHaveBeenCalled();
    expect(engine.dispatchSystem).not.toHaveBeenCalled();
  });

  it('skips a concurrent tick while the current tick is still reading an NPC stream', async () => {
    const movingLocation = demoWorld.locations.find((location) =>
      location.npcs?.some((npc) => npc.movement),
    );
    const movingNpc = movingLocation?.npcs?.find((npc) => npc.movement);
    if (!movingLocation || !movingNpc) throw new Error('Expected a moving demo NPC.');
    let finishRead: ((events: never[]) => void) | undefined;
    const store = {
      readStream: vi.fn(() => new Promise<never[]>((resolve) => {
        finishRead = resolve;
      })),
    } as unknown as EventStorePort;
    const engine = {
      dispatchSystem: vi.fn(async () => ({
        receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'Already moved.' },
      })),
    } as unknown as EngineHost;
    const scheduler = createAutonomousNpcScheduler({
      engine,
      store,
      world: {
        ...demoWorld,
        locations: [{ ...movingLocation, npcs: [movingNpc] }],
      } as WorldPackDraft,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    });

    const firstTick = scheduler.tick();
    await expect(scheduler.tick()).resolves.toBe(0);
    finishRead?.([]);
    expect(await firstTick).toBe(1);
    expect(engine.dispatchSystem).toHaveBeenCalledOnce();
  });

  it('does not start a timer for a world without mobile NPCs', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const scheduler = createAutonomousNpcScheduler({
      engine: { dispatchSystem: vi.fn() } as unknown as EngineHost,
      store: { readStream: vi.fn() } as unknown as EventStorePort,
      world: { ...demoWorld, locations: [] } as WorldPackDraft,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    });
    try {
      scheduler.start();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      scheduler.stop();
      setTimeoutSpy.mockRestore();
    }
  });

  describe('timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function fakeScheduler(isActive: () => boolean) {
      const store = { readStream: vi.fn(async () => []) } as unknown as EventStorePort;
      const engine = {
        dispatchSystem: vi.fn(async () => ({ receipt: { ok: true } })),
      } as unknown as EngineHost;
      const scheduler = createAutonomousNpcScheduler({
        engine,
        store,
        world: demoWorld,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        isActive,
      });
      return { scheduler, engine };
    }

    it('wakes when the next NPC is due rather than every second', async () => {
      const { scheduler, engine } = fakeScheduler(() => true);
      scheduler.start();
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.dispatchSystem).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(59_000);
      expect(engine.dispatchSystem).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(engine.dispatchSystem).toHaveBeenCalledTimes(4);

      scheduler.stop();
      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('sleeps while the world is idle and resumes on wake', async () => {
      let active = false;
      const { scheduler, engine } = fakeScheduler(() => active);
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.dispatchSystem).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      active = true;
      scheduler.wake();
      scheduler.wake();
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.dispatchSystem).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      scheduler.stop();
    });
  });
});
