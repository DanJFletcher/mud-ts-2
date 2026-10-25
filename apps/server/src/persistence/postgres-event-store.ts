import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { CommandReceipt } from '@mudd/contracts';
import type {
  AppendOutcome,
  AppendRequest,
  EventStorePort,
  StoredEventEffect,
  StoredGameEvent,
} from '@mudd/engine-core';
import { characters, commandReceipts, durableEffects, gameEvents, worldSessions, roomCharacterStates } from '../db/schema.js';
import { db } from '../db/client.js';
import { retainCharacterReplayPrefix, replayCharacter } from '@mudd/engine-core';
import { measureDatabaseOperation } from '../performance.js';

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

function toStoredEventEffect(
  row: typeof durableEffects.$inferSelect,
  leaseToken: string,
): StoredEventEffect {
  return {
    id: row.id,
    worldInstanceId: row.worldInstanceId,
    sourceStreamId: row.sourceStreamId,
    causationCommandId: row.causationCommandId,
    type: row.effectType,
    version: row.effectVersion,
    payload: row.payload,
    attempts: row.attempts,
    leaseToken,
  };
}

function conflict(
  commandId: string,
  message: string,
  code: Extract<CommandReceipt, { ok: false }>['code'] = 'VERSION_CONFLICT',
): Extract<CommandReceipt, { ok: false }> {
  return { ok: false, commandId, code, message, retryable: code === 'VERSION_CONFLICT' };
}

export class PostgresEventStore implements EventStorePort {
  private async refreshRoomState(
    tx: Pick<typeof db, 'select' | 'insert'>,
    worldInstanceId: string,
    streamId: string,
  ) {
    // Only character aggregates participate. Shared streams are text IDs.
    if (!/^[0-9a-f-]{36}$/i.test(streamId)) return;
    const [character] = await tx.select({ id: characters.id }).from(characters)
      .where(and(eq(characters.id, streamId), eq(characters.worldInstanceId, worldInstanceId))).limit(1);
    if (!character) return;
    const cached = this.streamCache.get(this.streamKey(worldInstanceId, streamId));
    const tail = (await tx.select().from(gameEvents).where(and(
      eq(gameEvents.worldInstanceId, worldInstanceId), eq(gameEvents.streamId, streamId),
      ...(cached ? [sql`${gameEvents.streamVersion} > ${cached.revision}`] : []),
    )).orderBy(asc(gameEvents.streamVersion))).map(toStoredGameEvent);
    const history = cached ? [...cached.events, ...tail] : tail;
    retainCharacterReplayPrefix(history, cached?.events);
    const state = replayCharacter(history);
    if (!state) throw new Error('Character room projection requires creation history.');
    const values = {
      characterId: streamId, worldInstanceId, locationId: state.locationId,
      revision: state.revision, schemaVersion: 1,
      state: {
        characterId: streamId, worldInstanceId, locationId: state.locationId,
        name: state.name, archived: state.archived,
        ...(state.health ? { health: state.health } : {}),
        ...(state.combat ? { combat: { status: state.combat.status } } : {}),
      },
    };
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
        await this.refreshRoomState(tx, row.world, row.id);
      });
    }
  }

  private readonly streamCache = new Map<string, {
    readonly revision: number;
    readonly events: readonly StoredGameEvent[];
    readonly bytes: number;
  }>();
  private cachedStreamBytes = 0;

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
    return measureDatabaseOperation('event_store.stream_revision_lookup', async () => {
      const [head] = await db.select({ revision: gameEvents.streamVersion }).from(gameEvents)
        .where(and(eq(gameEvents.worldInstanceId, worldInstanceId), eq(gameEvents.streamId, streamId)))
        .orderBy(desc(gameEvents.streamVersion)).limit(1);
      return head?.revision ?? 0;
    });
  }

  async readStream(worldInstanceId: string, streamId: string): Promise<readonly StoredGameEvent[]> {
    const revision = await this.readStreamRevision(worldInstanceId, streamId);
    return this.readStreamAtRevision(worldInstanceId, streamId, revision);
  }

  async readStreams(
    worldInstanceId: string,
    streamIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly StoredGameEvent[]>> {
    const uniqueStreamIds = [...new Set(streamIds)];
    if (uniqueStreamIds.length === 0) return new Map();

    const revisions = await measureDatabaseOperation('event_store.stream_revisions_lookup', async () => {
      const rows = await db.select({
        streamId: gameEvents.streamId,
        revision: sql<number>`max(${gameEvents.streamVersion})`,
      }).from(gameEvents).where(and(
        eq(gameEvents.worldInstanceId, worldInstanceId),
        inArray(gameEvents.streamId, uniqueStreamIds),
      )).groupBy(gameEvents.streamId);
      return new Map(rows.map((row) => [row.streamId, Number(row.revision)]));
    });

    const entries = await Promise.all(uniqueStreamIds.map(async (streamId) => [
      streamId,
      await this.readStreamAtRevision(worldInstanceId, streamId, revisions.get(streamId) ?? 0),
    ] as const));
    return new Map(entries);
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
    const outcome = await measureDatabaseOperation('event_store.command_append', () => db.transaction(async (tx): Promise<AppendOutcome> => {
      // Lock command identity first so retries cannot race across different stream IDs.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtext(${request.worldInstanceId}), hashtext(${`${request.actorId}:${request.commandId}`}))`);
      const [prior] = await tx.select().from(commandReceipts).where(and(
        eq(commandReceipts.worldInstanceId, request.worldInstanceId),
        eq(commandReceipts.actorId, request.actorId),
        eq(commandReceipts.commandId, request.commandId),
      )).limit(1);
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
      const writeIds = [request.streamId, ...companions.map((write) => write.streamId)];
      if (new Set(writeIds).size !== writeIds.length) throw new Error('Duplicate atomic write stream.');
      const checks = [...companions, ...(request.guards ?? [])];
      // A deterministic lock order avoids deadlocks across encounter/character writers.
      for (const streamId of [...new Set([...writeIds, ...checks.map((check) => check.streamId)])].sort()) {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtext(${request.worldInstanceId}), hashtext(${streamId}))`);
      }
      for (const check of checks) {
        const [observed] = await tx.select({ revision: gameEvents.streamVersion }).from(gameEvents)
          .where(and(eq(gameEvents.worldInstanceId, request.worldInstanceId), eq(gameEvents.streamId, check.streamId)))
          .orderBy(desc(gameEvents.streamVersion)).limit(1);
        if ((observed?.revision ?? 0) !== check.expectedVersion) {
          return { kind: 'conflict', streamId: request.streamId, events: [],
            receipt: conflict(request.commandId, 'An observed stream changed. Refresh and try again.') };
        }
      }
      const [last] = await tx.select({ revision: gameEvents.streamVersion }).from(gameEvents)
        .where(and(eq(gameEvents.worldInstanceId, request.worldInstanceId), eq(gameEvents.streamId, request.streamId)))
        .orderBy(desc(gameEvents.streamVersion)).limit(1);
      const currentRevision = last?.revision ?? 0;
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
      for (const write of companions) {
        if (!write.events.length) throw new Error('An atomic companion write must contain events.');
        await tx.insert(gameEvents).values(write.events.map((event, index) => ({
          eventId: globalThis.crypto.randomUUID(), worldInstanceId: request.worldInstanceId,
          streamId: write.streamId, streamVersion: write.expectedVersion + index + 1,
          type: event.type, contractVersion: event.version, payload: event.payload,
          causationCommandId: request.commandId, actorId: request.actorId,
          occurredAt: committedAt, tick: write.expectedVersion + index + 1,
        })));
      }
      await tx.insert(gameEvents).values(appended.map((event) => ({
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
      })));

      if (request.effects?.length) {
        await tx.insert(durableEffects).values(request.effects.map((effect, index) => ({
          id: globalThis.crypto.randomUUID(),
          worldInstanceId: request.worldInstanceId,
          sourceStreamId: request.streamId,
          causationCommandId: request.commandId,
          effectType: effect.type,
          effectVersion: effect.version,
          payload: effect.payload,
          dedupeKey: `command:${request.worldInstanceId}:${request.actorId}:${request.commandId}:${index}`,
        })));
      }

      for (const event of appended) {
        if (event.type === 'character.created') {
          await tx.insert(characters).values({
            id: String(event.payload.characterId),
            playerId: String(event.payload.playerId),
            worldInstanceId: event.worldInstanceId,
            name: String(event.payload.name),
          }).onConflictDoNothing();
        } else if (event.type === 'character.renamed') {
          await tx.update(characters)
            .set({ name: String(event.payload.name) })
            .where(and(
              eq(characters.id, String(event.payload.characterId)),
              eq(characters.worldInstanceId, event.worldInstanceId),
            ));
        } else if (event.type === 'character.archived') {
          await tx.execute(sql`SELECT id FROM characters WHERE id = ${String(event.payload.characterId)} FOR UPDATE`);
          const [activeSession] = await tx.select({ id: worldSessions.id }).from(worldSessions)
            .where(eq(worldSessions.characterId, String(event.payload.characterId))).limit(1);
          if (activeSession) throw new Error('Leave the world before archiving this character.');
          await tx.update(characters)
            .set({ archivedAt: new Date(event.occurredAt) })
            .where(and(
              eq(characters.id, String(event.payload.characterId)),
              eq(characters.worldInstanceId, event.worldInstanceId),
            ));
        } else if (event.type === 'character.restored') {
          await tx.update(characters)
            .set({ archivedAt: null })
            .where(and(
              eq(characters.id, String(event.payload.characterId)),
              eq(characters.worldInstanceId, event.worldInstanceId),
            ));
        }
      }

      for (const streamId of writeIds) {
        await this.refreshRoomState(tx, request.worldInstanceId, streamId);
      }
      const receipt: Extract<CommandReceipt, { ok: true }> = {
        ok: true,
        commandId: request.commandId,
        eventIds: appended.map((event) => event.eventId),
        newAggregateVersion: appended.at(-1)?.aggregateVersion ?? currentRevision,
      };
      await tx.insert(commandReceipts).values({
        worldInstanceId: request.worldInstanceId,
        actorId: request.actorId,
        commandId: request.commandId,
        payloadHash: request.payloadHash,
        streamId: request.streamId,
        receipt,
        events: appended,
      });
      return { kind: 'committed', streamId: request.streamId, events: appended, receipt };
    }));
    if (outcome.kind === 'committed') {
      this.appendCachedStream(
        request.worldInstanceId,
        request.streamId,
        request.expectedVersion,
        outcome.events,
      );
      for (const companion of request.companions ?? []) {
        this.invalidateStream(request.worldInstanceId, companion.streamId);
      }
    }
    return outcome;
  }

  async claimNextEffect(leaseMs: number, worldInstanceId?: string): Promise<StoredEventEffect | undefined> {
    if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new RangeError('Effect lease must be a positive integer.');
    return db.transaction(async (tx) => {
      const now = new Date();
      const [pending] = await tx.select().from(durableEffects).where(and(
        ...(worldInstanceId ? [eq(durableEffects.worldInstanceId, worldInstanceId)] : []),
        lte(durableEffects.availableAt, now),
        or(
          eq(durableEffects.status, 'pending'),
          and(
            eq(durableEffects.status, 'processing'),
            or(isNull(durableEffects.lockedUntil), lte(durableEffects.lockedUntil, now)),
          ),
        ),
      )).orderBy(asc(durableEffects.createdAt), asc(durableEffects.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!pending) return undefined;

      const leaseToken = globalThis.crypto.randomUUID();
      const [claimed] = await tx.update(durableEffects).set({
        status: 'processing',
        attempts: sql`${durableEffects.attempts} + 1`,
        lockedUntil: new Date(now.getTime() + leaseMs),
        leaseToken,
      }).where(eq(durableEffects.id, pending.id)).returning();
      return claimed ? toStoredEventEffect(claimed, leaseToken) : undefined;
    });
  }

  async completeEffect(effectId: string, leaseToken: string): Promise<boolean> {
    const rows = await db.update(durableEffects).set({
      status: 'completed',
      lockedUntil: null,
      leaseToken: null,
      lastError: null,
      completedAt: new Date(),
    }).where(and(
      eq(durableEffects.id, effectId),
      eq(durableEffects.status, 'processing'),
      eq(durableEffects.leaseToken, leaseToken),
    )).returning({ id: durableEffects.id });
    return rows.length > 0;
  }

  async retryEffect(
    effectId: string,
    leaseToken: string,
    delayMs: number,
    errorMessage: string,
  ): Promise<boolean> {
    if (!Number.isInteger(delayMs) || delayMs < 0) throw new RangeError('Effect retry delay must be non-negative.');
    const rows = await db.update(durableEffects).set({
      status: 'pending',
      availableAt: sql`now() + (${delayMs} * interval '1 millisecond')`,
      lockedUntil: null,
      leaseToken: null,
      lastError: errorMessage.slice(0, 500),
    }).where(and(
      eq(durableEffects.id, effectId),
      eq(durableEffects.status, 'processing'),
      eq(durableEffects.leaseToken, leaseToken),
    )).returning({ id: durableEffects.id });
    return rows.length > 0;
  }

  async deadLetterEffect(effectId: string, leaseToken: string, errorMessage: string): Promise<boolean> {
    const rows = await db.update(durableEffects).set({
      status: 'dead',
      lockedUntil: null,
      leaseToken: null,
      lastError: errorMessage.slice(0, 500),
    }).where(and(
      eq(durableEffects.id, effectId),
      eq(durableEffects.status, 'processing'),
      eq(durableEffects.leaseToken, leaseToken),
    )).returning({ id: durableEffects.id });
    return rows.length > 0;
  }
}
