import { describe, expect, it } from 'vitest';
import {
  CharacterProjectionSchema,
  LocationProjectionSchema,
  NpcDialogueProjectionSchema,
  validateDraftWorldGraph,
} from '@mudd/contracts';
import { EngineHost, InMemoryEventStore, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, movementPlugin, npcDialoguePlugin, worldItemsPlugin } from '@mudd/core-plugins';
import { ORRAVETH_WORLD_INSTANCE_ID, orravethWorld } from '@mudd/world-orraveth';
import { worldEventEffectsPlugin } from './demo-event-effects-plugin.js';

function makeHarness() {
  let id = 0;
  const owners = new Map<string, string>();
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [worldItemsPlugin, characterPlugin, movementPlugin, npcDialoguePlugin, worldEventEffectsPlugin],
    store,
    {
      canAccessInstance: async (_session, worldInstanceId) => worldInstanceId === ORRAVETH_WORLD_INSTANCE_ID,
      ownsCharacter: async (session, characterId) => owners.get(characterId) === session.playerId,
    },
    orravethWorld,
    () => `orraveth-test-id-${++id}`,
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

describe('Orraveth Bellwold starter slice', () => {
  it('has a valid, fully reachable six-location region using supported directions', () => {
    expect(validateDraftWorldGraph(orravethWorld)).toEqual([]);
    expect(orravethWorld.locations).toHaveLength(6);

    const locationIds = new Set(orravethWorld.locations.map(({ id }) => id));
    const reached = new Set<string>(['bellwold-market-square']);
    const queue = ['bellwold-market-square'];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = orravethWorld.locations.find(({ id }) => id === currentId)!;
      for (const exit of current.exits) {
        expect(['north', 'east', 'south', 'west', 'up', 'down']).toContain(exit.direction);
        expect(locationIds.has(exit.toLocationId)).toBe(true);
        if (!reached.has(exit.toLocationId)) {
          reached.add(exit.toLocationId);
          queue.push(exit.toLocationId);
        }
      }
    }
    expect(reached).toEqual(locationIds);
  });

  it('supports a complete server-authoritative exploration, dialogue, quest, and replay flow', async () => {
    const h = makeHarness();
    await h.engine.start();
    try {
      const created = await h.dispatch(undefined, {
        type: 'character.create',
        version: 1,
        commandId: 'orraveth-create-character',
        payload: { name: 'Mira' },
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
      const talkToAnwen = async () => {
        const character = await h.loadCharacter(characterId);
        const result = await h.engine.query({
          type: 'npc.talk',
          version: 1,
          queryId: `anwen-${character.revision}`,
          worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
          characterId,
          payload: { npcId: 'anwen-marr' },
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
});
