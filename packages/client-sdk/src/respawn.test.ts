import { describe, expect, it } from 'vitest';
import {
  EngineHost,
  InMemoryEventStore,
  replayCharacter,
  SYSTEM_ACTOR_ID,
  type EnginePlugin,
} from '@mudd/engine-core';
import {
  characterPlugin,
  corpseLifecyclePlugin,
  combatPlugin,
  interactionPlugin,
  movementPlugin,
  objectLifecyclePlugin,
  objectLifecycleStreamId,
  projectWorldItems,
  ROOM_ANNOUNCEMENT_EFFECT,
  RoomAnnouncementEffectSchema,
  worldItemsPlugin,
  worldItemsStreamId,
} from '@mudd/core-plugins';
import { WorldPackDraftSchema } from '@mudd/contracts';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';

function makeWorld(withDroppableItems: boolean) {
  return WorldPackDraftSchema.parse({
    ...demoWorld,
    locations: demoWorld.locations.map((location) => location.id !== 'mossgate-clearing'
      ? location
      : {
        ...location,
        ...(withDroppableItems ? {
          takeables: [
            ...(location.takeables ?? []),
            { id: 'test-copper-charm', label: 'Copper charm', description: 'A small copper charm.' },
            { id: 'test-glass-bead', label: 'Glass bead', description: 'A blue glass bead.' },
          ],
        } : {}),
        npcs: (location.npcs ?? []).map((npc) => npc.id === 'mossgate-training-sentinel'
          ? { ...npc, combatProfile: { maxHealth: 40, attackDamage: 6, style: 'steady' as const } }
          : npc),
      }),
  });
}

const testRoomAnnouncementPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.test-respawn-room-announcements',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
  },
  register({ registerEffect }) {
    registerEffect(ROOM_ANNOUNCEMENT_EFFECT, 1, RoomAnnouncementEffectSchema, async () => {});
  },
};

function makeHarness(withDroppableItems: boolean, now: () => Date = () => new Date('2026-10-19T12:00:00.000Z')) {
  let id = 0;
  const store = new InMemoryEventStore();
  const world = makeWorld(withDroppableItems);
  const engine = new EngineHost(
    [
      worldItemsPlugin,
      objectLifecyclePlugin,
      corpseLifecyclePlugin,
      testRoomAnnouncementPlugin,
      characterPlugin,
      interactionPlugin,
      combatPlugin,
      movementPlugin,
    ],
    store,
    { canAccessInstance: async () => true, ownsCharacter: async () => true },
    world,
    () => `respawn-test-id-${++id}`,
    now,
    { roll: (sides) => sides },
  );
  return { engine, store };
}

const session = (playerId: string) => ({
  sessionId: `session-${playerId}`,
  playerId,
  actorId: playerId,
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
});

async function createCharacter(
  engine: EngineHost,
  playerId: string,
  name: string,
) {
  const result = await engine.dispatch({
    type: 'character.create',
    version: 1,
    commandId: `create-${playerId}`,
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    payload: { name },
  }, session(playerId));
  if (!result.receipt.ok || !result.streamId) throw new Error('Could not create a test character.');
  return result.streamId;
}

async function perform(
  engine: EngineHost,
  store: InMemoryEventStore,
  playerId: string,
  characterId: string,
  commandId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
  if (!character) throw new Error('Test character projection is missing.');
  return dispatchAndSettle(engine, {
    type,
    version: 1,
    commandId,
    worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    characterId,
    expectedVersion: character.revision,
    payload,
  }, session(playerId));
}

// Like the server's command route, settle a command's own completing effects
// before answering; the background worker leaves fresh ones to the request.
async function dispatchAndSettle(engine: EngineHost, command: unknown, context: ReturnType<typeof session>) {
  const result = await engine.dispatch(command, context);
  await engine.settleCommandEffects(context, result);
  return result;
}

describe('character death and shared loot', () => {
  it('respawns at the authored fountain and makes one random eligible item shared loot', async () => {
    const { engine, store } = makeHarness(true);
    await engine.start();
    const fallenId = await createCharacter(engine, 'fallen-player', 'Rill');
    expect((await perform(engine, store, 'fallen-player', fallenId, 'take-charm', 'character.take', {
      itemId: 'test-copper-charm',
    })).receipt.ok).toBe(true);
    expect((await perform(engine, store, 'fallen-player', fallenId, 'take-bead', 'character.take', {
      itemId: 'test-glass-bead',
    })).receipt.ok).toBe(true);

    const beforeDeath = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, fallenId))!;
    const deathCommand = {
      type: 'combat.action',
      version: 1,
      commandId: 'lethal-hit',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: fallenId,
      expectedVersion: beforeDeath.revision,
      payload: { action: 'attack', targetNpcId: 'mossgate-training-sentinel' },
    };
    const death = await dispatchAndSettle(engine, deathCommand, session('fallen-player'));
    expect(death.receipt.ok).toBe(true);
    expect((await dispatchAndSettle(engine, deathCommand, session('fallen-player'))).receipt.ok).toBe(true);
    await engine.processPendingEffects();

    const fallen = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, fallenId));
    expect(fallen).toMatchObject({
      locationId: 'stillwater-fountain',
      health: { current: 6, maximum: 6 },
      inventory: [{ id: 'test-copper-charm', label: 'Copper charm' }],
    });
    expect(fallen?.combat).toBeUndefined();

    const itemEvents = await store.readStream(DEMO_WORLD_INSTANCE_ID, worldItemsStreamId(DEMO_WORLD_INSTANCE_ID));
    expect(itemEvents.filter((event) => event.type === 'world.corpse_created')).toHaveLength(1);
    const worldItems = projectWorldItems(itemEvents);
    expect(worldItems.corpses).toHaveLength(1);
    expect(worldItems.corpses[0]).toMatchObject({
      locationId: 'mossgate-clearing',
      corpseType: 'player',
      ownerCharacterId: fallenId,
      expirationPolicy: 'recovery-storage',
    });
    expect(worldItems.items).toHaveLength(1);
    expect(worldItems.items[0]).toMatchObject({
      locationId: 'mossgate-clearing',
      containerId: worldItems.corpses[0]!.corpseId,
      holderCharacterId: null,
      item: { label: 'Glass bead' },
    });

    const firstClaimant = await createCharacter(engine, 'first-claimant', 'Moss');
    const secondClaimant = await createCharacter(engine, 'second-claimant', 'Fern');
    const worldItemId = worldItems.items[0]!.worldItemId;
    const roomView = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'room-view-shared-drop',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: firstClaimant,
      payload: {},
    }, session('first-claimant'));
    expect(roomView).toMatchObject({
      ok: true,
      value: { objects: expect.arrayContaining([expect.objectContaining({ id: worldItemId })]) },
    });
    const [firstClaim, secondClaim] = await Promise.all([
      perform(engine, store, 'first-claimant', firstClaimant, 'claim-first', 'character.take', { itemId: worldItemId }),
      perform(engine, store, 'second-claimant', secondClaimant, 'claim-second', 'character.take', { itemId: worldItemId }),
    ]);
    expect([firstClaim.receipt, secondClaim.receipt].filter((receipt) => receipt.ok)).toHaveLength(1);
    await engine.processPendingEffects();

    const claimantStates = [
      replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, firstClaimant)),
      replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, secondClaimant)),
    ];
    const winnerIndex = claimantStates.findIndex((state) =>
      state?.inventory.some((item) => item.sharedItemId === worldItemId));
    expect(winnerIndex).not.toBe(-1);
    expect(claimantStates.filter((state) =>
      state?.inventory.some((item) => item.sharedItemId === worldItemId))).toHaveLength(1);
    expect(projectWorldItems(await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      worldItemsStreamId(DEMO_WORLD_INSTANCE_ID),
    )).items[0]).toMatchObject({ locationId: null });
    const winnerPlayer = winnerIndex === 0 ? 'first-claimant' : 'second-claimant';
    const winnerCharacter = winnerIndex === 0 ? firstClaimant : secondClaimant;
    expect((await perform(
      engine,
      store,
      winnerPlayer,
      winnerCharacter,
      'drop-shared-loot',
      'character.drop',
      { itemId: worldItemId },
    )).receipt.ok).toBe(true);
    await engine.processPendingEffects();
    expect(projectWorldItems(await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      worldItemsStreamId(DEMO_WORLD_INSTANCE_ID),
    )).items[0]).toMatchObject({
      locationId: 'mossgate-clearing',
      holderCharacterId: null,
    });
    await engine.stop();
  });

  it('keeps quest-bound items and respawns without a drop when no carried item is droppable', async () => {
    const { engine, store } = makeHarness(false);
    await engine.start();
    const characterId = await createCharacter(engine, 'protected-player', 'Bramble');
    expect((await perform(engine, store, 'protected-player', characterId, 'take-quest-stone', 'character.take', {
      itemId: 'mossgate-loose-stone',
    })).receipt.ok).toBe(true);
    expect((await perform(engine, store, 'protected-player', characterId, 'lethal-hit-protected', 'combat.action', {
      action: 'attack',
      targetNpcId: 'mossgate-training-sentinel',
    })).receipt.ok).toBe(true);
    await engine.processPendingEffects();

    const character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(character).toMatchObject({
      locationId: 'stillwater-fountain',
      health: { current: 6, maximum: 6 },
      inventory: [{ id: 'mossgate-loose-stone', questBound: true }],
    });
    expect(projectWorldItems(await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      worldItemsStreamId(DEMO_WORLD_INSTANCE_ID),
    )).items).toHaveLength(0);
    await engine.stop();
  });

  it('returns unclaimed player-corpse contents to their owner when the recovery timer expires', async () => {
    let now = new Date('2026-10-19T12:00:00.000Z');
    const { engine, store } = makeHarness(true, () => now);
    await engine.start();
    const characterId = await createCharacter(engine, 'recovery-owner', 'Rill');
    expect((await perform(engine, store, 'recovery-owner', characterId, 'recovery-take-bead', 'character.take', {
      itemId: 'test-glass-bead',
    })).receipt.ok).toBe(true);
    expect((await perform(
      engine,
      store,
      'recovery-owner',
      characterId,
      'recovery-owner-lethal-hit',
      'combat.action',
      { action: 'attack', targetNpcId: 'mossgate-training-sentinel' },
    )).receipt.ok).toBe(true);
    await engine.processPendingEffects();

    const itemStreamId = worldItemsStreamId(DEMO_WORLD_INSTANCE_ID);
    const worldItems = projectWorldItems(await store.readStream(DEMO_WORLD_INSTANCE_ID, itemStreamId));
    const corpse = worldItems.corpses[0]!;
    expect(worldItems.items).toMatchObject([{
      containerId: corpse.corpseId,
      holderCharacterId: null,
      item: { label: 'Glass bead' },
    }]);

    now = new Date(Date.parse(corpse.expiresAt!) + 1);
    const expiration = await engine.dispatchSystem({
      type: 'world.object.expire',
      version: 1,
      commandId: 'player-corpse-expire',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      expectedVersion: 1,
      payload: { objectId: corpse.corpseId },
    }, SYSTEM_ACTOR_ID);
    expect(expiration.receipt.ok).toBe(true);
    await engine.processPendingEffects();

    const recovered = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId));
    expect(recovered?.inventory).toContainEqual(expect.objectContaining({
      sharedItemId: worldItems.items[0]!.worldItemId,
      label: 'Glass bead',
    }));
    expect(projectWorldItems(await store.readStream(DEMO_WORLD_INSTANCE_ID, itemStreamId)).corpses)
      .toEqual([]);
    expect((await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      objectLifecycleStreamId(corpse.corpseId),
    )).at(-1)?.type).toBe('world.object_expired');
    await engine.stop();
  });
});
