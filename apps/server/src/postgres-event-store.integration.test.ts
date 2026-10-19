import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppendRequest, EventStorePort } from '@mudd/engine-core';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
const hasDatabase = Boolean(testDatabaseUrl);
const integrationDescribe = hasDatabase ? describe : describe.skip;

integrationDescribe('PostgresEventStore (real PostgreSQL)', () => {
  const worldInstanceId = `audit-test-${randomUUID()}`;
  const chatWorldInstanceId = `audit-chat-test-${randomUUID()}`;
  const presenceWorldInstanceId = `audit-presence-test-${randomUUID()}`;
  const characterId = randomUUID();
  const chatCharacterId = randomUUID();
  const playerId = randomUUID();
  const secondActorId = randomUUID();
  const presencePlayerIds = [randomUUID(), randomUUID()] as const;
  let db: typeof import('./db/client.js').db;
  let pool: typeof import('./db/client.js').pool;
  let store: EventStorePort;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    ({ db, pool } = await import('./db/client.js'));
    const [{ players }, { PostgresEventStore }] = await Promise.all([
      import('./db/schema.js'),
      import('./persistence/postgres-event-store.js'),
    ]);
    await db.insert(players).values([
      {
        id: playerId,
        clerkUserId: `audit-test-${playerId}`,
        displayName: 'Integration Fixture',
      },
      ...presencePlayerIds.map((id, index) => ({
        id,
        clerkUserId: `audit-presence-${id}`,
        displayName: index === 0 ? 'Rowan' : 'Mira',
      })),
    ]);
    store = new PostgresEventStore();
  });

  afterAll(async () => {
    if (!db || !pool) return;
    const { inArray } = await import('drizzle-orm');
    const { characters, commandReceipts, durableEffects, gameEvents, players, worldSessions } = await import('./db/schema.js');
    try {
      const testWorlds = [worldInstanceId, chatWorldInstanceId, presenceWorldInstanceId];
      const testPlayers = [playerId, ...presencePlayerIds];
      await db.delete(durableEffects).where(inArray(durableEffects.worldInstanceId, testWorlds));
      await db.delete(commandReceipts).where(inArray(commandReceipts.worldInstanceId, testWorlds));
      await db.delete(gameEvents).where(inArray(gameEvents.worldInstanceId, testWorlds));
      await db.delete(worldSessions).where(inArray(worldSessions.playerId, testPlayers));
      await db.delete(characters).where(inArray(characters.playerId, testPlayers));
      await db.delete(players).where(inArray(players.id, testPlayers));
    } finally {
      await pool.end();
    }
  });

  it('persists, replays, and idempotently serializes concurrent command retries', async () => {
    const createRequest: AppendRequest = {
      worldInstanceId,
      streamId: characterId,
      actorId: playerId,
      commandId: `create-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{
        type: 'character.created',
        version: 1,
        payload: {
          characterId,
          playerId,
          name: 'Persistent',
          startingLocationId: 'mossgate-clearing',
        },
      }],
    };
    const created = await store.append(createRequest);
    expect(created.kind).toBe('committed');

    const takeItemRequest: AppendRequest = {
      worldInstanceId,
      streamId: characterId,
      actorId: playerId,
      commandId: `take-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      events: [{
        type: 'character.item_taken',
        version: 1,
        payload: {
          characterId,
          locationId: 'mossgate-clearing',
          item: {
            id: `item-${randomUUID()}`,
            label: 'Integration stone',
            description: 'A fixture item persisted by the PostgreSQL integration test.',
          },
        },
      }],
    };
    const [first, retry] = await Promise.all([
      store.append(takeItemRequest),
      store.append(takeItemRequest),
    ]);
    expect([first.kind, retry.kind].sort()).toEqual(['committed', 'duplicate']);

    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const { replayCharacter } = await import('@mudd/engine-core');
    const restartedStore = new PostgresEventStore();
    const replayed = replayCharacter(await restartedStore.readStream(worldInstanceId, characterId));
    expect(replayed?.revision).toBe(2);
    expect(replayed?.inventory).toHaveLength(1);

    const sameCommandOtherActor: AppendRequest = {
      worldInstanceId,
      streamId: `other-${randomUUID()}`,
      actorId: secondActorId,
      commandId: takeItemRequest.commandId,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'audit.actor-isolation', version: 1, payload: { ok: true } }],
    };
    expect((await restartedStore.append(sameCommandOtherActor)).kind).toBe('committed');
    expect(await restartedStore.readStream(worldInstanceId, sameCommandOtherActor.streamId)).toHaveLength(1);
    expect(await restartedStore.readStream('another-world-instance', characterId)).toHaveLength(0);
  });

  it('returns a revision conflict for competing writes to one stream', async () => {
    const streamId = `concurrent-${randomUUID()}`;
    const makeRequest = (commandId: string): AppendRequest => ({
      worldInstanceId,
      streamId,
      actorId: playerId,
      commandId,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'audit.concurrent', version: 1, payload: { commandId } }],
    });
    const results = await Promise.all([
      store.append(makeRequest(`concurrent-a-${randomUUID()}`)),
      store.append(makeRequest(`concurrent-b-${randomUUID()}`)),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['committed', 'conflict']);
  });

  it('commits event effects atomically, retries them after restart, and deduplicates their output', async () => {
    const { durableEffects } = await import('./db/schema.js');
    const commandId = `effect-command-${randomUUID()}`;
    const streamId = `effect-stream-${randomUUID()}`;
    const payloadHash = randomUUID();
    const effectKey = `command:${worldInstanceId}:${playerId}:${commandId}:0`;
    const blockerId = randomUUID();
    await db.insert(durableEffects).values({
      id: blockerId,
      worldInstanceId,
      sourceStreamId: streamId,
      causationCommandId: 'existing-effect',
      effectType: 'audit.test',
      effectVersion: 1,
      payload: { reason: 'force the append transaction to fail' },
      dedupeKey: effectKey,
    });

    const appendRequest: AppendRequest = {
      worldInstanceId,
      streamId,
      actorId: playerId,
      commandId,
      payloadHash,
      expectedVersion: 0,
      events: [{ type: 'audit.effect_source', version: 1, payload: { committed: true } }],
      effects: [{ type: 'audit.test', version: 1, payload: { message: 'deliver once' } }],
    };
    await expect(store.append(appendRequest)).rejects.toThrow();
    expect(await store.readStream(worldInstanceId, streamId)).toHaveLength(0);
    expect(await store.lookupCommand(worldInstanceId, playerId, commandId, payloadHash)).toBeUndefined();
    await db.delete(durableEffects).where((await import('drizzle-orm')).eq(durableEffects.id, blockerId));

    expect((await store.append(appendRequest)).kind).toBe('committed');
    expect((await store.append(appendRequest)).kind).toBe('duplicate');
    const restartedStore = new (await import('./persistence/postgres-event-store.js')).PostgresEventStore();
    const claimed = await restartedStore.claimNextEffect(60_000);
    expect(claimed).toMatchObject({
      worldInstanceId,
      sourceStreamId: streamId,
      causationCommandId: commandId,
      type: 'audit.test',
      version: 1,
      payload: { message: 'deliver once' },
      attempts: 1,
    });
    if (!claimed) throw new Error('Expected the event effect to be claimable after restarting the store.');

    expect(await store.claimNextEffect(60_000)).toBeUndefined();
    expect(await restartedStore.retryEffect(claimed.id, claimed.leaseToken, 0, 'simulated transient failure')).toBe(true);
    const retried = await store.claimNextEffect(60_000);
    expect(retried).toMatchObject({ id: claimed.id, attempts: 2 });
    if (!retried) throw new Error('Expected the event effect to be available for retry.');
    expect(await store.completeEffect(retried.id, retried.leaseToken)).toBe(true);
    expect(await restartedStore.claimNextEffect(60_000)).toBeUndefined();

    const persistedEffects = await db.select().from(durableEffects).where(
      (await import('drizzle-orm')).eq(durableEffects.dedupeKey, effectKey),
    );
    expect(persistedEffects).toHaveLength(1);
    expect(persistedEffects[0]).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it('enforces one active character session per account and world', async () => {
    const { characters, worldSessions } = await import('./db/schema.js');
    const firstCharacterId = randomUUID();
    const secondCharacterId = randomUUID();
    await db.insert(characters).values([
      { id: firstCharacterId, playerId, worldInstanceId, name: 'First' },
      { id: secondCharacterId, playerId, worldInstanceId, name: 'Second' },
    ]);
    await db.insert(worldSessions).values({
      id: randomUUID(),
      playerId,
      worldInstanceId,
      characterId: firstCharacterId,
    });
    await expect(db.insert(worldSessions).values({
      id: randomUUID(),
      playerId,
      worldInstanceId,
      characterId: secondCharacterId,
    })).rejects.toThrow();
  });

  it('derives two-account room presence and scopes heartbeat writes to the owning session', async () => {
    const { worldSessions } = await import('./db/schema.js');
    const { listRoomOccupants, touchWorldSessionPresence } = await import('./room-presence-service.js');
    const firstPlayerId = presencePlayerIds[0];
    const secondPlayerId = presencePlayerIds[1];
    const firstCharacterId = randomUUID();
    const secondCharacterId = randomUUID();
    const firstSessionId = randomUUID();
    const secondSessionId = randomUUID();
    const now = new Date();
    const stale = new Date(now.getTime() - 90_001);

    for (const character of [
      { id: firstCharacterId, playerId: firstPlayerId, name: 'Rowan' },
      { id: secondCharacterId, playerId: secondPlayerId, name: 'Mira' },
    ]) {
      const result = await store.append({
        worldInstanceId: presenceWorldInstanceId,
        streamId: character.id,
        actorId: character.playerId,
        commandId: `presence-create-${randomUUID()}`,
        payloadHash: randomUUID(),
        expectedVersion: 0,
        events: [{
          type: 'character.created',
          version: 1,
          payload: {
            characterId: character.id,
            playerId: character.playerId,
            name: character.name,
            startingLocationId: 'mossgate-clearing',
          },
        }],
      });
      expect(result.kind).toBe('committed');
    }

    await db.insert(worldSessions).values([
      {
        id: firstSessionId,
        playerId: firstPlayerId,
        worldInstanceId: presenceWorldInstanceId,
        characterId: firstCharacterId,
        lastSeenAt: now,
      },
      {
        id: secondSessionId,
        playerId: secondPlayerId,
        worldInstanceId: presenceWorldInstanceId,
        characterId: secondCharacterId,
        lastSeenAt: stale,
      },
    ]);

    expect(await listRoomOccupants(
      store,
      presenceWorldInstanceId,
      'mossgate-clearing',
      firstCharacterId,
      now,
    )).toEqual([]);

    expect(await touchWorldSessionPresence(
      firstPlayerId,
      presenceWorldInstanceId,
      secondSessionId,
      now,
    )).toBe(false);
    const { eq } = await import('drizzle-orm');
    const [notRefreshedByAnotherAccount] = await db.select({
      lastSeenAt: worldSessions.lastSeenAt,
    }).from(worldSessions).where(eq(worldSessions.id, secondSessionId));
    expect(notRefreshedByAnotherAccount?.lastSeenAt).toEqual(stale);

    expect(await touchWorldSessionPresence(
      secondPlayerId,
      presenceWorldInstanceId,
      secondSessionId,
      now,
    )).toBe(true);

    expect(await listRoomOccupants(
      store,
      presenceWorldInstanceId,
      'mossgate-clearing',
      firstCharacterId,
      now,
    )).toEqual([{ id: secondCharacterId, displayName: 'Mira' }]);
    expect(await listRoomOccupants(
      store,
      presenceWorldInstanceId,
      'mossgate-clearing',
      secondCharacterId,
      now,
    )).toEqual([{ id: firstCharacterId, displayName: 'Rowan' }]);

    const [firstSession] = await db.select().from(worldSessions).where(
      eq(worldSessions.id, firstSessionId),
    );
    expect(firstSession?.lastSeenAt).toEqual(now);
    expect(firstSession?.characterId).toBe(firstCharacterId);
  });

  it('keeps room-chat membership and idempotency ordered with character movement', async () => {
    const { PostgresEventStore: EventStore } = await import('./persistence/postgres-event-store.js');
    const { createPlayerRoomChatMessage, listRoomChatMessages } = await import('./room-chat-service.js');
    const { characters, durableEffects, roomChatMessages, worldSessions } = await import('./db/schema.js');
    const chatStore = new EventStore();

    await chatStore.append({
      worldInstanceId: chatWorldInstanceId,
      streamId: chatCharacterId,
      actorId: playerId,
      commandId: `chat-create-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{
        type: 'character.created',
        version: 1,
        payload: {
          characterId: chatCharacterId,
          playerId,
          name: 'Chat test',
          startingLocationId: 'mossgate-clearing',
        },
      }],
    });
    await db.insert(worldSessions).values({
      id: randomUUID(),
      playerId,
      worldInstanceId: chatWorldInstanceId,
      characterId: chatCharacterId,
    });

    const submissionId = randomUUID();
    const input = {
      worldInstanceId: chatWorldInstanceId,
      playerId,
      roomId: 'mossgate-clearing',
      characterId: chatCharacterId,
      clientMessageId: submissionId,
      text: 'I found the marker.',
    };
    const firstSubmission = await createPlayerRoomChatMessage(input);
    expect(firstSubmission.kind).toBe('created');
    const retrySubmission = await createPlayerRoomChatMessage(input);
    expect(retrySubmission.kind).toBe('duplicate');
    if (firstSubmission.kind !== 'created' || retrySubmission.kind !== 'duplicate') {
      throw new Error('Expected the repeated chat submission to return the original message.');
    }
    expect(retrySubmission.message.id).toBe(firstSubmission.message.id);
    expect(retrySubmission.effectId).toBe(firstSubmission.effectId);
    const chatEffects = await db.select().from(durableEffects).where(
      (await import('drizzle-orm')).eq(durableEffects.worldInstanceId, chatWorldInstanceId),
    );
    expect(chatEffects).toHaveLength(1);

    const movement = await chatStore.append({
      worldInstanceId: chatWorldInstanceId,
      streamId: chatCharacterId,
      actorId: playerId,
      commandId: `chat-move-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      events: [{
        type: 'character.moved',
        version: 1,
        payload: {
          characterId: chatCharacterId,
          fromLocationId: 'mossgate-clearing',
          toLocationId: 'glasswater-bridge',
          exitId: 'clearing-to-bridge',
        },
      }],
    });
    expect(movement.kind).toBe('committed');
    expect(await createPlayerRoomChatMessage({
      ...input,
      clientMessageId: randomUUID(),
    })).toEqual({ kind: 'unavailable' });
    expect(await listRoomChatMessages({
      worldInstanceId: chatWorldInstanceId,
      playerId,
      characterId: chatCharacterId,
      roomId: 'mossgate-clearing',
    })).toBeUndefined();
    expect(await listRoomChatMessages({
      worldInstanceId: chatWorldInstanceId,
      playerId,
      characterId: chatCharacterId,
      roomId: 'glasswater-bridge',
    })).toEqual([]);

    const persisted = await db.select().from(roomChatMessages).where(
      (await import('drizzle-orm')).eq(roomChatMessages.submissionId, submissionId),
    );
    expect(persisted).toHaveLength(1);
    const { publishNpcRoomMessage } = await import('./room-chat-service.js');
    const outputKey = `effect-output-${randomUUID()}`;
    const [firstNpcReply, retriedNpcReply] = await Promise.all([
      publishNpcRoomMessage({
        worldInstanceId: chatWorldInstanceId,
        roomId: 'glasswater-bridge',
        npcId: 'npc-effect-test',
        npcName: 'Fixture NPC',
        text: 'This reply survives a retry.',
        sourceEffectId: outputKey,
      }),
      publishNpcRoomMessage({
        worldInstanceId: chatWorldInstanceId,
        roomId: 'glasswater-bridge',
        npcId: 'npc-effect-test',
        npcName: 'Fixture NPC',
        text: 'This reply survives a retry.',
        sourceEffectId: outputKey,
      }),
    ]);
    expect(retriedNpcReply.id).toBe(firstNpcReply.id);
    await db.delete(characters).where((await import('drizzle-orm')).eq(characters.id, chatCharacterId));
  });
});
