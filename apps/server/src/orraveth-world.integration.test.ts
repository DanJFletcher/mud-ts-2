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
  autonomousNpcStreamId,
  characterPlugin,
  createClassRulesetPlugin,
  movementPlugin,
  npcDialoguePlugin,
  projectAutonomousNpcPosition,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import { ORRAVETH_WORLD_INSTANCE_ID, orravethWorld } from '@mudd/world-orraveth';
import {
  createAutonomousNpcScheduler,
} from './autonomous-npc-scheduler.js';
import { worldEventEffectsPlugin } from './demo-event-effects-plugin.js';
import { projectWorldMap } from './world-map-projection.js';
import { MuddHttpClient } from '@mudd/client-sdk';

function makeHarness(options: Readonly<{
  now?: () => Date;
  rng?: Readonly<{ roll: (sides: number) => number }>;
}> = {}) {
  let id = 0;
  const owners = new Map<string, string>();
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [
      createClassRulesetPlugin(orravethWorld.classCatalog!),
      worldItemsPlugin,
      autonomousNpcsPlugin,
      characterPlugin,
      movementPlugin,
      npcDialoguePlugin,
      worldEventEffectsPlugin,
    ],
    store,
    {
      canAccessInstance: async (_session, worldInstanceId) => worldInstanceId === ORRAVETH_WORLD_INSTANCE_ID,
      ownsCharacter: async (session, characterId) => owners.get(characterId) === session.playerId,
    },
    orravethWorld,
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

  it('has a valid, fully reachable fifty-six-location region with map directions matching its exits', () => {
    expect(validateDraftWorldGraph(orravethWorld)).toEqual([]);
    expect(orravethWorld.locations).toHaveLength(56);

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
      expect(road?.encounters).toEqual([
        expect.objectContaining({
          name: 'Stray Hound',
          combatProfile: { maxHealth: 4, attackDamage: 1, style: 'steady' },
        }),
      ]);
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
      expect(await scheduler.tick()).toBe(2);

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
      expect(await scheduler.tick()).toBe(2);
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
      const talkToAnwen = async (topic?: string) => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'npc.talk',
          version: 1,
          queryId: `anwen-${character.revision}-${topic ?? 'default'}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: { npcId: 'anwen-marr', ...(topic ? { topic } : {}) },
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return NpcDialogueProjectionSchema.parse(result.value);
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

      expect((await queryLocation()).shortName).toBe('Bellwold Market Square');
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
      expect(mill.objects.map(({ id }) => id)).toContain('mill-work-ledger');
      const atMill = await h.loadCharacter(characterId);
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
      const talk = async (npcId: string, topic: string) => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'npc.talk',
          version: 1,
          queryId: `expanded-talk-${npcId}-${character.revision}-${talkQuerySequence++}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: { npcId, topic },
        }, h.session, { characterProjection: character });
        if (!result.ok) throw new Error(result.message);
        return NpcDialogueProjectionSchema.parse(result.value);
      };
      const expectResident = async (
        npcId: string,
        topic: string,
        name: string,
        followupTopic?: string,
        expectedDetail?: string,
      ) => {
        expect((await describe()).npcs.map(({ id }) => id)).toContain(npcId);
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
      await move('square-to-inn');
      await expectResident('tomas-innkeeper', 'road', 'Tomas', 'Merefall League', 'guild-influenced city-states');
      await move('inn-to-square');

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
});
