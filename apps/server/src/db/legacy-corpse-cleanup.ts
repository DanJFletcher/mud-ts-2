import { createHash } from 'node:crypto';
import {
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
  projectWorldItems,
  worldItemsStreamId,
} from '@mudd/core-plugins';
import { SYSTEM_ACTOR_ID, type EventStorePort } from '@mudd/engine-core';

export interface LegacyCorpseCleanupSummary {
  worldsScanned: number;
  corpsesScheduled: number;
  corpsesAlreadyScheduled: number;
}

function stableCommandId(worldInstanceId: string, corpseId: string): string {
  const digest = createHash('sha256')
    .update(`${worldInstanceId}\u0000${corpseId}`)
    .digest('hex');
  return `legacy-corpse-lifecycle-v1:${digest}`;
}

/**
 * Add due lifecycle events for active corpses that predate lifecycle scheduling.
 *
 * Existing lifecycle histories are left untouched. The normal scheduler and
 * corpse-lifecycle handler perform expiration and apply the authored loot policy.
 */
export async function scheduleLegacyCorpseLifecycles(
  store: Pick<EventStorePort, 'readStream' | 'append'>,
  worldInstanceIds: readonly string[],
  now = new Date(),
): Promise<LegacyCorpseCleanupSummary> {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('A valid cleanup timestamp is required.');
  const expiresAt = now.toISOString();

  const summary: LegacyCorpseCleanupSummary = {
    worldsScanned: 0,
    corpsesScheduled: 0,
    corpsesAlreadyScheduled: 0,
  };

  for (const worldInstanceId of [...new Set(worldInstanceIds)]) {
    summary.worldsScanned += 1;
    const worldStreamId = worldItemsStreamId(worldInstanceId);
    const worldEvents = await store.readStream(worldInstanceId, worldStreamId);
    if (worldEvents.length === 0) continue;

    const createdAtByCorpseId = new Map<string, string>();
    for (const event of worldEvents) {
      if (event.type !== 'world.corpse_created') continue;
      const corpse = event.payload.corpse as { corpseId?: unknown; createdAt?: unknown } | undefined;
      if (typeof corpse?.corpseId !== 'string') continue;
      const createdAt = typeof corpse.createdAt === 'string' ? corpse.createdAt : event.occurredAt;
      createdAtByCorpseId.set(corpse.corpseId, createdAt);
    }

    const { corpses } = projectWorldItems(worldEvents);
    for (const corpse of corpses) {
      const lifecycleStreamIdValue = objectLifecycleStreamId(corpse.corpseId);
      const lifecycleHistory = await store.readStream(worldInstanceId, lifecycleStreamIdValue);
      if (lifecycleHistory.length > 0) {
        summary.corpsesAlreadyScheduled += 1;
        continue;
      }

      const createdAt = corpse.createdAt ?? createdAtByCorpseId.get(corpse.corpseId);
      if (!createdAt || !Number.isFinite(Date.parse(createdAt)) || Date.parse(createdAt) > nowMs) {
        throw new Error(`Cannot backfill lifecycle for corpse ${corpse.corpseId}: invalid creation time.`);
      }

      const payload = {
        objectId: corpse.corpseId,
        objectType: 'corpse',
        locationId: corpse.locationId,
        createdAt,
        expiresAt,
      };
      const result = await store.append({
        worldInstanceId,
        streamId: lifecycleStreamIdValue,
        actorId: SYSTEM_ACTOR_ID,
        commandId: stableCommandId(worldInstanceId, corpse.corpseId),
        payloadHash: JSON.stringify(payload),
        expectedVersion: 0,
        events: [objectLifecycleScheduledEvent(payload)],
      });

      if (result.receipt.ok) {
        if (result.kind === 'committed') summary.corpsesScheduled += 1;
        else summary.corpsesAlreadyScheduled += 1;
        continue;
      }

      // Another worker may have scheduled this corpse after our read.
      const currentHistory = await store.readStream(worldInstanceId, lifecycleStreamIdValue);
      if (currentHistory.length > 0) {
        summary.corpsesAlreadyScheduled += 1;
        continue;
      }
      throw new Error(
        `Could not schedule legacy corpse ${corpse.corpseId}: ${result.receipt.message}`,
      );
    }
  }

  return summary;
}
