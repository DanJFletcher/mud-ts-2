/**
 * DRAFT extension seam, NOT an existing combat public API.
 * The core coordinates turn windows; a ruleset decides legality, damage and dice.
 */
import { z } from 'zod';
import { ClientCommandBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema } from './ids.js';

export const CombatActionCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('combat.action'),
  payload: z.object({ encounterId: IdSchema, actionId: IdSchema, targetIds: z.array(IdSchema) }).strict(),
}).strict();

export const CombatViewSchema = z.object({
  encounterId: IdSchema,
  revision: NonNegativeIntSchema,
  round: NonNegativeIntSchema,
  activeParticipantId: IdSchema.optional(),
  participants: z.array(z.object({ id: IdSchema, label: z.string() }).strict()),
  availableActions: z.array(z.object({ id: IdSchema, label: z.string() }).strict()),
}).strict();

export type CombatActionCommand = z.infer<typeof CombatActionCommandSchema>;
export type CombatView = z.infer<typeof CombatViewSchema>;
