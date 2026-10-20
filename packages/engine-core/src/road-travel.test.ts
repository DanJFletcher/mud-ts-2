import { describe, expect, it, vi } from 'vitest';
import { WorldPackDraftSchema } from '@mudd/contracts';
import {
  characterPlugin,
  combatPlugin,
  interactionPlugin,
  movementPlugin,
  roadTravelPlugin,
  worldItemsPlugin,
} from '@mudd/core-plugins';
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

function roadWorld(encounterChancePercent: number) {
  return WorldPackDraftSchema.parse({
    formatVersion: 1,
    packId: 'road-test',
    packVersion: '1.0.0',
    displayName: 'Road Test',
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

function makeRoadEngine(encounterChancePercent: number, rolls: number[]) {
  const world = roadWorld(encounterChancePercent);
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
    [worldItemsPlugin, characterPlugin, interactionPlugin, combatPlugin, movementPlugin, roadTravelPlugin],
    store,
    authorization,
    world,
    () => `road-test-id-${++id}`,
    () => new Date('2026-10-20T12:00:00.000Z'),
    rng,
  );
  return { engine, store, rng };
}

async function createRoadCharacter(engine: EngineHost) {
  const created = await engine.dispatch({
    type: 'character.create',
    version: 1,
    commandId: 'road-create',
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    payload: { name: 'Wayfarer' },
  }, session);
  expect(created.receipt.ok).toBe(true);
  return created.streamId!;
}

describe('stepwise road travel', () => {
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
    expect(stepped.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    expect(stepped.events.map(({ type }) => type)).toEqual(['character.moved']);
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(projection).toMatchObject({
      locationId: 'road-segment',
      visitedLocationIds: ['road-start', 'road-segment'],
      revision: 2,
    });
    expect(rng.roll).toHaveBeenCalledTimes(1);
    expect(stepped.events[0]?.payload).toMatchObject({
      roadTravel: {
        roadId: 'test-road',
        segmentIndex: 1,
        encounterRoll: 1,
        encounterOccurred: false,
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
    expect(ambush.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    expect(ambush.events.map(({ type }) => type)).toEqual([
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
      expectedVersion: 3,
      payload: { action: 'attack', encounterId: started.combat!.encounterId },
    }, session);
    expect(attack.receipt).toMatchObject({ ok: true, newAggregateVersion: 5 });
    const resolved = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(resolved.combat).toMatchObject({ status: 'victory', round: 1, opponentHealth: 0 });
    await engine.stop();
  });
});
