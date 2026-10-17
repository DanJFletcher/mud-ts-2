/** PROPOSED contract derived from planned core chat plugin, not a previously shipped API. */
import { z } from 'zod';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema } from './ids.js';

export const SayCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('chat.say'),
  payload: z.object({
    channel: z.enum(['local', 'party']),
    text: z.string().trim().min(1).max(2000),
  }).strict(),
}).strict();

export const MessageSpokenEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('chat.spoken'),
  payload: z.object({
    speakerCharacterId: IdSchema,
    channel: z.enum(['local', 'party']),
    text: z.string().min(1).max(2000),
    locationId: IdSchema.optional(),
  }).strict(),
}).strict();

export type SayCommand = z.infer<typeof SayCommandSchema>;
export type MessageSpokenEvent = z.infer<typeof MessageSpokenEventSchema>;
