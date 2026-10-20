import { describe, expect, it } from 'vitest';
import { CharacterProjectionSchema, type WorldPackDraft } from '@mudd/contracts';
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
import { MuddHttpClient } from '@mudd/client-sdk';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { projectWorldMap } from './world-map-projection.js';

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

const demoRoadRoutes: Record<string, readonly [string, string]> = {
  'clearing-to-bridge': ['clearing-to-glasswater-road', 'glasswater-approach-to-bridge'],
  'bridge-to-tower-west': ['bridge-to-tower-ridge', 'tower-ridge-to-west'],
};

const basementRooms: WorldPackDraft['locations'] = [
  {
    id: 'basement-corridor', name: 'Basement corridor', description: 'A corridor.',
    mapAreaId: 'bell-tower', mapPosition: { x: 2, y: 0, z: -1 },
    exits: [{ id: 'corridor-back', fromLocationId: 'basement-corridor', toLocationId: 'bell-underhollow' }],
  },
  {
    id: 'unvisited-chamber', name: 'Undiscovered chamber', description: 'A chamber.',
    mapAreaId: 'bell-tower', mapPosition: { x: 3, y: 0, z: -1 }, exits: [],
  },
  {
    id: 'deep-vault', name: 'Deep vault', description: 'A lower floor.',
    mapAreaId: 'bell-tower', mapPosition: { x: 1, y: 0, z: -2 }, exits: [],
  },
  {
    id: 'river-cave', name: 'River cave', description: 'A different dungeon at the same depth.',
    mapAreaId: 'river-dungeon', mapPosition: { x: 1, y: 0, z: -1 }, exits: [],
  },
];

const extendedWorld: WorldPackDraft = {
  ...demoWorld,
  locations: [
    ...demoWorld.locations.map((location) => location.id === 'bell-underhollow' ? {
      ...location,
      exits: [
        ...location.exits,
        { id: 'underhollow-to-corridor', fromLocationId: location.id, toLocationId: 'basement-corridor', direction: 'east', label: 'East' },
        { id: 'underhollow-to-deep', fromLocationId: location.id, toLocationId: 'deep-vault', direction: 'down', label: 'Down' },
        { id: 'underhollow-to-cave', fromLocationId: location.id, toLocationId: 'river-cave', label: 'A portal' },
      ],
    } : location),
    ...basementRooms,
  ],
};

function travelerAt(locationId: string, visitedLocationIds: string[]) {
  return CharacterProjectionSchema.parse({
    worldInstanceId: DEMO_WORLD_INSTANCE_ID, characterId: 'map-traveler',
    name: 'Briar', locationId, visitedLocationIds, revision: 1,
  });
}

describe('current-area and Z-level maps', () => {
  it('hides discovered underground rooms on the overworld without erasing discovery', () => {
    const character = travelerAt('bell-tower', [
      'mossgate-clearing', 'bell-tower-west', 'bell-tower', 'bell-tower-belfry', 'bell-underhollow',
    ]);
    const map = projectWorldMap(character);
    expect(map.locations.map(({ id }) => id)).toEqual([
      'mossgate-clearing',
      'bell-tower-west',
      'bell-tower',
    ]);
    expect(map.connections).not.toContainEqual(expect.objectContaining({ toLocationId: 'bell-underhollow' }));
    expect(character.visitedLocationIds).toContain('bell-underhollow');
  });

  it('shows only discovered rooms on the current dungeon floor and only same-map connections', () => {
    const character = travelerAt('bell-underhollow', [
      'bell-tower', 'bell-underhollow', 'basement-corridor', 'deep-vault', 'river-cave',
    ]);
    const map = projectWorldMap(character, extendedWorld);
    expect(map.locations.map(({ id }) => id)).toEqual(['bell-underhollow', 'basement-corridor']);
    expect(map.connections).toEqual([
      { fromLocationId: 'bell-underhollow', toLocationId: 'basement-corridor' },
    ]);
  });

  it('isolates other floors and separate dungeons even at identical X/Y/Z coordinates', () => {
    const visited = ['bell-tower', 'bell-underhollow', 'basement-corridor', 'deep-vault', 'river-cave'];
    expect(projectWorldMap(travelerAt('deep-vault', visited), extendedWorld).locations.map(({ id }) => id))
      .toEqual(['deep-vault']);
    expect(projectWorldMap(travelerAt('river-cave', visited), extendedWorld).locations.map(({ id }) => id))
      .toEqual(['river-cave']);
  });

  it('treats omitted area and Z as overworld level zero, but still separates Z within that area', () => {
    const world: WorldPackDraft = {
      ...demoWorld,
      locations: demoWorld.locations.map((location) => location.id === 'bell-underhollow'
        ? { ...location, mapAreaId: undefined }
        : location.id === 'bell-tower'
          ? { ...location, mapAreaId: 'overworld', mapPosition: { x: 1, y: 0, z: 0 } }
          : location),
    };
    const visited = ['mossgate-clearing', 'bell-tower', 'bell-underhollow'];
    expect(projectWorldMap(travelerAt('bell-tower', visited), world).locations.map(({ id }) => id))
      .toEqual(['mossgate-clearing', 'bell-tower']);
    expect(projectWorldMap(travelerAt('bell-underhollow', visited), world).locations.map(({ id }) => id))
      .toEqual(['bell-underhollow']);
  });

  it('switches maps after real down/up movement and remembers both maps when revisiting', async () => {
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
      ], store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true }, testWorld,
    );
    await engine.start();
    const session = {
      sessionId: 'level-session', playerId: 'level-player', actorId: 'level-player',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID, grantedPermissions: [], authenticated: true,
    } as const;
    const getCharacter = async () => replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const client = new MuddHttpClient({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      fetcher: async (input, init = {}) => {
        if (String(input) === '/api/game') {
          const character = await getCharacter();
          return Response.json({
            player: { id: session.playerId, displayName: 'Briar' },
            character, map: projectWorldMap(character),
          });
        }
        const body = JSON.parse(String(init.body ?? '{}')) as unknown;
        return Response.json(String(input).endsWith('/commands')
          ? await engine.dispatch(body, session) : await engine.query(body, session));
      },
    });
    const characterId = (await client.createCharacter('Briar', 'level-create')).streamId!;
    const move = async (exitId: string, commandId: string) => {
      const character = await getCharacter();
      const route = demoRoadRoutes[exitId];
      if (!route) return client.move(characterId, exitId, character.revision, commandId);
      let result;
      for (const [index, roadExitId] of route.entries()) {
        result = await client.roadStep(
          characterId,
          roadExitId,
          character.revision + index,
          `${commandId}-step-${index + 1}`,
        );
        if (!result.receipt.ok) return result;
      }
      return result!;
    };

    await client.take(characterId, 'mossgate-loose-stone', (await getCharacter()).revision, 'level-take-stone');
    await move('clearing-to-bridge', 'level-go-bridge');
    await client.take(characterId, 'glasswater-reed', (await getCharacter()).revision, 'level-take-reed');
    await move('bridge-to-tower-west', 'level-go-tower-west');
    await move('bell-tower-west-to-tower', 'level-go-tower');

    const surface = (await client.getGame()).map!;
    expect(surface.locations.map(({ id }) => id)).toEqual([
      'mossgate-clearing',
      'bell-tower-west',
      'glasswater-bridge',
      'bell-tower',
      'glasswater-approach',
      'tower-ridge',
    ]);
    expect(surface.locations.map(({ id }) => id)).not.toContain('bell-tower-belfry');

    await move('tower-to-belfry', 'level-go-up-to-belfry');
    const upperFloor = (await client.getGame()).map!;
    expect(upperFloor.currentLocationId).toBe('bell-tower-belfry');
    expect(upperFloor.locations.map(({ id }) => id)).toEqual(['bell-tower-belfry']);
    expect(upperFloor.connections).toEqual([]);
    await client.use(characterId, 'mossgate-loose-stone', 'tower-cracked-bell', (await getCharacter()).revision, 'level-bell-stone');
    await client.use(characterId, 'glasswater-reed', 'tower-cracked-bell', (await getCharacter()).revision, 'level-bell-reed');

    expect((await client.getGame()).map).toEqual(upperFloor);
    await move('tower-to-underhollow', 'level-go-down');
    const below = (await client.getGame()).map!;
    expect(below.currentLocationId).toBe('bell-underhollow');
    expect(below.locations.map(({ id }) => id)).toEqual(['bell-underhollow']);
    expect(below.connections).toEqual([]);
    await move('underhollow-to-belfry', 'level-go-up');
    expect((await client.getGame()).map).toEqual(upperFloor);
    await move('belfry-to-tower', 'level-return-to-tower-floor-again');
    expect((await client.getGame()).map).toEqual(surface);
    await move('tower-to-belfry', 'level-go-up-again');
    expect((await client.getGame()).map).toEqual(upperFloor);
    await move('tower-to-underhollow', 'level-go-down-again');
    expect((await client.getGame()).map).toEqual(below);
    expect((await getCharacter()).visitedLocationIds).toEqual(expect.arrayContaining([
      'mossgate-clearing', 'glasswater-bridge', 'bell-tower-west', 'bell-tower', 'bell-tower-belfry',
      'bell-underhollow',
    ]));
  });
});
