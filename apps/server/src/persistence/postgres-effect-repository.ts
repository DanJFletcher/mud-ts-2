import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type {
  CommandEffectReservation,
  CommandEffectScope,
  StoredEventEffect,
} from '@mudd/engine-core';
import { db } from '../db/client.js';
import { durableEffects } from '../db/schema.js';

/** Each effect a command queues is keyed by this prefix plus its index. */
export function commandEffectKeyPrefix(worldInstanceId: string, actorId: string, commandId: string) {
  return `command:${worldInstanceId}:${actorId}:${commandId}:`;
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

async function claimDueEffect(leaseMs: number, ...filters: SQL[]): Promise<StoredEventEffect | undefined> {
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new RangeError('Effect lease must be a positive integer.');
  // Availability is written with the database clock (column default and
  // retryEffect), so compare with it too: a JavaScript Date has only millisecond
  // precision and can read an effect queued "now" as not yet due.
  const now = sql`now()`;
  const leaseToken = randomUUID();
  // Lock and lease the next due effect in one autocommit statement, so an empty
  // poll costs one round trip rather than a three-statement transaction. SKIP
  // LOCKED still keeps concurrent workers from claiming the same row.
  const nextDue = db.select({ id: durableEffects.id }).from(durableEffects).where(and(
    ...filters,
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
  const [claimed] = await db.update(durableEffects).set({
    status: 'processing',
    attempts: sql`${durableEffects.attempts} + 1`,
    lockedUntil: sql`now() + (${leaseMs} * interval '1 millisecond')`,
    leaseToken,
  }).where(eq(durableEffects.id, sql`${nextDue}`)).returning();
  return claimed ? toStoredEventEffect(claimed, leaseToken) : undefined;
}

export const postgresEffectRepository = {
  async claimNextEffect(
    leaseMs: number,
    worldInstanceId?: string,
    reservation?: CommandEffectReservation,
  ): Promise<StoredEventEffect | undefined> {
    if (reservation && (!Number.isInteger(reservation.graceMs) || reservation.graceMs < 0)) {
      throw new RangeError('Effect reservation grace must be a non-negative integer.');
    }
    return claimDueEffect(
      leaseMs,
      ...(worldInstanceId ? [eq(durableEffects.worldInstanceId, worldInstanceId)] : []),
      // Skip a reserved effect while its own command may still settle it; the
      // created_at default uses the database clock, so compare with it too.
      ...(reservation && reservation.types.length > 0
        ? [or(
          notInArray(durableEffects.effectType, [...reservation.types]),
          gt(durableEffects.attempts, 0),
          lte(
            durableEffects.createdAt,
            sql`now() - (${reservation.graceMs} * interval '1 millisecond')`,
          ),
        )!]
        : []),
    );
  },

  async claimCommandEffect(leaseMs: number, scope: CommandEffectScope): Promise<StoredEventEffect | undefined> {
    if (scope.types.length === 0) return undefined;
    // The causation ID alone is client-chosen and can repeat across players;
    // the dedupe key also names the actor. Only pending and processing rows
    // can match, and the existing pending-effects index finds those.
    return claimDueEffect(
      leaseMs,
      eq(durableEffects.worldInstanceId, scope.worldInstanceId),
      eq(durableEffects.causationCommandId, scope.commandId),
      sql`starts_with(${durableEffects.dedupeKey}, ${commandEffectKeyPrefix(
        scope.worldInstanceId,
        scope.actorId,
        scope.commandId,
      )})`,
      inArray(durableEffects.effectType, [...scope.types]),
    );
  },

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
  },

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
  },

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
  },
};
