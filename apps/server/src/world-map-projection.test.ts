import { describe, expect, it } from 'vitest';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin } from '@mudd/engine-core';
import {
  characterPlugin,
  createClassRulesetPlugin,
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
  questBranchesPlugin,
  roadTravelPlugin,
  teamCombatPlugin,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { ORRAVETH_WORLD_INSTANCE_ID, orravethWorld } from '@mudd/world-orraveth';
import { MuddHttpClient } from '@mudd/client-sdk';
import { projectWorldMap } from './world-map-projection.js';
import {
  CharacterProjectionSchema,
  CharacterStatsQuerySchema,
  type WorldPackDraft,
} from '@mudd/contracts';

const session = {
  sessionId: 'world-map-session',
  playerId: 'world-map-player',
  actorId: 'world-map-player',
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
} as const;

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
      getPresenceAnchors: async () => new Map(),
    });
  },
};

async function moveAlongRoad(
  client: MuddHttpClient,
  characterId: string,
  exitIds: readonly [string, string],
  expectedVersion: number,
  commandId: string,
) {
  let result;
  for (const [index, exitId] of exitIds.entries()) {
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

describe('visited world map projection', () => {
  it('rejects a character location that is not in the world pack', () => {
    const character = CharacterProjectionSchema.parse({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'missing-map-location-character',
      name: 'Missing Room',
      locationId: 'not-in-this-world',
      visitedLocationIds: [],
      revision: 1,
    });

    expect(() => projectWorldMap(character)).toThrow(/location absent from the world/i);
  });

  it('deduplicates same-direction exit stubs and ignores self-connections', () => {
    const world = {
      ...demoWorld,
      locations: [
        {
          id: 'current-room',
          name: 'Current Room',
          mapPosition: { x: 0, y: 0 },
          exits: [
            { id: 'north-a', fromLocationId: 'current-room', toLocationId: 'unseen-a', direction: 'north' },
            { id: 'north-b', fromLocationId: 'current-room', toLocationId: 'unseen-b', direction: 'north' },
            { id: 'self-east', fromLocationId: 'current-room', toLocationId: 'current-room', direction: 'east' },
          ],
        },
        {
          id: 'unseen-a',
          name: 'Unseen A',
          mapPosition: { x: 0, y: 1 },
          exits: [],
        },
        {
          id: 'unseen-b',
          name: 'Unseen B',
          mapPosition: { x: 1, y: 0 },
          exits: [],
        },
      ],
    } as WorldPackDraft;
    const character = CharacterProjectionSchema.parse({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'deduplicated-exit-character',
      name: 'Exit Tester',
      locationId: 'current-room',
      visitedLocationIds: ['current-room'],
      revision: 1,
    });

    const map = projectWorldMap(character, world);

    expect(map.exitStubs).toEqual([{
      locationId: 'current-room',
      direction: 'north',
      oneWay: true,
    }]);
    expect(map.connections).toEqual([]);
  });

  it('shows a directional exit stub without exposing its undiscovered destination', () => {
    const source = demoWorld.locations.find(({ id }) => id === 'mossgate-clearing')!;
    const exit = source.exits.find(({ direction }) =>
      direction === 'north' || direction === 'east' || direction === 'south' || direction === 'west',
    );
    if (!exit) throw new Error('Expected Mossgate Clearing to have a cardinal exit.');
    const destination = demoWorld.locations.find(({ id }) => id === exit.toLocationId);
    if (!destination) throw new Error('Expected the authored exit destination to exist.');
    const customWorld = {
      ...demoWorld,
      locations: demoWorld.locations.map((location) =>
        location.id === destination.id
          ? {
            ...location,
            mapPosition: {
              ...(location.mapPosition ?? { x: 0, y: 0 }),
              visibleWhenUnvisited: false,
            },
          }
          : location,
      ),
    };
    const map = projectWorldMap(CharacterProjectionSchema.parse({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'map-exit-stub-character',
      name: 'Map Exit Stub',
      locationId: source.id,
      visitedLocationIds: [source.id],
      revision: 1,
    }), customWorld);

    expect(map.locations.some(({ id }) => id === destination.id)).toBe(false);
    expect(map.exitStubs).toContainEqual({
      locationId: source.id,
      direction: exit.direction,
      oneWay: !destination.exits.some((candidate) => candidate.toLocationId === source.id),
    });
  });

  it('projects developer-authored terrain colors', () => {
    const firstLocation = demoWorld.locations[0]!;
    const customWorld = {
      ...demoWorld,
      locations: demoWorld.locations.map((location) =>
        location.id === firstLocation.id
          ? {
            ...location,
            mapPosition: {
              ...(location.mapPosition ?? { x: 0, y: 0 }),
              terrain: 'wheat-field',
              mapColor: '#C89B45',
            },
          }
          : location,
      ),
    };
    const map = projectWorldMap(CharacterProjectionSchema.parse({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'map-color-character',
      name: 'Map Color',
      locationId: firstLocation.id,
      visitedLocationIds: [firstLocation.id],
      revision: 1,
    }), customWorld);

    expect(map.locations.find(({ id }) => id === firstLocation.id)).toMatchObject({
      terrain: 'wheat-field',
      mapColor: '#C89B45',
    });
  });

  it('places the Bellwold tower road north of the market on the map', () => {
    const map = projectWorldMap(CharacterProjectionSchema.parse({
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      characterId: 'orraveth-map-direction-character',
      name: 'Map Direction',
      locationId: 'bellwold-market-square',
      visitedLocationIds: [
        'bellwold-market-square',
        'old-bell-tower-approach',
        'old-bell-tower',
        'abandoned-watermill',
      ],
      revision: 1,
    }), orravethWorld);
    const yById = new Map(map.locations.map(({ id, y }) => [id, y]));

    expect(yById.get('old-bell-tower-approach')).toBeGreaterThan(yById.get('bellwold-market-square')!);
    expect(yById.get('old-bell-tower')).toBeGreaterThan(yById.get('old-bell-tower-approach')!);
    expect(yById.get('abandoned-watermill')).toBe(yById.get('old-bell-tower-approach'));
    expect(map.connections).toContainEqual({
      fromLocationId: 'bellwold-market-square',
      toLocationId: 'old-bell-tower-approach',
      direction: 'north',
      oneWay: false,
    });
  });

  it('shows the full Bellwold river and bridge on the map before they are visited', () => {
    const riverLocationIds = [
      'bellwold-river-far-west-reach',
      'bellwold-river-willow-reach',
      'bellwold-river-west-reach',
      'bellwold-river-east-reach',
      'bellwold-river-alder-reach',
      'bellwold-river-far-east-reach',
    ];
    const map = projectWorldMap(CharacterProjectionSchema.parse({
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      characterId: 'orraveth-south-river-map-character',
      name: 'South Road Traveler',
      locationId: 'bellwold-market-square',
      visitedLocationIds: ['bellwold-market-square'],
      revision: 1,
    }), orravethWorld);

    expect(map.locations.filter(({ id }) => riverLocationIds.includes(id))).toHaveLength(6);
    expect(map.locations.filter(({ terrain }) => terrain === 'river')).toHaveLength(6);
    expect(map.locations.find(({ id }) => id === 'bellwold-river-bridge'))
      .toMatchObject({ x: 0, y: -7, terrain: 'land' });
    expect(map.connections.some((connection) =>
      new Set([connection.fromLocationId, connection.toLocationId]).has('bellwold-river-bridge') &&
      new Set([connection.fromLocationId, connection.toLocationId]).has('bellwold-river-west-reach') &&
      connection.oneWay === false,
    )).toBe(true);
    expect(map.connections.some((connection) =>
      new Set([connection.fromLocationId, connection.toLocationId]).has('bellwold-river-bridge') &&
      new Set([connection.fromLocationId, connection.toLocationId]).has('bellwold-river-east-reach') &&
      connection.oneWay === false,
    )).toBe(true);
    expect(map.locations.some(({ id }) => riverLocationIds.includes(id) &&
      orravethWorld.locations.find(({ id: worldLocationId }) => worldLocationId === id)?.mapPosition?.visibleWhenUnvisited !== true,
    )).toBe(false);
  });

  it('keeps on and under states on one map node and the same Z level', () => {
    const character = {
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'bridge-map-state-character',
      name: 'Map State',
      locationId: 'glasswater-bridge',
      visitedLocationIds: ['glasswater-bridge'],
      revision: 1,
    };
    const onMap = projectWorldMap(CharacterProjectionSchema.parse({
      ...character,
      locationStateId: 'on',
    }));
    const underMap = projectWorldMap(CharacterProjectionSchema.parse({
      ...character,
      locationStateId: 'under',
    }));

    expect(underMap).toEqual(onMap);
    expect(onMap.currentLocationId).toBe('glasswater-bridge');
    expect(onMap.locations.filter((location) => location.id === 'glasswater-bridge')).toHaveLength(1);
    expect(onMap.locations.find((location) => location.id === 'glasswater-bridge'))
      .toMatchObject({ x: 0, y: 2 });
    expect(onMap.connections.some((connection) =>
      new Set([connection.fromLocationId, connection.toLocationId]).has('glasswater-west-reach') &&
      new Set([connection.fromLocationId, connection.toLocationId]).has('glasswater-bridge') &&
      connection.oneWay === false,
    )).toBe(true);
    expect(onMap.connections.some((connection) =>
      new Set([connection.fromLocationId, connection.toLocationId]).has('glasswater-bridge') &&
      new Set([connection.fromLocationId, connection.toLocationId]).has('glasswater-east-reach') &&
      connection.oneWay === false,
    )).toBe(true);
  });

  it('projects structured group names without revealing undiscovered group members', () => {
    const map = projectWorldMap(CharacterProjectionSchema.parse({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'group-map-character',
      name: 'Group Map',
      locationId: 'glasswater-bridge',
      visitedLocationIds: ['glasswater-bridge'],
      revision: 1,
    }));
    const bridge = map.locations.find((location) => location.id === 'glasswater-bridge');
    expect(bridge).toMatchObject({
      name: 'Glasswater Bridge',
      shortName: 'Glasswater Bridge',
      qualifiedName: 'Clearwater: Glasswater Bridge',
      locationGroupIds: ['clearwater', 'glasswater-river', 'kings-road'],
      primaryLocationGroupId: 'clearwater',
    });
    expect(map.locationGroups.find((group) => group.id === 'clearwater')?.locationIds)
      .toEqual(['glasswater-bridge']);
    expect(map.locationGroups.find((group) => group.id === 'clearwater')?.locationIds)
      .not.toContain('willowrest-inn');
    expect(map.locationGroups.find((group) => group.id === 'glasswater-river')?.locationIds)
      .toContain('glasswater-west-reach');
  });

  it('uses only the game’s four compass and two vertical travel directions', () => {
    const supportedDirections = new Set(['north', 'east', 'south', 'west', 'up', 'down']);
    const unsupportedExits = demoWorld.locations.flatMap((location) =>
      location.exits
        .filter((exit) => !supportedDirections.has(exit.direction ?? ''))
        .map((exit) => `${location.id}: ${exit.direction ?? '(missing)'}`),
    );
    expect(unsupportedExits).toEqual([]);
  });

  it('places villager cottages at the marked western map positions and reveals them when visited', () => {
    const homes = [
      {
        homeId: 'fernshade-cottage',
        adjacentId: 'fernshade-fork',
        x: -3,
        y: 1,
      },
      {
        homeId: 'sedgewatch-cottage',
        adjacentId: 'sedgewatch',
        x: -3,
        y: -1,
      },
    ] as const;

    for (const { homeId, adjacentId, x, y } of homes) {
      const home = demoWorld.locations.find((location) => location.id === homeId)!;
      const adjacent = demoWorld.locations.find((location) => location.id === adjacentId)!;
      expect(home.mapPosition).toMatchObject({ x, y, terrain: 'building' });
      expect(home.exits).toContainEqual(expect.objectContaining({
        toLocationId: adjacentId,
        direction: 'east',
      }));
      expect(adjacent.exits).toContainEqual(expect.objectContaining({
        toLocationId: homeId,
        direction: 'west',
      }));

      const character = {
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: `map-visitor-${homeId}`,
        name: 'Map Visitor',
        locationId: adjacentId,
        visitedLocationIds: [adjacentId],
        revision: 1,
      };
      const beforeVisit = projectWorldMap(CharacterProjectionSchema.parse(character));
      expect(beforeVisit.locations.some((location) => location.id === homeId)).toBe(false);

      const afterVisit = projectWorldMap(CharacterProjectionSchema.parse({
        ...character,
        locationId: homeId,
        visitedLocationIds: [...character.visitedLocationIds, homeId],
      }));
      expect(afterVisit.locations).toContainEqual(expect.objectContaining({
        id: homeId,
        name: home.name,
        x,
        y,
        terrain: 'building',
      }));
      expect(afterVisit.connections).toContainEqual(expect.objectContaining({
        fromLocationId: adjacentId,
        toLocationId: homeId,
        direction: 'west',
        oneWay: false,
      }));
    }
  });

  it('reveals Willowrest Inn and its connecting road segments only after the traveler arrives', async () => {
    const store = new InMemoryEventStore();
    const testWorld = structuredClone(demoWorld);
    for (const road of testWorld.roads ?? []) road.encounterChancePercent = 0;
    const engine = new EngineHost(
      [
        ...(testWorld.classCatalog ? [createClassRulesetPlugin(testWorld.classCatalog)] : []),
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
        merchantPlugin,
      ],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      testWorld,
    );
    const ready = engine.start();
    const activeCharacter: { id?: string } = {};
    const fetcher: typeof fetch = async (input, init = {}) => {
      await ready;
      const path = String(input);
      if (path === '/api/game') {
        if (!activeCharacter.id) throw new Error('Create a character before requesting the game snapshot.');
        const character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, activeCharacter.id));
        if (!character) throw new Error('The character stream is missing.');
        return Response.json({
          player: { id: session.playerId, displayName: 'Traveler' },
          character,
          map: projectWorldMap(character),
        });
      }

      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      return Response.json(path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session));
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Briar', 'map-journey-create');
    activeCharacter.id = created.streamId!;

    const initialSnapshot = await client.getGame();
    expect(initialSnapshot.map?.locations.map(({ id }) => id)).toContain('mossgate-clearing');
    expect(initialSnapshot.map?.locations.map(({ id }) => id)).not.toContain('willowrest-inn');

    let character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, activeCharacter.id))!;
    const addedRiverNodes = demoWorld.locations.filter((location) =>
      location.id.endsWith('-reach') && location.mapPosition?.terrain === 'river',
    );
    const addedRiverNodeIds = new Set(addedRiverNodes.map(({ id }) => id));
    expect(addedRiverNodes).toHaveLength(4);
    expect(initialSnapshot.map?.locations.map(({ id }) => id))
      .toEqual(expect.arrayContaining([...addedRiverNodeIds]));
    expect(initialSnapshot.map?.locations.filter(({ id }) => addedRiverNodeIds.has(id)))
      .toEqual(expect.arrayContaining(addedRiverNodes.map(({ id, name, mapPosition }) => expect.objectContaining({
        id,
        name,
        x: mapPosition!.x,
        y: mapPosition!.y,
        terrain: 'river',
      }))));
    expect(character.visitedLocationIds.some((id) => addedRiverNodeIds.has(id))).toBe(false);
    expect(initialSnapshot.map?.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromLocationId: 'glasswater-west-reach',
        toLocationId: 'glasswater-willow-reach',
        direction: 'west',
        oneWay: false,
      }),
      expect.objectContaining({
        fromLocationId: 'glasswater-willow-reach',
        toLocationId: 'glasswater-far-reach',
        direction: 'west',
        oneWay: false,
      }),
    ]));
    const bridgeMap = projectWorldMap({
      ...character,
      locationId: 'glasswater-bridge',
      visitedLocationIds: [...character.visitedLocationIds, 'glasswater-bridge'],
    });
    expect(bridgeMap.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromLocationId: 'glasswater-bridge',
        toLocationId: 'glasswater-west-reach',
        mapLineGapAtLocationId: 'glasswater-bridge',
      }),
      expect.objectContaining({
        fromLocationId: 'glasswater-bridge',
        toLocationId: 'glasswater-east-reach',
        mapLineGapAtLocationId: 'glasswater-bridge',
      }),
    ]));
    expect(addedRiverNodes.every(({ exits }) => exits.length > 0)).toBe(true);
    expect(demoWorld.locations
      .filter((location) => location.mapPosition?.terrain !== 'river')
      .some((location) => location.exits.some((exit) =>
        exit.fromStateId !== 'under' && addedRiverNodeIds.has(exit.toLocationId),
      )))
      .toBe(false);

    const towerMap = projectWorldMap({
      ...character,
      locationId: 'bell-tower',
      visitedLocationIds: [...character.visitedLocationIds, 'bell-tower'],
    });
    expect(towerMap.locations.find(({ id }) => id === 'bell-tower')).toMatchObject({
      terrain: 'building',
      verticalExits: ['up'],
    });
    const oneWayWorld = structuredClone(demoWorld);
    const reedbankRoad = oneWayWorld.locations.find(({ id }) => id === 'reedbank-road')!;
    const reverseExitIndex = reedbankRoad.exits.findIndex((exit) => exit.toLocationId === 'glasswater-bridge');
    reedbankRoad.exits.splice(reverseExitIndex, 1);
    const oneWayMap = projectWorldMap({
      ...character,
      locationId: 'glasswater-bridge',
      visitedLocationIds: ['glasswater-bridge', 'reedbank-road'],
    }, oneWayWorld);
    expect(oneWayMap.connections).toContainEqual(expect.objectContaining({
      fromLocationId: 'glasswater-bridge',
      toLocationId: 'reedbank-road',
      direction: 'north',
      oneWay: true,
    }));
    const toReedbank = [
      ['clearing-to-glasswater-road', 'glasswater-approach-to-bridge'],
      ['bridge-to-reedbank-road', 'reedbank-road-to-stalls'],
    ] as const;
    for (const [index, exitIds] of toReedbank.entries()) {
      await moveAlongRoad(client, activeCharacter.id, exitIds, character.revision, `map-journey-to-reedbank-${index}`);
      character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, activeCharacter.id))!;
    }

    const reedbankSnapshot = await client.getGame();
    expect(reedbankSnapshot.map?.currentLocationId).toBe('reedbank-stalls');
    expect(reedbankSnapshot.map?.locations.map(({ id }) => id)).toContain('reedbank-stalls');
    expect(reedbankSnapshot.map?.locations.map(({ id }) => id)).not.toContain('willowrest-inn');
    expect(reedbankSnapshot.map?.connections).not.toContainEqual({
      fromLocationId: 'reedbank-stalls',
      toLocationId: 'willowrest-lane',
    });

    await moveAlongRoad(
      client,
      activeCharacter.id,
      ['reedbank-to-willowrest-lane', 'willowrest-lane-to-inn'],
      character.revision,
      'map-journey-to-willowrest',
    );
    const innSnapshot = await client.getGame();
    expect(innSnapshot.map?.currentLocationId).toBe('willowrest-inn');
    expect(innSnapshot.map?.locations).toContainEqual(expect.objectContaining({
      id: 'willowrest-inn',
      name: 'Willowrest Inn',
      x: 2,
      y: 4,
      terrain: 'building',
    }));
    expect(innSnapshot.map?.connections).toContainEqual(expect.objectContaining({
      fromLocationId: 'reedbank-stalls',
      toLocationId: 'willowrest-lane',
      oneWay: false,
    }));
    expect(innSnapshot.map?.connections).toContainEqual(expect.objectContaining({
      fromLocationId: 'willowrest-inn',
      toLocationId: 'willowrest-lane',
      direction: 'west',
      oneWay: false,
    }));
    expect(innSnapshot.map?.connections).not.toContainEqual({
      fromLocationId: 'reedbank-stalls',
      toLocationId: 'willowrest-inn',
    });
  });
});

describe('Orraveth Bellwold road travel', () => {
  it('supports room-by-room travel on the east, west, and south roads without starting combat', async () => {
    const store = new InMemoryEventStore();
    const testWorld = structuredClone(orravethWorld);
    for (const road of testWorld.roads ?? []) road.encounterChancePercent = 0;
    let simulatedNow = new Date('2026-10-23T12:00:00.000Z');
    let presenceAnchorAt = simulatedNow;
    const session = {
      sessionId: 'orraveth-south-road-session',
      playerId: 'orraveth-south-road-player',
      actorId: 'orraveth-south-road-player',
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const engine = new EngineHost(
      [
        createClassRulesetPlugin(testWorld.classCatalog!),
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
        merchantPlugin,
        npcDialoguePlugin,
        questBranchesPlugin,
      ],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      testWorld,
      undefined,
      () => {
        const settledAt = simulatedNow;
        simulatedNow = new Date(simulatedNow.getTime() + 5_000);
        return settledAt;
      },
    );
    const ready = engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      await ready;
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const path = String(input);
      if (path.endsWith('/commands')) {
        const result = await engine.dispatch(body, session, undefined, presenceAnchorAt);
        presenceAnchorAt = new Date(simulatedNow);
        return Response.json(result);
      }
      return Response.json(await engine.query(body, session));
    };
    const client = new MuddHttpClient({ worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID, fetcher });

    try {
      const created = await client.createCharacter('Southbound Traveler', 'orraveth-south-road-create', 'orraveth.scout');
      const characterId = created.streamId!;
      const statsResult = await engine.query(CharacterStatsQuerySchema.parse({
        type: 'character.stats',
        version: 1,
        queryId: globalThis.crypto.randomUUID(),
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        characterId,
        payload: {},
      }), session);
      expect(statsResult.ok).toBe(true);
      if (!statsResult.ok) throw new Error(statsResult.message);
      expect(statsResult.value.damage).toBe(3);
      const loadCharacter = async () => {
        const character = replayCharacter(await store.readStream(ORRAVETH_WORLD_INSTANCE_ID, characterId));
        if (!character) throw new Error('The south road test character is missing.');
        return character;
      };
      const move = async (exitId: string, commandId: string) => {
        const character = await loadCharacter();
        const result = await client.move(characterId, exitId, character.revision, commandId);
        if (!result.receipt.ok) throw new Error(result.receipt.message);
        return loadCharacter();
      };
      const stepRoad = async (exitId: string, commandId: string) => {
        const character = await loadCharacter();
        const result = await client.roadStep(characterId, exitId, character.revision, commandId);
        if (!result.receipt.ok) throw new Error(result.receipt.message);
        return loadCharacter();
      };
      const travelRoad = async (roadId: string) => {
        const road = testWorld.roads.find(({ id }) => id === roadId);
        if (!road) throw new Error(`Missing road ${roadId}.`);
        let character = await loadCharacter();
        expect(character.locationId).toBe(road.locationIds[0]);
        for (const [index, nextLocationId] of road.locationIds.slice(1).entries()) {
          const currentLocation = testWorld.locations.find(({ id }) => id === character.locationId)!;
          const exit = currentLocation.exits.find(({ toLocationId, roadId: exitRoadId }) =>
            toLocationId === nextLocationId && exitRoadId === road.id,
          );
          if (!exit) throw new Error(`Missing ${road.id} exit from ${currentLocation.id} to ${nextLocationId}.`);
          const result = await client.roadStep(
            characterId,
            exit.id,
            character.revision,
            `orraveth-${road.id}-forward-${index + 1}`,
          );
          if (!result.receipt.ok) throw new Error(result.receipt.message);
          character = await loadCharacter();
          expect(character.locationId).toBe(nextLocationId);
          expect(character.combatEncounter).toBeUndefined();
        }
        return character;
      };
      const returnAlongRoad = async (roadId: string) => {
        const road = testWorld.roads.find(({ id }) => id === roadId);
        if (!road) throw new Error(`Missing road ${roadId}.`);
        let character = await loadCharacter();
        for (const previousLocationId of road.locationIds.slice(0, -1).reverse()) {
          const currentLocation = testWorld.locations.find(({ id }) => id === character.locationId)!;
          const exit = currentLocation.exits.find(({ toLocationId, roadId: exitRoadId }) =>
            toLocationId === previousLocationId && exitRoadId === road.id,
          );
          if (!exit) throw new Error(`Missing return ${road.id} exit from ${currentLocation.id} to ${previousLocationId}.`);
          const result = await client.roadStep(
            characterId,
            exit.id,
            character.revision,
            `orraveth-${road.id}-return-${previousLocationId}`,
          );
          if (!result.receipt.ok) throw new Error(result.receipt.message);
          character = await loadCharacter();
          expect(character.locationId).toBe(previousLocationId);
          expect(character.combatEncounter).toBeUndefined();
        }
        return character;
      };

      await move('square-to-shop', 'orraveth-quest-to-anwen');
      const initialAnwenDialogue = await client.talk(characterId, 'anwen-marr');
      expect(initialAnwenDialogue.choices.map(({ id }) => id)).toContain('ask-anwen-about-church-sword');
      const atShop = await loadCharacter();
      const questAccepted = await client.chooseNpcDialogue(
        characterId,
        'anwen-marr',
        'ask-anwen-about-church-sword',
        atShop.revision,
        'orraveth-accept-church-sword-quest',
      );
      expect(questAccepted.receipt.ok).toBe(true);
      await move('shop-to-square', 'orraveth-quest-return-to-square');

      await move('square-to-south-common', 'orraveth-road-to-south-common');
      await move('south-common-to-well-court', 'orraveth-road-to-well-court');
      await move('well-court-to-grain-house', 'orraveth-quest-to-old-grain-house');
      const atGrainHouse = await loadCharacter();
      const keyTaken = await client.take(
        characterId,
        'bellwold-church-annex-key',
        atGrainHouse.revision,
        'orraveth-take-church-key',
      );
      expect(keyTaken.receipt.ok).toBe(true);
      await move('grain-house-to-well-court', 'orraveth-quest-return-from-grain-house');
      await move('well-court-to-common-house', 'orraveth-road-to-common-house');
      await move('common-house-to-south-gate', 'orraveth-road-to-south-gate');
      let character = await travelRoad('bellwold-south-road');
      expect(character.locationId).toBe('bellwold-unfinished-road-end');
      character = await returnAlongRoad('bellwold-south-road');
      expect(character.locationId).toBe('bellwold-south-gate');

      await move('south-gate-to-common-house', 'orraveth-road-back-to-common-house');
      await move('common-house-to-well-court', 'orraveth-road-back-to-well-court');
      await move('well-court-to-south-common', 'orraveth-road-back-to-south-common');
      await move('south-common-to-square', 'orraveth-road-back-to-square');
      await move('square-to-tower-road', 'orraveth-road-to-tower-road');
      await move('tower-road-to-mill', 'orraveth-road-to-watermill');
      await stepRoad('mill-to-east-track', 'orraveth-road-to-east-track');
      await stepRoad('east-mill-track-to-bend', 'orraveth-road-to-east-bend');
      await stepRoad('east-road-bend-to-church-track', 'orraveth-road-to-church-track');
      await stepRoad('church-track-to-approach', 'orraveth-road-to-church-approach');
      await move('church-approach-to-church', 'orraveth-road-into-church');
      await move('church-to-belfry', 'orraveth-church-up-to-belfry');
      expect(projectWorldMap(await loadCharacter(), testWorld).locations.map(({ id }) => id))
        .toEqual(['bellwold-church-belfry']);
      await move('belfry-to-church', 'orraveth-church-down-to-nave');
      await move('church-to-annex', 'orraveth-church-down-to-annex');
      expect(projectWorldMap(await loadCharacter(), testWorld).locations.map(({ id }) => id))
        .toEqual(['bellwold-church-annex']);
      const atAnnex = await loadCharacter();
      await expect(client.move(
        characterId,
        'annex-to-crypt-entry',
        atAnnex.revision,
        'orraveth-test-locked-church-door',
      )).rejects.toThrow('That passage is still sealed.');
      const afterLockedDoorAttempt = await loadCharacter();
      const unlocked = await client.use(
        characterId,
        'bellwold-church-annex-key',
        'bellwold-church-iron-door',
        afterLockedDoorAttempt.revision,
        'orraveth-unlock-church-annex',
      );
      expect(unlocked.interactionId).toBe('unlock-bellwold-church-door');
      await move('annex-to-crypt-entry', 'orraveth-enter-church-undercrypt');
      expect(projectWorldMap(await loadCharacter(), testWorld).locations.map(({ id }) => id))
        .toEqual(['bellwold-church-crypt-entry']);
      await move('crypt-entry-to-passage', 'orraveth-crypt-north-1');
      await move('crypt-passage-to-fork', 'orraveth-crypt-north-2');
      await move('crypt-fork-to-central-hall', 'orraveth-crypt-north-3');
      await move('crypt-central-hall-to-north-passage', 'orraveth-crypt-north-4');
      await move('crypt-north-passage-to-upper-junction', 'orraveth-crypt-north-5');
      await move('crypt-upper-junction-to-north-approach', 'orraveth-crypt-north-6');
      await move('crypt-approach-to-reliquary', 'orraveth-crypt-north-7');
      const atReliquary = await loadCharacter();
      const swordTaken = await client.take(
        characterId,
        'bellwold-reliquary-sword',
        atReliquary.revision,
        'orraveth-take-reliquary-sword',
      );
      expect(swordTaken.receipt.ok).toBe(true);
      await move('reliquary-to-approach', 'orraveth-crypt-south-1');
      await move('crypt-approach-to-junction', 'orraveth-crypt-south-2');
      await move('crypt-upper-junction-to-north-passage', 'orraveth-crypt-south-3');
      await move('crypt-north-passage-to-central-hall', 'orraveth-crypt-south-4');
      await move('crypt-central-hall-to-fork', 'orraveth-crypt-south-5');
      await move('crypt-fork-to-passage', 'orraveth-crypt-south-6');
      await move('crypt-passage-to-entry', 'orraveth-crypt-south-7');
      await move('crypt-entry-to-annex', 'orraveth-leave-church-undercrypt');
      await move('annex-to-church', 'orraveth-church-up-to-nave');
      await move('church-to-approach', 'orraveth-road-back-to-church-approach');
      await stepRoad('church-approach-to-track', 'orraveth-road-back-to-church-track');
      await stepRoad('church-track-to-east-bend', 'orraveth-road-back-to-east-bend');
      character = await stepRoad('east-road-bend-to-verge', 'orraveth-road-to-east-verge');
      expect(character.locationId).toBe('bellwold-east-road-verge');
      character = await returnAlongRoad('bellwold-east-mill-road');
      expect(character.locationId).toBe('abandoned-watermill');

      await move('mill-to-tower-road', 'orraveth-road-back-to-tower-road');
      await move('tower-road-to-square', 'orraveth-road-back-to-square-from-tower-road');
      await move('square-to-shop', 'orraveth-return-reliquary-sword');
      const readyToTurnIn = await client.talk(characterId, 'anwen-marr');
      expect(readyToTurnIn.choices.map(({ id }) => id)).toContain('return-church-sword-to-anwen');
      const atTurnIn = await loadCharacter();
      const turnIn = await client.chooseNpcDialogue(
        characterId,
        'anwen-marr',
        'return-church-sword-to-anwen',
        atTurnIn.revision,
        'orraveth-turn-in-church-sword',
      );
      expect(turnIn.receipt.ok).toBe(true);
      const retriedTurnIn = await client.chooseNpcDialogue(
        characterId,
        'anwen-marr',
        'return-church-sword-to-anwen',
        atTurnIn.revision,
        'orraveth-turn-in-church-sword',
      );
      expect(retriedTurnIn.receipt).toEqual(turnIn.receipt);
      const rewardedCharacter = await loadCharacter();
      expect(rewardedCharacter.wallet).toMatchObject({ currencyId: 'gold', balance: 20 });
      expect(rewardedCharacter.inventory.filter(({ id }) => id === 'bellwold-reliquary-sword')).toHaveLength(1);
      expect(rewardedCharacter.inventory.find(({ id }) => id === 'bellwold-reliquary-sword')).toMatchObject({
        questBound: true,
        equipment: { slot: 'weapon', attackBonus: 2 },
      });
      expect(rewardedCharacter.questRewardedIds).toContain('bellwold-church-sword');
      const characterEvents = await store.readStream(ORRAVETH_WORLD_INSTANCE_ID, characterId);
      expect(characterEvents.filter(({ type }) => type === 'character.quest_rewarded')).toHaveLength(1);
      expect(characterEvents.find(
        (event) => event.type === 'character.quest_rewarded'
          && (event.payload as { questId?: string }).questId === 'bellwold-church-sword',
      )?.payload).toMatchObject({ itemIds: ['bellwold-reliquary-sword'], amount: 20 });
      await move('shop-to-square', 'orraveth-quest-return-to-square-after-turn-in');
      await move('square-to-inn', 'orraveth-road-to-inn');
      await move('inn-to-west-gate', 'orraveth-road-to-west-gate');
      character = await travelRoad('bellwold-west-road');
      expect(character.locationId).toBe('bellwold-west-road-end');
    } finally {
      await engine.stop();
    }
  });
});
