/** PROPOSED scoped delivery; global ordering across streams is NOT promised. */
import { z } from 'zod';
import { IdSchema, NonNegativeIntSchema } from './ids.js';
import { LocationProjectionSchema } from './world.js';
import { CharacterProjectionSchema } from './character.js';

export const SubscriptionRequestSchema = z.object({
  worldInstanceId: IdSchema,
  topic: z.enum(['character', 'location', 'narrative', 'combat', 'presence']),
  subjectId: IdSchema.optional(),
  afterCursor: z.string().optional(),
}).strict();

export const StreamNotificationSchema = z.object({
  notificationId: IdSchema,
  worldInstanceId: IdSchema,
  topic: z.string(),
  cursor: z.string(),
  eventId: IdSchema.optional(),
  eventType: z.string().optional(),
  eventVersion: NonNegativeIntSchema.optional(),
  /** Already redacted to subscriber's visibility scope. */
  projection: z.unknown(),
}).strict();

export const ProjectionSnapshotSchema = z.object({
  worldInstanceId: IdSchema,
  cursor: z.string(),
  location: LocationProjectionSchema.optional(),
  character: CharacterProjectionSchema.optional(),
}).strict();

export type SubscriptionRequest = z.infer<typeof SubscriptionRequestSchema>;
export type StreamNotification = z.infer<typeof StreamNotificationSchema>;
export type ProjectionSnapshot = z.infer<typeof ProjectionSnapshotSchema>;
