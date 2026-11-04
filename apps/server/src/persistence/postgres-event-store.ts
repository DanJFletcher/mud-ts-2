import { AsyncLocalStorage } from 'node:async_hooks';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { CommandReceipt } from '@mudd/contracts';
import type {
  AppendOutcome,
  AppendRequest,
  CommandEffectReservation,
  CommandEffectScope,
  EventStorePort,
  StoredEventEffect,
  StoredGameEvent,
  StreamKind,
} from '@mudd/engine-core';
import {
  characters,
  commandReceipts,
  durableEffects,
  gameEvents,
  roomCharacterStates,
  worldObjectLifecycles,
  worldSessions,
} from '../db/schema.js';
import { db } from '../db/client.js';
import { retainCharacterReplayPrefix, replayCharacter } from '@mudd/engine-core';
import { measureDatabaseOperation, measureStage } from '../app/performance.js';
import { commandEffectKeyPrefix, postgresEffectRepository } from './postgres-effect-repository.js';
import { postgresObjectLifecycleRepository } from './postgres-object-lifecycle-repository.js';

/**
 * The latest event of each stream. DISTINCT ON would read and sort every event
 * of every stream; a LATERAL LIMIT 1 takes one backward index probe per stream,
 * however long its history.
 */
export function streamHeadsQuery(worldInstanceId: string, streamIds: readonly string[]) {
  const streamValues = sql.join(streamIds.map((streamId) => sql`(${streamId})`), sql`, `);
  return db.select().from(gameEvents)
    .where(inArray(gameEvents.eventId, sql`(
      SELECT head.event_id
      FROM (VALUES ${streamValues}) AS streams(stream_id)
      CROSS JOIN LATERAL (
        SELECT event_id
        FROM game_events
        WHERE world_instance_id = ${worldInstanceId} AND stream_id = streams.stream_id
        ORDER BY stream_version DESC
        LIMIT 1
      ) AS head
    )`));
}

export function toStoredGameEvent(row: typeof gameEvents.$inferSelect): StoredGameEvent {
  return {
    type: row.type,
    version: row.contractVersion,
    payload: row.payload,
    eventId: row.eventId,
    worldInstanceId: row.worldInstanceId,
    streamId: row.streamId,
    aggregateId: row.streamId,
    aggregateVersion: row.streamVersion,
    causationCommandId: row.causationCommandId,
    actorId: row.actorId,
    occurredAt: row.occurredAt.toISOString(),
    tick: row.tick,
  };
}

type CommandStreamReadCache = {
  readonly worldInstanceId: string;
  readonly streamId: string;
  expectedVersion?: number;
  revision?: number;
  events?: readonly StoredGameEvent[];
};

type AppendMaterializerTx = Pick<typeof db, 'execute' | 'insert' | 'select' | 'update'>;
type AppendMaterializerContext = {
  readonly tx: AppendMaterializerTx;
  readonly worldInstanceId: string;
  readonly payload: Record<string, unknown>;
  readonly revision: number;
  readonly committedAt: Date;
};
type AppendMaterializer = (context: AppendMaterializerContext) => Promise<void>;

function isStreamKind(value: unknown): value is StreamKind {
  return value === 'character' || value === 'non-character';
}

function assertAppendStreamKinds(request: AppendRequest): void {
  if (!isStreamKind(request.streamKind)) {
    throw new TypeError('Append request requires streamKind "character" or "non-character".');
  }
  for (const [index, write] of (request.companions ?? []).entries()) {
    if (!isStreamKind(write.streamKind)) {
      throw new TypeError(`Companion stream write ${index} requires a valid streamKind.`);
    }
  }
}

/** Side-table writes are registered here and always run in the append transaction. */
const POSTGRES_APPEND_MATERIALIZERS: ReadonlyMap<string, AppendMaterializer> = new Map([
  ['character.created', async ({ tx, worldInstanceId, payload }) => {
    await tx.insert(characters).values({
      id: String(payload.characterId),
      playerId: String(payload.playerId),
      worldInstanceId,
      name: String(payload.name),
    }).onConflictDoNothing();
  }],
  ['character.renamed', async ({ tx, worldInstanceId, payload }) => {
    await tx.update(characters)
      .set({ name: String(payload.name) })
      .where(and(
        eq(characters.id, String(payload.characterId)),
        eq(characters.worldInstanceId, worldInstanceId),
      ));
  }],
  ['character.archived', async ({ tx, worldInstanceId, payload, committedAt }) => {
    const characterId = String(payload.characterId);
    await tx.execute(sql`SELECT id FROM characters WHERE id = ${characterId} FOR UPDATE`);
    const [activeSession] = await tx.select({ id: worldSessions.id }).from(worldSessions)
      .where(eq(worldSessions.characterId, characterId)).limit(1);
    if (activeSession) throw new Error('Leave the world before archiving this character.');
    await tx.update(characters)
      .set({ archivedAt: committedAt })
      .where(and(
        eq(characters.id, characterId),
        eq(characters.worldInstanceId, worldInstanceId),
      ));
  }],
  ['character.restored', async ({ tx, worldInstanceId, payload }) => {
    await tx.update(characters)
      .set({ archivedAt: null })
      .where(and(
        eq(characters.id, String(payload.characterId)),
        eq(characters.worldInstanceId, worldInstanceId),
      ));
  }],
  ['world.object_lifecycle_scheduled', async ({ tx, worldInstanceId, payload, revision }) => {
    const values = {
      worldInstanceId,
      objectId: String(payload.objectId),
      objectType: String(payload.objectType),
      locationId: String(payload.locationId),
      createdAt: new Date(String(payload.createdAt)),
      expiresAt: new Date(String(payload.expiresAt)),
      state: 'scheduled' as const,
      revision,
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
    };
    await tx.insert(worldObjectLifecycles).values(values).onConflictDoUpdate({
      target: [worldObjectLifecycles.worldInstanceId, worldObjectLifecycles.objectId],
      set: {
        objectType: values.objectType,
        locationId: values.locationId,
        createdAt: values.createdAt,
        expiresAt: values.expiresAt,
        state: 'scheduled',
        revision,
        attempts: 0,
        leaseToken: null,
        leaseUntil: null,
      },
    });
  }],
  ['world.object_lifecycle_rescheduled', async ({ tx, worldInstanceId, payload, revision }) => {
    await tx.update(worldObjectLifecycles).set({
      objectType: String(payload.objectType),
      locationId: String(payload.locationId),
      expiresAt: new Date(String(payload.expiresAt)),
      state: 'scheduled',
      revision,
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
    }).where(and(
      eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
      eq(worldObjectLifecycles.objectId, String(payload.objectId)),
    ));
  }],
  ['world.object_lifecycle_cancelled', async ({ tx, worldInstanceId, payload, revision }) => {
    await tx.update(worldObjectLifecycles).set({
      state: 'cancelled',
      revision,
      leaseToken: null,
      leaseUntil: null,
    }).where(and(
      eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
      eq(worldObjectLifecycles.objectId, String(payload.objectId)),
    ));
  }],
  ['world.object_expiring', async ({ tx, worldInstanceId, payload, revision }) => {
    await tx.update(worldObjectLifecycles).set({
      state: 'expiring',
      revision,
      attempts: sql`${worldObjectLifecycles.attempts} + 1`,
      leaseToken: null,
      leaseUntil: null,
    }).where(and(
      eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
      eq(worldObjectLifecycles.objectId, String(payload.objectId)),
    ));
  }],
  ['world.object_expired', async ({ tx, worldInstanceId, payload, revision }) => {
    await tx.update(worldObjectLifecycles).set({
      locationId: String(payload.locationId),
      state: 'expired',
      revision,
      leaseToken: null,
      leaseUntil: null,
    }).where(and(
      eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
      eq(worldObjectLifecycles.objectId, String(payload.objectId)),
    ));
  }],
]);

export type PostgresAppendRouteReason =
  | 'single-call-disabled'
  | 'duplicate-write-stream'
  | 'empty-stream-write'
  | 'transaction-materializer-required'
  | 'character-stream-cache-unavailable'
  | 'single-call-eligible';

export type PostgresAppendRouteDecision = {
  readonly route: 'single-call' | 'transaction';
  readonly reason: PostgresAppendRouteReason;
};

/** Pure routing policy; readiness is supplied by the caller, not read here. */
export function decideAppendRoute(
  request: AppendRequest,
  options: { readonly singleCallEnabled: boolean; readonly characterStreamsReady: boolean },
): PostgresAppendRouteDecision {
  if (!options.singleCallEnabled) return { route: 'transaction', reason: 'single-call-disabled' };
  const writes = [
    { streamId: request.streamId, streamKind: request.streamKind, events: request.events },
    ...(request.companions ?? []),
  ];
  if (new Set(writes.map((write) => write.streamId)).size !== writes.length) {
    return { route: 'transaction', reason: 'duplicate-write-stream' };
  }
  if (writes.some((write) => write.events.length === 0)) {
    return { route: 'transaction', reason: 'empty-stream-write' };
  }
  if (writes.some((write) => write.events.some((event) => POSTGRES_APPEND_MATERIALIZERS.has(event.type)))) {
    return { route: 'transaction', reason: 'transaction-materializer-required' };
  }
  if (writes.some((write) => write.streamKind === 'character') && !options.characterStreamsReady) {
    return { route: 'transaction', reason: 'character-stream-cache-unavailable' };
  }
  return { route: 'single-call', reason: 'single-call-eligible' };
}

type SingleCallAppendRow = {
  outcome: 'prior' | 'guard_conflict' | 'version_conflict' | 'committed';
  prior_stream_id: string | null;
  prior_payload_hash: string | null;
  prior_receipt: unknown;
  prior_events: unknown;
  current_revision: number | null;
};

function roomCharacterStateRow(
  worldInstanceId: string,
  characterId: string,
  state: NonNullable<ReturnType<typeof replayCharacter>>,
) {
  return {
    characterId, worldInstanceId, locationId: state.locationId,
    revision: state.revision, schemaVersion: 1,
    state: {
      characterId, worldInstanceId, locationId: state.locationId,
      name: state.name, archived: state.archived,
      ...(state.health ? { health: state.health } : {}),
      ...(state.combat ? { combat: { status: state.combat.status } } : {}),
    },
  };
}

function conflict(
  commandId: string,
  message: string,
  code: Extract<CommandReceipt, { ok: false }>['code'] = 'VERSION_CONFLICT',
): Extract<CommandReceipt, { ok: false }> {
  return { ok: false, commandId, code, message, retryable: code === 'VERSION_CONFLICT' };
}

export interface PostgresEventStoreOptions {
  /**
   * Commit eligible appends with one call to `mudd_append_command_v1` instead of
   * a multi-statement transaction. Defaults to `MUDD_SINGLE_CALL_APPEND=1`.
   */
  readonly singleCallAppend?: boolean;
}

export class PostgresEventStore implements EventStorePort {
  private readonly singleCallAppend: boolean;

  constructor(options: PostgresEventStoreOptions = {}) {
    this.singleCallAppend = options.singleCallAppend ?? process.env.MUDD_SINGLE_CALL_APPEND === '1';
  }

  private async refreshRoomState(
    tx: Pick<typeof db, 'select' | 'insert'>,
    worldInstanceId: string,
    streamId: string,
    streamKind: StreamKind,
    knownAppend?: { expectedVersion: number; events: readonly StoredGameEvent[] },
    knownCharacterStream = false,
  ) {
    if (streamKind !== 'character') return;
    if (!knownCharacterStream) {
      const [character] = await tx.select({ id: characters.id }).from(characters)
        .where(and(eq(characters.id, streamId), eq(characters.worldInstanceId, worldInstanceId))).limit(1);
      if (!character) return;
    }
    const cached = this.streamCache.get(this.streamKey(worldInstanceId, streamId));
    const cacheMatchesAppend = knownAppend && cached?.revision === knownAppend.expectedVersion;
    const tail = cacheMatchesAppend
      ? knownAppend.events
      : (await tx.select().from(gameEvents).where(and(
          eq(gameEvents.worldInstanceId, worldInstanceId), eq(gameEvents.streamId, streamId),
          ...(cached ? [sql`${gameEvents.streamVersion} > ${cached.revision}`] : []),
        )).orderBy(asc(gameEvents.streamVersion))).map(toStoredGameEvent);
    const history = cached ? [...cached.events, ...tail] : tail;
    retainCharacterReplayPrefix(history, cached?.events);
    const state = replayCharacter(history);
    if (!state) throw new Error('Character room projection requires creation history.');
    const values = roomCharacterStateRow(worldInstanceId, streamId, state);
    await tx.insert(roomCharacterStates).values(values)
      .onConflictDoUpdate({ target: roomCharacterStates.characterId, set: values });
  }

  /** Resumable, serialized backfill before accepting traffic; histories stay intact. */
  async rebuildRoomStates(worldInstanceId?: string, characterId?: string) {
    const rows = await db.select({ id: characters.id, world: characters.worldInstanceId }).from(characters)
      .where(and(
        worldInstanceId ? eq(characters.worldInstanceId, worldInstanceId) : undefined,
        characterId ? eq(characters.id, characterId) : undefined,
        sql`NOT EXISTS (
          SELECT 1 FROM room_character_states r
          WHERE r.character_id = characters.id AND r.world_instance_id = characters.world_instance_id
            AND r.schema_version = 1 AND r.revision = COALESCE((
              SELECT e.stream_version FROM game_events e
              WHERE e.world_instance_id = characters.world_instance_id
                AND e.stream_id = characters.id::text
              ORDER BY e.stream_version DESC LIMIT 1
            ), 0)
        )`,
      ));
    for (const row of rows) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${row.world}), hashtext(${row.id}))`);
        const [head] = await tx.select({ revision: gameEvents.streamVersion }).from(gameEvents)
          .where(and(eq(gameEvents.worldInstanceId, row.world), eq(gameEvents.streamId, row.id)))
          .orderBy(desc(gameEvents.streamVersion)).limit(1);
        const [projection] = await tx.select().from(roomCharacterStates)
          .where(eq(roomCharacterStates.characterId, row.id)).limit(1);
        if (projection?.revision === (head?.revision ?? 0) && projection?.schemaVersion === 1) return;
        await this.refreshRoomState(tx, row.world, row.id, 'character');
      });
    }
  }

  private readonly streamCache = new Map<string, {
    readonly revision: number;
    readonly events: readonly StoredGameEvent[];
    readonly bytes: number;
  }>();
  private cachedStreamBytes = 0;
  private readonly commandReadCache = new AsyncLocalStorage<CommandStreamReadCache>();

  /**
   * Reuse the active character's event snapshot only within one HTTP command.
   * append() still validates the live head under the database lock.
   */
  withCommandReadCache<T>(
    worldInstanceId: string,
    streamId: string,
    run: () => T,
    expectedVersion?: number,
  ): T {
    if (!streamId) return run();
    return this.commandReadCache.run({ worldInstanceId, streamId, expectedVersion }, run);
  }

  withoutCommandReadCache<T>(run: () => T): T {
    return this.commandReadCache.exit(run);
  }

  invalidateCommandReadCache(worldInstanceId: string, streamId: string) {
    const scoped = this.commandReadCache.getStore();
    if (scoped?.worldInstanceId === worldInstanceId && scoped.streamId === streamId) {
      scoped.revision = undefined;
      scoped.events = undefined;
    }
  }

  private scopedCommandReadCache(worldInstanceId: string, streamId: string) {
    const scoped = this.commandReadCache.getStore();
    return scoped?.worldInstanceId === worldInstanceId && scoped.streamId === streamId
      ? scoped
      : undefined;
  }

  private streamKey(worldInstanceId: string, streamId: string) {
    return `${worldInstanceId}\u0000${streamId}`;
  }

  private cacheStream(key: string, events: readonly StoredGameEvent[], knownBytes?: number) {
    const bytes = knownBytes ?? Buffer.byteLength(JSON.stringify(events));
    const MAX_STREAM_BYTES = 8 * 1024 * 1024;
    const MAX_CACHE_BYTES = 32 * 1024 * 1024;
    const MAX_CACHE_STREAMS = 128;
    if (bytes > MAX_STREAM_BYTES) {
      const previous = this.streamCache.get(key);
      if (previous) {
        this.cachedStreamBytes -= previous.bytes;
        this.streamCache.delete(key);
      }
      return;
    }
    const previous = this.streamCache.get(key);
    if (previous) this.cachedStreamBytes -= previous.bytes;
    this.streamCache.delete(key);
    while (
      this.streamCache.size >= MAX_CACHE_STREAMS ||
      this.cachedStreamBytes + bytes > MAX_CACHE_BYTES
    ) {
      const oldestKey = this.streamCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.streamCache.get(oldestKey)!;
      this.cachedStreamBytes -= oldest.bytes;
      this.streamCache.delete(oldestKey);
    }
    retainCharacterReplayPrefix(events);
    this.streamCache.set(key, {
      revision: events.at(-1)?.aggregateVersion ?? 0,
      events,
      bytes,
    });
    this.cachedStreamBytes += bytes;
  }

  private invalidateStream(worldInstanceId: string, streamId: string) {
    const key = this.streamKey(worldInstanceId, streamId);
    const cached = this.streamCache.get(key);
    if (!cached) return;
    this.cachedStreamBytes -= cached.bytes;
    this.streamCache.delete(key);
  }

  private appendCachedStream(
    worldInstanceId: string,
    streamId: string,
    expectedVersion: number,
    appended: readonly StoredGameEvent[],
  ) {
    const key = this.streamKey(worldInstanceId, streamId);
    const cached = this.streamCache.get(key);
    if (!cached) return;
    if (cached.revision !== expectedVersion) {
      this.invalidateStream(worldInstanceId, streamId);
      return;
    }
    const next = [...cached.events, ...appended];
    retainCharacterReplayPrefix(next, cached.events);
    this.cacheStream(key, next, cached.bytes + Buffer.byteLength(JSON.stringify(appended)));
  }

  async readStreamRevision(worldInstanceId: string, streamId: string): Promise<number> {
    const scoped = this.scopedCommandReadCache(worldInstanceId, streamId);
    if (
      scoped?.revision !== undefined &&
      (scoped.expectedVersion === undefined || scoped.revision === scoped.expectedVersion)
    ) {
      return scoped.revision;
    }
    if (scoped) scoped.events = undefined;
    const revision = await measureDatabaseOperation('event_store.stream_revision_lookup', async () => {
      const [head] = await db.select({ revision: gameEvents.streamVersion }).from(gameEvents)
        .where(and(eq(gameEvents.worldInstanceId, worldInstanceId), eq(gameEvents.streamId, streamId)))
        .orderBy(desc(gameEvents.streamVersion)).limit(1);
      return head?.revision ?? 0;
    });
    if (scoped) scoped.revision = revision;
    return revision;
  }

  async readStream(worldInstanceId: string, streamId: string): Promise<readonly StoredGameEvent[]> {
    const scoped = this.scopedCommandReadCache(worldInstanceId, streamId);
    if (
      scoped?.events &&
      (scoped.expectedVersion === undefined || scoped.revision === scoped.expectedVersion)
    ) {
      return scoped.events;
    }
    const revision = await this.readStreamRevision(worldInstanceId, streamId);
    const events = await this.readStreamAtRevision(worldInstanceId, streamId, revision);
    if (scoped) {
      scoped.revision = revision;
      scoped.events = events;
    }
    return events;
  }

  async readStreams(
    worldInstanceId: string,
    streamIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly StoredGameEvent[]>> {
    const uniqueStreamIds = [...new Set(streamIds)];
    if (uniqueStreamIds.length === 0) return new Map();

    const scoped = this.commandReadCache.getStore();
    const cachedScoped = scoped?.worldInstanceId === worldInstanceId &&
      uniqueStreamIds.includes(scoped.streamId) &&
      scoped.revision !== undefined
      && (scoped.expectedVersion === undefined || scoped.revision === scoped.expectedVersion)
      ? scoped
      : undefined;
    const streamsToLookup = cachedScoped
      ? uniqueStreamIds.filter((streamId) => streamId !== cachedScoped.streamId)
      : uniqueStreamIds;
    const revisions = streamsToLookup.length === 0
      ? new Map<string, number>()
      : await measureDatabaseOperation('event_store.stream_revisions_lookup', async () => {
      const rows = await db.select({
        streamId: gameEvents.streamId,
        revision: sql<number>`max(${gameEvents.streamVersion})`,
      }).from(gameEvents).where(and(
        eq(gameEvents.worldInstanceId, worldInstanceId),
        inArray(gameEvents.streamId, streamsToLookup),
      )).groupBy(gameEvents.streamId);
      return new Map(rows.map((row) => [row.streamId, Number(row.revision)]));
    });

    const streamReads = uniqueStreamIds.map((streamId) => ({
      streamId,
      revision: streamId === cachedScoped?.streamId
        ? cachedScoped.revision!
        : revisions.get(streamId) ?? 0,
      cached: this.touchCachedStream(this.streamKey(worldInstanceId, streamId)),
    }));
    const result = new Map<string, readonly StoredGameEvent[]>();
    for (const { streamId, revision, cached } of streamReads) {
      if (cached?.revision === revision) result.set(streamId, cached.events);
    }

    const streamsNeedingRead = streamReads.filter(({ revision, cached }) => cached?.revision !== revision);
    if (streamsNeedingRead.length > 0) {
      const streamFilters = streamsNeedingRead.flatMap(({ streamId, revision, cached }) => {
        const condition = cached && revision > cached.revision
          ? and(
              eq(gameEvents.streamId, streamId),
              sql`${gameEvents.streamVersion} > ${cached.revision}`,
            )
          : eq(gameEvents.streamId, streamId);
        return condition ? [condition] : [];
      });
      const rows = await measureDatabaseOperation('event_store.stream_rows_read', () =>
        db.select().from(gameEvents)
          .where(and(
            eq(gameEvents.worldInstanceId, worldInstanceId),
            or(...streamFilters),
          ))
          .orderBy(asc(gameEvents.streamId), asc(gameEvents.streamVersion)));
      const rowsByStream = new Map<string, StoredGameEvent[]>();
      for (const row of rows) {
        const events = rowsByStream.get(row.streamId) ?? [];
        events.push(toStoredGameEvent(row));
        rowsByStream.set(row.streamId, events);
      }

      for (const { streamId, revision, cached } of streamsNeedingRead) {
        const tail = rowsByStream.get(streamId) ?? [];
        const events = cached && revision > cached.revision
          ? [...cached.events, ...tail]
          : tail;
        if (cached && revision > cached.revision) retainCharacterReplayPrefix(events, cached.events);
        this.cacheStream(this.streamKey(worldInstanceId, streamId), events, cached && revision > cached.revision
          ? cached.bytes + Buffer.byteLength(JSON.stringify(tail))
          : undefined);
        result.set(streamId, events);
      }
    }

    if (cachedScoped) {
      const events = result.get(cachedScoped.streamId);
      if (events) cachedScoped.events = events;
    } else if (scoped?.worldInstanceId === worldInstanceId && result.has(scoped.streamId)) {
      const revision = revisions.get(scoped.streamId) ?? 0;
      scoped.revision = revision;
      scoped.events = result.get(scoped.streamId);
    }
    return result;
  }

  async readStreamHeads(
    worldInstanceId: string,
    streamIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredGameEvent>> {
    const uniqueStreamIds = [...new Set(streamIds)];
    if (uniqueStreamIds.length === 0) return new Map();
    const rows = await measureDatabaseOperation('event_store.stream_heads_read', () =>
      streamHeadsQuery(worldInstanceId, uniqueStreamIds));
    return new Map(rows.map((row) => [row.streamId, toStoredGameEvent(row)]));
  }

  private touchCachedStream(key: string) {
    const cached = this.streamCache.get(key);
    if (cached) {
      this.streamCache.delete(key);
      this.streamCache.set(key, cached);
    }
    return cached;
  }

  private async readStreamAtRevision(
    worldInstanceId: string,
    streamId: string,
    revision: number,
  ): Promise<readonly StoredGameEvent[]> {
    const key = this.streamKey(worldInstanceId, streamId);
    const cached = this.touchCachedStream(key);
    if (cached?.revision === revision) return cached.events;

    const rows = await measureDatabaseOperation('event_store.stream_rows_read', () =>
      db.select().from(gameEvents)
        .where(and(
          eq(gameEvents.worldInstanceId, worldInstanceId),
          eq(gameEvents.streamId, streamId),
          ...(cached && revision > cached.revision
            ? [sql`${gameEvents.streamVersion} > ${cached.revision}`]
            : []),
        ))
        .orderBy(gameEvents.streamVersion));
    const tail = rows.map(toStoredGameEvent);
    const events = cached && revision > cached.revision
      ? [...cached.events, ...tail]
      : tail;
    if (cached && revision > cached.revision) retainCharacterReplayPrefix(events, cached.events);
    this.cacheStream(key, events, cached && revision > cached.revision
      ? cached.bytes + Buffer.byteLength(JSON.stringify(tail)) : undefined);
    return events;
  }

  async lookupCommand(
    worldInstanceId: string,
    actorId: string,
    commandId: string,
    payloadHash: string,
  ): Promise<AppendOutcome | undefined> {
    const [prior] = await measureDatabaseOperation('event_store.command_receipt_lookup', () =>
      db.select().from(commandReceipts).where(and(
        eq(commandReceipts.worldInstanceId, worldInstanceId),
        eq(commandReceipts.actorId, actorId),
        eq(commandReceipts.commandId, commandId),
      )).limit(1));
    if (!prior) return undefined;
    if (prior.payloadHash === payloadHash) {
      return {
        kind: 'duplicate',
        streamId: prior.streamId,
        events: prior.events as StoredGameEvent[],
        receipt: prior.receipt as Extract<CommandReceipt, { ok: true }>,
      };
    }
    return {
      kind: 'conflict',
      streamId: prior.streamId,
      events: prior.events as StoredGameEvent[],
      receipt: conflict(commandId, 'Command ID was already used with a different payload.', 'INVALID_COMMAND'),
    };
  }

  async append(request: AppendRequest): Promise<AppendOutcome> {
    assertAppendStreamKinds(request);
    const decision = decideAppendRoute(request, {
      singleCallEnabled: this.singleCallAppend,
      characterStreamsReady: this.characterStreamsReady(request),
    });
    const oneCall = decision.route === 'single-call' ? await this.appendInOneCall(request) : undefined;
    const outcome = oneCall ?? await this.appendInTransaction(request);
    this.updateCachesAfterAppend(request, outcome);
    return outcome;
  }

  private characterStreamsReady(request: AppendRequest): boolean {
    const writes = [
      { streamId: request.streamId, streamKind: request.streamKind, expectedVersion: request.expectedVersion },
      ...(request.companions ?? []),
    ];
    return writes.every((write) => {
      if (write.streamKind !== 'character') return true;
      return this.streamCache.get(this.streamKey(request.worldInstanceId, write.streamId))?.revision ===
        write.expectedVersion;
    });
  }

  /**
   * Commit in one round trip through `mudd_append_command_v1`, or return
   * undefined if a character room projection became unavailable after routing.
   */
  private async appendInOneCall(request: AppendRequest): Promise<AppendOutcome | undefined> {
    const writes = [
      {
        streamId: request.streamId,
        streamKind: request.streamKind,
        expectedVersion: request.expectedVersion,
        events: request.events,
      },
      ...(request.companions ?? []),
    ];

    const committedAt = new Date().toISOString();
    const stored = writes.map((write) => ({
      ...write,
      events: write.events.map((event, index): StoredGameEvent => ({
        ...event,
        eventId: globalThis.crypto.randomUUID(),
        worldInstanceId: request.worldInstanceId,
        streamId: write.streamId,
        aggregateId: write.streamId,
        aggregateVersion: write.expectedVersion + index + 1,
        causationCommandId: request.commandId,
        actorId: request.actorId,
        occurredAt: committedAt,
        tick: write.expectedVersion + index + 1,
      })),
    }));

    const roomStates = [];
    for (const write of stored) {
      if (write.streamKind !== 'character') continue;
      const cached = this.streamCache.get(this.streamKey(request.worldInstanceId, write.streamId));
      if (cached?.revision !== write.expectedVersion) return undefined;
      const history = [...cached.events, ...write.events];
      retainCharacterReplayPrefix(history, cached.events);
      const state = replayCharacter(history);
      if (!state) return undefined;
      const row = roomCharacterStateRow(request.worldInstanceId, write.streamId, state);
      roomStates.push({ character_id: row.characterId, location_id: row.locationId, revision: row.revision, state: row.state });
    }

    const [primary, ...companions] = stored;
    const appended = primary!.events;
    const receipt: Extract<CommandReceipt, { ok: true }> = {
      ok: true,
      commandId: request.commandId,
      eventIds: appended.map((event) => event.eventId),
      newAggregateVersion: appended.at(-1)!.aggregateVersion,
    };
    const checks = [...(request.companions ?? []), ...(request.guards ?? [])];
    const effectKeyPrefix = commandEffectKeyPrefix(request.worldInstanceId, request.actorId, request.commandId);
    const payload = {
      worldInstanceId: request.worldInstanceId,
      actorId: request.actorId,
      commandId: request.commandId,
      payloadHash: request.payloadHash,
      streamId: request.streamId,
      expectedVersion: request.expectedVersion,
      lockStreamIds: [...new Set([...writes.map((write) => write.streamId), ...checks.map((check) => check.streamId)])],
      checks: checks.map(({ streamId, expectedVersion }) => ({ streamId, expectedVersion })),
      events: [...companions, primary!].flatMap((write) => write.events.map((event) => ({
        event_id: event.eventId,
        stream_id: event.streamId,
        stream_version: event.aggregateVersion,
        type: event.type,
        contract_version: event.version,
        payload: event.payload,
        occurred_at: event.occurredAt,
        tick: event.tick,
      }))),
      receipt,
      receiptEvents: appended,
      effects: (request.effects ?? []).map((effect, index) => ({
        id: globalThis.crypto.randomUUID(),
        effect_type: effect.type,
        effect_version: effect.version,
        payload: effect.payload,
        dedupe_key: `${effectKeyPrefix}${index}`,
      })),
      roomStates,
    };

    const result = await measureDatabaseOperation('event_store.command_append', () =>
      measureStage('event_store.append.single_call', () =>
        db.execute(sql`SELECT * FROM mudd_append_command_v1(${JSON.stringify(payload)}::jsonb)`)));
    const row = result.rows[0] as SingleCallAppendRow | undefined;
    switch (row?.outcome) {
      case 'prior':
        return row.prior_payload_hash === request.payloadHash
          ? {
              kind: 'duplicate',
              streamId: row.prior_stream_id!,
              events: row.prior_events as StoredGameEvent[],
              receipt: row.prior_receipt as CommandReceipt & { ok: true },
            }
          : {
              kind: 'conflict',
              streamId: row.prior_stream_id!,
              events: row.prior_events as StoredGameEvent[],
              receipt: conflict(request.commandId, 'Command ID was already used with a different payload.', 'INVALID_COMMAND'),
            };
      case 'guard_conflict':
        return { kind: 'conflict', streamId: request.streamId, events: [],
          receipt: conflict(request.commandId, 'An observed stream changed. Refresh and try again.') };
      case 'version_conflict':
        return {
          kind: 'conflict',
          streamId: request.streamId,
          events: [],
          receipt: conflict(request.commandId, `Expected revision ${request.expectedVersion}; current revision is ${row.current_revision}.`),
        };
      case 'committed':
        return { kind: 'committed', streamId: request.streamId, events: appended, receipt };
      default:
        throw new Error('Command append returned no recognizable outcome.');
    }
  }

  private async appendInTransaction(request: AppendRequest): Promise<AppendOutcome> {
    const appendStage = <T>(name: string, run: () => Promise<T>) =>
      measureStage(`event_store.append.${name}`, run);
    return measureDatabaseOperation('event_store.command_append', () => db.transaction(async (tx): Promise<AppendOutcome> => {
      // Lock command identity first so retries cannot race across different stream IDs.
      await appendStage('command_lock', () => tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtext(${request.worldInstanceId}), hashtext(${`${request.actorId}:${request.commandId}`}))`));
      const [prior] = await appendStage('receipt_lookup', () => tx.select().from(commandReceipts).where(and(
        eq(commandReceipts.worldInstanceId, request.worldInstanceId),
        eq(commandReceipts.actorId, request.actorId),
        eq(commandReceipts.commandId, request.commandId),
      )).limit(1));
      if (prior) {
        if (prior.payloadHash !== request.payloadHash) {
          return {
            kind: 'conflict',
            streamId: prior.streamId,
            events: prior.events as StoredGameEvent[],
            receipt: conflict(request.commandId, 'Command ID was already used with a different payload.', 'INVALID_COMMAND'),
          };
        }
        return {
          kind: 'duplicate',
          streamId: prior.streamId,
          events: prior.events as StoredGameEvent[],
          receipt: prior.receipt as CommandReceipt & { ok: true },
        };
      }

      const companions = request.companions ?? [];
      const writeDescriptors = [
        { streamId: request.streamId, streamKind: request.streamKind },
        ...companions.map((write) => ({ streamId: write.streamId, streamKind: write.streamKind })),
      ];
      const writeIds = writeDescriptors.map((write) => write.streamId);
      if (new Set(writeIds).size !== writeIds.length) throw new Error('Duplicate atomic write stream.');
      const checks = [...companions, ...(request.guards ?? [])];
      // A deterministic lock order avoids deadlocks across encounter/character writers.
      const lockedStreamIds = [...new Set([...writeIds, ...checks.map((check) => check.streamId)])].sort();
      const lockedStreamValues = sql.join(
        lockedStreamIds.map((streamId) => sql`(${streamId})`),
        sql`, `,
      );
      await appendStage('stream_locks', () => tx.execute(sql`
        WITH ordered_streams AS MATERIALIZED (
          SELECT stream_id
          FROM (VALUES ${lockedStreamValues}) AS streams(stream_id)
          ORDER BY stream_id
        )
        SELECT pg_advisory_xact_lock(hashtext(${request.worldInstanceId}), hashtext(stream_id))
        FROM ordered_streams
        ORDER BY stream_id`));

      // All these heads are authoritative after their advisory locks are held.
      const headRows = await appendStage('head_check', () => tx.select({
        streamId: gameEvents.streamId,
        revision: sql<number>`max(${gameEvents.streamVersion})`,
      }).from(gameEvents).where(and(
        eq(gameEvents.worldInstanceId, request.worldInstanceId),
        inArray(gameEvents.streamId, lockedStreamIds),
      )).groupBy(gameEvents.streamId));
      const revisions = new Map(headRows.map((head) => [head.streamId, Number(head.revision)]));
      for (const check of checks) {
        if ((revisions.get(check.streamId) ?? 0) !== check.expectedVersion) {
          return { kind: 'conflict', streamId: request.streamId, events: [],
            receipt: conflict(request.commandId, 'An observed stream changed. Refresh and try again.') };
        }
      }
      const currentRevision = revisions.get(request.streamId) ?? 0;
      if (currentRevision !== request.expectedVersion) {
        return {
          kind: 'conflict',
          streamId: request.streamId,
          events: [],
          receipt: conflict(request.commandId, `Expected revision ${request.expectedVersion}; current revision is ${currentRevision}.`),
        };
      }

      const committedAt = new Date();
      const appended: StoredGameEvent[] = request.events.map((event, index) => ({
        ...event,
        eventId: globalThis.crypto.randomUUID(),
        worldInstanceId: request.worldInstanceId,
        streamId: request.streamId,
        aggregateId: request.streamId,
        aggregateVersion: currentRevision + index + 1,
        causationCommandId: request.commandId,
        actorId: request.actorId,
        occurredAt: committedAt.toISOString(),
        tick: currentRevision + index + 1,
      }));

      if (appended.length === 0) throw new Error('A command must append at least one event.');
      const companionRows = companions.flatMap((write) => {
        if (!write.events.length) throw new Error('An atomic companion write must contain events.');
        return write.events.map((event, index) => ({
          eventId: globalThis.crypto.randomUUID(),
          worldInstanceId: request.worldInstanceId,
          streamId: write.streamId,
          streamVersion: write.expectedVersion + index + 1,
          type: event.type,
          contractVersion: event.version,
          payload: event.payload,
          causationCommandId: request.commandId,
          actorId: request.actorId,
          occurredAt: committedAt,
          tick: write.expectedVersion + index + 1,
        }));
      });
      const primaryRows = appended.map((event) => ({
        eventId: event.eventId,
        worldInstanceId: event.worldInstanceId,
        streamId: event.streamId,
        streamVersion: event.aggregateVersion,
        type: event.type,
        contractVersion: event.version,
        payload: event.payload,
        causationCommandId: event.causationCommandId,
        actorId: event.actorId,
        occurredAt: committedAt,
        tick: event.tick,
      }));
      const eventRows = [...companionRows, ...primaryRows];
      const receipt: Extract<CommandReceipt, { ok: true }> = {
        ok: true,
        commandId: request.commandId,
        eventIds: appended.map((event) => event.eventId),
        newAggregateVersion: appended.at(-1)?.aggregateVersion ?? currentRevision,
      };
      // Keep event rows and their idempotency receipt atomic, but pay for only
      // one database round trip. The command lock and receipt lookup above must
      // remain separate statements so the read gets a fresh snapshot after any
      // concurrent command finishes waiting on the lock.
      const insertedEvents = tx.$with('appended_events').as(
        tx.insert(gameEvents).values(eventRows).returning({ eventId: gameEvents.eventId }),
      );
      const insertedReceipt = tx.$with('appended_receipt').as(
        tx.insert(commandReceipts).values({
          worldInstanceId: request.worldInstanceId,
          actorId: request.actorId,
          commandId: request.commandId,
          payloadHash: request.payloadHash,
          streamId: request.streamId,
          receipt,
          events: appended,
        }).returning({ commandId: commandReceipts.commandId }),
      );
      const [persisted] = await appendStage('events_and_receipt_write', () =>
        tx.with(insertedEvents, insertedReceipt).select({
        eventCount: sql<number>`(SELECT count(*)::int FROM ${insertedEvents})`,
        receiptCount: sql<number>`(SELECT count(*)::int FROM ${insertedReceipt})`,
        }).from(insertedEvents).limit(1));
      if (persisted?.eventCount !== eventRows.length || persisted.receiptCount !== 1) {
        throw new Error('Command append did not persist its events and receipt.');
      }

      const effects = request.effects;
      if (effects?.length) {
        await appendStage('effects_write', () => tx.insert(durableEffects).values(effects.map((effect, index) => ({
          id: globalThis.crypto.randomUUID(),
          worldInstanceId: request.worldInstanceId,
          sourceStreamId: request.streamId,
          causationCommandId: request.commandId,
          effectType: effect.type,
          effectVersion: effect.version,
          payload: effect.payload,
          dedupeKey: `${commandEffectKeyPrefix(request.worldInstanceId, request.actorId, request.commandId)}${index}`,
        }))));
      }

      const materializedWrites = [
        {
          events: request.events,
          revision: currentRevision,
        },
        ...companions.map((write) => ({
          events: write.events,
          revision: write.expectedVersion,
        })),
      ];
      for (const write of materializedWrites) {
        for (const [index, event] of write.events.entries()) {
          const materializer = POSTGRES_APPEND_MATERIALIZERS.get(event.type);
          if (!materializer) continue;
          await materializer({
            tx,
            worldInstanceId: request.worldInstanceId,
            payload: event.payload,
            revision: write.revision + index + 1,
            committedAt,
          });
        }
      }

      await appendStage('room_state_projection', async () => {
        for (const write of writeDescriptors) {
          if (write.streamId === request.streamId) {
            await this.refreshRoomState(tx, request.worldInstanceId, write.streamId, write.streamKind, {
              expectedVersion: currentRevision,
              events: appended,
            }, this.scopedCommandReadCache(request.worldInstanceId, write.streamId) !== undefined);
          } else {
            await this.refreshRoomState(tx, request.worldInstanceId, write.streamId, write.streamKind);
          }
        }
      });
      return { kind: 'committed', streamId: request.streamId, events: appended, receipt };
    }));
  }

  private updateCachesAfterAppend(request: AppendRequest, outcome: AppendOutcome): void {
    if (outcome.kind === 'committed') {
      this.appendCachedStream(
        request.worldInstanceId,
        request.streamId,
        request.expectedVersion,
        outcome.events,
      );
      const scoped = this.scopedCommandReadCache(request.worldInstanceId, request.streamId);
      if (scoped) {
        const nextRevision = outcome.receipt.newAggregateVersion;
        const cached = this.streamCache.get(this.streamKey(request.worldInstanceId, request.streamId));
        if (scoped.revision === request.expectedVersion && scoped.events) {
          const nextEvents = [...scoped.events, ...outcome.events];
          retainCharacterReplayPrefix(nextEvents, scoped.events);
          scoped.events = nextEvents;
        } else {
          scoped.events = cached?.revision === nextRevision ? cached.events : undefined;
        }
        scoped.revision = nextRevision;
        scoped.expectedVersion = nextRevision;
      }
      for (const companion of request.companions ?? []) {
        this.invalidateStream(request.worldInstanceId, companion.streamId);
        this.invalidateCommandReadCache(request.worldInstanceId, companion.streamId);
      }
    } else {
      this.invalidateCommandReadCache(request.worldInstanceId, request.streamId);
      for (const companion of request.companions ?? []) {
        this.invalidateCommandReadCache(request.worldInstanceId, companion.streamId);
      }
    }
  }

  async claimNextEffect(
    leaseMs: number,
    worldInstanceId?: string,
    reservation?: CommandEffectReservation,
  ): Promise<StoredEventEffect | undefined> {
    return postgresEffectRepository.claimNextEffect(leaseMs, worldInstanceId, reservation);
  }

  async claimCommandEffect(leaseMs: number, scope: CommandEffectScope): Promise<StoredEventEffect | undefined> {
    return postgresEffectRepository.claimCommandEffect(leaseMs, scope);
  }

  async claimDueObjectLifecycles(
    worldInstanceId: string,
    now: Date,
    limit = 32,
    leaseMs = 60_000,
  ): Promise<Array<{ objectId: string; revision: number; leaseToken: string }>> {
    return postgresObjectLifecycleRepository.claimDueObjectLifecycles(worldInstanceId, now, limit, leaseMs);
  }

  async releaseObjectLifecycleClaim(
    worldInstanceId: string,
    objectId: string,
    leaseToken: string,
  ): Promise<void> {
    return postgresObjectLifecycleRepository.releaseObjectLifecycleClaim(worldInstanceId, objectId, leaseToken);
  }

  async completeEffect(effectId: string, leaseToken: string): Promise<boolean> {
    return postgresEffectRepository.completeEffect(effectId, leaseToken);
  }

  async retryEffect(
    effectId: string,
    leaseToken: string,
    delayMs: number,
    errorMessage: string,
  ): Promise<boolean> {
    return postgresEffectRepository.retryEffect(effectId, leaseToken, delayMs, errorMessage);
  }

  async deadLetterEffect(effectId: string, leaseToken: string, errorMessage: string): Promise<boolean> {
    return postgresEffectRepository.deadLetterEffect(effectId, leaseToken, errorMessage);
  }
}
