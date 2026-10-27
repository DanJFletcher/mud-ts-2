import { describe, expect, it } from 'vitest';
import {
  CharacterProjectionSchema,
  LocationProjectionSchema,
  NpcDialogueProjectionSchema,
  validateDraftWorldGraph,
} from '@mudd/contracts';
import { EngineHost, InMemoryEventStore, replayCharacter, SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import {
  autonomousNpcsPlugin,
  combatPlugin,
  autonomousNpcStreamId,
  characterPlugin,
  createClassRulesetPlugin,
  craftingPlugin,
  fishingPlugin,
  merchantPlugin,
  woodcuttingPlugin,
  WOODCUTTING_TREES_STREAM_ID,
  movementPlugin,
  interactionPlugin,
  npcDialoguePlugin,
  projectAutonomousNpcPosition,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import { ORRAVETH_WORLD_INSTANCE_ID, orravethWorld } from '@mudd/world-orraveth';
import { demoWorld } from '@mudd/world-demo';
import {
  createAutonomousNpcScheduler,
} from './autonomous-npc-scheduler.js';
import { worldEventEffectsPlugin } from './demo-event-effects-plugin.js';
import { projectWorldMap } from './world-map-projection.js';
import { MuddHttpClient } from '@mudd/client-sdk';
import { CharacterStatsQuerySchema } from '@mudd/contracts';

function makeHarness(options: Readonly<{
  now?: () => Date;
  rng?: Readonly<{ roll: (sides: number) => number }>;
  world?: typeof orravethWorld;
  includeCombat?: boolean;
}> = {}) {
  let id = 0;
  const owners = new Map<string, string>();
  const store = new InMemoryEventStore();
  const world = options.world ?? orravethWorld;
  const engine = new EngineHost(
    [
      createClassRulesetPlugin(world.classCatalog!),
      worldItemsPlugin,
      autonomousNpcsPlugin,
      characterPlugin,
      movementPlugin,
      merchantPlugin,
      npcDialoguePlugin,
      ...(options.includeCombat ? [interactionPlugin, combatPlugin] : []),
      fishingPlugin,
      woodcuttingPlugin,
      craftingPlugin,
      worldEventEffectsPlugin,
    ],
    store,
    {
      canAccessInstance: async (_session, worldInstanceId) => worldInstanceId === ORRAVETH_WORLD_INSTANCE_ID,
      ownsCharacter: async (session, characterId) => owners.get(characterId) === session.playerId,
    },
    world,
    () => `orraveth-test-id-${++id}`,
    options.now,
    options.rng,
  );
  const session = {
    sessionId: 'orraveth-test-session',
    playerId: 'orraveth-test-player',
    actorId: 'orraveth-test-player',
    worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
    grantedPermissions: [],
    authenticated: true,
  } as const;

  async function loadCharacter(characterId: string) {
    const events = await store.readStream(ORRAVETH_WORLD_INSTANCE_ID, characterId);
    const projection = replayCharacter(events);
    if (!projection) throw new Error('Character projection is missing.');
    return CharacterProjectionSchema.parse(projection);
  }

  async function dispatch(characterId: string | undefined, request: Record<string, unknown>) {
    const result = await engine.dispatch({
      ...request,
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      ...(characterId ? { characterId } : {}),
    } as never, session);
    if (!result.receipt.ok) throw new Error(result.receipt.message);
    return result;
  }

  return {
    engine,
    store,
    session,
    owners,
    loadCharacter,
    dispatch,
  };
}

describe('Orraveth Bellwold settlement', () => {
  it('uses the mill copper axe to chop trees and shares depletion and regrowth across characters', async () => {
    let clock = new Date('2026-10-24T12:00:00.000Z');
    const world = structuredClone(orravethWorld);
    const tree = world.woodcuttingTrees.find((candidate) => candidate.id === 'bellwold-southbound-pine')!;
    const millCopperAxe = world.locations
      .find(({ id }) => id === 'abandoned-watermill')
      ?.takeables?.find(({ id }) => id === 'mill-copper-axe');
    if (!millCopperAxe) throw new Error('The authored mill copper axe is missing.');
    const treeLocationIndex = world.locations.findIndex((location) => location.id === tree.locationId);
    const [treeLocation] = world.locations.splice(treeLocationIndex, 1);
    treeLocation!.takeables = [
      {
        id: 'test-bronze-axe-a', typeId: 'bronze-axe', label: 'Bronze Axe',
        description: 'A test axe.', woodcuttingAxe: { requiredLevel: 1, power: 1 },
      },
      {
        id: 'test-bronze-axe-b', typeId: 'bronze-axe', label: 'Bronze Axe',
        description: 'A second test axe.', woodcuttingAxe: { requiredLevel: 1, power: 1 },
      },
      {
        id: 'test-iron-axe', typeId: 'iron-axe', label: 'Iron Axe',
        description: 'A test iron axe.', woodcuttingAxe: { requiredLevel: 10, power: 2 },
      },
      millCopperAxe,
    ];
    world.locations.unshift(treeLocation!);
    world.respawn = { locationId: tree.locationId };
    const h = makeHarness({
      world,
      now: () => clock,
      rng: { roll: () => 1 },
    });
    await h.engine.start();
    const client = new MuddHttpClient({
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      fetcher: async (input, init = {}) => {
        const body = JSON.parse(String(init.body ?? '{}')) as unknown;
        const result = String(input).endsWith('/commands')
          ? await h.engine.dispatch(body, h.session)
          : await h.engine.query(body, h.session);
        return Response.json(result);
      },
    });
    try {
      const create = async (name: string, id: string) => {
        const result = await client.createCharacter(name, `woodcut-create-${id}`, 'orraveth.scout');
        const characterId = result.streamId!;
        h.owners.set(characterId, h.session.playerId);
        const character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'character.take', version: 1, commandId: `woodcut-take-${id}`,
          expectedVersion: character.revision, payload: { itemId: `test-bronze-axe-${id.toLocaleLowerCase()}` },
        });
        return characterId;
      };
      const first = await create('Pine Cutter A', 'a');
      const second = await create('Pine Cutter B', 'b');
      let firstCharacter = await h.loadCharacter(first);
      await h.dispatch(first, {
        type: 'character.take', version: 1, commandId: 'woodcut-take-mill-copper-axe',
        expectedVersion: firstCharacter.revision, payload: { itemId: 'mill-copper-axe' },
      });
      firstCharacter = await h.loadCharacter(first);
      await h.dispatch(first, {
        type: 'character.take', version: 1, commandId: 'woodcut-take-iron',
        expectedVersion: firstCharacter.revision, payload: { itemId: 'test-iron-axe' },
      });
      firstCharacter = await h.loadCharacter(first);
      const underLevelAttempt = await h.engine.dispatch({
        type: 'woodcutting.start', version: 1, commandId: 'woodcut-iron-under-level',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID, characterId: first,
        expectedVersion: firstCharacter.revision,
        payload: { axeItemId: 'test-iron-axe', treeId: tree.id },
      }, h.session);
      expect(underLevelAttempt.receipt.ok).toBe(false);
      const chop = async (characterId: string, commandId: string) => {
        let character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'woodcutting.start', version: 1, commandId: `${commandId}-start`,
          expectedVersion: character.revision,
          payload: {
            axeItemId: characterId === first
              ? 'mill-copper-axe'
              : `test-bronze-axe-${characterId === first ? 'a' : 'b'}`,
            treeId: tree.id,
          },
        });
        clock = new Date(clock.getTime() + 1_000);
        character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'woodcutting.advance', version: 1, commandId: `${commandId}-advance`,
          expectedVersion: character.revision,
          payload: { actionId: character.activeWoodcutting!.actionId },
        });
      };

      await chop(first, 'shared-log-1');
      await chop(second, 'shared-log-2');
      await chop(first, 'shared-log-3');
      await chop(second, 'shared-log-4');

      for (const [characterId, suffix] of [[first, 'a'], [second, 'b']] as const) {
        const character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'woodcutting.start', version: 1, commandId: `shared-last-start-${suffix}`,
          expectedVersion: character.revision,
          payload: { axeItemId: `test-bronze-axe-${suffix}`, treeId: tree.id },
        });
      }
      clock = new Date(clock.getTime() + 1_000);
      const lastAttemptCharacters = await Promise.all([h.loadCharacter(first), h.loadCharacter(second)]);
      await Promise.all(lastAttemptCharacters.map((character, index) =>
        h.engine.dispatch({
          type: 'woodcutting.advance', version: 1, commandId: `shared-last-advance-${index}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId: character.characterId,
          expectedVersion: character.revision,
          payload: { actionId: character.activeWoodcutting!.actionId },
        }, h.session),
      ));
      for (const characterId of [first, second]) {
        const character = await h.loadCharacter(characterId);
        if (character.activeWoodcutting) {
          await h.dispatch(characterId, {
            type: 'woodcutting.advance', version: 1, commandId: `shared-last-retry-${characterId}`,
            expectedVersion: character.revision,
            payload: { actionId: character.activeWoodcutting.actionId },
          });
        }
      }

      const firstProjection = await h.loadCharacter(first);
      const secondProjection = await h.loadCharacter(second);
      expect(firstProjection.inventory.filter((item) => item.typeId === 'pine-logs')).toHaveLength(1);
      const firstLogCount = firstProjection.inventory.find((item) => item.typeId === 'pine-logs')?.quantity ?? 0;
      const secondLogCount = secondProjection.inventory.find((item) => item.typeId === 'pine-logs')?.quantity ?? 0;
      expect(firstLogCount + secondLogCount).toBe(5);
      expect(firstProjection.woodcutting?.experience).toBe(firstLogCount * 25);
      expect(secondProjection.woodcutting?.experience).toBe(secondLogCount * 25);
      expect(firstProjection.advancement?.experience ?? 0).toBe(0);
      expect(secondProjection.advancement?.experience ?? 0).toBe(0);

      const treeEvents = await h.store.readStream(ORRAVETH_WORLD_INSTANCE_ID, WOODCUTTING_TREES_STREAM_ID);
      expect(treeEvents).toHaveLength(5);
      expect(treeEvents.at(-1)?.payload).toMatchObject({ treeId: tree.id, remainingLogs: 0 });

      const blockedCharacter = await h.loadCharacter(second);
      const blocked = await h.engine.dispatch({
        type: 'woodcutting.start', version: 1, commandId: 'shared-tree-cooldown',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID, characterId: second,
        expectedVersion: blockedCharacter.revision,
        payload: { axeItemId: 'test-bronze-axe-b', treeId: tree.id },
      }, h.session);
      expect(blocked.receipt.ok).toBe(false);
      clock = new Date(clock.getTime() + 59_000);
      const stillBlocked = await h.engine.dispatch({
        type: 'woodcutting.start', version: 1, commandId: 'shared-tree-still-cooldown',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID, characterId: second,
        expectedVersion: (await h.loadCharacter(second)).revision,
        payload: { axeItemId: 'test-bronze-axe-b', treeId: tree.id },
      }, h.session);
      expect(stillBlocked.receipt.ok).toBe(false);
      clock = new Date(clock.getTime() + 1_000);
      const regrown = await h.engine.dispatch({
        type: 'woodcutting.start', version: 1, commandId: 'shared-tree-regrown',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID, characterId: second,
        expectedVersion: (await h.loadCharacter(second)).revision,
        payload: { axeItemId: 'test-bronze-axe-b', treeId: tree.id },
      }, h.session);
      expect(regrown.receipt.ok).toBe(true);
    } finally {
      await h.engine.stop();
    }
  });

  it('allows resting in an ordinary square, on a road, and in the undercrypt', async () => {
    const startAt = async (locationId: string, expectedArea?: string) => {
      const world = structuredClone(orravethWorld);
      const index = world.locations.findIndex((location) => location.id === locationId);
      if (index < 0) throw new Error(`Missing rest test location ${locationId}.`);
      const [startingLocation] = world.locations.splice(index, 1);
      world.locations.unshift(startingLocation!);
      if (expectedArea) expect(startingLocation?.mapAreaId).toBe(expectedArea);
      const h = makeHarness({ world });
      await h.engine.start();
      const client = new MuddHttpClient({
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        fetcher: async (input, init = {}) => {
          const body = JSON.parse(String(init.body ?? '{}')) as unknown;
          const path = String(input);
          const result = path.endsWith('/commands')
            ? await h.engine.dispatch(body, h.session)
            : await h.engine.query(body, h.session);
          return Response.json(result);
        },
      });
      try {
        const created = await client.createCharacter(
          `Rest Test ${locationId}`,
          `rest-anywhere-${locationId}`,
          'orraveth.scout',
        );
        const characterId = created.streamId!;
        h.owners.set(characterId, h.session.playerId);
        const room = await client.look(characterId, `look-rest-${locationId}`);
        expect(room.safeResting).toBe(false);
        await client.rest(characterId, created.receipt.newAggregateVersion!, `rest-${locationId}`);
        expect((await h.loadCharacter(characterId)).staminaRecovery.posture).toBe('resting');
      } finally {
        await h.engine.stop();
      }
    };

    await startAt('bellwold-market-square');
    await startAt('bellwold-southbound-track');
    await startAt('bellwold-church-crypt-entry', 'bellwold-church-undercrypt');
  });

  it('supports free safe resting and stamina-funded travel through the host and client SDK without an inn price', async () => {
    let now = new Date('2026-10-23T12:00:00.000Z');
    const h = makeHarness({ now: () => now });
    await h.engine.start();
    const client = new MuddHttpClient({
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      fetcher: async (input, init = {}) => {
        const body = JSON.parse(String(init.body ?? '{}')) as unknown;
        const path = String(input);
        const result = path.endsWith('/commands')
          ? await h.engine.dispatch(body, h.session)
          : await h.engine.query(body, h.session);
        return Response.json(result);
      },
    });
    try {
      const created = await client.createCharacter(
        'Safe Rest Traveler',
        'orraveth-stamina-journey-create',
        'orraveth.scout',
      );
      const characterId = created.streamId!;
      h.owners.set(characterId, h.session.playerId);
      let character = await h.loadCharacter(characterId);
      await client.move(characterId, 'square-to-inn', character.revision, 'orraveth-stamina-to-inn');
      character = await h.loadCharacter(characterId);
      expect(character.resources.stamina.current).toBe(95);
      const room = await client.look(characterId, 'orraveth-stamina-look-safe-place');
      expect(room.safeResting).toBe(true);
      expect(room.inn).toBeUndefined();

      await client.rest(characterId, character.revision, 'orraveth-stamina-rest');
      character = await h.loadCharacter(characterId);
      now = new Date(now.getTime() + 10_000);
      const recovery = await h.engine.dispatchSystem({
        type: 'character.stamina.recover',
        version: 1,
        commandId: 'orraveth-stamina-recover',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        characterId,
        expectedVersion: character.revision,
        payload: { settleAt: now.toISOString(), resetAnchor: false },
      }, SYSTEM_ACTOR_ID);
      expect(recovery.receipt.ok).toBe(true);
      character = await h.loadCharacter(characterId);
      expect(character.resources.stamina.current).toBe(100);
      expect(character.staminaRecovery.posture).toBe('resting');

      await client.stand(characterId, character.revision, 'orraveth-stamina-stand');
      character = await h.loadCharacter(characterId);
      await client.move(characterId, 'inn-to-square', character.revision, 'orraveth-stamina-back-to-square');
      character = await h.loadCharacter(characterId);
      expect(character.locationId).toBe('bellwold-market-square');
      expect(character.resources.stamina.current).toBe(95);
      expect(character.staminaRecovery.posture).toBe('standing');
    } finally {
      await h.engine.stop();
    }
  });

  it('has a valid, fully reachable seventy-two-location region with map directions matching its exits', () => {
    expect(validateDraftWorldGraph(orravethWorld)).toEqual([]);
    expect(orravethWorld.locations).toHaveLength(72);

    const worldWithMissingQuestRewardItem = structuredClone(orravethWorld);
    const churchQuest = worldWithMissingQuestRewardItem.quests?.find(
      (quest) => quest.id === 'bellwold-church-sword',
    );
    if (!churchQuest?.reward) throw new Error('The church quest reward is missing.');
    churchQuest.reward.itemIds = ['missing-reliquary-sword'];
    expect(validateDraftWorldGraph(worldWithMissingQuestRewardItem)).toContain(
      'Quest bellwold-church-sword reward references missing item missing-reliquary-sword',
    );

    const locationIds = new Set(orravethWorld.locations.map(({ id }) => id));
    const reached = new Set<string>(['bellwold-market-square']);
    const queue = ['bellwold-market-square'];
    const offsets: Record<string, { x: number; y: number }> = {
      north: { x: 0, y: 1 },
      east: { x: 1, y: 0 },
      south: { x: 0, y: -1 },
      west: { x: -1, y: 0 },
    };
    const opposites: Record<string, string> = {
      north: 'south',
      east: 'west',
      south: 'north',
      west: 'east',
      up: 'down',
      down: 'up',
    };
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = orravethWorld.locations.find(({ id }) => id === currentId)!;
      for (const exit of current.exits) {
        expect(['north', 'east', 'south', 'west', 'up', 'down']).toContain(exit.direction);
        expect(locationIds.has(exit.toLocationId)).toBe(true);
        const offset = exit.direction ? offsets[exit.direction] : undefined;
        const destination = orravethWorld.locations.find(({ id }) => id === exit.toLocationId)!;
        const reverseExit = destination.exits.find(({ toLocationId }) => toLocationId === currentId);
        expect(reverseExit?.direction).toBe(exit.direction ? opposites[exit.direction] : undefined);
        if (offset && current.mapPosition && destination.mapPosition) {
          expect(destination.mapPosition).toMatchObject({
            x: current.mapPosition.x + offset.x,
            y: current.mapPosition.y + offset.y,
          });
        }
        if ((exit.direction === 'up' || exit.direction === 'down') && current.mapPosition && destination.mapPosition) {
          const verticalOffset = exit.direction === 'up' ? 1 : -1;
          expect(destination.mapPosition.z ?? 0).toBe((current.mapPosition.z ?? 0) + verticalOffset);
        }
        if (!reached.has(exit.toLocationId)) {
          reached.add(exit.toLocationId);
          queue.push(exit.toLocationId);
        }
      }
    }
    expect(reached).toEqual(locationIds);
  });

  it('connects Bellwold’s alleys, homes, jail, library, upstairs room, and rear museum', () => {
    const locationsById = new Map(orravethWorld.locations.map((location) => [location.id, location]));
    const exitTo = (fromId: string, toId: string) =>
      locationsById.get(fromId)?.exits.find((exit) => exit.toLocationId === toId);

    expect(exitTo('bellwold-hearth-alley', 'bellwold-lantern-court')).toMatchObject({ direction: 'west' });
    expect(exitTo('bellwold-lantern-court', 'bellwold-nettlemere-house')).toMatchObject({ direction: 'west' });
    expect(exitTo('bellwold-lantern-court', 'bellwold-upper-row-house')).toMatchObject({ direction: 'north' });
    expect(exitTo('bellwold-lower-row', 'bellwold-south-lane-cottage')).toMatchObject({ direction: 'south' });
    expect(exitTo('bellwold-south-gate', 'bellwold-jail')).toMatchObject({ direction: 'west' });
    expect(exitTo('bellwold-jail', 'bellwold-jail-cell')).toMatchObject({ direction: 'down' });
    expect(exitTo('bellwold-common-house', 'bellwold-library')).toMatchObject({ direction: 'east' });
    expect(exitTo('bellwold-library', 'bellwold-library-upper-room')).toMatchObject({ direction: 'up' });
    expect(exitTo('bellwold-library', 'bellwold-local-museum')).toMatchObject({ direction: 'east' });

    for (const locationId of [
      'bellwold-nettlemere-house',
      'bellwold-upper-row-house',
      'bellwold-lower-row-house',
      'bellwold-south-lane-cottage',
    ]) {
      expect(locationsById.get(locationId)?.npcs?.length).toBeGreaterThan(0);
    }
  });

  it('defines the south road as a room-by-room route that ends before any new settlement', () => {
    const road = orravethWorld.roads.find(({ id }) => id === 'bellwold-south-road');
    expect(road).toMatchObject({
      name: 'Bellwold South Road',
      locationIds: [
        'bellwold-south-gate',
        'bellwold-southbound-track',
        'bellwold-reedbed-approach',
        'bellwold-river-bridge',
        'bellwold-far-bank-track',
        'bellwold-south-mile-marker',
        'bellwold-unfinished-road-end',
      ],
      encounterChancePercent: 10,
    });

    const routeLocations = road!.locationIds.map((id) =>
      orravethWorld.locations.find(({ id: locationId }) => locationId === id)!,
    );
    for (const [index, current] of routeLocations.slice(0, -1).entries()) {
      const next = routeLocations[index + 1]!;
      expect(current.exits).toContainEqual(expect.objectContaining({
        toLocationId: next.id,
        roadId: road!.id,
      }));
      expect(next.exits).toContainEqual(expect.objectContaining({
        toLocationId: current.id,
        roadId: road!.id,
      }));
    }
    expect(routeLocations.at(-1)?.exits).toEqual([
      expect.objectContaining({
        toLocationId: 'bellwold-south-mile-marker',
        direction: 'north',
      }),
    ]);

    const riverLocations = orravethWorld.locations.filter(
      ({ mapPosition }) => mapPosition?.terrain === 'river',
    );
    expect(riverLocations).toHaveLength(6);
    expect(riverLocations.every(({ mapPosition }) => mapPosition?.visibleWhenUnvisited === true)).toBe(true);
    expect(orravethWorld.locations.find(({ id }) => id === 'bellwold-river-bridge'))
      .toMatchObject({ defaultStateId: 'on', mapPosition: { x: 0, y: -7, visibleWhenUnvisited: true } });
    expect(orravethWorld.locations.find(({ id }) => id === 'bellwold-river-bridge')?.states)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'on' }),
        expect.objectContaining({ id: 'under' }),
      ]));
  });

  it('adds a west road and an east road that passes through the abandoned mill', () => {
    const expectedRoads = [
      {
        id: 'bellwold-mile-west-road',
        name: 'Bellwold Mile Marker West Road',
        locationIds: [
          'bellwold-south-mile-marker',
          'bellwold-mile-west-track',
          'bellwold-hazel-cut',
          'bellwold-milepost-workshop',
        ],
      },
      {
        id: 'bellwold-east-mill-road',
        name: 'Bellwold East Mill Road',
        locationIds: [
          'abandoned-watermill',
          'bellwold-east-mill-track',
          'bellwold-east-road-bend',
          'bellwold-east-road-verge',
        ],
      },
      {
        id: 'bellwold-west-road',
        name: 'Bellwold West Road',
        locationIds: [
          'bellwold-west-gate',
          'bellwold-westbound-track',
          'bellwold-west-road-end',
        ],
      },
      {
        id: 'bellwold-north-church-road',
        name: 'Bellwold North Church Road',
        locationIds: [
          'bellwold-east-road-bend',
          'bellwold-north-church-track',
          'bellwold-church-approach',
        ],
      },
    ];

    for (const expected of expectedRoads) {
      const road = orravethWorld.roads.find(({ id }) => id === expected.id);
      expect(road).toMatchObject({
        name: expected.name,
        locationIds: expected.locationIds,
        encounterChancePercent: 10,
      });
      expect(road?.encounters).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        }),
        expect.objectContaining({
          name: 'Bandit',
          combatProfile: { maxHealth: 6, attackDamage: 1, style: 'steady' },
        }),
      ]));
      const routeLocations = expected.locationIds.map((id) =>
        orravethWorld.locations.find(({ id: locationId }) => locationId === id)!,
      );
      for (const [index, current] of routeLocations.slice(0, -1).entries()) {
        const next = routeLocations[index + 1]!;
        expect(current.exits).toContainEqual(expect.objectContaining({
          toLocationId: next.id,
          roadId: expected.id,
        }));
        expect(next.exits).toContainEqual(expect.objectContaining({
          toLocationId: current.id,
          roadId: expected.id,
        }));
      }
    }
  });

  it('authors bandits on every Bellwold road with chance-based gold and a rare equipable knife', () => {
    expect(orravethWorld.roads).toHaveLength(5);
    for (const road of orravethWorld.roads) {
      const bandit = road.encounters.find(({ name }) => name === 'Bandit');
      expect(bandit).toMatchObject({
        combatProfile: { maxHealth: 6, attackDamage: 1, style: 'steady' },
        loot: {
          currencyAmount: 3,
          currencyChancePercent: 50,
          chanceItems: [{
            chancePercent: 5,
            item: {
              typeId: 'bandit-knife',
              label: 'Bandit knife',
              equipment: { slot: 'weapon', attackBonus: 1 },
            },
          }],
        },
      });
    }
  });

  it('ends the Old South Mile Marker west road at a workshop with a resident craftsperson', () => {
    const marker = orravethWorld.locations.find(({ id }) => id === 'bellwold-south-mile-marker');
    const workshop = orravethWorld.locations.find(({ id }) => id === 'bellwold-milepost-workshop');
    const resident = workshop?.npcs?.find(({ id }) => id === 'nessa-rill');

    expect(marker?.exits).toContainEqual(expect.objectContaining({
      toLocationId: 'bellwold-mile-west-track',
      direction: 'west',
      roadId: 'bellwold-mile-west-road',
    }));
    expect(workshop).toMatchObject({
      name: 'Milepost Workshop',
      mapPosition: { x: -3, y: -9, terrain: 'building' },
      exits: [expect.objectContaining({
        toLocationId: 'bellwold-hazel-cut',
        direction: 'east',
      })],
    });
    expect(workshop?.description).toMatch(/shavings|file|stove/i);
    expect(resident).toMatchObject({
      name: 'Nessa Rill',
      activityDescription: expect.stringContaining('cartwheel'),
    });
    expect(resident?.dialogue?.choices.map(({ label }) => label)).toEqual(expect.arrayContaining([
      'Who are you?',
      'What are you doing?',
      'What is Bellwold like?',
      'What do you repair?',
      'Why set up here?',
    ]));
    expect(resident?.dialogue?.choices.find(({ label }) => label === 'Who are you?')?.response)
      .toContain('live in the loft');
  });

  it('keeps the church belfry and annex on separate Z-level maps', () => {
    const visitedLocationIds = [
      'bellwold-east-road-bend',
      'bellwold-north-church-track',
      'bellwold-church-approach',
      'bellwold-abandoned-church',
      'bellwold-church-belfry',
      'bellwold-church-annex',
    ];
    const mapAt = (locationId: string) => projectWorldMap(
      CharacterProjectionSchema.parse({
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        characterId: 'church-map-traveler',
        name: 'Map Traveler',
        locationId,
        visitedLocationIds,
        revision: 1,
      }),
      orravethWorld,
    );

    const naveMap = mapAt('bellwold-abandoned-church');
    expect(naveMap.locations.map(({ id }) => id)).toContain('bellwold-abandoned-church');
    expect(naveMap.locations.map(({ id }) => id)).toContain('bellwold-east-road-bend');
    expect(naveMap.locations.map(({ id }) => id)).not.toContain('bellwold-church-belfry');
    expect(naveMap.locations.map(({ id }) => id)).not.toContain('bellwold-church-annex');
    expect(naveMap.connections).toContainEqual(expect.objectContaining({
      fromLocationId: 'bellwold-church-approach',
      toLocationId: 'bellwold-abandoned-church',
      direction: 'north',
      oneWay: false,
    }));

    expect(mapAt('bellwold-church-belfry').locations.map(({ id }) => id))
      .toEqual(['bellwold-church-belfry']);
    expect(mapAt('bellwold-church-annex').locations.map(({ id }) => id))
      .toEqual(['bellwold-church-annex']);
  });

  it('moves the villager through town and advances the guard along its patrol', async () => {
    let now = new Date('2026-10-22T12:00:00.000Z');
    const h = makeHarness({ now: () => now, rng: { roll: (sides) => sides } });
    await h.engine.start();
    try {
      const created = await h.dispatch(undefined, {
        type: 'character.create',
        version: 1,
        commandId: 'orraveth-create-mobile-npc-test-character',
        payload: { name: 'Lena', classId: 'orraveth.scout' },
      });
      const createdEvent = created.events.find((event) => event.type === 'character.created');
      const characterId = (createdEvent?.payload as { characterId?: string } | undefined)?.characterId;
      if (!characterId) throw new Error('Character creation returned no character ID.');
      h.owners.set(characterId, h.session.playerId);

      const scheduler = createAutonomousNpcScheduler({
        engine: h.engine,
        store: h.store,
        world: orravethWorld,
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        now: () => now,
      });
      expect(await scheduler.tick()).toBe(3);

      const atSquare = await h.loadCharacter(characterId);
      await h.dispatch(characterId, {
        type: 'character.move',
        version: 1,
        commandId: 'orraveth-mobile-test-to-south-common',
        expectedVersion: atSquare.revision,
        payload: { exitId: 'square-to-south-common' },
      });
      const atCommon = await h.loadCharacter(characterId);
      const room = await h.engine.query({
        type: 'location.describe',
        version: 1,
        queryId: 'orraveth-mobile-test-room-description',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        characterId,
        payload: {},
      }, h.session, { characterProjection: atCommon });
      if (!room.ok) throw new Error(room.message);
      const projection = LocationProjectionSchema.parse(room.value);
      expect(projection.exits).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'south-common-to-square',
          available: true,
          destinationPreview: expect.objectContaining({
            locationId: 'bellwold-market-square',
            description: expect.stringContaining('Stalls and handcarts'),
          }),
        }),
        expect.objectContaining({
          id: 'south-common-to-blackwater-forge',
          destinationPreview: expect.objectContaining({
            locationId: 'blackwater-forge',
            roomDetails: expect.stringContaining('Darric Holt is here, repairing a farm fitting at the forge.'),
            npcs: expect.arrayContaining([
              expect.objectContaining({ id: 'darric-holt', name: 'Darric Holt', mobile: false }),
            ]),
          }),
        }),
      ]));
      expect(projection.npcs.map(({ id }) => id)).toEqual(
        expect.arrayContaining(['linnet-reed', 'taren-voss']),
      );
      const villagerDialogue = await h.engine.query({
        type: 'npc.talk',
        version: 1,
        queryId: 'orraveth-linnet-talk',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        characterId,
        payload: { npcId: 'linnet-reed', topic: 'market' },
      }, h.session, { characterProjection: atCommon });
      expect(villagerDialogue.ok).toBe(true);
      if (!villagerDialogue.ok) throw new Error(villagerDialogue.message);
      expect(NpcDialogueProjectionSchema.parse(villagerDialogue.value).npcName).toBe('Linnet Reed');

      now = new Date(now.getTime() + 60_000);
      expect(await scheduler.tick()).toBe(3);
      const guardEvents = await h.store.readStream(
        ORRAVETH_WORLD_INSTANCE_ID,
        autonomousNpcStreamId('taren-voss'),
      );
      expect(projectAutonomousNpcPosition(guardEvents, 'taren-voss', 'bellwold-market-square'))
        .toMatchObject({ locationId: 'bellwold-well-court', routeIndex: 2 });
    } finally {
      await h.engine.stop();
    }
  });

  it('supports a complete server-authoritative exploration, dialogue, quest, and replay flow', async () => {
    const h = makeHarness();
    await h.engine.start();
    try {
      const created = await h.dispatch(undefined, {
        type: 'character.create',
        version: 1,
        commandId: 'orraveth-create-character',
        payload: { name: 'Mira', classId: 'orraveth.scout' },
      });
      const createdEvent = created.events.find((event) => event.type === 'character.created');
      const characterId = (createdEvent?.payload as { characterId?: string } | undefined)?.characterId;
      if (!characterId) throw new Error('Character creation returned no character ID.');
      h.owners.set(characterId, h.session.playerId);

      const queryLocation = async () => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'location.describe',
          version: 1,
          queryId: `location-${character.revision}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: {},
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return LocationProjectionSchema.parse(result.value);
      };
      const talkToNpc = async (npcId: string, topic?: string) => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'npc.talk',
          version: 1,
          queryId: `talk-${npcId}-${character.revision}-${topic ?? 'default'}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: { npcId, ...(topic ? { topic } : {}) },
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return NpcDialogueProjectionSchema.parse(result.value);
      };
      const talkToAnwen = (topic?: string) => talkToNpc('anwen-marr', topic);
      const readObject = async (objectId: string) => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'object.read',
          version: 1,
          queryId: `read-${objectId}-${character.revision}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: { objectId },
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return result.value;
      };
      const move = async (exitId: string) => {
        const character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'character.move',
          version: 1,
          commandId: `move-${character.revision}-${exitId}`,
          expectedVersion: character.revision,
          payload: { exitId },
        });
        await h.engine.processPendingEffects();
      };

      const market = await queryLocation();
      expect(market.shortName).toBe('Bellwold Market Square');
      expect(market.description).toContain('Stalls and handcarts crowd the open ground.');
      expect(market.description).not.toMatch(/busy mornings|frontier settlement|serve travelers/i);
      expect((await talkToNpc('linnet-reed', 'market')).text).toContain('busiest early');
      expect(orravethWorld.locations.find(({ id }) => id === 'bellwold-south-mile-marker')?.readables)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: 'old-south-mile-marker-inscription',
            text: expect.stringContaining('distance from Bellwold'),
          }),
        ]));

      await move('square-to-south-common');
      await move('south-common-to-well-court');
      await move('well-court-to-grain-house');
      expect((await queryLocation()).description).toContain('Chalk marks cross the faces of several storage bins.');
      expect((await talkToNpc('aven-rusk', 'stores')).text).toContain('sort the bins by season');
      await move('grain-house-to-well-court');
      await move('well-court-to-south-common');
      await move('south-common-to-square');

      await move('square-to-tower-road');
      await move('tower-road-to-tower');
      const tower = await queryLocation();
      expect(tower.description).not.toMatch(/generations of records|drawn scholars|local stories/i);
      expect((await readObject('bellwold-tower-inscription')).text).toContain('seventeen villagers disappeared');
      await move('tower-to-road');
      await move('tower-road-to-square');

      await move('square-to-shop');
      expect((await talkToAnwen('Age of Measures')).text).toContain('Age of Measures');
      const introduction = await talkToAnwen();
      expect(introduction.choices.map(({ id }) => id)).toContain('ask-anwen-about-mill');
      const characterAtShop = await h.loadCharacter(characterId);
      const accepted = await h.dispatch(characterId, {
        type: 'npc.dialogue.choose',
        version: 1,
        commandId: 'accept-mill-ledger-quest',
        expectedVersion: characterAtShop.revision,
        payload: { npcId: 'anwen-marr', choiceId: 'ask-anwen-about-mill' },
      });
      expect(accepted.events.map(({ type }) => type)).toContain('quest.accepted');

      await move('shop-to-square');
      await move('square-to-tower-road');
      await move('tower-road-to-mill');
      const mill = await queryLocation();
      expect(mill.shortName).toBe('Abandoned Watermill');
      expect(mill.objects.map(({ id }) => id)).toEqual(expect.arrayContaining([
        'mill-work-ledger',
        'mill-copper-axe',
      ]));
      expect(mill.description).toContain('A copper axe leans against the wall.');
      const atMillBeforeTakingAxe = await h.loadCharacter(characterId);
      await h.dispatch(characterId, {
        type: 'character.take',
        version: 1,
        commandId: 'take-mill-copper-axe',
        expectedVersion: atMillBeforeTakingAxe.revision,
        payload: { itemId: 'mill-copper-axe' },
      });
      const atMill = await h.loadCharacter(characterId);
      expect(atMill.inventory).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'mill-copper-axe',
          label: 'Copper Axe',
          woodcuttingAxe: { requiredLevel: 1, power: 1 },
        }),
      ]));
      expect((await readObject('mill-work-ledger')).text).toContain('moving on nights when the channel ran low');
      const readResult = await h.dispatch(characterId, {
        type: 'character.read',
        version: 1,
        commandId: 'read-mill-ledger',
        expectedVersion: atMill.revision,
        payload: { objectId: 'mill-work-ledger' },
      });
      expect(readResult.events.map(({ type }) => type)).toContain('character.object_read');

      await move('mill-to-tower-road');
      await move('tower-road-to-square');
      await move('square-to-shop');
      const readyToReport = await talkToAnwen();
      expect(readyToReport.choices.map(({ id }) => id)).toContain('report-mill-ledger');
      const atShopAgain = await h.loadCharacter(characterId);
      const completed = await h.dispatch(characterId, {
        type: 'npc.dialogue.choose',
        version: 1,
        commandId: 'report-mill-ledger-to-anwen',
        expectedVersion: atShopAgain.revision,
        payload: { npcId: 'anwen-marr', choiceId: 'report-mill-ledger' },
      });
      expect(completed.events.map(({ type }) => type)).toContain('quest.completed');

      const replayed = await h.loadCharacter(characterId);
      expect(replayed.locationId).toBe('marrs-general-goods');
      expect(replayed.questProgress).toContainEqual(expect.objectContaining({
        questId: 'bellwold-mill-observations',
        status: 'completed',
      }));
      expect(replayed.visitedLocationIds).toEqual(expect.arrayContaining([
        'bellwold-market-square',
        'marrs-general-goods',
        'old-bell-tower-approach',
        'abandoned-watermill',
      ]));

    } finally {
      await h.engine.stop();
    }
  });

  it('keeps the church undercrypt as a reachable maze with six dead ends and a final sword chamber', () => {
    const crypt = orravethWorld.locations.filter(
      (location) => location.mapAreaId === 'bellwold-church-undercrypt',
    );
    const cryptIds = new Set(crypt.map(({ id }) => id));
    const visited = new Set<string>();
    const pending = ['bellwold-church-crypt-entry'];
    while (pending.length > 0) {
      const locationId = pending.pop()!;
      if (visited.has(locationId)) continue;
      visited.add(locationId);
      const location = crypt.find(({ id }) => id === locationId);
      for (const exit of location?.exits ?? []) {
        if (cryptIds.has(exit.toLocationId)) pending.push(exit.toLocationId);
      }
    }

    expect(crypt).toHaveLength(17);
    expect(visited.size).toBe(crypt.length);
    const deadEnds = crypt.filter((location) =>
      location.id !== 'bellwold-church-crypt-entry'
      && location.id !== 'bellwold-church-reliquary'
      && location.exits.filter((exit) => cryptIds.has(exit.toLocationId)).length === 1,
    );
    expect(deadEnds).toHaveLength(6);
    const reliquary = crypt.find(({ id }) => id === 'bellwold-church-reliquary');
    expect(reliquary?.takeables?.map(({ id }) => id)).toContain('bellwold-reliquary-sword');
    expect(reliquary?.exits.map(({ direction }) => direction)).toEqual(['south']);
  });

  it('lets players reach and talk with residents in the expanded settlement', async () => {
    const h = makeHarness();
    await h.engine.start();
    try {
      const created = await h.dispatch(undefined, {
        type: 'character.create',
        version: 1,
        commandId: 'orraveth-create-expanded-settlement-character',
        payload: { name: 'Tamsin', classId: 'orraveth.scout' },
      });
      const createdEvent = created.events.find((event) => event.type === 'character.created');
      const characterId = (createdEvent?.payload as { characterId?: string } | undefined)?.characterId;
      if (!characterId) throw new Error('Character creation returned no character ID.');
      h.owners.set(characterId, h.session.playerId);

      const move = async (exitId: string) => {
        const character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'character.move',
          version: 1,
          commandId: `expanded-move-${character.revision}-${exitId}`,
          expectedVersion: character.revision,
          payload: { exitId },
        });
        await h.engine.processPendingEffects();
      };
      const describe = async () => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'location.describe',
          version: 1,
          queryId: `expanded-location-${character.revision}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: {},
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return LocationProjectionSchema.parse(result.value);
      };
      let talkQuerySequence = 0;
      const talk = async (npcId: string, topic?: string) => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'npc.talk',
          version: 1,
          queryId: `expanded-talk-${npcId}-${character.revision}-${talkQuerySequence++}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: { npcId, ...(topic ? { topic } : {}) },
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return NpcDialogueProjectionSchema.parse(result.value);
      };
      const chooseDialogue = async (npcId: string, choiceId: string, commandId: string) => {
        const character = await h.loadCharacter(characterId);
        return h.dispatch(characterId, {
          type: 'npc.dialogue.choose',
          version: 1,
          commandId,
          expectedVersion: character.revision,
          payload: { npcId, choiceId },
        });
      };
      const expectResident = async (
        npcId: string,
        topic: string,
        name: string,
        followupTopic?: string,
        expectedDetail?: string,
      ) => {
        expect((await describe()).npcs.map(({ id }) => id)).toContain(npcId);
        const conversation = await talk(npcId);
        expect(conversation.choices.map(({ label }) => label)).toEqual(
          expect.arrayContaining(['Who are you?', 'What are you doing?', 'What is Bellwold like?']),
        );
        const dialogue = await talk(npcId, topic);
        expect(dialogue.npcName).toBe(name);
        expect(dialogue.text.length).toBeGreaterThan(0);
        if (followupTopic && expectedDetail) {
          const followup = await talk(npcId, followupTopic);
          expect(followup.text).toContain(expectedDetail);
        }
      };

      await expectResident('linnet-reed', 'Seli Tor', 'Linnet Reed', 'Aven Rusk', 'grain tally');
      await expectResident('taren-voss', 'Heskar', 'Taren Voss', 'Merefall League', 'merchant city-states');
      const tarenFirstVisit = await talk('taren-voss');
      expect(tarenFirstVisit.choices.map(({ label }) => label)).toHaveLength(4);
      expect(tarenFirstVisit.choices.map(({ label }) => label)).not.toContain(
        'What do you hear about places beyond Bellwold?',
      );
      const beforeLockedChoice = await h.loadCharacter(characterId);
      await expect(chooseDialogue('taren-voss', 'taren-voss-beyond-the-frontier', 'taren-early-frontier-question'))
        .rejects.toThrow('That choice is not available here.');
      expect((await h.loadCharacter(characterId)).revision).toBe(beforeLockedChoice.revision);

      await chooseDialogue('taren-voss', 'taren-voss-about-bellwold', 'taren-ask-about-bellwold');
      const tarenAfterTownQuestion = await talk('taren-voss');
      expect(tarenAfterTownQuestion.text).toContain('Bellwold is a working village near a frontier.');
      expect(tarenAfterTownQuestion.choices.map(({ label }) => label)).toEqual([
        'What do you hear about places beyond Bellwold?',
      ]);
      await expect(chooseDialogue('taren-voss', 'taren-voss-who-are-you', 'taren-old-option-after-branch'))
        .rejects.toThrow('That choice is not available here.');

      await chooseDialogue('taren-voss', 'taren-voss-beyond-the-frontier', 'taren-ask-about-beyond');
      const tarenAfterFrontierQuestion = await talk('taren-voss');
      expect(tarenAfterFrontierQuestion.text).toContain('Reports speak of merchant city-states');
      expect(tarenAfterFrontierQuestion.choices).toEqual([]);
      const beforeRestart = await h.loadCharacter(characterId);
      await h.dispatch(characterId, {
        type: 'npc.dialogue.restart',
        version: 1,
        commandId: 'taren-restart-conversation',
        expectedVersion: beforeRestart.revision,
        payload: { npcId: 'taren-voss' },
      });
      expect(await talk('taren-voss')).toEqual(tarenFirstVisit);
      await expectResident('orin-vale', 'fishing', 'Orin Vale');
      await move('square-to-inn');
      await expectResident('tomas-innkeeper', 'road', 'Tomas', 'Merefall League', 'guild-influenced city-states');
      await move('inn-to-square');
      await move('square-to-shop');
      await expectResident('anwen-marr', 'scale', 'Anwen Marr', 'Age of Measures', 'Age of Measures');
      await move('shop-to-square');

      await move('square-to-south-common');
      await move('south-common-to-blackwater-forge');
      await expectResident('darric-holt', 'repairs', 'Darric Holt', 'Sevenfold Workshop', 'seven artisans');

      await move('blackwater-forge-to-south-common');
      await move('south-common-to-green-mortar');
      await expectResident('ilya-fen', 'care', 'Ilya Fen', 'Unbinding Initiative', 'plant, mineral');

      await move('green-mortar-to-south-common');
      await move('south-common-to-well-court');
      await move('well-court-to-common-house');
      await expectResident('enna-pell', 'meetings', 'Enna Pell', 'seventeen villagers', 'seventeen villagers');

      await move('common-house-to-tallow-cottage');
      await expectResident('seli-tor', 'weaving', 'Seli Tor', 'customs', 'different ways');
      await move('tallow-cottage-to-wattle-row');
      await move('wattle-row-to-sovens-yard');
      await expectResident('rell-soven', 'wheel-work', 'Rell Soven', 'Rillward Freeholds', 'river settlements');
      await move('sovens-yard-to-wattle-row');
      await move('wattle-row-to-well-court');
      await move('well-court-to-grain-house');
      await expectResident('aven-rusk', 'stores', 'Aven Rusk', 'regional records', 'different accounts');

    } finally {
      await h.engine.stop();
    }
  });

  it('offers identity, activity, and town questions for every Bellwold resident', () => {
    const residents = new Map(
      orravethWorld.locations.flatMap((location) =>
        (location.npcs ?? []).map((npc) => [npc.id, npc] as const),
      ),
    );
    const bellwoldResidentIds = [
      'linnet-reed',
      'taren-voss',
      'orin-vale',
      'tomas-innkeeper',
      'anwen-marr',
      'ilya-fen',
      'darric-holt',
      'rell-soven',
      'seli-tor',
      'aven-rusk',
      'enna-pell',
      'sella-nettlemere',
      'tovin-ashdown',
      'renna-kell',
      'pella-wren',
      'sergeant-nera-vail',
      'mira-dell',
    ];

    for (const npcId of bellwoldResidentIds) {
      const npc = residents.get(npcId);
      expect(npc, `${npcId} should exist in Orraveth`).toBeDefined();
      const choices = npc!.dialogue?.choices ?? [];
      const minimumChoiceCount = npcId === 'anwen-marr' ? 8 : npcId === 'orin-vale' ? 6 : 5;
      expect(choices.length).toBeGreaterThanOrEqual(minimumChoiceCount);
      expect(new Set(choices.map(({ label }) => label)).size).toBe(choices.length);
      expect(choices.map(({ label }) => label)).toEqual(
        expect.arrayContaining(['Who are you?', 'What are you doing?', 'What is Bellwold like?']),
      );
    }
    expect(residents.get('orin-vale')?.dialogue?.choices.map(({ id }) => id))
      .toContain('accept-old-rod');
    expect(residents.get('anwen-marr')?.dialogue?.choices.map(({ id }) => id))
      .toEqual(expect.arrayContaining([
        'ask-anwen-about-mill',
        'ask-anwen-about-church-sword',
        'report-mill-ledger',
        'return-church-sword-to-anwen',
      ]));
  });

  it('keeps NPC look text observable while preserving background in supported interactions', () => {
    const npcs = [
      ...orravethWorld.locations.flatMap((location) => location.npcs ?? []),
      ...demoWorld.locations.flatMap((location) => location.npcs ?? []),
    ];
    const biographyOrMotive = /\b(?:runs? the shop|keeps the Kindly Roof|keeps her observations close|wants?|works? (?:at|as)|builds?|repairs?|weaves?|mends?|tends?|takes on|studies? the old tower)\b/i;

    expect(npcs.length).toBeGreaterThan(0);
    for (const npc of npcs) {
      expect(npc.description, `${npc.name} look description`).not.toMatch(biographyOrMotive);
    }

    const findNpc = (id: string) => npcs.find((npc) => npc.id === id);
    expect(findNpc('anwen-marr')?.greeting).toContain('shop');
    expect(findNpc('mara-waykeeper')?.greeting).toContain('keep the paths');
    expect(findNpc('edda-bellwright')?.greeting).toContain('repair bells');
    expect(JSON.stringify(findNpc('nim-fernshade')?.dialogue)).toContain('Fernshade fronds');
    expect(findNpc('talla-sedgewatch')?.greeting).toContain('thatch roofs with reeds');
  });

  it('grants Orin’s old rod and resolves fishing only from server-timed cast events', async () => {
    const runCast = async (name: string, roll: number, elapsedMs: number, expectedStatus: string) => {
      let now = new Date('2026-10-23T12:00:00.000Z');
      let rollCount = 0;
      const fixtureWorld = structuredClone(orravethWorld);
      fixtureWorld.roads = [];
      for (const location of fixtureWorld.locations) {
        for (const exit of location.exits) delete exit.roadId;
      }
      const h = makeHarness({ world: fixtureWorld, now: () => now, rng: { roll: () => { rollCount += 1; return roll; } } });
      await h.engine.start();
      const client = new MuddHttpClient({
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        fetcher: async (input, init = {}) => {
          const body = JSON.parse(String(init.body ?? '{}')) as unknown;
          const path = String(input);
          const result = path.endsWith('/commands')
            ? await h.engine.dispatch(body, h.session)
            : await h.engine.query(body, h.session);
          return Response.json(result);
        },
      });
      try {
        const created = await h.dispatch(undefined, {
          type: 'character.create',
          version: 1,
          commandId: `fishing-create-${name}`,
          payload: { name, classId: 'orraveth.scout' },
        });
        const characterId = (created.events.find((event) => event.type === 'character.created')?.payload as
          { characterId?: string } | undefined)?.characterId;
        if (!characterId) throw new Error('Character creation returned no character ID.');
        h.owners.set(characterId, h.session.playerId);

        let character = await h.loadCharacter(characterId);
        const gift = await h.dispatch(characterId, {
          type: 'npc.dialogue.choose',
          version: 1,
          commandId: `fishing-old-rod-${name}`,
          expectedVersion: character.revision,
          payload: { npcId: 'orin-vale', choiceId: 'accept-old-rod' },
        });
        expect(gift.events.map(({ type }) => type)).toContain('character.item_granted');
        character = await h.loadCharacter(characterId);
        expect(character.inventory).toContainEqual(expect.objectContaining({
          id: 'old-fishing-rod',
          label: 'old rod',
          fishingRod: expect.objectContaining({ biteChancePercent: 10, waitSeconds: 10 }),
        }));
        await h.dispatch(characterId, {
          type: 'npc.dialogue.restart',
          version: 1,
          commandId: `fishing-restart-orin-${name}`,
          expectedVersion: character.revision,
          payload: { npcId: 'orin-vale' },
        });
        character = await h.loadCharacter(characterId);
        expect(character.npcProgress.find((entry) => entry.npcId === 'orin-vale')).toEqual({
          npcId: 'orin-vale',
          progressFlagIds: ['received-old-fishing-rod'],
        });

        const previous = new Map<string, { from: string; exitId: string }>();
        const visited = new Set([character.locationId]);
        const queue = [character.locationId];
        while (queue.length) {
          const from = queue.shift()!;
          if (from === 'bellwold-river-bridge') break;
          const location = orravethWorld.locations.find((room) => room.id === from);
          for (const exit of location?.exits ?? []) {
            if (visited.has(exit.toLocationId)) continue;
            visited.add(exit.toLocationId);
            previous.set(exit.toLocationId, { from, exitId: exit.id });
            queue.push(exit.toLocationId);
          }
        }
        const path: string[] = [];
        let cursor = 'bellwold-river-bridge';
        while (cursor !== character.locationId) {
          const step = previous.get(cursor);
          if (!step) throw new Error('No route from the market square to the south bridge.');
          path.unshift(step.exitId);
          cursor = step.from;
        }
        for (const exitId of path) {
          character = await h.loadCharacter(characterId);
          await h.dispatch(characterId, {
            type: 'character.move',
            version: 1,
            commandId: `fishing-move-${name}-${exitId}`,
            expectedVersion: character.revision,
            payload: { exitId },
          });
        }
        character = await h.loadCharacter(characterId);
        expect(character.locationId).toBe('bellwold-river-bridge');
        expect(character.locationStateId).toBe('on');
        expect(orravethWorld.fishingSpots[0]?.species.map((species) => [species.id, species.weightPercent]))
          .toEqual([['smallmouth-bass', 50], ['common-carp', 45], ['rainbow-trout', 5]]);
        const cast = await client.startFishingCast(
          characterId,
          'old-fishing-rod',
          character.revision,
          `fishing-cast-${name}`,
        );
        const castId = (cast.events.find((event) => event.type === 'character.fishing_cast_started')?.payload as
          { cast?: { castId?: string } } | undefined)?.cast?.castId;
        if (!castId) throw new Error('The fishing cast did not start.');

        now = new Date(now.getTime() + elapsedMs);
        character = await h.loadCharacter(characterId);
        const advanced = await client.advanceFishingCast(
          characterId,
          castId,
          character.revision,
          `fishing-advance-${name}`,
        );
        const outcome = advanced.events.find((event) => event.type === 'character.fishing_cast_advanced')?.payload as
          {
            status?: string;
            ticksCompleted?: number;
            tickRolls?: Array<{ tick: number; roll: number; caught: boolean }>;
            item?: { label?: string; fishCatch?: { rarity?: string; lengthCm?: number; weightGrams?: number } };
          } | undefined;
        expect(outcome?.status).toBe(expectedStatus);
        expect(rollCount).toBe(expectedStatus === 'caught' ? 5 : 10);
        if (expectedStatus === 'caught') {
          expect(outcome).toMatchObject({
            ticksCompleted: 1,
            tickRolls: [{ tick: 1, roll: 1, caught: true }],
            item: { label: 'Smallmouth bass', fishCatch: { rarity: 'common' } },
          });
          expect(outcome?.item?.fishCatch?.lengthCm).toBeGreaterThanOrEqual(15);
          expect(outcome?.item?.fishCatch?.lengthCm).toBeLessThanOrEqual(25);
          expect(outcome?.item?.fishCatch?.weightGrams).toBeGreaterThanOrEqual(100);
          expect(outcome?.item?.fishCatch?.weightGrams).toBeLessThanOrEqual(300);
          expect((await h.loadCharacter(characterId)).inventory).toContainEqual(
            expect.objectContaining({ typeId: 'river-fish', label: 'Smallmouth bass' }),
          );
        } else {
          expect(outcome?.ticksCompleted).toBe(10);
          expect(outcome?.tickRolls).toEqual(Array.from({ length: 10 }, (_, index) => ({
            tick: index + 1, roll: 100, caught: false,
          })));
          const after = await h.loadCharacter(characterId);
          expect(after.activeFishing).toBeUndefined();
          expect(after.inventory.filter((item) => item.typeId === 'river-fish')).toHaveLength(0);
        }
      } finally {
        await h.engine.stop();
      }
    };

    await runCast('Lucky Angler', 1, 1_000, 'caught');
    await runCast('Patient Angler', 100, 10_000, 'no-bite');
  });

  it('requires a workbench, reuses a needle, consumes thread uses, and records crafting skill', async () => {
    const world = structuredClone(orravethWorld);
    if (!world.currency) throw new Error('Orraveth must have its gold currency.');
    world.currency.startingBalance = 100;
    const shopIndex = world.locations.findIndex(({ id }) => id === 'marrs-general-goods');
    if (shopIndex < 0) throw new Error('Marr’s General Goods is missing.');
    const [shop] = world.locations.splice(shopIndex, 1);
    if (!shop) throw new Error('Marr’s General Goods is missing.');
    shop.exits = [
      ...shop.exits,
      {
        id: 'craft-test-to-workshop',
        fromLocationId: shop.id,
        toLocationId: 'bellwold-milepost-workshop',
        label: 'north',
        direction: 'north',
      },
    ];
    shop.takeables = [
      ...(shop.takeables ?? []),
      {
        id: 'craft-test-tanned-hide',
        typeId: 'tanned-deer-hide',
        label: 'Tanned deer hide',
        description: 'Test material for the crafting integration.',
        stackable: true,
        quantity: 10,
      },
    ];
    world.locations.unshift(shop);
    const h = makeHarness({ world });
    await h.engine.start();
    const client = new MuddHttpClient({
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      fetcher: async (input, init = {}) => {
        const body = JSON.parse(String(init.body ?? '{}')) as unknown;
        const result = String(input).endsWith('/commands')
          ? await h.engine.dispatch(body, h.session)
          : await h.engine.query(body, h.session);
        return Response.json(result);
      },
    });
    try {
      const created = await client.createCharacter('Leatherworker', 'crafting-create', 'orraveth.scout');
      const characterId = created.streamId!;
      h.owners.set(characterId, h.session.playerId);
      let character = await h.loadCharacter(characterId);
      if (!character.wallet) {
        await h.dispatch(characterId, {
          type: 'character.wallet.initialize',
          version: 1,
          commandId: 'crafting-wallet',
          expectedVersion: character.revision,
          payload: {},
        });
        character = await h.loadCharacter(characterId);
      }
      const buy = async (listingId: string, commandId: string) => {
        character = await h.loadCharacter(characterId);
        await h.dispatch(characterId, {
          type: 'merchant.purchase',
          version: 1,
          commandId,
          expectedVersion: character.revision,
          payload: { merchantNpcId: 'anwen-marr', listingId },
        });
      };
      await buy('marr-crafting-needle', 'crafting-buy-needle');
      await buy('marr-spool-of-thread', 'crafting-buy-thread-a');
      await buy('marr-spool-of-thread', 'crafting-buy-thread-b');
      character = await h.loadCharacter(characterId);
      expect(character.inventory.filter((item) => item.typeId === 'spool-of-thread')).toHaveLength(2);
      expect(character.inventory.filter((item) => item.typeId === 'spool-of-thread')
        .every((item) => item.usesRemaining === 5)).toBe(true);

      await h.dispatch(characterId, {
        type: 'character.take',
        version: 1,
        commandId: 'crafting-take-hide',
        expectedVersion: character.revision,
        payload: { itemId: 'craft-test-tanned-hide' },
      });
      character = await h.loadCharacter(characterId);
      const outsideWorkbench = await h.engine.dispatch({
        type: 'crafting.craft',
        version: 1,
        commandId: 'crafting-reject-outside-workbench',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
        characterId,
        expectedVersion: character.revision,
        payload: { recipeId: 'leather-gloves', quantity: 1 },
      }, h.session);
      expect(outsideWorkbench.receipt.ok).toBe(false);

      await h.dispatch(characterId, {
        type: 'character.move',
        version: 1,
        commandId: 'crafting-enter-workshop',
        expectedVersion: character.revision,
        payload: { exitId: 'craft-test-to-workshop' },
      });
      character = await h.loadCharacter(characterId);
      const catalog = await client.getCraftingCatalog(characterId);
      expect(catalog.atWorkbench).toBe(true);
      expect(catalog.recipes.find(({ recipeId }) => recipeId === 'leather-gloves')).toMatchObject({
        maxCraftable: 10,
        experience: 13.8,
      });

      const craftCommandId = 'crafting-five-gloves';
      await client.craft(characterId, character.revision, 'leather-gloves', 5, craftCommandId);
      await client.craft(characterId, character.revision, 'leather-gloves', 5, craftCommandId);
      const crafted = await h.loadCharacter(characterId);
      expect(crafted.inventory.filter((item) => item.typeId === 'leather-gloves')).toHaveLength(5);
      expect(crafted.inventory.filter((item) => item.typeId === 'leather-gloves')
        .every((item) => item.equipment?.slot === 'gloves' && item.equipment.defenseBonus === 1)).toBe(true);
      expect(crafted.inventory.find((item) => item.typeId === 'tanned-deer-hide')).toMatchObject({
        stackable: true,
        quantity: 5,
      });
      expect(crafted.inventory.filter((item) => item.typeId === 'spool-of-thread')).toHaveLength(1);
      expect(crafted.inventory.find((item) => item.typeId === 'spool-of-thread')?.usesRemaining).toBe(5);
      expect(crafted.crafting).toEqual({ experienceHundredths: 6900, level: 2 });
    } finally {
      await h.engine.stop();
    }
  });

  it('equips leather pieces, sums defense, enforces restrictions, and replays equipment events', async () => {
    const world = structuredClone(orravethWorld);
    const startingLocation = world.locations[0];
    if (!startingLocation) throw new Error('Orraveth has no starting location.');
    const leatherGear = [
      { id: 'test-leather-gloves', typeId: 'leather-gloves', label: 'Leather gloves', slot: 'gloves', defenseBonus: 1 },
      { id: 'test-leather-boots', typeId: 'leather-boots', label: 'Leather boots', slot: 'boots', defenseBonus: 1 },
      { id: 'test-leather-cowl', typeId: 'leather-cowl', label: 'Leather cowl', slot: 'cowl', defenseBonus: 1 },
      { id: 'test-leather-body', typeId: 'leather-body', label: 'Leather body', slot: 'body', defenseBonus: 2 },
      { id: 'test-leather-chaps', typeId: 'leather-chaps', label: 'Leather chaps', slot: 'chaps', defenseBonus: 1 },
      { id: 'test-leather-vambraces', typeId: 'leather-vambraces', label: 'Leather vambraces', slot: 'vambraces', defenseBonus: 1 },
      { id: 'test-leather-shield', typeId: 'leather-shield', label: 'Leather shield', slot: 'shield', defenseBonus: 2 },
    ] as const;
    startingLocation.takeables = [
      ...(startingLocation.takeables ?? []),
      ...leatherGear.map(({ id, typeId, label, slot, defenseBonus }) => ({
        id,
        typeId,
        label,
        description: `A test ${label.toLocaleLowerCase()}.`,
        equipment: { slot, attackBonus: 0, defenseBonus },
      })),
      {
        id: 'test-non-equipment-stone',
        typeId: 'test-stone',
        label: 'Test stone',
        description: 'A plain stone that cannot be equipped.',
      },
    ];
    startingLocation.npcs = [
      ...(startingLocation.npcs ?? []),
      {
        id: 'leather-gear-test-opponent',
        name: 'Gear test opponent',
        description: 'A harmless practice opponent.',
        greeting: 'Ready when you are.',
        topics: [],
        unknownTopicResponse: 'There is nothing more to say.',
        combatProfile: { maxHealth: 20, attackDamage: 1 },
      },
    ];
    const h = makeHarness({ world, includeCombat: true });
    await h.engine.start();
    const client = new MuddHttpClient({
      worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      fetcher: async (input, init = {}) => {
        const body = JSON.parse(String(init.body ?? '{}')) as unknown;
        const result = String(input).endsWith('/commands')
          ? await h.engine.dispatch(body, h.session)
          : await h.engine.query(body, h.session);
        return Response.json(result);
      },
    });
    try {
      const created = await client.createCharacter('Leather Guard', 'leather-gear-create', 'orraveth.scout');
      const characterId = created.streamId!;
      h.owners.set(characterId, h.session.playerId);
      let character = await h.loadCharacter(characterId);
      const stats = async () => {
        const response = await h.engine.query(CharacterStatsQuerySchema.parse({
          type: 'character.stats',
          version: 1,
          queryId: `leather-gear-stats-${character.revision}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: {},
        }), h.session);
        if (!response.ok) throw new Error(response.message);
        return response.value;
      };

      for (const gear of leatherGear) {
        await client.take(characterId, gear.id, character.revision, `take-${gear.id}`);
        character = await h.loadCharacter(characterId);
      }
      await client.take(characterId, 'test-non-equipment-stone', character.revision, 'take-stone');
      character = await h.loadCharacter(characterId);
      await expect(client.equip(characterId, 'not-carried', character.revision, 'equip-not-carried'))
        .rejects.toThrow('You are not carrying that item.');
      await expect(client.equip(characterId, 'test-non-equipment-stone', character.revision, 'equip-stone'))
        .rejects.toThrow('Test stone cannot be equipped.');

      for (const gear of leatherGear) {
        await client.equip(characterId, gear.id, character.revision, `equip-${gear.id}`);
        character = await h.loadCharacter(characterId);
      }
      expect(character.equipment).toMatchObject({
        glovesItemId: 'test-leather-gloves',
        bootsItemId: 'test-leather-boots',
        cowlItemId: 'test-leather-cowl',
        bodyItemId: 'test-leather-body',
        chapsItemId: 'test-leather-chaps',
        vambracesItemId: 'test-leather-vambraces',
        shieldItemId: 'test-leather-shield',
      });
      expect((await stats()).armorPercent).toBe(45);
      await expect(client.equip(characterId, 'test-leather-gloves', character.revision, 'equip-gloves-again'))
        .rejects.toThrow('Leather gloves is already equipped.');

      for (const gear of leatherGear) {
        await client.unequip(characterId, gear.slot, character.revision, `unequip-${gear.id}`);
        character = await h.loadCharacter(characterId);
      }
      expect((await stats()).armorPercent).toBe(0);
      const history = await h.store.readStream(ORRAVETH_WORLD_INSTANCE_ID, characterId);
      expect(replayCharacter(history)).toEqual(character);
      expect(history.filter((event) => event.type === 'character.equipment_changed')).toHaveLength(14);

      await client.equip(characterId, 'test-leather-body', character.revision, 'equip-body-for-combat');
      character = await h.loadCharacter(characterId);
      await client.performCombatAction(
        characterId,
        'attack',
        character.revision,
        { targetNpcId: 'leather-gear-test-opponent' },
        'start-leather-gear-test-combat',
      );
      character = await h.loadCharacter(characterId);
      await expect(client.unequip(characterId, 'body', character.revision, 'unequip-during-combat'))
        .rejects.toThrow('You cannot change equipment during an active encounter.');
      expect(character.combat?.playerHealth).toBe(6);
      expect(character.combat?.lastNarration).toContain('after your armor absorbs 2');
      expect((await stats()).armorPercent).toBe(10);
    } finally {
      await h.engine.stop();
    }
  });
});
