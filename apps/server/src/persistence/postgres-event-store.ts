import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { CommandReceipt } from '@mudd/contracts';
import type { AppendOutcome, AppendRequest, EventStorePort, StoredGameEvent } from '@mudd/engine-core';
import { characters, commandReceipts, gameEvents, worldSessions } from '../db/schema.js';
import { db } from '../db/client.js';

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

function conflict(
  commandId: string,
  message: string,
  code: Extract<CommandReceipt, { ok: false }>['code'] = 'VERSION_CONFLICT',
): Extract<CommandReceipt, { ok: false }> {
  return { ok: false, commandId, code, message, retryable: code === 'VERSION_CONFLICT' };
}

export class PostgresEventStore implements EventStorePort {
  async readStream(worldInstanceId: string, streamId: string): Promise<readonly StoredGameEvent[]> {
    const rows = await db.select().from(gameEvents)
      .where(and(eq(gameEvents.worldInstanceId, worldInstanceId), eq(gameEvents.streamId, streamId)))
      .orderBy(gameEvents.streamVersion);
    return rows.map(toStoredGameEvent);
  }

  async lookupCommand(
    worldInstanceId: string,
    actorId: string,
    commandId: string,
    payloadHash: string,
  ): Promise<AppendOutcome | undefined> {
    const [prior] = await db.select().from(commandReceipts).where(and(
      eq(commandReceipts.worldInstanceId, worldInstanceId),
      eq(commandReceipts.actorId, actorId),
      eq(commandReceipts.commandId, commandId),
    )).limit(1);
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
    return db.transaction(async (tx) => {
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

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtext(${request.worldInstanceId}), hashtext(${request.streamId}))`);
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
    });
  }
}
