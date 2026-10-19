import { z } from 'zod';
import { DomainEventBaseSchema } from './protocol.js';
import { IdSchema } from './ids.js';
import { InventoryItemProjectionSchema } from './character.js';

export const WorldItemRecordSchema = z.object({
  worldItemId: IdSchema,
  item: InventoryItemProjectionSchema,
  locationId: IdSchema.nullable(),
  holderCharacterId: IdSchema.nullable(),
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

export type WorldItemRecord = z.infer<typeof WorldItemRecordSchema>;
