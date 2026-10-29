import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppendRequest, EventStorePort } from '@mudd/engine-core';
import { newMeasurements, requestMeasurements } from './performance.js';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
const hasDatabase = Boolean(testDatabaseUrl);
const integrationDescribe = hasDatabase ? describe : describe.skip;

integrationDescribe('PostgresEventStore (real PostgreSQL)', () => {
  const worldInstanceId = `audit-test-${randomUUID()}`;
  const chatWorldInstanceId = `audit-chat-test-${randomUUID()}`;
  const presenceWorldInstanceId = `audit-presence-test-${randomUUID()}`;
  const cacheWorldInstanceId = `audit-cache-test-${randomUUID()}`;
  const appendBatchWorldInstanceId = `audit-append-batch-${randomUUID()}`;
  const lifecycleWorldInstanceId = `audit-lifecycle-${randomUUID()}`;
  const characterId = randomUUID();
  const cacheCharacterId = randomUUID();
  const chatCharacterId = randomUUID();
  const playerId = randomUUID();
  let guestPlayerId: string | undefined;
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
        clerkUserId: index === 0 ? `audit-presence-${id}` : null,
        displayName: index === 0 ? 'Rowan' : 'Mira',
      })),
    ]);
    store = new PostgresEventStore();
  });

  afterAll(async () => {
    if (!db || !pool) return;
    const { inArray } = await import('drizzle-orm');
    const {
      characters,
      commandReceipts,
      durableEffects,
      gameEvents,
      players,
      worldObjectLifecycles,
      worldSessions,
    } = await import('./db/schema.js');
    try {
      const testWorlds = [
        worldInstanceId,
        chatWorldInstanceId,
        presenceWorldInstanceId,
        cacheWorldInstanceId,
        appendBatchWorldInstanceId,
        lifecycleWorldInstanceId,
      ];
      const testPlayers = [playerId, ...presencePlayerIds, ...(guestPlayerId ? [guestPlayerId] : [])];
      await db.delete(durableEffects).where(inArray(durableEffects.worldInstanceId, testWorlds));
      await db.delete(worldObjectLifecycles).where(inArray(worldObjectLifecycles.worldInstanceId, testWorlds));
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

  it('writes appended events and their command receipt in one database round trip', async () => {
    const streamId = randomUUID();
    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const appendStore = new PostgresEventStore();
    const created = await appendStore.append({
      worldInstanceId: appendBatchWorldInstanceId,
      streamId,
      actorId: playerId,
      commandId: `append-batch-create-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{
        type: 'character.created',
        version: 1,
        payload: {
          characterId: streamId,
          playerId,
          name: 'Append batch fixture',
          startingLocationId: 'mossgate-clearing',
        },
      }],
    });
    expect(created.kind).toBe('committed');
    const request: AppendRequest = {
      worldInstanceId: appendBatchWorldInstanceId,
      streamId,
      actorId: playerId,
      commandId: `append-batch-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      events: [{
        type: 'character.item_taken',
        version: 1,
        payload: {
          characterId: streamId,
          locationId: 'mossgate-clearing',
          item: {
            id: `item-${randomUUID()}`,
            label: 'Append batch fixture item',
            description: 'A test item for command append instrumentation.',
          },
        },
      }],
    };
    await appendStore.readStreams(appendBatchWorldInstanceId, [streamId]);
    const unscopedMetrics = newMeasurements('append-batch-query-count-unscoped');
    const unscoped = await requestMeasurements.run(unscopedMetrics, () => appendStore.append(request));
    const unscopedAppendQueries = unscopedMetrics.databaseOperations['event_store.command_append']?.queries;

    const scopedRequest: AppendRequest = {
      ...request,
      commandId: `append-batch-scoped-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 2,
      events: [{
        type: 'character.item_taken',
        version: 1,
        payload: {
          characterId: streamId,
          locationId: 'mossgate-clearing',
          item: {
            id: `item-${randomUUID()}`,
            label: 'Scoped append fixture item',
            description: 'A second item for scoped append instrumentation.',
          },
        },
      }],
    };
    const scopedMetrics = newMeasurements('append-batch-query-count-scoped');
    const scoped = await requestMeasurements.run(scopedMetrics, () =>
      appendStore.withCommandReadCache(appendBatchWorldInstanceId, streamId, async () => {
        await appendStore.readStreams(appendBatchWorldInstanceId, [streamId]);
        return appendStore.append(scopedRequest);
      }, 2));

    expect(unscoped.kind).toBe('committed');
    expect(scoped.kind).toBe('committed');
    expect(unscopedAppendQueries).toBe(9);
    expect(scopedMetrics.databaseOperations['event_store.command_append']?.queries)
      .toBe(unscopedAppendQueries! - 1);
    const history = await appendStore.readStream(appendBatchWorldInstanceId, request.streamId);
    expect(history).toHaveLength(3);
    expect(history[1]).toMatchObject({ type: 'character.item_taken', aggregateVersion: 2 });
    expect(history[2]).toMatchObject({ type: 'character.item_taken', aggregateVersion: 3 });
    expect((await appendStore.lookupCommand(
      appendBatchWorldInstanceId, playerId, scopedRequest.commandId, scopedRequest.payloadHash,
    ))?.receipt).toEqual(scoped.receipt);
  });

  it('incrementally replays history above the old byte ceiling, then rebuilds safely after eviction', async () => {
    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const { replayCharacter, replayCharacterUncached } = await import('@mudd/engine-core');
    const reader = new PostgresEventStore(), writer = new PostgresEventStore();
    const id = randomUUID();
    const base = { worldInstanceId, streamId: id, actorId: playerId,
      commandId: randomUUID(), payloadHash: randomUUID(), expectedVersion: 0,
      events: [{ type: 'character.created', version: 1, payload: {
        characterId: id, playerId, name: 'Large history', startingLocationId: 'mossgate-clearing',
      } }],
    };
    expect((await writer.append(base)).kind).toBe('committed');
    expect((await writer.append({ ...base, commandId: randomUUID(), expectedVersion: 1,
      events: Array.from({ length: 2000 }, (_, i) => ({
        type: 'character.renamed', version: 1, payload: { characterId: id, name: `Long history ${i}` },
      })),
    })).kind).toBe('committed');
    const first = await reader.readStream(worldInstanceId, id);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeGreaterThan(512 * 1024);
    expect(replayCharacter(first)).toEqual(replayCharacterUncached(first));
    expect(await reader.readStream(worldInstanceId, id)).toBe(first);
    const change = { ...base, commandId: randomUUID(), expectedVersion: 2001,
      events: [{ type: 'character.renamed', version: 1, payload: { characterId: id, name: 'Other process' } }],
    };
    expect((await writer.append(change)).kind).toBe('committed');
    const updated = await reader.readStream(worldInstanceId, id);
    expect(updated[0]).toBe(first[0]);
    expect(replayCharacter(updated)).toEqual(replayCharacterUncached(updated));
    expect(replayCharacter(updated)?.name).toBe('Other process');
    expect((await reader.append({ ...change, commandId: randomUUID() })).kind).toBe('conflict');
    for (let i = 0; i < 129; i++) {
      const streamId = `eviction-${i}`;
      await writer.append({ ...base, streamId, commandId: randomUUID(),
        events: [{ type: 'audit.eviction', version: 1, payload: {} }],
      });
      await reader.readStream(worldInstanceId, streamId);
    }
    const rebuilt = await reader.readStream(worldInstanceId, id);
    expect(rebuilt).not.toBe(updated);
    expect(replayCharacter(rebuilt)).toEqual(replayCharacterUncached(updated));
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

  it('keeps cached stream histories fresh across store instances and reads heads without payload history', async () => {
    const streamId = `revision-cache-${randomUUID()}`;
    const firstRequest: AppendRequest = {
      worldInstanceId,
      streamId,
      actorId: playerId,
      commandId: `cache-first-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'cache.fixture', version: 1, payload: { index: 1 } }],
    };
    await store.append(firstRequest);
    expect(await store.readStream(worldInstanceId, streamId)).toHaveLength(1);

    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const independentStore = new PostgresEventStore();
    await independentStore.append({
      ...firstRequest,
      commandId: `cache-second-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      events: [{ type: 'cache.fixture', version: 1, payload: { index: 2 } }],
    });

    expect(await store.readStreamRevision(worldInstanceId, streamId)).toBe(2);
    const refreshed = await store.readStream(worldInstanceId, streamId);
    expect(refreshed.map((event) => event.aggregateVersion)).toEqual([1, 2]);
    expect(refreshed.map((event) => event.payload.index)).toEqual([1, 2]);
  });

  it('batch-reads event streams and refreshes a cached batch after another store appends', async () => {
    const streamIds = [0, 1, 2].map(() => `world-npc:${randomUUID()}`);
    const requests: AppendRequest[] = streamIds.map((streamId, index) => ({
      worldInstanceId,
      streamId,
      actorId: playerId,
      commandId: `batch-read-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'batch.fixture', version: 1, payload: { index } }],
    }));
    for (const request of requests) expect((await store.append(request)).kind).toBe('committed');
    if (!store.readStreams) throw new Error('Event store does not support batched stream reads.');

    const firstBatch = await store.readStreams(worldInstanceId, streamIds);
    expect(streamIds.map((id) => firstBatch.get(id)?.[0]?.payload.index)).toEqual([0, 1, 2]);

    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const independentStore = new PostgresEventStore();
    const cachedBatch = await independentStore.readStreams(worldInstanceId, streamIds);
    expect(streamIds.map((id) => cachedBatch.get(id)?.length)).toEqual([1, 1, 1]);

    const changedStreamId = streamIds[1]!;
    const changedRequest = requests[1]!;
    expect((await store.append({
      ...changedRequest,
      commandId: `batch-update-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      events: [{ type: 'batch.fixture', version: 1, payload: { index: 99 } }],
    })).kind).toBe('committed');

    const refreshedBatch = await independentStore.readStreams(worldInstanceId, streamIds);
    expect(refreshedBatch.get(changedStreamId)?.map((event) => event.payload.index)).toEqual([1, 99]);
  });

  it('atomically commits shared turns and character debits, including duplicate retries and racing resources', async () => {
    const resourceStream = `resource-${randomUUID()}`;
    const firstTurn = `turn-${randomUUID()}`;
    const secondTurn = `turn-${randomUUID()}`;
    const request = (streamId: string): AppendRequest => ({
      worldInstanceId, actorId: playerId, commandId: `ability-${randomUUID()}`, payloadHash: randomUUID(),
      streamId, expectedVersion: 0,
      events: [{ type: 'audit.turn', version: 1, payload: { damage: 4 } }],
      companions: [{ streamId: resourceStream, expectedVersion: 0,
        events: [{ type: 'audit.resource', version: 1, payload: { remaining: 80 } }] }],
    });
    const a = request(firstTurn);
    const b = request(secondTurn);
    const outcomes = await Promise.all([store.append(a), store.append(b)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['committed', 'conflict']);
    expect(await store.readStream(worldInstanceId, resourceStream)).toHaveLength(1);
    const winner = outcomes[0]!.kind === 'committed' ? a : b;
    const loser = winner === a ? b : a;
    expect(await store.readStream(worldInstanceId, loser.streamId)).toHaveLength(0);
    expect((await store.append(winner)).kind).toBe('duplicate');
    expect(await store.readStream(worldInstanceId, resourceStream)).toHaveLength(1);
  });

  it('checks guarded heads and commits multiple companion streams atomically across retries', async () => {
    const primaryStream = `guarded-primary-${randomUUID()}`;
    const observedStream = `guarded-observed-${randomUUID()}`;
    const companionStreams = [0, 1].map(() => `guarded-companion-${randomUUID()}`);
    expect((await store.append({
      worldInstanceId,
      streamId: observedStream,
      actorId: playerId,
      commandId: `guard-seed-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'audit.guard_seed', version: 1, payload: { current: true } }],
    })).kind).toBe('committed');

    const request: AppendRequest = {
      worldInstanceId,
      streamId: primaryStream,
      actorId: playerId,
      commandId: `guarded-append-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'audit.guarded_primary', version: 1, payload: { committed: true } }],
      guards: [{ streamId: observedStream, expectedVersion: 1 }],
      companions: companionStreams.map((streamId, index) => ({
        streamId,
        expectedVersion: 0,
        events: [{ type: 'audit.guarded_companion', version: 1, payload: { index } }],
      })),
    };
    const retries = await Promise.all([store.append(request), store.append(request)]);
    expect(retries.map((result) => result.kind).sort()).toEqual(['committed', 'duplicate']);
    expect(await store.readStream(worldInstanceId, primaryStream)).toHaveLength(1);
    const companionEvents = await Promise.all(companionStreams.map((streamId) =>
      store.readStream(worldInstanceId, streamId)));
    expect(companionEvents.map((events) => events.length)).toEqual([1, 1]);
    expect(companionEvents.map((events) => events[0]?.payload.index)).toEqual([0, 1]);

    expect((await store.append({
      ...request,
      commandId: `guarded-stale-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      guards: [{ streamId: observedStream, expectedVersion: 0 }],
    })).kind).toBe('conflict');
    expect(await store.readStream(worldInstanceId, primaryStream)).toHaveLength(1);
    const afterConflict = await Promise.all(companionStreams.map((streamId) =>
      store.readStream(worldInstanceId, streamId)));
    expect(afterConflict.map((events) => events.length)).toEqual([1, 1]);
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
      companions: [{ streamId: `companion-${streamId}`, expectedVersion: 0,
        events: [{ type: 'audit.resource_debit', version: 1, payload: { remaining: 80 } }] }],
      effects: [{ type: 'audit.test', version: 1, payload: { message: 'deliver once' } }],
    };
    await expect(store.append(appendRequest)).rejects.toThrow();
    expect(await store.readStream(worldInstanceId, streamId)).toHaveLength(0);
    expect(await store.readStream(worldInstanceId, `companion-${streamId}`)).toHaveLength(0);
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

  it('recovers due lifecycle work after a store restart and an expired worker lease', async () => {
    const { SYSTEM_ACTOR_ID } = await import('@mudd/engine-core');
    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const objectId = `temporary-campfire:${randomUUID()}`;
    const lifecycleStreamId = `world-object-lifecycle:${objectId}`;
    const createdAt = new Date('2026-10-27T10:00:00.000Z');
    const expiresAt = new Date(createdAt.getTime() + 1_000);
    const scheduled = await store.append({
      worldInstanceId: lifecycleWorldInstanceId,
      streamId: lifecycleStreamId,
      actorId: SYSTEM_ACTOR_ID,
      commandId: `schedule-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{
        type: 'world.object_lifecycle_scheduled',
        version: 1,
        payload: {
          objectId,
          objectType: 'campfire',
          locationId: 'mossgate-clearing',
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      }],
    });
    expect(scheduled.kind).toBe('committed');

    const firstPollAt = new Date(expiresAt.getTime() + 1);
    const firstWorker = new PostgresEventStore();
    const firstClaim = await firstWorker.claimDueObjectLifecycles(
      lifecycleWorldInstanceId,
      firstPollAt,
      1,
      5_000,
    );
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({ objectId, revision: 1 });

    // A new store instance observes the persistent lease and cannot double-process the object.
    const restartedWorker = new PostgresEventStore();
    await expect(restartedWorker.claimDueObjectLifecycles(
      lifecycleWorldInstanceId,
      firstPollAt,
      1,
      5_000,
    )).resolves.toEqual([]);

    // Once the lease deadline passes, another worker can safely reclaim the same due revision.
    const afterLeaseExpiry = new Date(firstPollAt.getTime() + 5_001);
    const recoveredClaim = await restartedWorker.claimDueObjectLifecycles(
      lifecycleWorldInstanceId,
      afterLeaseExpiry,
      1,
      5_000,
    );
    expect(recoveredClaim).toHaveLength(1);
    expect(recoveredClaim[0]).toMatchObject({ objectId, revision: 1 });
    expect(recoveredClaim[0]?.leaseToken).not.toBe(firstClaim[0]?.leaseToken);
  });

  it('persists shared corpse events under the stable UUID system actor', async () => {
    const { SYSTEM_ACTOR_ID } = await import('@mudd/engine-core');
    const commandId = `world-corpse-create:${randomUUID()}`;
    const corpseId = `corpse:${randomUUID()}`;
    const request: AppendRequest = {
      worldInstanceId,
      streamId: 'world-items',
      actorId: SYSTEM_ACTOR_ID,
      commandId,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{
        type: 'world.corpse_created',
        version: 1,
        payload: {
          corpse: {
            corpseId,
            encounterId: randomUUID(),
            opponentId: 'practice-sentinel',
            opponentName: 'Practice Sentinel',
            label: 'Practice Sentinel’s corpse',
            description: 'The body of Practice Sentinel lies here.',
            locationId: 'mossgate-clearing',
            currencyAmount: 0,
            goldClaimed: false,
          },
          items: [],
        },
      }],
    };

    expect((await store.append(request)).kind).toBe('committed');
    expect((await store.lookupCommand(
      worldInstanceId,
      SYSTEM_ACTOR_ID,
      commandId,
      request.payloadHash,
    ))?.kind).toBe('duplicate');
    expect((await store.readStream(worldInstanceId, 'world-items'))[0]).toMatchObject({
      type: 'world.corpse_created',
      actorId: SYSTEM_ACTOR_ID,
      payload: { corpse: { corpseId } },
    });
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

  it('creates a cookie-backed guest identity and upgrades it without losing its character ownership', async () => {
    process.env.SESSION_SECRET ??= randomUUID();
    const { createGuestIdentity, getAccountIdentity } = await import('./session-service.js');
    const { characters, players, sessions } = await import('./db/schema.js');
    const guest = await createGuestIdentity({ headers: {} });
    guestPlayerId = guest.identity.playerId;
    expect(guest.identity.isGuest).toBe(true);
    expect(guest.setCookie).toMatch(/^mudd_guest=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict;/);
    expect(guest.setCookie).not.toContain(guest.identity.playerId);

    const guestCharacterId = randomUUID();
    await db.insert(characters).values({
      id: guestCharacterId,
      playerId: guestPlayerId,
      worldInstanceId: 'mudd-demo-instance',
      name: 'Guest Traveler',
    });

    const cookie = guest.setCookie!.split(';', 1)[0]!;
    const resumed = await createGuestIdentity({ headers: { cookie } });
    expect(resumed.identity.playerId).toBe(guestPlayerId);
    expect(resumed.setCookie).toBeUndefined();

    const recovered = await getAccountIdentity(
      { headers: { cookie } },
      { userId: null, sessionId: null },
    );
    expect(recovered).toMatchObject({
      playerId: guestPlayerId,
      isGuest: true,
      clearGuestCookie: false,
    });

    const upgraded = await getAccountIdentity(
      { headers: { cookie } },
      { userId: `guest-upgrade-${randomUUID()}`, sessionId: 'clerk-session' },
    );
    expect(upgraded).toMatchObject({
      playerId: guestPlayerId,
      isGuest: false,
      clearGuestCookie: true,
    });

    const [retainedCharacter] = await db.select().from(characters)
      .where((await import('drizzle-orm')).eq(characters.id, guestCharacterId));
    const [claimedPlayer] = await db.select().from(players)
      .where((await import('drizzle-orm')).eq(players.id, guestPlayerId));
    const remainingSessions = await db.select().from(sessions)
      .where((await import('drizzle-orm')).eq(sessions.playerId, guestPlayerId));
    expect(retainedCharacter?.playerId).toBe(guestPlayerId);
    expect(claimedPlayer?.clerkUserId).toMatch(/^guest-upgrade-/);
    expect(remainingSessions).toHaveLength(0);
  });

  it('shows guest and signed-in players to each other and scopes heartbeat writes to each session owner', async () => {
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

  it('rebuilds room read models and refuses authorization from stale projections', async () => {
    const { eq, and } = await import('drizzle-orm');
    const { roomCharacterStates, worldSessions } = await import('./db/schema.js');
    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const { listRoomChatMessages } = await import('./room-chat-service.js');
    const { replayCharacter } = await import('@mudd/engine-core');
    const id = randomUUID();
    await store.append({
      worldInstanceId, streamId: id, actorId: playerId,
      commandId: randomUUID(), payloadHash: randomUUID(), expectedVersion: 0,
      events: [{ type: 'character.created', version: 1, payload: {
        characterId: id, playerId, name: 'Read model', startingLocationId: 'read-room',
      } }],
    });
    // A separate world avoids the other fixtures' active-session uniqueness.
    await db.delete(worldSessions).where(and(eq(worldSessions.playerId, playerId),
      eq(worldSessions.worldInstanceId, worldInstanceId)));
    await db.insert(worldSessions).values({
      id: randomUUID(), playerId, characterId: id, worldInstanceId,
    });
    const read = () => listRoomChatMessages({
      worldInstanceId, playerId, characterId: id, roomId: 'read-room',
    });
    expect(await read()).toBeDefined();
    await db.update(roomCharacterStates).set({ revision: 0 }).where(eq(roomCharacterStates.characterId, id));
    expect(await read()).toBeUndefined();
    const restarted = new PostgresEventStore();
    await restarted.rebuildRoomStates(worldInstanceId, id);
    expect(await read()).toBeDefined();
    const [row] = await db.select().from(roomCharacterStates).where(eq(roomCharacterStates.characterId, id));
    const replay = replayCharacter(await restarted.readStream(worldInstanceId, id))!;
    expect(row?.state.locationId).toBe(replay.locationId);
    expect(row?.revision).toBe(replay.revision);
    await db.delete(worldSessions).where(eq(worldSessions.characterId, id));
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
    const authorHistory = await listRoomChatMessages({
      worldInstanceId: chatWorldInstanceId,
      playerId,
      characterId: chatCharacterId,
      roomId: 'mossgate-clearing',
    });
    expect(authorHistory?.messages.find((message) => message.id === firstSubmission.message.id))
      .toMatchObject({ submissionId });
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
    })).toEqual({ messages: [], terminalEvents: [], cursor: 0 });

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
      }, 1),
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
    const movementNotice = await publishNpcRoomMessage({
      worldInstanceId: chatWorldInstanceId,
      roomId: 'glasswater-bridge',
      npcId: 'npc-effect-test',
      npcName: 'Fixture NPC',
      text: 'The NPC leaves.',
      sourceEffectId: `world-npc-movement:${randomUUID()}:departure`,
    });
    const lifecycleNotice = await publishNpcRoomMessage({
      worldInstanceId: chatWorldInstanceId,
      roomId: 'glasswater-bridge',
      npcId: 'room:glasswater-bridge',
      npcName: 'The room',
      text: 'The remains of a bandit crumble into dust.',
      sourceEffectId: `world-room-announcement:${randomUUID()}`,
    });
    const chatHistory = await listRoomChatMessages({
      worldInstanceId: chatWorldInstanceId,
      playerId,
      characterId: chatCharacterId,
      roomId: 'glasswater-bridge',
    });
    expect(chatHistory?.messages.some((message) => message.id === movementNotice.id)).toBe(false);
    expect(chatHistory?.cursor).toBe(lifecycleNotice.id);
    const liveMessages = await listRoomChatMessages({
      worldInstanceId: chatWorldInstanceId,
      playerId,
      characterId: chatCharacterId,
      roomId: 'glasswater-bridge',
      afterId: movementNotice.id - 1,
    });
    expect(liveMessages?.terminalEvents.some((message) => message.id === movementNotice.id)).toBe(true);
    expect(liveMessages?.messages.some((message) => message.id === lifecycleNotice.id)).toBe(false);
    expect(liveMessages?.terminalEvents.some((message) => message.id === lifecycleNotice.id)).toBe(true);
    await db.delete(characters).where((await import('drizzle-orm')).eq(characters.id, chatCharacterId));
  });

  it('reuses one character head within a command but still rejects a stale append', async () => {
    const { PostgresEventStore } = await import('./persistence/postgres-event-store.js');
    const scopedStore = new PostgresEventStore();
    const created = await scopedStore.append({
      worldInstanceId: cacheWorldInstanceId,
      streamId: cacheCharacterId,
      actorId: playerId,
      commandId: `cache-create-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{
        type: 'character.created',
        version: 1,
        payload: {
          characterId: cacheCharacterId,
          playerId,
          name: 'Cache fixture',
          startingLocationId: 'mossgate-clearing',
        },
      }],
    });
    expect(created.kind).toBe('committed');

    const metrics = newMeasurements('command-read-cache-test');
    const result = await requestMeasurements.run(metrics, () =>
      scopedStore.withCommandReadCache(cacheWorldInstanceId, cacheCharacterId, async () => {
        const before = await scopedStore.readStream(cacheWorldInstanceId, cacheCharacterId);
        const revision = await scopedStore.readStreamRevision(cacheWorldInstanceId, cacheCharacterId);
        expect(revision).toBe(before.at(-1)?.aggregateVersion);

        const concurrentWrite = await new PostgresEventStore().append({
          worldInstanceId: cacheWorldInstanceId,
          streamId: cacheCharacterId,
          actorId: playerId,
          commandId: `cache-concurrent-${randomUUID()}`,
          payloadHash: randomUUID(),
          expectedVersion: revision,
          events: [{
            type: 'character.renamed',
            version: 1,
            payload: { characterId: cacheCharacterId, name: 'Concurrent writer' },
          }],
        });
        expect(concurrentWrite.kind).toBe('committed');

        const staleWrite = await scopedStore.append({
          worldInstanceId: cacheWorldInstanceId,
          streamId: cacheCharacterId,
          actorId: playerId,
          commandId: `cache-stale-${randomUUID()}`,
          payloadHash: randomUUID(),
          expectedVersion: revision,
          events: [{
            type: 'character.renamed',
            version: 1,
            payload: { characterId: cacheCharacterId, name: 'Stale writer' },
          }],
        });
        expect(staleWrite.kind).toBe('conflict');

        const refreshed = await scopedStore.readStream(cacheWorldInstanceId, cacheCharacterId);
        expect(refreshed.at(-1)?.aggregateVersion).toBe(revision + 1);
        const appended = await scopedStore.append({
          worldInstanceId: cacheWorldInstanceId,
          streamId: cacheCharacterId,
          actorId: playerId,
          commandId: `cache-rename-${randomUUID()}`,
          payloadHash: randomUUID(),
          expectedVersion: revision + 1,
          events: [{
            type: 'character.renamed',
            version: 1,
            payload: { characterId: cacheCharacterId, name: 'Cache fixture renamed' },
          }],
        });
        expect(appended.kind).toBe('committed');
        return scopedStore.readStream(cacheWorldInstanceId, cacheCharacterId);
      }),
    );

    expect(result.at(-1)?.aggregateVersion).toBe(3);
    expect(metrics.databaseOperations['event_store.stream_revision_lookup']?.calls).toBe(2);

    const newerExpectedMetrics = newMeasurements('command-read-cache-newer-version-test');
    const newerExpected = await requestMeasurements.run(newerExpectedMetrics, () =>
      scopedStore.withCommandReadCache(cacheWorldInstanceId, cacheCharacterId, async () => {
        const initial = await scopedStore.readStream(cacheWorldInstanceId, cacheCharacterId);
        expect(initial.at(-1)?.aggregateVersion).toBe(3);

        const concurrentWrite = await new PostgresEventStore().append({
          worldInstanceId: cacheWorldInstanceId,
          streamId: cacheCharacterId,
          actorId: playerId,
          commandId: `cache-ahead-${randomUUID()}`,
          payloadHash: randomUUID(),
          expectedVersion: 3,
          events: [{
            type: 'character.renamed',
            version: 1,
            payload: { characterId: cacheCharacterId, name: 'Newer server revision' },
          }],
        });
        expect(concurrentWrite.kind).toBe('committed');

        const currentRevision = await scopedStore.readStreamRevision(cacheWorldInstanceId, cacheCharacterId);
        expect(currentRevision).toBe(4);
        const current = await scopedStore.readStream(cacheWorldInstanceId, cacheCharacterId);
        expect(current.at(-1)?.aggregateVersion).toBe(4);
        const accepted = await scopedStore.append({
          worldInstanceId: cacheWorldInstanceId,
          streamId: cacheCharacterId,
          actorId: playerId,
          commandId: `cache-ahead-accept-${randomUUID()}`,
          payloadHash: randomUUID(),
          expectedVersion: currentRevision,
          events: [{
            type: 'character.renamed',
            version: 1,
            payload: { characterId: cacheCharacterId, name: 'Accepted at current revision' },
          }],
        });
        expect(accepted.kind).toBe('committed');
        return scopedStore.readStream(cacheWorldInstanceId, cacheCharacterId);
      }, 4),
    );

    expect(newerExpected.at(-1)?.aggregateVersion).toBe(5);
    expect(newerExpectedMetrics.databaseOperations['event_store.stream_revision_lookup']?.calls).toBe(2);
  });
});
