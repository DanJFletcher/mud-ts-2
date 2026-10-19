import {
  CharacterSharedItemReceivedEventSchema,
  InventoryItemProjectionSchema,
  WorldItemClaimedEventSchema,
  WorldItemDroppedEventSchema,
  WorldItemRecordSchema,
  type WorldItemRecord,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EnginePlugin,
  EventStorePort,
  ProposedEventEffect,
  QueryContext,
} from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';
import type { CapabilityToken } from '@mudd/contracts';
import { z } from 'zod';

export const WORLD_ITEMS_STREAM_ID = 'world-items';
export const WORLD_ITEM_DROP_EFFECT = 'world-item.drop';
export const WORLD_ITEM_CLAIM_EFFECT = 'world-item.claim';

export const worldItemsStreamId = (_worldInstanceId: string) => WORLD_ITEMS_STREAM_ID;

export interface WorldItemsState {
  revision: number;
  items: WorldItemRecord[];
}

export interface WorldItemsStateCapability {
  load(context: EngineCommandContext | QueryContext): Promise<WorldItemsState>;
}

export const worldItemsStateCapability = Object.freeze({
  id: 'mudd.world-items.state.v1',
  version: '1',
}) satisfies CapabilityToken<WorldItemsStateCapability>;

const WorldItemDropEffectSchema = z.object({
  worldItemId: z.string().min(1),
  fromCharacterId: z.string().min(1),
  locationId: z.string().min(1),
  item: InventoryItemProjectionSchema,
}).strict();

const WorldItemClaimEffectSchema = z.object({
  worldItemId: z.string().min(1),
  characterId: z.string().min(1),
  sourceLocationId: z.string().min(1),
  item: InventoryItemProjectionSchema,
}).strict();

export function worldItemDropEffect(
  payload: z.infer<typeof WorldItemDropEffectSchema>,
): ProposedEventEffect {
  return { type: WORLD_ITEM_DROP_EFFECT, version: 1, payload };
}

export function worldItemClaimEffect(
  payload: z.infer<typeof WorldItemClaimEffectSchema>,
): ProposedEventEffect {
  return { type: WORLD_ITEM_CLAIM_EFFECT, version: 1, payload };
}

export function projectWorldItems(
  events: readonly { type: string; version: number; aggregateVersion: number; payload: Readonly<Record<string, unknown>>; streamId?: string }[],
): WorldItemsState {
  const items = new Map<string, WorldItemRecord>();
  let revision = 0;
  for (const stored of events) {
    if (stored.aggregateVersion !== revision + 1) {
      throw new Error(`Non-contiguous world item revision at ${stored.aggregateVersion}.`);
    }
    const { streamId: _streamId, ...event } = stored;
    if (stored.type === 'world.item_dropped') {
      const dropped = WorldItemDroppedEventSchema.parse(event);
      const payload = dropped.payload;
      if (
        payload.worldItemId !== payload.item.id ||
        payload.worldItemId !== payload.item.sharedItemId ||
        payload.item.questBound === true
      ) {
        throw new Error(`Invalid shared item drop at revision ${stored.aggregateVersion}.`);
      }
      const previous = items.get(payload.worldItemId);
      if (previous) {
        if (
          previous.holderCharacterId !== payload.fromCharacterId ||
          previous.item.id !== payload.item.id ||
          previous.item.label !== payload.item.label ||
          previous.item.description !== payload.item.description
        ) {
          throw new Error(`Invalid shared item ownership transition at revision ${stored.aggregateVersion}.`);
        }
      }
      items.set(payload.worldItemId, WorldItemRecordSchema.parse({
        worldItemId: payload.worldItemId,
        item: payload.item,
        locationId: payload.locationId,
        holderCharacterId: null,
      }));
    } else if (stored.type === 'world.item_claimed') {
      const claimed = WorldItemClaimedEventSchema.parse(event);
      const previous = items.get(claimed.payload.worldItemId);
      if (!previous || previous.locationId !== claimed.payload.locationId) {
        throw new Error(`Invalid shared item claim at revision ${stored.aggregateVersion}.`);
      }
      items.set(previous.worldItemId, WorldItemRecordSchema.parse({
        ...previous,
        locationId: null,
        holderCharacterId: claimed.payload.characterId,
      }));
    } else {
      throw new Error(`Unsupported world item event "${stored.type}" at revision ${stored.aggregateVersion}.`);
    }
    revision = stored.aggregateVersion;
  }
  return { revision, items: [...items.values()] };
}

async function appendWorldDrop(
  store: EventStorePort,
  worldInstanceId: string,
  effectId: string,
  raw: unknown,
) {
  const payload = WorldItemDropEffectSchema.parse(raw);
  const commandId = `world-item-drop:${effectId}`;
  const payloadHash = `${payload.worldItemId}:${payload.fromCharacterId}:${payload.locationId}`;
  if (await store.lookupCommand(worldInstanceId, 'system:world-items', commandId, payloadHash)) return;
  const streamId = worldItemsStreamId(worldInstanceId);
  const events = await store.readStream(worldInstanceId, streamId);
  const state = projectWorldItems(events);
  const previous = state.items.find((item) => item.worldItemId === payload.worldItemId);
  if (previous && previous.locationId === payload.locationId && previous.item.id === payload.item.id) return;
  if (previous && previous.holderCharacterId !== payload.fromCharacterId) {
    throw new Error('The shared item is no longer held by the character dropping it.');
  }
  const eventPayload = {
    worldItemId: payload.worldItemId,
    fromCharacterId: payload.fromCharacterId,
    locationId: payload.locationId,
    item: payload.item,
  };
  WorldItemDroppedEventSchema.shape.payload.parse(eventPayload);
  const result = await store.append({
    worldInstanceId,
    streamId,
    actorId: 'system:world-items',
    commandId,
    payloadHash,
    expectedVersion: state.revision,
    events: [{ type: 'world.item_dropped', version: 1, payload: eventPayload }],
  });
  if (!result.receipt.ok) throw new Error('Could not commit the shared item drop.');
}

async function appendCharacterReceipt(
  store: EventStorePort,
  worldInstanceId: string,
  effectId: string,
  raw: unknown,
) {
  const payload = WorldItemClaimEffectSchema.parse(raw);
  const commandId = `world-item-claim:${effectId}`;
  const payloadHash = `${payload.worldItemId}:${payload.characterId}:${payload.sourceLocationId}`;
  if (await store.lookupCommand(worldInstanceId, 'system:world-items', commandId, payloadHash)) return;
  const events = await store.readStream(worldInstanceId, payload.characterId);
  const character = replayCharacter(events);
  if (!character) throw new Error('The shared item claimant has no character stream.');
  const carried = character.inventory.find((item) => item.id === payload.worldItemId);
  if (carried) {
    if (carried.sharedItemId !== payload.worldItemId) {
      throw new Error('A different item already uses the shared item ID.');
    }
    return;
  }
  const eventPayload = {
    characterId: payload.characterId,
    worldItemId: payload.worldItemId,
    sourceLocationId: payload.sourceLocationId,
    item: payload.item,
  };
  CharacterSharedItemReceivedEventSchema.shape.payload.parse(eventPayload);
  const result = await store.append({
    worldInstanceId,
    streamId: payload.characterId,
    actorId: 'system:world-items',
    commandId,
    payloadHash,
    expectedVersion: events.at(-1)?.aggregateVersion ?? 0,
    events: [{ type: 'character.shared_item_received', version: 1, payload: eventPayload }],
  });
  if (!result.receipt.ok) throw new Error('Could not add the claimed item to its character.');
}

export const worldItemsPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.world-items',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [worldItemsStateCapability.id],
    eventSchemaVersions: {
      'world.item_dropped': 1,
      'world.item_claimed': 1,
      'character.shared_item_received': 1,
    },
  },
  register({ provideCapability, registerEffect }) {
    const capability: WorldItemsStateCapability = {
      async load(context) {
        const events = await context.store.readStream(
          context.worldInstanceId,
          worldItemsStreamId(context.worldInstanceId),
        );
        return projectWorldItems(events);
      },
    };
    provideCapability(worldItemsStateCapability, capability);
    registerEffect(WORLD_ITEM_DROP_EFFECT, 1, WorldItemDropEffectSchema, async (payload, context) => {
      await appendWorldDrop(context.store, context.worldInstanceId, context.effectId, payload);
    });
    registerEffect(WORLD_ITEM_CLAIM_EFFECT, 1, WorldItemClaimEffectSchema, async (payload, context) => {
      await appendCharacterReceipt(context.store, context.worldInstanceId, context.effectId, payload);
    });
  },
};

export function createWorldItemDrop(
  worldItemId: string,
  fromCharacterId: string,
  locationId: string,
  sourceItem: WorldItemRecord['item'],
) {
  const item = { ...sourceItem, id: worldItemId, sharedItemId: worldItemId };
  return {
    item,
    effect: worldItemDropEffect({ worldItemId, fromCharacterId, locationId, item }),
  };
}
