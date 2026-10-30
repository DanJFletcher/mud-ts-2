import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppendRequest } from '@mudd/engine-core';
import { newMeasurements, requestMeasurements } from './performance.js';

const testDatabaseUrl = process.env.MUDD_TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

integrationDescribe('single-call event append (real PostgreSQL)', () => {
  const worldInstanceId = `single-call-${randomUUID()}`;
  const playerId = randomUUID();
  let db: typeof import('./db/client.js').db;
  let pool: typeof import('./db/client.js').pool;
  let PostgresEventStore: typeof import('./persistence/postgres-event-store.js').PostgresEventStore;
  let resetSingleCallAppendRuntimeForTests: typeof import('./persistence/postgres-event-store.js').resetSingleCallAppendRuntimeForTests;
  let fast: InstanceType<typeof PostgresEventStore>;
  let transactional: InstanceType<typeof PostgresEventStore>;

  const sharedAppend = (streamId: string, expectedVersion: number, commandId = `cmd-${randomUUID()}`): AppendRequest => ({
    worldInstanceId,
    streamId,
    actorId: playerId,
    commandId,
    payloadHash: `hash-${commandId}`,
    expectedVersion,
    events: [{ type: 'audit.single_call', version: 1, payload: { commandId } }],
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    ({ db, pool } = await import('./db/client.js'));
    const { players } = await import('./db/schema.js');
    ({ PostgresEventStore, resetSingleCallAppendRuntimeForTests } = await import('./persistence/postgres-event-store.js'));
    await db.insert(players).values({
      id: playerId,
      clerkUserId: `single-call-${playerId}`,
      displayName: 'Single-call fixture',
    });
    fast = new PostgresEventStore({ singleCallAppend: true });
    transactional = new PostgresEventStore({ singleCallAppend: false });
  });

  afterAll(async () => {
    if (!db || !pool) return;
    const { eq } = await import('drizzle-orm');
    const { characters, commandReceipts, durableEffects, gameEvents, players } = await import('./db/schema.js');
    try {
      await db.delete(durableEffects).where(eq(durableEffects.worldInstanceId, worldInstanceId));
      await db.delete(commandReceipts).where(eq(commandReceipts.worldInstanceId, worldInstanceId));
      await db.delete(gameEvents).where(eq(gameEvents.worldInstanceId, worldInstanceId));
      await db.delete(characters).where(eq(characters.playerId, playerId));
      await db.delete(players).where(eq(players.id, playerId));
    } finally {
      await pool.end();
    }
  });

  it('commits a cached character append in one statement and keeps its room read model current', async () => {
    const { eq } = await import('drizzle-orm');
    const { roomCharacterStates } = await import('./db/schema.js');
    const { replayCharacter } = await import('@mudd/engine-core');
    const characterId = randomUUID();
    const created = await fast.append({
      worldInstanceId,
      streamId: characterId,
      actorId: playerId,
      commandId: `create-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 0,
      events: [{ type: 'character.created', version: 1, payload: {
        characterId, playerId, name: 'Single call', startingLocationId: 'mossgate-clearing',
      } }],
    });
    expect(created.kind).toBe('committed');
    await fast.readStream(worldInstanceId, characterId);

    const metrics = newMeasurements('single-call-append');
    const taken = await requestMeasurements.run(metrics, () => fast.append({
      worldInstanceId,
      streamId: characterId,
      actorId: playerId,
      commandId: `take-${randomUUID()}`,
      payloadHash: randomUUID(),
      expectedVersion: 1,
      events: [{ type: 'character.item_taken', version: 1, payload: {
        characterId,
        locationId: 'mossgate-clearing',
        item: { id: `item-${randomUUID()}`, label: 'Single-call stone', description: 'A fixture item.' },
      } }],
    }));

    expect(taken.kind).toBe('committed');
    expect(metrics.databaseOperations['event_store.command_append']?.queries).toBe(1);
    expect(metrics.stages['event_store.append.single_call']).toBeGreaterThan(0);
    const [roomState] = await db.select().from(roomCharacterStates).where(eq(roomCharacterStates.characterId, characterId));
    expect(roomState).toMatchObject({ revision: 2, locationId: 'mossgate-clearing', worldInstanceId });
    const replayed = replayCharacter(await new PostgresEventStore().readStream(worldInstanceId, characterId));
    expect(replayed?.revision).toBe(2);
    expect(replayed?.inventory).toHaveLength(1);
  });

  it('serializes concurrent duplicates so one event set commits with one receipt', async () => {
    const streamId = `duplicates-${randomUUID()}`;
    const request = sharedAppend(streamId, 0);
    const outcomes = await Promise.all([fast.append(request), fast.append(request), fast.append(request)]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['committed', 'duplicate', 'duplicate']);
    const receipts = outcomes.map((outcome) => outcome.receipt);
    expect(receipts[1]).toEqual(receipts[0]);
    expect(receipts[2]).toEqual(receipts[0]);
    expect(await transactional.readStream(worldInstanceId, streamId)).toHaveLength(1);
  });

  it('serializes the same command across the single-call and transaction paths', async () => {
    const streamId = `mixed-paths-${randomUUID()}`;
    const request = sharedAppend(streamId, 0);
    const outcomes = await Promise.all([fast.append(request), transactional.append(request)]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['committed', 'duplicate']);
    expect(outcomes[0]!.receipt).toEqual(outcomes[1]!.receipt);
    expect(await transactional.readStream(worldInstanceId, streamId)).toHaveLength(1);
  });

  it('lets only one competing writer advance a stream', async () => {
    const streamId = `competing-${randomUUID()}`;
    const outcomes = await Promise.all([fast.append(sharedAppend(streamId, 0)), fast.append(sharedAppend(streamId, 0))]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['committed', 'conflict']);
    expect(outcomes.find((outcome) => outcome.kind === 'conflict')?.receipt)
      .toMatchObject({ code: 'VERSION_CONFLICT', message: 'Expected revision 0; current revision is 1.' });
  });

  it('rejects stale guards and reused command IDs without writing', async () => {
    const streamId = `guarded-${randomUUID()}`;
    const guardStream = `guard-${randomUUID()}`;
    expect((await fast.append(sharedAppend(guardStream, 0))).kind).toBe('committed');

    const staleGuard = await fast.append({ ...sharedAppend(streamId, 0), guards: [{ streamId: guardStream, expectedVersion: 0 }] });
    expect(staleGuard).toMatchObject({ kind: 'conflict', receipt: { message: 'An observed stream changed. Refresh and try again.' } });
    expect(await fast.readStream(worldInstanceId, streamId)).toHaveLength(0);

    const committed = sharedAppend(streamId, 0);
    expect((await fast.append(committed)).kind).toBe('committed');
    expect(await fast.append({ ...committed, payloadHash: 'different-payload' }))
      .toMatchObject({ kind: 'conflict', receipt: { code: 'INVALID_COMMAND' } });
  });

  it('rolls back events, companions and the receipt when an effect cannot be written', async () => {
    const { durableEffects } = await import('./db/schema.js');
    const { eq } = await import('drizzle-orm');
    const streamId = `atomic-${randomUUID()}`;
    const companionId = `atomic-companion-${randomUUID()}`;
    const commandId = `atomic-${randomUUID()}`;
    const blockerId = randomUUID();
    await db.insert(durableEffects).values({
      id: blockerId,
      worldInstanceId,
      sourceStreamId: streamId,
      causationCommandId: 'existing-effect',
      effectType: 'audit.single_call',
      effectVersion: 1,
      payload: { reason: 'force the append to fail' },
      dedupeKey: `command:${worldInstanceId}:${playerId}:${commandId}:0`,
    });
    const request: AppendRequest = {
      ...sharedAppend(streamId, 0, commandId),
      companions: [{ streamId: companionId, expectedVersion: 0,
        events: [{ type: 'audit.single_call_companion', version: 1, payload: { ok: true } }] }],
      effects: [{ type: 'audit.single_call', version: 1, payload: { deliver: 'once' } }],
    };

    await expect(fast.append(request)).rejects.toThrow();
    expect(await fast.readStream(worldInstanceId, streamId)).toHaveLength(0);
    expect(await fast.readStream(worldInstanceId, companionId)).toHaveLength(0);
    expect(await fast.lookupCommand(worldInstanceId, playerId, commandId, request.payloadHash)).toBeUndefined();

    await db.delete(durableEffects).where(eq(durableEffects.id, blockerId));
    expect((await fast.append(request)).kind).toBe('committed');
    expect(await fast.readStream(worldInstanceId, companionId)).toHaveLength(1);
    const effects = await db.select().from(durableEffects).where(eq(durableEffects.causationCommandId, commandId));
    expect(effects).toHaveLength(1);
  });

  it('falls back without the append function and uses it again after a fresh runtime check', async () => {
    const migrationSql = await readFile(
      fileURLToPath(new URL('../drizzle/0014_single_call_append_isolation.sql', import.meta.url)),
      'utf8',
    );
    const fallbackStore = new PostgresEventStore({ singleCallAppend: true });

    try {
      await pool.query('DROP FUNCTION IF EXISTS mudd_append_command_v1(jsonb)');
      resetSingleCallAppendRuntimeForTests();
      const fallbackMetrics = newMeasurements('single-call-missing-function-fallback');
      const fallback = await requestMeasurements.run(fallbackMetrics, () =>
        fallbackStore.append(sharedAppend(`missing-function-${randomUUID()}`, 0)));
      expect(fallback.kind).toBe('committed');
      expect(fallbackMetrics.stages['event_store.append.single_call']).toBeUndefined();

      await pool.query(migrationSql);
      resetSingleCallAppendRuntimeForTests();
      const reloadedStore = new PostgresEventStore({ singleCallAppend: true });
      const fastMetrics = newMeasurements('single-call-function-restored');
      const fastResult = await requestMeasurements.run(fastMetrics, () =>
        reloadedStore.append(sharedAppend(`restored-function-${randomUUID()}`, 0)));
      expect(fastResult.kind).toBe('committed');
      expect(fastMetrics.stages['event_store.append.single_call']).toBeGreaterThan(0);
      expect(fastMetrics.databaseOperations['event_store.command_append']?.queries).toBe(1);
    } finally {
      await pool.query(migrationSql);
      resetSingleCallAppendRuntimeForTests();
    }
  });
});
