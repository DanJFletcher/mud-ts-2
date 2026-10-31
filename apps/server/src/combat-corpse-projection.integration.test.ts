import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionContext } from '@mudd/contracts';
import {
  EngineHost,
  replayCharacter,
  type EnginePlugin,
} from '@mudd/engine-core';
import {
  characterPlugin,
  combatPlugin,
  combatRoomPresenceCapability,
  corpseLifecyclePlugin,
  groupsPlugin,
  interactionPlugin,
  merchantPlugin,
  movementPlugin,
  objectLifecyclePlugin,
  partyCombatPolicyPlugin,
  partyPlugin,
  partyQuestPlugin,
  roadTravelPlugin,
  teamCombatPlugin,
  worldItemsPlugin,
  worldItemsStreamId,
  ROOM_ANNOUNCEMENT_EFFECT,
  RoomAnnouncementEffectSchema,
} from '@mudd/core-plugins';
import { demoWorld } from '@mudd/world-demo';
import type { PostgresEventStore as PostgresEventStoreType } from './persistence/postgres-event-store.js';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

const roomAnnouncementTestPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.test-corpse-projection-room-announcements',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
  },
  register({ registerEffect }) {
    registerEffect(ROOM_ANNOUNCEMENT_EFFECT, 1, RoomAnnouncementEffectSchema, async () => {});
  },
};

const combatPresenceTestPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.test-corpse-projection-combat-presence',
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

integrationDescribe('immediate corpse command projections (PostgreSQL)', () => {
  const worldInstanceId = `corpse-projection-${randomUUID()}`;
  const playerId = randomUUID();
  let db: typeof import('./db/client.js').db;
  let pool: typeof import('./db/client.js').pool;
  let store: PostgresEventStoreType;
  let engine: EngineHost;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    ({ db, pool } = await import('./db/client.js'));
    const [{ players }, { PostgresEventStore }] = await Promise.all([
      import('./db/schema.js'),
      import('./persistence/postgres-event-store.js'),
    ]);
    await db.insert(players).values({
      id: playerId,
      clerkUserId: `corpse-projection-${playerId}`,
      displayName: 'Combat projection fixture',
    });
    store = new PostgresEventStore();

    const world = structuredClone(demoWorld);
    const sentinel = world.locations
      .find((location) => location.id === 'mossgate-clearing')
      ?.npcs?.find((npc) => npc.id === 'mossgate-training-sentinel');
    if (!sentinel) throw new Error('The combat projection fixture has no training sentinel.');
    sentinel.loot = {
      items: [{
        id: 'projection-test-badge',
        label: 'Practice badge',
        description: 'A small wooden badge.',
      }],
      currencyAmount: 3,
    };

    engine = new EngineHost([
      worldItemsPlugin,
      objectLifecyclePlugin,
      corpseLifecyclePlugin,
      roomAnnouncementTestPlugin,
      characterPlugin,
      groupsPlugin,
      partyPlugin,
      partyQuestPlugin,
      interactionPlugin,
      combatPlugin,
      combatPresenceTestPlugin,
      partyCombatPolicyPlugin,
      teamCombatPlugin,
      movementPlugin,
      roadTravelPlugin,
      merchantPlugin,
    ], store, {
      canAccessInstance: async () => true,
      ownsCharacter: async () => true,
    }, world);
    await engine.start();
  });

  afterAll(async () => {
    if (!db || !pool) return;
    const { eq } = await import('drizzle-orm');
    const {
      characters,
      commandReceipts,
      durableEffects,
      gameEvents,
      players,
      worldObjectLifecycles,
    } = await import('./db/schema.js');
    try {
      await engine?.stop();
      await db.delete(durableEffects).where(eq(durableEffects.worldInstanceId, worldInstanceId));
      await db.delete(worldObjectLifecycles).where(eq(worldObjectLifecycles.worldInstanceId, worldInstanceId));
      await db.delete(commandReceipts).where(eq(commandReceipts.worldInstanceId, worldInstanceId));
      await db.delete(gameEvents).where(eq(gameEvents.worldInstanceId, worldInstanceId));
      await db.delete(characters).where(eq(characters.playerId, playerId));
      await db.delete(players).where(eq(players.id, playerId));
    } finally {
      await pool.end();
    }
  });

  it('settles the winning combat corpse before the projection reads it, including its loot', async () => {
    const session: SessionContext = {
      sessionId: randomUUID(),
      playerId,
      actorId: playerId,
      worldInstanceId,
      grantedPermissions: [],
      authenticated: true,
    };
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: randomUUID(),
      worldInstanceId,
      payload: { name: 'Test combatant' },
    }, session);
    expect(created.receipt.ok).toBe(true);
    const characterId = created.streamId!;

    const describeRoom = () => engine.query({
      type: 'location.describe',
      version: 1,
      queryId: randomUUID(),
      worldInstanceId,
      characterId,
      payload: {},
    }, session);

    // Warm both the shared-world read path and the room projection before combat.
    await store.readStream(worldInstanceId, worldItemsStreamId(worldInstanceId));
    const emptyRoom = await describeRoom();
    expect(emptyRoom.ok && emptyRoom.value.objects?.some((object) =>
      object.containerKind === 'corpse')).toBe(false);

    const victory = await store.withCommandReadCache(worldInstanceId, characterId, async () => {
      let characterEvents = await store.readStream(worldInstanceId, characterId);
      let character = replayCharacter(characterEvents)!;
      let finalResult: Awaited<ReturnType<EngineHost['dispatch']>>;
      let action = 0;
      do {
        finalResult = await engine.dispatch({
          type: 'combat.action',
          version: 1,
          commandId: `corpse-victory-${++action}-${randomUUID()}`,
          worldInstanceId,
          characterId,
          expectedVersion: character.revision,
          payload: character.combat?.status === 'active'
            ? { action: 'attack', encounterId: character.combat.encounterId }
            : { action: 'attack', targetNpcId: 'mossgate-training-sentinel' },
        }, session);
        expect(finalResult.receipt.ok).toBe(true);
        characterEvents = await store.readStream(worldInstanceId, characterId);
        character = replayCharacter(characterEvents)!;
      } while (character.combat?.status !== 'victory');
      return finalResult;
    });

    expect(victory.completingEffects).toBe(1);
    expect(await engine.settleCommandEffects(session, victory)).toBe(true);

    const room = await describeRoom();
    expect(room.ok).toBe(true);
    if (!room.ok) throw new Error('The room projection failed after combat victory.');
    const corpse = room.value.objects.find((object) => object.containerKind === 'corpse');
    expect(corpse).toMatchObject({
      label: 'Practice Sentinel’s corpse',
      contents: expect.arrayContaining([
        expect.objectContaining({ label: 'Practice badge' }),
        expect.objectContaining({ label: `3 ${demoWorld.currency!.name}` }),
      ]),
    });
    expect((await store.readStream(worldInstanceId, worldItemsStreamId(worldInstanceId)))
      .some((event) => event.type === 'world.corpse_created')).toBe(true);
  });
});
