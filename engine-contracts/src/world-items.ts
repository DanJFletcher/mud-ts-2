import { z } from 'zod';
import { DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';
import { InventoryItemProjectionSchema } from './character.js';

export const WorldItemRecordSchema = z.object({
  worldItemId: IdSchema,
  item: InventoryItemProjectionSchema,
  locationId: IdSchema.nullable(),
  holderCharacterId: IdSchema.nullable(),
  containerId: IdSchema.optional(),
}).strict().superRefine((record, context) => {
  if (
    record.item.id !== record.worldItemId ||
    record.item.sharedItemId !== record.worldItemId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['item'],
      message: 'Shared world-item records must use their stable world item ID.',
    });
  }
  if ((record.locationId === null) === (record.holderCharacterId === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['locationId'],
      message: 'A world item must have exactly one location or character holder.',
    });
  }
});

export const WorldItemDroppedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.item_dropped'),
  version: z.literal(1),
  payload: z.object({
    worldItemId: IdSchema,
    fromCharacterId: IdSchema,
    locationId: IdSchema,
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const WorldItemClaimedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.item_claimed'),
  version: z.literal(1),
  payload: z.object({
    worldItemId: IdSchema,
    characterId: IdSchema,
    locationId: IdSchema,
  }).strict(),
}).strict();

/** Terminal ownership transition, written atomically with the consuming character command. */
export const WorldItemsConsumedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.items_consumed'), version: z.literal(1),
  payload: z.object({ characterId: IdSchema, worldItemIds: z.array(IdSchema).min(1).max(20) }).strict(),
}).strict();

export const WorldCorpseRecordSchema = z.object({
  corpseId: IdSchema,
  encounterId: IdSchema,
  opponentId: IdSchema,
  opponentName: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  locationId: IdSchema,
  corpseType: z.enum(['npc', 'player']).optional(),
  ownerCharacterId: IdSchema.optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  expirationPolicy: z.enum(['destroy', 'drop', 'recovery-storage']).optional(),
  currencyId: IdSchema.optional(),
  currencyAmount: NonNegativeIntSchema.max(2_147_483_647),
  goldItemId: IdSchema.optional(),
  goldClaimed: z.boolean(),
}).strict().superRefine((corpse, context) => {
  if ((corpse.currencyAmount > 0) !== Boolean(corpse.currencyId && corpse.goldItemId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currencyAmount'],
      message: 'A corpse with currency must identify its currency and takeable gold entry.',
    });
  }
  if (corpse.createdAt && corpse.expiresAt && Date.parse(corpse.expiresAt) <= Date.parse(corpse.createdAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'A corpse must expire after it is created.',
    });
  }
  if (corpse.expirationPolicy === 'recovery-storage' && !corpse.ownerCharacterId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ownerCharacterId'],
      message: 'Recovery storage requires a corpse owner.',
    });
  }
});

export const WorldCurrencyDropRecordSchema = z.object({
  dropId: IdSchema,
  corpseId: IdSchema,
  locationId: IdSchema,
  currencyId: IdSchema,
  amount: PositiveIntSchema.max(2_147_483_647),
}).strict();

export const WorldCorpseCreatedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.corpse_created'),
  version: z.literal(1),
  payload: z.object({
    corpse: WorldCorpseRecordSchema,
    items: z.array(z.object({
      worldItemId: IdSchema,
      item: InventoryItemProjectionSchema,
    }).strict()).max(24),
  }).strict(),
}).strict();

export const WorldCorpseExpiredEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.corpse_expired'),
  version: z.literal(1),
  payload: z.object({
    corpseId: IdSchema,
    corpseName: z.string().min(1).max(120),
    locationId: IdSchema,
    policy: z.enum(['destroy', 'drop', 'recovery-storage']),
    expiredAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const WorldCorpseGoldClaimedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.corpse_gold_claimed'),
  version: z.literal(1),
  payload: z.object({
    corpseId: IdSchema,
    characterId: IdSchema,
    locationId: IdSchema,
    currencyId: IdSchema,
    amount: PositiveIntSchema.max(2_147_483_647),
  }).strict(),
}).strict();

export type WorldItemRecord = z.infer<typeof WorldItemRecordSchema>;
export type WorldCorpseRecord = z.infer<typeof WorldCorpseRecordSchema>;
export type WorldCurrencyDropRecord = z.infer<typeof WorldCurrencyDropRecordSchema>;
