import { describe, expect, it, vi } from 'vitest';
import { TeamCombatInfoProjectionSchema, WorldPackDraftSchema } from '@mudd/contracts';
import {
  characterPlugin,
  combatPlugin,
  interactionPlugin,
  merchantPlugin,
  movementPlugin,
  teamCombatPlugin,
  teamCombatRosterPolicyCapability,
  roadTravelPlugin,
  worldItemsPlugin,
} from '@mudd/core-plugins';
import type { EnginePlugin } from '@mudd/engine-core';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { EngineHost, InMemoryEventStore, replayCharacter } from './index.js';

const session = {
  sessionId: 'road-session',
  playerId: 'road-player',
  actorId: 'road-player',
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
} as const;

const authorization = {
  canAccessInstance: async () => true,
  ownsCharacter: async () => true,
};

let activeRoadPartyRoster: {
  sourceGroupId: string;
  maxPlayers: number;
  players: { playerId: string; characterId: string; displayName: string }[];
} | undefined;

const roadPartyRosterPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.party-combat-policy',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    provides: [teamCombatRosterPolicyCapability.id],
  },
  register({ provideCapability }) {
    provideCapability(teamCombatRosterPolicyCapability, {
      async resolve() {
        if (!activeRoadPartyRoster) throw new Error('No test party is active.');
        return activeRoadPartyRoster;
      },
      async resolveIfPartyPresent() {
        return activeRoadPartyRoster;
      },
    });
  },
};

function roadWorld(
  encounterChancePercent: number,
  deerDisposition?: 'passive' | 'hostile',
) {
  return WorldPackDraftSchema.parse({
    formatVersion: 1,
    packId: 'road-test',
    packVersion: '1.0.0',
    displayName: 'Road Test',
    currency: {
      id: 'moss-mark',
      name: 'moss mark',
      symbol: 'm',
      startingBalance: 12,
    },
    locations: [
      {
        id: 'road-start',
        name: 'Road Start',
        description: 'The road begins.',
        exits: [
          { id: 'start-to-segment', fromLocationId: 'road-start', toLocationId: 'road-segment', label: 'Along the road', roadId: 'test-road' },
        ],
      },
      {
        id: 'road-segment',
        name: 'Road Segment',
        description: 'A stretch of road.',
        takeables: [{
          id: 'road-segment-fallen-token',
          label: 'Fallen brass token',
          description: 'A brass token stamped with a tiny fern.',
          roomDescription: 'A brass token glints in the roadside dust.',
        }],
        npcs: [{
          id: 'roadside-trader',
          name: 'Pip',
          description: 'A traveler has set up a small cart beneath the ferns.',
          greeting: 'Take a look at my travel supplies.',
          topics: [],
          unknownTopicResponse: 'I only have the goods in my cart.',
          shop: {
            listings: [{
              id: 'roadside-bandage',
              item: {
                id: 'item-roadside-bandage',
                label: 'Herbal bandage',
                description: 'A clean strip of linen packed with crushed healing leaves.',
              },
              price: 2,
            }],
          },
        }, {
          id: 'wild-deer',
          name: 'Wild Deer',
          description: 'A lean deer with a russet coat and a dark line along its back.',
          activityDescription: 'browses the verge, ears twitching',
          greeting: 'The deer watches you quietly.',
          topics: [],
          unknownTopicResponse: 'The deer flicks its ears and keeps grazing.',
          ...(deerDisposition ? { combatDisposition: deerDisposition } : {}),
          combatProfile: { maxHealth: 10, attackDamage: 1 },
        }],
        exits: [
          { id: 'segment-to-start', fromLocationId: 'road-segment', toLocationId: 'road-start', label: 'Back', roadId: 'test-road' },
          { id: 'segment-to-end', fromLocationId: 'road-segment', toLocationId: 'road-end', label: 'Onward', roadId: 'test-road' },
        ],
      },
      {
        id: 'road-end',
        name: 'Road End',
        description: 'The road ends.',
        exits: [
          { id: 'end-to-segment', fromLocationId: 'road-end', toLocationId: 'road-segment', label: 'Back', roadId: 'test-road' },
        ],
      },
    ],
    roads: [{
      id: 'test-road',
      name: 'Test Road',
      locationIds: ['road-start', 'road-segment', 'road-end'],
      encounterChancePercent,
      encounters: [{
        id: 'road-thug',
        name: 'Road Thug',
        combatProfile: { maxHealth: 1, attackDamage: 1 },
      }],
    }],
  });
}

function makeRoadEngine(
  encounterChancePercent: number,
  rolls: number[],
  deerDisposition?: 'passive' | 'hostile',
) {
  const world = roadWorld(encounterChancePercent, deerDisposition);
  const store = new InMemoryEventStore();
  let id = 0;
  const rng = {
    roll: vi.fn((sides: number) => {
      const next = rolls.shift() ?? 1;
      if (next < 1 || next > sides) throw new Error('Test RNG value out of bounds.');
      return next;
    }),
  };
  const engine = new EngineHost(
    [
      worldItemsPlugin,
      characterPlugin,
      interactionPlugin,
      combatPlugin,
      movementPlugin,
      merchantPlugin,
      roadPartyRosterPlugin,
      teamCombatPlugin,
      roadTravelPlugin,
    ],
    store,
    authorization,
    world,
    () => `road-test-id-${++id}`,
    () => new Date('2026-10-20T12:00:00.000Z'),
    rng,
  );
  return { engine, store, rng };
}

async function createRoadCharacter(
  engine: EngineHost,
  characterSession = session,
  commandId = 'road-create',
) {
  const created = await engine.dispatch({
    type: 'character.create',
    version: 1,
    commandId,
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    payload: { name: 'Wayfarer' },
  }, characterSession);
  expect(created.receipt.ok).toBe(true);
  return created.streamId!;
}

describe('stepwise road travel', () => {
  async function drainRoadCharacterStamina(store: InMemoryEventStore, characterId: string) {
    const history = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);
    const result = await store.append({
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      streamId: characterId,
      actorId: session.actorId,
      commandId: `drain-stamina-${characterId}`,
      payloadHash: characterId,
      expectedVersion: history.at(-1)?.aggregateVersion ?? 0,
      events: Array.from({ length: 20 }, (_, index) => {
        const fromLocationId = index % 2 === 0 ? 'road-start' : 'road-segment';
        return {
          type: 'character.moved',
          version: 1,
          payload: {
            characterId,
            fromLocationId,
            toLocationId: fromLocationId === 'road-start' ? 'road-segment' : 'road-start',
            exitId: `test-drain-${index + 1}`,
            movementCost: 5,
          },
        };
      }),
    });
    if (result.kind !== 'committed') throw new Error('Could not drain the road traveler stamina.');
  }

  it('rejects bypassing a road and records a single segment when no encounter occurs', async () => {
    const { engine, store, rng } = makeRoadEngine(0, [1]);
    await engine.start();
    const characterId = await createRoadCharacter(engine);

    const bypass = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'road-bypass',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, session);
    expect(bypass.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const stepped = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-step',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, session);
    expect(stepped.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    expect(stepped.events.map(({ type }) => type)).toEqual([
      'character.vital_recovery_settled',
      'character.moved',
    ]);
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(projection).toMatchObject({
      locationId: 'road-segment',
      visitedLocationIds: ['road-start', 'road-segment'],
      revision: 3,
      resources: { stamina: { current: 95, maximum: 100 } },
    });
    expect(rng.roll).toHaveBeenCalledTimes(1);
    expect(stepped.events[1]?.payload).toMatchObject({
      movementCost: 5,
      roadTravel: {
        roadId: 'test-road',
        segmentIndex: 1,
        encounterRoll: 1,
        encounterOccurred: false,
      },
    });
    await engine.stop();
  });

  it('rejects an unaffordable road step before moving, starting combat, or changing stamina', async () => {
    const { engine, store, rng } = makeRoadEngine(100, [1]);
    await engine.start();
    const characterId = await createRoadCharacter(engine);
    await drainRoadCharacterStamina(store, characterId);
    const before = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);

    const result = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-step-insufficient-stamina',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 21,
      payload: { exitId: 'start-to-segment' },
    }, session);

    expect(result.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    const history = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);
    const projection = replayCharacter(history);
    expect(projection).toMatchObject({
      locationId: 'road-start',
      resources: { stamina: { current: 0, maximum: 100 } },
    });
    expect(projection?.combat).toBeUndefined();
    expect(history).toHaveLength(before.length);
    expect(history.filter((event) => event.type === 'character.moved')).toHaveLength(
      before.filter((event) => event.type === 'character.moved').length,
    );
    expect(history.filter((event) => event.type === 'character.combat_encounter_started')).toHaveLength(
      before.filter((event) => event.type === 'character.combat_encounter_started').length,
    );
    expect(rng.roll).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('supports descriptions, room items, and merchant services on road sections', async () => {
    const { engine, store } = makeRoadEngine(0, [1]);
    await engine.start();
    const characterId = await createRoadCharacter(engine);
    const travel = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-room-travel',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, session);
    expect(travel.receipt.ok).toBe(true);

    const room = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'road-room-look',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session);
    expect(room).toMatchObject({
      ok: true,
      value: {
        title: 'Road Segment',
        description: expect.stringContaining('A stretch of road.'),
        objects: [expect.objectContaining({
          id: 'road-segment-fallen-token',
          takeable: true,
        })],
        npcs: [
          expect.objectContaining({
            id: 'roadside-trader',
            canShop: true,
          }),
          expect.objectContaining({
            id: 'wild-deer',
            canChallenge: true,
            combatDisposition: 'passive',
          }),
        ],
      },
    });

    const catalog = await engine.query({
      type: 'merchant.catalog',
      version: 1,
      queryId: 'roadside-merchant-catalog',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { merchantNpcId: 'roadside-trader' },
    }, session);
    expect(catalog).toMatchObject({
      ok: true,
      value: {
        merchantName: 'Pip',
        listings: [expect.objectContaining({ id: 'roadside-bandage', purchased: false })],
      },
    });

    const take = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'road-room-take-token',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { itemId: 'road-segment-fallen-token' },
    }, session);
    expect(take.receipt.ok).toBe(true);
    const purchase = await engine.dispatch({
      type: 'merchant.purchase',
      version: 1,
      commandId: 'road-room-buy-bandage',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { merchantNpcId: 'roadside-trader', listingId: 'roadside-bandage' },
    }, session);
    expect(purchase.receipt.ok).toBe(true);
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      locationId: 'road-segment',
      wallet: { balance: 10 },
      inventory: [
        { id: 'road-segment-fallen-token' },
        { id: 'item-roadside-bandage' },
      ],
    });
    await engine.stop();
  });

  it('requires combat stats for an authored hostile creature', () => {
    const world = roadWorld(0, 'hostile');
    const deer = world.locations.find(({ id }) => id === 'road-segment')?.npcs?.find(({ id }) => id === 'wild-deer');
    expect(deer).toBeDefined();
    delete deer!.combatProfile;
    expect(() => WorldPackDraftSchema.parse(world)).toThrow('Hostile NPCs require a combat profile.');
  });

  it('keeps passive creatures out of combat until the player attacks them', async () => {
    const { engine, store } = makeRoadEngine(0, [1]);
    await engine.start();
    const characterId = await createRoadCharacter(engine);
    const travel = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-step-beside-deer',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, session);
    expect(travel.receipt.ok).toBe(true);
    await engine.processPendingEffects();

    let character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(character).toMatchObject({ locationId: 'road-segment' });
    expect(character?.combat).toBeUndefined();

    const attack = await engine.dispatch({
      type: 'combat.action',
      version: 1,
      commandId: 'attack-passive-deer',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: character!.revision,
      payload: { action: 'attack', targetNpcId: 'wild-deer' },
    }, session);
    expect(attack.receipt.ok).toBe(true);
    character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(character?.combat).toMatchObject({ status: 'active', opponentNpcId: 'wild-deer' });
    await engine.stop();
  });

  it('starts combat when a hostile creature is present on room entry', async () => {
    const { engine, store } = makeRoadEngine(0, [1], 'hostile');
    await engine.start();
    const characterId = await createRoadCharacter(engine);
    const travel = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-step-into-hostile-room',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, session);
    expect(travel.receipt.ok).toBe(true);

    await engine.processPendingEffects();
    const character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(character).toMatchObject({
      locationId: 'road-segment',
      combat: {
        status: 'active',
        opponentNpcId: 'wild-deer',
        lastAction: 'encounter',
        lastNarration: 'Wild Deer rushes you as you enter.',
      },
    });
    await engine.stop();
  });

  it('atomically starts a character-owned encounter and lets the next combat action resolve it', async () => {
    const { engine, store, rng } = makeRoadEngine(100, [1, 1]);
    await engine.start();
    const characterId = await createRoadCharacter(engine);

    const command = {
      type: 'character.road.step',
      version: 1,
      commandId: 'road-ambush',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    };
    const ambush = await engine.dispatch(command, session);
    expect(ambush.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(ambush.events.map(({ type }) => type)).toEqual([
      'character.vital_recovery_settled',
      'character.moved',
      'character.combat_encounter_started',
    ]);
    const duplicate = await engine.dispatch(command, session);
    expect(duplicate.receipt).toEqual(ambush.receipt);
    expect(rng.roll).toHaveBeenCalledTimes(2);

    const started = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(started).toMatchObject({
      locationId: 'road-segment',
      combat: {
        status: 'active',
        round: 0,
        opponentNpcId: 'road-thug',
        lastAction: 'encounter',
      },
    });

    const attack = await engine.dispatch({
      type: 'combat.action',
      version: 1,
      commandId: 'road-ambush-attack',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { action: 'attack', encounterId: started.combat!.encounterId },
    }, session);
    expect(attack.receipt).toMatchObject({ ok: true, newAggregateVersion: 7 });
    const resolved = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(resolved.combat).toMatchObject({ status: 'victory', round: 1, opponentHealth: 0 });
    await engine.stop();
  });

  it('rejects a shared road encounter when any party member cannot afford the move', async () => {
    activeRoadPartyRoster = undefined;
    const { engine, store } = makeRoadEngine(100, [1, 1]);
    await engine.start();
    const firstSession = { ...session, playerId: 'road-short-player-a', actorId: 'road-short-player-a' };
    const secondSession = { ...session, playerId: 'road-short-player-b', actorId: 'road-short-player-b' };
    const firstCharacterId = await createRoadCharacter(engine, firstSession, 'road-short-character-a');
    const secondCharacterId = await createRoadCharacter(engine, secondSession, 'road-short-character-b');
    await drainRoadCharacterStamina(store, secondCharacterId);
    activeRoadPartyRoster = {
      sourceGroupId: 'road-short-party',
      maxPlayers: 4,
      players: [
        { playerId: firstSession.playerId, characterId: firstCharacterId, displayName: 'Wayfarer A' },
        { playerId: secondSession.playerId, characterId: secondCharacterId, displayName: 'Wayfarer B' },
      ],
    };

    const result = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-party-insufficient-stamina',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, firstSession);

    expect(result.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstCharacterId))).toMatchObject({
      locationId: 'road-start',
      resources: { stamina: { current: 100, maximum: 100 } },
    });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondCharacterId))).toMatchObject({
      locationId: 'road-start',
      resources: { stamina: { current: 0, maximum: 100 } },
    });
    expect(await store.readStream(DEMO_WORLD_INSTANCE_ID, 'world-team-combat')).toHaveLength(0);
    activeRoadPartyRoster = undefined;
    await engine.stop();
  });

  it('starts one shared roadside encounter and moves surviving party members together after victory', async () => {
    activeRoadPartyRoster = undefined;
    const { engine, store, rng } = makeRoadEngine(100, [1, 1]);
    await engine.start();
    const firstSession = { ...session, playerId: 'road-party-player-a', actorId: 'road-party-player-a' };
    const secondSession = { ...session, playerId: 'road-party-player-b', actorId: 'road-party-player-b' };
    const firstCharacterId = await createRoadCharacter(engine, firstSession, 'road-party-character-a');
    const secondCharacterId = await createRoadCharacter(engine, secondSession, 'road-party-character-b');
    activeRoadPartyRoster = {
      sourceGroupId: 'road-party-test',
      maxPlayers: 4,
      players: [
        { playerId: firstSession.playerId, characterId: firstCharacterId, displayName: 'Wayfarer A' },
        { playerId: secondSession.playerId, characterId: secondCharacterId, displayName: 'Wayfarer B' },
      ],
    };

    const step = {
      type: 'character.road.step',
      version: 1,
      commandId: 'road-party-ambush',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    };
    const ambush = await engine.dispatch(step, firstSession);
    expect(ambush.receipt.ok).toBe(true);
    expect(ambush.streamId).toBe('world-team-combat');
    expect(ambush.events.map((event) => event.type)).toEqual(['team.road_encounter_started']);
    expect((await engine.dispatch(step, firstSession)).receipt).toEqual(ambush.receipt);
    expect(rng.roll).toHaveBeenCalledTimes(2);

    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstCharacterId))?.locationId)
      .toBe('road-start');
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondCharacterId))?.locationId)
      .toBe('road-start');
    const info = await engine.query({
      type: 'team.combat.info',
      version: 1,
      queryId: 'road-party-ambush-info',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: {},
    }, secondSession);
    const parsedInfo = TeamCombatInfoProjectionSchema.parse((info as { value: unknown }).value);
    expect(parsedInfo).toMatchObject({
      roadTravel: {
        roadId: 'test-road',
        fromLocationId: 'road-start',
        toLocationId: 'road-segment',
        exitId: 'start-to-segment',
      },
      encounter: {
        status: 'active',
        participants: [
          { characterId: firstCharacterId, teamId: 'allies' },
          { characterId: secondCharacterId, teamId: 'allies' },
          { npcId: 'road-thug', teamId: 'enemies' },
        ],
      },
    });
    const encounterId = parsedInfo.encounter!.encounterId;
    const victory = await engine.dispatch({
      type: 'team.combat.action',
      version: 1,
      commandId: 'road-party-ambush-victory',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: { encounterId, action: 'attack' },
    }, firstSession);
    expect(victory.receipt.ok).toBe(true);

    await engine.processPendingEffects();
    await engine.processPendingEffects();
    for (const characterId of [firstCharacterId, secondCharacterId]) {
      const history = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);
      const movedEvents = history.filter((event) => event.type === 'character.moved');
      expect(movedEvents).toHaveLength(1);
      expect(replayCharacter(history)).toMatchObject({
        locationId: 'road-segment',
        visitedLocationIds: ['road-start', 'road-segment'],
        resources: { stamina: { current: 95, maximum: 100 } },
      });
      expect(movedEvents[0]?.payload).toMatchObject({
        fromLocationId: 'road-start',
        toLocationId: 'road-segment',
        movementCost: 5,
        roadTravel: { roadId: 'test-road', encounterOccurred: true },
      });
    }
    activeRoadPartyRoster = undefined;
    await engine.stop();
  });

  it('keeps the party at the source location when everyone flees a shared road encounter', async () => {
    activeRoadPartyRoster = undefined;
    const { engine, store } = makeRoadEngine(100, [1, 1]);
    await engine.start();
    const firstSession = { ...session, playerId: 'road-flee-player-a', actorId: 'road-flee-player-a' };
    const secondSession = { ...session, playerId: 'road-flee-player-b', actorId: 'road-flee-player-b' };
    const firstCharacterId = await createRoadCharacter(engine, firstSession, 'road-flee-character-a');
    const secondCharacterId = await createRoadCharacter(engine, secondSession, 'road-flee-character-b');
    activeRoadPartyRoster = {
      sourceGroupId: 'road-flee-party',
      maxPlayers: 4,
      players: [
        { playerId: firstSession.playerId, characterId: firstCharacterId, displayName: 'Wayfarer A' },
        { playerId: secondSession.playerId, characterId: secondCharacterId, displayName: 'Wayfarer B' },
      ],
    };
    const ambush = await engine.dispatch({
      type: 'character.road.step',
      version: 1,
      commandId: 'road-flee-ambush',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      expectedVersion: 1,
      payload: { exitId: 'start-to-segment' },
    }, firstSession);
    expect(ambush.receipt.ok).toBe(true);
    const info = await engine.query({
      type: 'team.combat.info',
      version: 1,
      queryId: 'road-flee-ambush-info',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: {},
    }, firstSession);
    const encounterId = TeamCombatInfoProjectionSchema.parse((info as { value: unknown }).value)
      .encounter!.encounterId;

    expect((await engine.dispatch({
      type: 'team.combat.action',
      version: 1,
      commandId: 'road-flee-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstCharacterId,
      payload: { encounterId, action: 'flee' },
    }, firstSession)).receipt.ok).toBe(true);
    expect((await engine.dispatch({
      type: 'team.combat.action',
      version: 1,
      commandId: 'road-flee-second',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: secondCharacterId,
      payload: { encounterId, action: 'flee' },
    }, secondSession)).receipt.ok).toBe(true);
    await engine.processPendingEffects();

    for (const characterId of [firstCharacterId, secondCharacterId]) {
      const history = await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId);
      expect(replayCharacter(history)).toMatchObject({
        locationId: 'road-start',
        resources: { stamina: { current: 80, maximum: 100 } },
      });
      expect(history.some((event) => event.type === 'character.moved')).toBe(false);
      expect(history.filter((event) => event.type === 'character.stamina_spent')).toHaveLength(1);
    }
    activeRoadPartyRoster = undefined;
    await engine.stop();
  });
});
