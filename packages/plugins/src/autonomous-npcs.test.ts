import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  autonomousNpcsPlugin,
  autonomousNpcStreamId,
  effectiveAutonomousNpcMovementIntervalMs,
  mobileNpcDefinitions,
  projectAutonomousNpcPosition,
  projectAutonomousNpcPositionFromHead,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';

const worldInstanceId = 'autonomous-npc-tick-test';
const attemptedAt = '2026-10-27T12:00:00.000Z';

function event(type: string, payload: Record<string, unknown>, revision = 1): StoredGameEvent {
  const streamId = autonomousNpcStreamId('walker');
  return {
    eventId: `npc-event-${revision}`,
    worldInstanceId,
    streamId,
    aggregateId: streamId,
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `npc-command-${revision}`,
    actorId: 'system',
    occurredAt: attemptedAt,
    tick: revision,
  } as unknown as StoredGameEvent;
}

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

function captureTickCommand() {
  let tick: ((command: any, context: any) => Promise<any>) | undefined;
  autonomousNpcsPlugin.register({
    provideCapability: () => undefined,
    registerSystemCommand: (name: string, _schema: unknown, handler: unknown) => {
      if (name === 'world.npc.tick') tick = handler as typeof tick;
    },
  } as never);
  if (!tick) throw new Error('Autonomous NPC tick command was not registered.');
  return tick;
}

function wanderingWorld(overrides: Record<string, unknown> = {}) {
  return {
    locations: [
      {
        id: 'room-a',
        exits: [{
          id: 'a-to-b',
          fromLocationId: 'room-a',
          toLocationId: 'room-b',
          label: 'East',
          direction: 'east',
        }],
        npcs: [{
          id: 'walker',
          name: 'Walker',
          description: 'A traveler.',
          movement: {
            strategy: 'wander',
            intervalMs: 10_000,
            stayChancePercent: 0,
            allowedLocationIds: ['room-a', 'room-b'],
          },
        }],
      },
      {
        id: 'room-b',
        exits: [{
          id: 'b-to-a',
          fromLocationId: 'room-b',
          toLocationId: 'room-a',
          label: 'West',
          direction: 'west',
        }],
        npcs: [],
      },
    ],
    ...overrides,
  };
}

describe('autonomous NPC head projection', () => {
  const history = [
    event('world.npc.moved', {
      npcId: 'walker', fromLocationId: 'room-a', toLocationId: 'room-b', exitId: 'a-to-b',
      direction: 'east', attemptedAt, routeIndex: 1,
    }, 1),
    event('world.npc.movement_waited', { npcId: 'walker', locationId: 'room-b', attemptedAt, routeIndex: 1 }, 2),
    event('world.npc.moved', {
      npcId: 'walker', fromLocationId: 'room-b', toLocationId: 'room-a', exitId: 'b-to-a',
      direction: 'west', attemptedAt: '2026-10-27T12:01:00.000Z', routeIndex: 0,
    }, 3),
    event('world.npc.movement_waited', {
      npcId: 'walker', locationId: 'room-a', attemptedAt: '2026-10-27T12:02:00.000Z', routeIndex: 0,
    }, 4),
  ];

  it('matches a full replay after every event without reading earlier history', () => {
    expect(projectAutonomousNpcPositionFromHead(undefined, 'walker', 'room-a'))
      .toEqual(projectAutonomousNpcPosition([], 'walker', 'room-a'));
    for (let length = 1; length <= history.length; length += 1) {
      const prefix = history.slice(0, length);
      expect(projectAutonomousNpcPositionFromHead(prefix.at(-1), 'walker', 'room-a'))
        .toEqual(projectAutonomousNpcPosition(prefix, 'walker', 'room-a'));
    }
  });

  it('defers to a full replay for events it cannot interpret and rejects another NPC', () => {
    expect(projectAutonomousNpcPositionFromHead(event('world.npc.future', { npcId: 'walker' }), 'walker', 'room-a'))
      .toBeUndefined();
    expect(() => projectAutonomousNpcPositionFromHead(
      event('world.npc.movement_waited', { npcId: 'someone-else', locationId: 'room-a', attemptedAt }),
      'walker',
      'room-a',
    )).toThrow('movement history is inconsistent');
  });

  it('reads one head per mobile NPC instead of histories when the store supports it', async () => {
    const readStreamHeads = vi.fn(async () => new Map([[autonomousNpcStreamId('walker'), history[2]!]]));
    const readStream = vi.fn();
    const readStreams = vi.fn();
    const capability = captureNpcStateCapability();
    const context = {
      worldInstanceId,
      world: wanderingWorld(),
      store: { readStreamHeads, readStream, readStreams },
    } as never;

    const projected = await capability.atLocations(context, ['room-a', 'room-b']);
    expect(projected.get('room-a')?.map(({ id }) => id)).toEqual(['walker']);
    expect(await capability.position(context, 'walker', 'room-a')).toMatchObject({ locationId: 'room-a', revision: 3 });
    expect(readStreamHeads).toHaveBeenCalledTimes(2);
    expect(readStream).not.toHaveBeenCalled();
    expect(readStreams).not.toHaveBeenCalled();
  });

  it('falls back to the full history when the head is not an NPC position event', async () => {
    const readStreamHeads = vi.fn(async () => new Map([[autonomousNpcStreamId('walker'), event('world.npc.future', {})]]));
    const readStream = vi.fn(async () => history.slice(0, 1));
    const capability = captureNpcStateCapability();
    const context = { worldInstanceId: 'npc-fallback-test', world: wanderingWorld(), store: { readStreamHeads, readStream } } as never;

    expect(await capability.position(context, 'walker', 'room-a')).toMatchObject({ locationId: 'room-b', revision: 1 });
    expect(readStream).toHaveBeenCalledTimes(1);
  });
});

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

  it('reads histories only for mobile NPCs that can reach the requested rooms', async () => {
    const routeNpcId = 'route-walker';
    const wanderNpcId = 'allowed-wanderer';
    const distantNpcId = 'distant-walker';
    const wanderStreamId = autonomousNpcStreamId(wanderNpcId);
    const movedWanderer: StoredGameEvent = {
      ...event('world.npc.moved', {
        npcId: wanderNpcId,
        fromLocationId: 'remote-home',
        toLocationId: 'room-b',
        exitId: 'remote-to-room-b',
        attemptedAt,
      }),
      worldInstanceId: 'npc-route-filter-test',
      streamId: wanderStreamId,
      aggregateId: wanderStreamId,
    };
    const readStreams = vi.fn(async (_worldId: string, streamIds: readonly string[]) =>
      new Map(streamIds.map((streamId) => [
        streamId,
        streamId === wanderStreamId ? [movedWanderer] : [],
      ])),
    );
    const capability = captureNpcStateCapability();
    const context = {
      worldInstanceId: 'npc-route-filter-test',
      world: {
        locations: [
          {
            id: 'room-a',
            npcs: [{
              id: routeNpcId,
              name: 'Route walker',
              description: 'A traveler.',
              movement: {
                strategy: 'route',
                intervalMs: 60_000,
                routeLocationIds: ['room-a', 'room-b'],
              },
            }],
          },
          {
            id: 'remote-home',
            npcs: [{
              id: wanderNpcId,
              name: 'Allowed wanderer',
              description: 'A local traveler.',
              movement: {
                strategy: 'wander',
                intervalMs: 60_000,
                stayChancePercent: 20,
                allowedLocationIds: ['room-b'],
              },
            }],
          },
          {
            id: 'remote-a',
            npcs: [{
              id: distantNpcId,
              name: 'Distant walker',
              description: 'A far-off traveler.',
              movement: {
                strategy: 'route',
                intervalMs: 60_000,
                routeLocationIds: ['remote-a', 'remote-b'],
              },
            }],
          },
        ],
      },
      store: { readStreams },
    } as never;

    const projected = await capability.atLocations(context, ['room-a', 'room-b']);

    expect(readStreams).toHaveBeenCalledOnce();
    expect(readStreams.mock.calls[0]?.[1]).toEqual([
      autonomousNpcStreamId(routeNpcId),
      wanderStreamId,
    ]);
    expect(projected.get('room-b')?.map(({ id }) => id)).toEqual([wanderNpcId]);
  });

  it('skips movement-history reads when no mobile NPC can reach the requested room', async () => {
    const readStreams = vi.fn(async () => new Map());
    const capability = captureNpcStateCapability();
    const context = {
      worldInstanceId: 'npc-no-route-match-test',
      world: {
        locations: [{
          id: 'remote-a',
          npcs: [{
            id: 'remote-walker',
            name: 'Remote walker',
            description: 'A distant traveler.',
            movement: {
              strategy: 'route',
              intervalMs: 60_000,
              routeLocationIds: ['remote-a', 'remote-b'],
            },
          }],
        }],
      },
      store: { readStreams },
    } as never;

    const projected = await capability.atLocations(context, ['unrelated-room']);

    expect(readStreams).not.toHaveBeenCalled();
    expect(projected.get('unrelated-room')).toEqual([]);
  });

  it('fails open for an unknown movement strategy so a new policy cannot hide an NPC', async () => {
    const npcId = 'future-policy-walker';
    const streamId = autonomousNpcStreamId(npcId);
    const readStreams = vi.fn(async (_worldId: string, streamIds: readonly string[]) =>
      new Map(streamIds.map((id) => [id, []])),
    );
    const capability = captureNpcStateCapability();
    const context = {
      worldInstanceId: 'npc-unknown-policy-test',
      world: {
        locations: [{
          id: 'remote-home',
          npcs: [{
            id: npcId,
            name: 'Future policy walker',
            description: 'A traveler with a new movement policy.',
            movement: { strategy: 'future-policy' },
          }],
        }],
      },
      store: { readStreams },
    } as never;

    await capability.atLocations(context, ['requested-room']);

    expect(readStreams).toHaveBeenCalledOnce();
    expect(readStreams.mock.calls[0]?.[1]).toEqual([streamId]);
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

describe('autonomous NPC movement', () => {
  it('keeps only mobile NPC definitions and enforces the one-minute minimum interval', () => {
    const world = wanderingWorld() as any;
    expect(mobileNpcDefinitions(world).map(({ npc, initialLocationId }) => ({
      id: npc.id,
      initialLocationId,
    }))).toEqual([{ id: 'walker', initialLocationId: 'room-a' }]);
    expect(effectiveAutonomousNpcMovementIntervalMs(5_000)).toBe(60_000);
    expect(effectiveAutonomousNpcMovementIntervalMs(90_000)).toBe(90_000);
  });

  it('replays movement and wait events, preserving route indexes and rejecting inconsistent history', () => {
    const moved = event('world.npc.moved', {
      npcId: 'walker',
      fromLocationId: 'room-a',
      toLocationId: 'room-b',
      exitId: 'a-to-b',
      attemptedAt,
      routeIndex: 1,
    });
    const waited = event('world.npc.movement_waited', {
      npcId: 'walker',
      locationId: 'room-b',
      attemptedAt: '2026-10-27T12:01:00.000Z',
      routeIndex: 1,
    }, 2);
    expect(projectAutonomousNpcPosition([moved, waited], 'walker', 'room-a')).toMatchObject({
      locationId: 'room-b',
      revision: 2,
      lastAttemptAt: '2026-10-27T12:01:00.000Z',
      routeIndex: 1,
    });
    expect(() => projectAutonomousNpcPosition([moved], 'other-npc', 'room-a'))
      .toThrow('movement history is inconsistent');
    expect(() => projectAutonomousNpcPosition([
      event('world.npc.moved', {
        npcId: 'walker',
        fromLocationId: 'room-a',
        toLocationId: 'room-b',
        exitId: 'a-to-b',
        attemptedAt,
        routeIndex: -1,
      }),
    ], 'walker', 'room-a')).toThrow();
    expect(() => projectAutonomousNpcPosition([
      event('world.npc.movement_waited', {
        npcId: 'walker',
        locationId: 'room-b',
        attemptedAt,
      }),
    ], 'walker', 'room-a')).toThrow('movement history is inconsistent');
  });

  it('moves a wandering NPC through a valid exit and records an authoritative wait', async () => {
    const tick = captureTickCommand();
    const rng = { roll: vi.fn().mockReturnValueOnce(50).mockReturnValueOnce(1) };
    const context = {
      worldInstanceId,
      world: wanderingWorld(),
      store: { readStream: vi.fn(async () => []) },
      rng,
      now: () => new Date(attemptedAt),
    };
    const moved = await tick({ npcId: 'walker' }, context);
    expect(moved).toMatchObject({
      streamId: autonomousNpcStreamId('walker'),
      expectedVersion: 0,
      events: [{
        type: 'world.npc.moved',
        payload: {
          npcId: 'walker',
          fromLocationId: 'room-a',
          toLocationId: 'room-b',
          exitId: 'a-to-b',
          direction: 'east',
        },
      }],
    });

    const noCandidates = captureTickCommand();
    const wanderFixture = wanderingWorld();
    const firstRoom = wanderFixture.locations[0]!;
    const secondRoom = wanderFixture.locations[1]!;
    const waited = await noCandidates({ npcId: 'walker' }, {
      ...context,
      world: wanderingWorld({
        locations: [{
          ...firstRoom,
          exits: [{
            ...firstRoom.exits[0]!,
            requiredInteractionId: 'locked-gate',
          }],
        }, {
          ...secondRoom,
          requiredVisitedLocationId: 'secret-room',
        }],
      }),
      rng: { roll: vi.fn().mockReturnValue(50) },
    });
    expect(waited.events[0]).toMatchObject({
      type: 'world.npc.movement_waited',
      payload: { npcId: 'walker', locationId: 'room-a', attemptedAt },
    });
  });

  it('rejects invalid and early ticks, then follows a route or records a wait at a broken link', async () => {
    const tick = captureTickCommand();
    const context = {
      worldInstanceId,
      world: wanderingWorld(),
      store: {
        readStream: vi.fn(async () => [event('world.npc.movement_waited', {
          npcId: 'walker',
          locationId: 'room-a',
          attemptedAt: '2026-10-27T12:00:00.000Z',
        })]),
      },
      rng: { roll: vi.fn() },
      now: () => new Date('2026-10-27T12:00:59.999Z'),
    };
    await expect(tick({ npcId: 'missing-npc' }, context)).rejects.toThrow('no autonomous movement');
    await expect(tick({ npcId: 'walker' }, context)).rejects.toThrow('not due to move yet');
    expect(context.rng.roll).not.toHaveBeenCalled();

    const routeWorld = {
      locations: [{
        id: 'room-a',
        exits: [{
          id: 'a-to-b',
          fromLocationId: 'room-a',
          toLocationId: 'room-b',
          label: 'East',
        }],
        npcs: [{
          id: 'walker',
          name: 'Walker',
          description: 'A traveler.',
          movement: {
            strategy: 'route',
            intervalMs: 60_000,
            routeLocationIds: ['room-a', 'room-b'],
          },
        }],
      }, {
        id: 'room-b',
        exits: [],
        npcs: [],
      }],
    };
    const route = await tick({ npcId: 'walker' }, {
      ...context,
      world: routeWorld,
      store: { readStream: vi.fn(async () => []) },
      now: () => new Date('2026-10-27T12:01:00.000Z'),
    });
    expect(route.events[0]).toMatchObject({
      type: 'world.npc.moved',
      payload: { toLocationId: 'room-b', routeIndex: 1 },
    });

    const blockedRoute = await tick({ npcId: 'walker' }, {
      ...context,
      world: { ...routeWorld, locations: [{ ...routeWorld.locations[0], exits: [] }, routeWorld.locations[1]] },
      store: { readStream: vi.fn(async () => []) },
      now: () => new Date('2026-10-27T12:01:00.000Z'),
    });
    expect(blockedRoute.events[0]).toMatchObject({
      type: 'world.npc.movement_waited',
      payload: { locationId: 'room-a', routeIndex: 0 },
    });
  });

  it('uses single-stream reads when batching is unavailable and ignores NPCs outside requested rooms', async () => {
    const capability = captureNpcStateCapability();
    const readStream = vi.fn(async () => [event('world.npc.moved', {
      npcId: 'walker',
      fromLocationId: 'room-a',
      toLocationId: 'room-b',
      exitId: 'a-to-b',
      attemptedAt,
    })]);
    const world = wanderingWorld();
    world.locations[0]!.npcs!.push({
      id: 'resident',
      name: 'Resident',
      description: 'A local.',
    } as any);
    const projected = await capability.atLocations({
      worldInstanceId,
      world,
      store: { readStream },
    } as never, ['room-b']);

    expect(readStream).toHaveBeenCalledWith(worldInstanceId, autonomousNpcStreamId('walker'));
    expect(projected.get('room-b')?.map(({ id }) => id)).toEqual(['walker']);
  });

  it('does not batch-read locations that contain no mobile NPCs', async () => {
    const capability = captureNpcStateCapability();
    const readStreams = vi.fn(async () => new Map());
    const projected = await capability.atLocations({
      worldInstanceId,
      world: {
        locations: [{
          id: 'room-a',
          npcs: [{ id: 'resident', name: 'Resident', description: 'A local.' }],
        }],
      },
      store: { readStreams },
    } as never, ['room-a']);

    expect(readStreams).not.toHaveBeenCalled();
    expect(projected.get('room-a')?.map(({ id }) => id)).toEqual(['resident']);
  });

  it('evicts the oldest cached NPC positions after the cache exceeds its bound', async () => {
    const capability = captureNpcStateCapability();
    const npcs = Array.from({ length: 257 }, (_, index) => ({
      id: `walker-${index}`,
      name: `Walker ${index}`,
      description: 'A traveler.',
      movement: {
        strategy: 'wander',
        intervalMs: 60_000,
        stayChancePercent: 10,
        allowedLocationIds: ['room-a', 'room-b'],
      },
    }));
    const readStreams = vi.fn(async () => new Map());

    const projected = await capability.atLocations({
      worldInstanceId: 'npc-cache-limit-test',
      world: { locations: [{ id: 'room-a', npcs }] },
      store: { readStreams },
    } as never, ['room-a']);

    expect(projected.get('room-a')).toHaveLength(257);
    expect(readStreams).toHaveBeenCalledTimes(1);
  });

  it('refuses to move combat-capable NPCs or NPCs whose current location is missing', async () => {
    const tick = captureTickCommand();
    const combatWorld = wanderingWorld();
    combatWorld.locations[0]!.npcs![0] = {
      ...combatWorld.locations[0]!.npcs![0],
      combatProfile: { maxHealth: 8, attackDamage: 2 },
    } as any;
    await expect(tick({ npcId: 'walker' }, {
      worldInstanceId,
      world: combatWorld,
      store: { readStream: vi.fn(async () => []) },
      now: () => new Date(attemptedAt),
      rng: { roll: vi.fn() },
    })).rejects.toThrow('NPCs that can participate in combat cannot wander in this version');

    const movedOut = event('world.npc.moved', {
      npcId: 'walker',
      fromLocationId: 'room-a',
      toLocationId: 'missing-room',
      exitId: 'broken-exit',
      attemptedAt: '2026-10-27T12:01:00.000Z',
    });
    await expect(tick({ npcId: 'walker' }, {
      worldInstanceId,
      world: wanderingWorld(),
      store: { readStream: vi.fn(async () => [movedOut]) },
      now: () => new Date('2026-10-27T12:02:00.000Z'),
      rng: { roll: vi.fn() },
    })).rejects.toThrow('location missing from this world');
  });
});
