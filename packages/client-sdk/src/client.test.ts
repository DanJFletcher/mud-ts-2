import { describe, expect, it, vi } from 'vitest';
import { MuddHttpClient } from './index.js';
import { EngineHost, InMemoryEventStore, projectQuestJournal, replayCharacter, type EnginePlugin } from '@mudd/engine-core';
import {
  characterPlugin,
  combatPlugin,
  combatRoomPresenceCapability,
  groupsPlugin,
  interactionPlugin,
  merchantPlugin,
  movementPlugin,
  npcDialoguePlugin,
  partyCombatPolicyPlugin,
  partyPlugin,
  partyQuestPlugin,
  roadTravelPlugin,
  teamCombatPlugin,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { InitializeCharacterWalletCommandSchema, validateDraftWorldGraph } from '@mudd/contracts';

describe('demo world navigation', () => {
  const compassVectors: Record<string, readonly [number, number]> = {
    north: [0, 1], northeast: [1, 1], east: [1, 0], southeast: [1, -1],
    south: [0, -1], southwest: [-1, -1], west: [-1, 0], northwest: [-1, 1],
  };

  it('aligns every surface exit with its map bearing', () => {
    for (const location of demoWorld.locations) {
      for (const exit of location.exits) {
        if (!compassVectors[exit.direction!]) continue;
        const destination = demoWorld.locations.find((candidate) => candidate.id === exit.toLocationId)!;
        expect(location.mapPosition, exit.id).toBeDefined();
        expect(destination.mapPosition, exit.id).toBeDefined();
        const bearing = [
          Math.sign(destination.mapPosition!.x - location.mapPosition!.x),
          Math.sign(destination.mapPosition!.y - location.mapPosition!.y),
        ];
        expect(compassVectors[exit.direction!], exit.id).toEqual(bearing);
      }
    }
  });

  it('uses opposite compass directions on return paths', () => {
    for (const location of demoWorld.locations) {
      for (const exit of location.exits) {
        const vector = compassVectors[exit.direction!];
        if (!vector) continue;
        const destination = demoWorld.locations.find((candidate) => candidate.id === exit.toLocationId)!;
        const reverse = destination.exits.find((candidate) => candidate.toLocationId === location.id);
        expect(reverse, exit.id).toBeDefined();
        expect(compassVectors[reverse!.direction!], exit.id)
          .toEqual(vector.map((component) => component === 0 ? 0 : -component));
      }
    }
  });

  it('keeps every new overland connection as a bidirectional, segmented road', () => {
    const expectedRoadIds = [
      'willowshade-track',
      'glasswater-road',
      'bellwarden-road',
      'reedbank-road',
      'willowrest-lane',
    ];
    const roads = new Map((demoWorld.roads ?? []).map((road) => [road.id, road]));

    for (const roadId of expectedRoadIds) {
      const road = roads.get(roadId);
      expect(road, roadId).toBeDefined();
      expect(road!.locationIds.length, roadId).toBeGreaterThanOrEqual(3);
      for (let index = 0; index < road!.locationIds.length - 1; index += 1) {
        const fromLocationId = road!.locationIds[index]!;
        const toLocationId = road!.locationIds[index + 1]!;
        const from = demoWorld.locations.find((location) => location.id === fromLocationId)!;
        const to = demoWorld.locations.find((location) => location.id === toLocationId)!;
        expect(from.exits.some((exit) => exit.toLocationId === toLocationId && exit.roadId === roadId), roadId).toBe(true);
        expect(to.exits.some((exit) => exit.toLocationId === fromLocationId && exit.roadId === roadId), roadId).toBe(true);
      }
    }
  });

  it('removes Tower Ridge and preserves the longer road route to the tower', () => {
    const locations = new Map(demoWorld.locations.map((location) => [location.id, location]));
    const route = [
      'glasswater-bridge',
      'glasswater-approach',
      'mossgate-clearing',
      'bellwarden-track',
      'bell-tower-west',
    ];

    expect(locations.has('tower-ridge')).toBe(false);
    expect(demoWorld.roads?.some((road) => road.id === 'tower-ridge-road')).toBe(false);
    expect(demoWorld.locations.flatMap((location) => location.exits)
      .some((exit) => exit.toLocationId === 'tower-ridge')).toBe(false);

    for (let index = 0; index < route.length - 1; index += 1) {
      const current = locations.get(route[index]!)!;
      expect(current.exits.some((exit) => exit.toLocationId === route[index + 1])).toBe(true);
    }
  });

  it('requires character quest rewards to use the configured world currency', () => {
    const invalidWorld = structuredClone(demoWorld);
    invalidWorld.quests = invalidWorld.quests?.map((quest) => quest.id === 'sedgewatch-waterline'
      ? { ...quest, reward: { currencyId: 'other-currency', amount: 5 } }
      : quest);

    expect(validateDraftWorldGraph(invalidWorld)).toContain(
      'Quest sedgewatch-waterline reward currency other-currency does not match the world currency',
    );
  });

  it('keeps the Undercrypt maze connected and the sword room at its end', () => {
    const undercrypt = demoWorld.locations.filter((location) => location.mapAreaId === 'bell-tower-undercrypt');
    const locationsById = new Map(undercrypt.map((location) => [location.id, location]));
    const reachable = new Set<string>(['undercrypt-entry-passage']);
    const pending = ['undercrypt-entry-passage'];

    while (pending.length > 0) {
      const current = locationsById.get(pending.shift()!);
      for (const exit of current?.exits ?? []) {
        if (locationsById.has(exit.toLocationId) && !reachable.has(exit.toLocationId)) {
          reachable.add(exit.toLocationId);
          pending.push(exit.toLocationId);
        }
      }
    }

    expect(undercrypt.every((location) => reachable.has(location.id))).toBe(true);
    expect(locationsById.get('undercrypt-crossway')?.exits.map((exit) => exit.direction))
      .toEqual(expect.arrayContaining(['west', 'east', 'south']));
    expect(locationsById.get('undercrypt-flooded-archive')?.exits).toContainEqual(expect.objectContaining({
      id: 'flooded-archive-to-reliquary-approach',
      requiredInteractionId: 'set-archive-reflection',
    }));
    expect(locationsById.get('undercrypt-bellwright-reliquary')?.exits).toHaveLength(1);
    expect(locationsById.get('undercrypt-bellwright-reliquary')?.exits[0]?.toLocationId)
      .toBe('undercrypt-reliquary-approach');

    const ratCorridors = demoWorld.roads.filter((road) => road.id.startsWith('undercrypt-'));
    expect(ratCorridors).toHaveLength(2);
    expect(ratCorridors.every((road) =>
      road.encounterChancePercent === 15 &&
      road.encounters.some((encounter) => encounter.name === 'Giant Rat') &&
      road.locationIds.every((locationId) => locationsById.has(locationId)),
    )).toBe(true);
  });
});

const testCombatPresencePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.room-combat-presence',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [combatRoomPresenceCapability.id],
  },
  register({ provideCapability }) {
    provideCapability(combatRoomPresenceCapability, {
      listActiveCharacters: async () => [],
    });
  },
};

const testPlugins = [
  worldItemsPlugin,
  characterPlugin,
  groupsPlugin,
  partyPlugin,
  partyQuestPlugin,
  interactionPlugin,
  combatPlugin,
  testCombatPresencePlugin,
  partyCombatPolicyPlugin,
  teamCombatPlugin,
  movementPlugin,
  roadTravelPlugin,
  npcDialoguePlugin,
  merchantPlugin,
];

const demoRoadRoutes = {
  'fountain-to-clearing': ['fountain-to-stillwater-path', 'stillwater-path-to-clearing'],
  'clearing-to-bridge': ['clearing-to-glasswater-road', 'glasswater-approach-to-bridge'],
  'bridge-to-clearing': ['bridge-to-glasswater-road', 'glasswater-approach-to-clearing'],
  'bridge-to-tower-west': [
    'bridge-to-glasswater-road',
    'glasswater-approach-to-clearing',
    'clearing-to-bellwarden-track',
    'bellwarden-track-to-tower-west',
  ],
  'bell-tower-west-to-bridge': [
    'bell-tower-west-to-bellwarden-track',
    'bellwarden-track-to-clearing',
    'clearing-to-glasswater-road',
    'glasswater-approach-to-bridge',
  ],
  'clearing-to-tower-west': ['clearing-to-bellwarden-track', 'bellwarden-track-to-tower-west'],
  'bell-tower-west-to-clearing': ['bell-tower-west-to-bellwarden-track', 'bellwarden-track-to-clearing'],
  'clearing-to-sedgewatch': [
    'clearing-to-bracken-road',
    'bracken-road-to-mile',
    'bracken-mile-to-sedgewatch',
  ],
  'sedgewatch-to-bridge': [
    'sedgewatch-to-mile',
    'bracken-mile-to-road',
    'bracken-road-to-clearing',
    'clearing-to-glasswater-road',
    'glasswater-approach-to-bridge',
  ],
  'bridge-to-sedgewatch': [
    'bridge-to-glasswater-road',
    'glasswater-approach-to-clearing',
    'clearing-to-bracken-road',
    'bracken-road-to-mile',
    'bracken-mile-to-sedgewatch',
  ],
  'sedgewatch-to-clearing': [
    'sedgewatch-to-mile',
    'bracken-mile-to-road',
    'bracken-road-to-clearing',
  ],
  'clearing-to-fernshade': [
    'clearing-to-stillwater-path',
    'stillwater-path-to-fernshade-road',
    'fernshade-road-to-fork',
  ],
  'bridge-to-reedbank': ['bridge-to-reedbank-road', 'reedbank-road-to-stalls'],
  'reedbank-to-bridge': ['reedbank-to-reedbank-road', 'reedbank-road-to-bridge'],
  'reedbank-to-willowrest': ['reedbank-to-willowrest-lane', 'willowrest-lane-to-inn'],
  'willowrest-to-reedbank': ['willowrest-to-lane', 'willowrest-lane-to-reedbank'],
} as const;

type DemoRoadRoute = keyof typeof demoRoadRoutes;

async function moveAlongDemoRoad(
  client: MuddHttpClient,
  characterId: string,
  route: DemoRoadRoute,
  expectedVersion: number,
  commandId: string,
) {
  let result;
  for (const [index, exitId] of demoRoadRoutes[route].entries()) {
    result = await client.roadStep(
      characterId,
      exitId,
      expectedVersion + index * 2,
      `${commandId}-step-${index + 1}`,
    );
    if (!result.receipt.ok) return result;
  }
  return result!;
}

function demoTestWorld() {
  const world = structuredClone(demoWorld);
  for (const road of world.roads ?? []) road.encounterChancePercent = 0;
  return world;
}

describe('MuddHttpClient', () => {
  it('starts a guest session through the same-origin API', async () => {
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('/api/guest-session');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      return Response.json({
        player: { id: 'guest-player', displayName: 'Traveler GUEST' },
      });
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });

    await expect(client.createGuestSession()).resolves.toEqual({
      player: { id: 'guest-player', displayName: 'Traveler GUEST' },
    });
  });

  it('sends an authenticated world-session heartbeat and validates its room projection', async () => {
    let callCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      callCount += 1;
      expect(String(input)).toBe('/api/world-session/heartbeat');
      expect(init?.method).toBe('POST');
      return Response.json({
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        locationId: 'mossgate-clearing',
        occupants: [{ id: 'another-character', displayName: 'Mira' }],
      });
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });

    await expect(client.heartbeatWorldSession()).resolves.toEqual({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      locationId: 'mossgate-clearing',
      occupants: [{ id: 'another-character', displayName: 'Mira' }],
    });
    expect(callCount).toBe(1);
  });

  it('rejects malformed successful HTTP responses instead of trusting a TypeScript cast', async () => {
    const client = new MuddHttpClient({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      fetcher: async () => Response.json({ player: { id: 42, displayName: null } }),
    });

    await expect(client.getGame()).rejects.toThrow('The server returned an invalid response.');
  });

  it('correlates an opt-in movement trace with its server request', async () => {
    const traceId = 'de305d54-75b4-431b-adb2-eb6b9e546014';
    const requests: Array<{ path: string; headers: Headers }> = [];
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const client = new MuddHttpClient({
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        fetcher: async (input, init = {}) => {
          const path = String(input);
          requests.push({ path, headers: new Headers(init.headers) });
          if (path === '/api/game') {
            return Response.json({
              player: { id: 'player-1', displayName: 'Player' },
              character: {
                worldInstanceId: DEMO_WORLD_INSTANCE_ID,
                characterId: 'character-1',
                name: 'Fern',
                locationId: 'mossgate-clearing',
                revision: 2,
              },
            }, { headers: { 'x-request-id': 'snapshot-request-1' } });
          }
          return Response.json({
            receipt: {
              ok: true,
              commandId: 'move-command',
              eventIds: ['move-event'],
              newAggregateVersion: 2,
            },
            streamId: 'character-1',
            events: [],
          }, { headers: { 'x-request-id': 'server-request-1' } });
        },
      });

      await client.move('character-1', 'north-exit', 1, 'move-command', traceId);
      await client.getGame(traceId);

      expect(requests[0]?.headers.get('x-mudd-trace-id')).toBe(traceId);
      expect(requests[0]?.headers.get('x-mudd-trace-phase')).toBe('command');
      expect(requests[1]?.headers.get('x-mudd-trace-id')).toBe(traceId);
      expect(requests[1]?.headers.get('x-mudd-trace-phase')).toBe('snapshot');
      const traceLogs = info.mock.calls
        .filter(([message]) => message === '[mudd_perf_trace_request]')
        .map(([, details]) => JSON.parse(String(details)));
      expect(traceLogs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          traceId,
          phase: 'command',
          commandType: 'character.move',
          serverRequestId: 'server-request-1',
          status: 200,
        }),
        expect.objectContaining({
          traceId,
          phase: 'snapshot',
          serverRequestId: 'snapshot-request-1',
          status: 200,
        }),
      ]));
      expect(traceLogs[0]).toMatchObject({
        traceId,
        phase: 'command',
      });
    } finally {
      info.mockRestore();
    }
  });

  it('refreshes and retries once when a passive character update makes a command revision stale', async () => {
    const commandBodies: Record<string, unknown>[] = [];
    let gameReads = 0;
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      if (path === '/api/game') {
        gameReads += 1;
        return Response.json({
          player: { id: 'player-1', displayName: 'Player' },
          character: {
            worldInstanceId: DEMO_WORLD_INSTANCE_ID,
            characterId: 'character-1',
            name: 'Fern',
            locationId: 'mossgate-clearing',
            revision: 4,
          },
        });
      }
      if (path === '/api/commands') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        commandBodies.push(body);
        if (commandBodies.length === 1) {
          return Response.json({
            receipt: {
              ok: false,
              commandId: body.commandId,
              code: 'VERSION_CONFLICT',
              message: 'Expected revision 3; current revision is 4.',
              retryable: true,
            },
            streamId: 'character-1',
            events: [],
          });
        }
        return Response.json({
          receipt: {
            ok: true,
            commandId: body.commandId,
            eventIds: ['event-1'],
            newAggregateVersion: 5,
          },
          streamId: 'character-1',
          events: [],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });

    const result = await client.move('character-1', 'clearing-to-street', 3, 'move-command-1');

    expect(result.receipt.ok).toBe(true);
    expect(gameReads).toBe(1);
    expect(commandBodies).toHaveLength(2);
    expect(commandBodies[0]).toMatchObject({
      commandId: 'move-command-1',
      expectedVersion: 3,
      payload: { exitId: 'clearing-to-street' },
    });
    expect(commandBodies[1]).toMatchObject({
      commandId: 'move-command-1',
      expectedVersion: 4,
      payload: { exitId: 'clearing-to-street' },
    });
  });

  it('does not retry unrelated command failures or retry a stale revision more than once', async () => {
    let commandCount = 0;
    let gameReads = 0;
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      if (path === '/api/game') {
        gameReads += 1;
        return Response.json({
          player: { id: 'player-1', displayName: 'Player' },
          character: {
            worldInstanceId: DEMO_WORLD_INSTANCE_ID,
            characterId: 'character-1',
            name: 'Fern',
            locationId: 'mossgate-clearing',
            revision: 5,
          },
        });
      }
      if (path === '/api/commands') {
        commandCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const message = commandCount === 1
          ? 'You cannot move there.'
          : `Expected revision ${String(body.expectedVersion)}; current revision is ${Number(body.expectedVersion) + 1}.`;
        return Response.json({
          receipt: {
            ok: false,
            commandId: body.commandId,
            code: commandCount === 1 ? 'RULE_VIOLATION' : 'VERSION_CONFLICT',
            message,
            retryable: commandCount > 1,
          },
          streamId: 'character-1',
          events: [],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });

    await expect(client.move('character-1', 'invalid-exit', 3, 'move-rule-failure'))
      .rejects.toThrow('You cannot move there.');
    expect(commandCount).toBe(1);
    expect(gameReads).toBe(0);

    await expect(client.move('character-1', 'clearing-to-street', 3, 'move-repeat-conflict'))
      .rejects.toThrow('The world updated while you were acting. Please try again.');
    expect(commandCount).toBe(3);
    expect(gameReads).toBe(1);
  });

  it('sends Zod-validated commands and queries to the authoritative engine', async () => {
    const session = {
      sessionId: 'session-1',
      playerId: 'player-1',
      actorId: 'player-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    const testWorld = demoTestWorld();
    testWorld.locations.find((location) => location.id === 'mossgate-clearing')!.takeables!.push({
      id: 'sdk-test-pebble',
      label: 'Test pebble',
      description: 'A plain pebble used to test ordinary item dropping.',
      roomDescription: 'A plain test pebble lies nearby.',
    });
    const engine = new EngineHost(
      testPlugins,
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      testWorld,
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Fern', 'sdk-create');
    expect(created.receipt.ok).toBe(true);
    const characterId = created.streamId!;
    const firstRoom = await client.look(characterId, 'sdk-look-1');
    expect(firstRoom.title).toBe('Mossgate Clearing');
    expect(firstRoom.description).toContain('One loose stone bears a pale stripe.');
    expect(firstRoom.description).toContain('Mara is here, watching the northern trail.');
    expect(firstRoom.description).not.toContain('A path keeper stands beside the weathered marker');
    expect(firstRoom.npcs).toEqual([{
      id: 'mara-waykeeper',
      name: 'Mara',
      activityDescription: 'watching the northern trail',
      canChallenge: false,
      combatDisposition: 'passive',
      canShop: false,
    }, {
      id: 'mossgate-training-sentinel',
      name: 'Practice Sentinel',
      activityDescription: 'lifting its padded arms in a steady rhythm',
      canChallenge: true,
      combatDisposition: 'passive',
      canShop: false,
    }, {
      id: 'mossgate-practice-mauler',
      name: 'Practice Mauler',
      activityDescription: 'pivoting slowly through a broad sparring swing',
      canChallenge: true,
      combatDisposition: 'passive',
      canShop: false,
    }, {
      id: 'mossgate-practice-guardian',
      name: 'Practice Guardian',
      activityDescription: 'holding a round shield over its center',
      canChallenge: true,
      combatDisposition: 'passive',
      canShop: false,
    }, {
      id: 'mossgate-wandering-villager',
      name: 'Wandering Villager',
      activityDescription: 'walking by with hands clasped behind their back',
      canChallenge: false,
      combatDisposition: 'passive',
      canShop: false,
    }, {
      id: 'mossgate-patrolling-guard',
      name: 'Patrolling Guard',
      activityDescription: 'patrolling with eyes on the surroundings',
      canChallenge: false,
      combatDisposition: 'passive',
      canShop: false,
    }]);
    const explicitlyLookedRoom = await client.look(
      characterId,
      'sdk-look-explicit',
      { includeNpcDescriptions: true },
    );
    expect(explicitlyLookedRoom.description).toContain(
      'Mara is here. Mara stands beside the weathered marker, one hand resting on its rain-smoothed edge as she watches the northern trail.',
    );
    expect(explicitlyLookedRoom.npcs?.[0]).toMatchObject({
      id: 'mara-waykeeper',
      description: 'Mara stands beside the weathered marker, one hand resting on its rain-smoothed edge as she watches the northern trail.',
    });
    expect(firstRoom.objects).toEqual([
      {
        id: 'mossgate-marker',
        label: 'Weathered marker',
        description: 'A weathered stone marker, its carved arrow worn but still pointing east toward the western approach to the Old Bell Tower.',
        readable: true,
        takeable: false,
      },
      {
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
        readable: false,
        takeable: true,
      },
      {
        id: 'sdk-test-pebble',
        label: 'Test pebble',
        description: 'A plain pebble used to test ordinary item dropping.',
        readable: false,
        takeable: true,
      },
    ]);
    const marker = await client.read(characterId, 'mossgate-marker', firstRoom.revision, 'sdk-read');
    expect(marker).toEqual({
      id: 'mossgate-marker',
      label: 'Weathered marker',
      text: 'OLD BELL TOWER — EAST',
    });
    await expect(client.read(characterId, 'unknown-object', firstRoom.revision + 1, 'sdk-read-missing'))
      .rejects.toThrow('That object is not readable from here.');
    const afterRead = await client.look(characterId, 'sdk-look-after-read');
    const openingDialogue = await client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-opening');
    expect(openingDialogue).toEqual({
      npcId: 'mara-waykeeper',
      npcName: 'Mara',
      text: 'The old paths still have their stories. What would you like to ask?',
      choices: [
        { id: 'ask-marker', label: 'Ask about the marker' },
        { id: 'accept-wayfinding-quest', label: "I'll follow the marker" },
      ],
    });
    await expect(client.talk(characterId, 'mara-waykeeper', 'bell', 'sdk-talk-topic'))
      .resolves.toMatchObject({
        npcName: 'Mara',
        text: 'The bell has not rung in years. The tower stands east of this clearing.',
        choices: [],
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'sdk-talk-marker-unaccepted'))
      .resolves.toMatchObject({
        text: 'The marker is old, but the carving still points east toward the western approach to the Old Bell Tower.',
        choices: [],
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'weather', 'sdk-talk-unknown-topic'))
      .resolves.toMatchObject({ text: 'Ask me about the marker or the bell tower.', choices: [] });
    const secondCreated = await client.createCharacter('Ash', 'sdk-create-second');
    const secondCharacterId = secondCreated.streamId!;
    await expect(client.talk(secondCharacterId, 'mara-waykeeper', undefined, 'sdk-talk-second-character'))
      .resolves.toMatchObject({
        text: 'The old paths still have their stories. What would you like to ask?',
        choices: [
          { id: 'ask-marker', label: 'Ask about the marker' },
          { id: 'accept-wayfinding-quest', label: "I'll follow the marker" },
        ],
      });

    const choice = await client.chooseNpcDialogue(characterId, 'mara-waykeeper', 'ask-marker', afterRead.revision, 'sdk-choose-marker');
    expect(choice.receipt).toMatchObject({ ok: true, newAggregateVersion: afterRead.revision + 1 });
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-after-choice'))
      .resolves.toEqual({
        npcId: 'mara-waykeeper',
        npcName: 'Mara',
        text: 'The marker points east toward the Old Bell Tower’s western approach. Its direction is still true.',
        choices: [
          { id: 'accept-wayfinding-quest', label: "I'll follow the marker" },
        ],
      });
    await expect(client.talk(secondCharacterId, 'mara-waykeeper', undefined, 'sdk-talk-second-character-after-choice'))
      .resolves.toMatchObject({ text: 'The old paths still have their stories. What would you like to ask?' });
    await expect(client.chooseNpcDialogue(characterId, 'mara-waykeeper', 'ask-marker', afterRead.revision + 1, 'sdk-choice-marker-again'))
      .rejects.toThrow('You have already asked about that.');

    const restartedDialogue = await client.restartNpcDialogue(
      characterId,
      'mara-waykeeper',
      afterRead.revision + 1,
      'sdk-restart-dialogue',
    );
    expect(restartedDialogue.receipt).toMatchObject({
      ok: true,
      newAggregateVersion: afterRead.revision + 2,
    });
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-after-restart'))
      .resolves.toMatchObject({
        text: 'The old paths still have their stories. What would you like to ask?',
        choices: expect.arrayContaining([{ id: 'ask-marker', label: 'Ask about the marker' }]),
      });

    const afterDialogue = await client.look(characterId, 'sdk-look-after-dialogue');
    const taken = await client.take(characterId, 'mossgate-loose-stone', afterDialogue.revision, 'sdk-take');
    expect(taken.receipt).toMatchObject({ ok: true, newAggregateVersion: afterDialogue.revision + 1 });
    await expect(client.inspect(characterId, 'mossgate-loose-stone', 'sdk-inspect-carried'))
      .resolves.toEqual({
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      });
    const afterTake = await client.look(characterId, 'sdk-look-after-take');
    expect(afterTake.revision).toBe(afterDialogue.revision + 1);
    expect(afterTake.objects).not.toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone' }));
    expect(afterTake.description).not.toContain('One loose stone bears a pale stripe.');
    const pebbleTaken = await client.take(characterId, 'sdk-test-pebble', afterTake.revision, 'sdk-take-pebble');
    expect(pebbleTaken.receipt).toMatchObject({ ok: true, newAggregateVersion: afterTake.revision + 1 });
    const afterPebbleTake = await client.look(characterId, 'sdk-look-after-pebble-take');
    expect(afterPebbleTake.objects).not.toContainEqual(expect.objectContaining({ id: 'sdk-test-pebble' }));
    const dropped = await client.drop(characterId, 'sdk-test-pebble', afterPebbleTake.revision, 'sdk-drop');
    expect(dropped.receipt).toMatchObject({ ok: true, newAggregateVersion: afterPebbleTake.revision + 1 });
    const afterDrop = await client.look(characterId, 'sdk-look-after-drop');
    expect(afterDrop.description).toContain('A plain test pebble lies nearby.');
    expect(afterDrop.objects).toContainEqual(expect.objectContaining({
      id: 'sdk-test-pebble',
      takeable: true,
    }));
    const takenAgain = await client.take(characterId, 'sdk-test-pebble', afterDrop.revision, 'sdk-take-again');
    expect(takenAgain.receipt).toMatchObject({ ok: true, newAggregateVersion: afterDrop.revision + 1 });
    const moved = await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', afterDrop.revision + 1, 'sdk-move');
    expect(moved.receipt.ok).toBe(true);
    const nextRoom = await client.look(characterId, 'sdk-look-2');
    expect(nextRoom.title).toBe('Clearwater: Glasswater Bridge');
    await expect(client.inspect(characterId, 'mossgate-loose-stone', 'sdk-inspect-carried-away'))
      .resolves.toMatchObject({ id: 'mossgate-loose-stone', label: 'Loose stone' });
    await expect(client.inspect(characterId, 'mossgate-marker', 'sdk-inspect-unavailable'))
      .rejects.toThrow('That object is not here or in your pack.');
    await expect(client.read(characterId, 'mossgate-marker', nextRoom.revision, 'sdk-read-from-bridge'))
      .rejects.toThrow('That object is not readable from here.');
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'sdk-talk-away'))
      .rejects.toThrow('That person is not here.');
    await expect(client.chooseNpcDialogue(characterId, 'mara-waykeeper', 'ask-tower', nextRoom.revision, 'sdk-choice-away'))
      .rejects.toThrow('That person is not here.');
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      nextRoom.revision,
      'sdk-use-target-away',
    )).rejects.toThrow('That is not a usable target in this room.');
    const movedToWest = await moveAlongDemoRoad(client, characterId, 'bridge-to-tower-west', nextRoom.revision, 'sdk-move-tower-west');
    expect(movedToWest.receipt.ok).toBe(true);
    const westApproach = await client.look(characterId, 'sdk-look-tower-west');
    const movedToTower = await client.move(
      characterId,
      'bell-tower-west-to-tower',
      westApproach.revision,
      'sdk-move-tower',
    );
    expect(movedToTower.receipt.ok).toBe(true);
    const tower = await client.look(characterId, 'sdk-look-tower');
    expect(tower.objects).not.toContainEqual(expect.objectContaining({
      id: 'tower-cracked-bell',
    }));
    expect(tower.exits).toContainEqual(expect.objectContaining({ id: 'tower-to-belfry', available: true }));
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      tower.revision,
      'sdk-use-bell-from-ground-floor',
    )).rejects.toThrow('That is not a usable target in this room.');
    await client.move(characterId, 'tower-to-belfry', tower.revision, 'sdk-climb-to-belfry');
    const belfry = await client.look(characterId, 'sdk-look-belfry');
    expect(belfry.objects).toContainEqual(expect.objectContaining({
      id: 'tower-cracked-bell',
      readable: false,
      takeable: false,
    }));
    const firstUse = await client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      belfry.revision,
      'sdk-use-bell',
    );
    expect(firstUse).toEqual({
      interactionId: 'ring-tower-bell-with-stone',
      response: 'You strike the cracked bell with the smooth stone. A low, uneven note rolls through the tower.',
    });
    const afterFirstUse = await client.look(characterId, 'sdk-look-after-use');
    const characterAfterFirstUse = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(characterAfterFirstUse?.itemUseObservations).toContainEqual({
      interactionId: 'ring-tower-bell-with-stone',
      itemId: 'mossgate-loose-stone',
      targetId: 'tower-cracked-bell',
      locationId: 'bell-tower-belfry',
    });
    expect(characterAfterFirstUse?.inventory).toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone' }));
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      afterFirstUse.revision,
      'sdk-use-bell-again',
    )).resolves.toEqual({
      interactionId: 'ring-tower-bell-with-stone',
      response: 'You strike the bell again. Its low note echoes through the stonework.',
    });
    const afterRepeatUse = await client.look(characterId, 'sdk-look-after-repeat-use');
    await expect(client.use(
      characterId,
      'mossgate-marker',
      'tower-cracked-bell',
      afterRepeatUse.revision,
      'sdk-use-unowned-item',
    )).rejects.toThrow('You are not carrying that item.');
    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'mossgate-marker',
      afterRepeatUse.revision,
      'sdk-use-unknown-target',
    )).rejects.toThrow('That is not a usable target in this room.');
    await engine.stop();
  });

  it('solves the bell puzzle in order, opens the Underhollow, and completes its quest', async () => {
    const session = {
      sessionId: 'session-bell-puzzle',
      playerId: 'player-bell-puzzle',
      actorId: 'player-bell-puzzle',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    let simulatedNow = new Date('2026-10-23T12:00:00.000Z');
    const engine = new EngineHost(
      testPlugins,
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoTestWorld(),
      undefined,
      () => {
        const settledAt = simulatedNow;
        simulatedNow = new Date(simulatedNow.getTime() + 5_000);
        return settledAt;
      },
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = String(input).endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Lark', 'puzzle-create');
    const characterId = created.streamId!;

    const clearing = await client.look(characterId, 'puzzle-look-clearing');
    await client.take(characterId, 'mossgate-loose-stone', clearing.revision, 'puzzle-take-stone');
    const afterStone = await client.look(characterId, 'puzzle-look-after-stone');
    await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', afterStone.revision, 'puzzle-go-bridge');
    const bridge = await client.look(characterId, 'puzzle-look-bridge');
    const eddaOpening = await client.talk(characterId, 'edda-bellwright', undefined, 'puzzle-talk-edda');
    expect(eddaOpening.choices).toContainEqual({
      id: 'accept-bell-echo',
      label: 'Investigate the bell puzzle',
    });
    await client.chooseNpcDialogue(
      characterId,
      'edda-bellwright',
      'accept-bell-echo',
      bridge.revision,
      'puzzle-accept-quest',
    );
    const firstHint = await client.talk(characterId, 'edda-bellwright', 'hint', 'puzzle-hint-one');
    expect(firstHint.text).toContain('Hint 1');
    const afterAccept = await client.look(characterId, 'puzzle-look-after-accept');
    await client.take(characterId, 'glasswater-reed', afterAccept.revision, 'puzzle-take-reed');
    const bridgeWithReed = await client.look(characterId, 'puzzle-look-bridge-with-reed');
    await moveAlongDemoRoad(client, characterId, 'bridge-to-tower-west', bridgeWithReed.revision, 'puzzle-go-tower-west');
    const towerWest = await client.look(characterId, 'puzzle-look-tower-west');
    await client.move(characterId, 'bell-tower-west-to-tower', towerWest.revision, 'puzzle-go-tower');

    const tower = await client.look(characterId, 'puzzle-look-tower');
    expect(tower.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-belfry',
      available: true,
    }));
    await client.move(characterId, 'tower-to-belfry', tower.revision, 'puzzle-climb-to-belfry');
    const belfry = await client.look(characterId, 'puzzle-look-belfry');
    expect(belfry.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-underhollow',
      available: false,
    }));
    await expect(client.move(
      characterId,
      'tower-to-underhollow',
      belfry.revision,
      'puzzle-try-locked-stair',
    )).rejects.toThrow('That passage is still sealed.');

    const inscription = await client.read(
      characterId,
      'tower-bell-inscription',
      belfry.revision,
      'puzzle-read-inscription',
    );
    expect(inscription.text).toContain('Pale first, hollow second.');
    const belfryAfterReading = await client.look(characterId, 'puzzle-look-after-inscription');
    await client.move(characterId, 'belfry-to-tower', belfryAfterReading.revision, 'puzzle-descend-to-tower-floor');
    const towerFloorAfterReading = await client.look(characterId, 'puzzle-look-tower-floor-after-reading');
    await client.move(characterId, 'tower-to-west-approach', towerFloorAfterReading.revision, 'puzzle-return-to-west-for-hint-two');
    const westForHintTwo = await client.look(characterId, 'puzzle-look-west-for-hint-two');
    await moveAlongDemoRoad(client, characterId, 'bell-tower-west-to-bridge', westForHintTwo.revision, 'puzzle-return-for-hint-two');
    const bridgeForHintTwo = await client.look(characterId, 'puzzle-look-for-hint-two');
    const secondHint = await client.talk(characterId, 'edda-bellwright', 'hint', 'puzzle-hint-two');
    expect(secondHint.text).toContain('Hint 2');
    await moveAlongDemoRoad(client, characterId, 'bridge-to-tower-west', bridgeForHintTwo.revision, 'puzzle-return-to-west-for-bell');
    const westForBell = await client.look(characterId, 'puzzle-look-west-for-bell');
    await client.move(characterId, 'bell-tower-west-to-tower', westForBell.revision, 'puzzle-return-for-bell');
    const towerForBell = await client.look(characterId, 'puzzle-look-for-bell');
    await client.move(characterId, 'tower-to-belfry', towerForBell.revision, 'puzzle-return-to-belfry-for-bell');
    const belfryForBell = await client.look(characterId, 'puzzle-look-for-bell-in-belfry');
    await expect(client.use(
      characterId,
      'glasswater-reed',
      'tower-cracked-bell',
      belfryForBell.revision,
      'puzzle-reed-first',
    )).rejects.toThrow('The bell gives a dull click. Its first note is still missing; the inscription says pale first.');

    await expect(client.use(
      characterId,
      'mossgate-loose-stone',
      'tower-cracked-bell',
      belfryForBell.revision,
      'puzzle-strike-with-stone',
    )).resolves.toMatchObject({
      interactionId: 'ring-tower-bell-with-stone',
      response: expect.stringContaining('A low, uneven note'),
    });
    const afterFirstNote = await client.look(characterId, 'puzzle-look-after-first-note');
    expect(afterFirstNote.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-underhollow',
      available: false,
    }));
    await client.move(characterId, 'belfry-to-tower', afterFirstNote.revision, 'puzzle-descend-for-hint-three');
    const towerFloorForHintThree = await client.look(characterId, 'puzzle-look-tower-floor-for-hint-three');
    await client.move(characterId, 'tower-to-west-approach', towerFloorForHintThree.revision, 'puzzle-return-to-west-for-hint-three');
    const westForHintThree = await client.look(characterId, 'puzzle-look-west-for-hint-three');
    await moveAlongDemoRoad(client, characterId, 'bell-tower-west-to-bridge', westForHintThree.revision, 'puzzle-return-for-hint-three');
    const bridgeForHintThree = await client.look(characterId, 'puzzle-look-for-hint-three');
    const thirdHint = await client.talk(characterId, 'edda-bellwright', 'hint', 'puzzle-hint-three');
    expect(thirdHint.text).toContain('Hint 3');
    await moveAlongDemoRoad(client, characterId, 'bridge-to-tower-west', bridgeForHintThree.revision, 'puzzle-return-to-west-for-finish');
    const westForReed = await client.look(characterId, 'puzzle-look-west-for-reed');
    await client.move(characterId, 'bell-tower-west-to-tower', westForReed.revision, 'puzzle-return-to-tower-for-finish');
    const towerForReed = await client.look(characterId, 'puzzle-look-for-reed');
    await client.move(characterId, 'tower-to-belfry', towerForReed.revision, 'puzzle-climb-for-reed');
    const belfryForReed = await client.look(characterId, 'puzzle-look-for-reed-in-belfry');
    expect(belfryForReed.objects).toContainEqual(expect.objectContaining({
      id: 'bellwright-underhollow-key',
      takeable: true,
    }));
    await client.take(
      characterId,
      'bellwright-underhollow-key',
      belfryForReed.revision,
      'puzzle-take-underhollow-key',
    );
    const belfryAfterKey = await client.look(characterId, 'puzzle-look-after-taking-key');
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.inventory)
      .toContainEqual(expect.objectContaining({
        id: 'bellwright-underhollow-key',
        questBound: true,
      }));
    await expect(client.drop(
      characterId,
      'bellwright-underhollow-key',
      belfryAfterKey.revision,
      'puzzle-try-dropping-key',
    )).rejects.toThrow('Quest items cannot be dropped.');
    await expect(client.use(
      characterId,
      'glasswater-reed',
      'tower-cracked-bell',
      belfryAfterKey.revision,
      'puzzle-answer-with-reed',
    )).resolves.toMatchObject({
      interactionId: 'answer-tower-bell-with-reed',
      response: expect.stringContaining('a narrow stair opens beneath the bell'),
    });

    const afterSecondNote = await client.look(characterId, 'puzzle-look-after-second-note');
    expect(afterSecondNote.exits).toContainEqual(expect.objectContaining({
      id: 'tower-to-underhollow',
      available: true,
    }));
    const solvedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(projectQuestJournal(solvedState, demoWorld)).toMatchObject([{
      questId: 'eddas-bell-echo',
      status: 'active',
      objectives: [
        { id: 'read-bell-inscription', completed: true },
        { id: 'strike-bell-with-stone', completed: true },
        { id: 'answer-bell-with-reed', completed: true },
        { id: 'visit-underhollow', completed: false },
      ],
    }]);

    await client.move(characterId, 'tower-to-underhollow', afterSecondNote.revision, 'puzzle-descend');
    const underhollow = await client.look(characterId, 'puzzle-look-underhollow');
    expect(underhollow.title).toBe('The Underhollow');
    expect(underhollow.objects).toContainEqual(expect.objectContaining({
      id: 'underhollow-iron-door',
      takeable: false,
    }));
    expect(underhollow.exits).toContainEqual(expect.objectContaining({
      id: 'underhollow-to-service-hall',
      available: false,
    }));
    await expect(client.move(
      characterId,
      'underhollow-to-service-hall',
      underhollow.revision,
      'puzzle-try-locked-underhollow-door',
    )).rejects.toThrow('That passage is still sealed.');
    await expect(client.use(
      characterId,
      'bellwright-underhollow-key',
      'underhollow-iron-door',
      underhollow.revision,
      'puzzle-unlock-underhollow-door',
    )).resolves.toMatchObject({
      interactionId: 'unlock-underhollow-door-with-key',
      response: expect.stringContaining('open onto a narrow stone hallway'),
    });
    const openedUnderhollow = await client.look(characterId, 'puzzle-look-after-unlocking-door');
    expect(openedUnderhollow.exits).toContainEqual(expect.objectContaining({
      id: 'underhollow-to-service-hall',
      available: true,
    }));
    await client.move(
      characterId,
      'underhollow-to-service-hall',
      openedUnderhollow.revision,
      'puzzle-enter-service-hall',
    );
    const serviceHall = await client.look(characterId, 'puzzle-look-service-hall');
    expect(serviceHall.title).toBe('Bell Tower Service Hall');
    expect(serviceHall.objects).toContainEqual(expect.objectContaining({
      id: 'service-hall-sealed-arch',
    }));
    expect(serviceHall.exits).toContainEqual(expect.objectContaining({
      id: 'service-hall-to-underhollow',
      available: true,
    }));
    const underhollowDefinition = demoWorld.locations.find((location) => location.id === 'bell-underhollow');
    const hallwayDefinition = demoWorld.locations.find((location) => location.id === 'bell-tower-service-hall');
    expect(hallwayDefinition).toMatchObject({
      mapAreaId: underhollowDefinition?.mapAreaId,
      mapPosition: { x: 2, y: 0, z: -1 },
    });
    expect(underhollowDefinition?.mapPosition?.z).toBe(hallwayDefinition?.mapPosition?.z);
    const echoGalleryDefinition = demoWorld.locations.find((location) => location.id === 'undercrypt-echo-gallery');
    expect(echoGalleryDefinition).toMatchObject({
      mapAreaId: 'bell-tower-undercrypt',
      mapPosition: { x: 2, y: 2, z: 0 },
    });
    expect(echoGalleryDefinition?.mapAreaId).not.toBe(hallwayDefinition?.mapAreaId);
    expect(demoWorld.locations.find((location) => location.id === 'undercrypt-entry-passage'))
      .toMatchObject({ mapAreaId: 'bell-tower-undercrypt', mapPosition: { x: 3, y: 0, z: 0 } });

    expect(serviceHall.exits).toContainEqual(expect.objectContaining({
      id: 'service-hall-to-undercrypt-entry',
      available: false,
    }));
    await expect(client.move(
      characterId,
      'service-hall-to-undercrypt-entry',
      serviceHall.revision,
      'puzzle-try-locked-undercrypt-arch',
    )).rejects.toThrow('That passage is still sealed.');
    await client.use(
      characterId,
      'bellwright-underhollow-key',
      'service-hall-sealed-arch',
      serviceHall.revision,
      'puzzle-open-undercrypt-arch',
    );
    const openedServiceHall = await client.look(characterId, 'puzzle-look-open-undercrypt-arch');
    expect(openedServiceHall.exits).toContainEqual(expect.objectContaining({
      id: 'service-hall-to-undercrypt-entry',
      available: true,
    }));
    await client.move(
      characterId,
      'service-hall-to-undercrypt-entry',
      openedServiceHall.revision,
      'puzzle-enter-undercrypt-entry',
    );
    const entryPassage = await client.look(characterId, 'puzzle-look-undercrypt-entry');
    expect(entryPassage.title).toBe('Undercrypt Entry Passage');
    await client.move(
      characterId,
      'undercrypt-entry-to-rattle-run',
      entryPassage.revision,
      'puzzle-enter-rattle-run',
    );
    let rattleRun = await client.look(characterId, 'puzzle-look-rattle-run');
    await client.roadStep(
      characterId,
      'rattle-run-to-crossway',
      rattleRun.revision,
      'puzzle-enter-crossway',
    );
    let crossway = await client.look(characterId, 'puzzle-look-crossway');
    expect(crossway.exits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'crossway-to-echo-gallery', available: true }),
      expect.objectContaining({ id: 'crossway-to-east-bend', available: true }),
    ]));
    await client.move(
      characterId,
      'crossway-to-echo-gallery',
      crossway.revision,
      'puzzle-enter-echo-gallery',
    );
    let echoGallery = await client.look(characterId, 'puzzle-look-echo-gallery');
    expect(echoGallery.title).toBe('Echo Gallery');
    expect(echoGallery.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'undercrypt-pale-stone', takeable: true }),
      expect.objectContaining({ id: 'undercrypt-hollow-reed', takeable: true }),
    ]));
    const echoInscription = await client.read(
      characterId,
      'echo-gallery-rubbing',
      echoGallery.revision,
      'puzzle-read-echo-gallery-rubbing',
    );
    expect(echoInscription.text).toContain('Set the pale stone in its bowl first');
    echoGallery = await client.look(characterId, 'puzzle-look-after-echo-clue');
    await client.take(characterId, 'undercrypt-pale-stone', echoGallery.revision, 'puzzle-take-pale-stone');
    echoGallery = await client.look(characterId, 'puzzle-look-after-taking-pale-stone');
    await client.take(characterId, 'undercrypt-hollow-reed', echoGallery.revision, 'puzzle-take-undercrypt-reed');
    echoGallery = await client.look(characterId, 'puzzle-look-before-first-echo');
    await expect(client.use(
      characterId,
      'undercrypt-hollow-reed',
      'echo-gallery-split-pipe',
      echoGallery.revision,
      'puzzle-try-reed-before-stone',
    )).rejects.toThrow('the low note must rest first.');
    await client.use(
      characterId,
      'undercrypt-pale-stone',
      'echo-gallery-stone-bowl',
      echoGallery.revision,
      'puzzle-set-echo-stone',
    );
    echoGallery = await client.look(characterId, 'puzzle-look-after-echo-stone');
    await client.use(
      characterId,
      'undercrypt-hollow-reed',
      'echo-gallery-split-pipe',
      echoGallery.revision,
      'puzzle-send-echo-reed',
    );
    echoGallery = await client.look(characterId, 'puzzle-look-after-echo-solution');
    expect(echoGallery.exits).toContainEqual(expect.objectContaining({
      id: 'echo-gallery-to-west-passage',
      available: true,
    }));
    await client.move(
      characterId,
      'echo-gallery-to-west-passage',
      echoGallery.revision,
      'puzzle-enter-west-passage',
    );
    let westPassage = await client.look(characterId, 'puzzle-look-west-passage');
    expect(westPassage.title).toBe('West Passage');
    await client.roadStep(
      characterId,
      'west-passage-to-west-bend',
      westPassage.revision,
      'puzzle-enter-west-bend',
    );
    let westBend = await client.look(characterId, 'puzzle-look-west-bend');
    await client.roadStep(
      characterId,
      'west-bend-to-west-turn',
      westBend.revision,
      'puzzle-enter-west-turn',
    );
    const westTurn = await client.look(characterId, 'puzzle-look-west-turn');
    await client.roadStep(
      characterId,
      'west-turn-to-north-junction',
      westTurn.revision,
      'puzzle-enter-north-junction',
    );
    const northJunction = await client.look(characterId, 'puzzle-look-north-junction');
    expect(northJunction.exits).toContainEqual(expect.objectContaining({
      id: 'north-junction-to-flooded-archive',
      available: true,
    }));
    await client.move(
      characterId,
      'north-junction-to-flooded-archive',
      northJunction.revision,
      'puzzle-enter-flooded-archive',
    );
    let archive = await client.look(characterId, 'puzzle-look-flooded-archive');
    expect(archive.title).toBe('Flooded Archive');
    expect(archive.exits).toContainEqual(expect.objectContaining({
      id: 'flooded-archive-to-reliquary-approach',
      available: false,
    }));
    const archiveLedger = await client.read(
      characterId,
      'archive-ledger-clue',
      archive.revision,
      'puzzle-read-archive-ledger',
    );
    expect(archiveLedger.text).toContain('Balance before reflection');
    archive = await client.look(characterId, 'puzzle-look-after-archive-clue');
    await client.take(characterId, 'undercrypt-silver-weight', archive.revision, 'puzzle-take-silver-weight');
    archive = await client.look(characterId, 'puzzle-look-after-taking-weight');
    await client.take(characterId, 'undercrypt-mirror-shard', archive.revision, 'puzzle-take-mirror-shard');
    archive = await client.look(characterId, 'puzzle-look-before-archive-puzzle');
    await client.take(characterId, 'undercrypt-bellwright-seal', archive.revision, 'puzzle-take-silver-seal');
    archive = await client.look(characterId, 'puzzle-look-after-taking-seal');
    await client.take(characterId, 'undercrypt-bellwright-vest', archive.revision, 'puzzle-take-scale-vest');
    archive = await client.look(characterId, 'puzzle-look-before-archive-solution');
    await expect(client.use(
      characterId,
      'undercrypt-mirror-shard',
      'archive-water-plinth',
      archive.revision,
      'puzzle-try-reflection-before-weight',
    )).rejects.toThrow('ledger says the dry scale must be balanced first');
    await client.use(
      characterId,
      'undercrypt-silver-weight',
      'archive-dry-scale',
      archive.revision,
      'puzzle-set-archive-weight',
    );
    archive = await client.look(characterId, 'puzzle-look-after-archive-weight');
    await client.use(
      characterId,
      'undercrypt-mirror-shard',
      'archive-water-plinth',
      archive.revision,
      'puzzle-set-archive-reflection',
    );
    archive = await client.look(characterId, 'puzzle-look-after-archive-solution');
    expect(archive.exits).toContainEqual(expect.objectContaining({
      id: 'flooded-archive-to-reliquary-approach',
      available: true,
    }));
    const archiveState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(archiveState.inventory).toContainEqual(expect.objectContaining({
      id: 'undercrypt-bellwright-vest',
      equipment: { slot: 'armor', attackBonus: 0, defenseBonus: 1 },
    }));
    await client.equip(
      characterId,
      'undercrypt-bellwright-vest',
      archive.revision,
      'puzzle-equip-bellwright-vest',
    );
    archive = await client.look(characterId, 'puzzle-look-after-equipping-vest');
    const gearedArchiveState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(gearedArchiveState.equipment.armorItemId).toBe('undercrypt-bellwright-vest');
    await client.move(
      characterId,
      'flooded-archive-to-reliquary-approach',
      archive.revision,
      'puzzle-enter-reliquary-approach',
    );
    let approach = await client.look(characterId, 'puzzle-look-reliquary-approach');
    expect(approach.title).toBe('Reliquary Approach');
    await client.move(
      characterId,
      'reliquary-approach-to-reliquary',
      approach.revision,
      'puzzle-enter-bellwright-reliquary',
    );
    let reliquary = await client.look(characterId, 'puzzle-look-bellwright-reliquary');
    expect(reliquary.title).toBe('Bellwright Reliquary');
    expect(reliquary.objects).toContainEqual(expect.objectContaining({
      id: 'undercrypt-echoedge',
      takeable: true,
    }));
    await client.take(characterId, 'undercrypt-echoedge', reliquary.revision, 'puzzle-take-echoedge');
    reliquary = await client.look(characterId, 'puzzle-look-after-taking-echoedge');
    const swordInventory = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!.inventory;
    expect(swordInventory).toContainEqual(expect.objectContaining({
      id: 'undercrypt-echoedge',
      equipment: { slot: 'weapon', attackBonus: 2, defenseBonus: 0 },
    }));
    await client.equip(characterId, 'undercrypt-echoedge', reliquary.revision, 'puzzle-equip-echoedge');
    reliquary = await client.look(characterId, 'puzzle-look-after-equipping-echoedge');
    const armedCharacter = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(armedCharacter.equipment.weaponItemId).toBe('undercrypt-echoedge');
    expect(armedCharacter.equipment.armorItemId).toBe('undercrypt-bellwright-vest');
    await client.move(
      characterId,
      'reliquary-to-reliquary-approach',
      reliquary.revision,
      'puzzle-return-to-reliquary-approach',
    );
    approach = await client.look(characterId, 'puzzle-look-after-reliquary');
    await client.move(
      characterId,
      'reliquary-approach-to-archive',
      approach.revision,
      'puzzle-return-to-archive',
    );
    archive = await client.look(characterId, 'puzzle-look-after-reliquary');
    await client.move(
      characterId,
      'flooded-archive-to-north-junction',
      archive.revision,
      'puzzle-return-to-north-junction',
    );
    const northJunctionAfter = await client.look(characterId, 'puzzle-look-north-junction-after-archive');
    await client.roadStep(
      characterId,
      'north-junction-to-west-turn',
      northJunctionAfter.revision,
      'puzzle-return-to-west-turn',
    );
    const westTurnAfter = await client.look(characterId, 'puzzle-look-west-turn-after-archive');
    await client.roadStep(
      characterId,
      'west-turn-to-west-bend',
      westTurnAfter.revision,
      'puzzle-return-to-west-bend',
    );
    westBend = await client.look(characterId, 'puzzle-look-west-bend-after-archive');
    await client.roadStep(
      characterId,
      'west-bend-to-west-passage',
      westBend.revision,
      'puzzle-return-to-west-passage',
    );
    westPassage = await client.look(characterId, 'puzzle-look-west-passage-after-archive');
    await client.move(
      characterId,
      'west-passage-to-echo-gallery',
      westPassage.revision,
      'puzzle-return-to-echo-gallery',
    );
    echoGallery = await client.look(characterId, 'puzzle-look-echo-gallery-after-archive');
    await client.move(
      characterId,
      'echo-gallery-to-crossway',
      echoGallery.revision,
      'puzzle-return-to-crossway',
    );
    crossway = await client.look(characterId, 'puzzle-look-crossway-after-archive');
    await client.roadStep(
      characterId,
      'crossway-to-rattle-run',
      crossway.revision,
      'puzzle-return-to-rattle-run',
    );
    rattleRun = await client.look(characterId, 'puzzle-look-rattle-run-after-archive');
    await client.move(
      characterId,
      'rattle-run-to-entry-passage',
      rattleRun.revision,
      'puzzle-return-to-entry-passage',
    );
    await client.move(
      characterId,
      'undercrypt-entry-to-service-hall',
      (await client.look(characterId, 'puzzle-look-entry-after-dungeon')).revision,
      'puzzle-return-to-service-hall-from-dungeon',
    );
    const hallAfterDungeon = await client.look(characterId, 'puzzle-look-service-hall-after-dungeon');
    expect(hallAfterDungeon.exits).toContainEqual(expect.objectContaining({
      id: 'service-hall-to-undercrypt-entry',
      available: true,
    }));

    await client.move(
      characterId,
      'service-hall-to-underhollow',
      hallAfterDungeon.revision,
      'puzzle-return-from-service-hall',
    );
    const returnedUnderhollow = await client.look(characterId, 'puzzle-look-after-service-hall');
    await client.move(characterId, 'underhollow-to-belfry', returnedUnderhollow.revision, 'puzzle-return-to-belfry');
    const belfryAgain = await client.look(characterId, 'puzzle-look-belfry-again');
    await client.move(characterId, 'belfry-to-tower', belfryAgain.revision, 'puzzle-descend-to-tower-floor-after-underhollow');
    const towerAgain = await client.look(characterId, 'puzzle-look-tower-again');
    await client.move(characterId, 'tower-to-west-approach', towerAgain.revision, 'puzzle-return-to-west-before-bridge');
    const westBeforeBridge = await client.look(characterId, 'puzzle-look-west-before-bridge');
    await moveAlongDemoRoad(client, characterId, 'bell-tower-west-to-bridge', westBeforeBridge.revision, 'puzzle-return-bridge');
    const bridgeAgain = await client.look(characterId, 'puzzle-look-bridge-again');
    const eddaAfter = await client.talk(characterId, 'edda-bellwright', undefined, 'puzzle-talk-edda-after');
    expect(eddaAfter.choices).toContainEqual({
      id: 'report-bell-echo',
      label: 'I found the Underhollow',
    });
    await client.chooseNpcDialogue(
      characterId,
      'edda-bellwright',
      'report-bell-echo',
      bridgeAgain.revision,
      'puzzle-report-quest',
    );
    const completedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(completedState.visitedLocationIds).toContain('bell-underhollow');
    expect(completedState.questProgress).toContainEqual(expect.objectContaining({
      questId: 'eddas-bell-echo',
      status: 'completed',
    }));
    await engine.stop();
  });

  it('records character-specific quest progress from reading and movement, then turns it in with Mara', async () => {
    const session = {
      sessionId: 'session-quest',
      playerId: 'player-quest',
      actorId: 'player-quest',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    let simulatedNow = new Date('2026-10-23T12:00:00.000Z');
    const engine = new EngineHost(
      testPlugins,
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoTestWorld(),
      undefined,
      () => {
        const settledAt = simulatedNow;
        simulatedNow = new Date(simulatedNow.getTime() + 5_000);
        return settledAt;
      },
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = String(input).endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Willow', 'quest-create');
    const characterId = created.streamId!;
    const opening = await client.talk(characterId, 'mara-waykeeper', undefined, 'quest-opening');
    expect(opening.choices).toContainEqual({
      id: 'accept-wayfinding-quest',
      label: "I'll follow the marker",
    });

    await client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'accept-wayfinding-quest',
      1,
      'quest-accept',
    );
    const afterAccept = await client.look(characterId, 'quest-look-after-accept');
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'quest-talk-after-accept'))
      .resolves.toMatchObject({
        text: 'I’ll mark the way for you. Read the weathered marker beside me to start.',
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-before-read'))
      .resolves.toMatchObject({
        text: 'The marker is old, but the carving still points east toward the western approach to the Old Bell Tower.',
        choices: [],
      });
    const dialogueBeforeObjective = await client.talk(
      characterId,
      'mara-waykeeper',
      undefined,
      'quest-talk-before-marker',
    );
    expect(dialogueBeforeObjective.choices).not.toContainEqual({
      id: 'ask-tower',
      label: 'Ask about the bell tower',
    });
    await expect(client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'ask-tower',
      afterAccept.revision,
      'quest-choice-before-marker',
    )).rejects.toThrow('That choice is not available here.');
    const acceptedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(projectQuestJournal(acceptedState, demoWorld)).toMatchObject([{
      questId: 'mara-wayfinding',
      status: 'active',
      objectives: [
        { id: 'read-marker', completed: false },
        { id: 'visit-bell-tower', completed: false },
      ],
    }]);
    await expect(client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'report-wayfinding-quest',
      afterAccept.revision,
      'quest-premature-turn-in',
    )).rejects.toThrow('You have more to do before reporting back.');

    const marker = await client.read(characterId, 'mossgate-marker', afterAccept.revision, 'quest-read-marker');
    expect(marker.text).toBe('OLD BELL TOWER — EAST');
    const afterRead = await client.look(characterId, 'quest-look-after-read');
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'quest-talk-after-read'))
      .resolves.toMatchObject({
        text: 'You read the marker. Its arrow points east to the tower’s western approach. Follow the path there, enter the tower, then come back and tell me what you found.',
      });
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-after-read'))
      .resolves.toMatchObject({
        text: 'You’ve read the marker now. Its arrow points east to the tower’s western approach.',
        choices: [],
      });
    await expect(client.talk(characterId, 'mara-waykeeper', undefined, 'quest-talk-choice-unlocked'))
      .resolves.toMatchObject({
        choices: expect.arrayContaining([{
          id: 'ask-tower',
          label: 'Ask about the bell tower',
        }]),
      });
    await moveAlongDemoRoad(client, characterId, 'clearing-to-tower-west', afterRead.revision, 'quest-visit-tower-west');
    const westApproach = await client.look(characterId, 'quest-look-tower-west');
    await client.move(characterId, 'bell-tower-west-to-tower', westApproach.revision, 'quest-visit-tower');
    const atTower = await client.look(characterId, 'quest-look-at-tower');
    expect(atTower.title).toBe('Old Bell Tower');
    const towerState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(towerState.visitedLocationIds).toContain('bell-tower-west');
    expect(projectQuestJournal(towerState, demoWorld)[0]?.objectives.every((objective) => objective.completed))
      .toBe(true);

    await client.move(characterId, 'tower-to-west-approach', atTower.revision, 'quest-return-to-west');
    const westOnReturn = await client.look(characterId, 'quest-look-west-on-return');
    await moveAlongDemoRoad(client, characterId, 'bell-tower-west-to-clearing', westOnReturn.revision, 'quest-return-to-mara');
    const backAtMara = await client.look(characterId, 'quest-look-back-at-mara');
    const reportDialogue = await client.talk(characterId, 'mara-waykeeper', undefined, 'quest-report-dialogue');
    expect(reportDialogue.text)
      .toBe('You reached the Old Bell Tower by its western approach. Tell me what you found when you are ready to report.');
    expect(reportDialogue.choices).toContainEqual({
      id: 'report-wayfinding-quest',
      label: 'I visited the Old Bell Tower',
    });
    await client.chooseNpcDialogue(
      characterId,
      'mara-waykeeper',
      'report-wayfinding-quest',
      backAtMara.revision,
      'quest-turn-in',
    );
    const completedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(completedState.questProgress).toMatchObject([{
      questId: 'mara-wayfinding',
      status: 'completed',
    }]);
    expect(projectQuestJournal(completedState, demoWorld)).toMatchObject([{
      questId: 'mara-wayfinding',
      status: 'completed',
      objectives: [
        { id: 'read-marker', completed: true },
        { id: 'visit-bell-tower', completed: true },
      ],
    }]);

    const completedDialogue = await client.talk(
      characterId,
      'mara-waykeeper',
      undefined,
      'quest-talk-after-turn-in',
    );
    expect(completedDialogue.text).toBe('You brought back the story of the path. Thank you; I will remember it.');
    await expect(client.talk(characterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-after-turn-in'))
      .resolves.toMatchObject({
        text: 'You read the marker and followed its direction through the western approach into the Old Bell Tower.',
        choices: [],
      });
    expect(completedDialogue.choices).not.toContainEqual({
      id: 'report-wayfinding-quest',
      label: 'I visited the Old Bell Tower',
    });

    const anotherCreated = await client.createCharacter('Cedar', 'quest-create-second-character');
    const anotherCharacterId = anotherCreated.streamId!;
    const anotherState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, anotherCharacterId))!;
    expect(projectQuestJournal(anotherState, demoWorld)).toEqual([]);
    await expect(client.talk(anotherCharacterId, 'mara-waykeeper', undefined, 'quest-talk-second-character'))
      .resolves.toMatchObject({
        text: 'The old paths still have their stories. What would you like to ask?',
      });
    await expect(client.talk(anotherCharacterId, 'mara-waykeeper', 'marker', 'quest-talk-marker-second-character'))
      .resolves.toMatchObject({
        text: 'The marker is old, but the carving still points east toward the western approach to the Old Bell Tower.',
        choices: [],
      });
    await engine.stop();
  });

  it('lets cottage residents talk and completes Talla’s waterline quest through reading and turn-in', async () => {
    const session = {
      sessionId: 'session-cottage-quest',
      playerId: 'player-cottage-quest',
      actorId: 'player-cottage-quest',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    let simulatedNow = new Date('2026-10-23T12:00:00.000Z');
    const engine = new EngineHost(
      testPlugins,
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoTestWorld(),
      undefined,
      () => {
        const settledAt = simulatedNow;
        simulatedNow = new Date(simulatedNow.getTime() + 5_000);
        return settledAt;
      },
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = String(input).endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Rowan', 'cottage-quest-create');
    const characterId = created.streamId!;

    const start = await client.look(characterId, 'cottage-quest-start');
    await moveAlongDemoRoad(
      client,
      characterId,
      'clearing-to-sedgewatch',
      start.revision,
      'cottage-quest-to-sedgewatch',
    );
    const atSedgewatch = await client.look(characterId, 'cottage-quest-look-sedgewatch');
    await client.move(
      characterId,
      'sedgewatch-to-cottage',
      atSedgewatch.revision,
      'cottage-quest-enter-sedgewatch-home',
    );
    const atTalla = await client.look(characterId, 'cottage-quest-look-talla');
    const opening = await client.talk(characterId, 'talla-sedgewatch', undefined, 'cottage-quest-talk-talla');
    expect(opening.choices).toContainEqual({
      id: 'accept-sedgewatch-waterline',
      label: 'I will check the bridge',
    });

    await client.chooseNpcDialogue(
      characterId,
      'talla-sedgewatch',
      'accept-sedgewatch-waterline',
      atTalla.revision,
      'cottage-quest-accept',
    );
    const acceptedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(projectQuestJournal(acceptedState, demoWorld)).toMatchObject([{
      questId: 'sedgewatch-waterline',
      status: 'active',
      objectives: [{ id: 'read-waterline', completed: false }],
    }]);

    const afterAccept = await client.look(characterId, 'cottage-quest-after-accept');
    await client.move(
      characterId,
      'sedgewatch-cottage-to-sedgewatch',
      afterAccept.revision,
      'cottage-quest-leave-sedgewatch-home',
    );
    const readyForBridge = await client.look(characterId, 'cottage-quest-ready-for-bridge');
    await moveAlongDemoRoad(
      client,
      characterId,
      'sedgewatch-to-bridge',
      readyForBridge.revision,
      'cottage-quest-to-bridge',
    );
    const atBridge = await client.look(characterId, 'cottage-quest-look-bridge');
    const gauge = await client.read(
      characterId,
      'glasswater-waterline-gauge',
      atBridge.revision,
      'cottage-quest-read-gauge',
    );
    expect(gauge.text).toBe('The lowest notch is wet. The middle and high notches are dry.');

    const afterReading = await client.look(characterId, 'cottage-quest-after-reading');
    await moveAlongDemoRoad(
      client,
      characterId,
      'bridge-to-sedgewatch',
      afterReading.revision,
      'cottage-quest-return-to-sedgewatch',
    );
    const backAtSedgewatch = await client.look(characterId, 'cottage-quest-look-return');
    await client.move(
      characterId,
      'sedgewatch-to-cottage',
      backAtSedgewatch.revision,
      'cottage-quest-reenter-home',
    );
    const readyToReport = await client.look(characterId, 'cottage-quest-ready-to-report');
    const reportDialogue = await client.talk(
      characterId,
      'talla-sedgewatch',
      undefined,
      'cottage-quest-report-dialogue',
    );
    expect(reportDialogue.choices).toContainEqual({
      id: 'report-sedgewatch-waterline',
      label: 'Report the waterline',
    });
    const turnInCommandId = 'cottage-quest-turn-in';
    await client.chooseNpcDialogue(
      characterId,
      'talla-sedgewatch',
      'report-sedgewatch-waterline',
      readyToReport.revision,
      turnInCommandId,
    );
    await client.chooseNpcDialogue(
      characterId,
      'talla-sedgewatch',
      'report-sedgewatch-waterline',
      readyToReport.revision,
      turnInCommandId,
    );
    const completedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    expect(completedState.wallet).toEqual({ currencyId: 'moss-mark', balance: 17 });
    expect(completedState.questRewardedIds).toContain('sedgewatch-waterline');
    expect(projectQuestJournal(completedState, demoWorld)).toMatchObject([{
      questId: 'sedgewatch-waterline',
      status: 'completed',
      objectives: [{ id: 'read-waterline', completed: true }],
    }]);
    await expect(client.chooseNpcDialogue(
      characterId,
      'talla-sedgewatch',
      'report-sedgewatch-waterline',
      completedState.revision,
      'cottage-quest-extra-turn-in',
    )).rejects.toThrow('That choice is not available here.');

    const afterTurnIn = await client.look(characterId, 'cottage-quest-after-turn-in');
    await client.move(
      characterId,
      'sedgewatch-cottage-to-sedgewatch',
      afterTurnIn.revision,
      'cottage-quest-leave-after-turn-in',
    );
    const readyForClearing = await client.look(characterId, 'cottage-quest-ready-for-clearing');
    await moveAlongDemoRoad(
      client,
      characterId,
      'sedgewatch-to-clearing',
      readyForClearing.revision,
      'cottage-quest-to-clearing',
    );
    const atClearing = await client.look(characterId, 'cottage-quest-look-clearing');
    await moveAlongDemoRoad(
      client,
      characterId,
      'clearing-to-fernshade',
      atClearing.revision,
      'cottage-quest-to-fernshade',
    );
    const atFork = await client.look(characterId, 'cottage-quest-look-fork');
    await client.move(
      characterId,
      'fernshade-fork-to-cottage',
      atFork.revision,
      'cottage-quest-enter-fernshade-home',
    );
    const atNim = await client.look(characterId, 'cottage-quest-look-nim');
    const nimDialogue = await client.talk(characterId, 'nim-fernshade', undefined, 'cottage-quest-talk-nim');
    expect(nimDialogue.choices).toContainEqual({
      id: 'nim-ask-baskets',
      label: 'Ask about the baskets',
    });
    await client.chooseNpcDialogue(
      characterId,
      'nim-fernshade',
      'nim-ask-baskets',
      atNim.revision,
      'cottage-quest-talk-baskets',
    );
    const anotherCharacter = await client.createCharacter('Ash', 'cottage-quest-create-second-character');
    const anotherCharacterState = replayCharacter(
      await store.readStream(DEMO_WORLD_INSTANCE_ID, anotherCharacter.streamId!),
    )!;
    expect(anotherCharacterState.wallet).toEqual({ currencyId: 'moss-mark', balance: 12 });
    expect(anotherCharacterState.questRewardedIds).toEqual([]);
    await engine.stop();
  });

  it('buys character-owned merchant stock from an authoritative catalog', async () => {
    const session = {
      sessionId: 'merchant-session',
      playerId: 'merchant-player',
      actorId: 'merchant-player',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      testPlugins,
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoTestWorld(),
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });

    async function reachStalls(characterId: string, prefix: string) {
      const clearing = await client.look(characterId, `${prefix}-clearing`);
      await moveAlongDemoRoad(client, characterId, 'clearing-to-bridge', clearing.revision, `${prefix}-move-bridge`);
      const bridge = await client.look(characterId, `${prefix}-bridge`);
      await moveAlongDemoRoad(client, characterId, 'bridge-to-reedbank', bridge.revision, `${prefix}-move-stalls`);
    }

    const first = await client.createCharacter('Briar', 'merchant-create-first');
    const firstId = first.streamId!;
    await reachStalls(firstId, 'merchant-first');
    const firstCatalog = await client.getMerchantCatalog(firstId, 'sella-reedbank-merchant', 'merchant-catalog-first');
    expect(firstCatalog).toMatchObject({
      merchantName: 'Sella',
      currency: { id: 'moss-mark', balance: 12 },
      listings: [
        { id: 'reedbank-brass-lantern', price: 8, purchased: false },
        { id: 'reedbank-waxed-cord', price: 5, purchased: false },
        { id: 'reedbank-practice-blade', price: 5, purchased: false },
        { id: 'reedbank-padded-vest', price: 5, purchased: false },
        { id: 'reedbank-healing-draught', price: 3, purchased: false },
      ],
    });
    const firstRoom = await client.look(firstId, 'merchant-first-room');
    await client.purchaseMerchantListing(
      firstId,
      'sella-reedbank-merchant',
      'reedbank-brass-lantern',
      firstRoom.revision,
      'merchant-buy-first-lantern',
    );
    const purchasedState = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstId))!;
    expect(purchasedState.wallet).toEqual({ currencyId: 'moss-mark', balance: 4 });
    expect(purchasedState.inventory).toContainEqual({
      id: 'item-reedbank-brass-lantern',
      label: 'Brass lantern',
      description: 'A compact brass lantern with a sliding shutter and a soot-dark wick.',
    });
    expect(purchasedState.purchasedMerchantListingIds).toContain('reedbank-brass-lantern');
    const refreshedCatalog = await client.getMerchantCatalog(firstId, 'sella-reedbank-merchant', 'merchant-catalog-refreshed');
    expect(refreshedCatalog.listings.find((listing) => listing.id === 'reedbank-brass-lantern')?.purchased).toBe(true);
    const afterBuy = await client.look(firstId, 'merchant-first-after-buy');
    await expect(client.purchaseMerchantListing(
      firstId,
      'sella-reedbank-merchant',
      'reedbank-brass-lantern',
      afterBuy.revision,
      'merchant-buy-first-again',
    )).rejects.toThrow('You have already bought that item from this merchant.');
    await expect(client.purchaseMerchantListing(
      firstId,
      'sella-reedbank-merchant',
      'reedbank-waxed-cord',
      afterBuy.revision,
      'merchant-buy-first-unaffordable',
    )).rejects.toThrow('You need 5 moss mark to buy that.');

    const second = await client.createCharacter('Rowan', 'merchant-create-second');
    const secondId = second.streamId!;
    await reachStalls(secondId, 'merchant-second');
    const secondCatalog = await client.getMerchantCatalog(secondId, 'sella-reedbank-merchant', 'merchant-catalog-second');
    expect(secondCatalog.currency.balance).toBe(12);
    expect(secondCatalog.listings[0]?.purchased).toBe(false);
    const secondRoom = await client.look(secondId, 'merchant-second-room');
    const secondPurchase = await client.purchaseMerchantListing(
      secondId,
      'sella-reedbank-merchant',
      'reedbank-brass-lantern',
      secondRoom.revision,
      'merchant-buy-second-lantern',
    );
    expect(secondPurchase.receipt.ok).toBe(true);
    await engine.stop();
  });

  it('grants a legacy character wallet through one explicit initialization event', async () => {
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [worldItemsPlugin, characterPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const legacyCharacterId = 'legacy-character';
    await store.append({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      streamId: legacyCharacterId,
      actorId: 'legacy-player',
      commandId: 'legacy-character-create',
      payloadHash: 'legacy-character-create-hash',
      expectedVersion: 0,
      events: [{
        type: 'character.created',
        version: 1,
        payload: {
          characterId: legacyCharacterId,
          playerId: 'legacy-player',
          name: 'Legacy',
          startingLocationId: 'mossgate-clearing',
        },
      }],
    });
    const session = {
      sessionId: 'legacy-session',
      playerId: 'legacy-player',
      actorId: 'legacy-player',
      selectedCharacterId: legacyCharacterId,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const initialize = (commandId: string, expectedVersion: number) =>
      InitializeCharacterWalletCommandSchema.parse({
        type: 'character.wallet.initialize',
        version: 1,
        commandId,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: legacyCharacterId,
        expectedVersion,
        payload: {},
      });
    const initialized = await engine.dispatch(initialize('legacy-wallet-init', 1), session);
    expect(initialized.receipt.ok).toBe(true);
    const duplicate = await engine.dispatch(initialize('legacy-wallet-init-again', 2), session);
    expect(duplicate.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    const events = await store.readStream(DEMO_WORLD_INSTANCE_ID, legacyCharacterId);
    expect(events.filter((event) => event.type === 'character.wallet_initialized')).toHaveLength(1);
    expect(replayCharacter(events)?.wallet).toEqual({ currencyId: 'moss-mark', balance: 12 });
    await engine.stop();
  });
});
