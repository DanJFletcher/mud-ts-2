import { z } from 'zod';

export const RealtimeChannelSchema = z.enum(['chat', 'presence', 'interactions', 'party', 'team', 'character']);
export type RealtimeChannel = z.infer<typeof RealtimeChannelSchema>;
export const RealtimeClientFrameSchema = z.object({
  type: z.literal('subscribe'), version: z.literal(1),
  channels: z.array(RealtimeChannelSchema).min(1).max(6),
}).strict();
/** A client opts into protocol 2 with `?protocol=2` on the socket URL. */
export const REALTIME_PROTOCOL_VERSION = 2;
/** Version numbers only, never game state: they let a client skip refetching what it already holds. */
export const RealtimeRevisionHintsSchema = z.object({
  character: z.number().int().nonnegative(),
}).partial().strict();
export type RealtimeRevisionHints = z.infer<typeof RealtimeRevisionHintsSchema>;
/**
 * Invalidations carry no domain payload. HTTP recovers authoritative state.
 * Protocol 2 invalidations may add revision hints; protocol 1 clients never receive them.
 */
export const RealtimeServerFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), version: z.literal(1), connectionId: z.string() }).strict(),
  z.object({
    type: z.literal('invalidate'), version: z.union([z.literal(1), z.literal(2)]), connectionId: z.string(),
    sequence: z.number().int().positive(), eventId: z.string(),
    worldInstanceId: z.string(), channels: z.array(RealtimeChannelSchema),
    revisions: RealtimeRevisionHintsSchema.optional(),
  }).strict(),
  z.object({ type: z.literal('resync_required'), version: z.literal(1) }).strict(),
]);
