import { z } from 'zod';
import {
  CharacterCorpseGoldReceivedEventSchema,
  CharacterSharedItemReceivedEventSchema,
  ObjectExpiringEventSchema,
  WorldCorpseExpiredEventSchema,
} from '@mudd/contracts';
import {
  SYSTEM_ACTOR_ID,
  type EnginePlugin,
  type EventEffectContext,
} from '@mudd/engine-core';
import {
  objectLifecycleExpiredEvent,
  objectLifecycleStreamId,
  projectObjectLifecycle,
} from './object-lifecycle.js';
import { projectWorldItems, worldItemsStreamId } from './world-items.js';
import { roomAnnouncementEffect } from './room-announcements.js';

const ObjectExpiringPayloadSchema = ObjectExpiringEventSchema.shape.payload;
const SharedItemReceivedPayloadSchema = CharacterSharedItemReceivedEventSchema.shape.payload;
const CorpseGoldReceivedPayloadSchema = CharacterCorpseGoldReceivedEventSchema.shape.payload;
const CorpseExpiredPayloadSchema = WorldCorpseExpiredEventSchema.shape.payload;

async function expireCorpse(
  payload: z.infer<typeof ObjectExpiringPayloadSchema>,
  context: EventEffectContext,
) {
  if (payload.objectType !== 'corpse') return;
  const lifecycleStreamIdValue = objectLifecycleStreamId(payload.objectId);
  const lifecycleEvents = await context.store.readStream(context.worldInstanceId, lifecycleStreamIdValue);
  const lifecycle = projectObjectLifecycle(lifecycleEvents);
  if (!lifecycle || lifecycle.state !== 'expiring' || lifecycle.expiresAt !== payload.expiresAt) return;

  const worldStreamId = worldItemsStreamId(context.worldInstanceId);
  const worldEvents = await context.store.readStream(context.worldInstanceId, worldStreamId);
  const itemsState = projectWorldItems(worldEvents);
  const corpse = itemsState.corpses.find((entry) => entry.corpseId === payload.objectId);
  if (!corpse) {
    const result = await context.store.append({
      worldInstanceId: context.worldInstanceId,
      streamId: lifecycleStreamIdValue,
      actorId: SYSTEM_ACTOR_ID,
      commandId: `object-expired-missing:${context.effectId}`,
      payloadHash: `${payload.objectId}:${payload.expiresAt}:missing`,
      expectedVersion: lifecycle.revision,
      events: [objectLifecycleExpiredEvent({
        objectId: payload.objectId,
        objectType: 'corpse',
        locationId: payload.locationId,
        expiredAt: context.now().toISOString(),
      })],
    });
    if (!result.receipt.ok) throw new Error('Could not finalize the missing corpse lifecycle.');
    return;
  }

  const policy = corpse.expirationPolicy ??
    (corpse.corpseType === 'player'
      ? context.world.corpseLifecycle.playerExpirationPolicy
      : context.world.corpseLifecycle.npcExpirationPolicy);
  if (policy === 'recovery-storage' && !corpse.ownerCharacterId) {
    throw new Error(`Corpse ${corpse.corpseId} requires an owner for recovery storage.`);
  }

  const worldState = projectWorldItems(worldEvents);
  const corpseItems = worldState.items.filter((item) => item.containerId === corpse.corpseId);
  const expiredAt = context.now().toISOString();
  const corpseExpiredPayload = CorpseExpiredPayloadSchema.parse({
    corpseId: corpse.corpseId,
    corpseName: corpse.opponentName,
    locationId: corpse.locationId,
    policy,
    expiredAt,
  });
  const companions: Array<{
    streamId: string;
    expectedVersion: number;
    events: Array<{ type: string; version: number; payload: Record<string, unknown> }>;
  }> = [{
    streamId: lifecycleStreamIdValue,
    expectedVersion: lifecycle.revision,
    events: [objectLifecycleExpiredEvent({
      objectId: corpse.corpseId,
      objectType: 'corpse',
      locationId: corpse.locationId,
      expiredAt,
    })],
  }];

  if (policy === 'recovery-storage' && corpse.ownerCharacterId) {
    const ownerHistory = await context.store.readStream(context.worldInstanceId, corpse.ownerCharacterId);
    companions.push({
      streamId: corpse.ownerCharacterId,
      expectedVersion: ownerHistory.at(-1)?.aggregateVersion ?? 0,
      events: corpseItems.map(({ worldItemId, item }) => ({
        type: 'character.shared_item_received',
        version: 1,
        payload: SharedItemReceivedPayloadSchema.parse({
          characterId: corpse.ownerCharacterId,
          worldItemId,
          sourceLocationId: corpse.locationId,
          item,
        }),
      })),
    });
    if (corpse.currencyAmount > 0 && corpse.currencyId && !corpse.goldClaimed) {
      const existing = companions.find((entry) => entry.streamId === corpse.ownerCharacterId);
      existing?.events.push({
        type: 'character.corpse_gold_received',
        version: 1,
        payload: CorpseGoldReceivedPayloadSchema.parse({
          characterId: corpse.ownerCharacterId,
          corpseId: corpse.corpseId,
          currencyId: corpse.currencyId,
          amount: corpse.currencyAmount,
        }),
      });
    }
  }

  const result = await context.store.append({
    worldInstanceId: context.worldInstanceId,
    streamId: worldStreamId,
    actorId: SYSTEM_ACTOR_ID,
    commandId: `corpse-expire:${context.effectId}`,
    payloadHash: JSON.stringify(corpseExpiredPayload),
    expectedVersion: worldState.revision,
    events: [{ type: 'world.corpse_expired', version: 1, payload: corpseExpiredPayload }],
    companions,
    effects: [roomAnnouncementEffect(
      corpse.locationId,
      policy === 'drop'
        ? `The remains of ${corpse.opponentName} crumble away, leaving their belongings behind.`
        : policy === 'recovery-storage'
          ? `The remains of ${corpse.opponentName} fade; the belongings left behind are returned to their owner.`
          : `The remains of ${corpse.opponentName} crumble into dust.`,
    )],
  });
  if (!result.receipt.ok) throw new Error('Could not atomically expire the corpse and resolve its contents.');
}

export const corpseLifecyclePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.corpse-lifecycle',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    eventSchemaVersions: {
      'world.object_expiring': 1,
      'world.object_expired': 1,
      'world.corpse_expired': 1,
    },
  },
  register({ registerEventHandler }) {
    registerEventHandler(
      'world.object_expiring',
      1,
      ObjectExpiringPayloadSchema,
      async (payload, context) => expireCorpse(payload, context),
    );
  },
};
