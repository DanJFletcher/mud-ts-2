import { z } from 'zod';
import { ContractVersionSchema, IdSchema, IsoDateTimeSchema, NonNegativeIntSchema } from './ids.js';

export const InteractionRequestStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);

export const InteractionRequestProjectionSchema = z.object({
  requestId: IdSchema,
  kind: z.string().min(1).max(64),
  initiatorCharacterId: IdSchema,
  initiatorName: z.string().min(1).max(48),
  recipientCharacterId: IdSchema,
  recipientName: z.string().min(1).max(48),
  status: InteractionRequestStatusSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
}).strict();

const InteractionCommandBaseSchema = z.object({
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
}).strict();

export const InteractionRequestCommandSchema = InteractionCommandBaseSchema.extend({
  type: z.literal('interaction.request'),
  payload: z.object({
    kind: z.string().min(1).max(64),
    recipientCharacterId: IdSchema,
  }).strict(),
}).strict();

export const InteractionRespondCommandSchema = InteractionCommandBaseSchema.extend({
  type: z.literal('interaction.respond'),
  payload: z.object({
    requestId: IdSchema,
    response: z.enum(['accept', 'decline']),
  }).strict(),
}).strict();

export const PvpCombatActionCommandSchema = InteractionCommandBaseSchema.extend({
  type: z.literal('pvp.action'),
  payload: z.object({
    encounterId: IdSchema,
    action: z.enum(['attack', 'defend', 'flee', 'use-item']),
    itemId: IdSchema.optional(),
  }).strict().superRefine((payload, context) => {
    if (payload.action === 'use-item' && !payload.itemId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['itemId'], message: 'An item is required.' });
    }
    if (payload.action !== 'use-item' && payload.itemId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['itemId'], message: 'Items are only valid with use-item.' });
    }
  }),
}).strict();

export const PvpParticipantProjectionSchema = z.object({
  characterId: IdSchema,
  name: z.string().min(1).max(48),
  health: NonNegativeIntSchema,
  maximumHealth: z.number().int().positive(),
}).strict();

export const PvpEncounterStatusSchema = z.enum(['active', 'resolving', 'completed']);

export const PvpEncounterProjectionSchema = z.object({
  encounterId: IdSchema,
  requestId: IdSchema,
  locationId: IdSchema,
  participants: z.tuple([PvpParticipantProjectionSchema, PvpParticipantProjectionSchema]),
  turnCharacterId: IdSchema.nullable(),
  round: NonNegativeIntSchema,
  status: PvpEncounterStatusSchema,
  lastNarration: z.string().min(1).max(500),
  updatedAt: IsoDateTimeSchema,
}).strict();

export const InteractionInboxSchema = z.object({
  requests: z.array(InteractionRequestProjectionSchema),
  encounter: PvpEncounterProjectionSchema.nullable(),
}).strict();

export type InteractionRequestProjection = z.infer<typeof InteractionRequestProjectionSchema>;
export type PvpEncounterProjection = z.infer<typeof PvpEncounterProjectionSchema>;
export type InteractionInbox = z.infer<typeof InteractionInboxSchema>;
