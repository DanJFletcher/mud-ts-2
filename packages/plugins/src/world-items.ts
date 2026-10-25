import {
  CharacterCorpseGoldReceivedEventSchema,
  CharacterSharedItemReceivedEventSchema,
  InventoryItemProjectionSchema,
  WorldCorpseCreatedEventSchema,
  WorldCorpseGoldClaimedEventSchema,
  WorldCorpseRecordSchema,
  WorldItemClaimedEventSchema,
  WorldItemsConsumedEventSchema,
  WorldItemDroppedEventSchema,
  WorldItemRecordSchema,
  type CombatLootDefinition,
  type WorldCorpseRecord,
  type WorldItemRecord,
} from '@mudd/contracts';
import {
  SYSTEM_ACTOR_ID,
  replayCharacter,
} from '@mudd/engine-core';
import type {
  EngineCommandContext,
  EnginePlugin,
  EventStorePort,
  ProposedEventEffect,
  QueryContext,
} from '@mudd/engine-core';
import type { CapabilityToken } from '@mudd/contracts';
import { z } from 'zod';

export const WORLD_ITEMS_STREAM_ID = 'world-items';
export const WORLD_ITEM_DROP_EFFECT = 'world-item.drop';
export const WORLD_ITEM_CLAIM_EFFECT = 'world-item.claim';
export const WORLD_CORPSE_CREATE_EFFECT = 'world-corpse.create';
export const WORLD_CORPSE_GOLD_CREDIT_EFFECT = 'world-corpse.gold-credit';

export const worldItemsStreamId = (_worldInstanceId: string) => WORLD_ITEMS_STREAM_ID;

export interface WorldItemsState {
  revision: number;
  items: WorldItemRecord[];
  corpses: WorldCorpseRecord[];
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

const WorldCorpseCreateEffectSchema = WorldCorpseCreatedEventSchema.shape.payload;
const WorldCorpseGoldCreditEffectSchema = z.object({
  characterId: z.string().min(1),
  corpseId: z.string().min(1),
  currencyId: z.string().min(1),
  amount: z.number().int().positive().max(2_147_483_647),
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

export function worldCorpseGoldCreditEffect(
  payload: z.infer<typeof WorldCorpseGoldCreditEffectSchema>,
): ProposedEventEffect {
  return {
    type: WORLD_CORPSE_GOLD_CREDIT_EFFECT,
    version: 1,
    payload,
  };
}

export function createWorldCorpseEffect(
  makeId: () => string,
  input: {
    encounterId: string;
    opponentId: string;
    opponentName: string;
    locationId: string;
    loot?: CombatLootDefinition;
    currencyId?: string;
    currencyName?: string;
  },
): ProposedEventEffect {
  const loot = input.loot;
  const currencyAmount = loot?.currencyAmount ?? 0;
  const corpseId = `corpse:${makeId()}`;
  const goldItemId = currencyAmount > 0 ? `corpse-gold:${makeId()}` : undefined;
  if (currencyAmount > 0 && (!input.currencyId || !input.currencyName)) {
    throw new Error('Combatant currency loot requires the world currency definition.');
  }
  const corpse = WorldCorpseRecordSchema.parse({
    corpseId,
    encounterId: input.encounterId,
    opponentId: input.opponentId,
    opponentName: input.opponentName,
    label: `${input.opponentName}’s corpse`,
    description: `The body of ${input.opponentName} lies here.`,
    locationId: input.locationId,
    ...(currencyAmount > 0 ? { currencyId: input.currencyId } : {}),
    currencyAmount,
    ...(goldItemId ? { goldItemId } : {}),
    goldClaimed: false,
  });
  const items = (loot?.items ?? []).map((template) => {
    const worldItemId = `corpse-item:${makeId()}`;
    return {
      worldItemId,
      item: InventoryItemProjectionSchema.parse({
        id: worldItemId,
        sharedItemId: worldItemId,
        ...(template.typeId ? { typeId: template.typeId } : {}),
        label: template.label,
        description: template.description,
        ...(template.consumable ? { consumable: template.consumable } : {}),
        ...(template.equipment ? { equipment: template.equipment } : {}),
      }),
    };
  });
  const payload = WorldCorpseCreatedEventSchema.shape.payload.parse({ corpse, items });
  return {
    type: WORLD_CORPSE_CREATE_EFFECT,
    version: 1,
    payload,
  };
}

export function projectWorldItems(
  events: readonly { type: string; version: number; aggregateVersion: number; payload: Readonly<Record<string, unknown>>; streamId?: string }[],
): WorldItemsState {
  const items = new Map<string, WorldItemRecord>();
  const corpses = new Map<string, WorldCorpseRecord>();
  const consumedIds = new Set<string>();
  let revision = 0;
  for (const stored of events) {
    if (stored.aggregateVersion !== revision + 1) {
      throw new Error(`Non-contiguous world item revision at ${stored.aggregateVersion}.`);
    }
    const { streamId: _streamId, ...event } = stored;
    if (stored.type === 'world.items_consumed') {
      const consumed = WorldItemsConsumedEventSchema.parse(event).payload;
      for (const id of consumed.worldItemIds) {
        if (items.get(id)?.holderCharacterId !== consumed.characterId) throw new Error('Invalid shared item consumption.');
        items.delete(id);
        consumedIds.add(id);
      }
    } else if (stored.type === 'world.item_dropped') {
      const dropped = WorldItemDroppedEventSchema.parse(event);
      const payload = dropped.payload;
      if (
        consumedIds.has(payload.worldItemId) ||
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
    } else if (stored.type === 'world.corpse_created') {
      const created = WorldCorpseCreatedEventSchema.parse(event);
      const corpse = created.payload.corpse;
      if (corpses.has(corpse.corpseId)) {
        throw new Error(`Duplicate corpse creation at revision ${stored.aggregateVersion}.`);
      }
      for (const { worldItemId, item } of created.payload.items) {
        if (
          worldItemId !== item.id ||
          item.sharedItemId !== worldItemId ||
          item.questBound === true ||
          consumedIds.has(worldItemId) ||
          items.has(worldItemId) ||
          created.payload.items.filter((candidate) => candidate.worldItemId === worldItemId).length > 1
        ) {
          throw new Error(`Invalid corpse loot item at revision ${stored.aggregateVersion}.`);
        }
        items.set(worldItemId, WorldItemRecordSchema.parse({
          worldItemId,
          item,
          locationId: corpse.locationId,
          holderCharacterId: null,
          containerId: corpse.corpseId,
        }));
      }
      corpses.set(corpse.corpseId, corpse);
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
    } else if (stored.type === 'world.corpse_gold_claimed') {
      const claimed = WorldCorpseGoldClaimedEventSchema.parse(event);
      const previous = corpses.get(claimed.payload.corpseId);
      if (
        !previous ||
        previous.locationId !== claimed.payload.locationId ||
        previous.currencyId !== claimed.payload.currencyId ||
        previous.currencyAmount !== claimed.payload.amount ||
        previous.goldClaimed
      ) {
        throw new Error(`Invalid corpse gold claim at revision ${stored.aggregateVersion}.`);
      }
      corpses.set(previous.corpseId, WorldCorpseRecordSchema.parse({
        ...previous,
        goldClaimed: true,
      }));
    } else {
      throw new Error(`Unsupported world item event "${stored.type}" at revision ${stored.aggregateVersion}.`);
    }
    revision = stored.aggregateVersion;
  }
  return { revision, items: [...items.values()], corpses: [...corpses.values()] };
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
  if (await store.lookupCommand(worldInstanceId, SYSTEM_ACTOR_ID, commandId, payloadHash)) return;
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
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion: state.revision,
    events: [{ type: 'world.item_dropped', version: 1, payload: eventPayload }],
  });
  if (!result.receipt.ok) throw new Error('Could not commit the shared item drop.');
}

async function appendWorldCorpse(
  store: EventStorePort,
  worldInstanceId: string,
  effectId: string,
  raw: unknown,
) {
  const payload = WorldCorpseCreateEffectSchema.parse(raw);
  const commandId = `world-corpse-create:${effectId}`;
  const payloadHash = JSON.stringify(payload);
  if (await store.lookupCommand(worldInstanceId, SYSTEM_ACTOR_ID, commandId, payloadHash)) return;
  const streamId = worldItemsStreamId(worldInstanceId);
  const events = await store.readStream(worldInstanceId, streamId);
  const state = projectWorldItems(events);
  const existing = state.corpses.find((corpse) => corpse.corpseId === payload.corpse.corpseId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(payload.corpse)) {
      throw new Error('The corpse ID already exists with different contents.');
    }
    return;
  }
  const result = await store.append({
    worldInstanceId,
    streamId,
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion: state.revision,
    events: [{ type: 'world.corpse_created', version: 1, payload }],
  });
  if (!result.receipt.ok) throw new Error('Could not commit the shared corpse.');
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
  if (await store.lookupCommand(worldInstanceId, SYSTEM_ACTOR_ID, commandId, payloadHash)) return;
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
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion: events.at(-1)?.aggregateVersion ?? 0,
    events: [{ type: 'character.shared_item_received', version: 1, payload: eventPayload }],
  });
  if (!result.receipt.ok) throw new Error('Could not add the claimed item to its character.');
}

async function appendCorpseGoldCredit(
  store: EventStorePort,
  worldInstanceId: string,
  effectId: string,
  raw: unknown,
) {
  const payload = WorldCorpseGoldCreditEffectSchema.parse(raw);
  const commandId = `world-corpse-gold-credit:${effectId}`;
  const payloadHash = `${payload.characterId}:${payload.corpseId}:${payload.currencyId}:${payload.amount}`;
  if (await store.lookupCommand(worldInstanceId, SYSTEM_ACTOR_ID, commandId, payloadHash)) return;
  const events = await store.readStream(worldInstanceId, payload.characterId);
  const character = replayCharacter(events);
  if (!character) throw new Error('The corpse gold recipient has no character stream.');
  if (character.claimedCorpseGoldIds.includes(payload.corpseId)) return;
  if (
    !character.wallet ||
    character.wallet.currencyId !== payload.currencyId ||
    character.wallet.balance > 2_147_483_647 - payload.amount
  ) {
    throw new Error('The corpse gold recipient cannot receive this currency amount.');
  }
  const eventPayload = {
    characterId: payload.characterId,
    corpseId: payload.corpseId,
    currencyId: payload.currencyId,
    amount: payload.amount,
  };
  CharacterCorpseGoldReceivedEventSchema.shape.payload.parse(eventPayload);
  const result = await store.append({
    worldInstanceId,
    streamId: payload.characterId,
    actorId: SYSTEM_ACTOR_ID,
    commandId,
    payloadHash,
    expectedVersion: events.at(-1)?.aggregateVersion ?? 0,
    events: [{ type: 'character.corpse_gold_received', version: 1, payload: eventPayload }],
  });
  if (!result.receipt.ok) throw new Error('Could not add the corpse gold to the character wallet.');
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
      'world.corpse_created': 1,
      'world.corpse_gold_claimed': 1,
      'character.shared_item_received': 1,
      'character.corpse_gold_received': 1,
    },
  },
  register({ provideCapability, registerEffect }) {
    const projectionCache = new Map<string, {
      revision: number;
      state: WorldItemsState;
    }>();
    const capability: WorldItemsStateCapability = {
      async load(context) {
        const events = await context.store.readStream(
          context.worldInstanceId,
          worldItemsStreamId(context.worldInstanceId),
        );
        const revision = events.at(-1)?.aggregateVersion ?? 0;
        const cached = projectionCache.get(context.worldInstanceId);
        if (cached?.revision === revision) {
          projectionCache.delete(context.worldInstanceId);
          projectionCache.set(context.worldInstanceId, cached);
          return structuredClone(cached.state);
        }

        const state = projectWorldItems(events);
        projectionCache.delete(context.worldInstanceId);
        projectionCache.set(context.worldInstanceId, { revision, state: structuredClone(state) });
        while (projectionCache.size > 16) {
          const oldestWorldId = projectionCache.keys().next().value as string | undefined;
          if (!oldestWorldId) break;
          projectionCache.delete(oldestWorldId);
        }
        return state;
      },
    };
    provideCapability(worldItemsStateCapability, capability);
    registerEffect(WORLD_ITEM_DROP_EFFECT, 1, WorldItemDropEffectSchema, async (payload, context) => {
      await appendWorldDrop(context.store, context.worldInstanceId, context.effectId, payload);
    });
    registerEffect(WORLD_ITEM_CLAIM_EFFECT, 1, WorldItemClaimEffectSchema, async (payload, context) => {
      await appendCharacterReceipt(context.store, context.worldInstanceId, context.effectId, payload);
    });
    registerEffect(WORLD_CORPSE_CREATE_EFFECT, 1, WorldCorpseCreateEffectSchema, async (payload, context) => {
      await appendWorldCorpse(context.store, context.worldInstanceId, context.effectId, payload);
    });
    registerEffect(WORLD_CORPSE_GOLD_CREDIT_EFFECT, 1, WorldCorpseGoldCreditEffectSchema, async (payload, context) => {
      await appendCorpseGoldCredit(context.store, context.worldInstanceId, context.effectId, payload);
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
