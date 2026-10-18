import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppendRequest, EventStorePort } from '@mudd/engine-core';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
const hasDatabase = Boolean(testDatabaseUrl);
const integrationDescribe = hasDatabase ? describe : describe.skip;

integrationDescribe('PostgresEventStore (real PostgreSQL)', () => {
  const worldInstanceId = `audit-test-${randomUUID()}`;
  const chatWorldInstanceId = `audit-chat-test-${randomUUID()}`;
  const characterId = randomUUID();
  const chatCharacterId = randomUUID();
  const playerId = randomUUID();
  const secondActorId = randomUUID();
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
    await db.insert(players).values({
      id: playerId,
      clerkUserId: `audit-test-${playerId}`,
      displayName: 'Integration Fixture',
    });
    store = new PostgresEventStore();
  });

  afterAll(async () => {
    if (!db || !pool) return;
    const { eq, inArray } = await import('drizzle-orm');
    const { characters, commandReceipts, gameEvents, players } = await import('./db/schema.js');
    try {
      const testWorlds = [worldInstanceId, chatWorldInstanceId];
      await db.delete(commandReceipts).where(inArray(commandReceipts.worldInstanceId, testWorlds));
      await db.delete(gameEvents).where(inArray(gameEvents.worldInstanceId, testWorlds));
      await db.delete(characters).where(eq(characters.playerId, playerId));
      await db.delete(players).where(eq(players.id, playerId));
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

  it('keeps room-chat membership and idempotency ordered with character movement', async () => {
    const { PostgresEventStore: EventStore } = await import('./persistence/postgres-event-store.js');
    const { createPlayerRoomChatMessage, listRoomChatMessages } = await import('./room-chat-service.js');
    const { characters, roomChatMessages, worldSessions } = await import('./db/schema.js');
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
    await db.delete(characters).where((await import('drizzle-orm')).eq(characters.id, chatCharacterId));
  });
});
