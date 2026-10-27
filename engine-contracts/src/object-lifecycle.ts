import { z } from 'zod';
import { DomainEventBaseSchema } from './protocol.js';
import { IdSchema } from './ids.js';

export const ObjectLifecycleStateSchema = z.enum([
  'scheduled',
  'expiring',
  'expired',
  'cancelled',
]);

const LifecycleIdentitySchema = z.object({
  objectId: IdSchema,
  objectType: z.string().trim().min(1).max(80),
  locationId: IdSchema,
}).strict();

export const ObjectLifecycleScheduledEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.object_lifecycle_scheduled'),
  version: z.literal(1),
  payload: LifecycleIdentitySchema.extend({
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const ObjectLifecycleRescheduledEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.object_lifecycle_rescheduled'),
  version: z.literal(1),
  payload: LifecycleIdentitySchema.extend({
    expiresAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const ObjectLifecycleCancelledEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.object_lifecycle_cancelled'),
  version: z.literal(1),
  payload: LifecycleIdentitySchema,
}).strict();

export const ObjectExpiringEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.object_expiring'),
  version: z.literal(1),
  payload: LifecycleIdentitySchema.extend({
    expiresAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const ObjectExpiredEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.object_expired'),
  version: z.literal(1),
  payload: LifecycleIdentitySchema.extend({
    expiredAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();

export const ObjectLifecycleProjectionSchema = z.object({
  ...LifecycleIdentitySchema.shape,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  state: ObjectLifecycleStateSchema,
  revision: z.number().int().nonnegative(),
}).strict();

export type ObjectLifecycleProjection = z.infer<typeof ObjectLifecycleProjectionSchema>;
export type ObjectLifecycleState = z.infer<typeof ObjectLifecycleStateSchema>;
