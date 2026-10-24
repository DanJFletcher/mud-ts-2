import { z } from 'zod';

export const RealtimeChannelSchema = z.enum(['chat', 'presence', 'interactions', 'party', 'team', 'character']);
export type RealtimeChannel = z.infer<typeof RealtimeChannelSchema>;
export const RealtimeClientFrameSchema = z.object({
  type: z.literal('subscribe'), version: z.literal(1),
  channels: z.array(RealtimeChannelSchema).min(1).max(6),
}).strict();
/** Invalidations carry no domain payload. HTTP recovers authoritative state. */
export const RealtimeServerFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), version: z.literal(1), connectionId: z.string() }).strict(),
  z.object({
    type: z.literal('invalidate'), version: z.literal(1), connectionId: z.string(),
    sequence: z.number().int().positive(), eventId: z.string(),
    worldInstanceId: z.string(), channels: z.array(RealtimeChannelSchema),
  }).strict(),
  z.object({ type: z.literal('resync_required'), version: z.literal(1) }).strict(),
]);
