/** PROPOSED transport-neutral frame types; not a finalized WebSocket protocol. */
import { z } from 'zod';
import { CommandReceiptSchema } from './protocol.js';
import { SubscriptionRequestSchema, StreamNotificationSchema, ProjectionSnapshotSchema } from './stream.js';
import { IdSchema } from './ids.js';

export const WireFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hello'), supportedVersions: z.array(z.number().int().positive()) }).strict(),
  z.object({ kind: z.literal('command'), command: z.unknown() }).strict(),
  z.object({ kind: z.literal('receipt'), receipt: CommandReceiptSchema }).strict(),
  z.object({ kind: z.literal('query'), query: z.unknown() }).strict(),
  z.object({ kind: z.literal('queryResult'), queryId: IdSchema, result: z.unknown() }).strict(),
  z.object({ kind: z.literal('subscribe'), subscription: SubscriptionRequestSchema }).strict(),
  z.object({ kind: z.literal('snapshot'), snapshot: ProjectionSnapshotSchema }).strict(),
  z.object({ kind: z.literal('event'), notification: StreamNotificationSchema }).strict(),
  z.object({ kind: z.literal('ack'), cursor: z.string() }).strict(),
  z.object({ kind: z.literal('heartbeat'), nonce: z.string() }).strict(),
  z.object({ kind: z.literal('resume'), afterCursor: z.string() }).strict(),
  z.object({ kind: z.literal('error'), code: z.string(), message: z.string() }).strict(),
]);

export type WireFrame = z.infer<typeof WireFrameSchema>;
