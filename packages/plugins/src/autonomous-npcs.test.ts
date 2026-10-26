import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  autonomousNpcsPlugin,
  autonomousNpcStreamId,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';

function captureNpcStateCapability() {
  let capability: AutonomousNpcStateCapability | undefined;
  autonomousNpcsPlugin.register({
    provideCapability: (_token: unknown, implementation: unknown) => {
      capability = implementation as AutonomousNpcStateCapability;
    },
    registerSystemCommand: () => undefined,
  } as never);
  if (!capability) throw new Error('Autonomous NPC state capability was not registered.');
  return capability;
}

describe('autonomous NPC position projection cache', () => {
  it('projects several rooms from one batched movement-history read', async () => {
    const readStreams = vi.fn(async () => new Map());
    const capability = captureNpcStateCapability();
    const context = {
      worldInstanceId: 'npc-multi-room-test',
      world: {
        locations: [{
          id: 'room-a',
          npcs: [{
            id: 'walker',
            name: 'Walker',
            description: 'A traveler.',
            movement: { intervalMs: 60_000 },
          }],
        }, {
          id: 'room-b',
          npcs: [{
            id: 'resident',
            name: 'Resident',
            description: 'A local.',
          }],
        }],
      },
      store: { readStreams },
    } as never;

    const projected = await capability.atLocations(context, ['room-a', 'room-b', 'room-a']);

    expect(readStreams).toHaveBeenCalledTimes(1);
    expect(projected.get('room-a')?.map(({ id }) => id)).toEqual(['walker']);
    expect(projected.get('room-b')?.map(({ id }) => id)).toEqual(['resident']);
  });

  it('reuses unchanged positions but replays when the authoritative revision changes', async () => {
    const npcId = 'test-wandering-npc';
    const streamId = autonomousNpcStreamId(npcId);
    let iterations = 0;
    const initialHistory = new Proxy([] as StoredGameEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) iterations += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    let histories: ReadonlyMap<string, readonly StoredGameEvent[]> = new Map([
      [streamId, initialHistory],
    ]);
    const readStreams = vi.fn(async () => histories);
    const capability = captureNpcStateCapability();
    const context = {
      worldInstanceId: 'npc-position-cache-test',
      world: {
        locations: [{
          id: 'room-a',
          npcs: [{
            id: npcId,
            name: 'Test walker',
            description: 'A test NPC.',
            movement: { intervalMs: 60_000 },
          }],
        }],
      },
      store: { readStreams },
    } as never;

    expect(await capability.atLocation(context, 'room-a')).toHaveLength(1);
    expect(await capability.atLocation(context, 'room-a')).toHaveLength(1);
    expect(readStreams).toHaveBeenCalledTimes(2);
    expect(iterations).toBe(1);

    histories = new Map([[streamId, [{
      type: 'world.npc.invalid',
      version: 1,
      payload: {},
      eventId: 'npc-event-1',
      worldInstanceId: 'npc-position-cache-test',
      streamId,
      aggregateId: streamId,
      aggregateVersion: 1,
      causationCommandId: 'npc-command-1',
      actorId: 'npc-actor-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      tick: 1,
    }]]]);
    await expect(capability.atLocation(context, 'room-a')).rejects.toThrow(
      'Unsupported NPC world event version',
    );
  });
});
