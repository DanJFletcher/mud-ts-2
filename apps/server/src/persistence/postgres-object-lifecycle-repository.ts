import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { worldObjectLifecycles } from '../db/schema.js';

export type ClaimedObjectLifecycle = {
  objectId: string;
  revision: number;
  leaseToken: string;
};

export const postgresObjectLifecycleRepository = {
  async claimDueObjectLifecycles(
    worldInstanceId: string,
    now: Date,
    limit = 32,
    leaseMs = 60_000,
  ): Promise<ClaimedObjectLifecycle[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Lifecycle batch size must be positive.');
    if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new RangeError('Lifecycle lease must be positive.');
    return db.transaction(async (tx) => {
      const rows = await tx.select({
        objectId: worldObjectLifecycles.objectId,
        revision: worldObjectLifecycles.revision,
      }).from(worldObjectLifecycles).where(and(
        eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
        inArray(worldObjectLifecycles.state, ['scheduled', 'expiring']),
        lte(worldObjectLifecycles.expiresAt, now),
        or(isNull(worldObjectLifecycles.leaseUntil), lte(worldObjectLifecycles.leaseUntil, now)),
      )).orderBy(asc(worldObjectLifecycles.expiresAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      const leaseUntil = new Date(now.getTime() + leaseMs);
      return Promise.all(rows.map(async (row) => {
        const leaseToken = randomUUID();
        await tx.update(worldObjectLifecycles).set({ leaseToken, leaseUntil }).where(and(
          eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
          eq(worldObjectLifecycles.objectId, row.objectId),
        ));
        return { objectId: row.objectId, revision: row.revision, leaseToken };
      }));
    });
  },

  async releaseObjectLifecycleClaim(
    worldInstanceId: string,
    objectId: string,
    leaseToken: string,
  ): Promise<void> {
    await db.update(worldObjectLifecycles).set({
      leaseToken: null,
      leaseUntil: null,
    }).where(and(
      eq(worldObjectLifecycles.worldInstanceId, worldInstanceId),
      eq(worldObjectLifecycles.objectId, objectId),
      eq(worldObjectLifecycles.leaseToken, leaseToken),
    ));
  },
};
