import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineHost, InMemoryEventStore } from '@mudd/engine-core';
import {
  autonomousNpcsPlugin,
  autonomousNpcStreamId,
  projectAutonomousNpcPosition,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { demoEventEffectsPlugin } from './demo-event-effects-plugin.js';
import { createAutonomousNpcScheduler } from './autonomous-npc-scheduler.js';

const { publishNpcMessage } = vi.hoisted(() => ({
  publishNpcMessage: vi.fn(),
}));

vi.mock('./room-chat-service.js', () => ({
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

  it('publishes deduplicated departure and arrival narratives with actual reverse-exit directions', async () => {
    let now = new Date('2026-10-21T12:00:00.000Z');
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [autonomousNpcsPlugin, demoEventEffectsPlugin],
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
    }, 'system:autonomous-npc-scheduler');
    expect(result.receipt.ok).toBe(true);

    expect(await engine.processPendingEffects()).toBe(1);
    expect(await engine.processPendingEffects()).toBe(0);
    expect(publishNpcMessage).toHaveBeenCalledTimes(2);
    expect(publishNpcMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roomId: 'mossgate-clearing',
      text: 'The guard continues the patrol to the east.',
      sourceEffectId: expect.stringMatching(/:departure$/),
    }));
    expect(publishNpcMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      roomId: 'bellwarden-track',
      text: 'A town guard marches in from the west, surveying the surroundings.',
      sourceEffectId: expect.stringMatching(/:arrival$/),
    }));
    await engine.stop();
  });
});
