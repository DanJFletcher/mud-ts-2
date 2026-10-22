import { describe, expect, it } from 'vitest';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin } from '@mudd/engine-core';
import {
  characterPlugin,
  combatPlugin,
  combatRoomPresenceCapability,
  groupsPlugin,
  interactionPlugin,
  merchantPlugin,
  movementPlugin,
  partyCombatPolicyPlugin,
  partyPlugin,
  partyQuestPlugin,
  roadTravelPlugin,
  teamCombatPlugin,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { ORRAVETH_WORLD_INSTANCE_ID, orravethWorld } from '@mudd/world-orraveth';
import { MuddHttpClient } from '@mudd/client-sdk';
import { projectWorldMap } from './world-map-projection.js';
import { CharacterProjectionSchema } from '@mudd/contracts';

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
      expectedVersion + index,
      `${commandId}-step-${index + 1}`,
    );
    if (!result.receipt.ok) return result;
  }
  return result!;
}

describe('visited world map projection', () => {
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

describe('Orraveth south road travel', () => {
  it('allows room-by-room road travel from Bellwold to the temporary end without starting combat', async () => {
    const store = new InMemoryEventStore();
    const testWorld = structuredClone(orravethWorld);
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
    const fetcher: typeof fetch = async (input, init = {}) => {
      await ready;
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const path = String(input);
      return Response.json(path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session));
    };
    const client = new MuddHttpClient({ worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID, fetcher });

    try {
      const created = await client.createCharacter('Southbound Traveler', 'orraveth-south-road-create');
      const characterId = created.streamId!;
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

      await move('square-to-south-common', 'orraveth-road-to-south-common');
      await move('south-common-to-well-court', 'orraveth-road-to-well-court');
      await move('well-court-to-common-house', 'orraveth-road-to-common-house');
      let character = await loadCharacter();
      const road = testWorld.roads.find(({ id }) => id === 'bellwold-south-road')!;
      for (const [index, nextLocationId] of road.locationIds.slice(1).entries()) {
        const currentLocation = testWorld.locations.find(({ id }) => id === character.locationId)!;
        const exit = currentLocation.exits.find(({ toLocationId, roadId }) =>
          toLocationId === nextLocationId && roadId === road.id,
        );
        if (!exit) throw new Error(`Missing south road exit from ${currentLocation.id} to ${nextLocationId}.`);
        const result = await client.roadStep(
          characterId,
          exit.id,
          character.revision,
          `orraveth-south-road-step-${index + 1}`,
        );
        if (!result.receipt.ok) throw new Error(result.receipt.message);
        character = await loadCharacter();
        expect(character.locationId).toBe(nextLocationId);
        expect(character.combatEncounter).toBeUndefined();
      }
      expect(character.locationId).toBe('bellwold-unfinished-road-end');
    } finally {
      await engine.stop();
    }
  });
});
